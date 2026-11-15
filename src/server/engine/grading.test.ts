import { expect, test } from "vitest";
import type { AnswerSubmission } from "../../shared/question.ts";
import { gradeChoice } from "./grading.ts";

test.each([
  {
    name: "the correct choice",
    submission: {
      kind: "choice",
      questionId: "q1",
      choice: "B",
      confidence: "50",
    },
    verdict: "correct",
  },
  {
    name: "another choice",
    submission: {
      kind: "choice",
      questionId: "q1",
      choice: "A",
      confidence: "100",
    },
    verdict: "incorrect",
  },
  {
    name: '"I don\'t know"',
    submission: { kind: "unknown", questionId: "q1" },
    verdict: "unknown",
  },
] as const satisfies {
  name: string;
  submission: AnswerSubmission;
  verdict: string;
}[])("with B correct, $name is graded $verdict", ({ submission, verdict }) => {
  expect(gradeChoice("B", submission)).toBe(verdict);
});
