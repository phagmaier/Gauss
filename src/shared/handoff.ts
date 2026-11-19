// A unit's handoff note (brief.md, "Handoff note"; task 5.7): what the
// handoff writer, a one-shot call (engine/handoff.ts, prompts/handoff.md),
// replies, and what the record keeps beside the note. The note itself is
// plain text, `units/<unit-id>/handoff.md`, rewritten whole by each call
// that succeeds; `units/<unit-id>/handoff.json` says how much of the unit's
// thread it covers, so the next call reads only what came after.

import { z } from "zod";
import { Timestamp } from "./course.ts";

/** A note is about 250 words; this cap only stops one that runs away. */
export const HANDOFF_NOTE_LIMIT = 4000;

export const HandoffReply = z.object({
  note: z
    .string()
    .trim()
    .min(1)
    .max(HANDOFF_NOTE_LIMIT)
    .describe(
      "The unit's handoff note, whole, in place of the one before: about 250 words, for a tutor who has not seen the conversation.",
    ),
  misconceptions: z
    .array(
      z.object({
        objective: z
          .string()
          .describe(
            "The id of the objective it bears on, as <objectives> lists it.",
          ),
        believed: z
          .string()
          .trim()
          .min(1)
          .max(2000)
          .describe(
            "What the learner believed, stated as the claim they held, in a sentence or two.",
          ),
        actually: z
          .string()
          .trim()
          .min(1)
          .max(2000)
          .describe("What is so, and briefly why, in a sentence or two."),
        detour: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            "The number of the detour it showed in, as the stretch numbers them. Left out when it showed outside a detour.",
          ),
      }),
    )
    .describe(
      "The misconceptions this stretch shows that are not recorded already; empty when it shows none.",
    ),
});
export type HandoffReply = z.infer<typeof HandoffReply>;

/**
 * How much of the unit's thread the note covers: its transcripts up to
 * session `session`, and of that session its first `events` events as the
 * transcript holds them, unreadable lines left out.
 */
export const HandoffMark = z.object({
  writtenAt: Timestamp,
  through: z.object({
    session: z.number().int().positive(),
    events: z.number().int().nonnegative(),
  }),
});
export type HandoffMark = z.infer<typeof HandoffMark>;
