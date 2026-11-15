// Where the learner stands on each objective and unit. Status is derived from
// the evidence (src/server/record/status.ts) and never stored, so it cannot
// disagree with it (architecture.md section 3). The rules are in
// docs/decisions.md, "Objective status". Retained and slipping need the unit
// gate and join in stage 5.

import { z } from "zod";

export const ObjectiveStatus = z.enum([
  /** No answer names it and no override covers it. */
  "not-started",
  /** Answered, but not passed and not overridden. */
  "attempted",
  "passed",
  /** The learner moved on without passing it. */
  "overridden",
]);
export type ObjectiveStatus = z.infer<typeof ObjectiveStatus>;

export const UnitStatus = z.enum([
  "not-started",
  "in-progress",
  /** Finished, every objective passed. */
  "passed",
  /** Finished, every objective passed or overridden, and not all passed. */
  "overridden",
]);
export type UnitStatus = z.infer<typeof UnitStatus>;
