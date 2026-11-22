// The sources of one intake (architecture.md section 8; piece 22). A file the
// learner attaches is received into a scratch folder in the intake's
// uploads, `.<attachment>.tmp/`, converted there in the sandbox
// (source-convert.ts), and put in place by the record under a slug of its
// title: in the intake's uploads before the first proposal creates the
// course, which then moves them into its `sources/`, and in the course's
// `sources/` after. Until then the learner can remove one. Each step shows on
// the file's card through the intake's event log.
//
// The planner is told, on its next turn, of each source attached (its
// outline), removed or refused. What a session has been told is kept by
// source, so a new session, as after a lost one or in a reopened draft's
// intake, is told of every source the course has.

import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import type { Slug } from "../../shared/course.ts";
import type { PageEvent } from "../../shared/events.ts";
import {
  formatBytes,
  type Outline,
  SOURCE_SIZE_LIMIT,
  type SourceRefusal,
  sourceFacts,
} from "../../shared/source.ts";
import type { DataRoot } from "../record/data-root.ts";
import type { ChatResult } from "./conversation.ts";
import type { SourceConverter } from "./source-convert.ts";
import { formatText, outlineLines } from "./source-text.ts";

/** A file the learner attached, as the route passes it on. */
export interface Upload {
  /** The file's name as the learner gave it. */
  name: string;
  /** Its size in bytes, as the request says, if it says. */
  size: number | undefined;
  body: AsyncIterable<Uint8Array>;
}

/**
 * The file was taken and converts now, with its card's id; or why not. A
 * refusal its card shows has the card's id too.
 */
export type AttachResult =
  | { ok: true; attachment: string }
  | {
      ok: false;
      status: 400 | 409 | 413;
      error: string;
      attachment?: string;
    };

/** What a planner's turn says of the sources, and how to note it was sent. */
export interface SourcesTold {
  /** The `<sources>` block, or nothing when there is nothing to tell. */
  block: string | undefined;
  /** Notes that the session has been told: call once the turn is sent. */
  sent(): void;
}

export interface IntakeSources {
  attach(upload: Upload): Promise<AttachResult>;
  /** Deletes an attached source before it becomes part of the course. */
  remove(attachment: string): Promise<ChatResult>;
  /**
   * Moves the waiting uploads and switches the placement destination in one
   * queue operation. If a move fails, it is retried before placing another
   * source in the course or saving another proposal.
   */
  moveInto(courseId: Slug): Promise<void>;
  /** A file is being received or converted. */
  converting(): boolean;
  /** Resolves once no file is being received or converted. */
  settled(): Promise<void>;
  /**
   * What the planner's next turn is told: with `fresh`, for a session that
   * has been told nothing, every source the course has.
   */
  forTurn(fresh: boolean): Promise<SourcesTold>;
  /** Stops the conversions under way; their files are removed. */
  close(): void;
}

/** A source placed: in the intake's uploads, or in the course's sources/. */
interface Placed {
  outline: Outline;
  place: "upload" | "course";
}

interface Attachment {
  name: string;
  state: "converting" | "attached" | "refused" | "removed";
  source?: Placed;
}

/** The card identifies a file even when a replacement takes the same slug. */
interface IdentifiedSource {
  outline: Outline;
  attachment: string | undefined;
}

interface ToldSource {
  title: string;
  attachment: string | undefined;
}

export function createIntakeSources(options: {
  intakeId: string;
  dataRoot: DataRoot;
  converter: SourceConverter;
  /** The initial destination if a draft was reopened. */
  courseId: Slug | undefined;
  emit(event: PageEvent): void;
  /** The largest file taken, in bytes; SOURCE_SIZE_LIMIT unless a test sets it. */
  sizeLimit?: number;
}): IntakeSources {
  const { intakeId, dataRoot, converter, emit } = options;
  const limit = options.sizeLimit ?? SOURCE_SIZE_LIMIT;
  const attachments = new Map<string, Attachment>();
  /** The conversions under way, each resolving once its file is placed or refused. */
  const pending = new Set<Promise<void>>();
  const stop = new AbortController();
  /** The sources the running session has been told of, by slug. */
  let told = new Map<Slug, ToldSource>();
  /** The files refused since the planner was last told. */
  let refusals: { name: string; detail: string }[] = [];
  /** Placing, moving and removing run one at a time. */
  let placing: Promise<unknown> = Promise.resolve();
  let course =
    options.courseId === undefined
      ? undefined
      : { id: options.courseId, uploadsMoved: true };

  function serially<T>(work: () => Promise<T>): Promise<T> {
    const run = placing.then(work, work);
    placing = run.catch(() => {});
    return run;
  }

  /** Call on the placement queue before writing any new source to the course. */
  async function moveWaitingUploads(destination: NonNullable<typeof course>) {
    for (const found of attachments.values()) {
      const { source } = found;
      if (source?.place !== "upload") continue;
      await dataRoot.moveUpload(intakeId, source.outline.id, destination.id);
      source.place = "course";
    }
    destination.uploadsMoved = true;
  }

  function refuse(
    attachment: string,
    name: string,
    size: number | undefined,
    refusal: SourceRefusal,
  ): void {
    attachments.set(attachment, { name, state: "refused" });
    refusals.push({ name, detail: refusal.detail });
    emit({
      type: "source_refused",
      attachment,
      name,
      ...(size === undefined ? {} : { size }),
      refusal,
    });
  }

  /** Converts the file received, places it, and shows the card; never throws. */
  async function convert(
    attachment: string,
    name: string,
    size: number,
    scratch: string,
    original: string,
  ): Promise<void> {
    try {
      // A valid source id, which the converter writes as the outline's; the
      // record replaces it with the source's own once placed.
      const folder = join(scratch, "source");
      await mkdir(folder);
      const converted = await converter.convert(original, folder, stop.signal);
      if (stop.signal.aborted) return;
      if (converted.result === "refused") {
        refuse(attachment, name, size, {
          reason: converted.reason,
          detail: converted.detail,
        });
        return;
      }
      if (converted.result === "failed") {
        refuse(attachment, name, size, {
          reason: "failed",
          detail: `The conversion failed: ${converted.reason}.`,
        });
        return;
      }
      if (converted.result === "timed-out") {
        refuse(attachment, name, size, {
          reason: "timed-out",
          detail: `The conversion took longer than ${converted.limit}, and was stopped.`,
        });
        return;
      }
      await serially(async () => {
        if (course?.uploadsMoved === false) await moveWaitingUploads(course);
        const courseId = course?.id;
        const outline = await dataRoot.placeSource(
          folder,
          courseId === undefined ? { intake: intakeId } : { course: courseId },
        );
        attachments.set(attachment, {
          name,
          state: "attached",
          source: {
            outline,
            place: courseId === undefined ? "upload" : "course",
          },
        });
        emit({
          type: "source_attached",
          attachment,
          size,
          source: sourceFacts(outline),
        });
      });
    } catch (error) {
      if (stop.signal.aborted) return;
      const message = error instanceof Error ? error.message : String(error);
      refuse(attachment, name, size, {
        reason: "failed",
        detail: `The conversion failed: ${message}.`,
      });
    } finally {
      await rm(scratch, { recursive: true, force: true }).catch(
        (error: unknown) => {
          console.error(
            `The scratch folder ${scratch} was not removed:`,
            error,
          );
        },
      );
    }
  }

  /** The sources the course has now, or will have from the first proposal. */
  async function current(): Promise<IdentifiedSource[]> {
    const waiting: IdentifiedSource[] = [];
    const placedCards = new Map<Slug, string>();
    for (const [attachment, { source }] of attachments) {
      if (source === undefined) continue;
      if (source.place === "upload") {
        waiting.push({ outline: source.outline, attachment });
      } else {
        placedCards.set(source.outline.id, attachment);
      }
    }
    if (course === undefined) return waiting;
    const placed = await dataRoot.readSources(course.id);
    return [
      ...placed.map((outline) => ({
        outline,
        attachment: placedCards.get(outline.id),
      })),
      ...waiting,
    ];
  }

  return {
    async attach({ name, size, body }) {
      const problem = nameProblem(name);
      if (problem !== undefined) {
        return { ok: false, status: 400, error: problem };
      }
      const attachment = randomUUID();
      if (size !== undefined && size > limit) {
        const detail = tooLarge(size, limit);
        refuse(attachment, name, size, { reason: "large", detail });
        return { ok: false, status: 413, error: detail, attachment };
      }
      if (converter.unavailable !== undefined) {
        const detail = `Gauss converts a source in its sandbox, which does not run here: ${converter.unavailable}.`;
        refuse(attachment, name, size, { reason: "sandbox", detail });
        return { ok: false, status: 409, error: detail, attachment };
      }
      attachments.set(attachment, { name, state: "converting" });
      emit({
        type: "source_converting",
        attachment,
        name,
        ...(size === undefined ? {} : { size }),
      });
      // Counted as converting from here, so a turn waits for it.
      const received = Promise.withResolvers<void>();
      pending.add(received.promise);
      try {
        const scratch = join(
          await dataRoot.uploadsFolder(intakeId),
          `.${attachment}.tmp`,
        );
        const original = join(scratch, "original", name);
        await mkdir(join(scratch, "original"), { recursive: true });
        const got = await receive(body, original, limit, stop.signal);
        if ("size" in got) {
          const done = convert(attachment, name, got.size, scratch, original);
          pending.add(done);
          void done.finally(() => pending.delete(done));
          return { ok: true, attachment };
        }
        await rm(scratch, { recursive: true, force: true });
        if ("over" in got) {
          const detail = tooLarge(undefined, limit);
          refuse(attachment, name, size, { reason: "large", detail });
          return { ok: false, status: 413, error: detail, attachment };
        }
        const detail = `The file did not arrive whole: ${got.failed}.`;
        refuse(attachment, name, size, { reason: "failed", detail });
        return { ok: false, status: 400, error: detail, attachment };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const detail = `The file could not be kept: ${message}.`;
        refuse(attachment, name, size, { reason: "failed", detail });
        return { ok: false, status: 409, error: detail, attachment };
      } finally {
        received.resolve();
        pending.delete(received.promise);
      }
    },

    async remove(attachment) {
      return serially(async (): Promise<ChatResult> => {
        const found = attachments.get(attachment);
        if (found === undefined) {
          return { ok: false, status: 404, error: "No such source." };
        }
        if (found.state === "converting") {
          return {
            ok: false,
            status: 409,
            error: "Wait until the file is converted.",
          };
        }
        const { source } = found;
        if (found.state !== "attached" || source === undefined) {
          return {
            ok: false,
            status: 409,
            error: "That file is not attached.",
          };
        }
        if (course !== undefined) {
          return {
            ok: false,
            status: 409,
            error:
              "The first proposal has made the course, so the source stays with it.",
          };
        }
        await dataRoot.removeUpload(intakeId, source.outline.id);
        attachments.set(attachment, { name: found.name, state: "removed" });
        emit({ type: "source_removed", attachment });
        return { ok: true };
      });
    },

    moveInto(courseId) {
      return serially(async () => {
        course ??= { id: courseId, uploadsMoved: false };
        if (!course.uploadsMoved) await moveWaitingUploads(course);
      });
    },

    converting: () =>
      [...attachments.values()].some((a) => a.state === "converting"),

    async settled() {
      while (pending.size > 0) await Promise.all(pending);
    },

    async forTurn(fresh) {
      const known = fresh ? new Map<Slug, ToldSource>() : told;
      const now = new Map<Slug, ToldSource>();
      const added: Outline[] = [];
      for (const { outline, attachment } of await current()) {
        now.set(outline.id, { title: outline.title, attachment });
        const before = known.get(outline.id);
        if (before === undefined || before.attachment !== attachment) {
          added.push(outline);
        }
      }
      const gone = [...known].filter(([id, before]) => {
        const after = now.get(id);
        return after === undefined || before.attachment !== after.attachment;
      });
      const refused = [...refusals];
      const sent = () => {
        told = now;
        refusals = refusals.filter((r) => !refused.includes(r));
      };
      if (added.length === 0 && gone.length === 0 && refused.length === 0) {
        return { block: undefined, sent };
      }
      const items = [
        ...gone.map(
          ([id, { title }]) =>
            `Removed by the learner: ${JSON.stringify(title)} (source id "${id}"). It is not one of the course's sources.`,
        ),
        ...added.map(attachedText),
        ...refused.map(
          ({ name, detail }) =>
            `Not attached: the learner's file ${JSON.stringify(name)}. ${detail} It is not one of the course's sources.`,
        ),
      ];
      return { block: `<sources>\n${items.join("\n\n")}\n</sources>`, sent };
    },

    close() {
      stop.abort();
    },
  };
}

/** What a turn says of a source attached: what it is, then its outline. */
function attachedText(outline: Outline): string {
  return [
    `Attached: ${JSON.stringify(outline.title)} (source id "${outline.id}"), ` +
      `${formatText(outline)}, from the learner's file ${JSON.stringify(outline.name)}. ` +
      "Its outline, one line per entry, indented by depth: a heading's " +
      "title, or a section's id, title, place and size in characters.",
    ...outlineLines(outline),
  ].join("\n");
}

/** Why a file is too large: its size, where it is known and reads apart from the limit. */
function tooLarge(size: number | undefined, limit: number): string {
  const most = formatBytes(limit);
  return size === undefined || formatBytes(size) === most
    ? `It is more than ${most}, the most Gauss takes.`
    : `It is ${formatBytes(size)}; Gauss takes files up to ${most}.`;
}

/** Why the name cannot be a file's, or nothing. */
function nameProblem(name: string): string | undefined {
  if (name.trim() === "" || name === "." || name === "..") {
    return "The file has no name.";
  }
  if (/[/\p{Cc}]/u.test(name)) {
    return "The file's name cannot hold a slash or a control character.";
  }
  if (Buffer.byteLength(name, "utf8") > 255) {
    return "The file's name is longer than 255 bytes.";
  }
  return undefined;
}

class TooLarge extends Error {}

/** Writes the body to a new file at `path`, counting it, up to `limit` bytes. */
async function receive(
  body: AsyncIterable<Uint8Array>,
  path: string,
  limit: number,
  signal: AbortSignal,
): Promise<{ size: number } | { over: true } | { failed: string }> {
  let size = 0;
  try {
    await pipeline(
      body,
      async function* (chunks: AsyncIterable<Uint8Array>) {
        for await (const chunk of chunks) {
          size += chunk.byteLength;
          if (size > limit) throw new TooLarge();
          yield chunk;
        }
      },
      createWriteStream(path, { flags: "wx" }),
      { signal },
    );
    return { size };
  } catch (error) {
    if (error instanceof TooLarge) return { over: true };
    return { failed: error instanceof Error ? error.message : String(error) };
  }
}
