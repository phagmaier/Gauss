// Where the learner stands on each objective and unit. Status is derived from
// the evidence (src/server/record/status.ts) and never stored, so it cannot
// disagree with it (architecture.md section 3). The rules are in
// docs/decisions.md, "Objective status" and "Mastery loop".

import { z } from "zod";

export const ObjectiveStatus = z.enum([
  /** No answer names it and no override covers it. */
  "not-started",
  /** Answered, but not passed, slipping or overridden. */
  "attempted",
  /** Passed, with no answer given in a review or a gate to confirm it. */
  "passed",
  /** Passed, and confirmed since its last miss by an answer given in a review or a gate. */
  "retained",
  /** It had passed, was then missed in a review or a gate, and has not passed again. Not passed. */
  "slipping",
  /** The learner moved on without passing it. */
  "overridden",
]);
export type ObjectiveStatus = z.infer<typeof ObjectiveStatus>;

/** Whether the objective counts as passed: passed, or retained. Slipping does not. */
export function hasPassed(status: ObjectiveStatus): boolean {
  return status === "passed" || status === "retained";
}

export const UnitStatus = z.enum([
  "not-started",
  "in-progress",
  /** Finished, every objective passed; some may be slipping since. */
  "passed",
  /** Finished, every objective passed or overridden, and not all passed. */
  "overridden",
]);
export type UnitStatus = z.infer<typeof UnitStatus>;

/** Whether the unit is finished: passed, or overridden. */
export function isFinished(status: UnitStatus): boolean {
  return status === "passed" || status === "overridden";
}
