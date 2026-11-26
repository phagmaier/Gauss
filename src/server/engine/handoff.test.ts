// The handoff writer's request and what is kept of its reply (task 5.7):
// the stretch since a mark, written out for the writer, and the
// misconceptions it names checked against what it was given. The calls
// themselves, at a segment's close and a unit's end, are in
// unit-handoff.test.ts.

import { expect, test } from "vitest";
import type { PageEvent } from "../../shared/events.ts";
import type { AnswerEvidence } from "../../shared/evidence.ts";
import type { HandoffReply } from "../../shared/handoff.ts";
import type { MisconceptionPlace } from "../../shared/misconception.ts";
import type { Plan } from "../../shared/plan.ts";
import type { QuestionView } from "../../shared/question.ts";
import type { Outline } from "../../shared/source.ts";
import type { Transcript } from "../record/data-root.ts";
import {
  foundIn,
  handoffRequest,
  objectivesFor,
  readStretch,
  STRETCH_LIMIT,
  since,
} from "./handoff.ts";
import type { UnitContext } from "./unit-turns.ts";

const PLAN: Plan = {
  objectives: [
    { id: "limit-value", statement: "Find a limit's value from a table." },
    {
      id: "one-sided",
      statement: "Tell a one-sided limit from a two-sided one.",
    },
  ],
  segments: [
    { title: "Values", objectives: ["limit-value"] },
    { title: "Sides", objectives: ["one-sided"] },
  ],
};

const CONTEXT: UnitContext = {
  courseTitle: "Calculus",
  units: [
    {
      id: "algebra",
      title: "Algebra",
      goal: "Factor.",
      prerequisites: [],
      plan: {
        objectives: [{ id: "factor", statement: "Factor a quadratic." }],
        segments: [{ title: "Factoring", objectives: ["factor"] }],
      },
    },
    {
      id: "limits",
      title: "Limits",
      goal: "Find limits.",
      prerequisites: ["algebra"],
      plan: PLAN,
    },
  ],
  unitId: "limits",
  plan: PLAN,
  sources: [],
};

const CHOICE: QuestionView = {
  kind: "choice",
  id: "q-1",
  number: 1,
  prompt: "What is the limit of $x^2$ as $x \\to 2$?",
  choices: ["2", "4", "8"],
};

/** A check's stretch: teaching, a message, a confident miss and its detour. */
const CHECK: PageEvent[] = [
  { type: "phase", segment: 0, phase: "teach" },
  { type: "turn_start" },
  { type: "tutor_text", text: "A limit is " },
  { type: "tutor_text", text: "where values head." },
  { type: "turn_end", outcome: "done" },
  { type: "phase", segment: 0, phase: "discuss" },
  { type: "learner", text: "Is it the value at the point?", id: "l-1" },
  { type: "unit_status", unit: "in-progress", objectives: {} },
  { type: "phase", segment: 0, phase: "check" },
  { type: "question", question: CHOICE },
  {
    type: "graded",
    questionId: "q-1",
    verdict: "incorrect",
    answer: {
      kind: "choice",
      questionId: "q-1",
      choice: "A",
      confidence: "90",
      reasoning: "Two is where x goes.",
    },
    correctChoice: "B",
    assisted: false,
  },
  { type: "detour", questionId: "q-1", number: 1 },
  { type: "turn_start" },
  { type: "tutor_text", text: "Not quite." },
  { type: "turn_end", outcome: "done" },
  { type: "detour_end" },
];

const answers = new Map([
  [
    CHOICE.id,
    { objective: "limit-value", question: { ...CHOICE, answer: "B" as const } },
  ],
]);

test("a stretch is written out with the tutor's text joined, the learner's messages, a question with its answer and a confident miss named, and detours numbered", () => {
  const stretch = readStretch(CHECK, { plan: PLAN, answers });
  expect(stretch.text).toBe(
    [
      '[Segment 1, "Values": the teaching.]',
      "Tutor:\nA limit is where values head.",
      '[Segment 1, "Values": the discussion.]',
      "Learner:\nIs it the value at the point?",
      '[Segment 1, "Values": the check.]',
      '[Question 1, on "limit-value", a choice question:]\n' +
        "What is the limit of $x^2$ as $x \\to 2$?\nA. 2\nB. 4\nC. 8",
      "[The learner's answer to question 1:]\nA. 2\n" +
        "Their reasoning: Two is where x goes.\n" +
        "Graded wrong, at 90% sure: a confident wrong answer.\n" +
        "The right choice: B. 4",
      '[Detour 1 opens, after the miss on question 1, on "limit-value".]',
      "Tutor:\nNot quite.",
      "[Detour 1 ends: the learner asked to go on.]",
    ].join("\n\n"),
  );
  expect([...stretch.detours]).toEqual([
    [1, { questionId: "q-1", number: 1, objective: "limit-value" }],
  ]);
  expect([...stretch.objectives]).toEqual(["limit-value"]);
  expect(stretch.worthReading).toBe(true);
});

test("a self-test the learner ends partway is said to be ended, and a review skipped to be skipped", () => {
  const stretch = readStretch(
    [
      { type: "assessment", mode: "self-test", stage: "on", count: 2 },
      {
        type: "assessment_end",
        mode: "self-test",
        skipped: true,
        statuses: {},
      },
      { type: "assessment", mode: "review", stage: "on", count: 1 },
      { type: "assessment_end", mode: "review", skipped: true, statuses: {} },
    ],
    { plan: PLAN, answers: new Map() },
  );
  expect(stretch.text).toBe(
    [
      "[A self-test the learner set up begins: questions without teaching, 2 objectives.]",
      "[A self-test the learner set up was ended partway by the learner.]",
      "[A review begins: questions without teaching, one objective.]",
      "[A review was skipped by the learner.]",
    ].join("\n\n"),
  );
});

test("an unsure miss is not named confident, a miss with help says so, and a detour reopened after a restart keeps its number", () => {
  const stretch = readStretch(
    [
      { type: "question", question: CHOICE },
      {
        type: "graded",
        questionId: "q-1",
        verdict: "incorrect",
        answer: {
          kind: "choice",
          questionId: "q-1",
          choice: "C",
          confidence: "50",
        },
        correctChoice: "B",
        assisted: true,
      },
      { type: "detour", questionId: "q-1", number: 1 },
      { type: "session", startedAt: "2026-11-18T09:00:00.000Z" },
      { type: "question", question: CHOICE },
      { type: "detour", questionId: "q-1", number: 1 },
    ],
    { plan: PLAN, answers },
  );
  expect(stretch.text).toContain(
    "Graded wrong, at 50% sure. It was given with help, so it does not count.",
  );
  expect(stretch.text).not.toContain("confident");
  expect(stretch.text).toContain(
    "[A new sitting began, 2026-11-18.]\n\n[Question 1 is still open.]\n\n[Detour 1 goes on.]",
  );
  expect(stretch.detours.size).toBe(1);
});

test("a written answer's reasoning is read after the answer", () => {
  const stretch = readStretch(
    [
      {
        type: "question",
        question: { kind: "written", id: "q-1", number: 1, prompt: "Why?" },
      },
      {
        type: "graded",
        questionId: "q-1",
        verdict: "correct",
        answer: {
          kind: "written",
          questionId: "q-1",
          text: "Because the limit exists.",
          confidence: "75",
          reasoning: "  I first thought it was the value.  ",
        },
        assisted: false,
      },
    ],
    { plan: PLAN, answers },
  );
  expect(stretch.text).toContain(
    "Because the limit exists.\nTheir reasoning: I first thought it was the value.\nGraded correct, at 75% sure.",
  );
});

test(`an "I don't know" whose answer shown a judge corrected is read with the right choice, and one found right says so`, () => {
  const reported = (key?: "C"): PageEvent[] => [
    { type: "question", question: CHOICE },
    {
      type: "graded",
      questionId: "q-1",
      verdict: "unknown",
      answer: { kind: "unknown", questionId: "q-1" },
      correctChoice: "B",
      assisted: false,
    },
    {
      type: "disputed",
      questionId: "q-1",
      dispute: {
        recordedAt: "2026-11-20T10:00:00.000Z",
        reason: "B is not it.",
        outcome: {
          verdict: "unknown",
          reason: "Decided.",
          ...(key === undefined ? {} : { key }),
        },
      },
    },
  ];
  const read = (events: PageEvent[]) =>
    readStretch(events, { plan: PLAN, answers }).text;
  expect(read(reported("C"))).toContain(
    "[The learner said the answer shown for question 1 was wrong, and a judge corrected it: the right choice is C. 8.]",
  );
  expect(read(reported())).toContain(
    "[The learner said the answer shown for question 1 was wrong, and a judge found it right.]",
  );
});

test("a stretch of markers alone, as a unit finishing as its last segment closes leaves, is not worth a call", () => {
  const stretch = readStretch(
    [
      { type: "phase", segment: 1, phase: "closed" },
      { type: "unit_status", unit: "passed", objectives: {} },
      { type: "unit_closed", status: "passed" },
    ],
    { plan: PLAN, answers },
  );
  expect(stretch.worthReading).toBe(false);
  expect(stretch.text).toBe(
    '[Segment 2, "Sides": closed.]\n\n[The unit is finished.]',
  );
});

test("a stretch over the limit keeps its end, and says its start is left out", () => {
  const long = "x".repeat(STRETCH_LIMIT / 3);
  const stretch = readStretch(
    [1, 2, 3, 4].map((n) => ({ type: "learner", text: `${n}${long}` })),
    { plan: PLAN, answers },
  );
  expect(
    stretch.text.startsWith("[The start of this stretch is left out"),
  ).toBe(true);
  expect(stretch.text).not.toContain(`Learner:\n1${long}`);
  expect(stretch.text).not.toContain(`Learner:\n2${long}`);
  expect(stretch.text).toContain(`Learner:\n3${long}`);
  expect(stretch.text.endsWith(`Learner:\n4${long}`)).toBe(true);
});

const transcript = (session: number, count: number): Transcript => ({
  session,
  events: Array.from({ length: count }, (_, i) => ({
    type: "learner" as const,
    text: `${session}.${i}`,
  })),
  unreadable: [],
});

test("since a mark: the rest of its session and every later one; without a mark, the whole thread", () => {
  const thread = [transcript(1, 3), transcript(2, 4), transcript(3, 2)];
  const mark = {
    writtenAt: "2026-11-18T10:00:00.000Z",
    through: { session: 2, events: 3 },
  };
  const after = since(thread, mark);
  expect(
    after.events.map((e) => (e.type === "learner" ? e.text : e.type)),
  ).toEqual(["2.3", "3.0", "3.1"]);
  expect(after.through).toEqual({ session: 3, events: 2 });
  expect(since(thread, undefined).events).toHaveLength(9);
  expect(since([], undefined)).toEqual({ events: [], through: undefined });
});

test("the request gives the unit, its objectives with another unit's a review asked, the note before, the misconceptions recorded on them and the stretch, each between tags", () => {
  const stretch = {
    text: "Learner:\nHello.",
    detours: new Map(),
    objectives: new Set(["factor", "limit-value"]),
    said: [{ text: "Hello." }],
    worthReading: true,
  };
  const objectives = objectivesFor(CONTEXT, stretch);
  expect(objectives).toEqual([
    { id: "limit-value", statement: "Find a limit's value from a table." },
    {
      id: "one-sided",
      statement: "Tell a one-sided limit from a two-sided one.",
    },
    {
      id: "factor",
      statement: "Factor a quadratic.",
      of: { number: 1, title: "Algebra" },
    },
  ]);
  const request = handoffRequest({
    context: CONTEXT,
    objectives,
    noteBefore: "Taught values.",
    recorded: [
      {
        recordedAt: "2026-11-17T10:00:00.000Z",
        unit: "algebra",
        objective: "factor",
        believed: "Every quadratic\nfactors over the integers.",
        actually: "Few do.",
        where: { in: "discussion" },
      },
    ],
    stretch,
  });
  expect(request).toBe(
    [
      'Write the handoff note of unit 2 of the course "Calculus", and list the misconceptions the stretch below shows.',
      "",
      "<unit>",
      'Unit 2 of 2, "Limits". Its goal: Find limits.',
      "</unit>",
      "",
      "<objectives>",
      `- "limit-value": Find a limit's value from a table.`,
      '- "one-sided": Tell a one-sided limit from a two-sided one.',
      '- "factor", an objective of unit 1, "Algebra": Factor a quadratic.',
      "</objectives>",
      "",
      "<note_before>",
      "Taught values.",
      "</note_before>",
      "",
      "<recorded_misconceptions>",
      '- On "factor": believed "Every quadratic factors over the integers."; what is so: "Few do."',
      "</recorded_misconceptions>",
      "",
      "<stretch>",
      "Learner:\nHello.",
      "</stretch>",
    ].join("\n"),
  );
  expect(
    handoffRequest({
      context: CONTEXT,
      objectives,
      noteBefore: undefined,
      recorded: [],
      stretch,
    }),
  ).toContain(
    "</objectives>\n\nThe unit has no note yet: this is its first.\n\nNo misconception is recorded on these objectives yet.\n\n<stretch>",
  );
});

function quoteKept(events: PageEvent[], words: string): boolean {
  return (
    foundIn(
      {
        note: "Note.",
        misconceptions: [
          { objective: "limit-value", believed: "B", actually: "A", words },
        ],
      },
      {
        stretch: readStretch(events, { plan: PLAN, answers }),
        objectives: new Set(["limit-value"]),
        unitId: "limits",
        recordedAt: "2026-11-18T10:00:00.000Z",
      },
    ).found.length === 1
  );
}

test("a misconception is kept with its detour's question and the learner's words, or as the discussion's; one naming an objective or a detour not given, or quoting words the learner did not write, is left out", () => {
  const stretch = readStretch(CHECK, { plan: PLAN, answers });
  const reply: HandoffReply = {
    note: "Note.",
    misconceptions: [
      // The reasoning of the answer, quoted with its spacing, case and
      // quotation marks changed.
      {
        objective: "limit-value",
        believed: "B1",
        actually: "A1",
        words: "“Two is  WHERE x goes”",
        detour: 1,
      },
      // The discussion's message.
      {
        objective: "one-sided",
        believed: "B2",
        actually: "A2",
        words: "is it the value at the point",
      },
      {
        objective: "derivative",
        believed: "B3",
        actually: "A3",
        words: "Two is where x goes.",
      },
      {
        objective: "limit-value",
        believed: "B4",
        actually: "A4",
        words: "Two is where x goes.",
        detour: 2,
      },
      // The tutor's words, not the learner's.
      {
        objective: "limit-value",
        believed: "B5",
        actually: "A5",
        words: "where values head",
      },
      // Words no one wrote.
      {
        objective: "limit-value",
        believed: "B6",
        actually: "A6",
        words: "A limit is the value at the point.",
      },
    ],
  };
  const { found, dropped } = foundIn(reply, {
    stretch,
    objectives: new Set(["limit-value", "one-sided"]),
    unitId: "limits",
    recordedAt: "2026-11-18T10:00:00.000Z",
  });
  expect(found).toEqual([
    {
      recordedAt: "2026-11-18T10:00:00.000Z",
      unit: "limits",
      objective: "limit-value",
      believed: "B1",
      actually: "A1",
      words: "“Two is  WHERE x goes”",
      where: { in: "detour", questionId: "q-1", number: 1 },
    },
    {
      recordedAt: "2026-11-18T10:00:00.000Z",
      unit: "limits",
      objective: "one-sided",
      believed: "B2",
      actually: "A2",
      words: "is it the value at the point",
      where: { in: "discussion" },
    },
  ]);
  expect(dropped).toHaveLength(4);
  expect(dropped[3]).toBe(
    'it quotes the learner as writing "A limit is the value at the point.", which no message or answer of theirs in the stretch has; it was on "limit-value": "B6"',
  );
});

/** A question of the test before the unit, and one of a review. */
const TESTED: Extract<QuestionView, { kind: "choice" }> = {
  kind: "choice",
  id: "t-1",
  number: 1,
  prompt: "What is the limit of $x + 1$ as $x \\to 1$?",
  choices: ["1", "2"],
};
const REVIEWED: Extract<QuestionView, { kind: "choice" }> = {
  kind: "choice",
  id: "r-1",
  number: 1,
  prompt: "When does a two-sided limit exist?",
  choices: ["When both sides agree", "Always"],
};

/** The test begun: its question, a message while it is open, and a miss with reasoning. */
const TEST_ANSWERED: PageEvent[] = [
  { type: "assessment", mode: "test-out", stage: "offered", count: 2 },
  { type: "assessment", mode: "test-out", stage: "on", count: 2 },
  { type: "question", question: TESTED },
  { type: "learner", text: "Does the order of the choices matter?", id: "l-0" },
  {
    type: "graded",
    questionId: TESTED.id,
    verdict: "incorrect",
    answer: {
      kind: "choice",
      questionId: TESTED.id,
      choice: "A",
      confidence: "75",
      reasoning: "The limit is the value at the point, so it is 1.",
    },
    correctChoice: "B",
    assisted: false,
  },
];

/**
 * Each misconception named on "limit-value", by its `believed`, with the
 * place it is kept with; every one must be kept.
 */
function placed(
  events: PageEvent[],
  named: { believed: string; words: string; detour?: number }[],
): [string, MisconceptionPlace][] {
  const stretch = readStretch(events, {
    plan: PLAN,
    answers: new Map<string, Pick<AnswerEvidence, "objective" | "question">>([
      ...answers,
      [
        TESTED.id,
        {
          objective: "limit-value",
          question: { ...TESTED, answer: "B" as const },
        },
      ],
      [
        REVIEWED.id,
        {
          objective: "limit-value",
          question: { ...REVIEWED, answer: "A" as const },
        },
      ],
    ]),
  });
  const { found, dropped } = foundIn(
    {
      note: "Note.",
      misconceptions: named.map((m) => ({
        objective: "limit-value",
        actually: "So.",
        ...m,
      })),
    },
    {
      stretch,
      objectives: new Set(["limit-value"]),
      unitId: "limits",
      recordedAt: "2026-11-18T10:00:00.000Z",
    },
  );
  expect(dropped).toEqual([]);
  return found.map((m) => [m.believed, m.where]);
}

test("a misconception quoting only what the learner wrote in the test before the unit, an answer or a message, is the test's; words written after it too, or in a review, keep the discussion's place, and a named detour still decides", () => {
  // The test, then segment 1 taught: its discussion, a miss and its
  // detour; then a review, answered with reasoning.
  const events: PageEvent[] = [
    ...TEST_ANSWERED,
    {
      type: "assessment_end",
      mode: "test-out",
      skipped: false,
      statuses: { "limit-value": "attempted" },
    },
    { type: "test_answered", skipped: [] },
    ...CHECK,
    { type: "assessment", mode: "review", stage: "on", count: 1 },
    { type: "question", question: REVIEWED },
    {
      type: "graded",
      questionId: REVIEWED.id,
      verdict: "correct",
      answer: {
        kind: "choice",
        questionId: REVIEWED.id,
        choice: "A",
        confidence: "90",
        reasoning: "Both sides must head to one value.",
      },
      assisted: false,
    },
    {
      type: "assessment_end",
      mode: "review",
      skipped: false,
      statuses: { "limit-value": "passed" },
    },
  ];
  expect(
    placed(events, [
      // The test answer's reasoning, and a message sent during the test.
      { believed: "test answer", words: "The limit is the value at the point" },
      {
        believed: "test message",
        words: "does the order of the choices matter",
      },
      // In the test's reasoning and the discussion's message both.
      { believed: "both", words: "the value at the point" },
      { believed: "discussion", words: "Is it the value at the point?" },
      { believed: "review", words: "Both sides must head to one value" },
      // The test's words, under a detour the writer named.
      { believed: "detour", words: "so it is 1", detour: 1 },
    ]),
  ).toEqual([
    ["test answer", { in: "test" }],
    ["test message", { in: "test" }],
    ["both", { in: "discussion" }],
    ["discussion", { in: "discussion" }],
    ["review", { in: "discussion" }],
    ["detour", { in: "detour", questionId: "q-1", number: 1 }],
  ]);
});

test("a test whose end's line a restart lost is over once its result card shows", () => {
  const events: PageEvent[] = [
    ...TEST_ANSWERED,
    { type: "session", startedAt: "2026-11-18T11:00:00.000Z" },
    {
      type: "test_result",
      objectives: [
        {
          objective: "limit-value",
          passed: false,
          answers: [
            { verdict: "incorrect", confidence: "75", assisted: false },
          ],
        },
      ],
    },
    { type: "learner", text: "What do I skip now?", id: "l-1" },
    { type: "test_answered", skipped: [] },
    ...CHECK,
  ];
  expect(
    placed(events, [
      { believed: "test answer", words: "The limit is the value at the point" },
      { believed: "at the card", words: "What do I skip now?" },
      { believed: "discussion", words: "Is it the value at the point?" },
    ]),
  ).toEqual([
    ["test answer", { in: "test" }],
    ["at the card", { in: "discussion" }],
    ["discussion", { in: "discussion" }],
  ]);
});

test("the learner's words are their messages, answers, reasoning, the choice they picked and where they got stuck, math markup ignored; an \"I don't know\" and a part the stretch left out are not", () => {
  const math: QuestionView = {
    kind: "math",
    id: "q-2",
    number: 2,
    prompt: "Differentiate.",
  };
  const events: PageEvent[] = [
    { type: "question", question: CHOICE },
    {
      type: "graded",
      questionId: "q-1",
      verdict: "incorrect",
      answer: {
        kind: "choice",
        questionId: "q-1",
        choice: "C",
        confidence: "90",
      },
      correctChoice: "B",
      assisted: false,
    },
    { type: "question", question: math },
    {
      type: "graded",
      questionId: "q-2",
      verdict: "incorrect",
      answer: {
        kind: "math",
        questionId: "q-2",
        expression: "\\cos(2x)",
        confidence: "75",
      },
      assisted: false,
    },
    { type: "question", question: { ...math, id: "q-3", number: 3 } },
    {
      type: "graded",
      questionId: "q-3",
      verdict: "unknown",
      answer: {
        kind: "unknown",
        questionId: "q-3",
        stuck: "I thought the chain rule was for products.",
      },
      assisted: false,
    },
  ];
  const kept = (words: string) => quoteKept(events, words);
  // The choice picked, by its text.
  expect(kept("8")).toBe(true);
  // A choice not picked is the tutor's.
  expect(kept("4")).toBe(false);
  // A math answer, put between dollar signs and spaced.
  expect(kept("$\\cos (2x)$")).toBe(true);
  expect(kept("$\\COS(2x)$")).toBe(false);
  expect(kept("the chain rule was for products")).toBe(true);
  // "I don't know" is the button's, and a quote of nothing is no quote.
  expect(kept("I don't know.")).toBe(false);
  expect(kept("“…”")).toBe(false);

  // A message the stretch left out over its limit is not what the writer read.
  const long = "x".repeat(STRETCH_LIMIT / 3);
  const over: PageEvent[] = [1, 2, 3, 4].map((n) => ({
    type: "learner",
    text: `Message ${n} says the limit is f(a). ${long}`,
  }));
  expect(quoteKept(over, "Message 1 says the limit is f(a).")).toBe(false);
  expect(quoteKept(over, "Message 4 says the limit is f(a).")).toBe(true);
});

test.each([
  ["The intercept is x = 10.", "The intercept is x = 1."],
  ["The intercept is x = 1.5.", "The intercept is x = 1."],
  ["The intercept is x = -1.", "The intercept is x = 1."],
  ["The map is nonlinear.", "linear"],
  ["The map is not linear.", "The map is notlinear."],
  [
    "The circle satisfies $x² + y² = 25$.",
    "The circle satisfies $x2 + y2 = 25$.",
  ],
  ["The event is $a$.", "The event is $A$."],
  ["The rate is $x = 1/2$.", "The rate is $x = 1$."],
  ["The rate is $x = 1/2$.", "The rate is $x = 1$/2."],
  ["The rule can't apply.", "The rule can."],
  ["The rate is x = 1/2.", "The rate is x = 1."],
  ["The rate is x = 1/2.", "$1/2$"],
  ["The rate is x = 1/2.", "The rate is $x = 1$/2."],
  ["The rate is x = 2 x + 1.", "The rate is x = 2."],
  ["The bound satisfies x != 1.", "$x ! = 1$"],
  ["The chance is 10%.", "The chance is 10."],
  ["I substituted f(X).", "I substituted f(x)."],
  ["The upper bound is 1,000.5.", "The upper bound is 1,000."],
  ["The upper bound is 1,000.5.", "000.5"],
  ["The coefficient is 1e-3.", "-3"],
  ["The model is non-linear.", "linear"],
])("does not treat %s as the same learner evidence as %s", (text, words) => {
  expect(quoteKept([{ type: "learner", text }], words)).toBe(false);
});

test.each([
  ["I used $2x$.", "I used $2 x$."],
  ["I used $f(1, 2)$.", "I used $f(1,2)$."],
  ["The rate is x = 1/2.", "the rate is $x=1 / 2$"],
  ["I substituted f(X).", "$f(X)$"],
  ["The rate is x = 2 x + 1.", "the rate is $x=2x+1$"],
  ["The model is non-linear.", "NON-LINEAR"],
])(
  "can quote %s as %s without changing the learner's meaning",
  (text, words) => {
    expect(quoteKept([{ type: "learner", text }], words)).toBe(true);
  },
);

test("a code answer's reasoning can be quoted, but not the submitted file, which can contain tutor code", () => {
  const events: PageEvent[] = [
    {
      type: "graded",
      questionId: "q-code",
      verdict: "incorrect",
      answer: {
        kind: "code",
        questionId: "q-code",
        confidence: "90",
        files: [
          { path: "exercise.py", content: "def times(x):\n    return 0\n" },
        ],
        reasoning: "Multiplying by two should leave x unchanged.",
      },
      assisted: false,
    },
  ];
  expect(quoteKept(events, "leave x unchanged")).toBe(true);
  expect(quoteKept(events, "return 0")).toBe(false);
});

test("a read of part of a section names the range it read, and a viewed page its page, by printed labels only when the outlines are given", () => {
  const events: PageEvent[] = [
    {
      type: "section_read",
      section: "phenomenology/s1",
      range: { pages: { first: 2, last: 3 } },
    },
    { type: "section_read", section: "phenomenology/s2" },
  ];
  expect(readStretch(events, { plan: PLAN, answers }).text).toBe(
    '[The tutor read the section "phenomenology/s1", pages 2–3.]\n\n' +
      '[The tutor read the section "phenomenology/s2".]',
  );
  const book: Outline = {
    id: "phenomenology",
    title: "The Phenomenology of Spirit",
    file: "original.pdf",
    name: "hegel.pdf",
    format: "pdf",
    sha256: "a".repeat(64),
    converter: 5,
    limit: 20_000,
    pages: { count: 4, labels: ["i", "ii", "1", "2"], blank: [] },
    entries: [],
  };
  expect(
    readStretch(events.slice(0, 1), { plan: PLAN, answers, sources: [book] })
      .text,
  ).toBe('[The tutor read the section "phenomenology/s1", pp. ii–1.]');
  // The PDF's third page is printed 1; a second source adds no title to it.
  const viewed: PageEvent[] = [
    { type: "page_viewed", source: "phenomenology", page: 3 },
  ];
  expect(readStretch(viewed, { plan: PLAN, answers }).text).toBe(
    '[The tutor looked at page 3 of the source "phenomenology".]',
  );
  expect(
    readStretch(viewed, {
      plan: PLAN,
      answers,
      sources: [book, { ...book, id: "logic", title: "Science of Logic" }],
    }).text,
  ).toBe('[The tutor looked at page 1 of the source "phenomenology".]');
});

test("a message's photos are each marked [photo] where they were sent, before its words, and are not the learner's words", () => {
  const events: PageEvent[] = [
    {
      type: "learner",
      text: "Where did I slip?",
      photos: [
        "0b7e1f9a-2c3d-4e5f-8a9b-0c1d2e3f4a5b",
        "1c8f2a0b-3d4e-4f60-9b0c-1d2e3f4a5b6c",
      ],
    },
    {
      type: "learner",
      text: "",
      photos: ["2d9a3b1c-4e5f-4a71-8c1d-2e3f4a5b6c7d"],
    },
  ];
  const stretch = readStretch(events, { plan: PLAN, answers });
  expect(stretch.text).toBe(
    "Learner:\n[photo] [photo]\nWhere did I slip?\n\nLearner:\n[photo]",
  );
  expect(stretch.said.map((words) => words.text)).toEqual([
    "Where did I slip?",
  ]);
});
