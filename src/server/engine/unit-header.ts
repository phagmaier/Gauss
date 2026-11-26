// Each turn's header: where the unit stands, in unit-turns.ts's words, and
// what it says once. The record's notices, which include the record's facts
// the tutor hears of (a dispute's outcome, an assessment's end, the answer
// to the test's result card, a package install's outcome), stay in the
// record until the turn carrying them is dispatched, so a Stop or restart
// after that does not send them again, and a restart before it does not
// lose them. The chat's notes in memory are taken when a header is
// composed, and return to the chat if the turn is stopped before it is
// sent; a restart loses them, but a resumed tutor's rebuilt instructions
// carry what they say. The learner's style and curriculum decisions are
// delivered only once a turn carrying them completes. The tutor's word on
// the test before the unit, while the record says it is owed and no turn
// of its own is queued to ask for it, is asked for by every header, and is
// given once a turn asking for it completes or the learner stops it after
// it was sent. A tutor refused while
// the course view's proposal waits gets a notice that stays out of headers
// while it waits; the learner's answer, a note in memory, stands in for it
// in this run, so only a tutor the answer did not reach hears that the
// block lifted. When the tutor's conversation cannot be resumed, a new
// session takes over, told in its first header that it is new, and the
// thread says so.

// Made for each loaded unit. The chat keeps the notes, which several parts
// add to and a header empties, read at each call; the course's style note;
// the check's rules (`checks`); and the queue.

import type { CurriculumDecision } from "../../shared/curriculum-change.ts";
import type { PageEvent, TestShown } from "../../shared/events.ts";
import type { Misconception } from "../../shared/misconception.ts";
import type { AssessmentRun, TutorNotice } from "../../shared/state.ts";
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

/** Why a new session took over without the learner asking. */
type FallBackReason = Exclude<
  Extract<PageEvent, { type: "fresh_start" }>["reason"],
  "learner"
>;

export interface UnitHeader {
  /**
   * Where the unit stands now, with the notes not yet given, which this
   * takes. The record's notices stay in the record until the turn is sent
   * (`turnSent`), so a turn stopped before then leaves them, and the notes
   * it took, for the next.
   */
  where(): Where;
  /** Whether a notice `match` picks waits in the record for a header to carry it. */
  waits(match: (notice: TutorNotice) => boolean): boolean;
  /**
   * Tells the next header that the conversation is new. A notice about a
   * turn of the old conversation is dropped: the new one has no such turn.
   */
  joined(): void;
  /**
   * The tutor's conversation could not be resumed, or its tools differ from
   * a new one's: a new session takes over, told in its first header that it
   * is new, and the thread says so and why.
   */
  fallBack(reason: FallBackReason, learnerId?: string): void;
  /** The agents' hook once a turn is dispatched: its header's notices are delivered. */
  turnSent(): void;
  /**
   * The course view's proposal refused the tutor: unless one waits, a
   * notice is kept in the record, in memory before this returns, so that
   * an answer right after finds it. Called inside the chat's queue.
   */
  plannerRefused(): Promise<void>;
  /**
   * The chat's notes now carry the learner's answer to the course view's
   * proposal: the refusal's notice is not said, and the header carrying
   * the answer takes it.
   */
  plannerAnswered(): void;
  /**
   * The agents' hook once a turn ends: a completed one delivers its
   * header's decisions, one sent that did not fail gives the tutor's owed
   * word on the test, and one not sent returns the notes it took.
   */
  turnEnded(outcome: TurnOutcome): Promise<void>;
}

export function createUnitHeader({
  record,
  exclusive,
  emit,
  context: unitContext,
  plannerContext,
  plannerWaits,
  notes,
  clearNotes,
  style,
  checks,
  feedback,
  runWhere,
  shownByTest,
  summaryQueued,
  closing,
  handoff,
}: {
  record: Pick<
    UnitRecord,
    | "tutorNotices"
    | "pendingStyleDecisions"
    | "pendingCurriculumDecisions"
    | "deliverNotices"
    | "deliverDecisions"
    | "keepNotice"
    | "testSummaryGiven"
    | "position"
    | "evidence"
    | "finished"
    | "testedOut"
    | "recordedAnswer"
    | "disputeOf"
    | "packageCompletions"
  >;
  exclusive<T>(work: () => Promise<T>): Promise<T>;
  emit(event: PageEvent): void;
  /** The unit's context; its plan is what the statuses are read on. */
  context(): UnitContext;
  /** The course planner's committed curriculum, which a header gives first. */
  plannerContext(): UnitContext | undefined;
  /** Whether the course view's proposal waits, blocking the tutor's. */
  plannerWaits(): boolean;
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
  /** A turn of its own that asks what the test showed is queued or running. */
  summaryQueued(): boolean;
  /** The unit's handoff note and the course's misconceptions, as the chat holds them now. */
  handoff(): {
    note: string | undefined;
    misconceptions: readonly Misconception[];
  };
  /** The chat is closing: a turn it interrupts was not the learner's Stop. */
  closing(): boolean;
}): UnitHeader {
  /**
   * What the current turn's header carries, if it got as far as composing
   * one: decisions, the record's notices, with the write of the notices'
   * delivery once the turn is sent, the chat's notes and answered
   * refusals it took, which return to the chat if it is not sent, and
   * whether it asked for the tutor's owed word on the test.
   */
  let inHeader:
    | {
        style: readonly StyleDecision[];
        curriculum: readonly CurriculumDecision[];
        notices: readonly string[];
        notes: readonly string[];
        answered: readonly string[];
        summary: boolean;
        sent: boolean;
        delivered?: Promise<void>;
      }
    | undefined;
  /**
   * The record's notices sent to the tutor, or dropped for a new session,
   * which no later header carries, though the record's write may not have
   * landed yet.
   */
  const noticesTaken = new Set<string>();
  /**
   * The planner-blocked notices whose answer the chat's notes carry, until
   * the next header carries both.
   */
  const answered = new Set<string>();

  /** The notices of `kind` not yet taken. */
  function waitingNotices(kind: TutorNotice["kind"]): string[] {
    return record.tutorNotices.flatMap((notice) =>
      notice.kind === kind && !noticesTaken.has(notice.id) ? [notice.id] : [],
    );
  }

  function joined(): void {
    // The refusal was in the old conversation too.
    const old = [
      ...waitingNotices("unshown-lecture"),
      ...waitingNotices("planner-blocked"),
    ];
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

  function fallBack(reason: FallBackReason, learnerId?: string): void {
    joined();
    emit({
      type: "fresh_start",
      reason,
      ...(learnerId === undefined ? {} : { learnerId }),
    });
  }

  function where(): Where {
    const context = plannerContext() ?? unitContext();
    const waits = plannerWaits();
    const left = record.tutorNotices.filter(
      (notice) => !noticesTaken.has(notice.id),
    );
    // An answer in the notes stands in for its refusal's notice, which the
    // header carries with it; a turn not sent returns the note, and a
    // restart loses it, so the notice is said in the next header instead.
    const notices = left.filter(
      (notice) =>
        notice.kind !== "planner-blocked" ||
        !(waits || answered.has(notice.id)),
    );
    const carried = [
      ...notices.map((notice) => notice.id),
      ...left.flatMap((notice) => (answered.has(notice.id) ? [notice.id] : [])),
    ];
    const took = { notes: [...notes()], answered: [...answered] };
    answered.clear();
    clearNotes();
    const facts = {
      plan: unitContext().plan,
      recordedAnswer: (id: string) => record.recordedAnswer(id),
      disputeOf: (id: string) => record.disputeOf(id),
      packageCompletions: record.packageCompletions,
    };
    // Refusals under two of the course view's proposals are told as one.
    // Two record facts are each told, however alike their words.
    const said: string[] = [];
    for (const notice of notices) {
      const text = noticeText(notice, facts);
      if (text === undefined) continue;
      if (!said.includes(text) || RECORD_FACT[notice.kind]) {
        said.push(text);
      }
    }
    said.push(...took.notes);
    const decisions = record.pendingStyleDecisions;
    const answers = record.pendingCurriculumDecisions;
    // A turn composed twice before it is sent carries what both took.
    const before = inHeader;
    const { testOut } = record.position;
    // The tutor's owed word on the test is asked for here unless a turn of
    // its own, which acknowledges itself, is queued to ask for it.
    const asksSummary =
      testOut?.stage === "result" &&
      testOut.summaryOwed === true &&
      !summaryQueued();
    inHeader = {
      style: decisions,
      curriculum: answers,
      notices: [...new Set([...(before?.notices ?? []), ...carried])],
      notes: [...(before?.notes ?? []), ...took.notes],
      answered: [...(before?.answered ?? []), ...took.answered],
      summary: before?.summary === true || asksSummary,
      sent: false,
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
      ...(record.testedOut ? { testedOut: true as const } : {}),
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
      ...(asksSummary ? { testSummaryOwed: true as const } : {}),
      misconceptions: kept.misconceptions,
      ...(kept.note === undefined ? {} : { handoffNote: kept.note }),
    };
  }

  return {
    where,
    waits: (match) =>
      record.tutorNotices.some(
        (notice) => !noticesTaken.has(notice.id) && match(notice),
      ),
    joined,
    fallBack,
    plannerRefused() {
      const unanswered = waitingNotices("planner-blocked").some(
        (id) => !answered.has(id),
      );
      if (unanswered) return Promise.resolve();
      // The tool that was refused holds the chat's queue.
      return record
        .keepNotice({ kind: "planner-blocked" })
        .catch((error: unknown) => {
          console.error("The tutor's notice could not be saved:", error);
        });
    },
    plannerAnswered() {
      for (const id of waitingNotices("planner-blocked")) answered.add(id);
    },
    turnSent() {
      const header = inHeader;
      if (header === undefined) return;
      header.sent = true;
      if (header.notices.length > 0) {
        header.delivered = takeNotices(header.notices);
      }
    },
    async turnEnded(outcome) {
      // Sampled before waiting on the writes below: a close that starts
      // later did not cut this turn off.
      const closed = closing();
      const ended = inHeader;
      inHeader = undefined;
      if (ended === undefined) return;
      if (!ended.sent) {
        // Ahead of any added since, as the header would have said them.
        const held = notes();
        held.unshift(...ended.notes.filter((note) => !held.includes(note)));
        for (const id of ended.answered) answered.add(id);
        return;
      }
      await ended.delivered;
      if (
        outcome === "done" &&
        (ended.style.length > 0 || ended.curriculum.length > 0)
      ) {
        await exclusive(() => record.deliverDecisions(ended));
      }
      // A learner's Stop once the tutor had it ends what was owed, as they
      // chose; a failure, or a close that cut the turn off, however the
      // backend ends it then, leaves it for the next turn, or for reopening.
      if (
        ended.summary &&
        !closed &&
        (outcome === "done" || outcome === "interrupted")
      ) {
        await exclusive(() => record.testSummaryGiven()).catch(
          (error: unknown) => {
            console.error(
              "The tutor's word on the test could not be saved:",
              error,
            );
          },
        );
      }
    },
  };
}

/** Whether a notice of each kind states a fact of the record. */
const RECORD_FACT: Record<TutorNotice["kind"], boolean> = {
  override: false,
  "unshown-lecture": false,
  "planner-blocked": false,
  dispute: true,
  "assessment-end": true,
  "test-answered": true,
  packages: true,
};
