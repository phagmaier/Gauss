// The app's settings (brief.md, "Teaching style" and "Backends and stack"):
// `settings.json` in the data root, app-wide, and the learner's teaching
// instructions, `teaching.md` beside it. The tutor's model is chosen per
// backend, from the models offered here; one not chosen is the backend's
// default.

import { z } from "zod";
import type { BackendName } from "./course.ts";

/** A model the tutor of a course on this backend can run on: its id, as the learner reads it, and what the page says of it. */
export interface TutorModelOffer {
  id: string;
  title: string;
  says: string;
}

/**
 * The models offered for each backend's tutor, the default first. Only
 * these: Haiku broke a tutor's aids and claimed tool calls it never made
 * (docs/findings.md, "Tutor"), and the other Codex models were never tried.
 */
export const TUTOR_MODELS = {
  claude: [
    { id: "claude-opus-5-5", title: "Opus 5.5", says: "Gauss's default." },
    {
      id: "claude-sonnet-5-5",
      title: "Sonnet 5.5",
      says: "Quicker and lighter on your plan; in Gauss's trials it kept to the rules on quoting sources less well.",
    },
  ],
  codex: [
    {
      id: "gpt-6.1-terra",
      title: "gpt-6.1-terra",
      says: "Gauss's default. Medium effort, standard tier.",
    },
    {
      id: "gpt-6.2-sol",
      title: "gpt-6.2-sol",
      says: "The model Gauss's Codex trials ran on. Medium effort, standard tier.",
    },
  ],
} as const satisfies Record<BackendName, readonly TutorModelOffer[]>;

const ids = <B extends BackendName>(backend: B) =>
  TUTOR_MODELS[backend].map((offer) => offer.id) as [
    (typeof TUTOR_MODELS)[B][number]["id"],
    ...(typeof TUTOR_MODELS)[B][number]["id"][],
  ];

export const TutorModels = z.object({
  claude: z.enum(ids("claude")).optional(),
  codex: z.enum(ids("codex")).optional(),
});
export type TutorModels = z.infer<typeof TutorModels>;

export const AppSettings = z.object({
  /** The tutor's model for each backend's courses, once the learner chose one. */
  tutorModels: TutorModels,
});
export type AppSettings = z.infer<typeof AppSettings>;

/** The settings of a data root with no settings.json. */
export const NO_SETTINGS: AppSettings = { tutorModels: {} };

/** The model a course on this backend runs its tutor on: the one chosen, else the default. */
export function tutorModel(
  settings: AppSettings,
  backend: BackendName,
): string {
  return settings.tutorModels[backend] ?? TUTOR_MODELS[backend][0].id;
}

/** A model chosen on the Settings page, for one backend's courses. */
export const TutorModelPost = z.discriminatedUnion("backend", [
  z.object({ backend: z.literal("claude"), model: z.enum(ids("claude")) }),
  z.object({ backend: z.literal("codex"), model: z.enum(ids("codex")) }),
]);
export type TutorModelPost = z.infer<typeof TutorModelPost>;

/** The most characters the learner's teaching instructions may hold, trimmed. */
export const TEACHING_LIMIT = 2000;

/**
 * The learner's own text for the tutor's default style, `teaching.md` in the
 * data root, in place of Gauss's paragraph in `prompts/tutor.md`. Absent
 * while the learner keeps Gauss's.
 */
export const TeachingText = z
  .string()
  .trim()
  .min(1, { error: "The instructions are empty." })
  .max(TEACHING_LIMIT, {
    error: `The instructions are longer than ${TEACHING_LIMIT.toLocaleString("en-GB")} characters.`,
  });
export type TeachingText = z.infer<typeof TeachingText>;

/** What the Settings page shows. */
export const SettingsView = z.object({
  /** The tutor's model for each backend's courses: the one chosen, else the default. */
  tutorModels: z.object({ claude: z.string(), codex: z.string() }),
  teaching: z.object({
    /** The learner's own text; absent while they keep Gauss's. */
    text: z.string().optional(),
    /** Gauss's paragraph, its lines joined. */
    gauss: z.string(),
    /** The paragraph after it, which the learner cannot change. */
    fixed: z.string(),
  }),
});
export type SettingsView = z.infer<typeof SettingsView>;

/** A model choice's answer: each backend's tutor model as it now stands. */
export const TutorModelSaved = SettingsView.shape.tutorModels;
export type TutorModelSaved = z.infer<typeof TutorModelSaved>;

/**
 * A save of the teaching instructions: the box's text, and the learner's
 * text the page loaded (none while they kept Gauss's), so that a save from
 * another tab meanwhile is not written over unseen. Gauss's text saved
 * removes the learner's.
 */
export const TeachingPost = z.object({
  text: TeachingText,
  was: z.string().optional(),
});
export type TeachingPost = z.infer<typeof TeachingPost>;

/** A save's answer: the learner's text as kept, absent when it is Gauss's. */
export const TeachingSaved = z.object({ text: z.string().optional() });
export type TeachingSaved = z.infer<typeof TeachingSaved>;
