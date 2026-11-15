// curriculum.json: a course's units, what each builds on, and one goal per
// unit, plus whether the learner has approved it (architecture.md section 3).
// A unit gains its objectives and segments when it is planned (stage 2), and
// the source sections it teaches in stage 4.
//
// The field descriptions are written for the tutor, which proposes units
// through a teaching tool (task 1.4), and so are the error messages: a
// refused proposal sends them back to it.

import { z } from "zod";
import { Slug, Timestamp } from "./course.ts";

export const Unit = z.object({
  id: Slug.describe(
    'A short id for the unit, unique in this curriculum, such as "chain-rule". Keep it unchanged when revising the unit.',
  ),
  title: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .describe("The unit's title, in a few words"),
  goal: z
    .string()
    .trim()
    .min(1)
    .max(400)
    .describe(
      "The one thing the learner can do after the unit, in one sentence",
    ),
  prerequisites: z
    .array(Slug)
    .describe(
      "The ids of the units this one builds on directly. Empty for a unit that starts the course.",
    ),
});
export type Unit = z.infer<typeof Unit>;

/**
 * The units in the order they are shown. Prerequisites must name units in
 * the list and must not form a cycle; they need not come earlier in it.
 */
export const Units = z
  .array(Unit)
  .min(1)
  .describe("The units, in the order the learner should see them")
  .superRefine((units, ctx) => {
    const indexById = new Map<string, number>();
    units.forEach((unit, i) => {
      if (indexById.has(unit.id)) {
        ctx.addIssue({
          code: "custom",
          path: [i, "id"],
          message: `"${unit.id}" is the id of more than one unit. Give each unit its own.`,
        });
      } else {
        indexById.set(unit.id, i);
      }
    });

    units.forEach((unit, i) => {
      unit.prerequisites.forEach((id, j) => {
        if (unit.prerequisites.indexOf(id) < j) {
          ctx.addIssue({
            code: "custom",
            path: [i, "prerequisites", j],
            message: `"${unit.id}" lists "${id}" more than once as a prerequisite.`,
          });
        } else if (!indexById.has(id)) {
          ctx.addIssue({
            code: "custom",
            path: [i, "prerequisites", j],
            message: `"${unit.id}" builds on "${id}", which is not a unit in this curriculum.`,
          });
        }
      });
    });

    // With two units sharing an id, which one a prerequisite means is unclear.
    if (indexById.size < units.length) return;

    const cycle = findCycle(units);
    const [first] = cycle ?? [];
    if (cycle === undefined || first === undefined) return;
    const steps = cycle.map(
      (link) => `"${link.unit}" builds on "${link.prerequisite}"`,
    );
    ctx.addIssue({
      code: "custom",
      path: [first.at, "prerequisites", first.slot],
      message: `The prerequisites form a cycle: ${steps.join(", ")}. A unit cannot build on itself, directly or through other units.`,
    });
  });

export const CurriculumApproval = z.discriminatedUnion("status", [
  /** Proposed by the tutor and awaiting the learner's review. */
  z.object({ status: z.literal("draft") }),
  /** Approved by the learner, so its units can start. */
  z.object({ status: z.literal("approved"), approvedAt: Timestamp }),
]);
export type CurriculumApproval = z.infer<typeof CurriculumApproval>;

export const Curriculum = z.object({
  approval: CurriculumApproval,
  units: Units,
});
export type Curriculum = z.infer<typeof Curriculum>;

/** One prerequisite entry: `units[at].prerequisites[slot]`. */
interface Link {
  at: number;
  slot: number;
  unit: string;
  prerequisite: string;
}

/**
 * One cycle in the prerequisites, as the links that make it up: each leads
 * to the unit the next one leaves. It starts at the unit that comes first in
 * the list, so the same curriculum always reports the same cycle.
 * Prerequisites that name no unit are skipped. The unit ids must be unique.
 */
function findCycle(units: readonly Unit[]): Link[] | undefined {
  const byId = new Map(units.map((unit, at) => [unit.id, { at, unit }]));
  const state = new Map<number, "open" | "done">();
  /** The links from the unit the search started at to the one it is in. */
  const trail: Link[] = [];

  const visit = (at: number, unit: Unit): Link[] | undefined => {
    state.set(at, "open");
    for (const [slot, prerequisite] of unit.prerequisites.entries()) {
      const next = byId.get(prerequisite);
      if (next === undefined || state.get(next.at) === "done") continue;
      const link = { at, slot, unit: unit.id, prerequisite };
      if (state.get(next.at) === "open") {
        // `next` is on the trail, or is this unit: the link closes a loop.
        const start = trail.findIndex((l) => l.at === next.at);
        return [...(start < 0 ? [] : trail.slice(start)), link];
      }
      trail.push(link);
      const found = visit(next.at, next.unit);
      if (found !== undefined) return found;
      trail.pop();
    }
    state.set(at, "done");
    return undefined;
  };

  for (const [at, unit] of units.entries()) {
    if (state.has(at)) continue;
    const cycle = visit(at, unit);
    if (cycle === undefined) continue;
    const ats = cycle.map((link) => link.at);
    const start = ats.indexOf(Math.min(...ats));
    return [...cycle.slice(start), ...cycle.slice(0, start)];
  }
  return undefined;
}
