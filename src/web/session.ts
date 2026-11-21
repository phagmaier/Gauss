// What the session view (docs/prototype/03-phases.html, 10-unit-end.html,
// 19-unit-page.html) says about where a unit stands, derived from its thread
// (timeline.ts): the position in the top line and the outline, the one
// next-step control, the open question and the lines between messages, the
// closing card, the test's result card (16-test-out-and-gate.html), and the
// unit's place in its course.

import { assessmentTitle } from "../shared/assessment-view.ts";
import { capital, word } from "../shared/display-words.ts";
import type { CourseWithProgress } from "../shared/library.ts";
import {
  currentObjective,
  firstTaught,
  type Plan,
  skipping,
} from "../shared/plan.ts";
import {
  hasPassed,
  isFinished,
  type ObjectiveStatus,
} from "../shared/status.ts";
import {
  type AssessmentEndItem,
  type Item,
  type JudgmentItem,
  offersSteps,
  type PhaseItem,
  type Position,
  type QuestionItem,
  standingCard,
  type Timeline,
  type UnitEndItem,
} from "../shared/timeline.ts";
import {
  AGAIN,
  type Mark,
  type Numbered,
  nextInOrder,
  progressOf,
  segmentStand,
  type WhereInUnit,
} from "./progress.ts";

/** Whether each of the plan's segments is skipped, since the learner skips what the test passed. */
function skippedSegments(plan: Plan, position: Position | null): boolean[] {
  return skipping(plan, position?.skipping ?? []).map(
    (s) => s.teaches.length === 0,
  );
}

/** What the position and the outline read from the thread. */
type Where = Pick<
  Timeline,
  "items" | "position" | "finished" | "assessment" | "testWaits" | "statuses"
>;

/** The test runs, the tutor summarizes it, or the result waits for the learner. */
const testing = (t: Where) => t.testWaits || t.assessment?.mode === "test-out";

function latestGateIndex(items: readonly Item[]): number {
  return items.findLastIndex(
    (i) => i.kind === "assessment" && i.mode === "gate",
  );
}

function latestAgainIndex(items: readonly Item[]): number {
  return items.findLastIndex(
    (i) =>
      i.kind === "phase" && i.heading !== undefined && i.again !== undefined,
  );
}

/**
 * Where the assessment under way has got to, as its question's head says
 * it: "Question 2 of 4" in a review or a gate, "Objective 2 of 3" in a
 * test, whose questions on one objective can be two. None before its first
 * question.
 */
function assessmentCount(items: readonly Item[]): string | undefined {
  const from = items.findLastIndex((i) => i.kind === "assessment");
  const asked = items
    .slice(from + 1)
    .findLast((i): i is QuestionItem => i.kind === "question");
  const head = asked?.question.assessment;
  if (asked === undefined || head === undefined) return undefined;
  return head.objective === undefined
    ? `Question ${asked.question.number} of ${head.of}`
    : `Objective ${head.objective} of ${head.of}`;
}

/**
 * The position in the top line (piece 19): "Segment 2 of 5" with the
 * segment's title, "Going over again", "Review" while a review runs,
 * "Unit gate" from its card through the decision after it, "Testing out"
 * through the test's summary and result, or "Finished". An assessment
 * gives its count while asking questions. One tick per segment of the
 * plan, a hollow one for a segment skipped. Null until the unit is open.
 */
export function whereInUnit(plan: Plan, t: Where): WhereInUnit | null {
  const { position, assessment } = t;
  const count = plan.segments.length;
  const skipped = skippedSegments(plan, position);
  const marked = (ticks: Mark[]) =>
    ticks.map((mark, i) => (skipped[i] === true ? "skip" : mark));
  const at = (label: string, ticks: Mark[]): WhereInUnit => {
    const title = assessmentCount(t.items);
    return title === undefined ? { label, ticks } : { label, title, ticks };
  };
  if (t.finished !== null) {
    // A review the learner asked for in a finished unit's thread.
    if (assessment?.mode === "review" && assessment.stage === "on") {
      return at(assessmentTitle("review"), marked(Array(count).fill("past")));
    }
    return { label: "Finished", ticks: marked(Array(count).fill("past")) };
  }
  if (assessment?.mode === "gate") {
    return at("Unit gate", marked(Array(count).fill("past")));
  }
  if (position === null) return null;
  if (
    position.phase === "closed" &&
    latestGateIndex(t.items) > latestAgainIndex(t.items)
  ) {
    return { label: "Unit gate", ticks: marked(Array(count).fill("past")) };
  }
  if (testing(t)) {
    const ticks = Array(count).fill("");
    return t.testWaits
      ? { label: "Testing out", ticks }
      : at("Testing out", ticks);
  }
  const stand = segmentStand(
    count,
    position.segment,
    position.again !== undefined,
  );
  const ticks = marked(stand.ticks);
  if (assessment?.mode === "review" && assessment.stage === "on") {
    return at(assessmentTitle("review"), ticks);
  }
  const title =
    position.again === undefined
      ? plan.segments[position.segment]?.title
      : undefined;
  return title === undefined
    ? { label: stand.label, ticks }
    : { label: stand.label, title, ticks };
}

/** An objective as the outline lists it under its segment. */
export interface OutlineObjective {
  id: string;
  statement: string;
  status: ObjectiveStatus;
  /** The objective to do now (`currentObjective` in plan.ts): the accent's ringed form. */
  current: boolean;
  /** Passed in the test before the unit, and skipped. */
  skipped: boolean;
}

/** A segment as the unit's outline lists it (piece 19). */
export interface OutlineSegment {
  /** Its number in the plan; none for going over again. */
  number?: number;
  title: string;
  /** Done, here, skipped by the test, or still to come. */
  state: Mark;
  /** At its right: "You are here", how many passed, or why skipped. */
  says?: string;
  /** The id of its heading in the thread, for a past or current segment the thread has one for. */
  heading?: string;
  objectives: OutlineObjective[];
}

/** The unit's outline: its segments, and the gate where it falls. */
export interface UnitOutline {
  segments: OutlineSegment[];
  /** None for a unit that finished with no gate in its thread. */
  gate: { state: Mark; says: string } | null;
  /** The gate comes before the last row, going over again, which followed it. */
  gateBeforeLast: boolean;
}

/**
 * The unit's outline: the plan's segments, numbered, with their objectives
 * as they stand, then going over again once the unit has, and the gate.
 * While the test before the unit runs, no segment is here yet; once the
 * gate's card is offered, every segment is past.
 */
export function outline(plan: Plan, t: Where): UnitOutline {
  const { position, statuses, items } = t;
  const statement = new Map(plan.objectives.map((o) => [o.id, o.statement]));
  const headings = new Set(
    items.flatMap((i) =>
      i.kind === "phase" && i.heading !== undefined ? [i.heading] : [],
    ),
  );
  const gateIndex = latestGateIndex(items);
  const gateItem = items[gateIndex];
  const againIndex = latestAgainIndex(items);
  const again = items[againIndex];
  const gateBeforeAgain = gateIndex !== -1 && gateIndex < againIndex;
  const inAgain =
    t.finished === null &&
    t.assessment?.mode !== "gate" &&
    position?.again !== undefined &&
    (gateIndex === -1 || gateBeforeAgain);
  // Every segment of the plan is behind the unit once it finished, goes
  // over objectives again, or reached its gate; none is reached while the
  // test runs.
  const at =
    t.finished !== null || inAgain || gateItem !== undefined
      ? Infinity
      : testing(t)
        ? -1
        : (position?.segment ?? -1);
  const current = currentObjective(plan, position, statuses);
  const left = skipping(plan, position?.skipping ?? []);
  const row = (
    ids: readonly string[],
    teaches: readonly string[],
    state: Mark,
    heading: string | undefined,
  ) => {
    const objectives = ids.map(
      (id): OutlineObjective => ({
        id,
        statement: statement.get(id) ?? id,
        status: statuses[id] ?? "not-started",
        current: state === "now" && id === current,
        skipped: !teaches.includes(id),
      }),
    );
    const passed = objectives.filter((o) => hasPassed(o.status)).length;
    const says =
      state === "now"
        ? "You are here"
        : state === "past"
          ? `${passed} of ${ids.length} passed`
          : state === "skip"
            ? "Passed in the test"
            : undefined;
    return {
      state,
      ...(says === undefined ? {} : { says }),
      ...(heading !== undefined && headings.has(heading) && state !== ""
        ? { heading }
        : {}),
      objectives,
    };
  };
  const segments = plan.segments.map((s, i): OutlineSegment => {
    const teaches = left[i]?.teaches ?? s.objectives;
    const state: Mark =
      teaches.length === 0 ? "skip" : i < at ? "past" : i === at ? "now" : "";
    return {
      number: i + 1,
      title: s.title,
      ...row(s.objectives, teaches, state, `segment-${i + 1}`),
    };
  });
  const lastAgain = again?.kind === "phase" ? again : undefined;
  const againIds = inAgain ? position?.again : lastAgain?.again;
  if (againIds !== undefined) {
    segments.push({
      title: AGAIN,
      ...row(againIds, againIds, inAgain ? "now" : "past", lastAgain?.heading),
    });
  }
  return {
    segments,
    gate: gateRow(t, gateItem, plan.segments.length),
    gateBeforeLast: againIds !== undefined && gateBeforeAgain,
  };
}

/** The gate's row: here from its card on, then taken or skipped; to come while the unit is not finished. */
function gateRow(
  t: Where,
  card: Item | undefined,
  count: number,
): UnitOutline["gate"] {
  if (t.assessment?.mode === "gate") {
    return { state: "now", says: "You are here" };
  }
  if (card?.kind === "assessment") {
    const ended = t.items.findLast(
      (i): i is AssessmentEndItem =>
        i.kind === "assessment_end" && i.mode === "gate",
    );
    const skipped = card.stage === "skipped" || ended?.skipped === true;
    return { state: "past", says: skipped ? "Skipped" : "Taken" };
  }
  return t.finished === null
    ? { state: "", says: `After segment ${count}` }
    : null;
}

/**
 * The one control that moves the unit on, at the point the thread has
 * reached (mock 3): "ready" in the discussion, moving on in the check, and
 * in a detour asking for another question or moving on (task 2.20), the
 * next segment once one closes, and the way out of a finished unit. None in
 * teach (the test's result card waits only there, and holds its own steps),
 * while an answer waits for its grade (moving on is refused then),
 * or at the closing card, whose foot holds the steps. While an assessment
 * is under way (piece 15), its skip, and in its detour the step that ends
 * it; none while its card waits, which holds Start and Skip.
 */
export type NextStep =
  | "ready"
  | "move-on"
  | "detour"
  | "assessment"
  | "assessment-detour"
  | "next-segment"
  | "leave"
  | "try-again"
  | null;

export function nextStep(timeline: Timeline): NextStep {
  const { position, plan, finished } = timeline;
  if (timeline.failed !== null) return "try-again";
  if (finished !== null && timeline.assessment === null) {
    // Only a closing card that still stands holds the way out.
    const card = standingCard(timeline.items);
    return card !== undefined &&
      card.stepTaken === undefined &&
      !offersSteps(card)
      ? null
      : "leave";
  }
  // An assessment, a finished unit's review the learner asked for included.
  const run = timeline.assessment;
  if (run !== null) {
    if (run.stage === "offered") return null;
    if (timeline.detour !== null) return "assessment-detour";
    const open = openQuestion(timeline);
    return open === undefined ||
      open.canMoveOn === true ||
      (open.grading === undefined && open.waiting === undefined)
      ? "assessment"
      : null;
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
      // Skipped segments do not count: after the last taught, the unit ends.
      return position.again !== undefined ||
        firstTaught(plan, position.skipping ?? [], position.segment + 1) ===
          undefined
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
 * The question that still waits on the learner, in a check or an
 * assessment under way: one being answered, or an answer sent and not yet
 * graded. The page keeps it above the message box until it is graded or
 * withdrawn (task 2.18). Only a question of what is under way counts: an
 * assessment's own while one is (its questions carry their head), and the
 * check's otherwise, so an assessment's question whose withdrawal the thread
 * lost is not taken for the check's.
 */
export function openQuestion(timeline: Timeline): QuestionItem | undefined {
  const inRun = timeline.assessment?.stage === "on";
  if (!inRun && timeline.position?.phase !== "check") return undefined;
  const open = timeline.items.findLast(
    (i) =>
      i.kind === "question" && (i.question.assessment !== undefined) === inRun,
  );
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

/** A segment's heading in the thread, where it begins (piece 19). */
export interface SegmentHeading {
  /** What the unit's outline jumps to (`PhaseItem` in timeline.ts). */
  id: string;
  /** "Segment 2 of 5"; none for going over again, which its title names. */
  label?: string;
  title: string;
  /** The objectives it teaches, as they stand now. */
  objectives: {
    id: string;
    statement: string;
    status: ObjectiveStatus;
    /** The objective to do now, drawn in the accent's ringed form. */
    current: boolean;
  }[];
}

/**
 * The heading of the segment a phase begins, if it begins one: "Segment N of
 * M" and the segment's title, or "Going over again", with the objectives it
 * teaches. `current` is the objective to do now (`currentObjective` in
 * plan.ts), marked only in the heading of the segment the unit is in.
 */
export function segmentHeading(
  plan: Plan,
  item: PhaseItem,
  statuses: Readonly<Record<string, ObjectiveStatus>>,
  current: string | undefined,
): SegmentHeading | undefined {
  if (item.heading === undefined) return undefined;
  const segment = plan.segments[item.segment];
  const ids = item.again ?? segment?.objectives;
  if (ids === undefined) return undefined;
  const statement = new Map(plan.objectives.map((o) => [o.id, o.statement]));
  return {
    id: item.heading,
    ...(item.again === undefined && segment !== undefined
      ? {
          label: `Segment ${item.segment + 1} of ${plan.segments.length}`,
          title: segment.title,
        }
      : { title: AGAIN }),
    objectives: ids.map((id) => ({
      id,
      statement: statement.get(id) ?? id,
      status: statuses[id] ?? "not-started",
      current: id === current,
    })),
  };
}

/**
 * The hairline where a phase begins, with its name (mock 3, piece 19); a
 * segment's teaching comes under the segment's heading.
 */
export function phaseMarker(position: Position): {
  name: string;
  says?: string;
} {
  switch (position.phase) {
    case "teach":
      return { name: "Teach" };
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

// --- Assessments (piece 15) ---------------------------------------------------

/** What "Skip the gate" asks before it skips: what it says, and its two buttons. */
export interface SkipGateAsks {
  says: string[];
  skip: string;
  stay: string;
}

/** What "Skip the gate" asks on the gate's card. */
export const SKIP_GATE_ASKS: SkipGateAsks = {
  says: [
    "The gate is offered once. What you passed stays passed, and nothing more is marked retained.",
  ],
  skip: "Skip the gate",
  stay: "Stay",
};

/**
 * What "Skip the gate" asks once the gate has started (piece 19), with the
 * answers given in it so far. Leaving instead keeps the open question or
 * detour for the next sitting.
 */
export function skipGatePartway(timeline: Timeline): SkipGateAsks {
  const at = timeline.items.findLastIndex((i) => i.kind === "assessment");
  const answers = timeline.items
    .slice(at + 1)
    .filter(
      (i) =>
        i.kind === "question" &&
        i.question.assessment !== undefined &&
        i.graded !== undefined,
    ).length;
  const count =
    answers === 0
      ? ""
      : answers === 1
        ? " Your one answer so far counts."
        : ` Your ${word(answers)} answers so far count.`;
  return {
    says: [
      `Skip the rest of the gate?${count} Any open question is dropped. Nothing more is marked retained, and the gate is not offered again.`,
      "To stop for now instead, just leave: the gate picks up where you left off when you come back.",
    ],
    skip: "Skip the rest of the gate",
    stay: "Keep going",
  };
}

/**
 * What ends a detour in an assessment: another question on its objective
 * after a first miss; after a second, going on to the next objective, or
 * the end. Skip stays beside it, but for the end.
 */
export function assessmentDetourStep(timeline: Timeline): {
  label: string;
  skip: boolean;
} {
  const title = assessmentTitle(
    timeline.assessment?.mode ?? "review",
  ).toLowerCase();
  const missed = timeline.items.findLast(
    (i) =>
      i.kind === "question" && i.question.id === timeline.detour?.questionId,
  );
  const head =
    missed?.kind === "question" ? missed.question.assessment : undefined;
  if (head?.second !== true) {
    return { label: "Ready for another question", skip: true };
  }
  return missed?.kind === "question" && missed.question.number >= head.of
    ? { label: `Finish the ${title}`, skip: false }
    : { label: `Go on with the ${title}`, skip: true };
}

/** "Skip review", "Skip the gate", or the test's "Start learning instead", beside an assessment's question or detour. */
export function skipLabel(timeline: Timeline): string {
  const mode = timeline.assessment?.mode ?? "review";
  return mode === "gate"
    ? "Skip the gate"
    : mode === "test-out"
      ? "Start learning instead"
      : "Skip review";
}

/** The unit was finished by skipping what the test passed, every objective of it. */
export function finishedByTest(timeline: Timeline): boolean {
  const { finished, plan, position } = timeline;
  const skipped = position?.skipping;
  return (
    finished !== null &&
    plan !== null &&
    skipped !== undefined &&
    firstTaught(plan, skipped) === undefined
  );
}

// --- The closing card ----------------------------------------------------------

/**
 * Why an objective did not pass, as the card's row says it (piece 10). A
 * check now goes on until each objective passes (task 2.19), so one only
 * attempted at the unit's end is from a check closed at the old limit.
 */
const WHY: Record<Exclude<ObjectiveStatus, "passed" | "retained">, string> = {
  slipping: "It passed, then was missed in a review or a gate",
  attempted: "Its check ended before it passed",
  overridden: "You moved on before it passed",
  "not-started": "Not checked yet",
};

/** A row's word and the class that colours it (pieces 10 and 16). */
function rowWord(status: ObjectiveStatus): { text: string; className: string } {
  switch (status) {
    case "passed":
      return { text: "Passed", className: "pass" };
    case "retained":
      return { text: "Retained", className: "kept" };
    case "slipping":
      return { text: "Slipping", className: "slip" };
    default:
      return { text: "Not passed", className: "miss" };
  }
}

export interface ClosingCardRow {
  id: string;
  statement: string;
  status: ObjectiveStatus;
  passed: boolean;
  word: { text: string; className: string };
  why?: string;
}

export interface ClosingCard {
  verdict: { text: string; className: "ok" | "warn" };
  /** "Five of seven objectives passed." Retained ones are passed; slipping ones are not. */
  summary: string;
  /** One row per objective, in the plan's order. */
  rows: ClosingCardRow[];
  /** After the gate: a row per objective of another unit it asked, in its order. */
  others: ClosingCardRow[];
  notPassed: number;
  /** It offers its two steps: going over again, or moving on without them. */
  steps: boolean;
  /** The label of the step that goes over the objectives not passed again. */
  again: string;
  /** The note once the learner has moved on without them. */
  movedOn: string;
}

function cardRow(id: string, statement: string, status: ObjectiveStatus) {
  const row = { id, statement, status, word: rowWord(status) };
  return status === "passed" || status === "retained"
    ? { ...row, passed: true }
    : { ...row, passed: false, why: WHY[status] };
}

export function closingCard(
  plan: Plan,
  card: Pick<UnitEndItem, "passed" | "objectives" | "stepTaken" | "gate">,
): ClosingCard {
  const rows = plan.objectives.map((o) =>
    cardRow(o.id, o.statement, card.objectives[o.id] ?? "not-started"),
  );
  // Another unit's row names it and distinguishes a skip from a miss.
  const others = (card.gate?.others ?? []).map((o) => {
    const row = cardRow(o.objective, o.statement, o.status);
    const unit = `Unit ${o.unit.number}: ${o.unit.title}`;
    return {
      ...row,
      why:
        o.unanswered === true
          ? `${unit}. Not answered in the gate.`
          : o.status === "slipping"
            ? `${unit}. Missed in the gate: review comes back to it first.`
            : unit,
    };
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

  const steps = offersSteps(card);
  const verdict: ClosingCard["verdict"] = card.passed
    ? { text: "Passed", className: "ok" }
    : card.stepTaken === "moved-on" || !steps
      ? { text: "Overridden", className: "warn" }
      : { text: `${capital(word(missed))} not passed`, className: "warn" };
  // After the gate, the steps cover what it left not passed.
  const toGoOver = card.gate?.goOver.length ?? missed;

  return {
    verdict,
    summary,
    rows,
    others,
    notPassed: missed,
    steps,
    again:
      toGoOver === 1
        ? "Go over it again"
        : `Go over the ${word(toGoOver)} again`,
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
