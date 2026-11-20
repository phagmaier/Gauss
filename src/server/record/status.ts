// Objective and unit status, derived from the evidence log and never stored
// (architecture.md section 3). Pure: the caller reads the record. The rules,
// with the reasons for them, are in docs/decisions.md, "Objective status"
// and, for retained and slipping, "Mastery loop". A disputed answer counts
// with its dispute's verdict (disputes.ts).

import type { StoredUnit } from "../../shared/curriculum.ts";
import type { DisputeEvidence, EvidenceEntry } from "../../shared/evidence.ts";
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
  return statusOf(collectStandings(evidence, [objective]).get(objective));
}

interface ObjectiveStanding {
  status: ObjectiveStatus;
  /** The unassisted correct answers given in a review or a gate since the last miss. */
  row: number;
  /** When the last unassisted correct answer since the last miss was recorded, in ms; undefined if none. */
  lastCorrectAt: number | undefined;
  /**
   * One of the unassisted correct answers since the last miss was given
   * while testing out: the unit's gate leaves the objective out, since that
   * answer was cold when given (docs/decisions.md, "Mastery loop").
   */
  tested: boolean;
}

/** Derives standings for a batch of objectives in one pass over the counted log. */
export function objectiveStandings(
  evidence: readonly EvidenceEntry[],
  objectives: Iterable<string>,
): Map<string, ObjectiveStanding> {
  const result = new Map<string, ObjectiveStanding>();
  for (const [id, standing] of collectStandings(evidence, objectives)) {
    result.set(id, {
      status: statusOf(standing),
      row: standing.row,
      lastCorrectAt: standing.lastCorrectAt,
      tested: standing.tested,
    });
  }
  return result;
}

interface Standing {
  answered: boolean;
  missed: boolean;
  overridden: boolean;
  slipped: boolean;
  // Up to two distinct questions answered correctly without help since the last miss.
  problems: Set<string>;
  confident: boolean;
  tested: boolean;
  // Unassisted correct answers in a review or a gate since the last miss: retained when passed with one.
  row: number;
  lastCorrectAt: number | undefined;
}

function collectStandings(
  evidence: readonly EvidenceEntry[],
  objectives: Iterable<string>,
): Map<string, Standing> {
  const standings = new Map<string, Standing>();
  for (const id of objectives) {
    standings.set(id, {
      answered: false,
      missed: false,
      overridden: false,
      slipped: false,
      problems: new Set(),
      confident: false,
      tested: false,
      row: 0,
      lastCorrectAt: undefined,
    });
  }
  if (standings.size === 0) return standings;

  for (const entry of countedEvidence(evidence)) {
    if (entry.kind === "override") {
      for (const id of entry.objectives) {
        const standing = standings.get(id);
        if (standing !== undefined) standing.overridden = true;
      }
      continue;
    }
    const standing = standings.get(entry.objective);
    if (standing === undefined) continue;

    standing.answered = true;
    standing.overridden = false;
    const mode = entry.assessment?.mode;
    const cold = mode === "review" || mode === "gate";
    if (entry.verdict !== "correct") {
      if (mode === "test-out") continue;
      if (passes(standing)) standing.slipped = cold;
      standing.missed = true;
      standing.problems.clear();
      standing.confident = false;
      standing.tested = false;
      standing.row = 0;
      standing.lastCorrectAt = undefined;
    } else if (!entry.assisted) {
      if (standing.problems.size < 2) {
        standing.problems.add(problemOf(entry.question));
      }
      standing.tested ||= mode === "test-out";
      if (cold) standing.row += 1;
      standing.lastCorrectAt = Date.parse(entry.recordedAt);
      const { answer } = entry;
      standing.confident ||=
        answer.kind !== "unknown" && isConfident(answer.confidence);
    }
  }
  return standings;
}

function passes(standing: Standing): boolean {
  return (
    standing.problems.size >= 2 || (standing.confident && !standing.missed)
  );
}

function statusOf(standing: Standing | undefined): ObjectiveStatus {
  if (standing === undefined) return "not-started";
  if (passes(standing)) return standing.row > 0 ? "retained" : "passed";
  if (standing.overridden) return "overridden";
  if (standing.slipped) return "slipping";
  return standing.answered ? "attempted" : "not-started";
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
