// Opening a unit, once `load` has composed it: the thread shows its status
// and phase, and the unit takes its next step, or the one that waits:
// segment 1's teaching turn, the test that is due, an assessment's next
// question, the closing card. A unit that a restart, or a closed chat, left
// under way first shows again what the record holds and the thread does not
// (a question's grade or withdrawal, a dispute's outcome, a package's or
// proposal's card), and what a restart left of the open question is settled
// (its answer recorded and not closed, its replies not judged, its answer
// not graded).
// A dispute of an answer's grade (task 3.8) is decided outside the chat
// (disputes.ts) and, when the chat is open, recorded inside its queue, so it
// lands in order with the chat's own writes; one recorded while the chat
// was not open is shown, and told, when it opens. The tutor of a unit in
// progress is told the outcome in its next header. An outcome changes no
// phase: where the check rules would decide next (the end of a detour, a
// check with nothing left to ask, the closing card), they decide with the
// corrected verdict.

// Made for each loaded unit. The chat keeps `load`'s composition and error
// path, the queue and the actions' guards, read at each call.

import type { Slug } from "../../shared/course.ts";
import type { PageEvent } from "../../shared/events.ts";
import type {
  AnswerEvidence,
  DisputeEvidence,
  OverrideEvidence,
} from "../../shared/evidence.ts";
import type { PackageCompletion } from "../../shared/packages.ts";
import type {
  AnswerSubmission,
  AssessmentHead,
} from "../../shared/question.ts";
import type {
  AssessmentRun,
  OpenQuestion,
  UnitPosition,
} from "../../shared/state.ts";
import { isLastSegment } from "./check-rules.ts";
import type { UnitProgression } from "./unit-progression.ts";
import { view } from "./unit-questions.ts";
import {
  detourEvent,
  disputedEvent,
  gradedEvent,
  type NewNotice,
  phaseEvent,
  type UnitRecord,
} from "./unit-record.ts";
import { testEndTurn, type UnitContext, type Where } from "./unit-turns.ts";

export interface UnitOpening {
  /**
   * Picks up where the record left the unit, once the chat holds it: `load`'s
   * last step. `recoveringOverride`: `load` has just finished an override a
   * restart cut off, whose write told the page of the close and the status,
   * so neither the status nor the phase is said again.
   */
  resume(recoveringOverride: boolean): Promise<void>;
  /** The body of the chat's `recordDispute`, inside its guard. */
  recordDispute(
    entry: DisputeEvidence,
  ): Promise<{ override: OverrideEvidence | undefined }>;
  /** The body of the chat's `learnDispute`, inside its guard. */
  learnDispute(
    entry: DisputeEvidence,
    override?: OverrideEvidence,
  ): Promise<void>;
  /** The body of the chat's `learnAnswer`, inside its guard. */
  learnAnswer(entry: AnswerEvidence): Promise<void>;
}

export function createUnitOpening({
  record,
  exclusive,
  emit,
  events,
  plan,
  context,
  folder,
  unitId,
  checkDone,
  closeSegment,
  sendTeaching,
  progression,
  sittingOpened,
  answers,
  end,
  where,
  assessments,
  packages,
  proposals,
}: {
  record: Pick<
    UnitRecord,
    | "position"
    | "evidence"
    | "packageCompletions"
    | "finished"
    | "testedOut"
    | "reopened"
    | "status"
    | "recordedAnswer"
    | "disputeOf"
    | "dispute"
    | "learnDispute"
    | "learnAnswer"
    | "tutorNotices"
    | "keepNotice"
  >;
  exclusive<T>(work: () => Promise<T>): Promise<T>;
  emit(event: PageEvent): void;
  /** The thread's events as they are at the call. */
  events(): readonly PageEvent[];
  /** The unit's plan as `load` read it. */
  plan: UnitContext["plan"];
  /** The unit's context, whose plan says which objectives are the unit's own. */
  context(): Pick<UnitContext, "plan">;
  /** The course's workspace, where a code question's files are. */
  folder(): string | undefined;
  unitId: Slug;
  /** Every objective of the segment is done in this check. */
  checkDone(): boolean;
  /** Closes the segment, and ends the unit after its last. Runs inside `exclusive`. */
  closeSegment(): Promise<void>;
  sendTeaching(cutOff: boolean): void;
  progression: {
    resume(): Promise<boolean>;
    reopenRecordedAnswer(): Promise<void>;
    feedback(): UnitProgression["feedback"];
  };
  /** Review admission's new sitting. */
  sittingOpened(): Promise<void>;
  answers: {
    grade(open: OpenQuestion, answer: AnswerSubmission): Promise<void>;
    settleJudging(
      open: OpenQuestion,
      learnerIds: readonly string[],
      verdict: "help",
      tell: () => void,
    ): Promise<void>;
  };
  /** The unit end's `end`, with the statuses as they now are. */
  end(): Promise<void>;
  where(): Where;
  assessments: {
    showRun(run: AssessmentRun): void;
    headOf(open: OpenQuestion): AssessmentHead | undefined;
    showTestResult(): void;
    sendTestSummary(text: () => string): void;
    goOnInRun(): Promise<void>;
    startTest(): Promise<void>;
  };
  /** The package cards replayed on reopening. */
  packages: {
    restorePackages(completions: readonly PackageCompletion[]): void;
    showUnsaved(): void;
    showWaiting(position: UnitPosition): void;
  };
  /** The proposal cards replayed on reopening. */
  proposals: {
    showAnswered(): void;
    showWaiting(position: UnitPosition): void;
  };
}): UnitOpening {
  async function resume(recoveringOverride: boolean): Promise<void> {
    restoreQuestions();
    await restoreDisputes();
    packages.restorePackages(record.packageCompletions);
    proposals.showAnswered();
    packages.showUnsaved();
    if (!recoveringOverride) emit(record.status());
    if (record.finished !== undefined) {
      if (
        record.testedOut &&
        !events().some((event) => event.type === "test_answered")
      ) {
        emit({
          type: "test_answered",
          skipped: plan.objectives.map((o) => o.id),
        });
      }
      emit({ type: "unit_closed", status: record.finished });
      // A review the learner asked for here runs on.
      const held = record.position.assessment;
      if (held !== undefined) {
        assessments.showRun(held);
        const question = await reopenAsked();
        if (!question && held.stage === "on") {
          await exclusive(async () => {
            if (!(await progression.resume())) {
              await assessments.goOnInRun();
            }
          });
        }
      }
      return;
    }
    const { position } = record;
    const phase = phaseEvent(position);
    // The record can save a test choice before the transcript gets it.
    // Restore the choice before saying where teaching resumed.
    if (
      !phase.beforeTest &&
      events().findLast(
        (e) => e.type === "test_result" || e.type === "test_answered",
      )?.type === "test_result"
    ) {
      emit({ type: "test_answered", skipped: phase.skipping ?? [] });
    }
    if (!recoveringOverride) emit(phase);
    // An assessment offered or under way says so before its question.
    if (position.assessment !== undefined) {
      assessments.showRun(position.assessment);
    }
    // A request waits on the learner, as an open question does.
    packages.showWaiting(position);
    proposals.showWaiting(position);
    const question = await reopenAsked();
    // A new sitting can open with review; the chat is new.
    await sittingOpened();
    if (question) return;
    if (record.position.afterAnswer !== undefined) {
      await exclusive(progression.resume);
      return;
    }
    const test = record.position.testOut?.stage;
    if (record.position.assessment !== undefined) {
      // The unit's steps wait for it, and a teaching turn, or the test
      // due, is sent once it ends. One reopened under way with nothing
      // open asks on.
      if (record.position.assessment.stage === "on") {
        await exclusive(() => assessments.goOnInRun());
      }
    } else if (test === "due") {
      // The test goes in place of the teaching turn.
      await exclusive(() => assessments.startTest());
    } else if (test === "result") {
      // Closing a saved answer above can end the test and schedule its
      // summary. Only recover a result that was already waiting on disk.
      if (position.testOut?.stage !== "result") return;
      // The result card waits on the learner. If a restart cut off the
      // tutor's word on the test, before the card was shown, it is asked
      // for again, and the card follows it.
      if (events().some((e) => e.type === "test_result")) {
        assessments.showTestResult();
      } else {
        const { stopped } = position.testOut;
        assessments.sendTestSummary(() =>
          testEndTurn(
            where(),
            stopped === undefined
              ? { stopped: false }
              : { stopped: true, withdrawn: stopped.withdrawn },
          ),
        );
      }
    } else if (position.phase === "teach") {
      // A teaching turn that a restart cut off is sent again.
      sendTeaching(record.reopened);
    } else if (
      position.phase === "check" &&
      position.openQuestion === undefined &&
      position.detour === undefined &&
      checkDone()
    ) {
      // A position written before afterAnswer was kept can still be done.
      await exclusive(() => closeSegment());
    } else if (position.phase === "closed" && isLastSegment(plan, position)) {
      // The closing card was waiting on the learner, or a restart came
      // between closing the last segment and closing the unit.
      await exclusive(() => end());
    }
  }

  /**
   * Shows the detour or the open question the position holds again, and
   * settles what a restart left of the question: its answer recorded and
   * not closed, its replies not judged, or its answer not graded.
   */
  async function reopenAsked(): Promise<boolean> {
    const { position } = record;
    // A detour waits on the learner, as an open question does.
    if (position.detour !== undefined) emit(detourEvent(position.detour));
    const open = position.openQuestion;
    if (open === undefined) return false;
    emit({
      type: "question",
      question: view(open, folder(), assessments.headOf(open)),
    });
    await exclusive(async () => {
      if (record.recordedAnswer(open.id) !== undefined) {
        await progression.reopenRecordedAnswer();
      } else if (open.judging !== undefined) {
        // The replies a restart kept from the judge cannot be judged
        // now, so they count as help (task 2.21), and an answer kept
        // for them is graded.
        const { judging, number } = open;
        await answers.settleJudging(open, judging, "help", () => {
          for (const learnerId of judging) {
            emit({
              type: "judged",
              learnerId,
              number,
              verdict: "help",
              unjudged: "restart",
            });
          }
        });
      } else if (open.answer !== undefined) {
        // An answer that a restart kept from its grade is graded now,
        // as a teaching turn a restart cut off is taught again.
        await answers.grade(open, open.answer);
      }
    });
    return true;
  }

  /**
   * Reconciles questions left open by the thread: restore a lost grade
   * from the evidence, or mark the question withdrawn if the position no
   * longer holds it. The question still open is handled by `reopenAsked`.
   */
  function restoreQuestions(): void {
    const posted = new Set<string>();
    const settled = new Set<string>();
    for (const event of events()) {
      if (event.type === "question") posted.add(event.question.id);
      else if (event.type === "graded" || event.type === "question_withdrawn") {
        settled.add(event.questionId);
      } else if (
        (event.type === "assessment_end" || event.type === "overridden") &&
        event.withdrawnQuestionId !== undefined
      ) {
        settled.add(event.withdrawnQuestionId);
      }
    }
    const open = record.position.openQuestion?.id;
    for (const id of posted) {
      if (id === open || settled.has(id)) continue;
      const entry = record.recordedAnswer(id);
      emit(
        entry === undefined
          ? { type: "question_withdrawn", questionId: id }
          : gradedEvent(entry),
      );
    }
  }

  /**
   * Shows the outcome of each dispute of the unit's answers that the earlier
   * sessions' thread does not: one raised from "What I know" while the chat
   * was not open, or whose line was lost. In a unit in progress, the tutor
   * is told it in its next header.
   */
  async function restoreDisputes(): Promise<void> {
    const shown = new Set<string>();
    for (const event of events()) {
      if (event.type === "disputed") shown.add(event.questionId);
    }
    const untold: DisputeEvidence[] = [];
    for (const entry of record.evidence) {
      if (entry.kind !== "dispute" || shown.has(entry.questionId)) continue;
      if (record.disputeOf(entry.questionId) !== entry) continue;
      const answered = record.recordedAnswer(entry.questionId);
      if (answered === undefined || !askedHere(answered)) continue;
      shown.add(entry.questionId);
      untold.push(entry);
    }
    if (untold.length === 0) return;
    // In one turn of the queue, so a message's header, which waits for it,
    // carries all of them or none; each kept before the thread shows it, as
    // the record does for a dispute decided while the chat is open.
    await exclusive(async () => {
      for (const entry of untold) {
        const notice = disputeNotice(entry);
        if (notice !== undefined) {
          await record.keepNotice(notice).catch((error: unknown) => {
            console.error("The tutor's notice could not be saved:", error);
          });
        }
        emit(disputedEvent(entry));
      }
    });
  }

  /**
   * The notice that tells the tutor of a unit in progress the outcome, in
   * its next header, of a dispute of an answer given in this unit's thread,
   * unless one waits already. The record keeps it before the page hears of
   * the outcome, so a thread that shows the outcome after a restart has the
   * notice too. The dispute is in the evidence before either: a restart
   * after it and before them shows it, and tells it, at the next opening.
   */
  function disputeNotice(entry: DisputeEvidence): NewNotice | undefined {
    const answered = record.recordedAnswer(entry.questionId);
    if (
      record.finished !== undefined ||
      answered === undefined ||
      !askedHere(answered) ||
      record.tutorNotices.some(
        (notice) =>
          notice.kind === "dispute" && notice.questionId === entry.questionId,
      )
    ) {
      return undefined;
    }
    return { kind: "dispute", questionId: entry.questionId };
  }

  /**
   * Whether the answer was given in this unit's thread: in an assessment it
   * held, or in a check of its own, which asks only its own objectives.
   */
  function askedHere(answered: AnswerEvidence): boolean {
    return answered.assessment === undefined
      ? context().plan.objectives.some((o) => o.id === answered.objective)
      : answered.assessment.unit === unitId;
  }

  /**
   * After a dispute's outcome is kept, with the tutor's notice of it: the
   * check rules decide with the corrected verdict where nothing else is
   * waiting for them. A check with no question open, no detour and no
   * feedback to come closes if nothing is left to ask; at the unit's end,
   * the closing card is shown again with the statuses as they are now, and
   * the unit finishes if every objective has passed. A detour stays open
   * until the learner asks for another question. Runs inside `exclusive`.
   */
  async function disputeKept(): Promise<void> {
    const { position, finished } = record;
    // An assessment's answers are its own rules', read when it next moves.
    if (finished !== undefined || position.assessment !== undefined) return;
    if (position.pendingSegmentOverride !== undefined) return;
    // The test's result card shows what passed as it now stands.
    if (position.testOut?.stage === "result") {
      assessments.showTestResult();
      return;
    }
    if (
      position.phase === "check" &&
      position.openQuestion === undefined &&
      position.detour === undefined &&
      progression.feedback() === undefined &&
      checkDone()
    ) {
      await closeSegment();
    } else if (
      position.phase === "closed" &&
      isLastSegment(context().plan, position)
    ) {
      await end();
    }
  }

  return {
    resume,
    async recordDispute(entry) {
      const override = await record.dispute(entry, disputeNotice(entry));
      await disputeKept();
      return { override };
    },
    async learnDispute(entry, override) {
      const notice = disputeNotice(entry);
      if (await record.learnDispute(entry, override, notice)) {
        await disputeKept();
      }
    },
    async learnAnswer(entry) {
      if (!record.learnAnswer(entry)) return;
      // A closing card that waits shows the statuses as they now are, and
      // so does the test's result card.
      const { position, finished } = record;
      if (finished === undefined && position.testOut?.stage === "result") {
        assessments.showTestResult();
      } else if (
        finished === undefined &&
        position.assessment === undefined &&
        position.phase === "closed" &&
        isLastSegment(context().plan, position)
      ) {
        await end();
      }
    },
  };
}
