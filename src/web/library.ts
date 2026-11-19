// What a library row says about a course (docs/prototype/06-library.html):
// where it stands, a tick per unit, and when it was last opened. Derived
// from the record, as architecture.md section 3 asks, through the progress
// the server sends with each course (progress.ts).

import type { CourseWithProgress } from "../shared/library.ts";
import { isFinished } from "../shared/status.ts";
import { lead, type Mark, progressOf, whereInProgress } from "./progress.ts";

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

export interface Standing {
  /** One line saying where the course stands. */
  text: string;
  /** The curriculum awaits the learner's review. */
  review: boolean;
  /** Every unit is finished, so the course is listed under "Finished". */
  finished: boolean;
  /** A course of one unit. */
  oneOff: boolean;
  /**
   * One tick per unit of an approved curriculum: past once it is finished,
   * now while it is in progress. None for a one-off, as mock 6 has it.
   */
  ticks: Mark[];
}

export function standing(stored: CourseWithProgress): Standing {
  const { curriculum, progress } = stored;
  if (curriculum === null) {
    return {
      text: "No curriculum was proposed",
      review: false,
      finished: false,
      oneOff: false,
      ticks: [],
    };
  }
  const { units } = curriculum;
  const oneOff = units.length === 1;
  if (curriculum.approval.status === "draft") {
    return {
      text: "The curriculum is ready for your review",
      review: true,
      finished: false,
      oneOff,
      ticks: [],
    };
  }
  if (stored.problem !== undefined) {
    // Where it stands is not known. The course view gives the reason.
    return {
      text: "The record could not be read",
      review: false,
      finished: false,
      oneOff,
      ticks: [],
    };
  }
  const statuses = units.map((u) => progressOf(progress, u.id).status);
  const ticks: Mark[] = oneOff
    ? []
    : statuses.map((s) =>
        isFinished(s) ? "past" : s === "in-progress" ? "now" : "",
      );
  const base = { review: false, oneOff, ticks };
  const next = lead(stored);
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
    return { text, ...base, finished: true };
  }
  const where =
    next.kind === "up-next"
      ? "not started"
      : (whereInProgress(
          next.unit,
          progressOf(progress, next.unit.id),
        )?.label.toLowerCase() ?? "in progress");
  return {
    text: oneOff
      ? `${where[0]?.toUpperCase()}${where.slice(1)}`
      : `Unit ${next.number} of ${units.length}: ${next.unit.title}, ${where}`,
    ...base,
    finished: false,
  };
}
