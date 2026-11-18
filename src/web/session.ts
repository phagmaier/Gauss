// What the session view (docs/prototype/03-phases.html, 04-session-nav.html,
// 10-unit-end.html) says about where a unit stands, derived from its thread
// (timeline.ts): the position in the top line and the outline, the one
// next-step control, the open question and the lines between messages, the
// closing card, and the unit's place in its course.

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
import type {
  Item,
  JudgmentItem,
  Position,
  QuestionItem,
  Timeline,
  UnitEndItem,
} from "./timeline.ts";

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
 * reached (mock 3): "ready" in the discussion, moving on in the check, and
 * in a detour asking for another question or moving on (task 2.20), the
 * next segment once one closes, and the way out of a finished unit. None in
 * teach, while an answer waits for its grade (moving on is refused then),
 * or at the closing card, whose foot holds the steps.
 */
export type NextStep =
  | "ready"
  | "move-on"
  | "detour"
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
      if (timeline.detour !== null) return "detour";
      const open = openQuestion(timeline);
      return open?.canMoveOn === true ||
        (open?.grading === undefined && open?.waiting === undefined)
        ? "move-on"
        : null;
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

// --- The thread ----------------------------------------------------------------

/**
 * The question that still waits on the learner, in a check: one being
 * answered, or an answer sent and not yet graded. The page keeps it above
 * the message box until it is graded or withdrawn (task 2.18).
 */
export function openQuestion(timeline: Timeline): QuestionItem | undefined {
  if (timeline.position?.phase !== "check") return undefined;
  const open = timeline.items.findLast((i) => i.kind === "question");
  return open?.kind === "question" &&
    open.graded === undefined &&
    open.withdrawn !== true
    ? open
    : undefined;
}

/**
 * What the message box says while a question waits for its answer (task
 * 2.21): asking what it means is free, and a reply that helps toward the
 * answer is help. Nothing once an answer is sent, since a message then is
 * not help.
 */
export function helpNotice(timeline: Timeline): string | undefined {
  const open = openQuestion(timeline);
  if (
    open === undefined ||
    open.grading !== undefined ||
    open.waiting !== undefined
  ) {
    return undefined;
  }
  return (
    `Asking what question ${open.question.number} means is free. If the ` +
    "tutor's reply helps you toward the answer, your answer counts as " +
    "given with help and not toward passing."
  );
}

/** What the line under a reply says of the judge's call on it (task 2.21). */
export function judgmentSays(item: JudgmentItem): {
  text: string;
  /** "help" for a call that makes the answer given with help. */
  tone: "judging" | "free" | "help";
} {
  const n = item.number;
  if (item.verdict === undefined) {
    return {
      text: `Checking whether this reply helped with question ${n}`,
      tone: "judging",
    };
  }
  if (item.verdict === "clarification") {
    return {
      text: `Judged clarification: this reply does not count as help with question ${n}.`,
      tone: "free",
    };
  }
  const why =
    item.unjudged === "failed"
      ? "This reply could not be judged, so it counts as help"
      : item.unjudged === "restart"
        ? "The server stopped before this reply was judged, so it counts as help"
        : "Judged help";
  return {
    text: `${why}: your answer to question ${n} will not count toward passing.`,
    tone: "help",
  };
}

/** The items that are messages, between which a dividing line can go. */
const MESSAGES = new Set<Item["kind"]>([
  "learner",
  "tutor",
  "question",
  "answered-below",
  "unit_end",
]);

/** The line for a file the tutor wrote, or the reference to an artifact it showed. */
const inReply = (item: Item) =>
  item.kind === "file" || item.kind === "artifact";

/**
 * The line left where a question was posted stands for the question there,
 * and the lines for a file the tutor wrote and an artifact it showed belong
 * to the tutor's reply.
 */
const asPosted = (item: Item) =>
  item.kind === "answered-below"
    ? "question"
    : inReply(item)
      ? "tutor"
      : item.kind;

/**
 * Whether a dividing line goes above an item, the one before it in the
 * thread given (task 2.18). Lines go between messages: the tutor's, the
 * learner's, a question and the closing card. None at the top of the thread
 * or next to a marker, which sets the item apart already; none above a note
 * from the page, which belongs to what it follows; and none inside one
 * exchange: between the tutor's lead-in and the question it posted, between
 * a question and the tutor's feedback on its answer, or between two of the
 * learner's messages in a row. A question answered below where it was
 * posted begins its exchange where it was answered (`moved`). The line for
 * a file the tutor wrote, and the reference to an artifact it showed, are
 * part of its reply, which can go on below them.
 */
export function divided(before: Item | undefined, item: Item): boolean {
  if (before === undefined || !MESSAGES.has(item.kind)) return false;
  // A note or the judge's call belongs to the message before it.
  if (
    !MESSAGES.has(before.kind) &&
    before.kind !== "note" &&
    before.kind !== "judgment" &&
    !inReply(before)
  ) {
    return false;
  }
  // A question answered further down than it was posted begins an exchange
  // there: its answer and the tutor's feedback.
  if (item.kind === "question" && item.moved === true) return true;
  if (inReply(before) && item.kind === "tutor") return false;
  const pair = `${asPosted(before)} ${asPosted(item)}`;
  return (
    pair !== "tutor question" &&
    pair !== "question tutor" &&
    pair !== "learner learner"
  );
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

/** What a detour's marker says after its name (task 2.20). */
export function detourSays(number: number): string {
  return `Working through question ${number}. Nothing here is graded or counts as help.`;
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

/**
 * Why an objective did not pass, as the card's row says it (piece 10). A
 * check now goes on until each objective passes (task 2.19), so one only
 * attempted at the unit's end is from a check closed at the old limit.
 */
const WHY: Record<Exclude<ObjectiveStatus, "passed">, string> = {
  attempted: "Its check ended before it passed",
  overridden: "You moved on before it passed",
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
