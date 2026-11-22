// Calibration (brief.md, "Other features"; tasks 2.27 and 2.29): in one
// course, how often the learner's answers at each confidence level were
// right, as counts, so "90%: 8 of 10" says how sure they really were. Sent
// with the course's "What I know" (what-i-know.ts), derived from its
// evidence when asked (src/server/record/calibration.ts), never stored.
//
// Only answers given without help count, "I don't know" included; "I don't
// know" asks no confidence, so it is counted apart. Answers given before
// task 2.23 count too (docs/brief.md, "Other features").

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
});
export type Calibration = z.infer<typeof Calibration>;
