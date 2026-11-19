// What the session view (docs/prototype/03-phases.html, 04-session-nav.html,
// 10-unit-end.html) says about where a unit stands, derived from its thread
// (timeline.ts): the position in the top line and the outline, the one
// next-step control, the open question and the lines between messages, the
// closing card, the test's result card (16-test-out-and-gate.html), and the
// unit's place in its course.

import type { TestShown } from "../shared/events.ts";
import type { AssessmentMode } from "../shared/evidence.ts";
import type { CourseWithProgress } from "../shared/library.ts";
import { firstTaught, type Plan, skipping } from "../shared/plan.ts";
import { confidenceLabel } from "../shared/question.ts";
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
import {
  type AssessmentEndItem,
  type AssessmentItem,
  type Item,
  type JudgmentItem,
  offersSteps,
  type Position,
  type QuestionItem,
  type TestResultItem,
  type Timeline,
  type UnitEndItem,
} from "./timeline.ts";

type Finished = Timeline["finished"];

/** Whether each of the plan's segments is skipped, since the learner skips what the test passed. */
function skippedSegments(plan: Plan, position: Position | null): boolean[] {
  return skipping(plan, position?.skipping ?? []).map(
    (s) => s.teaches.length === 0,
  );
}

/**
 * The position in the top line: "Segment 2 of 5", "Going over again",
 * "Testing out" while the test before the unit runs or its result waits,
 * "Unit gate" while the gate is under way, or "Finished", with one tick per
 * segment of the plan, a hollow one for a segment skipped. Null until the
 * unit is open.
 */
export function whereInUnit(
  plan: Plan,
  position: Position | null,
  finished: Finished,
  assessment: Timeline["assessment"] = null,
  testWaits = false,
): { label: string; ticks: Mark[] } | null {
  const count = plan.segments.length;
  const skipped = skippedSegments(plan, position);
  const marked = (ticks: Mark[]) =>
    ticks.map((mark, i) => (skipped[i] === true ? "skip" : mark));
  if (finished !== null) {
    return { label: "Finished", ticks: marked(Array(count).fill("past")) };
  }
  if (assessment?.mode === "gate" && assessment.stage === "on") {
    return { label: "Unit gate", ticks: marked(Array(count).fill("past")) };
  }
  if (position === null) return null;
  if (testWaits || assessment?.mode === "test-out") {
    return { label: "Testing out", ticks: Array(count).fill("") };
  }
  const stand = segmentStand(
    count,
    position.segment,
    position.again !== undefined,
  );
  return { ...stand, ticks: marked(stand.ticks) };
}

/** A segment as the unit's outline lists it, with a line under it when the test changed it. */
export interface OutlineSegment {
  title: string;
  state: Mark;
  /** "Skipped: passed in the test", or what a segment taught in part still teaches. */
  note?: string;
}

/** The unit's segments as its outline lists them. */
export function outline(
  plan: Plan,
  position: Position | null,
  finished: Finished,
): OutlineSegment[] {
  const again = finished === null && position?.again !== undefined;
  const at = finished !== null || again ? Infinity : (position?.segment ?? -1);
  const left = skipping(plan, position?.skipping ?? []);
  const statement = new Map(plan.objectives.map((o) => [o.id, o.statement]));
  const segments = plan.segments.map((s, i): OutlineSegment => {
    const teaches = left[i]?.teaches ?? s.objectives;
    if (teaches.length === 0) {
      return {
        title: s.title,
        state: "skip",
        note: "Skipped: passed in the test",
      };
    }
    const state: Mark = i < at ? "past" : i === at ? "now" : "";
    return teaches.length < s.objectives.length
      ? {
          title: s.title,
          state,
          note: `Only: ${teaches.map((id) => statement.get(id) ?? id).join(" ")}`,
        }
      : { title: s.title, state };
  });
  return again ? [...segments, { title: AGAIN, state: "now" }] : segments;
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
  if (finished !== null) {
    // A card that finished the unit holds the way out; one moved on from does not.
    const card = lastCard(timeline);
    return card !== undefined &&
      card.stepTaken === undefined &&
      !offersSteps(card)
      ? null
      : "leave";
  }
  if (position === null || plan === null) return null;
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

// --- Assessments (piece 15) ---------------------------------------------------

/** What an assessment is called on the page, capitalised for a marker's name. */
function runTitle(mode: AssessmentMode): string {
  return mode === "review" ? "Review" : mode === "gate" ? "Gate" : "Test";
}

/** "unit 2", or "units 1 and 2", or "other units" when the numbers are not known. */
function unitsNamed(from: readonly number[] | undefined): string {
  if (from === undefined || from.length === 0) return "other units";
  const names = from.map(String);
  return from.length === 1
    ? `unit ${names[0]}`
    : `units ${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/** The gate's questions: how many on the unit's own objectives, and how many on other units'. */
function gateSplit(item: Pick<AssessmentItem, "count" | "own">): {
  own: number;
  others: number;
} {
  const own = item.own ?? item.count;
  return { own, others: item.count - own };
}

/** What an assessment's card says while it waits for Start or Skip. */
export function assessmentCard(
  item: Pick<AssessmentItem, "mode" | "count" | "own" | "from">,
): {
  title: string;
  questions: string;
  says: string[];
  start: string;
  skip: string;
} {
  const questions = item.count === 1 ? "1 question" : `${item.count} questions`;
  if (item.mode === "gate") {
    const { own, others } = gateSplit(item);
    const mine =
      own === 1
        ? "the one objective you passed in this unit that no review has confirmed"
        : `each of the ${word(own)} objectives you passed in this unit that no review has confirmed`;
    const theirs = `${word(others)} on objectives of ${unitsNamed(item.from)}`;
    const asks =
      own === 0
        ? `${capital(word(others))} questions on objectives of ${unitsNamed(item.from)}`
        : others === 0
          ? `A question on ${mine}`
          : `A question on ${mine}, and ${theirs}`;
    return {
      title: "Unit gate",
      questions,
      says: [
        `${asks}, with nothing taught first. A right answer marks its ` +
          "objective retained; a miss is worked through, as in a check.",
        "It waits here, if you would rather take it in another sitting, " +
          "when the answers say more.",
      ],
      start: "Start the gate",
      skip: "Skip the gate",
    };
  }
  return {
    title: runTitle(item.mode),
    questions,
    says: [
      "Questions on objectives you passed in earlier sittings, to see what " +
        "has stayed. Nothing is taught first, and a right answer marks its " +
        "objective retained.",
      "The unit goes on afterwards, where you left it.",
    ],
    start: "Start the review",
    skip: "Skip",
  };
}

/** What "Skip the gate" asks before it skips, on the gate's card or in it. */
export const SKIP_GATE_ASKS =
  "The gate is offered once. What you passed stays passed, and nothing more is marked retained.";

/** The marker a card leaves once started, or skipped on the card. */
export function assessmentMarker(item: AssessmentItem): {
  name: string;
  says: string;
} {
  const title = runTitle(item.mode);
  const gate = item.mode === "gate";
  if (item.mode === "test-out") {
    return {
      name: title,
      says: "Questions on this unit's objectives, before anything is taught. Nothing is explained until it ends; each answer is recorded.",
    };
  }
  if (item.stage === "skipped") {
    return {
      name: `${title} skipped`,
      says: gate
        ? "What you passed stays passed. Nothing more is marked retained."
        : "The unit goes on where it was.",
    };
  }
  const count =
    item.count === 1
      ? "One question"
      : `${capital(word(item.count))} questions`;
  if (gate) {
    const { own, others } = gateSplit(item);
    const split =
      own === 0 || others === 0
        ? own === 0
          ? ` on objectives of ${unitsNamed(item.from)}`
          : " on this unit"
        : `: ${word(own)} on this unit and ${word(others)} from ${unitsNamed(item.from)}`;
    return {
      name: "Unit gate",
      says: `${count}${split}. Nothing is taught first; each answer is recorded.`,
    };
  }
  return {
    name: title,
    says: `${count} on objectives you passed before. Nothing is taught first; each answer is recorded.`,
  };
}

/**
 * The marker an assessment leaves once it ends, or is skipped partway: what
 * it did to the record, and where the unit goes on.
 */
export function assessmentEndMarker(item: AssessmentEndItem): {
  name: string;
  says: string;
} {
  const title = runTitle(item.mode);
  const gate = item.mode === "gate";
  // After the gate, the closing card says where the unit stands.
  const where = gate ? "" : ` ${goesOn(item.at)}`;
  const statuses = Object.values(item.statuses);
  if (item.skipped) {
    return {
      name: `${title} skipped`,
      says: gate
        ? statuses.length === 0
          ? "What you passed stays passed. Nothing more is marked retained."
          : "What you answered is recorded, and what you passed stays passed."
        : statuses.length === 0
          ? where.trimStart()
          : `What you answered is recorded.${where}`,
    };
  }
  const counts: [number, string][] = [
    [statuses.filter((s) => s === "retained").length, "retained"],
    [statuses.filter((s) => s === "slipping").length, "slipping"],
    [statuses.filter((s) => s === "passed").length, "passed, not yet retained"],
    [
      statuses.filter(
        (s) => s !== "retained" && s !== "slipping" && s !== "passed",
      ).length,
      "not passed",
    ],
  ];
  const parts = counts.filter(([n]) => n > 0);
  const [only] = parts;
  const said =
    parts.length === 1 && only !== undefined && only[0] > 1
      ? `All ${word(only[0])} ${only[1]}.`
      : `${capital(parts.map(([n, what]) => `${word(n)} ${what}`).join(", "))}.`;
  return { name: `${title} over`, says: `${said}${where}` };
}

/** Where the unit goes on after an assessment, from the phase it was in. */
function goesOn(at: Position | null): string {
  if (at === null) return "The unit goes on where it was.";
  const segment =
    at.again === undefined
      ? `segment ${at.segment + 1}`
      : "the segment going over objectives again";
  switch (at.phase) {
    case "teach":
      return `${capital(segment)} is taught next.`;
    case "discuss":
      return `Back to ${segment}, in its discussion.`;
    case "check":
      return `Back to ${segment}, in its check.`;
    case "closed":
      return `Back to the end of ${segment}.`;
  }
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
  const title = runTitle(timeline.assessment?.mode ?? "review").toLowerCase();
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
      : `Skip ${runTitle(mode).toLowerCase()}`;
}

// --- The test's result card (piece 16) -----------------------------------------

/** A row of the result card: an objective or a segment, its word, and why. */
export interface ResultRow {
  key: string;
  text: string;
  word: { text: string; className: string };
  why?: string;
}

export interface TestResultCard {
  /** "Two of five passed", "All three passed", "None passed". */
  says: { text: string; className: "ok" | "dk" };
  /** A row for each objective: passed or not, and why. */
  objectives: ResultRow[];
  /** What skipping would do to each segment; none when nothing passed. */
  segments: ResultRow[] | null;
  /** The heading over the segments. */
  segmentsSay: string;
  /** The steps' labels: the one that skips, and the one that teaches the whole unit. */
  skip: string;
  whole: string;
  /** Once answered, the line the card shrinks to. */
  answered?: string;
  /** Once answered by skipping some: where teaching starts. */
  startsAt?: string;
}

/** Why an objective passed or did not, from the test's answers on it (piece 16). */
function testWhy(shown: TestShown): string {
  const [first, second] = shown.answers;
  const sure = (a: TestShown["answers"][number]) =>
    `${confidenceLabel(a.confidence ?? "under-50")} sure${a.assisted ? ", with help" : ""}`;
  const missed = (a: TestShown["answers"][number]) =>
    a.verdict === "unknown" ? "did not know" : "missed";
  if (first === undefined) return "Not asked";
  if (first.verdict !== "correct") return capital(missed(first));
  if (second === undefined) {
    return shown.passed
      ? `Right, ${sure(first)}`
      : `Right once, ${sure(first)}; its second question was not asked`;
  }
  if (second.verdict === "correct") {
    // "Right twice, 50% and 75% sure", as piece 16 has it.
    return first.assisted || second.assisted
      ? `Right twice, ${sure(first)} and ${sure(second)}`
      : `Right twice, ${confidenceLabel(first.confidence ?? "under-50")} and ${sure(second)}`;
  }
  return `Right once, ${sure(first)}, then ${missed(second)}`;
}

export function testResultCard(
  plan: Plan,
  item: Pick<TestResultItem, "objectives" | "skipped">,
): TestResultCard {
  const shown = new Map(item.objectives.map((o) => [o.objective, o]));
  const passed = plan.objectives
    .map((o) => o.id)
    .filter((id) => shown.get(id)?.passed === true);
  const total = plan.objectives.length;
  const got = passed.length;
  const all = got === total;
  const says = {
    text: all
      ? total === 1
        ? "Passed"
        : `All ${word(total)} passed`
      : got === 0
        ? "None passed"
        : `${capital(word(got))} of ${word(total)} passed`,
    className: all ? ("ok" as const) : ("dk" as const),
  };
  const objectives = plan.objectives.map((o): ResultRow => {
    const row = shown.get(o.id);
    const ok = row?.passed === true;
    return {
      key: o.id,
      text: o.statement,
      word: ok
        ? { text: "Passed", className: "pass" }
        : { text: "Not passed", className: "miss" },
      why: row === undefined ? "Not asked" : testWhy(row),
    };
  });
  const statement = new Map(plan.objectives.map((o) => [o.id, o.statement]));
  const segments =
    got === 0
      ? null
      : skipping(plan, passed).map((left, i): ResultRow => {
          const text = `${i + 1}. ${plan.segments[i]?.title ?? ""}`;
          if (left.teaches.length === 0) {
            return {
              key: String(i),
              text,
              word: { text: "Skipped", className: "skip" },
            };
          }
          return left.leftOut.length === 0
            ? { key: String(i), text, word: { text: "Taught", className: "" } }
            : {
                key: String(i),
                text,
                word: { text: "Taught in part", className: "" },
                why: `Only: ${left.teaches.map((id) => statement.get(id) ?? id).join(" ")}`,
              };
        });
  const card: TestResultCard = {
    says,
    objectives,
    segments,
    segmentsSay: all
      ? "If you finish the unit here"
      : "If you skip what you passed",
    skip: all ? "Finish the unit" : "Skip what I passed",
    whole:
      got === 0
        ? "Start the unit"
        : all
          ? "Teach me the unit anyway"
          : "Teach me the whole unit",
  };
  const { skipped } = item;
  if (skipped === undefined) return card;
  if (skipped.length === 0)
    return { ...card, answered: "Teaching the whole unit." };
  const first = firstTaught(plan, skipped);
  if (first === undefined)
    return { ...card, answered: "Finished without teaching." };
  const part = (skipping(plan, skipped)[first]?.leftOut.length ?? 0) > 0;
  return {
    ...card,
    answered: "Skipping what you passed.",
    startsAt:
      `Teaching starts at segment ${first + 1}` +
      (part ? ", which leaves out what you passed in it" : "") +
      ". The outline, at the top right, shows what is skipped.",
  };
}

/** The unit was finished by skipping what the test passed, every objective of it. */
export function finishedByTest(timeline: Timeline): boolean {
  const card = timeline.items.findLast((i) => i.kind === "test_result");
  const { plan } = timeline;
  return (
    card?.kind === "test_result" &&
    plan !== null &&
    card.skipped !== undefined &&
    card.skipped.length > 0 &&
    firstTaught(plan, card.skipped) === undefined
  );
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
  const row = { id, statement, word: rowWord(status) };
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
