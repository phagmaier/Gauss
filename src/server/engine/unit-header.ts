// Each turn's header: where the unit stands, in unit-turns.ts's words, and
// what it says once. A note is taken when a header is composed. The
// record's notices stay in the record until the turn carrying them is
// dispatched, so a Stop or restart after that does not send them again;
// the learner's style and curriculum decisions are delivered only once a
// turn carrying them completes. When the tutor's conversation cannot be
// resumed, a new session takes over, told in its first header that it is
// new, and the thread says so.

// Made for each loaded unit. The chat keeps the notes, which several parts
// add to and a header empties, read at each call; the course's style note;
// the check's rules (`checks`); and the queue.

import type { CurriculumDecision } from "../../shared/curriculum-change.ts";
import type { PageEvent, TestShown } from "../../shared/events.ts";
import type { Misconception } from "../../shared/misconception.ts";
import type { AssessmentRun } from "../../shared/state.ts";
import type { StyleDecision } from "../../shared/style.ts";
import {
  notPassed,
  type ObjectiveCheck,
  slipping,
  toGoOver,
} from "./check-rules.ts";
import type { TurnOutcome } from "./conversation.ts";
import type { UnitProgression } from "./unit-progression.ts";
import type { UnitRecord } from "./unit-record.ts";
import {
  curriculumNote,
  JOINED_NOTE,
  noticeText,
  type RunWhere,
  styleNote,
  type UnitContext,
  type Where,
} from "./unit-turns.ts";

export interface UnitHeader {
  /**
   * Where the unit stands now, with the notes not yet given, which this
   * takes. The record's notices stay in the record until the turn is sent
   * (`turnSent`), so a turn stopped before then leaves them for the next.
   */
  where(): Where;
  /**
   * Tells the next header that the conversation is new. A notice about a
   * turn of the old conversation is dropped: the new one has no such turn.
   */
  joined(): void;
  /**
   * The tutor's conversation could not be resumed: a new session takes over,
   * told in its first header that it is new, and the thread says so.
   */
  fallBack(learnerId?: string): void;
  /** The agents' hook once a turn is dispatched: its header's notices are delivered. */
  turnSent(): void;
  /** The agents' hook once a turn ends: a completed one delivers its header's decisions. */
  turnEnded(outcome: TurnOutcome): Promise<void>;
}

export function createUnitHeader({
  record,
  exclusive,
  emit,
  context: unitContext,
  plannerContext,
  notes,
  clearNotes,
  style,
  checks,
  feedback,
  runWhere,
  shownByTest,
  handoff,
}: {
  record: Pick<
    UnitRecord,
    | "tutorNotices"
    | "pendingStyleDecisions"
    | "pendingCurriculumDecisions"
    | "deliverNotices"
    | "deliverDecisions"
    | "position"
    | "evidence"
    | "finished"
  >;
  exclusive<T>(work: () => Promise<T>): Promise<T>;
  emit(event: PageEvent): void;
  /** The unit's context; its plan is what the statuses are read on. */
  context(): UnitContext;
  /** The course planner's committed curriculum, which a header gives first. */
  plannerContext(): UnitContext | undefined;
  /** The notes the next header gives once, as the chat holds them now. */
  notes(): string[];
  /** Gives the chat no notes, once a header has taken them. */
  clearNotes(): void;
  /** The course's style note as the tutor's system prompt gives it. */
  style(): string | undefined;
  /** Where each objective of the segment stands in its check, if it is in one. */
  checks(): ReadonlyMap<string, ObjectiveCheck>;
  /** The progression's feedback to come, if any. */
  feedback(): UnitProgression["feedback"];
  /** Where the assessment offered or under way stands. */
  runWhere(run: AssessmentRun): RunWhere;
  /** What the test before the unit showed, while its result waits. */
  shownByTest(): TestShown[];
  /** The unit's handoff note and the course's misconceptions, as the chat holds them now. */
  handoff(): {
    note: string | undefined;
    misconceptions: readonly Misconception[];
  };
}): UnitHeader {
  /**
   * Decisions and the record's notices in the current turn's header, if it
   * got as far as composing one, with the write of the notices' delivery
   * once the turn is sent.
   */
  let inHeader:
    | {
        style: readonly StyleDecision[];
        curriculum: readonly CurriculumDecision[];
        notices: readonly string[];
        delivered?: Promise<void>;
      }
    | undefined;
  /**
   * The record's notices sent to the tutor, or dropped for a new session,
   * which no later header carries, though the record's write may not have
   * landed yet.
   */
  const noticesTaken = new Set<string>();

  function joined(): void {
    const old = record.tutorNotices.flatMap((notice) =>
      notice.kind === "unshown-lecture" ? [notice.id] : [],
    );
    if (old.length > 0) void takeNotices(old);
    const held = notes();
    if (!held.includes(JOINED_NOTE)) held.push(JOINED_NOTE);
  }

  /**
   * Keeps the notices out of every later header at once, and out of the
   * record once the write, which waits its turn in the queue, lands. A
   * failed write is logged; the record's next write takes them out, and
   * only a restart before then tells them again.
   */
  function takeNotices(ids: readonly string[]): Promise<void> {
    for (const id of ids) noticesTaken.add(id);
    return exclusive(() => record.deliverNotices(ids)).catch(
      (error: unknown) => {
        console.error(
          "The tutor's notices could not be marked delivered:",
          error,
        );
      },
    );
  }

  function fallBack(learnerId?: string): void {
    joined();
    emit({
      type: "fresh_start",
      reason: "not-resumed",
      ...(learnerId === undefined ? {} : { learnerId }),
    });
  }

  function where(): Where {
    const context = plannerContext() ?? unitContext();
    const notices = record.tutorNotices.filter(
      (notice) => !noticesTaken.has(notice.id),
    );
    const said = [...notices.map(noticeText), ...notes()];
    clearNotes();
    const decisions = record.pendingStyleDecisions;
    const answers = record.pendingCurriculumDecisions;
    if (notices.length > 0 || decisions.length > 0 || answers.length > 0) {
      inHeader = {
        style: decisions,
        curriculum: answers,
        notices: notices.map((notice) => notice.id),
      };
      for (const decision of decisions) {
        said.push(
          decision.outcome === "applied"
            ? styleNote(
                decision.note === style() ? "applied" : "superseded",
                decision.note,
              )
            : styleNote("kept", ""),
        );
      }
      // An applied change is told with the units as they now are.
      for (const answer of answers) {
        said.push(curriculumNote(answer.outcome, context.units));
      }
    }
    const pending = feedback();
    const kept = handoff();
    return {
      context,
      position: record.position,
      checks: checks(),
      notPassed: notPassed(unitContext().plan, record.evidence),
      slipping: slipping(unitContext().plan, record.evidence),
      goOver: toGoOver(
        unitContext().plan,
        record.evidence,
        record.position.gated === true,
      ),
      ...(record.finished === undefined ? {} : { finished: record.finished }),
      ...(pending !== undefined && !pending.started
        ? { feedbackPending: pending.number }
        : {}),
      notes: said,
      evidence: record.evidence,
      ...(record.position.assessment === undefined
        ? {}
        : { assessment: runWhere(record.position.assessment) }),
      ...(record.position.testOut?.stage === "result"
        ? { test: shownByTest() }
        : {}),
      misconceptions: kept.misconceptions,
      ...(kept.note === undefined ? {} : { handoffNote: kept.note }),
    };
  }

  return {
    where,
    joined,
    fallBack,
    turnSent() {
      const header = inHeader;
      if (header === undefined || header.notices.length === 0) return;
      header.delivered = takeNotices(header.notices);
    },
    async turnEnded(outcome) {
      const sent = inHeader;
      inHeader = undefined;
      await sent?.delivered;
      if (
        outcome === "done" &&
        sent !== undefined &&
        (sent.style.length > 0 || sent.curriculum.length > 0)
      ) {
        await exclusive(() => record.deliverDecisions(sent));
      }
    },
  };
}
