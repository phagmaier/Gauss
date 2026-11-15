// Objective and unit status, derived from the evidence log and never stored
// (architecture.md section 3). Pure: the caller reads the record. The rules,
// with the reasons for them, are in docs/decisions.md, "Objective status".

import type { StoredUnit } from "../../shared/curriculum.ts";
import type { EvidenceEntry } from "../../shared/evidence.ts";
import { isConfident, type Question } from "../../shared/question.ts";
import type { UnitPosition } from "../../shared/state.ts";
import type { ObjectiveStatus, UnitStatus } from "../../shared/status.ts";

/**
 * One objective's status. The evidence is read in log order, the order it
 * was recorded in, whatever its timestamps say.
 *
 * - A miss (a wrong answer or "I don't know", with help or without) clears
 *   the correct answers before it.
 * - The objective passes once, since its last miss, it has unassisted
 *   correct answers to two different questions, or one given at 90% or 100%.
 * - A correct answer given with help counts for nothing either way.
 * - An override marks it overridden, but never takes away a pass. A later
 *   answer takes the override's place.
 */
export function objectiveStatus(
  evidence: readonly EvidenceEntry[],
  objective: string,
): ObjectiveStatus {
  let answered = false;
  let overridden = false;
  /** The questions answered correctly without help since the last miss. */
  let problems = new Set<string>();
  let confident = false;

  for (const entry of evidence) {
    if (entry.kind === "override") {
      if (entry.objectives.includes(objective)) overridden = true;
      continue;
    }
    if (entry.objective !== objective) continue;
    answered = true;
    overridden = false;
    if (entry.verdict !== "correct") {
      problems = new Set();
      confident = false;
    } else if (!entry.assisted) {
      problems.add(problemOf(entry.question));
      if (
        entry.answer.kind !== "unknown" &&
        isConfident(entry.answer.confidence)
      )
        confident = true;
    }
  }

  if (confident || problems.size >= 2) return "passed";
  if (overridden) return "overridden";
  return answered ? "attempted" : "not-started";
}

/**
 * A unit's status. A unit with a position in `state.json` is in progress.
 * Otherwise its objectives decide: none with evidence, or no plan, is not
 * started; all passed is passed; all passed or overridden is overridden;
 * anything else is still in progress.
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
  if (statuses.every((s) => s === "not-started")) return "not-started";
  if (statuses.every((s) => s === "passed")) return "passed";
  if (statuses.every((s) => s === "passed" || s === "overridden"))
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
    case "written":
      return JSON.stringify(["written", text(question.prompt)]);
  }
}
