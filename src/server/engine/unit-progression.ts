// Drives the steps owed after a recorded answer. UnitRecord commits the
// checkpoint with the position that owns it; the tutor's existing queue
// runs feedback and rechecks that a requested question is still needed.

import type {
  AssessmentRun,
  OpenQuestion,
  UnitPosition,
} from "../../shared/state.ts";
import { nextInRun } from "./assessment-rules.ts";
import type { Turn } from "./conversation.ts";
import type { Answered, UnitRecord } from "./unit-record.ts";
import {
  answerTurn,
  checkGoesOnTurn,
  nextQuestionTurn,
  runTurn,
  type Where,
} from "./unit-turns.ts";

type Checkpoint = NonNullable<UnitPosition["afterAnswer"]>;
type RunQuestion = Parameters<typeof runTurn>[1];
type CheckQuestion = "feedback" | "detour" | "review";

interface Feedback {
  number: number;
  started: boolean;
}

export interface UnitProgression {
  readonly feedback: Readonly<Feedback> | undefined;
  waitingInCheck(number: number): boolean;
  waitingInRun(run: AssessmentRun, count: number): boolean;
  askInRun(event: RunQuestion, stops?: number): void;
  answered(answer: Answered, stops?: number): Promise<void>;
  reopenRecordedAnswer(): Promise<void>;
  resume(): Promise<boolean>;
  afterReview(): Promise<void>;
  endDetour(): Promise<boolean>;
  interrupt(answerAwaitingJudge: boolean): Promise<void>;
}

/** Saved in the same write that closes a question that gets feedback. */
export function feedbackCheckpoint({
  id,
  number,
  stopAfterAnswer,
}: OpenQuestion): Checkpoint {
  return {
    questionId: id,
    number,
    step: "feedback",
    ...(stopAfterAnswer === true ? { stopAfterFeedback: true } : {}),
  };
}

/** Saved with the end of review so the resumed check can report the failure. */
export function checkpointAfterAssessment(
  { assessment, phase, afterAnswer }: UnitPosition,
  skipped: boolean,
): Checkpoint | undefined {
  if (
    !skipped &&
    assessment?.mode === "review" &&
    phase === "check" &&
    afterAnswer?.feedbackFailed === true
  ) {
    return { ...afterAnswer, step: "next" };
  }
  return undefined;
}

/** A new question or a move out of the check consumes the old checkpoint. */
export function consumesAnswerCheckpoint(
  previous: UnitPosition,
  next: UnitPosition,
): boolean {
  return (
    next.openQuestion !== undefined ||
    (next.afterAnswer === previous.afterAnswer &&
      (next.phase !== previous.phase ||
        next.assessment !== previous.assessment))
  );
}

export function createUnitProgression({
  record,
  tutor,
  where,
  exclusive,
  flush,
  stopCount,
  closing,
  checkDone,
  closeSegment,
  endRun,
  sendTestSummary,
}: {
  record: Pick<
    UnitRecord,
    | "position"
    | "finished"
    | "evidence"
    | "checkAnswers"
    | "runAnswers"
    | "recordedAnswer"
    | "closeAnswered"
    | "move"
    | "endDetour"
    | "endAssessment"
  >;
  tutor: { send(turn: Turn): void; interrupt(): Promise<void> };
  where(): Where;
  exclusive<T>(work: () => Promise<T>): Promise<T>;
  flush(): Promise<void>;
  stopCount(): number;
  closing(): boolean;
  checkDone(): boolean;
  closeSegment(): Promise<void>;
  endRun(): Promise<void>;
  sendTestSummary(text: () => string): void;
}): UnitProgression {
  // Block posting from when feedback is queued, not just when it starts.
  let feedback: Feedback | undefined;

  /** Nothing has been posted or answered in this check since question `number`. */
  function waitingInCheck(number: number): boolean {
    const { position, checkAnswers, finished } = record;
    return (
      finished === undefined &&
      position.phase === "check" &&
      position.openQuestion === undefined &&
      checkAnswers.length === number
    );
  }

  /** The same assessment still needs its next question. */
  function waitingInRun(run: AssessmentRun, count: number): boolean {
    const { position, runAnswers, finished } = record;
    return (
      (finished === undefined || run.mode === "review") &&
      position.assessment?.stage === "on" &&
      position.assessment.from === run.from &&
      position.openQuestion === undefined &&
      position.detour === undefined &&
      runAnswers.length === count
    );
  }

  function askInRun(event: RunQuestion, stops = stopCount()): void {
    const run = record.position.assessment;
    if (run?.stage !== "on") return;
    const count = record.runAnswers.length;
    tutor.send({
      skip: () => stopCount() !== stops || !waitingInRun(run, count),
      text: () => runTurn(where(), event),
    });
  }

  async function continueCheck(
    number: number,
    stops: number,
    after: CheckQuestion | undefined,
  ): Promise<void> {
    if (!waitingInCheck(number) || record.position.detour !== undefined) return;
    if (checkDone()) {
      await closeSegment();
    } else if (after !== undefined) {
      tutor.send({
        skip: () => stopCount() !== stops || !waitingInCheck(number),
        text: () =>
          after === "review"
            ? checkGoesOnTurn(where())
            : nextQuestionTurn(where(), number, after),
      });
    }
  }

  function afterReview(ask = true): Promise<void> {
    return continueCheck(
      record.checkAnswers.length,
      stopCount(),
      ask ? "review" : undefined,
    );
  }

  async function advance(pending: Checkpoint, stops: number): Promise<void> {
    if (pending.step === "feedback" || record.position.detour !== undefined)
      return;
    const { number } = pending;
    const after = pending.step === "detour-ended" ? "detour" : "feedback";
    const ask = pending.step !== "stopped";
    const run = record.position.assessment;
    if (run?.stage === "on") {
      if (!waitingInRun(run, record.runAnswers.length)) return;
      if (nextInRun(run, record.runAnswers, record.evidence) === undefined) {
        await endRun();
      } else if (ask) {
        const objective =
          after === "detour"
            ? record.recordedAnswer(pending.questionId)?.objective
            : undefined;
        askInRun(
          { after, number, ...(objective === undefined ? {} : { objective }) },
          stops,
        );
      }
    } else {
      await continueCheck(number, stops, ask ? after : undefined);
    }
  }

  async function answered(
    { number, entry }: Answered,
    stops = stopCount(),
  ): Promise<void> {
    const run = record.position.assessment;
    const text = () => answerTurn(where(), entry, number);
    if (
      entry.assessment !== undefined &&
      run?.stage === "on" &&
      run.mode === "test-out"
    ) {
      // The test moves straight to another question or its summary, without
      // feedback or a detour. Stop cancels only the next question.
      if (nextInRun(run, record.runAnswers, record.evidence) === undefined) {
        await record.endAssessment(false);
        sendTestSummary(text);
      } else {
        const count = record.runAnswers.length;
        tutor.send({
          skip: () => stopCount() !== stops || !waitingInRun(run, count),
          text,
        });
      }
      return;
    }

    const questionId = entry.answer.questionId;
    const queued = { number, started: false };
    feedback = queued;
    tutor.send({
      started: () => {
        queued.started = true;
      },
      text,
      async beforeEnd(outcome) {
        if (closing()) return "interrupted";
        // Save the feedback text first, then its outcome before turn_end.
        await flush();
        return exclusive(async () => {
          if (closing()) return "interrupted";
          const { afterAnswer: pending, ...rest } = record.position;
          if (pending?.questionId !== questionId || pending.step !== "feedback")
            return outcome;
          if (rest.detour !== undefined && outcome !== "error") {
            await record.move(rest);
            return outcome;
          }
          const stopped =
            outcome === "interrupted" ||
            pending.stopAfterFeedback === true ||
            stopCount() !== stops;
          await record.move({
            ...rest,
            afterAnswer: {
              questionId,
              number,
              step: stopped ? "stopped" : "next",
              ...(outcome === "error" ? { feedbackFailed: true } : {}),
            },
          });
          return outcome;
        });
      },
      ended: () =>
        exclusive(async () => {
          feedback = undefined;
          const pending = record.position.afterAnswer;
          if (!closing() && pending?.questionId === questionId) {
            await advance(pending, stops);
          }
        }),
    });
  }

  // All entry points that advance the record run inside `exclusive`, except
  // Stop: it interrupts the active turn immediately, then queues its write.
  return {
    get feedback() {
      return feedback;
    },
    waitingInCheck,
    waitingInRun,
    askInRun,
    afterReview,
    answered,
    // Evidence was saved, but the position still has its open question.
    async reopenRecordedAnswer(): Promise<void> {
      const saved = await record.closeAnswered();
      if (saved !== undefined) await answered(saved);
    },
    async resume(): Promise<boolean> {
      const pending = record.position.afterAnswer;
      if (pending === undefined) return false;
      if (pending.step === "feedback") {
        const entry = record.recordedAnswer(pending.questionId);
        if (entry === undefined)
          throw new Error("Feedback is missing its recorded answer.");
        await answered({ number: pending.number, entry });
      } else if (
        record.position.assessment === undefined &&
        pending.feedbackFailed === true &&
        record.recordedAnswer(pending.questionId)?.assessment?.mode === "review"
      ) {
        await afterReview(pending.step !== "stopped");
      } else {
        await advance(pending, stopCount());
      }
      return true;
    },
    async endDetour(): Promise<boolean> {
      const { detour, afterAnswer } = record.position;
      if (detour === undefined) return false;
      const stops = stopCount();
      await record.endDetour({
        questionId: detour.questionId,
        number: detour.number,
        step: "detour-ended",
        ...(afterAnswer?.feedbackFailed === true
          ? { feedbackFailed: true }
          : {}),
      });
      const pending = record.position.afterAnswer;
      if (pending !== undefined) await advance(pending, stops);
      return true;
    },
    async interrupt(answerAwaitingJudge: boolean): Promise<void> {
      const { afterAnswer, openQuestion, assessment } = record.position;
      const questionId = afterAnswer?.questionId ?? openQuestion?.id;
      const feedbackStarted = feedback?.started === true;
      const awaitingJudge =
        answerAwaitingJudge &&
        !(assessment?.stage === "on" && assessment.mode === "test-out");
      const interrupted = tutor.interrupt();
      if (
        questionId === undefined ||
        (afterAnswer === undefined && !awaitingJudge)
      ) {
        await interrupted;
        return;
      }
      const saved = exclusive(async () => {
        const { afterAnswer: pending, ...rest } = record.position;
        if (pending?.questionId === questionId) {
          if (pending.step === "feedback" && !feedbackStarted) {
            if (!pending.stopAfterFeedback) {
              await record.move({
                ...rest,
                afterAnswer: { ...pending, stopAfterFeedback: true },
              });
            }
          } else if (pending.step !== "stopped") {
            await record.move({
              ...rest,
              afterAnswer: { ...pending, step: "stopped" },
            });
          }
        } else if (
          rest.openQuestion?.id === questionId &&
          rest.openQuestion.answer !== undefined &&
          !rest.openQuestion.stopAfterAnswer
        ) {
          await record.move({
            ...rest,
            openQuestion: { ...rest.openQuestion, stopAfterAnswer: true },
          });
        }
      });
      await Promise.all([interrupted, saved]);
    },
  };
}
