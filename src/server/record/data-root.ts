// The data root: the folder that holds every course (architecture.md
// section 3). This module creates, lists, reads and marks opened courses
// and their units, stores and approves their curricula, each draft with its
// style note and background note, reads those notes, stores the plans of
// their units, keeps the position of each unit in progress in state.json,
// appends to and reads the evidence log, appends a dispute once per answer,
// appends to and reads the units' session transcripts, and stores and reads the artifacts the tutor shows.
// Every write of a whole file goes through writeFileAtomic, the logs are
// appended to, and every file read or written is checked against its schema
// in src/shared/. Work that reads a file and writes it back, and every
// append, runs through withFileLock, so it lands in the order called.

import { mkdir, readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { ArtifactFile } from "../../shared/artifact.ts";
import { Course, Slug } from "../../shared/course.ts";
import {
  Curriculum,
  CurriculumProposal,
  type ShownProposal,
} from "../../shared/curriculum.ts";
import { PageEvent } from "../../shared/events.ts";
import {
  DisputeEvidence,
  EvidenceEntry,
  OverrideEvidence,
} from "../../shared/evidence.ts";
import type { StoredCourse } from "../../shared/library.ts";
import { PackageCompletion } from "../../shared/packages.ts";
import { Plan } from "../../shared/plan.ts";
import { State, UnitPosition } from "../../shared/state.ts";
import { writeFileAtomic, writeFileNew } from "./atomic-write.ts";
import { disputable } from "./disputes.ts";
import { withFileLock } from "./file-lock.ts";
import {
  appendJsonLine,
  appendJsonLines,
  readJsonLines,
} from "./json-lines.ts";

/** `GAUSS_DATA_ROOT` when it is set and not empty, otherwise `~/gauss`. */
export function resolveDataRoot(
  env: Readonly<Record<string, string | undefined>> = process.env,
  home: string = homedir(),
): string {
  const chosen = env.GAUSS_DATA_ROOT;
  return chosen ? resolve(chosen) : join(home, "gauss");
}

export interface DataRoot {
  /** Makes the course's folder and its course.json. The id comes from the title. */
  createCourse(input: { title: string }): Promise<StoredCourse>;
  /**
   * Every course, most recently opened first. A folder without course.json
   * (a creation that stopped partway) is left out.
   */
  listCourses(): Promise<StoredCourse[]>;
  /** One course, or undefined when no course has that id. */
  readCourse(id: string): Promise<StoredCourse | undefined>;
  /**
   * The absolute path of the course's workspace (task 3.3): the tutor's
   * working folder, where its sessions run and are kept, and the only one
   * it writes in; made if it is missing. Gauss writes nothing in it. Throws
   * for an id that cannot be a course's.
   */
  workspaceFolder(id: string): Promise<string>;
  /**
   * The absolute path of the folder the intakes' tutor sessions run in, so
   * that they are kept (task 2.15); made if it is missing. Gauss writes
   * nothing in it.
   */
  intakeFolder(): Promise<string>;
  /**
   * Sets the course's lastOpenedAt to the clock's time, and the unit's time
   * in unitsOpenedAt when a unit is named.
   */
  markOpened(id: string, unitId?: string): Promise<StoredCourse>;
  /**
   * The course's style note, style.md, trimmed, or undefined when it has
   * none (a course proposed before notes existed, task 2.10) or the file is
   * blank.
   */
  readStyle(id: string): Promise<string | undefined>;
  /**
   * The course's background note, background.md, trimmed, or undefined when
   * it has none (a course proposed before background notes existed, task
   * 2.22) or the file is blank.
   */
  readBackground(id: string): Promise<string | undefined>;
  /**
   * Stores the tutor's proposal as the course's draft curriculum, replacing
   * any earlier draft, its style note as style.md, its background note as
   * background.md, and its title as the course's title. Refused, changing
   * nothing, once the curriculum is approved, so the approved notes are the
   * ones approval found.
   */
  saveProposal(
    id: string,
    proposal: CurriculumProposal,
  ): Promise<StoredCourse & { curriculum: Curriculum }>;
  /**
   * Approves the draft curriculum, at the clock's time, if the record holds
   * exactly the proposal shown: its title, units, style note and background
   * note. Otherwise it throws DraftMismatch and changes nothing, so a draft
   * whose save stopped partway is never approved unseen.
   */
  approveCurriculum(
    id: string,
    shown: ShownProposal,
  ): Promise<StoredCourse & { curriculum: Curriculum }>;
  /**
   * Stores the plan on the unit, once the curriculum is approved and while
   * the unit has none. Refused, changing nothing, when one of its objective
   * ids is used in another unit's plan.
   */
  storePlan(
    id: string,
    unitId: string,
    plan: Plan,
  ): Promise<StoredCourse & { curriculum: Curriculum }>;
  /** Where each unit in progress stands; no units when none is. */
  readState(id: string): Promise<State>;
  /**
   * Sets the unit's position in state.json, or with null takes the unit out
   * (it is no longer in progress), and returns the state as written. A package
   * completion is saved in the same write. Writes land in the order they were
   * called, each on the one before.
   */
  writePosition(
    id: string,
    unitId: string,
    position: UnitPosition | null,
    completion?: PackageCompletion,
  ): Promise<State>;
  /** Appends one entry to evidence.jsonl. Appends land in the order called. */
  appendEvidence(id: string, entry: EvidenceEntry): Promise<void>;
  /** The evidence, oldest first, without a last line a crash cut short. */
  readEvidence(id: string): Promise<EvidenceEntry[]>;
  /**
   * Appends a dispute of a recorded answer, with the override it brings if
   * it takes the pass from an objective of a finished unit (task 3.8), in
   * one write. Throws DisputeRefused, appending nothing, when the evidence
   * has no answer to the question, the answer is "I don't know", or it was
   * disputed already: checked as the append waits its turn, so two disputes
   * of one answer cannot both land.
   */
  appendDispute(
    id: string,
    dispute: DisputeEvidence,
    override?: OverrideEvidence,
  ): Promise<void>;
  /**
   * Appends the page events to the transcript of the unit's session with
   * this number, made if it is new. Appends land in the order called. They
   * are not flushed to disk, as the record's other files are: a transcript
   * only shows the conversation, and is written often.
   */
  appendTranscript(
    id: string,
    unitId: string,
    session: number,
    events: readonly PageEvent[],
  ): Promise<void>;
  /**
   * The unit's session transcripts, in the order of their numbers, each
   * without a last line a crash cut short; none when the unit has none. A
   * line that cannot be read is left out and named in `unreadable`, so a
   * damaged transcript, or an event of a shape the page no longer has, costs
   * that line and not the unit.
   */
  readTranscripts(id: string, unitId: string): Promise<Transcript[]>;
  /**
   * Stores an artifact the tutor showed (task 3.6) in the course's
   * artifacts/ folder, as `<number>-<title as a slug>.html`, numbered on
   * from the highest number there and never written over a file that is
   * there. Returns its number and its file's name.
   */
  writeArtifact(
    id: string,
    artifact: { title: string; html: string },
  ): Promise<{ number: number; file: ArtifactFile }>;
  /**
   * An artifact's document, or undefined when the course has none by that
   * name, or the name cannot be an artifact's.
   */
  readArtifact(id: string, file: string): Promise<string | undefined>;
}

/**
 * One session of a unit, one sitting (task 2.13): the page events of its
 * chat in that sitting, in `sessions/<unit id>.<number>.jsonl`. A unit's
 * sessions are numbered from 1 in the order they began. A slug has no dot,
 * so the name can be read back.
 */
export interface Transcript {
  session: number;
  /** The session's page events; empty if a crash cut its only line short. */
  events: PageEvent[];
  /** The lines left out, each with where it is and why. */
  unreadable: string[];
}

/**
 * Approval was refused because the stored draft is not the proposal the
 * learner saw: saving a later one stopped partway, or the files were edited.
 */
/** A dispute the record refuses (`appendDispute`), with the route's status. */
export class DisputeRefused extends Error {
  readonly status: 404 | 409;
  constructor(status: 404 | 409, message: string) {
    super(message);
    this.name = "DisputeRefused";
    this.status = status;
  }
}

export class DraftMismatch extends Error {
  constructor(id: string, parts: readonly string[]) {
    super(
      `The stored draft of "${id}" is not the proposal shown; they differ in ${parts.join(" and ")}.`,
    );
    this.name = "DraftMismatch";
  }
}

/** The plain-text notes kept with a course's curriculum. */
type Note = "style.md" | "background.md";

export function openDataRoot(options: {
  path: string;
  /** The clock for the dates in the record; tests set it. */
  now?: () => Date;
}): DataRoot {
  const courses = join(options.path, "courses");
  const now = options.now ?? (() => new Date());

  async function readCourse(id: string): Promise<StoredCourse | undefined> {
    if (!Slug.safeParse(id).success) return undefined;
    const folder = join(courses, id);
    const course = await readJson(join(folder, "course.json"), Course);
    if (course === undefined) return undefined;
    const curriculum = await readJson(
      join(folder, "curriculum.json"),
      Curriculum,
    );
    return { id, course, curriculum: curriculum ?? null };
  }

  async function existingCourse(id: string): Promise<StoredCourse> {
    const stored = await readCourse(id);
    if (stored === undefined) throw new Error(noCourse(id));
    return stored;
  }

  /** A note in the course's folder, trimmed; undefined if there is none or it is blank. */
  async function readNote(id: string, note: Note): Promise<string | undefined> {
    try {
      return (await readFile(courseFile(id, note), "utf8")).trim() || undefined;
    } catch (error) {
      if (hasCode(error, "ENOENT")) return undefined;
      throw error;
    }
  }

  /** A file in the course's folder, which need not exist yet. */
  function courseFile(id: string, name: string): string {
    if (!Slug.safeParse(id).success) throw new Error(noCourse(id));
    return join(courses, id, name);
  }

  return {
    async createCourse({ title }) {
      const stamp = now().toISOString();
      const course = Course.parse({
        title,
        backend: "claude",
        settings: { webSearch: false },
        createdAt: stamp,
        lastOpenedAt: stamp,
      });
      await mkdir(courses, { recursive: true });
      const id = await makeFolder(courses, idFromTitle(course.title));
      await writeJson(join(courses, id, "course.json"), Course, course);
      return { id, course, curriculum: null };
    },

    async listCourses() {
      let entries: string[];
      try {
        entries = (await readdir(courses, { withFileTypes: true }))
          .filter((entry) => entry.isDirectory())
          .map((entry) => entry.name);
      } catch (error) {
        if (hasCode(error, "ENOENT")) return [];
        throw error;
      }
      const found = await Promise.all(entries.map(readCourse));
      return found
        .filter((entry) => entry !== undefined)
        .sort(
          (a, b) =>
            Date.parse(b.course.lastOpenedAt) -
              Date.parse(a.course.lastOpenedAt) || a.id.localeCompare(b.id),
        );
    },

    readCourse,

    async workspaceFolder(id) {
      const folder = resolve(courseFile(id, "workspace"));
      await mkdir(folder, { recursive: true });
      return folder;
    },

    async intakeFolder() {
      const folder = resolve(options.path, "intake");
      await mkdir(folder, { recursive: true });
      return folder;
    },

    async markOpened(id, unitId) {
      const unit = unitId === undefined ? undefined : Slug.parse(unitId);
      // saveProposal writes course.json too, under the curriculum's lock, but
      // only for a draft, and units are opened only once it is approved.
      const path = courseFile(id, "course.json");
      return withFileLock(path, async () => {
        const stored = await existingCourse(id);
        const stamp = now().toISOString();
        const course: Course = {
          ...stored.course,
          lastOpenedAt: stamp,
          ...(unit === undefined
            ? {}
            : {
                unitsOpenedAt: {
                  ...stored.course.unitsOpenedAt,
                  [unit]: stamp,
                },
              }),
        };
        await writeJson(path, Course, course);
        return { ...stored, course };
      });
    },

    async readStyle(id) {
      await existingCourse(id);
      return readNote(id, "style.md");
    },

    async readBackground(id) {
      await existingCourse(id);
      return readNote(id, "background.md");
    },

    async saveProposal(id, proposal) {
      const { title, units, style, background } =
        CurriculumProposal.parse(proposal);
      const path = courseFile(id, "curriculum.json");
      return withFileLock(path, async () => {
        const stored = await existingCourse(id);
        if (stored.curriculum?.approval.status === "approved") {
          throw new Error(
            `The curriculum of "${id}" is approved, so a draft cannot replace it.`,
          );
        }
        const curriculum: Curriculum = {
          approval: { status: "draft" },
          units,
        };
        await writeJson(path, Curriculum, curriculum);
        await writeFileAtomic(courseFile(id, "style.md"), `${style}\n`);
        await writeFileAtomic(
          courseFile(id, "background.md"),
          `${background}\n`,
        );
        const course = { ...stored.course, title };
        if (title !== stored.course.title) {
          await writeJson(courseFile(id, "course.json"), Course, course);
        }
        return { id, course, curriculum };
      });
    },

    async approveCurriculum(id, shown) {
      const path = courseFile(id, "curriculum.json");
      return withFileLock(path, async () => {
        const stored = await existingCourse(id);
        if (stored.curriculum === null) {
          throw new Error(`"${id}" has no curriculum to approve.`);
        }
        if (stored.curriculum.approval.status === "approved") {
          throw new Error(`The curriculum of "${id}" is already approved.`);
        }
        // saveProposal writes four files in turn, so one that failed or
        // stopped partway can leave a draft no card has shown.
        const differ: string[] = [];
        if (stored.course.title !== shown.title) differ.push("title");
        if (!isDeepStrictEqual(stored.curriculum.units, shown.units)) {
          differ.push("units");
        }
        if ((await readNote(id, "style.md")) !== shown.style) {
          differ.push("style note");
        }
        if ((await readNote(id, "background.md")) !== shown.background) {
          differ.push("background note");
        }
        if (differ.length > 0) throw new DraftMismatch(id, differ);
        const curriculum: Curriculum = {
          ...stored.curriculum,
          approval: { status: "approved", approvedAt: now().toISOString() },
        };
        await writeJson(path, Curriculum, curriculum);
        return { ...stored, curriculum };
      });
    },

    async storePlan(id, unitId, plan) {
      const checked = Plan.parse(plan);
      const path = courseFile(id, "curriculum.json");
      return withFileLock(path, async () => {
        const stored = await existingCourse(id);
        const { curriculum } = stored;
        if (curriculum?.approval.status !== "approved") {
          throw new Error(
            `The curriculum of "${id}" is not approved, so its units cannot be planned yet.`,
          );
        }
        const at = curriculum.units.findIndex((unit) => unit.id === unitId);
        const unit = curriculum.units[at];
        if (unit === undefined) {
          throw new Error(`"${unitId}" is not a unit of "${id}".`);
        }
        if (unit.plan !== undefined) {
          throw new Error(`Unit "${unitId}" already has a plan.`);
        }
        const parsed = Curriculum.safeParse({
          ...curriculum,
          units: curriculum.units.with(at, { ...unit, plan: checked }),
        });
        if (!parsed.success) {
          // The messages name the clashing ids; the paths would point into
          // the whole curriculum, which the planning session does not see.
          throw new Error(
            parsed.error.issues.map((issue) => issue.message).join("\n"),
          );
        }
        await writeJson(path, Curriculum, parsed.data);
        return { ...stored, curriculum: parsed.data };
      });
    },

    async readState(id) {
      const path = courseFile(id, "state.json");
      await existingCourse(id);
      return (await readJson(path, State)) ?? { units: {} };
    },

    async writePosition(id, unitId, position, completion) {
      const unit = Slug.parse(unitId);
      // Checked and copied now, so a later change to the caller's object
      // cannot reach a write still waiting its turn.
      const checked = position === null ? null : UnitPosition.parse(position);
      const completed =
        completion === undefined
          ? undefined
          : PackageCompletion.parse(completion);
      const path = courseFile(id, "state.json");
      return withFileLock(path, async () => {
        await existingCourse(id);
        const before = (await readJson(path, State)) ?? { units: {} };
        const state: State = {
          ...before,
          units:
            checked === null
              ? Object.fromEntries(
                  Object.entries(before.units).filter(([key]) => key !== unit),
                )
              : { ...before.units, [unit]: checked },
        };
        if (completed !== undefined) {
          const completions = before.packageCompletions ?? {};
          const forUnit = Object.hasOwn(completions, unit)
            ? completions[unit]
            : undefined;
          state.packageCompletions = {
            ...completions,
            [unit]: { ...forUnit, [completed.request.id]: completed },
          };
        }
        await writeJson(path, State, state);
        return state;
      });
    },

    async appendEvidence(id, entry) {
      const checked = EvidenceEntry.parse(entry);
      const path = courseFile(id, "evidence.jsonl");
      await withFileLock(path, async () => {
        await existingCourse(id);
        await appendJsonLine(path, checked);
      });
    },

    async readEvidence(id) {
      const path = courseFile(id, "evidence.jsonl");
      await existingCourse(id);
      return readJsonLines(path, EvidenceEntry);
    },

    async appendDispute(id, dispute, override) {
      const entries = [
        DisputeEvidence.parse(dispute),
        ...(override === undefined ? [] : [OverrideEvidence.parse(override)]),
      ];
      const path = courseFile(id, "evidence.jsonl");
      await withFileLock(path, async () => {
        await existingCourse(id);
        const evidence = await readJsonLines(path, EvidenceEntry);
        const answer = disputable(evidence, dispute.questionId);
        if (!answer.ok) throw new DisputeRefused(answer.status, answer.error);
        await appendJsonLines(path, entries);
      });
    },

    async appendTranscript(id, unitId, session, events) {
      const unit = Slug.parse(unitId);
      const number = SessionNumber.parse(session);
      const checked = events.map((event) => PageEvent.parse(event));
      const folder = courseFile(id, "sessions");
      const path = join(folder, transcriptName(unit, number));
      await withFileLock(path, async () => {
        await existingCourse(id);
        await mkdir(folder, { recursive: true });
        await appendJsonLines(path, checked, { flush: false });
      });
    },

    async writeArtifact(id, { title, html }) {
      await existingCourse(id);
      const folder = courseFile(id, "artifacts");
      return withFileLock(folder, async () => {
        await mkdir(folder, { recursive: true });
        let highest = 0;
        for (const name of await readdir(folder)) {
          highest = Math.max(highest, artifactNumber(name));
        }
        const slug = idFromTitle(title, ARTIFACT_SLUG_LENGTH, "artifact");
        for (let number = highest + 1; Number.isSafeInteger(number); number++) {
          const file = ArtifactFile.parse(`${number}-${slug}.html`);
          if (await writeFileNew(join(folder, file), html)) {
            return { number, file };
          }
        }
        throw new Error("No safe artifact number is available in this course.");
      });
    },

    async readArtifact(id, file) {
      if (
        !Slug.safeParse(id).success ||
        !ArtifactFile.safeParse(file).success
      ) {
        return undefined;
      }
      try {
        return await readFile(join(courses, id, "artifacts", file), "utf8");
      } catch (error) {
        if (hasCode(error, "ENOENT")) return undefined;
        throw error;
      }
    },

    async readTranscripts(id, unitId) {
      const unit = Slug.parse(unitId);
      const folder = courseFile(id, "sessions");
      await existingCourse(id);
      let names: string[];
      try {
        names = await readdir(folder);
      } catch (error) {
        if (hasCode(error, "ENOENT")) return [];
        throw error;
      }
      const sessions = names
        .map((name) => sessionOf(unit, name))
        .filter((session) => session !== undefined)
        .sort((a, b) => a - b);
      return Promise.all(
        sessions.map(async (session) => {
          const unreadable: string[] = [];
          const events = await readJsonLines(
            join(folder, transcriptName(unit, session)),
            PageEvent,
            (problem) => unreadable.push(problem),
          );
          return { session, events, unreadable };
        }),
      );
    },
  };
}

const SessionNumber = z.number().int().positive();

/** The file name of a unit's session transcript. */
function transcriptName(unitId: Slug, session: number): string {
  return `${unitId}.${session}.jsonl`;
}

/** The session number in the name of one of the unit's transcripts; undefined for any other file. */
function sessionOf(unitId: Slug, name: string): number | undefined {
  const match = /^(.+)\.([1-9][0-9]*)\.jsonl$/.exec(name);
  return match?.[1] === unitId ? Number(match[2]) : undefined;
}

function noCourse(id: string): string {
  return `There is no course "${id}".`;
}

/** The number an artifact's file name starts with; 0 for any other file. */
function artifactNumber(name: string): number {
  return ArtifactFile.safeParse(name).success ? Number.parseInt(name, 10) : 0;
}

/** Leaves room within Slug's 60 characters for a "-2" or longer suffix. */
const ID_LENGTH = 50;

/** Enough of an artifact's title for its file to be found by eye. */
const ARTIFACT_SLUG_LENGTH = 40;

/**
 * The title's letters and digits as a slug, cut at a word within `length`;
 * `fallback` if it has none.
 */
function idFromTitle(
  title: string,
  length = ID_LENGTH,
  fallback = "course",
): string {
  const words =
    title
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .match(/[a-z0-9]+/g) ?? [];
  let id = "";
  for (const word of words) {
    const longer = id === "" ? word : `${id}-${word}`;
    if (longer.length > length) break;
    id = longer;
  }
  return id || words[0]?.slice(0, length) || fallback;
}

/**
 * Makes a new folder named `base`, or `base-2`, `base-3` and so on when that
 * is taken, and returns the name it made. Making the folder is what claims
 * the name, so two creations can never share one.
 */
async function makeFolder(parent: string, base: string): Promise<Slug> {
  for (let n = 1; ; n++) {
    const name = n === 1 ? base : `${base}-${n}`;
    try {
      await mkdir(join(parent, name));
      return name;
    } catch (error) {
      if (!hasCode(error, "EEXIST")) throw error;
    }
  }
}

/** The file's contents checked against the schema; undefined if there is no file. */
async function readJson<T>(
  path: string,
  schema: z.ZodType<T>,
): Promise<T | undefined> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (hasCode(error, "ENOENT")) return undefined;
    throw error;
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new Error(`${path} is not valid JSON.`, { cause: error });
  }
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    throw new Error(
      `${path} does not match its schema:\n${z.prettifyError(parsed.error)}`,
    );
  }
  return parsed.data;
}

/** Writes the value as JSON once the schema accepts it. */
async function writeJson<T>(
  path: string,
  schema: z.ZodType<T>,
  value: T,
): Promise<void> {
  const checked = schema.parse(value);
  await writeFileAtomic(path, `${JSON.stringify(checked, null, 2)}\n`);
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
