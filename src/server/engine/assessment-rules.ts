// How an assessment asks: review at the
// start of a sitting, the unit's gate, and the test before a unit is
// taught. Pure, as check-rules.ts is: the chat keeps the evidence and
// passes it in.
//
// Each objective gets one question, in the assessment's order. In a review
// or a gate, a correct answer ends its questions. A miss opens a detour;
// when the learner ends it, the objective is asked once more, and the
// assessment then moves on whatever the answer: a second miss opens its
// detour too, and no third question follows.
//
// A test has no feedback and no detour. A correct answer that passes its
// objective alone (at 90% or 100%, without help) ends its questions; any
// other correct answer gets a second question at once, so the passing
// rule decides what the learner can skip; a miss ends them.
//
// A disputed answer counts with its dispute's verdict.

import type { TestShown } from "../../shared/events.ts";
import type {
  AnswerEvidence,
  AssessmentMode,
  EvidenceEntry,
} from "../../shared/evidence.ts";
import { isConfident } from "../../shared/question.ts";
import type { AssessmentRun } from "../../shared/state.ts";
import { hasPassed } from "../../shared/status.ts";
import { countedAnswers } from "../record/disputes.ts";
import { objectiveStatus } from "../record/status.ts";

/** Where one objective stands in the assessment under way. */
export type RunObjective =
  | { state: "unasked" }
  /**
   * One more question follows: in a review or a gate after a miss at its
   * first, once its detour ends; in a test at once, after a correct answer
   * that does not pass alone.
   */
  | { state: "again" }
  /**
   * Asked all it will be: answered correctly, or asked a second time; in a
   * test, missed at its first question too.
   */
  | { state: "done"; asked: number; missed: boolean };

/**
 * @param answers the answers given in the assessment, in order, as recorded
 * @param evidence the evidence on its objectives, with the disputes of their answers
 */
export function runObjective(
  objective: string,
  answers: readonly AnswerEvidence[],
  evidence: readonly EvidenceEntry[],
  mode: AssessmentMode,
): RunObjective {
  const given = countedAnswers(
    answers.filter((a) => a.objective === objective),
    evidence,
  );
  const first = given[0];
  if (first === undefined) return { state: "unasked" };
  const missed = given.some((a) => a.verdict !== "correct");
  const done = { state: "done" as const, asked: given.length, missed };
  if (given.length >= 2) return done;
  if (mode === "test-out") {
    return first.verdict === "correct" && !passesAlone(first)
      ? { state: "again" }
      : done;
  }
  return first.verdict === "correct" ? done : { state: "again" };
}

/** A correct answer that passes an objective never missed by itself: unassisted, at 90% or 100%. */
function passesAlone(answer: AnswerEvidence): boolean {
  return (
    !answer.assisted &&
    answer.answer.kind !== "unknown" &&
    isConfident(answer.answer.confidence)
  );
}

/** A question the assessment asks. */
export interface RunStep {
  /** Its objective's place in the assessment, from 0. */
  index: number;
  unit: string;
  objective: string;
  /** The second question on its objective (`again` in its standing). */
  second: boolean;
}

/** The question the assessment asks next, or undefined once it has asked all it will. */
export function nextInRun(
  run: AssessmentRun,
  answers: readonly AnswerEvidence[],
  evidence: readonly EvidenceEntry[],
): RunStep | undefined {
  for (const [index, { unit, objective }] of run.objectives.entries()) {
    const standing = runObjective(objective, answers, evidence, run.mode);
    if (standing.state !== "done") {
      return { index, unit, objective, second: standing.state === "again" };
    }
  }
  return undefined;
}

/**
 * The answers given in the assessment: the entries of the log after where
 * it began that name its mode and the unit whose thread holds it.
 */
export function answersInRun(
  log: readonly EvidenceEntry[],
  run: AssessmentRun,
  unitId: string,
): AnswerEvidence[] {
  if (run.from === undefined) return [];
  return log
    .slice(run.from)
    .filter(
      (e): e is AnswerEvidence =>
        e.kind === "answer" &&
        e.assessment?.mode === run.mode &&
        e.assessment.unit === unitId,
    );
}

/** The assessment's objectives with an answer recorded in it, in its order. */
export function answeredInRun(
  run: AssessmentRun,
  answers: readonly AnswerEvidence[],
): string[] {
  const answered = new Set(answers.map((a) => a.objective));
  return run.objectives
    .map((o) => o.objective)
    .filter((id) => answered.has(id));
}

/**
 * What the test before the unit showed on each of its `objectives`, in
 * their order: whether each has passed, and the test's answers on it as
 * they count. A unit is tested once, before it starts, so its test's
 * answers are those that name the test and the unit.
 *
 * @param evidence the evidence on the unit's objectives, with the disputes of their answers
 */
export function testShowed(
  objectives: readonly string[],
  evidence: readonly EvidenceEntry[],
  unitId: string,
): TestShown[] {
  const inTest = evidence.filter(
    (e): e is AnswerEvidence =>
      e.kind === "answer" &&
      e.assessment?.mode === "test-out" &&
      e.assessment.unit === unitId,
  );
  return objectives.map((objective) => ({
    objective,
    passed: hasPassed(objectiveStatus(evidence, objective)),
    answers: countedAnswers(
      inTest.filter((a) => a.objective === objective),
      evidence,
    ).map((a) => ({
      verdict: a.verdict,
      ...(a.answer.kind === "unknown"
        ? {}
        : { confidence: a.answer.confidence }),
      assisted: a.assisted,
    })),
  }));
}
