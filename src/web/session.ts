// What the session view (docs/prototype/03-phases.html, 04-session-nav.html,
// 10-unit-end.html) says about where a unit stands, derived from its thread
// (timeline.ts): the position in the top line and the outline, the one
// next-step control, the closing card, and the unit's place in its course.

import type { CourseWithProgress } from "../shared/library.ts";
import type { Plan } from "../shared/plan.ts";
import type { ObjectiveStatus } from "../shared/status.ts";
import {
  AGAIN,
  isFinished,
  type Mark,
  type Numbered,
  nextInOrder,
  progressOf,
  segmentStand,
} from "./progress.ts";
import type { Position, Timeline, UnitEndItem } from "./timeline.ts";

type Finished = Timeline["finished"];

/**
 * The position in the top line: "Segment 2 of 5", "Going over again" or
 * "Finished", with one tick per segment of the plan. Null until the unit is
 * open.
 */
export function whereInUnit(
  plan: Plan,
  position: Position | null,
  finished: Finished,
): { label: string; ticks: Mark[] } | null {
  const count = plan.segments.length;
  if (finished !== null) {
    return { label: "Finished", ticks: Array(count).fill("past") };
  }
  if (position === null) return null;
  return segmentStand(count, position.segment, position.again !== undefined);
}

/** The unit's segments as its outline lists them. */
export function outline(
  plan: Plan,
  position: Position | null,
  finished: Finished,
): { title: string; state: Mark }[] {
  const again = finished === null && position?.again !== undefined;
  const at = finished !== null || again ? Infinity : (position?.segment ?? -1);
  const segments = plan.segments.map((s, i) => ({
    title: s.title,
    state: (i < at ? "past" : i === at ? "now" : "") as Mark,
  }));
  return again ? [...segments, { title: AGAIN, state: "now" }] : segments;
}

/**
 * The one control that moves the unit on, at the point the thread has
 * reached (mock 3): "ready" in the discussion, moving on in the check, the
 * next segment once one closes, and the way out of a finished unit. None in
 * teach, while a written answer waits for its grade (moving on is refused
 * then), or at the closing card, whose foot holds the steps.
 */
export type NextStep =
  | "ready"
  | "move-on"
  | "next-segment"
  | "leave"
  | "try-again"
  | null;

export function nextStep(timeline: Timeline): NextStep {
  const { position, plan, finished } = timeline;
  if (timeline.failed !== null) return "try-again";
  if (finished !== null) {
    const card = lastCard(timeline);
    return card?.passed === true ? null : "leave";
  }
  if (position === null || plan === null) return null;
  switch (position.phase) {
    case "teach":
      return null;
    case "discuss":
      return "ready";
    case "check": {
      const open = timeline.items.findLast(
        (i) => i.kind === "question" && i.graded === undefined && !i.withdrawn,
      );
      return open?.kind === "question" && open.grading !== undefined
        ? null
        : "move-on";
    }
    case "closed":
      return position.segment >= plan.segments.length - 1
        ? null
        : "next-segment";
  }
}

/** The thread's last closing card, if it has one. */
export function lastCard(timeline: Timeline): UnitEndItem | undefined {
  const card = timeline.items.findLast((i) => i.kind === "unit_end");
  return card?.kind === "unit_end" ? card : undefined;
}

/**
 * The marker line where a phase begins (mock 3). A segment's teaching has
 * none: it starts well clear of the segment before (mock 4), or at the top
 * of the thread. The segment that goes over objectives again says so (mock
 * 10).
 */
export function phaseMarker(
  position: Position,
  first: boolean,
): { name: string; says?: string } | "new-segment" | null {
  switch (position.phase) {
    case "teach": {
      const { again } = position;
      if (again !== undefined) {
        return {
          name: "Teach",
          says:
            again.length === 1
              ? "Going over one objective again."
              : `Going over ${word(again.length)} objectives again.`,
        };
      }
      return first ? null : "new-segment";
    }
    case "discuss":
      return { name: "Discuss", says: "Ask anything. Nothing here is graded." };
    case "check":
      return {
        name: "Check",
        says: "Questions on this segment. Each answer is recorded.",
      };
    case "closed":
      return { name: "Done" };
  }
}

// --- The closing card ----------------------------------------------------------

const WORDS = [
  "no",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
];
const word = (n: number) => WORDS[n] ?? String(n);
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Why an objective did not pass, as the card's row says it (piece 10). */
const WHY: Record<Exclude<ObjectiveStatus, "passed">, string> = {
  attempted: "The check reached its limit of questions",
  overridden: "You moved on without the check",
  "not-started": "Not checked yet",
};

export interface ClosingCard {
  verdict: { text: string; className: "ok" | "warn" };
  /** "Five of seven objectives passed." */
  summary: string;
  /** One row per objective, in the plan's order. */
  rows: { id: string; statement: string; passed: boolean; why?: string }[];
  notPassed: number;
  /** The label of the step that goes over the objectives not passed again. */
  again: string;
  /** The note once the learner has moved on without them. */
  movedOn: string;
}

export function closingCard(
  plan: Plan,
  card: Pick<UnitEndItem, "passed" | "objectives" | "stepTaken">,
): ClosingCard {
  const rows = plan.objectives.map((o) => {
    const status = card.objectives[o.id] ?? "not-started";
    return status === "passed"
      ? { id: o.id, statement: o.statement, passed: true }
      : { id: o.id, statement: o.statement, passed: false, why: WHY[status] };
  });
  const total = rows.length;
  const missed = rows.filter((r) => !r.passed).length;
  const passed = total - missed;

  let summary: string;
  if (total === 1) {
    summary =
      missed === 0
        ? "Its one objective passed."
        : "Its one objective did not pass.";
  } else if (missed === 0) {
    summary = `All ${word(total)} objectives passed.`;
  } else if (passed === 0) {
    summary = `None of the ${word(total)} objectives passed.`;
  } else {
    summary = `${capital(word(passed))} of ${word(total)} objectives passed.`;
  }

  const verdict: ClosingCard["verdict"] = card.passed
    ? { text: "Passed", className: "ok" }
    : card.stepTaken === "moved-on"
      ? { text: "Overridden", className: "warn" }
      : { text: `${capital(word(missed))} not passed`, className: "warn" };

  return {
    verdict,
    summary,
    rows,
    notPassed: missed,
    again:
      missed === 1 ? "Go over it again" : `Go over the ${word(missed)} again`,
    movedOn:
      "You moved on. The unit is recorded as overridden, and " +
      (total === 1
        ? "its objective stays not passed."
        : missed === 1
          ? "the one objective stays not passed."
          : `the ${word(missed)} objectives stay not passed.`),
  };
}

/** Where a unit sits in its course: what the top line, outline and closing card name. */
export interface Placement {
  courseTitle: string;
  title: string;
  /** Its number in the course's list, from 1. */
  number: number;
  /** How many units the course has. */
  count: number;
  /**
   * The unit to start once this one is finished, with its number: the next
   * in order (progress.ts), counting this one finished. Null when every other
   * unit is started or waits on one that is not finished.
   */
  next: Numbered | null;
  /** Every other unit is finished, so finishing this one finishes the course. */
  finishesCourse: boolean;
}

/**
 * The unit's place, once its course is loaded. Undefined while it is not,
 * after a failed load, and for a unit the course does not have: never taken
 * for the course's last unit.
 */
export function placement(
  stored: CourseWithProgress | null | undefined,
  unitId: string,
): Placement | undefined {
  const units = stored?.curriculum?.units;
  if (stored == null || units === undefined) return undefined;
  const at = units.findIndex((u) => u.id === unitId);
  const unit = units[at];
  if (unit === undefined) return undefined;
  const others = units.filter((u) => u.id !== unitId);
  return {
    courseTitle: stored.course.title,
    title: unit.title,
    number: at + 1,
    count: units.length,
    next: nextInOrder(units, {
      ...stored.progress,
      [unitId]: { status: "passed" },
    }),
    finishesCourse: others.every((u) =>
      isFinished(progressOf(stored.progress, u.id).status),
    ),
  };
}
