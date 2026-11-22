// Changing a course's curriculum after approval (brief.md, "How a course
// runs"): the tutor proposes the whole revised unit list with
// `amend_curriculum`, the page shows it on a card with what changed marked,
// and only the learner's Apply writes curriculum.json. A unit the learner
// has started or finished stays, with its id, since its plan, position and
// evidence name it.

import { z } from "zod";
import { Timestamp } from "./course.ts";
import { changedUnits, type StoredUnit, Unit, Units } from "./curriculum.ts";
import type { State } from "./state.ts";

/** What the tutor gives `amend_curriculum`. */
export const CurriculumChangeInput = z.object({
  units: Units.describe(
    "The whole curriculum as it would be after the change, in the order " +
      "the learner should see it: every unit you keep, with its id, title, " +
      "goal, prerequisites and sections unchanged unless the change is to " +
      "them, and each new unit. A unit the learner has started or finished " +
      "must stay, with its id.",
  ),
  why: z
    .string()
    .trim()
    .min(1)
    .max(300)
    .describe(
      "One sentence to the learner on why: what they asked for, or what " +
        "their answers or a detour showed.",
    ),
});
export type CurriculumChangeInput = z.infer<typeof CurriculumChangeInput>;

/**
 * A change waiting for the learner's answer, kept in the unit's position in
 * state.json, so a restart shows its card again.
 */
export const CurriculumChange = z.object({
  /** The id the page answers it by. */
  id: z.string().min(1),
  /** The units as they would be, without plans. */
  units: Units,
  /** The units it would replace, as they were when it was proposed. */
  was: z.array(Unit),
  why: z.string().min(1),
  proposedAt: Timestamp,
});
export type CurriculumChange = z.infer<typeof CurriculumChange>;

/**
 * How a proposed change ended. "kept": the learner kept the current
 * curriculum; "withdrawn": the unit ended with the proposal still waiting;
 * "replaced": the course's planner proposed another in its place (task 5.38).
 */
export const CurriculumChangeOutcome = z.enum([
  "applied",
  "kept",
  "withdrawn",
  "replaced",
]);
export type CurriculumChangeOutcome = z.infer<typeof CurriculumChangeOutcome>;

/** The learner's answer to a proposed change, as the page posts it. */
export const CurriculumChangeAnswer = z.object({
  proposalId: z.string().min(1),
});
export type CurriculumChangeAnswer = z.infer<typeof CurriculumChangeAnswer>;

/** A learner's answer, kept until it has reached the tutor. */
export const CurriculumDecision = CurriculumChangeAnswer.extend({
  outcome: z.enum(["applied", "kept"]),
});
export type CurriculumDecision = z.infer<typeof CurriculumDecision>;

/** The unit as a proposal gives it: without its plan, and an empty list of sections left out. */
export function withoutPlan({
  id,
  title,
  goal,
  prerequisites,
  sections,
}: Unit): Unit {
  return {
    id,
    title,
    goal,
    prerequisites,
    ...(sections === undefined || sections.length === 0 ? {} : { sections }),
  };
}

/** Whether the curriculum's units are these, in this order, plans aside. */
export function sameUnits(
  current: readonly Unit[],
  proposed: readonly Unit[],
): boolean {
  return (
    JSON.stringify(current.map(withoutPlan)) ===
    JSON.stringify(proposed.map(withoutPlan))
  );
}

type UnitChangeMark = "New" | "Changed" | "Moved" | "Changed, moved";

/**
 * Marks new units, edits and changes in the relative order of kept units.
 * Dropped units are listed in their old order.
 */
export function compareUnits(
  was: readonly Unit[],
  units: readonly Unit[],
): {
  marks: Map<string, UnitChangeMark>;
  dropped: Unit[];
} {
  const after = new Set(units.map((u) => u.id));
  const ranks = new Map<string, number>();
  const dropped: Unit[] = [];
  for (const unit of was) {
    if (after.has(unit.id)) ranks.set(unit.id, ranks.size);
    else dropped.push(unit);
  }
  const edited = changedUnits(units, was);
  const marks = new Map<string, UnitChangeMark>();
  let nextRank = 0;
  for (const { id } of units) {
    const oldRank = ranks.get(id);
    if (oldRank === undefined) {
      marks.set(id, "New");
      continue;
    }
    const moved = oldRank !== nextRank++;
    if (edited.has(id)) marks.set(id, moved ? "Changed, moved" : "Changed");
    else if (moved) marks.set(id, "Moved");
  }
  return { marks, dropped };
}

/**
 * Why the change cannot be made, if it drops a unit that has started (it
 * has a plan, a position, or was tested out of) or finished. A changed id
 * drops the unit with the old one.
 */
export function droppedStarted(
  current: readonly StoredUnit[],
  proposed: readonly Unit[],
  state: Pick<State, "units" | "testedOut">,
): string | undefined {
  const kept = new Set(proposed.map((u) => u.id));
  const dropped = current.filter(
    (u) =>
      !kept.has(u.id) &&
      (u.plan !== undefined ||
        Object.hasOwn(state.units, u.id) ||
        Object.hasOwn(state.testedOut ?? {}, u.id)),
  );
  if (dropped.length === 0) return undefined;
  const named = dropped.map((u) => {
    const where = Object.hasOwn(state.units, u.id)
      ? "is in progress"
      : "has been started";
    return `Unit "${u.id}" ("${u.title}") ${where}`;
  });
  return (
    `${named.join("; ")}, so a change must keep ` +
    `${dropped.length === 1 ? "it" : "them"}, with the same id.`
  );
}

/** The proposed units as curriculum.json keeps them: each kept unit with its plan. */
export function withPlans(
  current: readonly StoredUnit[],
  proposed: readonly Unit[],
): StoredUnit[] {
  const plans = new Map(current.map((u) => [u.id, u.plan]));
  return proposed.map((unit) => {
    const plan = plans.get(unit.id);
    return plan === undefined
      ? withoutPlan(unit)
      : { ...withoutPlan(unit), plan };
  });
}
