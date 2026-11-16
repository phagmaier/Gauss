import { expect, test } from "vitest";
import type { Unit } from "../shared/curriculum.ts";
import type { PageEvent } from "../shared/events.ts";
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
