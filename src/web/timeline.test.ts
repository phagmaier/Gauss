import { expect, test } from "vitest";
import type { Unit } from "../shared/curriculum.ts";
import type { PageEvent } from "../shared/events.ts";
import type { Plan } from "../shared/plan.ts";
import {
  conversations,
  emptyTimeline,
  reduce,
  type Timeline,
} from "./timeline.ts";

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

test("artifact references split the tutor's reply, and only new artifacts open the pane", () => {
  const events: PageEvent[] = [
    { type: "turn_start" },
    { type: "tutor_text", text: "Look." },
    { type: "artifact", file: "1-a-line.html", title: "A line" },
    { type: "tutor_text", text: "Drag it." },
    { type: "turn_end", outcome: "done" },
    { type: "learner", text: "Another?" },
    { type: "turn_start" },
    { type: "artifact", file: "2-a-curve.html", title: "A curve" },
  ];
  const line = {
    kind: "artifact",
    key: 2,
    file: "1-a-line.html",
    title: "A line",
  };
  const curve = {
    kind: "artifact",
    key: 7,
    file: "2-a-curve.html",
    title: "A curve",
  };
  // The page opened when the log held the first five events.
  const apply = (state: Timeline, from: number, to: number) =>
    events
      .slice(from, to)
      .reduce(
        (s, event, i) => reduce(s, { type: "event", index: from + i, event }),
        state,
      );
  const connected = reduce(emptyTimeline, {
    type: "hello",
    chatId: "chat-1",
    last: 4,
  });

  const replayed = apply(connected, 0, 5);
  expect(replayed.items).toEqual([
    { kind: "tutor", key: 1, text: "Look." },
    line,
    { kind: "tutor", key: 3, text: "Drag it." },
  ]);
  expect(replayed.shown).toBeNull();

  const live = apply(replayed, 5, 8);
  expect(live.items.at(-1)).toEqual(curve);
  expect(live.shown).toEqual(curve);

  // Reconnecting to the same chat replays nothing it has, and keeps it.
  const again = reduce(live, { type: "hello", chatId: "chat-1", last: 4 });
  expect(again).toBe(live);

  // A fresh open of the same chat takes a new cursor without clearing the thread.
  const reopened = reduce(replayed, {
    type: "hello",
    chatId: "chat-1",
    last: 7,
  });
  const caughtUp = apply(reopened, 5, 8);
  expect(caughtUp.items.at(-1)).toEqual(curve);
  expect(caughtUp.shown).toBeNull();
});

test("an artifact restored after the page opens is a thread reference without opening the pane", () => {
  const restored = {
    type: "artifact",
    file: "1-a-line.html",
    title: "A line",
    historical: true,
  } as const;
  const state = play([restored]);

  expect(state.items).toEqual([
    { kind: "artifact", key: 0, file: "1-a-line.html", title: "A line" },
  ]);
  expect(state.shown).toBeNull();
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
const KNOWS = "The learner multiplies matrices with ease.";
const KNOWS_MAPS =
  "The learner multiplies matrices with ease and knows what a linear map is.";
const proposed = (
  revision: number,
  units: Unit[],
  style?: string,
  background?: string,
) =>
  ({
    type: "curriculum_proposed",
    courseId: "linear-algebra",
    revision,
    title: "Linear algebra",
    units,
    ...(style === undefined ? {} : { style }),
    ...(background === undefined ? {} : { background }),
  }) as const;

test("each proposal is a card, a revision marks what changed since the one before, each note included, and approval is recorded", () => {
  const revised = { ...VECTORS, title: "Vectors, maps and matrices" };
  const gentler = {
    ...EIGEN,
    goal: "Find, with care, the stretched directions.",
  };
  const state = play([
    { type: "learner", text: "Linear algebra." },
    { type: "turn_start" },
    proposed(1, [VECTORS, EIGEN], SHORT, KNOWS),
    { type: "turn_end", outcome: "done" },
    { type: "learner", text: "I know linear maps. Shorter, please." },
    { type: "turn_start" },
    { type: "tutor_text", text: "I renamed the first unit." },
    proposed(2, [revised, EIGEN], SHORT, KNOWS_MAPS),
    { type: "turn_end", outcome: "done" },
    { type: "learner", text: "And eigenvectors more gently." },
    { type: "turn_start" },
    proposed(3, [revised, gentler], PREDICT, KNOWS_MAPS),
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
      background: KNOWS,
      backgroundChanged: false,
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
      background: KNOWS_MAPS,
      backgroundChanged: true,
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
      background: KNOWS_MAPS,
      backgroundChanged: false,
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

test("a draft stored before its notes existed has none, and a revision that adds them marks them changed", () => {
  const state = play([
    { type: "draft_reopened" },
    proposed(1, [VECTORS]),
    { type: "learner", text: "Fewer computations." },
    proposed(2, [VECTORS], PREDICT, KNOWS),
  ]);

  expect(state.items.filter((i) => i.kind === "proposal")).toMatchObject([
    {
      revision: 1,
      style: undefined,
      styleChanged: false,
      background: undefined,
      backgroundChanged: false,
    },
    {
      revision: 2,
      style: PREDICT,
      styleChanged: true,
      background: KNOWS,
      backgroundChanged: true,
    },
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

// Task 2.21: a reply during an open question is judged, and an answer sent
// before the call is in waits for it.
const ASKING: PageEvent[] = [
  { type: "phase", segment: 0, phase: "check" },
  { type: "question", question: QUESTION },
  { type: "turn_end", outcome: "done" },
  { type: "learner", id: "m1", text: "What does the cube mean?" },
  { type: "turn_start" },
  { type: "tutor_text", text: "It is the third power." },
  { type: "turn_end", outcome: "done" },
  { type: "judging", learnerId: "m1", number: 1 },
];

test("the judge's call on a reply sits under it, judging until the call is in, and what the tutor writes next starts a new item", () => {
  const judging = play(ASKING);
  expect(judging.items.slice(-2)).toEqual([
    { kind: "tutor", key: 5, text: "It is the third power." },
    { kind: "judgment", key: 7, learnerId: "m1", number: 1 },
  ]);

  const judged = play([
    ...ASKING,
    { type: "learner", id: "m2", text: "And the 3 in front?" },
    {
      type: "judged",
      learnerId: "m1",
      number: 1,
      verdict: "clarification",
    },
    { type: "turn_start" },
    { type: "tutor_text", text: "That comes from the rule." },
  ]);
  expect(judged.items.slice(-4)).toEqual([
    { kind: "tutor", key: 5, text: "It is the third power." },
    {
      kind: "judgment",
      key: 7,
      learnerId: "m1",
      number: 1,
      verdict: "clarification",
    },
    { kind: "learner", key: 8, id: "m2", text: "And the 3 in front?" },
    { kind: "tutor", key: 11, text: "That comes from the rule." },
  ]);
});

test("a call with no judging line of its own, as after a restart, goes where the thread has reached, and says why it counts as help", () => {
  const timeline = play([
    { type: "phase", segment: 0, phase: "check" },
    { type: "question", question: QUESTION },
    {
      type: "judged",
      learnerId: "m1",
      number: 1,
      verdict: "help",
      unjudged: "restart",
    },
  ]);

  expect(timeline.items.at(-1)).toEqual({
    kind: "judgment",
    key: 2,
    learnerId: "m1",
    number: 1,
    verdict: "help",
    unjudged: "restart",
  });
});

test("an answer sent while a reply is judged is kept on its card as waiting, until the grade, or the grading of a written answer, takes its place", () => {
  const chosen = {
    kind: "choice" as const,
    questionId: "q1",
    choice: "A" as const,
    confidence: "90" as const,
  };
  const waiting: PageEvent = {
    type: "answer_waiting",
    questionId: "q1",
    answer: chosen,
  };
  const card = (events: PageEvent[]) =>
    play(events).items.find((i) => i.kind === "question");

  expect(card([...ASKING, waiting])).toEqual({
    kind: "question",
    key: 1,
    question: QUESTION,
    waiting: chosen,
  });
  const graded: PageEvent = {
    type: "graded",
    questionId: "q1",
    verdict: "correct",
    answer: chosen,
    correctChoice: "A",
    assisted: false,
  };
  expect(card([...ASKING, waiting, graded])).toMatchObject({
    graded,
  });
  expect(card([...ASKING, waiting, graded])).not.toHaveProperty("waiting");

  // A written answer that waited is graded next.
  const written: PageEvent[] = [
    { type: "phase", segment: 0, phase: "check" },
    { type: "question", question: WRITTEN },
    { type: "answer_waiting", questionId: "q2", answer: PROOF },
    { type: "grading", questionId: "q2", answer: PROOF },
  ];
  expect(card(written)).toEqual({
    kind: "question",
    key: 1,
    question: WRITTEN,
    grading: PROOF,
  });
});

test("a question the thread went on below is shown where it was answered, and a line stands where it was posted", () => {
  const graded = LOG[5] as PageEvent;
  const events: PageEvent[] = [
    { type: "phase", segment: 0, phase: "check" },
    { type: "turn_start" },
    { type: "tutor_text", text: "Now one on powers." },
    { type: "question", question: QUESTION },
    { type: "turn_end", outcome: "done" },
    { type: "learner", text: "Is x³ x cubed?" },
    { type: "turn_start" },
    { type: "tutor_text", text: "Yes." },
    { type: "turn_end", outcome: "done" },
    graded,
    { type: "turn_start" },
    { type: "tutor_text", text: "Right." },
  ];
  const state = play(events);

  expect(state.items).toEqual([
    { kind: "phase", key: 0, segment: 0, phase: "check" },
    { kind: "tutor", key: 2, text: "Now one on powers." },
    { kind: "answered-below", key: 3, number: 1 },
    { kind: "learner", key: 5, text: "Is x³ x cubed?" },
    { kind: "tutor", key: 7, text: "Yes." },
    { kind: "question", key: 9, question: QUESTION, graded, moved: true },
    { kind: "tutor", key: 11, text: "Right." },
  ]);
  // The grade sent again, as a unit opened again sends it, moves nothing.
  expect(
    reduce(state, { type: "event", index: 12, event: graded }).items,
  ).toEqual(state.items);
});

test("a grade restored for an earlier question, whose line was lost, leaves its card where it was", () => {
  const restored = LOG[5] as PageEvent;
  const state = play([
    { type: "session", startedAt: "2026-11-16T09:00:00.000Z" },
    { type: "phase", segment: 0, phase: "check" },
    { type: "question", question: QUESTION },
    { type: "learner", text: "Is x³ x cubed?" },
    { type: "question", question: { ...QUESTION, id: "q5", number: 2 } },
    { type: "session", startedAt: "2026-11-16T10:00:00.000Z" },
    restored,
  ]);
  expect(state.items.map((i) => i.kind)).toEqual([
    "phase",
    "question",
    "learner",
    "question",
    "session",
  ]);
  expect(state.items[1]).toMatchObject({ key: 2, graded: restored });
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

// --- Sessions: a unit's earlier sittings, from its transcripts (task 2.13) ---

const began = (startedAt: string): PageEvent => ({
  type: "session",
  startedAt,
});
const MONDAY = "2026-11-16T09:00:00.000Z";
const TUESDAY = "2026-11-17T09:00:00.000Z";
const WEDNESDAY = "2026-11-18T09:00:00.000Z";

test("each session after the first begins with a marker, and a reply the session before left unfinished is cut off there", () => {
  const events: PageEvent[] = [
    began(MONDAY),
    { type: "unit_plan", plan: PLAN },
    { type: "phase", segment: 0, phase: "teach" },
    { type: "turn_start" },
    { type: "tutor_text", text: "The power rule" },
    // The server stopped here. The unit opens again in teach, and is taught again.
    began(TUESDAY),
    { type: "unit_plan", plan: PLAN },
    { type: "phase", segment: 0, phase: "teach" },
    { type: "turn_start" },
    { type: "tutor_text", text: "The power rule, again." },
    { type: "turn_end", outcome: "done" },
    { type: "phase", segment: 0, phase: "discuss" },
  ];

  const atTuesday = play(events.slice(0, 6));
  expect(atTuesday.busy).toBe(false);
  expect(atTuesday.tutorOpen).toBe(false);
  const state = play(events);
  expect(state.items).toEqual([
    { kind: "phase", key: 2, segment: 0, phase: "teach" },
    { kind: "tutor", key: 4, text: "The power rule" },
    { kind: "session", key: 5, startedAt: TUESDAY, cutOff: true },
    { kind: "tutor", key: 9, text: "The power rule, again." },
    { kind: "phase", key: 11, segment: 0, phase: "discuss" },
  ]);
  expect(state.position).toEqual({ segment: 0, phase: "discuss" });
});

test("a session that showed nothing gives way to the next one's marker", () => {
  const state = play([
    began(MONDAY),
    { type: "phase", segment: 0, phase: "discuss" },
    { type: "learner", text: "Why?" },
    // Opened and left: nothing new was shown.
    began(TUESDAY),
    { type: "unit_plan", plan: PLAN },
    { type: "phase", segment: 0, phase: "discuss" },
    began(WEDNESDAY),
    { type: "learner", text: "Back again." },
  ]);

  expect(state.items).toEqual([
    { kind: "phase", key: 1, segment: 0, phase: "discuss" },
    { kind: "learner", key: 2, text: "Why?" },
    { kind: "session", key: 6, startedAt: WEDNESDAY, cutOff: false },
    { kind: "learner", key: 7, text: "Back again." },
  ]);
});

test("planning or a failure the session before left is over when the next begins; its note stays", () => {
  const planning = play([
    began(MONDAY),
    { type: "unit_planning" },
    began(TUESDAY),
  ]);
  expect(planning.planning).toBe(false);

  const failed = play([
    began(MONDAY),
    { type: "unit_planning" },
    { type: "unit_failed", error: "The unit could not be planned." },
    began(TUESDAY),
  ]);
  expect(failed.failed).toBeNull();
  expect(failed.items.map((i) => i.kind)).toEqual(["note", "session"]);
});

test("a unit reopened where its thread is shows nothing twice: not its phase, its open question or its closing card", () => {
  const reopened = (events: PageEvent[]) => [
    began(TUESDAY),
    { type: "unit_plan", plan: PLAN } as const,
    ...events,
  ];
  const check = play([
    began(MONDAY),
    { type: "phase", segment: 0, phase: "check" },
    { type: "question", question: QUESTION },
    ...reopened([
      { type: "phase", segment: 0, phase: "check" },
      { type: "question", question: QUESTION },
    ]),
  ]);
  expect(check.items.map((i) => i.kind)).toEqual([
    "phase",
    "question",
    "session",
  ]);

  const card = play([
    began(MONDAY),
    { type: "phase", segment: 1, phase: "closed" },
    NOT_ALL,
    ...reopened([{ type: "phase", segment: 1, phase: "closed" }, NOT_ALL]),
    // Going over again after the restart takes the one card's step.
    { type: "phase", segment: 2, phase: "teach", again: ["chain-rule"] },
  ]);
  expect(
    card.items.filter((i) => i.kind === "unit_end").map((i) => i.key),
  ).toEqual([2]);
  expect(card.items.find((i) => i.kind === "unit_end")).toMatchObject({
    stepTaken: "again",
  });
});

// --- Disputes (task 3.8) -------------------------------------------------------

test("a dispute's outcome attaches to its question's card, wherever the card is, and a closing card standing is shown again with the statuses a dispute changed", () => {
  const dispute = {
    recordedAt: "2026-11-17T10:00:00.000Z",
    reason: "The key is wrong.",
    outcome: {
      verdict: "correct" as const,
      reason: "B is right.",
      key: "B" as const,
    },
  };
  const state = play([
    ...LOG,
    { type: "phase", segment: 1, phase: "closed" },
    NOT_ALL,
    { type: "disputed", questionId: "q1", dispute },
    // One for a question the thread does not have changes nothing.
    { type: "disputed", questionId: "q9", dispute },
    { ...NOT_ALL, passed: true, objectives: { "chain-rule": "passed" } },
  ]);

  expect(state.items.find((i) => i.kind === "question")).toEqual({
    kind: "question",
    key: 3,
    question: QUESTION,
    graded: LOG[5],
    dispute,
  });
  const cards = state.items.filter((i) => i.kind === "unit_end");
  expect(cards).toEqual([
    {
      kind: "unit_end",
      key: 9,
      passed: true,
      objectives: { "chain-rule": "passed" },
    },
  ]);
});

// --- Detours (task 2.20) ------------------------------------------------------

const MISSED: PageEvent = {
  type: "graded",
  questionId: "q1",
  verdict: "unknown",
  answer: { kind: "unknown", questionId: "q1", stuck: "The exponent." },
  correctChoice: "A",
  assisted: false,
};
const DETOUR: PageEvent = { type: "detour", questionId: "q1", number: 1 };

test("a detour is a marker after the missed question's card, open until the learner asks for another question", () => {
  const state = play([
    { type: "phase", segment: 0, phase: "check" },
    { type: "question", question: QUESTION },
    MISSED,
    DETOUR,
    { type: "turn_start" },
    { type: "tutor_text", text: "It is $3x^2$." },
    { type: "turn_end", outcome: "done" },
  ]);

  expect(state.items).toEqual([
    { kind: "phase", key: 0, segment: 0, phase: "check" },
    { kind: "question", key: 1, question: QUESTION, graded: MISSED },
    { kind: "detour", key: 3, questionId: "q1", number: 1 },
    { kind: "tutor", key: 5, text: "It is $3x^2$." },
  ]);
  expect(state.detour).toEqual({ questionId: "q1", number: 1 });

  expect(play([DETOUR, { type: "detour_end" }]).detour).toBeNull();
  // Moving on closes the segment, which ends the detour.
  expect(
    play([DETOUR, { type: "phase", segment: 0, phase: "closed" }]).detour,
  ).toBeNull();
});

test("a unit reopened in a detour shows its marker once; one reopened after the detour ended, whose end the thread lost, has none open", () => {
  const before: PageEvent[] = [
    began(MONDAY),
    { type: "phase", segment: 0, phase: "check" },
    { type: "question", question: QUESTION },
    MISSED,
    DETOUR,
  ];
  const reopened = play([
    ...before,
    began(TUESDAY),
    { type: "phase", segment: 0, phase: "check" },
    DETOUR,
  ]);

  expect(reopened.items.map((i) => i.kind)).toEqual([
    "phase",
    "question",
    "detour",
    "session",
  ]);
  expect(reopened.detour).toEqual({ questionId: "q1", number: 1 });

  // The record had the detour ended; the transcript lost its detour_end.
  const ended = play([
    ...before,
    began(TUESDAY),
    { type: "phase", segment: 0, phase: "check" },
  ]);
  expect(ended.detour).toBeNull();
});

test("a unit reopened past where its thread got to shows the phase it is in", () => {
  // A transcript can lose its last lines in a crash; the record has the phase.
  const state = play([
    began(MONDAY),
    { type: "phase", segment: 0, phase: "discuss" },
    began(TUESDAY),
    { type: "phase", segment: 0, phase: "check" },
  ]);

  expect(state.items).toEqual([
    { kind: "phase", key: 1, segment: 0, phase: "discuss" },
    { kind: "session", key: 2, startedAt: TUESDAY, cutOff: false },
    { kind: "phase", key: 3, segment: 0, phase: "check" },
  ]);
  expect(state.position).toEqual({ segment: 0, phase: "check" });
});

test("a note from before the thread could be read gives way to the thread, whose first session has no marker", () => {
  const state = play([
    // The transcripts could not be read; opening the unit again read them.
    { type: "unit_failed", error: "The transcripts could not be read." },
    began(MONDAY),
    { type: "phase", segment: 0, phase: "discuss" },
    { type: "learner", text: "Why?" },
    began(TUESDAY),
    { type: "phase", segment: 0, phase: "discuss" },
  ]);

  expect(state.failed).toBeNull();
  expect(state.items).toEqual([
    { kind: "phase", key: 2, segment: 0, phase: "discuss" },
    { kind: "learner", key: 3, text: "Why?" },
    { kind: "session", key: 4, startedAt: TUESDAY, cutOff: false },
  ]);
});

test("a fresh start is a marker after the session's, and each begins a conversation with that session's marker, so the thread before it can be shown as earlier; the phase a reopened chat repeats adds nothing", () => {
  const state = play([
    began(MONDAY),
    { type: "unit_plan", plan: PLAN },
    { type: "phase", segment: 0, phase: "discuss" },
    { type: "learner", text: "Show it with gears." },
    // The server restarted, and the tutor's session could not be resumed.
    began(TUESDAY),
    { type: "unit_plan", plan: PLAN },
    { type: "fresh_start", reason: "not-resumed" },
    { type: "phase", segment: 0, phase: "discuss" },
    { type: "learner", text: "Again?" },
    { type: "fresh_start", reason: "learner" },
    { type: "turn_start" },
    { type: "tutor_text", text: "We are in the discussion." },
    { type: "turn_end", outcome: "done" },
  ]);

  const learner = { kind: "learner" as const };
  expect(conversations(state.items)).toEqual([
    {
      key: 2,
      items: [
        { kind: "phase", key: 2, segment: 0, phase: "discuss" },
        { ...learner, key: 3, text: "Show it with gears." },
      ],
    },
    {
      // The sitting the fresh start begins is part of the new conversation.
      key: 6,
      items: [
        { kind: "session", key: 4, startedAt: TUESDAY, cutOff: false },
        { kind: "fresh", key: 6, reason: "not-resumed" },
        { ...learner, key: 8, text: "Again?" },
      ],
    },
    {
      key: 9,
      items: [
        { kind: "fresh", key: 9, reason: "learner" },
        { kind: "tutor", key: 11, text: "We are in the discussion." },
      ],
    },
  ]);
  expect(conversations([])).toEqual([]);
});

test("a fresh start after a unit failed to open takes that session's marker and its failures into the new conversation", () => {
  const state = play([
    began(MONDAY),
    { type: "unit_plan", plan: PLAN },
    { type: "phase", segment: 0, phase: "discuss" },
    // The server restarted, and the unit's record could not be read twice;
    // the third opening found the tutor's session gone.
    began(TUESDAY),
    { type: "unit_failed", error: "state.json could not be read." },
    { type: "unit_failed", error: "state.json could not be read." },
    { type: "unit_plan", plan: PLAN },
    { type: "fresh_start", reason: "not-resumed" },
    { type: "phase", segment: 0, phase: "discuss" },
  ]);

  expect(state.failed).toBeNull();
  expect(
    conversations(state.items).map((part) => part.items.map((i) => i.kind)),
  ).toEqual([["phase"], ["session", "note", "note", "fresh"]]);
});

test("a conversation found lost at a turn begins with the message that turn sent, which the new tutor received, and with the session that message began", () => {
  const state = play([
    began(MONDAY),
    { type: "unit_plan", plan: PLAN },
    { type: "phase", segment: 0, phase: "discuss" },
    { type: "learner", text: "Show it with gears." },
    { type: "turn_start" },
    { type: "tutor_text", text: "Gears turn gears." },
    { type: "turn_end", outcome: "done" },
    // The tutor's session was closed while idle, and could not be resumed.
    { type: "learner", id: "pulleys", text: "And with pulleys?" },
    { type: "turn_start" },
    { type: "fresh_start", reason: "not-resumed", learnerId: "pulleys" },
    { type: "tutor_text", text: "Pulleys, from the start." },
    { type: "turn_end", outcome: "done" },
    // The same an hour later, when the message begins a sitting.
    began(TUESDAY),
    { type: "learner", id: "levers", text: "And with levers?" },
    { type: "turn_start" },
    { type: "fresh_start", reason: "not-resumed", learnerId: "levers" },
  ]);

  expect(
    conversations(state.items).map((part) => part.items.map((i) => i.kind)),
  ).toEqual([
    ["phase", "learner", "tutor"],
    ["learner", "fresh", "tutor"],
    ["session", "learner", "fresh"],
  ]);
  // The learner's own Start fresh leaves the message before it where it was.
  const own = play([
    { type: "unit_plan", plan: PLAN },
    { type: "phase", segment: 0, phase: "discuss" },
    { type: "learner", text: "Hello?" },
    { type: "fresh_start", reason: "learner" },
  ]);
  expect(
    conversations(own.items).map((part) => part.items.map((i) => i.kind)),
  ).toEqual([["phase", "learner"], ["fresh"]]);
});

test("a lost turn moves its explicitly matched learner and every queued item after it, including the session marker before it", () => {
  const state = play([
    began(MONDAY),
    { type: "phase", segment: 0, phase: "discuss" },
    { type: "tutor_text", text: "Earlier conversation." },
    began(TUESDAY),
    { type: "learner", id: "first", text: "First queued message." },
    { type: "learner", id: "second", text: "Second queued message." },
    { type: "turn_end", outcome: "interrupted" },
    { type: "turn_start" },
    { type: "fresh_start", reason: "not-resumed", learnerId: "first" },
    { type: "tutor_text", text: "Reply in the new conversation." },
  ]);

  expect(conversations(state.items)).toEqual([
    {
      key: 1,
      items: [
        { kind: "phase", key: 1, segment: 0, phase: "discuss" },
        { kind: "tutor", key: 2, text: "Earlier conversation." },
      ],
    },
    {
      key: 8,
      items: [
        { kind: "session", key: 3, startedAt: TUESDAY, cutOff: false },
        { kind: "learner", key: 4, id: "first", text: "First queued message." },
        {
          kind: "learner",
          key: 5,
          id: "second",
          text: "Second queued message.",
        },
        { kind: "note", key: 6, text: "Stopped." },
        { kind: "fresh", key: 8, reason: "not-resumed", learnerId: "first" },
        { kind: "tutor", key: 9, text: "Reply in the new conversation." },
      ],
    },
  ]);
});

test("fallbacks without a matching learner id never guess which learner message to move", () => {
  for (const learnerId of [undefined, "missing"]) {
    const state = play([
      { type: "phase", segment: 0, phase: "discuss" },
      { type: "learner", id: "earlier", text: "Already sent." },
      { type: "fresh_start", reason: "not-resumed", learnerId },
    ]);
    expect(
      conversations(state.items).map((part) => part.items.map((i) => i.kind)),
    ).toEqual([["phase", "learner"], ["fresh"]]);
  }

  // Transcripts written before learner ids existed are still replayable.
  const legacy = play([
    { type: "learner", text: "An old message." },
    { type: "fresh_start", reason: "not-resumed" },
  ]);
  expect(
    conversations(legacy.items).map((part) => part.items.map((i) => i.kind)),
  ).toEqual([["learner"], ["fresh"]]);
});

test("the first learner message can move without leaving an empty earlier conversation", () => {
  const state = play([
    { type: "learner", id: "first", text: "Begin here." },
    { type: "learner", id: "second", text: "And here." },
    { type: "fresh_start", reason: "not-resumed", learnerId: "first" },
  ]);
  const parts = conversations(state.items);
  expect(parts).toEqual([{ key: 2, items: state.items }]);
});

test("a package request is one card in the tutor's reply, which installs and is answered; one said again as the unit reopens stays one card, asking again", () => {
  const requested: PageEvent = {
    type: "packages_requested",
    requestId: "r1",
    packages: [{ name: "pytest", version: ">=8" }],
    commands: [["uv", "add", "pytest>=8"]],
    folder: "/data/courses/c/workspace",
  };
  const card = {
    kind: "packages",
    key: 2,
    requestId: "r1",
    packages: [{ name: "pytest", version: ">=8" }],
    commands: [["uv", "add", "pytest>=8"]],
    folder: "/data/courses/c/workspace",
  };
  const asked = play([
    { type: "turn_start" },
    { type: "tutor_text", text: "We need pytest." },
    requested,
    { type: "tutor_text", text: "Press Install." },
    { type: "turn_end", outcome: "done" },
  ]);
  expect(asked.items).toEqual([
    { kind: "tutor", key: 1, text: "We need pytest." },
    card,
    { kind: "tutor", key: 3, text: "Press Install." },
  ]);

  const installing = play([{ type: "packages_installing", requestId: "r1" }], {
    ...asked,
    last: -1,
  });
  expect(installing.items[1]).toEqual({ ...card, installing: true });

  // A restart ended the install. The current plan supersedes transcript details.
  const plan = {
    commands: [["uv", "pip", "install", "pytest>=8"]],
    folder: "/new/data/courses/c/workspace",
  };
  const reopened = play([{ ...requested, ...plan }], {
    ...installing,
    last: -1,
  });
  expect(reopened.items).toHaveLength(3);
  expect(reopened.items[1]).toEqual({ ...card, ...plan });

  const answered = play(
    [
      { type: "packages_installing", requestId: "r1" },
      {
        type: "packages_answered",
        requestId: "r1",
        outcome: "installed",
        output: " + pytest==9.2.0",
      },
    ],
    { ...reopened, last: -1 },
  );
  expect(answered.items[1]).toEqual({
    ...card,
    ...plan,
    outcome: "installed",
    output: " + pytest==9.2.0",
  });
});
