// The handoff writer's request and what is kept of its reply (task 5.7):
// the stretch since a mark, written out for the writer, and the
// misconceptions it names checked against what it was given. The calls
// themselves, at a segment's close and a unit's end, are in
// unit-handoff.test.ts.

import { expect, test } from "vitest";
import type { PageEvent } from "../../shared/events.ts";
import type { HandoffReply } from "../../shared/handoff.ts";
import type { Plan } from "../../shared/plan.ts";
import type { QuestionView } from "../../shared/question.ts";
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
])("does not treat %s as the same learner evidence as %s", (text, words) => {
  expect(quoteKept([{ type: "learner", text }], words)).toBe(false);
});

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
