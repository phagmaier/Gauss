import { expect, test } from "vitest";
import type { Unit } from "../shared/curriculum.ts";
import type { PageEvent } from "../shared/events.ts";
import type { CourseWithProgress } from "../shared/library.ts";
import type { Plan } from "../shared/plan.ts";
import type { ObjectiveStatus } from "../shared/status.ts";
import {
  closingCard,
  nextStep,
  outline,
  phaseMarker,
  placement,
  whereInUnit,
} from "./session.ts";
import {
  emptyTimeline,
  type Position,
  reduce,
  type Timeline,
} from "./timeline.ts";

const PLAN: Plan = {
  objectives: [
    { id: "power-rule", statement: "Differentiate a power of x." },
    { id: "product-rule", statement: "Apply the product rule." },
    { id: "chain-rule", statement: "Apply the chain rule." },
  ],
  segments: [
    { title: "Powers", objectives: ["power-rule"] },
    { title: "Products", objectives: ["product-rule"] },
    { title: "The chain rule", objectives: ["chain-rule"] },
  ],
};

function play(events: PageEvent[]): Timeline {
  return events.reduce(
    (state, event, index) => reduce(state, { type: "event", index, event }),
    reduce(emptyTimeline, { type: "hello", chatId: "chat-1" }),
  );
}

const planned: PageEvent = { type: "unit_plan", plan: PLAN };
const phase = (
  segment: number,
  p: "teach" | "discuss" | "check" | "closed",
  again?: string[],
): PageEvent => ({
  type: "phase",
  segment,
  phase: p,
  ...(again === undefined ? {} : { again }),
});

// --- The top line and the outline ------------------------------------------

test.each<
  [
    string,
    Position | null,
    Timeline["finished"],
    ReturnType<typeof whereInUnit>,
  ]
>([
  [
    "the first segment",
    { segment: 0, phase: "teach" },
    null,
    { label: "Segment 1 of 3", ticks: ["now", "", ""] },
  ],
  [
    "a middle segment, closed",
    { segment: 1, phase: "closed" },
    null,
    { label: "Segment 2 of 3", ticks: ["past", "now", ""] },
  ],
  [
    "the segment that goes over objectives again",
    { segment: 3, phase: "discuss", again: ["chain-rule"] },
    null,
    { label: "Going over again", ticks: ["past", "past", "now"] },
  ],
  [
    "a finished unit",
    { segment: 2, phase: "closed" },
    "passed",
    { label: "Finished", ticks: ["past", "past", "past"] },
  ],
  [
    "a finished unit opened again, with no position",
    null,
    "overridden",
    { label: "Finished", ticks: ["past", "past", "past"] },
  ],
])("the top line for %s", (_, position, finished, expected) => {
  expect(whereInUnit(PLAN, position, finished)).toEqual(expected);
});

test("before the unit is open the top line says nothing", () => {
  expect(whereInUnit(PLAN, null, null)).toBeNull();
});

test("the outline marks the segments done and the one in progress, and adds the segment that goes over objectives again", () => {
  expect(outline(PLAN, { segment: 1, phase: "check" }, null)).toEqual([
    { title: "Powers", state: "past" },
    { title: "Products", state: "now" },
    { title: "The chain rule", state: "" },
  ]);
  expect(
    outline(PLAN, { segment: 3, phase: "teach", again: ["chain-rule"] }, null),
  ).toEqual([
    { title: "Powers", state: "past" },
    { title: "Products", state: "past" },
    { title: "The chain rule", state: "past" },
    { title: "Going over again", state: "now" },
  ]);
  expect(outline(PLAN, null, "passed")).toEqual([
    { title: "Powers", state: "past" },
    { title: "Products", state: "past" },
    { title: "The chain rule", state: "past" },
  ]);
});

test("each phase but teaching has a marker; a segment's teaching starts clear of the one before, and going over again says how many", () => {
  expect(phaseMarker({ segment: 0, phase: "teach" }, true)).toBeNull();
  expect(phaseMarker({ segment: 1, phase: "teach" }, false)).toBe(
    "new-segment",
  );
  expect(
    phaseMarker(
      { segment: 3, phase: "teach", again: ["product-rule", "chain-rule"] },
      false,
    ),
  ).toEqual({ name: "Teach", says: "Going over two objectives again." });
  expect(
    phaseMarker({ segment: 3, phase: "teach", again: ["chain-rule"] }, true),
  ).toEqual({ name: "Teach", says: "Going over one objective again." });
  expect(phaseMarker({ segment: 0, phase: "discuss" }, true)).toEqual({
    name: "Discuss",
    says: "Ask anything. Nothing here is graded.",
  });
  expect(phaseMarker({ segment: 0, phase: "check" }, false)).toMatchObject({
    name: "Check",
  });
  expect(phaseMarker({ segment: 0, phase: "closed" }, false)).toEqual({
    name: "Done",
  });
});

// --- The next-step control ---------------------------------------------------

const CHOICE = {
  kind: "choice" as const,
  id: "q1",
  number: 1,
  prompt: "What is the derivative of $x^3$?",
  choices: ["$3x^2$", "$x^2$"],
};
const WRITTEN = {
  kind: "written" as const,
  id: "q2",
  number: 2,
  prompt: "Prove the product rule.",
};
const PROOF = {
  kind: "written" as const,
  questionId: "q2",
  text: "Add and subtract.",
  confidence: "50" as const,
};

test.each<[string, PageEvent[], ReturnType<typeof nextStep>]>([
  ["while the unit opens", [], null],
  ["while it is planned", [{ type: "unit_planning" }], null],
  [
    "after it failed to open",
    [{ type: "unit_failed", error: "No plan." }],
    "try-again",
  ],
  ["in teach", [planned, phase(0, "teach")], null],
  ["in discuss", [planned, phase(0, "discuss")], "ready"],
  ["in the check", [planned, phase(0, "check")], "move-on"],
  [
    "in the check with a question open",
    [planned, phase(0, "check"), { type: "question", question: CHOICE }],
    "move-on",
  ],
  [
    "while a written answer is graded",
    [
      planned,
      phase(0, "check"),
      { type: "question", question: WRITTEN },
      { type: "grading", questionId: "q2", answer: PROOF },
    ],
    null,
  ],
  [
    "after its grading failed",
    [
      planned,
      phase(0, "check"),
      { type: "question", question: WRITTEN },
      { type: "grading", questionId: "q2", answer: PROOF },
      { type: "grading_failed", questionId: "q2", error: "Timed out." },
    ],
    null,
  ],
  [
    "once it is graded",
    [
      planned,
      phase(0, "check"),
      { type: "question", question: WRITTEN },
      { type: "grading", questionId: "q2", answer: PROOF },
      {
        type: "graded",
        questionId: "q2",
        verdict: "correct",
        answer: PROOF,
        assisted: false,
      },
    ],
    "move-on",
  ],
  [
    "a segment closed before the last",
    [planned, phase(1, "closed")],
    "next-segment",
  ],
  // The closing card holds the steps.
  ["the last segment closed", [planned, phase(2, "closed")], null],
  [
    "the extra segment closed",
    [planned, phase(3, "closed", ["chain-rule"])],
    null,
  ],
  [
    "a unit passed at its closing card",
    [
      planned,
      phase(2, "closed"),
      { type: "unit_end", passed: true, objectives: {} },
      { type: "unit_closed", status: "passed" },
    ],
    null,
  ],
  [
    "a unit moved on from at its closing card",
    [
      planned,
      phase(2, "closed"),
      { type: "unit_end", passed: false, objectives: {} },
      { type: "unit_closed", status: "overridden" },
    ],
    "leave",
  ],
  [
    "a finished unit opened again",
    [planned, { type: "unit_closed", status: "passed" }],
    "leave",
  ],
])("the next step %s", (_, events, step) => {
  expect(nextStep(play(events))).toBe(step);
});

// --- The closing card --------------------------------------------------------

const all = (status: ObjectiveStatus) => ({
  "power-rule": status,
  "product-rule": status,
  "chain-rule": status,
});

test("a closing card when every objective passed", () => {
  expect(
    closingCard(PLAN, { passed: true, objectives: all("passed") }),
  ).toMatchObject({
    verdict: { text: "Passed", className: "ok" },
    summary: "All three objectives passed.",
    rows: [
      {
        id: "power-rule",
        statement: "Differentiate a power of x.",
        passed: true,
      },
      {
        id: "product-rule",
        statement: "Apply the product rule.",
        passed: true,
      },
      { id: "chain-rule", statement: "Apply the chain rule.", passed: true },
    ],
    notPassed: 0,
  });
});

test("a closing card when some did not pass says why for each, and how many", () => {
  const card = closingCard(PLAN, {
    passed: false,
    objectives: {
      "power-rule": "passed",
      "product-rule": "attempted",
      "chain-rule": "overridden",
    },
  });

  expect(card.verdict).toEqual({ text: "Two not passed", className: "warn" });
  expect(card.summary).toBe("One of three objectives passed.");
  expect(card.rows).toEqual([
    {
      id: "power-rule",
      statement: "Differentiate a power of x.",
      passed: true,
    },
    {
      id: "product-rule",
      statement: "Apply the product rule.",
      passed: false,
      why: "The check reached its limit of questions",
    },
    {
      id: "chain-rule",
      statement: "Apply the chain rule.",
      passed: false,
      why: "You moved on without the check",
    },
  ]);
  expect(card.notPassed).toBe(2);
  expect(card.again).toBe("Go over the two again");
  expect(card.movedOn).toBe(
    "You moved on. The unit is recorded as overridden, and the two objectives stay not passed.",
  );
});

test("once moved on from, the card's verdict is overridden", () => {
  expect(
    closingCard(PLAN, {
      passed: false,
      objectives: all("overridden"),
      stepTaken: "moved-on",
    }),
  ).toMatchObject({
    verdict: { text: "Overridden", className: "warn" },
    summary: "None of the three objectives passed.",
  });
});

test("a unit of one objective, not passed, is spoken of in the singular", () => {
  const one: Plan = {
    objectives: [{ id: "bayes", statement: "Apply Bayes' theorem." }],
    segments: [{ title: "Bayes", objectives: ["bayes"] }],
  };

  expect(
    closingCard(one, { passed: false, objectives: { bayes: "attempted" } }),
  ).toMatchObject({
    verdict: { text: "One not passed", className: "warn" },
    summary: "Its one objective did not pass.",
    again: "Go over it again",
    movedOn:
      "You moved on. The unit is recorded as overridden, and its objective stays not passed.",
  });
  expect(
    closingCard(one, { passed: true, objectives: { bayes: "passed" } }).summary,
  ).toBe("Its one objective passed.");
});

test("more objectives than there are number words are counted in digits", () => {
  const ids = Array.from({ length: 12 }, (_, i) => `o${i + 1}`);
  const big: Plan = {
    objectives: ids.map((id) => ({ id, statement: `Objective ${id}.` })),
    segments: ids.map((id) => ({ title: id, objectives: [id] })),
  };
  const objectives = Object.fromEntries(
    ids.map((id, i) => [id, i < 11 ? "attempted" : "passed"] as const),
  );

  expect(closingCard(big, { passed: false, objectives })).toMatchObject({
    verdict: { text: "11 not passed" },
    summary: "One of 12 objectives passed.",
    again: "Go over the 11 again",
  });
});

// --- Where the unit sits in its course ---------------------------------------

const unit = (id: string, title: string, prerequisites: string[]): Unit => ({
  id,
  title,
  goal: `The goal of ${title}.`,
  prerequisites,
});
// Units 2 and 3 both build on unit 1 only.
const UNITS = [
  unit("limits", "Limits", []),
  unit("derivatives", "Derivatives", ["limits"]),
  unit("integrals", "Integrals", ["limits"]),
];
const course = (
  progress: CourseWithProgress["progress"] = {},
): CourseWithProgress => ({
  id: "calculus",
  course: {
    title: "Calculus I",
    backend: "claude",
    settings: { webSearch: false },
    createdAt: "2026-11-14T09:00:00.000Z",
    lastOpenedAt: "2026-11-15T09:00:00.000Z",
  },
  curriculum: {
    approval: { status: "approved", approvedAt: "2026-11-14T10:00:00.000Z" },
    units: UNITS,
  },
  progress,
});
const IN_PROGRESS = { status: "in-progress", segment: 0 } as const;

// The unit to start next is the one the course view's card would lead to
// once this unit is finished: the first not started whose prerequisites are
// finished, counting this one finished (progress.ts).
test("a unit's place in its course: its number, the course's size, and the unit to start next", () => {
  expect(placement(course({ limits: IN_PROGRESS }), "limits")).toEqual({
    courseTitle: "Calculus I",
    title: "Limits",
    number: 1,
    count: 3,
    next: { number: 2, unit: UNITS[1] },
    finishesCourse: false,
  });
  // Unit 2 is started already, so it is passed over.
  expect(
    placement(course({ derivatives: IN_PROGRESS }), "limits")?.next,
  ).toEqual({ number: 3, unit: UNITS[2] });
  // Unit 2 was started before the unit it builds on: unit 1 comes next.
  expect(placement(course(), "derivatives")?.next).toEqual({
    number: 1,
    unit: UNITS[0],
  });
});

test("with no unit left to start, a unit finishes the course only if every other one is finished", () => {
  expect(
    placement(
      course({
        limits: { status: "passed" },
        integrals: { status: "overridden" },
      }),
      "derivatives",
    ),
  ).toMatchObject({ number: 2, next: null, finishesCourse: true });
  expect(
    placement(
      course({ limits: { status: "passed" }, integrals: IN_PROGRESS }),
      "derivatives",
    ),
  ).toMatchObject({ next: null, finishesCourse: false });
});

test("a course not loaded, or a unit not in it, has no place: never taken for the course's last unit", () => {
  // Not loaded yet, or its load failed.
  expect(placement(undefined, "limits")).toBeUndefined();
  // No such course.
  expect(placement(null, "limits")).toBeUndefined();
  expect(
    placement({ ...course(), curriculum: null }, "limits"),
  ).toBeUndefined();
  expect(placement(course(), "elsewhere")).toBeUndefined();
});
