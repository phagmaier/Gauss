import { describe, expect, test } from "vitest";
import { EvidenceEntry } from "./evidence.ts";

const QUESTION = {
  kind: "choice",
  prompt: "What is the slope of the tangent to $y = x^2$ at $x = 3$?",
  choices: ["3", "6", "9"],
  answer: "B",
};

// Hand-written lines of evidence.jsonl: a correct answer with reasoning, a
// confident wrong one given after the learner asked the tutor for help, an
// "I don't know", and an override of a segment's two objectives.
const CORRECT = {
  kind: "answer",
  recordedAt: "2026-11-15T10:14:30.000Z",
  objective: "tangent-line",
  question: QUESTION,
  answer: {
    kind: "choice",
    questionId: "q4",
    choice: "B",
    confidence: "90",
    reasoning: "The derivative is 2x, so 6.",
  },
  assisted: false,
  verdict: "correct",
};
const ASSISTED_MISS = {
  ...CORRECT,
  answer: { kind: "choice", questionId: "q5", choice: "C", confidence: "100" },
  assisted: true,
  verdict: "incorrect",
};
const UNKNOWN = {
  ...CORRECT,
  answer: { kind: "unknown", questionId: "q6" },
  verdict: "unknown",
};
// A written answer graded incorrect by the grader, with the flaw it named.
const WRITTEN_MISS = {
  kind: "answer",
  recordedAt: "2026-11-15T10:16:00.000Z",
  objective: "tangent-line",
  question: {
    kind: "written",
    prompt: "Find the tangent to $y = x^2$ at $x = 3$, and explain each step.",
    rubric: "Slope $6$ from $y' = 2x$; the line $y - 9 = 6(x - 3)$.",
  },
  answer: {
    kind: "written",
    questionId: "q7",
    text: "The slope is $2x = 6$, so the tangent is $y = 6x$.",
    confidence: "75",
  },
  assisted: false,
  verdict: "incorrect",
  flaw: "The line $y = 6x$ does not pass through $(3, 9)$.",
};
// A math answer the check could not read, which the grader graded incorrect.
const MATH_MISS = {
  kind: "answer",
  recordedAt: "2026-11-15T10:18:00.000Z",
  objective: "tangent-line",
  question: {
    kind: "math",
    prompt: "Give the slope of $y = x^2$ at $x = 3$.",
    expected: "6",
  },
  answer: {
    kind: "math",
    questionId: "q8",
    expression: "2 \\cdot 3 \\cdot 3",
    confidence: "50",
  },
  assisted: false,
  verdict: "incorrect",
  flaw: "It gives $18$, not the slope $6$.",
  unsettled: { result: "undecided", reason: "the check ran out of time" },
};
const OVERRIDE = {
  kind: "override",
  recordedAt: "2026-11-15T10:20:00.000Z",
  objectives: ["derivative-rate", "tangent-line"],
};

test.each([
  { name: "a correct answer", entry: CORRECT },
  { name: "an assisted, confident miss", entry: ASSISTED_MISS },
  { name: `an "I don't know"`, entry: UNKNOWN },
  {
    name: "a written answer graded incorrect, with its flaw",
    entry: WRITTEN_MISS,
  },
  {
    name: "a written answer graded correct",
    entry: { ...WRITTEN_MISS, verdict: "correct", flaw: undefined },
  },
  {
    name: "a math answer the grader graded incorrect, with why and its flaw",
    entry: MATH_MISS,
  },
  {
    name: "a math answer the check graded incorrect",
    entry: { ...MATH_MISS, flaw: undefined, unsettled: undefined },
  },
  { name: "an override", entry: OVERRIDE },
])("$name parses unchanged", ({ entry }) => {
  expect(EvidenceEntry.parse(entry)).toEqual(entry);
});

describe("rejects", () => {
  test.each([
    {
      name: `an "I don't know" graded as anything but unknown`,
      input: { ...UNKNOWN, verdict: "incorrect" },
    },
    {
      name: "an answer graded as unknown",
      input: { ...CORRECT, verdict: "unknown" },
    },
  ])("$name", ({ input }) => {
    const result = EvidenceEntry.safeParse(input);

    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual([
      expect.objectContaining({
        path: ["verdict"],
        message: expect.stringMatching(/"I don't know"/),
      }),
    ]);
  });

  test.each([
    {
      name: "a written answer graded incorrect without its flaw",
      input: { ...WRITTEN_MISS, flaw: undefined },
      path: ["flaw"],
    },
    {
      name: "a written answer graded correct with a flaw",
      input: { ...WRITTEN_MISS, verdict: "correct" },
      path: ["flaw"],
    },
    {
      name: "a choice answer with a flaw",
      input: { ...ASSISTED_MISS, flaw: "Step 1." },
      path: ["flaw"],
    },
    {
      name: "a math answer the check graded incorrect, with a flaw",
      input: { ...MATH_MISS, unsettled: undefined },
      path: ["flaw"],
    },
    {
      name: "a math answer the grader graded incorrect, without its flaw",
      input: { ...MATH_MISS, flaw: undefined },
      path: ["flaw"],
    },
    {
      name: "a choice answer left unsettled by the symbolic check",
      input: { ...ASSISTED_MISS, unsettled: MATH_MISS.unsettled },
      path: ["unsettled"],
    },
    {
      name: "a choice answer to a written question",
      input: { ...WRITTEN_MISS, answer: ASSISTED_MISS.answer, flaw: undefined },
      path: ["answer", "kind"],
    },
  ])("$name", ({ input, path }) => {
    const result = EvidenceEntry.safeParse(input);

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => i.path)).toContainEqual(path);
  });

  test("an override that names no objective", () => {
    expect(
      EvidenceEntry.safeParse({ ...OVERRIDE, objectives: [] }).success,
    ).toBe(false);
  });
});
