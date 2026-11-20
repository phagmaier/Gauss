// Where a course's units stand, as the course view and the library show it
// (docs/prototype/20-course.html, 12-unit-order.html; task 2.12): each
// unit's mark, its objectives with the one to do next, the course's counts,
// the card at the top that leads on, and what Start asks first. Derived from
// the progress the server sends with the course, itself derived from the
// record (src/server/record/progress.ts).
//
// Any unit can be started at any time, so several can be in progress. The
// card leads to the unit in progress most recently opened, or else to the
// next unit in order: the first in the list not started whose prerequisites
// are finished, passed or overridden (docs/decisions.md, "Page design").

import type { StoredUnit } from "../shared/curriculum.ts";
import type { CourseWithProgress, UnitProgress } from "../shared/library.ts";
import { currentObjective } from "../shared/plan.ts";
import {
  hasPassed,
  isFinished,
  type ObjectiveStatus,
  type UnitStatus,
} from "../shared/status.ts";
import type { Position } from "../shared/timeline.ts";
import type { FormOf } from "./StatusForm.tsx";

type Progress = CourseWithProgress["progress"];

/**
 * How a mark is drawn, a segment's or a unit's tick: done, in progress, or
 * still to come; or, for a segment, skipped since the test before the unit
 * passed its objectives.
 */
export type Mark = "past" | "now" | "skip" | "";

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
 * How a unit's node in the diagram, and its form in the course view's list,
 * show where it stands: `state` is the node's class, `form` its status form,
 * `text` the word on the node, `className` that word's own class. The unit
 * the card leads to is the current one, drawn in the accent: the unit in
 * progress most recently opened, or the one up next.
 */
export interface UnitMark {
  state: "pass" | "over" | "now" | "att" | "todo";
  form: FormOf;
  text: string;
  className: string;
}

/**
 * `current` is the unit drawn in the accent; by default the one the card
 * leads to.
 */
export function unitMark(
  course: CourseWithProgress,
  unit: StoredUnit,
  current: string | undefined = lead(course)?.unit.id,
): UnitMark {
  const progress = progressOf(course.progress, unit.id);
  const isCurrent = current === unit.id;
  const form: FormOf = { unit: progress.status, current: isCurrent };
  switch (progress.status) {
    case "passed":
      return { state: "pass", form, text: "Passed", className: "pass" };
    case "overridden":
      return { state: "over", form, text: "Overridden", className: "" };
    case "in-progress":
      return {
        state: isCurrent ? "now" : "att",
        form,
        text: whereInProgress(unit, progress)?.label ?? "In progress",
        className: "",
      };
    case "not-started":
      // "Up next" only when the card says it too: no unit is in progress.
      return isCurrent
        ? { state: "now", form, text: "Up next", className: "" }
        : { state: "todo", form, text: "", className: "" };
  }
}

/**
 * A unit's mark on the course map of a unit's session (piece 19): the unit
 * open there is the current one, "You are here" whatever its status, and no
 * other unit is, so nothing else is in the accent or "Up next".
 */
export function mapMark(
  course: CourseWithProgress,
  unit: StoredUnit,
  here: string,
): UnitMark {
  if (unit.id !== here) return unitMark(course, unit, here);
  const { status } = progressOf(course.progress, unit.id);
  return {
    state: "now",
    form: { unit: status, current: true },
    text: "You are here",
    className: "",
  };
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

/** An objective's row under its unit in the course view (piece 20). */
export interface ObjectiveRow {
  id: string;
  statement: string;
  status: ObjectiveStatus;
  /** The objective to do now (`currentObjective` in plan.ts), in the card's unit only. */
  next: boolean;
}

/** A unit's entry in the course view's list (piece 20). */
export interface UnitRow extends Numbered {
  status: UnitStatus;
  mark: UnitMark;
  /** In the plan's order; none for a unit not started, or with no plan yet. */
  objectives?: ObjectiveRow[];
  /** How many of its objectives have passed: passed or retained, not slipping. */
  passed: number;
  /** Open until the learner folds it: the units in progress. */
  open: boolean;
}

/** Where a unit in progress is, as `currentObjective` reads it; none without a position. */
function positionOf(progress: UnitProgress): Position | undefined {
  const { segment, phase, again, skipping } = progress;
  if (segment === undefined || phase === undefined) return undefined;
  return {
    segment,
    phase,
    ...(again === undefined ? {} : { again }),
    ...(skipping === undefined ? {} : { skipping }),
  };
}

/** Each unit of the approved curriculum, as the course view lists it. */
export function unitRows(course: CourseWithProgress): UnitRow[] {
  const leads = lead(course);
  return approvedUnits(course).map((unit, i) => {
    const progress = progressOf(course.progress, unit.id);
    const statuses = progress.objectives;
    const { plan } = unit;
    const next =
      plan !== undefined &&
      statuses !== undefined &&
      leads?.kind === "in-progress" &&
      leads.unit.id === unit.id
        ? currentObjective(plan, positionOf(progress), statuses)
        : undefined;
    const objectives =
      plan === undefined || statuses === undefined
        ? undefined
        : plan.objectives.map((o) => ({
            id: o.id,
            statement: o.statement,
            status:
              (Object.hasOwn(statuses, o.id) ? statuses[o.id] : undefined) ??
              "not-started",
            next: o.id === next,
          }));
    return {
      number: i + 1,
      unit,
      status: progress.status,
      mark: unitMark(course, unit, leads?.unit.id),
      ...(objectives === undefined ? {} : { objectives }),
      passed: (objectives ?? []).filter((o) => hasPassed(o.status)).length,
      open: progress.status === "in-progress",
    };
  });
}

/**
 * The line under the course's title: how many units, how many finished, and
 * how many of the started units' objectives have passed, out of how many.
 * Passed is the units' counts summed: passed or retained, not slipping or
 * overridden, even in a finished unit.
 */
export interface CourseCounts {
  units: number;
  finished: number;
  passed: number;
  objectives: number;
}

export function courseCounts(course: CourseWithProgress): CourseCounts {
  const rows = unitRows(course);
  return {
    units: rows.length,
    finished: rows.filter((r) => isFinished(r.status)).length,
    passed: rows.reduce((sum, r) => sum + r.passed, 0),
    objectives: rows.reduce((sum, r) => sum + (r.objectives?.length ?? 0), 0),
  };
}
