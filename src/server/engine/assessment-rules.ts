// How an assessment asks (docs/decisions.md, "Mastery loop"): review at the
// start of a sitting, for now. Pure, as check-rules.ts is: the chat keeps
// the evidence and passes it in.
//
// Each objective gets one question, in the assessment's order. A correct
// answer ends its questions. A miss opens a detour; when the learner ends
// it, the objective is asked once more, and the assessment then moves on
// whatever the answer: a second miss opens its detour too, and no third
// question follows. A disputed answer counts with its dispute's verdict.

import type { AnswerEvidence, EvidenceEntry } from "../../shared/evidence.ts";
import type { AssessmentRun } from "../../shared/state.ts";
import { countedAnswers } from "../record/disputes.ts";

/** Where one objective stands in the assessment under way. */
export type RunObjective =
  | { state: "unasked" }
  /** Missed at its first question: after the detour, one more question. */
  | { state: "again" }
  /** Asked all it will be: answered correctly, or asked a second time after a miss. */
  | { state: "done"; asked: number; missed: boolean };

/**
 * @param answers the answers given in the assessment, in order, as recorded
 * @param evidence the evidence on its objectives, with the disputes of their answers
 */
export function runObjective(
  objective: string,
  answers: readonly AnswerEvidence[],
  evidence: readonly EvidenceEntry[],
): RunObjective {
  const given = countedAnswers(
    answers.filter((a) => a.objective === objective),
    evidence,
  );
  const first = given[0];
  if (first === undefined) return { state: "unasked" };
  const missed = given.some((a) => a.verdict !== "correct");
  if (first.verdict === "correct" || given.length >= 2) {
    return { state: "done", asked: given.length, missed };
  }
  return { state: "again" };
}

/** A question the assessment asks. */
export interface RunStep {
  /** Its objective's place in the assessment, from 0. */
  index: number;
  unit: string;
  objective: string;
  /** The second question on its objective, after a miss. */
  second: boolean;
}

/** The question the assessment asks next, or undefined once it has asked all it will. */
export function nextInRun(
  run: AssessmentRun,
  answers: readonly AnswerEvidence[],
  evidence: readonly EvidenceEntry[],
): RunStep | undefined {
  for (const [index, { unit, objective }] of run.objectives.entries()) {
    const standing = runObjective(objective, answers, evidence);
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
