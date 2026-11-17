// A unit's plan: its objectives, and the segments that teach them in order
// (brief.md, "Terms"). The unit's planning session sends it through
// plan_unit (task 2.5), and it is stored on the unit in curriculum.json.
//
// The field descriptions and the error messages are written for that
// session: a refused plan sends them back to it.

import { z } from "zod";
import { Slug } from "./course.ts";

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
