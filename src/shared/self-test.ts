// A self-test as the learner sets it up on the course view (docs/brief.md,
// "Assessment modes"; piece 27): what it covers, the kinds of question and
// how many objectives.

import { z } from "zod";
import { Slug } from "./course.ts";
import { QuestionKind } from "./question.ts";

/** What a self-test covers. */
export const SelfTestScope = z.discriminatedUnion("kind", [
  /** One segment of a unit's plan, by its place from 0. */
  z.object({
    kind: z.literal("segment"),
    unit: Slug,
    segment: z.number().int().nonnegative(),
  }),
  z.object({ kind: z.literal("unit"), unit: Slug }),
  z.object({ kind: z.literal("course") }),
  /** A random mix of what the learner has passed, across the course. */
  z.object({ kind: z.literal("mix") }),
]);
export type SelfTestScope = z.infer<typeof SelfTestScope>;

/** How many objectives a self-test can ask, as the setup offers them. */
export const SELF_TEST_COUNTS = [5, 10, 20] as const;

export const SelfTestRequest = z.object({
  scope: SelfTestScope,
  kinds: z
    .array(QuestionKind)
    .min(1, { error: "Pick at least one kind of question." })
    .refine((kinds) => new Set(kinds).size === kinds.length, {
      error: "A kind of question is picked once.",
    }),
  count: z.literal(SELF_TEST_COUNTS),
});
export type SelfTestRequest = z.infer<typeof SelfTestRequest>;

/**
 * What the setup says of a request, before it starts (`SelfTestPick` in
 * record/review.ts): how many objectives it would ask, how many the scope
 * holds, and how many of those were answered within the hour and are left
 * out.
 */
export const SelfTestCounts = z.object({
  asks: z.number().int().nonnegative(),
  holds: z.number().int().nonnegative(),
  withinHour: z.number().int().nonnegative(),
});
export type SelfTestCounts = z.infer<typeof SelfTestCounts>;
