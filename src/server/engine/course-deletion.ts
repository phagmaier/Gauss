// Deleting a course or a draft (task 5.18; docs/decisions.md, "Product
// decisions"), from its course view: there is no archive, and the app has
// no undo; the backup's history keeps what went. A course that has started
// asks for its title to be typed (`deletionAsksTitle`).
//
// Refused while anything of the course runs, or a page shows one of its
// chats: a chat left behind would write into a course that is gone, or into
// a new one that takes its id. Otherwise the engine lets go of the course at
// once, before anything is awaited, so nothing of it starts in between;
// then its folder goes, its sessions are closed, and a backup commit is
// asked for.

import type { Slug } from "../../shared/course.ts";
import type { StoredCourse } from "../../shared/library.ts";
import { deletionAsksTitle } from "../../shared/library.ts";
import { type Backup, noBackup } from "../record/backup.ts";
import type { DataRoot } from "../record/data-root.ts";
import { withProgress } from "../record/progress.ts";

/** What holds a course: a page showing one of its chats, or work of it that runs. */
export type Doing =
  /** A unit's session page reads its chat. */
  | "unit-page"
  /** A unit is being planned or loaded. */
  | "opening"
  | "tutor"
  | "grading"
  | "judging"
  | "handoff"
  | "install"
  /** A unit's notes are being written. */
  | "notes"
  | "dispute"
  /** The page of the course's planning conversation is open. */
  | "planning-page"
  /** The planner of the course's planning conversation is writing, or its change is being applied. */
  | "planning"
  /** The page of the intake reviewing the draft is open. */
  | "review-page"
  /** The planner of that intake is writing, or the curriculum is being approved. */
  | "review";

export interface CourseUse {
  doing: Doing;
  /** The unit it is in, for the work of a unit. */
  unit?: Slug;
}

/** A part of the engine that keeps something of a course: its chats, or work on it. */
export interface CourseHolder {
  /** What of the course is shown or runs now, if anything. */
  inUse(courseId: Slug): CourseUse | undefined;
  /**
   * Drops what it keeps of the course, which nothing uses, before its first
   * await, and resolves once the sessions it held are closed.
   */
  forget(courseId: Slug): Promise<void>;
}

export type Deleted =
  | { ok: true }
  | { ok: false; status: 404 | 409; error: string };

export interface CourseDeletion {
  /** Deletes the course, with the title the learner typed, if they did. */
  delete(courseId: string, title: string | undefined): Promise<Deleted>;
}

export function createCourseDeletion(options: {
  dataRoot: DataRoot;
  holders: readonly CourseHolder[];
  /** Commits the record once the course is gone; none if not given. */
  backup?: Backup;
}): CourseDeletion {
  const { dataRoot, holders } = options;
  const backup = options.backup ?? noBackup;
  return {
    async delete(courseId, title) {
      const stored = await dataRoot.readCourse(courseId);
      if (stored === undefined) {
        return { ok: false, status: 404, error: "No such course." };
      }
      const course = await withProgress(dataRoot, stored).catch(
        (error: unknown) => ({
          ...stored,
          progress: {},
          problem: error instanceof Error ? error.message : String(error),
        }),
      );
      if (
        deletionAsksTitle(course) &&
        title?.trim() !== stored.course.title.trim()
      ) {
        return {
          ok: false,
          status: 409,
          error: "Type the course's title to delete it.",
        };
      }
      for (const holder of holders) {
        const use = holder.inUse(stored.id);
        if (use !== undefined) {
          return { ok: false, status: 409, error: refusal(stored, use) };
        }
      }
      const forgotten = Promise.allSettled(
        holders.map((holder) => holder.forget(stored.id)),
      );
      await dataRoot.deleteCourse(stored.id);
      await forgotten;
      backup.commit(`${stored.id}: course deleted`);
      return { ok: true };
    },
  };
}

/** Why the course cannot be deleted now, and what the learner can do. */
function refusal(stored: StoredCourse, use: CourseUse): string {
  const units = stored.curriculum?.units ?? [];
  const index = units.findIndex((u) => u.id === use.unit);
  const titled = index !== -1;
  /** The unit at a clause's end. */
  const unit = titled
    ? `unit ${index + 1}, ${units[index]?.title}`
    : `the unit "${use.unit}"`;
  /** The unit inside a clause, its title set off by commas. */
  const inner = titled ? `${unit},` : unit;
  const later = "Delete the course once it has finished.";
  switch (use.doing) {
    case "unit-page":
      return `The page of ${inner} is open. Close it, then delete the course.`;
    case "opening":
      return `${capital(inner)} is opening. ${later}`;
    case "tutor":
      return `The tutor is writing in ${unit}. Stop it, or ${later.toLowerCase()}`;
    case "grading":
      return `An answer in ${inner} is being graded. ${later}`;
    case "judging":
      return `The tutor's reply in ${inner} is being judged for help. ${later}`;
    case "handoff":
      return `The handoff note of ${inner} is being written. ${later}`;
    case "install":
      return `Packages are being installed for ${unit}. ${later}`;
    case "notes":
      return `The notes of ${inner} are being written. ${later}`;
    case "dispute":
      return `A dispute of a grade in this course is being decided. ${later}`;
    case "planning-page":
      return "The course's planning conversation is open. Close it, then delete the course.";
    case "planning":
      return `The planner is at work in the course's planning conversation. ${later}`;
    case "review-page":
      return "The curriculum's review is open. Close it, then delete the course.";
    case "review":
      return `The planner is at work in the curriculum's review. ${later}`;
  }
}

function capital(text: string): string {
  return `${text[0]?.toUpperCase()}${text.slice(1)}`;
}
