import { expect, test } from "vitest";
import type { Unit } from "../shared/curriculum.ts";
import type { PageEvent } from "../shared/events.ts";
import type { Plan } from "../shared/plan.ts";
import { emptyTimeline, reduce, type Timeline } from "./timeline.ts";

const QUESTION = {
  kind: "choice" as const,
  id: "q1",
  number: 1,
  prompt: "What is the derivative of x³?",
  choices: ["3x²", "x²"],
};

function play(events: PageEvent[], from: Timeline = emptyTimeline): Timeline {
  return events.reduce(
    (state, event, index) => reduce(state, { type: "event", index, event }),
    reduce(from, { type: "hello", chatId: "chat-1" }),
  );
}

const LOG: PageEvent[] = [
  { type: "turn_start" },
  { type: "tutor_text", text: "The power rule " },
  { type: "tutor_text", text: "brings the exponent down." },
  { type: "question", question: QUESTION },
  { type: "turn_end", outcome: "done" },
  {
    type: "graded",
    questionId: "q1",
    verdict: "correct",
    answer: { kind: "choice", questionId: "q1", choice: "A", confidence: "90" },
    correctChoice: "A",
    assisted: false,
  },
  { type: "turn_start" },
  { type: "tutor_text", text: "Right." },
];

test("the log becomes the thread: text pieces join, a question card sits between replies, and a grade attaches to its card", () => {
  const state = play(LOG);

  expect(state.items).toEqual([
    { kind: "tutor", key: 1, text: "The power rule brings the exponent down." },
    { kind: "question", key: 3, question: QUESTION, graded: LOG[5] },
    { kind: "tutor", key: 7, text: "Right." },
  ]);
  expect(state.busy).toBe(true);
});

test("events the page already has are ignored, so a replay after reconnecting changes nothing", () => {
  const state = play(LOG);
  const replayed = LOG.reduce(
    (s, event, index) => reduce(s, { type: "event", index, event }),
    reduce(state, { type: "hello", chatId: "chat-1" }),
  );

  expect(replayed).toEqual(state);
});

test("a hello from another chat starts the thread over", () => {
  const state = reduce(play(LOG), { type: "hello", chatId: "chat-2" });

  expect(state).toEqual({ ...emptyTimeline, chatId: "chat-2" });
});

test("a turn that ends in an error or is stopped leaves a note, and the tutor is no longer writing", () => {
  const state = play([
    { type: "turn_start" },
    { type: "tutor_text", text: "Partial" },
    { type: "turn_end", outcome: "interrupted" },
    { type: "learner", text: "Go on." },
    { type: "turn_start" },
    { type: "turn_end", outcome: "error", error: "Rate limited." },
  ]);

  expect(
    state.items.map((item) => [item.kind, "text" in item && item.text]),
  ).toEqual([
    ["tutor", "Partial"],
    ["note", "Stopped."],
    ["learner", "Go on."],
    ["note", "The tutor stopped because of an error: Rate limited."],
  ]);
  expect(state.busy).toBe(false);
});

const VECTORS: Unit = {
  id: "vectors",
  title: "Vectors and linear maps",
  goal: "Describe a linear map by what it does to a basis.",
  prerequisites: [],
};
const EIGEN: Unit = {
  id: "eigen",
  title: "Eigenvalues and eigenvectors",
  goal: "Find the directions a map only stretches.",
  prerequisites: ["vectors"],
};
const SHORT = "Short explanations, a picture first.";
const PREDICT = "Short explanations. Checks ask you to predict, not compute.";
const proposed = (revision: number, units: Unit[], style?: string) =>
  ({
    type: "curriculum_proposed",
    courseId: "linear-algebra",
    revision,
    title: "Linear algebra",
    units,
    ...(style === undefined ? {} : { style }),
  }) as const;

test("each proposal is a card, a revision marks what changed since the one before, the style note included, and approval is recorded", () => {
  const revised = { ...VECTORS, title: "Vectors, maps and matrices" };
  const gentler = {
    ...EIGEN,
    goal: "Find, with care, the stretched directions.",
  };
  const state = play([
    { type: "learner", text: "Linear algebra." },
    { type: "turn_start" },
    proposed(1, [VECTORS, EIGEN], SHORT),
    { type: "turn_end", outcome: "done" },
    { type: "learner", text: "Shorter, please." },
    { type: "turn_start" },
    { type: "tutor_text", text: "I renamed the first unit." },
    proposed(2, [revised, EIGEN], SHORT),
    { type: "turn_end", outcome: "done" },
    { type: "learner", text: "And eigenvectors more gently." },
    { type: "turn_start" },
    proposed(3, [revised, gentler], PREDICT),
    { type: "turn_end", outcome: "done" },
    {
      type: "curriculum_approved",
      courseId: "linear-algebra",
      revision: 3,
    },
  ]);

  expect(state.items.filter((i) => i.kind === "proposal")).toEqual([
    {
      kind: "proposal",
      key: 2,
      revision: 1,
      courseId: "linear-algebra",
      title: "Linear algebra",
      units: [VECTORS, EIGEN],
      changed: new Set(),
      style: SHORT,
      styleChanged: false,
    },
    {
      kind: "proposal",
      key: 7,
      revision: 2,
      courseId: "linear-algebra",
      title: "Linear algebra",
      units: [revised, EIGEN],
      changed: new Set(["vectors"]),
      style: SHORT,
      styleChanged: false,
    },
    {
      kind: "proposal",
      key: 11,
      revision: 3,
      courseId: "linear-algebra",
      title: "Linear algebra",
      units: [revised, gentler],
      // Against revision 2, not the first: the renamed unit is not new here.
      changed: new Set(["eigen"]),
      style: PREDICT,
      styleChanged: true,
    },
  ]);
  expect(state.latestRevision).toBe(3);
  expect(state.approved).toEqual({ courseId: "linear-algebra", revision: 3 });
  expect(state.reopened).toBe(false);
});

test("a draft reopened after a restart is marked, and its proposal is the first card", () => {
  const state = play([
    { type: "draft_reopened" },
    proposed(1, [VECTORS], SHORT),
  ]);

  expect(state.reopened).toBe(true);
  expect(state.items).toMatchObject([
    { kind: "proposal", revision: 1, style: SHORT, styleChanged: false },
  ]);
  expect(state.latestRevision).toBe(1);
  expect(state.approved).toBeNull();
});

test("a draft stored before style notes existed has none, and a revision that adds one marks it changed", () => {
  const state = play([
    { type: "draft_reopened" },
    proposed(1, [VECTORS]),
    { type: "learner", text: "Fewer computations." },
    proposed(2, [VECTORS], PREDICT),
  ]);

  expect(state.items.filter((i) => i.kind === "proposal")).toMatchObject([
    { revision: 1, style: undefined, styleChanged: false },
    { revision: 2, style: PREDICT, styleChanged: true },
  ]);
});

// --- A unit chat (tasks 2.6 to 2.8, shown by the session view, 2.11) --------

const PLAN: Plan = {
  objectives: [
    { id: "power-rule", statement: "Differentiate a power of x." },
    { id: "product-rule", statement: "Apply the product rule." },
    { id: "chain-rule", statement: "Apply the chain rule." },
  ],
  segments: [
    {
      title: "Powers and products",
      objectives: ["power-rule", "product-rule"],
    },
    { title: "The chain rule", objectives: ["chain-rule"] },
  ],
};
const WRITTEN = {
  kind: "written" as const,
  id: "q2",
  number: 2,
  prompt: "Prove the product rule from the definition.",
};
const PROOF = {
  kind: "written" as const,
  questionId: "q2",
  text: "Add and subtract $f(x+h)g(x)$ in the difference quotient.",
  confidence: "75" as const,
};
const STATUSES = {
  "power-rule": "passed",
  "product-rule": "attempted",
  "chain-rule": "not-started",
} as const;

test("a unit's plan and phases: each phase begun is a marker in the thread, and the position follows the last", () => {
  const state = play([
    { type: "unit_planning" },
    { type: "unit_plan", plan: PLAN },
    { type: "unit_status", unit: "in-progress", objectives: STATUSES },
    { type: "phase", segment: 0, phase: "teach" },
    { type: "turn_start" },
    { type: "tutor_text", text: "The power rule." },
    { type: "turn_end", outcome: "done" },
    { type: "phase", segment: 0, phase: "discuss" },
    { type: "learner", text: "Why?" },
    { type: "turn_start" },
    { type: "tutor_text", text: "Because." },
  ]);

  expect(state.items).toEqual([
    { kind: "phase", key: 3, segment: 0, phase: "teach" },
    { kind: "tutor", key: 5, text: "The power rule." },
    { kind: "phase", key: 7, segment: 0, phase: "discuss" },
    { kind: "learner", key: 8, text: "Why?" },
    { kind: "tutor", key: 10, text: "Because." },
  ]);
  expect(state.plan).toEqual(PLAN);
  expect(state.planning).toBe(false);
  expect(state.position).toEqual({ segment: 0, phase: "discuss" });
  expect(state.finished).toBeNull();
});

test("a marker ends the tutor's text: the writing mark shows under it, and what the tutor writes next starts a new item", () => {
  const closed = play([
    { type: "phase", segment: 0, phase: "check" },
    { type: "turn_start" },
    { type: "tutor_text", text: "Right." },
    { type: "phase", segment: 0, phase: "closed" },
  ]);
  expect(closed.busy).toBe(true);
  expect(closed.tutorOpen).toBe(false);

  const after = reduce(closed, {
    type: "event",
    index: 4,
    event: { type: "tutor_text", text: " Next segment soon." },
  });
  expect(after.items.map((i) => i.kind)).toEqual([
    "phase",
    "tutor",
    "phase",
    "tutor",
  ]);
});

test("planning shows while the unit is planned; a failure is a note, and opening again clears it", () => {
  const planning = play([{ type: "unit_planning" }]);
  expect(planning.planning).toBe(true);

  const failed = play([
    { type: "unit_planning" },
    { type: "unit_failed", error: "The unit could not be planned." },
  ]);
  expect(failed.planning).toBe(false);
  expect(failed.failed).toBe("The unit could not be planned.");
  expect(failed.items).toEqual([
    { kind: "note", key: 1, text: "The unit could not be planned." },
  ]);

  const again = play([
    { type: "unit_planning" },
    { type: "unit_failed", error: "The unit could not be planned." },
    { type: "unit_planning" },
    { type: "unit_plan", plan: PLAN },
  ]);
  expect(again.failed).toBeNull();
  expect(again.plan).toEqual(PLAN);
});

test("a written answer is kept on its card while graded, a failed grading says why, and the grade replaces both", () => {
  const base: PageEvent[] = [
    { type: "phase", segment: 0, phase: "check" },
    { type: "question", question: WRITTEN },
    { type: "grading", questionId: "q2", answer: PROOF },
  ];
  const card = (events: PageEvent[]) =>
    play([...base, ...events]).items.find((i) => i.kind === "question");

  expect(card([])).toEqual({
    kind: "question",
    key: 1,
    question: WRITTEN,
    grading: PROOF,
  });
  expect(
    card([{ type: "grading_failed", questionId: "q2", error: "Timed out." }]),
  ).toEqual({
    kind: "question",
    key: 1,
    question: WRITTEN,
    grading: PROOF,
    gradingFailed: "Timed out.",
  });
  // Graded again: the failure goes, the kept answer stays.
  expect(
    card([
      { type: "grading_failed", questionId: "q2", error: "Timed out." },
      { type: "grading", questionId: "q2", answer: PROOF },
    ]),
  ).toEqual({ kind: "question", key: 1, question: WRITTEN, grading: PROOF });

  const graded: PageEvent = {
    type: "graded",
    questionId: "q2",
    verdict: "incorrect",
    answer: PROOF,
    flaw: "The limit of $g(x+h)$ is taken without saying $g$ is continuous.",
    assisted: false,
  };
  expect(card([graded])).toEqual({
    kind: "question",
    key: 1,
    question: WRITTEN,
    graded,
  });
});

test("moving on withdraws the open question, and a note says it was recorded", () => {
  const state = play([
    { type: "phase", segment: 1, phase: "check" },
    { type: "question", question: { ...QUESTION, id: "q4", number: 1 } },
    {
      type: "overridden",
      segment: 1,
      objectives: ["chain-rule"],
      withdrawnQuestionId: "q4",
    },
    { type: "phase", segment: 1, phase: "closed" },
  ]);

  expect(state.items).toEqual([
    { kind: "phase", key: 0, segment: 1, phase: "check" },
    {
      kind: "question",
      key: 1,
      question: { ...QUESTION, id: "q4", number: 1 },
      withdrawn: true,
    },
    {
      kind: "note",
      key: 2,
      text: "You moved on without the check. Recorded as an override.",
    },
    { kind: "phase", key: 3, segment: 1, phase: "closed" },
  ]);
  expect(state.position).toEqual({ segment: 1, phase: "closed" });
});

test("a question the thread holds already is not shown twice", () => {
  const state = play([
    { type: "question", question: QUESTION },
    { type: "question", question: QUESTION },
  ]);

  expect(state.items).toEqual([
    { kind: "question", key: 0, question: QUESTION },
  ]);
});

const NOT_ALL_OBJECTIVES = {
  "power-rule": "passed",
  "product-rule": "passed",
  "chain-rule": "overridden",
} as const;
const ALL_PASSED = {
  "power-rule": "passed",
  "product-rule": "passed",
  "chain-rule": "passed",
} as const;
const NOT_ALL: PageEvent = {
  type: "unit_end",
  passed: false,
  objectives: NOT_ALL_OBJECTIVES,
};

test("going over again shrinks the closing card and starts the extra segment; when it passes, the second card stays as it is", () => {
  const passed: PageEvent = {
    type: "unit_end",
    passed: true,
    objectives: ALL_PASSED,
  };
  const state = play([
    { type: "phase", segment: 1, phase: "closed" },
    NOT_ALL,
    { type: "phase", segment: 2, phase: "teach", again: ["chain-rule"] },
    { type: "phase", segment: 2, phase: "closed", again: ["chain-rule"] },
    passed,
    { type: "unit_status", unit: "passed", objectives: ALL_PASSED },
    { type: "unit_closed", status: "passed" },
  ]);

  expect(state.items.filter((i) => i.kind === "unit_end")).toEqual([
    {
      kind: "unit_end",
      key: 1,
      passed: false,
      objectives: NOT_ALL_OBJECTIVES,
      stepTaken: "again",
    },
    {
      kind: "unit_end",
      key: 4,
      passed: true,
      objectives: ALL_PASSED,
    },
  ]);
  expect(state.position).toEqual({
    segment: 2,
    phase: "closed",
    again: ["chain-rule"],
  });
  expect(state.finished).toBe("passed");
});

test("moving on without them shrinks the closing card, and the unit is finished, overridden", () => {
  const state = play([
    NOT_ALL,
    {
      type: "unit_status",
      unit: "overridden",
      objectives: NOT_ALL_OBJECTIVES,
    },
    { type: "unit_closed", status: "overridden" },
  ]);

  expect(state.items).toEqual([
    {
      kind: "unit_end",
      key: 0,
      passed: false,
      objectives: NOT_ALL_OBJECTIVES,
      stepTaken: "moved-on",
    },
  ]);
  expect(state.finished).toBe("overridden");
});

test("a finished unit opened again is finished, with no closing card", () => {
  const state = play([
    { type: "unit_plan", plan: PLAN },
    { type: "unit_status", unit: "passed", objectives: STATUSES },
    { type: "unit_closed", status: "passed" },
  ]);

  expect(state.items).toEqual([]);
  expect(state.finished).toBe("passed");
  expect(state.position).toBeNull();
});
