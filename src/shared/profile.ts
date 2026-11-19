// The learner profile (brief.md, "Memory"; task 5.8): plain text about the
// learner that holds across their courses, `profile.md` in the data root.
// The planner proposes it whole with each curriculum, and approving the
// curriculum writes it; the learner can edit it on the Profile page. The
// finished courses a planner is given with it are derived from the record
// and never kept in the file.

import { z } from "zod";
import { Slug } from "./course.ts";

/** The most characters the profile may hold, trimmed. */
export const PROFILE_LIMIT = 2000;

/**
 * The profile's text. The description is written for the planner, which
 * sends it with propose_curriculum.
 */
export const LearnerProfile = z
  .string()
  .trim()
  .min(1, { error: "The profile is empty." })
  .max(PROFILE_LIMIT, {
    error: `The profile is longer than ${PROFILE_LIMIT.toLocaleString("en-GB")} characters.`,
  })
  .describe(
    "The learner's profile: what holds about them across all their " +
      "courses, for the planners and tutors of every course after this " +
      "one. Their background and work, what they know in general, and how " +
      "they like to be taught. Plain sentences about the learner, at most " +
      "2,000 characters; no Markdown or LaTeX. Send the whole text, changed " +
      "or not: start from the profile you were given, keep each sentence " +
      "that still holds word for word, change or add only what this " +
      "conversation showed, and leave out what is only about this course, " +
      "which belongs in the background note. With no profile yet, write " +
      "one from what the learner told you.",
  );
export type LearnerProfile = z.infer<typeof LearnerProfile>;

/** A course the learner has finished: every unit of its approved curriculum passed or overridden. */
export const FinishedCourse = z.object({
  id: Slug,
  title: z.string(),
  /** A course of one unit. */
  oneOff: z.boolean(),
});
export type FinishedCourse = z.infer<typeof FinishedCourse>;

/** What the Profile page shows: the text, if there is one, and the finished courses. */
export const ProfileView = z.object({
  text: z.string().optional(),
  finished: z.array(FinishedCourse),
});
export type ProfileView = z.infer<typeof ProfileView>;

/**
 * A save from the Profile page: the new text, and the text the page loaded
 * (none if there was no profile), so that a change made meanwhile, by an
 * approval, is not written over unseen.
 */
export const ProfilePost = z.object({
  text: LearnerProfile,
  was: z.string().optional(),
});
export type ProfilePost = z.infer<typeof ProfilePost>;

/** A save's answer: the text as saved, trimmed. */
export const ProfileSaved = z.object({ text: z.string() });
export type ProfileSaved = z.infer<typeof ProfileSaved>;

/**
 * The text's sentences, each on one line: cut after a full stop, a question
 * mark or an exclamation mark (and any closing quote or bracket) that a
 * space follows, and at every line break.
 */
export function sentences(text: string): string[] {
  return text
    .split(/\n|(?<=[.!?][)"'\]’”]*)[ \t]+/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s !== "");
}

/**
 * A proposed text against the one it would replace, sentence by sentence:
 * a profile on the intake's card, a style note on its card (task 5.11).
 */
export interface SentenceChange {
  /** The proposed text's sentences, in order; `added` when the one before lacks it. */
  sentences: { text: string; added: boolean }[];
  /** The sentences of the one before that the proposed text lacks, in order. */
  dropped: string[];
  /** The sentences differ, or their order does. */
  changed: boolean;
}

/**
 * Compares the two texts sentence by sentence. A sentence counts as kept as
 * often as it is in both; spacing within it is ignored.
 */
export function compareSentences(was: string, now: string): SentenceChange {
  const before = sentences(was);
  const after = sentences(now);
  const unmatched = (list: readonly string[]) => {
    const counts = new Map<string, number>();
    for (const s of list) counts.set(s, (counts.get(s) ?? 0) + 1);
    return (s: string) => {
      const n = counts.get(s) ?? 0;
      if (n === 0) return true;
      counts.set(s, n - 1);
      return false;
    };
  };
  const newHere = unmatched(before);
  const goneThere = unmatched(after);
  return {
    sentences: after.map((text) => ({ text, added: newHere(text) })),
    dropped: before.filter(goneThere),
    changed: before.join("\n") !== after.join("\n"),
  };
}
