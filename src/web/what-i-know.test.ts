import { expect, test } from "vitest";
import type {
  ShownEvidence,
  ShownQuestion,
  WhatIKnow,
} from "../shared/what-i-know.ts";
import {
  answerLine,
  knownSummary,
  objectiveMark,
  outputLines,
  recordedOn,
  unitWord,
  unstartedLine,
} from "./what-i-know.ts";

// Every expected result is worked out by hand from the task (plan 2.26) and
// the session's own words for a graded answer (QuestionCard.tsx).

type Status = "passed" | "overridden" | "attempted" | "not-started";

/** A course whose units have objectives of these statuses; null: not started. */
const view = (...units: (Status[] | null)[]): WhatIKnow => ({
  title: "Calculus I",
  units: units.map((statuses, i) => ({
    id: `unit-${i + 1}`,
    number: i + 1,
    title: `Unit ${i + 1}`,
    status: statuses === null ? "not-started" : "in-progress",
    objectives:
      statuses?.map((status, j) => ({
        id: `objective-${i + 1}-${j + 1}`,
        statement: `Do part ${j + 1}.`,
        status,
        evidence: [],
      })) ?? null,
  })),
  calibration: { levels: [], unknown: 0 },
});

test.each([
  {
    units: [
      ["passed", "passed", "overridden", "attempted", "not-started"],
      null,
      ["passed", "attempted", "attempted", "not-started"],
    ] as (Status[] | null)[],
    says: "2 units started, with 9 objectives: 3 passed, 1 overridden, 3 not passed yet and 2 not started.",
  },
  {
    units: [["passed"], null] as (Status[] | null)[],
    says: "1 unit started, with 1 objective: passed.",
  },
  {
    units: [["passed", "passed"]] as (Status[] | null)[],
    says: "1 unit started, with 2 objectives: all passed.",
  },
  {
    units: [["attempted", "not-started"]] as (Status[] | null)[],
    says: "1 unit started, with 2 objectives: 1 not passed yet and 1 not started.",
  },
  {
    units: [null, null] as (Status[] | null)[],
    says: "No unit has started yet.",
  },
])(
  "the summary counts the objectives of started units by status: $says",
  ({ units, says }) => {
    expect(knownSummary(view(...units))).toBe(says);
  },
);

test("units not started are named on one line, after the others", () => {
  expect(unstartedLine(view(["passed"], null, ["passed"], null, null))).toBe(
    "Units 2, 4 and 5 have not started; a unit's objectives are set when it starts.",
  );
  expect(unstartedLine(view(null, ["passed"]))).toBe(
    "Unit 1 has not started; a unit's objectives are set when it starts.",
  );
  expect(unstartedLine(view(["passed"]))).toBeNull();
});

test("each status of an objective and of a unit has its word", () => {
  expect(
    (["passed", "overridden", "attempted", "not-started"] as const).map(
      objectiveMark,
    ),
  ).toEqual([
    { text: "Passed", className: "pass" },
    { text: "Overridden", className: "over" },
    { text: "Not passed yet", className: "miss" },
    { text: "Not started", className: "" },
  ]);
  expect(
    (["passed", "overridden", "in-progress", "not-started"] as const).map(
      unitWord,
    ),
  ).toEqual([
    { text: "Passed", className: "pass" },
    { text: "Overridden", className: "over" },
    { text: "In progress", className: "now" },
    { text: "Not started", className: "" },
  ]);
});

const AT = new Date(2026, 10, 14, 10, 5).toISOString();
const CHOICE: ShownQuestion = {
  kind: "choice",
  prompt: "Which?",
  choices: ["One", "Two"],
  answer: "B",
};
const WRITTEN: ShownQuestion = { kind: "written", prompt: "Why?" };
const MATH: ShownQuestion = {
  kind: "math",
  prompt: "Differentiate $x^3$.",
  expected: "3x^2",
};
type Answer = Extract<ShownEvidence, { kind: "answer" }>;

test.each<{ name: string; entry: Answer; says: ReturnType<typeof answerLine> }>(
  [
    {
      name: "a right choice, unsure",
      entry: {
        kind: "answer",
        recordedAt: AT,
        question: CHOICE,
        answer: {
          kind: "choice",
          questionId: "q",
          choice: "B",
          confidence: "50",
        },
        assisted: false,
        verdict: "correct",
      },
      says: {
        verdict: { text: "Correct", className: "ok" },
        changed: false,
        sure: "50% sure",
      },
    },
    {
      name: "a right written answer with help, which did not count",
      entry: {
        kind: "answer",
        recordedAt: AT,
        question: WRITTEN,
        answer: {
          kind: "written",
          questionId: "q",
          text: "Because.",
          confidence: "under-50",
        },
        assisted: true,
        verdict: "correct",
      },
      says: {
        verdict: { text: "Correct", className: "ok" },
        changed: false,
        sure: "under 50% sure",
        help: "With help, so it did not count",
      },
    },
    {
      name: "a wrong choice with help: the right one is named, and help changes nothing",
      entry: {
        kind: "answer",
        recordedAt: AT,
        question: CHOICE,
        answer: {
          kind: "choice",
          questionId: "q",
          choice: "A",
          confidence: "100",
        },
        assisted: true,
        verdict: "incorrect",
      },
      says: {
        verdict: { text: "Not quite", className: "no" },
        changed: false,
        sure: "100% sure",
        help: "With help",
        correctChoice: "B",
      },
    },
    {
      name: "a wrong written answer, which has its flaw but no right choice",
      entry: {
        kind: "answer",
        recordedAt: AT,
        question: WRITTEN,
        answer: {
          kind: "written",
          questionId: "q",
          text: "No.",
          confidence: "75",
        },
        assisted: false,
        verdict: "incorrect",
        flaw: "It skips a step.",
      },
      says: {
        verdict: { text: "Not quite", className: "no" },
        changed: false,
        sure: "75% sure",
      },
    },
    {
      name: '"I don\'t know" on a choice: no confidence, and the right choice',
      entry: {
        kind: "answer",
        recordedAt: AT,
        question: CHOICE,
        answer: { kind: "unknown", questionId: "q", stuck: "Both look right." },
        assisted: false,
        verdict: "unknown",
      },
      says: {
        verdict: { text: "Did not know", className: "dk" },
        changed: false,
        correctChoice: "B",
      },
    },
    {
      name: "a right math answer: no correction",
      entry: {
        kind: "answer",
        recordedAt: AT,
        question: MATH,
        answer: {
          kind: "math",
          questionId: "q",
          expression: "3*x^2",
          confidence: "90",
        },
        assisted: false,
        verdict: "correct",
      },
      says: {
        verdict: { text: "Correct", className: "ok" },
        changed: false,
        sure: "90% sure",
      },
    },
    {
      name: "a wrong math answer the check could not read: the expected answer, and why the grader graded it",
      entry: {
        kind: "answer",
        recordedAt: AT,
        question: MATH,
        answer: {
          kind: "math",
          questionId: "q",
          expression: "3x^2 \\oops",
          confidence: "50",
        },
        assisted: false,
        verdict: "incorrect",
        flaw: "It has a stray command.",
        unsettled: { result: "unparsable", reason: "\\oops is not understood" },
      },
      says: {
        verdict: { text: "Not quite", className: "no" },
        changed: false,
        sure: "50% sure",
        expected: "3x^2",
        gradedBy:
          "The grader, since the symbolic check could not read the answer (\\oops is not understood).",
      },
    },
    {
      name: '"I don\'t know" on a math question: the expected answer',
      entry: {
        kind: "answer",
        recordedAt: AT,
        question: MATH,
        answer: { kind: "unknown", questionId: "q" },
        assisted: false,
        verdict: "unknown",
      },
      says: {
        verdict: { text: "Did not know", className: "dk" },
        changed: false,
        expected: "3x^2",
      },
    },
    {
      name: "a choice missed, then changed by a dispute that corrected the key to the choice picked",
      entry: {
        kind: "answer",
        recordedAt: AT,
        question: CHOICE,
        answer: {
          kind: "choice",
          questionId: "q",
          choice: "A",
          confidence: "75",
        },
        assisted: false,
        verdict: "incorrect",
        dispute: {
          recordedAt: AT,
          reason: "One is right.",
          outcome: {
            verdict: "correct",
            reason: "The key was wrong.",
            key: "A",
          },
        },
      },
      says: {
        verdict: { text: "Correct", className: "ok" },
        changed: true,
        sure: "75% sure",
      },
    },
    {
      name: "a choice missed whose key a dispute corrected to a choice not picked: still missed, with the corrected key",
      entry: {
        kind: "answer",
        recordedAt: AT,
        question: { ...CHOICE, choices: ["One", "Two", "Three"] },
        answer: {
          kind: "choice",
          questionId: "q",
          choice: "A",
          confidence: "50",
        },
        assisted: false,
        verdict: "incorrect",
        dispute: {
          recordedAt: AT,
          reason: "B is not right either.",
          outcome: {
            verdict: "incorrect",
            reason: "Three is the right one.",
            key: "C",
          },
        },
      },
      says: {
        verdict: { text: "Not quite", className: "no" },
        changed: false,
        sure: "50% sure",
        correctChoice: "C",
      },
    },
    {
      name: "a right written answer with help, changed to a miss by a dispute: help then changes nothing",
      entry: {
        kind: "answer",
        recordedAt: AT,
        question: WRITTEN,
        answer: {
          kind: "written",
          questionId: "q",
          text: "Because.",
          confidence: "90",
        },
        assisted: true,
        verdict: "correct",
        dispute: {
          recordedAt: AT,
          reason: "I guessed; this proves nothing.",
          outcome: { verdict: "incorrect", reason: "It gives no reason." },
        },
      },
      says: {
        verdict: { text: "Not quite", className: "no" },
        changed: true,
        sure: "90% sure",
        help: "With help",
      },
    },
    {
      name: "a math miss whose grade stands, though a dispute corrected the expected answer",
      entry: {
        kind: "answer",
        recordedAt: AT,
        question: MATH,
        answer: {
          kind: "math",
          questionId: "q",
          expression: "x^2",
          confidence: "100",
        },
        assisted: false,
        verdict: "incorrect",
        dispute: {
          recordedAt: AT,
          reason: "The expected answer is wrong.",
          outcome: {
            verdict: "incorrect",
            reason: "It is $3x^2 + 1$; $x^2$ is not that either.",
            expected: "3x^2 + 1",
          },
        },
      },
      says: {
        verdict: { text: "Not quite", className: "no" },
        changed: false,
        sure: "100% sure",
        expected: "3x^2 + 1",
      },
    },
  ],
)("$name", ({ entry, says }) => {
  expect(answerLine(entry)).toEqual(says);
});

test("a code question's output marks its failure lines, and its last line as the pass or the failure the verdict says", () => {
  const failed = [
    "..F",
    "FAILED test_bpe.py::test_tie - assert (7, 8) == (5, 6)",
    "1 failed, 2 passed in 0.04s",
    "Exit status 1.",
  ].join("\n");
  expect(outputLines(failed, "incorrect")).toEqual([
    { text: "..F" },
    {
      text: "FAILED test_bpe.py::test_tie - assert (7, 8) == (5, 6)",
      mark: "f",
    },
    { text: "1 failed, 2 passed in 0.04s" },
    { text: "Exit status 1.", mark: "f" },
  ]);
  expect(outputLines("...\n3 passed in 0.02s", "correct")).toEqual([
    { text: "..." },
    { text: "3 passed in 0.02s", mark: "p" },
  ]);
});

test("an entry's date is the day and the time it was recorded, in local time", () => {
  expect(recordedOn(AT)).toBe("14 November 2026, 10:05");
  expect(recordedOn(new Date(2026, 0, 3, 21, 40).toISOString())).toBe(
    "3 January 2026, 21:40",
  );
});
