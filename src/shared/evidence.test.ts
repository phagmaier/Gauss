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
const OVERRIDE = {
  kind: "override",
  recordedAt: "2026-11-15T10:20:00.000Z",
  objectives: ["derivative-rate", "tangent-line"],
};

test.each([
  { name: "a correct answer", entry: CORRECT },
  { name: "an assisted, confident miss", entry: ASSISTED_MISS },
  { name: `an "I don't know"`, entry: UNKNOWN },
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

  test("an override that names no objective", () => {
    expect(
      EvidenceEntry.safeParse({ ...OVERRIDE, objectives: [] }).success,
    ).toBe(false);
  });
});
