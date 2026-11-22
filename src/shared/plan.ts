// A unit's plan: its objectives, and the segments that teach them in order
// (brief.md, "Terms"). The unit's planning session sends it through
// plan_unit (task 2.5), and it is stored on the unit in curriculum.json. In a
// unit that names sections, each segment names those it draws on.
//
// The field descriptions and the error messages are written for that
// session: a refused plan sends them back to it.

import { z } from "zod";
import { Slug } from "./course.ts";
import { SectionRef } from "./source.ts";
import { hasPassed, type ObjectiveStatus } from "./status.ts";
import type { Position } from "./timeline.ts";

export const Objective = z.object({
  id: Slug.describe(
    'A short id for the objective, unique in the whole course, such as "chain-rule-composite". Evidence names the objective by it.',
  ),
  statement: z
    .string()
    .trim()
    .min(1)
    .max(300)
    .describe(
      'One specific, testable skill or understanding, a single idea in one sentence, such as "Apply the chain rule to a composite function." A contrast with another idea is an objective of its own.',
    ),
});
export type Objective = z.infer<typeof Objective>;

const SEGMENT_SIZE =
  "A segment covers one or two objectives. Split a larger one into several segments.";

export const Segment = z.object({
  title: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .describe(
      "The segment's title, in a few words, as the learner sees it in the unit's outline",
    ),
  objectives: z
    .array(Slug)
    .min(1, { error: SEGMENT_SIZE })
    .max(2, { error: SEGMENT_SIZE })
    .describe("The ids of the one or two objectives the segment teaches"),
  sections: z
    .array(SectionRef)
    .optional()
    .describe(
      'The unit\'s sections this segment draws on, as the unit names them ("<source id>/<section id>"), in reading order. Required when the unit names sections; leave it out when it names none.',
    ),
});
export type Segment = z.infer<typeof Segment>;

/**
 * Every objective is taught in exactly one segment, and a segment names only
 * objectives of the plan. Objective ids must also be unique across the
 * course, which the curriculum checks, since a plan does not see the others.
 */
export const Plan = z
  .object({
    objectives: z
      .array(Objective)
      .min(1)
      .describe("The unit's objectives. Together they reach the unit's goal."),
    segments: z
      .array(Segment)
      .min(1)
      .describe(
        "The segments, in the order they are taught. Each objective is taught in exactly one segment.",
      ),
  })
  .superRefine((plan, ctx) => {
    const ids = new Set<string>();
    plan.objectives.forEach((objective, i) => {
      if (ids.has(objective.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["objectives", i, "id"],
          message: `"${objective.id}" is the id of more than one objective. Give each objective its own.`,
        });
      }
      ids.add(objective.id);
    });
    // With two objectives sharing an id, which one a segment means is unclear.
    if (ids.size < plan.objectives.length) return;

    /** The number, from 1, of the segment that teaches each objective. */
    const taughtIn = new Map<string, number>();
    plan.segments.forEach((segment, i) => {
      segment.objectives.forEach((id, j) => {
        const earlier = taughtIn.get(id);
        if (!ids.has(id)) {
          ctx.addIssue({
            code: "custom",
            path: ["segments", i, "objectives", j],
            message: `"${id}" is not an objective of this plan. List it in the objectives, or name one that is.`,
          });
        } else if (earlier !== undefined) {
          ctx.addIssue({
            code: "custom",
            path: ["segments", i, "objectives", j],
            message:
              earlier === i + 1
                ? `This segment lists "${id}" twice.`
                : `"${id}" is already taught in segment ${earlier}. Teach each objective in one segment.`,
          });
        } else {
          taughtIn.set(id, i + 1);
        }
      });
    });

    plan.objectives.forEach((objective, i) => {
      if (!taughtIn.has(objective.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["objectives", i],
          message: `"${objective.id}" is in no segment. Teach it in one, or leave it out of the plan.`,
        });
      }
    });
  });
export type Plan = z.infer<typeof Plan>;

/**
 * Why the plan cannot be the plan of a unit that names these sections: in
 * such a unit each segment names at least one of them and no other; in a
 * unit that names none, a segment names none either. Empty when it can.
 */
export function planSectionProblems(
  plan: Pick<Plan, "segments">,
  unitSections: readonly string[],
): string[] {
  const ours = new Set(unitSections);
  return plan.segments.flatMap((segment, i) => {
    const named = segment.sections ?? [];
    const which = `Segment ${i + 1} ("${segment.title}")`;
    if (ours.size === 0) {
      return named.length === 0
        ? []
        : [
            `${which} names sections, but this unit teaches from no source: leave its sections out.`,
          ];
    }
    if (named.length === 0) {
      return [
        `${which} names no section. Name the unit's sections it draws on: ${[...ours].map((ref) => `"${ref}"`).join(", ")}.`,
      ];
    }
    return named.flatMap((ref, j) => {
      if (named.indexOf(ref) < j) {
        return [`${which} lists "${ref}" twice.`];
      }
      return ours.has(ref)
        ? []
        : [
            `${which} names "${ref}", which is not one of this unit's sections. Name only the unit's: ${[...ours].map((r) => `"${r}"`).join(", ")}.`,
          ];
    });
  });
}

/**
 * What a segment of the plan is once the learner skips what the test before
 * the unit passed (docs/decisions.md, "Mastery loop", "Testing out"): the
 * objectives it still teaches and checks, and those it leaves out. A segment
 * that teaches none is skipped.
 */
export interface SegmentLeft {
  teaches: string[];
  leftOut: string[];
}

/** Each of the plan's segments, in order, once the objectives `passed` are skipped. */
export function skipping(
  plan: Pick<Plan, "segments">,
  passed: readonly string[],
): SegmentLeft[] {
  const skipped = new Set(passed);
  return plan.segments.map((segment) => ({
    teaches: segment.objectives.filter((id) => !skipped.has(id)),
    leftOut: segment.objectives.filter((id) => skipped.has(id)),
  }));
}

/**
 * The index of the first segment taught from `from` on, the segments that
 * skipping `passed` leaves nothing to teach passed over; undefined when
 * none is left.
 */
export function firstTaught(
  plan: Pick<Plan, "segments">,
  passed: readonly string[],
  from = 0,
): number | undefined {
  const at = skipping(plan, passed).findIndex(
    (s, i) => i >= from && s.teaches.length > 0,
  );
  return at === -1 ? undefined : at;
}

/**
 * The objective to do now, marked with the accent's ringed form wherever a
 * unit's objectives are listed (docs/decisions.md, "Page design"): the
 * first not passed among those the active segment teaches, in the
 * segment's order. The segment after the plan's last teaches its own; one
 * of the plan's teaches what the test let the learner skip left in. There
 * is no active segment, and so none, in a unit not in progress, which has
 * no position, and once the segment has closed, until the learner starts
 * the next.
 */
export function currentObjective(
  plan: Pick<Plan, "segments">,
  at: Position | null | undefined,
  statuses: Readonly<Record<string, ObjectiveStatus>>,
): string | undefined {
  if (at == null || at.phase === "closed") return undefined;
  const teaches =
    at.again ?? skipping(plan, at.skipping ?? [])[at.segment]?.teaches ?? [];
  return teaches.find((id) => !hasPassed(statuses[id] ?? "not-started"));
}
