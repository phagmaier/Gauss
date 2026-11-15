// Grading dispatch (architecture.md section 6). Only multiple choice so far:
// an exact match, done by the engine and never by a model.

import type {
  AnswerSubmission,
  ChoiceLetter,
  Verdict,
} from "../../shared/question.ts";

export function gradeChoice(
  correct: ChoiceLetter,
  submission: AnswerSubmission,
): Verdict {
  if (submission.kind === "unknown") return "unknown";
  return submission.choice === correct ? "correct" : "incorrect";
}
