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

test("a misconception is kept with its detour's question, or as the discussion's; one naming an objective or a detour not given is left out", () => {
  const stretch = readStretch(CHECK, { plan: PLAN, answers });
  const reply: HandoffReply = {
    note: "Note.",
    misconceptions: [
      { objective: "limit-value", believed: "B1", actually: "A1", detour: 1 },
      { objective: "one-sided", believed: "B2", actually: "A2" },
      { objective: "derivative", believed: "B3", actually: "A3" },
      { objective: "limit-value", believed: "B4", actually: "A4", detour: 2 },
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
      where: { in: "detour", questionId: "q-1", number: 1 },
    },
    {
      recordedAt: "2026-11-18T10:00:00.000Z",
      unit: "limits",
      objective: "one-sided",
      believed: "B2",
      actually: "A2",
      where: { in: "discussion" },
    },
  ]);
  expect(dropped).toHaveLength(2);
});
