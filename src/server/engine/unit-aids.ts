// The aids a unit's tutor shows or finds beside the conversation: an HTML
// aid with show_artifact (task 3.6), stored in the course's artifacts/
// folder with a reference in the thread; a passage quoted with
// quote_source (task 4.9), shown once it is found in the sources; a source
// segment's lecture with present_lecture; and searches of the web (task
// 4.11) and of the sources. None while a question of the unit is open,
// answered or not: an aid could help with the answer, and the help judge
// reads only the tutor's text. A source segment's teaching turn shows only
// what present_lecture publishes (its ordinary text is hidden), so a quote
// outside the lecture is refused there. The desks and the web search's
// refusal check in the chat's queue, so they land in order with the chat's
// own writes; search_source's refusal is read when the tool runs. The unit
// chat keeps the running unit and the teaching turn's lecture, read at each
// call.

import type { ArtifactFile, ArtifactInput } from "../../shared/artifact.ts";
import type { PageEvent } from "../../shared/events.ts";
import type { Plan } from "../../shared/plan.ts";
import type { ArtifactShelf } from "../tools/show-artifact.ts";
import type { LectureDesk } from "../tools/sources.ts";
import { segmentOf } from "./check-rules.ts";
import type { QuoteDesk } from "./source-shelf.ts";
import type { UnitRecord } from "./unit-record.ts";

export interface UnitAids {
  artifactShelf: ArtifactShelf;
  quoteDesk: QuoteDesk;
  lectureDesk: LectureDesk;
  /** Why the tutor's web search is refused now, if it is. */
  webSearchRefusal(): Promise<string | undefined>;
  /** Why search_source is refused now, if it is. */
  sourceSearchRefusal(): string | undefined;
}

export function createUnitAids({
  exclusive,
  running,
  sourceLecture,
  emit,
  writeArtifact,
  unitFinished,
}: {
  exclusive<T>(work: () => Promise<T>): Promise<T>;
  /** The unit once it is loaded. */
  running():
    | {
        record: Pick<UnitRecord, "position" | "finished">;
        context: { plan: Plan };
      }
    | undefined;
  /** The lecture of the source segment's teaching turn under way, if one is. */
  sourceLecture(): { shown: boolean } | undefined;
  emit(event: PageEvent): void;
  writeArtifact(
    artifact: ArtifactInput,
  ): Promise<{ number: number; file: ArtifactFile }>;
  unitFinished: string;
}): UnitAids {
  // Not while a question of the unit is open, answered or not: an aid could
  // help with the answer, and the help judge reads only the tutor's text.
  const artifactShelf: ArtifactShelf = {
    show: (artifact, signal) =>
      exclusive(async () => {
        // A turn stopped meanwhile shows nothing more.
        signal?.throwIfAborted();
        const r = running();
        if (r === undefined) return { refused: "The unit is not open." };
        if (r.record.finished !== undefined) return { refused: unitFinished };
        const open = r.record.position.openQuestion;
        if (open !== undefined) {
          return {
            refused:
              `Question ${open.number} is open: nothing can be shown beside ` +
              "the conversation until its answer is graded, since an aid " +
              "could help with the answer.",
          };
        }
        const stored = await writeArtifact(artifact);
        // A Stop during the write: the file stays, referred to by nothing,
        // and only moves the next aid's number on.
        signal?.throwIfAborted();
        emit({
          type: "artifact",
          file: stored.file,
          title: artifact.title,
        });
        return stored;
      }),
  };

  // Not while a question of the unit is open, answered or not, as an aid: a
  // passage could help with the answer, and the help judge reads only the
  // tutor's text.
  const quoteRefusal = (): string | undefined => {
    const r = running();
    if (r === undefined) return "The unit is not open.";
    if (r.record.finished !== undefined) return unitFinished;
    const open = r.record.position.openQuestion;
    return open === undefined
      ? undefined
      : `Question ${open.number} is open: nothing can be quoted until its ` +
          "answer is graded, since a passage could help with the answer.";
  };
  const standaloneQuoteRefusal = () =>
    quoteRefusal() ??
    (sourceLecture() === undefined
      ? undefined
      : "Put quotations in present_lecture in a source teaching turn.");
  const quoteDesk: QuoteDesk = {
    closed: () => exclusive(async () => standaloneQuoteRefusal()),
    show: (quote, signal) =>
      exclusive(async () => {
        // A turn stopped meanwhile shows nothing more.
        signal?.throwIfAborted();
        const refused = standaloneQuoteRefusal();
        if (refused === undefined) emit(quote);
        return refused;
      }),
    segmentSections: () => {
      const r = running();
      return r === undefined
        ? []
        : segmentOf(r.context.plan, r.record.position).sections;
    },
  };

  const lectureRefusal = (): string | undefined =>
    quoteRefusal() ?? lectureClosed(sourceLecture());
  function lectureClosed(
    lecture: { shown: boolean } | undefined,
  ): string | undefined {
    return lecture === undefined
      ? "A lecture can only be shown in a source segment's teaching turn."
      : lecture.shown
        ? "The lecture has already been shown. End your turn."
        : undefined;
  }
  const lectureDesk: LectureDesk = {
    closed: () => exclusive(async () => lectureRefusal()),
    show: (events, signal) =>
      exclusive(async () => {
        signal?.throwIfAborted();
        const refused = lectureRefusal();
        if (refused !== undefined) return refused;
        const lecture = sourceLecture();
        if (lecture === undefined)
          throw new Error("No source lecture is active.");
        lecture.shown = true;
        for (const event of events) emit(event);
        return undefined;
      }),
  };

  // Not while a question of the unit is open, answered or not, as an aid: a
  // page found could help with the answer, and the help judge reads only the
  // tutor's text.
  const webSearchRefusal = () =>
    exclusive(async (): Promise<string | undefined> => {
      const open = running()?.record.position.openQuestion;
      return open === undefined
        ? undefined
        : `Question ${open.number} is open: nothing can be searched until ` +
            "its answer is graded, since a page found could help with the answer.";
    });

  function sourceSearchRefusal(): string | undefined {
    const r = running();
    if (r === undefined) return "The unit is not open.";
    const { position } = r.record;
    if (position.openQuestion !== undefined)
      return "A graded question is open. Search after its answer is graded.";
    if (
      position.detour !== undefined ||
      (position.phase === "discuss" && position.assessment?.stage !== "on")
    )
      return;
    // Only under the teaching header: not while an assessment or the test's card waits.
    if (
      position.phase === "teach" &&
      position.assessment === undefined &&
      position.testOut?.stage !== "result" &&
      position.testOut?.stage !== "due"
    )
      return "Search is for discussion or a detour. For a planned lecture, read the passages named in the turn header.";
    return "search_source works only in discussion or a detour. Read a section with read_section.";
  }

  return {
    artifactShelf,
    quoteDesk,
    lectureDesk,
    webSearchRefusal,
    sourceSearchRefusal,
  };
}
