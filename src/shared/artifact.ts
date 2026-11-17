// Artifacts (task 3.6): HTML aids the tutor shows beside the conversation
// with `show_artifact`. The engine stores each in the course's artifacts/
// folder, and the session's side pane shows it in a frame that runs its
// scripts but can reach nothing (architecture.md section 10).

import { z } from "zod";

/** The most an artifact's document may hold, in bytes of UTF-8. */
export const ARTIFACT_LIMIT_BYTES = 100_000;

/** What the tutor gives `show_artifact`. */
export const ArtifactInput = z.object({
  title: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .describe(
      'What the aid shows, in a few words, as the learner sees it in the conversation: "The slope of sin(x²)".',
    ),
  html: z
    .string()
    .min(1)
    .describe(
      "The whole HTML document, self-contained: its styles and scripts inline, nothing loaded from the network. At most 100 KB.",
    ),
});
export type ArtifactInput = z.infer<typeof ArtifactInput>;

/**
 * An artifact's file in the course's artifacts/ folder: its number, then its
 * title as a slug, as in `3-the-slope-of-sin-x2.html`.
 */
export const ArtifactFile = z
  .string()
  .regex(/^[1-9][0-9]*-[a-z0-9]+(-[a-z0-9]+)*\.html$/);
export type ArtifactFile = z.infer<typeof ArtifactFile>;
