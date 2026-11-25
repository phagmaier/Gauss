// How an assessment asks: review at the
// start of a sitting, the unit's gate, the test before a unit is
// taught, and a self-test the learner sets up. Pure, as check-rules.ts is:
// the chat keeps the evidence and passes it in.
//
// Each objective gets one question, in the assessment's order. In a review,
// a gate or a self-test, a correct answer ends its questions. A miss opens a
// detour; when the learner ends it, the objective is asked once more, and
// the assessment then moves on whatever the answer: a second miss opens its
// detour too, and no third question follows. In a self-test that second
// question waits until another objective has been answered since the miss,
// while another is still to ask, so that it does not follow the detour
// that worked through the miss. A self-test asks only the kinds of question
// the learner picked: the tutor may pass over an objective none of them
// fits, before its first question only, and it counts as asked, with no
// answer and no status.
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
   * One more question follows: in a review, a gate or a self-test after a
   * miss at its first, once its detour ends (in a self-test, once another
   * objective has been answered since, while another is left); in a test at
   * once, after a correct answer that does not pass alone.
   */
  | { state: "again" }
  /**
   * Asked all it will be: answered correctly, or asked a second time; in a
   * test, missed at its first question too.
   */
  | { state: "done"; asked: number; missed: boolean }
  /** In a self-test: passed over by the tutor, since no kind picked fits it; asked no more. */
  | { state: "passed-over"; reason: string };

/**
 * @param answers the answers given in the assessment, in order, as recorded
 * @param evidence the evidence on its objectives, with the disputes of their answers
 */
export function runObjective(
  objective: string,
  answers: readonly AnswerEvidence[],
  evidence: readonly EvidenceEntry[],
  run: Pick<AssessmentRun, "mode" | "passedOver">,
): RunObjective {
  const passed = run.passedOver?.find((p) => p.objective === objective);
  if (passed !== undefined) {
    return { state: "passed-over", reason: passed.reason };
  }
  const { mode } = run;
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

/**
 * The question the assessment asks next, or undefined once it has asked all
 * it will: the first objective in its order still to ask, but in a
 * self-test, a missed objective's second question waits until another
 * objective has been answered since the miss, while another is still to ask.
 */
export function nextInRun(
  run: AssessmentRun,
  answers: readonly AnswerEvidence[],
  evidence: readonly EvidenceEntry[],
): RunStep | undefined {
  const steps = run.objectives.flatMap(({ unit, objective }, index) => {
    const standing = runObjective(objective, answers, evidence, run);
    return standing.state === "done" || standing.state === "passed-over"
      ? []
      : [{ index, unit, objective, second: standing.state === "again" }];
  });
  if (run.mode !== "self-test" || steps.length <= 1) return steps[0];
  // Of two held back, the later miss was answered after the earlier one,
  // so the earliest miss is never held: some step is always found.
  return steps.find(
    (step) => !step.second || answeredSince(step.objective, answers),
  );
}

/** Whether another objective has been answered since the last answer on this one. */
function answeredSince(
  objective: string,
  answers: readonly AnswerEvidence[],
): boolean {
  const last = answers.findLastIndex((a) => a.objective === objective);
  return answers.slice(last + 1).some((a) => a.objective !== objective);
}

/**
 * Whether a run of this mode is one the learner asks for that leaves the
 * unit where it was, a review or a self-test: it goes on where the unit
 * stood once it ends, and can run in a finished unit, which stays finished.
 */
export function leavesUnitAsWas(mode: AssessmentMode | undefined): boolean {
  return mode === "review" || mode === "self-test";
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
