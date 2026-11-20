// What the library says about each course (docs/prototype/21-library.html):
// the group it is listed in, where it stands, a status form per unit, and
// when it was last opened. Derived from the record, as architecture.md
// section 3 asks, through the progress the server sends with each course
// (progress.ts).

import type { CourseWithProgress } from "../shared/library.ts";
import { lead, progressOf, unitMark } from "./progress.ts";

const DAY = 24 * 60 * 60 * 1000;

/** "Today", "Yesterday", "3 days ago", "Last week", "2 weeks ago", or a date. */
export function whenOpened(iso: string, now: Date = new Date()): string {
  const opened = new Date(iso);
  // Calendar days in local time, counted through UTC so a clock change in
  // between does not shift them.
  const day = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const days = Math.round((day(now) - day(opened)) / DAY);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 14) return "Last week";
  if (days < 28) return `${Math.floor(days / 7)} weeks ago`;
  return opened.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/** The library's groups, in the order it lists them. */
export type Group = "in-progress" | "draft" | "finished";

export interface Standing {
  /** One line saying where the course stands. */
  text: string;
  /**
   * A draft has no approved curriculum: one awaiting review, or none
   * proposed. A course is finished once every unit is; the rest, a course
   * whose record could not be read too, are in progress.
   */
  group: Group;
  /** A course of one unit. */
  oneOff: boolean;
  /**
   * Each unit's status form, in the curriculum's order, the unit the course
   * view's card leads to as the current one. None for a one-off, a draft, or
   * a record that could not be read.
   */
  units: FormOf[];
}

export function standing(stored: CourseWithProgress): Standing {
  const { curriculum, progress } = stored;
  if (curriculum === null) {
    return {
      text: "No curriculum was proposed",
      group: "draft",
      oneOff: false,
      units: [],
    };
  }
  const { units } = curriculum;
  const oneOff = units.length === 1;
  if (curriculum.approval.status === "draft") {
    return {
      text: "The curriculum is ready for your review",
      group: "draft",
      oneOff,
      units: [],
    };
  }
  if (stored.problem !== undefined) {
    // Where it stands is not known. The course view gives the reason.
    return {
      text: "The record could not be read",
      group: "in-progress",
      oneOff,
      units: [],
    };
  }
  const next = lead(stored);
  const forms = oneOff
    ? []
    : units.map((u) => unitMark(stored, u, next?.unit.id).form);
  const statuses = units.map((u) => progressOf(progress, u.id).status);
  if (next === null) {
    // Every unit is finished.
    const overridden = statuses.filter((s) => s === "overridden").length;
    const text = oneOff
      ? overridden === 0
        ? "Passed"
        : "Overridden"
      : overridden === 0
        ? `All ${units.length} units passed`
        : `All ${units.length} units finished, ${overridden} overridden`;
    return { text, group: "finished", oneOff, units: forms };
  }
  const base = { group: "in-progress", oneOff, units: forms } as const;
  if (next.kind === "up-next") {
    if (oneOff) return { text: "Not started", ...base };
    if (statuses.every((s) => s === "not-started")) {
      return {
        text: `Not started. Next: unit ${next.number}, ${next.unit.title}`,
        ...base,
      };
    }
    return {
      text: `Unit ${next.number} of ${units.length}: ${next.unit.title}, not started`,
      ...base,
    };
  }
  const where = next.where?.label;
  return {
    text: oneOff
      ? (where ?? "In progress")
      : `Unit ${next.number} of ${units.length}: ${next.unit.title}, ${where?.toLowerCase() ?? "in progress"}`,
    ...base,
  };
}

/** A group as the library lists it: its heading and its courses. */
export interface LibraryGroup {
  group: Group;
  heading: string;
  courses: CourseWithProgress[];
}

const HEADINGS: [Group, string][] = [
  ["in-progress", "In progress"],
  ["draft", "Drafts"],
  ["finished", "Finished"],
];

/**
 * The courses in their groups: in progress, drafts, finished, each in the
 * order given, which is the library's, most recently opened first. A group
 * with no course is left out.
 */
export function libraryGroups(
  courses: readonly CourseWithProgress[],
): LibraryGroup[] {
  return HEADINGS.map(([group, heading]) => ({
    group,
    heading,
    courses: courses.filter((c) => standing(c).group === group),
  })).filter((g) => g.courses.length > 0);
}
