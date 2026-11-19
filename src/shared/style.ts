// Changing a course's style note after approval (brief.md, "Teaching
// style"): the tutor proposes the whole revised note with `propose_style`,
// the page shows it on a card with what changed marked, and only the
// learner's Apply writes style.md. Style never changes silently.

import { z } from "zod";
import { Timestamp } from "./course.ts";
import { StyleNote } from "./curriculum.ts";

/** What the tutor gives `propose_style`. */
export const StyleInput = z.object({
  note: StyleNote.describe(
    "The whole revised style note, as it would replace the current one at " +
      "the end of your instructions: start from the current note, keep each " +
      "sentence that still holds word for word, and change or add only what " +
      "the change needs. Two to four plain sentences addressed to the " +
      "learner; no Markdown or LaTeX.",
  ),
  why: z
    .string()
    .trim()
    .min(1)
    .max(300)
    .describe(
      "One sentence to the learner on why: what they asked for, or what " +
        "their answers showed.",
    ),
});
export type StyleInput = z.infer<typeof StyleInput>;

/**
 * A proposal waiting for the learner's answer, kept in the unit's position
 * in state.json, so a restart shows its card again.
 */
export const StyleProposal = z.object({
  /** The id the page answers it by. */
  id: z.string().min(1),
  note: StyleNote,
  /** The note it would replace; none for a course approved before style notes. */
  was: z.string().optional(),
  why: z.string().min(1),
  proposedAt: Timestamp,
});
export type StyleProposal = z.infer<typeof StyleProposal>;

/**
 * How a proposal ended. "kept": the learner kept the current note;
 * "withdrawn": the unit ended with the proposal still waiting.
 */
export const StyleOutcome = z.enum(["applied", "kept", "withdrawn"]);
export type StyleOutcome = z.infer<typeof StyleOutcome>;

/** The learner's answer to a proposal, as the page posts it. */
export const StyleAnswer = z.object({ proposalId: z.string().min(1) });
export type StyleAnswer = z.infer<typeof StyleAnswer>;

/** A learner's answer, kept until it has reached the tutor. */
export const StyleDecision = z.discriminatedUnion("outcome", [
  StyleAnswer.extend({ outcome: z.literal("applied"), note: StyleNote }),
  StyleAnswer.extend({ outcome: z.literal("kept") }),
]);
export type StyleDecision = z.infer<typeof StyleDecision>;
