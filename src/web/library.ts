// What a library row says about a course (docs/prototype/06-library.html):
// where it stands and when it was last opened. Derived from the record, as
// architecture.md section 3 asks.

import type { StoredCourse } from "../shared/library.ts";

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
  /** A course of one unit. */
  oneOff: boolean;
  /** How many ticks the row shows: one per unit of an approved curriculum. */
  units: number;
}

export function standing(stored: StoredCourse): Standing {
  const { curriculum } = stored;
  if (curriculum === null) {
    return {
      text: "No curriculum was proposed",
      review: false,
      oneOff: false,
      units: 0,
    };
  }
  const oneOff = curriculum.units.length === 1;
  if (curriculum.approval.status === "draft") {
    return {
      text: "The curriculum is ready for your review",
      review: true,
      oneOff,
      units: 0,
    };
  }
  const [first] = curriculum.units;
  return {
    text:
      oneOff || first === undefined
        ? "Not started"
        : `Unit 1 of ${curriculum.units.length}: ${first.title}, not started`,
    review: false,
    oneOff,
    units: curriculum.units.length,
  };
}
