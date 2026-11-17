// Calibration (brief.md, "Other features"; task 2.27): across all courses,
// how often the learner's answers at each confidence level were right, as
// counts, so "90%: 8 of 10" says how sure they really were. As
// `GET /api/calibration` sends it to the library, derived from the evidence
// when asked (src/server/record/calibration.ts), never stored.
//
// Only answers given without help count, "I don't know" included; "I don't
// know" asks no confidence, so it is counted apart. Answers given before
// task 2.23 count too (docs/decisions.md, "Calibration").

import { z } from "zod";
import { Confidence } from "./question.ts";

export const LevelCount = z.object({
  confidence: Confidence,
  /** Graded correct. */
  correct: z.number().int().nonnegative(),
  /** Graded, correct or not. */
  answered: z.number().int().nonnegative(),
});
export type LevelCount = z.infer<typeof LevelCount>;

export const Calibration = z.object({
  /** One for each level, lowest first, a level with no answers included. */
  levels: z.array(LevelCount),
  /** Questions answered "I don't know". */
  unknown: z.number().int().nonnegative(),
  /** The titles of courses whose evidence could not be read, left out. */
  skipped: z.array(z.string()),
});
export type Calibration = z.infer<typeof Calibration>;
