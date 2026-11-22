// One line of misconceptions.jsonl (task 5.7): a
// belief the learner held that is not so, found by the handoff writer
// (engine/handoff.ts) in a stretch of a unit's thread. The log is appended
// to, never rewritten. Whether a misconception is open is derived from its
// objective's status, never stored.

import { z } from "zod";
import { Slug, Timestamp } from "./course.ts";
import { hasPassed, type ObjectiveStatus } from "./status.ts";

/** Where in the thread it showed. */
export const MisconceptionPlace = z.discriminatedUnion("in", [
  /** The detour after a miss, by its question. */
  z.object({
    in: z.literal("detour"),
    questionId: z.string(),
    /** The question's number, as the thread showed it. */
    number: z.number().int().positive(),
  }),
  /** Outside a detour: the discussion, where the question on intuition is, or the teaching. */
  z.object({ in: z.literal("discussion") }),
]);
export type MisconceptionPlace = z.infer<typeof MisconceptionPlace>;

/** The most a misconception's quote of the learner may hold. */
export const MISCONCEPTION_WORDS_LIMIT = 1000;

export const Misconception = z.object({
  recordedAt: Timestamp,
  /** The unit whose thread showed it; the objective can be another unit's, asked in a review. */
  unit: Slug,
  objective: Slug,
  /** What the learner believed, stated as the claim they held. Markdown with `$` math. */
  believed: z.string().trim().min(1).max(2000),
  /** What is so, and briefly why. Markdown with `$` math. */
  actually: z.string().trim().min(1).max(2000),
  /**
   * The learner's own words that showed it, as the writer quoted them; the
   * engine keeps only a quote found in what the learner wrote in the
   * stretch (`foundIn` in engine/handoff.ts). Misconceptions recorded
   * before quotes were asked for have none.
   */
  words: z.string().trim().min(1).max(MISCONCEPTION_WORDS_LIMIT).optional(),
  where: MisconceptionPlace,
});
export type Misconception = z.infer<typeof Misconception>;

/** A misconception is open while its objective is not passed (slipping and overridden too). */
export function isOpen(status: ObjectiveStatus): boolean {
  return !hasPassed(status);
}
