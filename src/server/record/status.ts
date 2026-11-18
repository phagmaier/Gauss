// Objective and unit status, derived from the evidence log and never stored
// (architecture.md section 3). Pure: the caller reads the record. The rules,
// with the reasons for them, are in docs/decisions.md, "Objective status"
// and, for retained and slipping, "Mastery loop". A disputed answer counts
// with its dispute's verdict (disputes.ts).

import type { StoredUnit } from "../../shared/curriculum.ts";
import type {
  AnswerEvidence,
  DisputeEvidence,
  EvidenceEntry,
} from "../../shared/evidence.ts";
import { isConfident, type Question } from "../../shared/question.ts";
import type { UnitPosition } from "../../shared/state.ts";
import {
  hasPassed,
  type ObjectiveStatus,
  type UnitStatus,
} from "../../shared/status.ts";
import { countedEvidence } from "./disputes.ts";

/**
 * One objective's status. The evidence is read in log order, the order it
 * was recorded in, whatever its timestamps say, each disputed answer with
 * its dispute's verdict (task 3.8).
 *
 * - A miss (a wrong answer or "I don't know", with help or without) clears
 *   the correct answers before it. A miss while testing out is not one: it
 *   counts as an answer, and changes nothing else.
 * - The objective passes once, since its last miss, it has unassisted
 *   correct answers to two different questions, at any confidence; or, if
 *   it was never missed, one unassisted correct answer given at 90% or
 *   100% (task 2.23).
 * - A correct answer given with help counts for nothing either way.
 * - Passed, it is retained if one of those answers was given in a review or
 *   a gate.
 * - Missed in a review or a gate while it was passed, it is slipping until
 *   it passes again.
 * - An override marks it overridden, but never takes away a pass. A later
 *   answer takes the override's place.
 */
export function objectiveStatus(
  evidence: readonly EvidenceEntry[],
  objective: string,
): ObjectiveStatus {
  return standing(evidence, objective).status;
}

/**
 * The answers that pass the objective, if it is passed or retained: its
 * unassisted correct answers since its last miss, each counted with its
 * dispute's verdict, in log order. None if it is not passed.
 */
export function passingAnswers(
  evidence: readonly EvidenceEntry[],
  objective: string,
): AnswerEvidence[] {
  const { status, since } = standing(evidence, objective);
  return hasPassed(status) ? since : [];
}

/** The objective's status, and its unassisted correct answers since its last miss. */
function standing(
  evidence: readonly EvidenceEntry[],
  objective: string,
): { status: ObjectiveStatus; since: AnswerEvidence[] } {
  let answered = false;
  let missed = false;
  let overridden = false;
  /** The answers correct without help since the last miss. */
  let since: AnswerEvidence[] = [];
  /** Whether it was passed when it was last missed, and missed in a review or a gate. */
  let slipped = false;
  const passes = () =>
    new Set(since.map((e) => problemOf(e.question))).size >= 2 ||
    (!missed && since.some(confident));

  for (const entry of countedEvidence(evidence)) {
    if (entry.kind === "override") {
      if (entry.objectives.includes(objective)) overridden = true;
      continue;
    }
    if (entry.objective !== objective) continue;
    answered = true;
    overridden = false;
    const mode = entry.assessment?.mode;
    if (entry.verdict !== "correct") {
      if (mode === "test-out") continue;
      if (passes()) slipped = mode === "review" || mode === "gate";
      missed = true;
      since = [];
    } else if (!entry.assisted) {
      since.push(entry);
    }
  }

  const status: ObjectiveStatus = passes()
    ? since.some(cold)
      ? "retained"
      : "passed"
    : overridden
      ? "overridden"
      : slipped
        ? "slipping"
        : answered
          ? "attempted"
          : "not-started";
  return { status, since };
}

/** Whether the answer was given at 90% or 100%. */
function confident(entry: AnswerEvidence): boolean {
  return (
    entry.answer.kind !== "unknown" && isConfident(entry.answer.confidence)
  );
}

/** Whether the answer was given in a review or a gate. */
function cold(entry: AnswerEvidence): boolean {
  const mode = entry.assessment?.mode;
  return mode === "review" || mode === "gate";
}

/**
 * A unit's status. A unit with a position in `state.json` is in progress.
 * Otherwise its objectives decide: none with evidence, or no plan, is not
 * started; all passed (retained or slipping since) is passed; all passed or
 * overridden is overridden; anything else is still in progress.
 */
export function unitStatus(
  unit: StoredUnit,
  evidence: readonly EvidenceEntry[],
  position: UnitPosition | undefined,
): UnitStatus {
  if (position !== undefined) return "in-progress";
  const statuses = (unit.plan?.objectives ?? []).map((o) =>
    objectiveStatus(evidence, o.id),
  );
  return unitStatusFromObjectives(statuses);
}

/** Derives the status of a unit with no position from its objective statuses. */
export function unitStatusFromObjectives(
  statuses: readonly ObjectiveStatus[],
): UnitStatus {
  const passedOnce = (s: ObjectiveStatus) => hasPassed(s) || s === "slipping";
  if (statuses.every((s) => s === "not-started")) return "not-started";
  if (statuses.every(passedOnce)) return "passed";
  if (statuses.every((s) => passedOnce(s) || s === "overridden"))
    return "overridden";
  return "in-progress";
}

/**
 * What the learner was asked, so that a question posted twice counts as one
 * problem. Spacing is ignored; the grading material is not part of it.
 */
function problemOf(question: Question): string {
  const text = (s: string) => s.trim().replace(/\s+/g, " ");
  switch (question.kind) {
    case "choice":
      return JSON.stringify([question.prompt, ...question.choices].map(text));
    case "math":
    case "written":
      return JSON.stringify([question.kind, text(question.prompt)]);
    case "code":
      return JSON.stringify([
        question.kind,
        text(question.prompt),
        ...question.files.toSorted(),
      ]);
  }
}

/**
 * Whether the dispute takes the pass from the objective, leaving it
 * attempted: passed, retained or slipping before, it has then never passed.
 * In a finished unit the objective is then recorded as overridden with the
 * dispute (task 3.8): the learner moved on from it when the unit ended, and
 * a finished unit is not started again.
 */
export function takesPass(
  evidence: readonly EvidenceEntry[],
  dispute: DisputeEvidence,
  objective: string,
): boolean {
  const before = objectiveStatus(evidence, objective);
  return (
    (hasPassed(before) || before === "slipping") &&
    objectiveStatus([...evidence, dispute], objective) === "attempted"
  );
}
