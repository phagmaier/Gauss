// course.json: what Gauss keeps about a course besides its curriculum
// (docs/architecture.md, "Data root"). Where a course stands (curriculum
// awaiting review, a unit in progress, finished) and whether it is a one-off are
// derived from curriculum.json and the evidence log, never stored here.

import { z } from "zod";

/**
 * An id that names a folder under the data root: a course's folder, or a
 * unit's under `units/`. Lowercase words joined by single hyphens, so it can
 * never be a path of its own.
 */
export const Slug = z
  .string()
  .max(60)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    error:
      'Use lowercase letters, digits and single hyphens, like "chain-rule".',
  });
export type Slug = z.infer<typeof Slug>;

/** A moment in UTC, as `Date.prototype.toISOString` writes it. */
export const Timestamp = z.iso.datetime();
export type Timestamp = z.infer<typeof Timestamp>;

/**
 * The backends a course can run on, picked at its intake and fixed after
 * (docs/brief.md, "Backends and stack").
 */
export const BackendName = z.enum(["claude", "codex"]);
export type BackendName = z.infer<typeof BackendName>;

/** Each backend's name, as the learner reads it. */
export const BACKEND_TITLES: Record<BackendName, string> = {
  claude: "Claude",
  codex: "Codex",
};

/** Why a Codex course has no web search, as its course view and its settings route say. */
export const NO_WEB_SEARCH_ON_CODEX =
  "A course on Codex has no web search: Codex's search opens and reads " +
  "pages, which a tutor here never does.";

/**
 * The course's settings, which the course view changes. Each change of one
 * is posted whole, and answered with the settings as written.
 */
export const CourseSettings = z.object({
  /**
   * Whether the tutor may search the web for material it lacks (task 4.11):
   * a search, never reading a page. Off when a course is made.
   */
  webSearch: z.boolean(),
});
export type CourseSettings = z.infer<typeof CourseSettings>;

export const Course = z.object({
  title: z.string().trim().min(1).max(200),
  backend: BackendName,
  settings: CourseSettings,
  createdAt: Timestamp,
  /** Identity across slug reuse. Older records use their creation timestamp. */
  instance: z.uuid().optional(),
  /** The library lists courses by this, newest first. */
  lastOpenedAt: Timestamp,
  /**
   * When each unit was last opened, by unit id. The course view lists the
   * units in progress by it, most recent first (task 2.12). Absent until a
   * unit is opened, and in files written before then.
   */
  unitsOpenedAt: z.record(Slug, Timestamp).optional(),
  /**
   * When review was last offered on a card, in any of the course's units.
   * No card is offered again within an hour of it, so two units opened
   * together get one (docs/brief.md, "Assessment modes"). Absent until a
   * review is offered.
   */
  reviewOfferedAt: Timestamp.optional(),
});
export type Course = z.infer<typeof Course>;
