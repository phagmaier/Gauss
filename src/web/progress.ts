// Where a course's units stand, as the course view and the library show it
// (docs/prototype/07-course.html, 12-unit-order.html; task 2.12): each
// unit's mark, the card at the top that leads on, and what Start asks first.
// Derived from the progress the server sends with the course, itself derived
// from the record (src/server/record/progress.ts).
//
// Any unit can be started at any time, so several can be in progress. The
// card leads to the unit in progress most recently opened, or else to the
// next unit in order: the first in the list not started whose prerequisites
// are finished, passed or overridden (docs/decisions.md, "Stage 2 designs").

import type { StoredUnit } from "../shared/curriculum.ts";
import type { CourseWithProgress, UnitProgress } from "../shared/library.ts";
import type { UnitStatus } from "../shared/status.ts";

type Progress = CourseWithProgress["progress"];

/** How a mark is drawn, a segment's or a unit's tick: done, in progress, or still to come. */
export type Mark = "past" | "now" | "";

/** The name of the segment after the plan's last, as the server gives it. */
export const AGAIN = "Going over again";

/**
 * "Segment 2 of 5", or "Going over again" for the segment after the plan's
 * last, with one tick per segment of the plan. The session's top line says it
 * too (session.ts).
 */
export function segmentStand(
  count: number,
  segment: number,
  again: boolean,
): { label: string; ticks: Mark[] } {
  if (again) {
    // As mock 10 has it: the last tick stays lit while objectives are gone over.
    return {
      label: AGAIN,
      ticks: Array.from({ length: count }, (_, i) =>
        i < count - 1 ? "past" : "now",
      ),
    };
  }
  return {
    label: `Segment ${segment + 1} of ${count}`,
    ticks: Array.from({ length: count }, (_, i) =>
      i < segment ? "past" : i === segment ? "now" : "",
    ),
  };
}

/** A unit and its number in the course's list, from 1. */
export interface Numbered {
  number: number;
  unit: StoredUnit;
}

const NOT_STARTED: UnitProgress = { status: "not-started" };

/** The unit's progress; a unit the progress does not name has not started. */
export function progressOf(progress: Progress, unitId: string): UnitProgress {
  return (
    (Object.hasOwn(progress, unitId) ? progress[unitId] : undefined) ??
    NOT_STARTED
  );
}

export function isFinished(status: UnitStatus): boolean {
  return status === "passed" || status === "overridden";
}

/** The approved curriculum's units; none for a draft or no curriculum. */
function approvedUnits(course: CourseWithProgress): StoredUnit[] {
  const { curriculum } = course;
  return curriculum?.approval.status === "approved" ? curriculum.units : [];
}

/**
 * The first unit in the list that is not started and whose prerequisites
 * are all finished; null when there is none.
 */
export function nextInOrder(
  units: readonly StoredUnit[],
  progress: Progress,
): Numbered | null {
  const at = units.findIndex(
    (unit) =>
      progressOf(progress, unit.id).status === "not-started" &&
      unit.prerequisites.every((id) =>
        isFinished(progressOf(progress, id).status),
      ),
  );
  const unit = units[at];
  return unit === undefined ? null : { number: at + 1, unit };
}

/**
 * The units in progress, most recently opened first. Those never marked
 * opened (positions written before task 2.12) come after, in list order.
 */
export function unitsInProgress(course: CourseWithProgress): Numbered[] {
  const opened = course.course.unitsOpenedAt ?? {};
  const time = (id: string) =>
    Object.hasOwn(opened, id) ? Date.parse(opened[id] ?? "") : -Infinity;
  return approvedUnits(course)
    .map((unit, i) => ({ number: i + 1, unit }))
    .filter(
      ({ unit }) =>
        progressOf(course.progress, unit.id).status === "in-progress",
    )
    .sort((a, b) => time(b.unit.id) - time(a.unit.id) || a.number - b.number);
}

/** Where in a unit in progress the learner is: "Segment 3 of 5", its title, and a tick per segment. */
export interface WhereInUnit {
  label: string;
  /** The segment's title; none for the segment that goes over objectives again. */
  title?: string;
  ticks: Mark[];
}

/** Null when the unit's segment is not known: its position is gone, or it has no plan. */
export function whereInProgress(
  unit: StoredUnit,
  progress: UnitProgress,
): WhereInUnit | null {
  const { segment } = progress;
  const segments = unit.plan?.segments;
  if (segment === undefined || segments === undefined) return null;
  const stand = segmentStand(
    segments.length,
    segment,
    segment >= segments.length,
  );
  const title = segments[segment]?.title;
  return title === undefined ? stand : { ...stand, title };
}

/** What the card at the top of the course view leads to. */
export type Lead =
  | {
      kind: "in-progress";
      number: number;
      unit: StoredUnit;
      where: WhereInUnit | null;
      /** The other units in progress, most recently opened first. */
      others: Numbered[];
    }
  | { kind: "up-next"; number: number; unit: StoredUnit };

/** Null for a draft, a course with no curriculum, and a finished course. */
export function lead(course: CourseWithProgress): Lead | null {
  const [first, ...others] = unitsInProgress(course);
  if (first !== undefined) {
    return {
      kind: "in-progress",
      ...first,
      where: whereInProgress(
        first.unit,
        progressOf(course.progress, first.unit.id),
      ),
      others,
    };
  }
  const next = nextInOrder(approvedUnits(course), course.progress);
  return next === null ? null : { kind: "up-next", ...next };
}

/**
 * How a unit's row in the list and its node in the diagram show where it
 * stands: `state` is the class of the row and the node, `text` the word at
 * the row's right and on the node, `className` that word's own class.
 */
export interface UnitMark {
  state: "pass" | "over" | "now" | "todo";
  text: string;
  className: string;
}

export function unitMark(
  course: CourseWithProgress,
  unit: StoredUnit,
): UnitMark {
  const progress = progressOf(course.progress, unit.id);
  switch (progress.status) {
    case "passed":
      return { state: "pass", text: "Passed", className: "pass" };
    case "overridden":
      return { state: "over", text: "Overridden", className: "" };
    case "in-progress":
      return {
        state: "now",
        text: whereInProgress(unit, progress)?.label ?? "In progress",
        className: "",
      };
    case "not-started": {
      // "Up next" only when the card says it too: no unit is in progress.
      const next = lead(course);
      return next?.kind === "up-next" && next.unit.id === unit.id
        ? { state: "todo", text: "Up next", className: "next" }
        : { state: "todo", text: "", className: "" };
    }
  }
}

/** The numbers of the unit's prerequisites that are not finished, in order. */
export function unfinishedPrerequisites(
  course: CourseWithProgress,
  unit: StoredUnit,
): number[] {
  const units = approvedUnits(course);
  return unit.prerequisites
    .filter((id) => !isFinished(progressOf(course.progress, id).status))
    .map((id) => units.findIndex((u) => u.id === id) + 1)
    .filter((n) => n > 0)
    .sort((a, b) => a - b);
}

/** "8 units, 2 finished.", the line under the course's title. */
export function courseSummary(course: CourseWithProgress): string {
  const units = approvedUnits(course);
  const finished = units.filter((u) =>
    isFinished(progressOf(course.progress, u.id).status),
  ).length;
  if (units.length === 1) {
    return finished === 1
      ? "One unit, finished."
      : "One unit, not finished yet.";
  }
  const count =
    finished === 0
      ? "none finished yet"
      : finished === units.length
        ? "all finished"
        : `${finished} finished`;
  return `${units.length} units, ${count}.`;
}
