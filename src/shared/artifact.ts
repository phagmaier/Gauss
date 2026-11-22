// Artifacts (task 3.6): HTML aids the tutor shows beside the conversation
// with `show_artifact`. The engine stores each in the course's artifacts/
// folder, and the session's side pane shows it in a frame that runs its
// scripts but lets it load nothing; WebRTC and DNS prefetch can still reach
// the network (docs/brief.md, "Other features").

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

/** The most an aid's question may hold, in characters. */
export const ASK_LIMIT = 500;

/**
 * The aid's script stopped with an error. A line of 0 is unknown: a promise
 * rejected with no handler has no place.
 */
export const ArtifactError = z.object({
  gauss: z.literal("artifact"),
  type: z.literal("error"),
  message: z.string(),
  line: z.number().int().min(0),
  column: z.number().int().min(0),
});
export type ArtifactError = z.infer<typeof ArtifactError>;

/**
 * A question the aid puts into the message box, from a button the learner
 * pressed in it; the learner sends it or not.
 */
export const ArtifactAsk = z.object({
  gauss: z.literal("artifact"),
  type: z.literal("ask"),
  text: z.string().max(ASK_LIMIT).trim().min(1),
});
export type ArtifactAsk = z.infer<typeof ArtifactAsk>;

/**
 * What an artifact's frame tells the page around it. The app adds the
 * script that sends it to each artifact it serves in the pane
 * (`withReporter` in `src/server/http/artifact-frame.ts`), and the page takes
 * a report only from the frame it shows (`frameReport` in
 * `src/web/artifact.ts`).
 */
export const ArtifactReport = z.discriminatedUnion("type", [
  ArtifactError,
  ArtifactAsk,
]);
export type ArtifactReport = z.infer<typeof ArtifactReport>;
