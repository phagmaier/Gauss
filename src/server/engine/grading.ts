// Grading dispatch (architecture.md section 6). Multiple choice is an exact
// match, done by the engine and never by a model. A written answer is graded
// against its rubric in a one-shot request with the grader's own prompt
// (`prompts/grader.md`, task 2.8): the request holds the question, the rubric
// and the answer, and nothing of the tutor's conversation, so the grade does
// not lean on what the tutor said or hoped.

import {
  type AnswerSubmission,
  type ChoiceLetter,
  type Verdict,
  WrittenGrade,
  type WrittenQuestion,
} from "../../shared/question.ts";
import type { TutorBackend } from "../backends/backend.ts";

export function gradeChoice(
  correct: ChoiceLetter,
  submission: AnswerSubmission,
): Verdict {
  if (submission.kind === "unknown") return "unknown";
  return submission.kind === "choice" && submission.choice === correct
    ? "correct"
    : "incorrect";
}

/** A written answer's grade, or why there is none. */
export type WrittenOutcome =
  | {
      ok: true;
      verdict: "correct" | "incorrect";
      /** Set when incorrect: the first flawed step or missing element. */
      flaw?: string;
    }
  | { ok: false; error: string };

export interface Grader {
  /** Never throws: a failed request or a reply not in shape is a failure. */
  grade(
    question: WrittenQuestion,
    answer: string,
    signal?: AbortSignal,
  ): Promise<WrittenOutcome>;
}

/** How long a grading request may take before it is stopped and fails. */
export const GRADING_TIME_LIMIT_MS = 3 * 60_000;

export function createGrader(options: {
  backend: TutorBackend;
  /** `prompts/grader.md`. */
  systemPrompt: string;
  timeLimitMs?: number;
}): Grader {
  const timeLimitMs = options.timeLimitMs ?? GRADING_TIME_LIMIT_MS;
  return {
    async grade(question, answer, signal) {
      const limit = AbortSignal.timeout(timeLimitMs);
      const result = await options.backend.oneShot({
        systemPrompt: options.systemPrompt,
        prompt: gradingRequest(question, answer),
        schema: WrittenGrade,
        signal: signal === undefined ? limit : AbortSignal.any([limit, signal]),
      });
      if (!result.ok) {
        return {
          ok: false,
          error: limit.aborted
            ? `The grader took longer than ${duration(timeLimitMs)} and was stopped.`
            : result.error,
        };
      }
      const { verdict, flaw } = result.value;
      // A flaw named on a correct answer is not kept.
      return verdict === "correct"
        ? { ok: true, verdict }
        : { ok: true, verdict, ...(flaw === undefined ? {} : { flaw }) };
    },
  };
}

/**
 * The grader's request: the question as the learner saw it, the tutor's
 * rubric, and the learner's answer, each between tags, so that an answer
 * that looks like instructions stays part of the answer.
 */
export function gradingRequest(
  question: WrittenQuestion,
  answer: string,
): string {
  return [
    "Grade the learner's answer to this question against the rubric.",
    "",
    "<question>",
    question.prompt.trim(),
    "</question>",
    "",
    "<rubric>",
    question.rubric.trim(),
    "</rubric>",
    "",
    "<answer>",
    answer.trim(),
    "</answer>",
  ].join("\n");
}

/** A time limit as a message says it: "20 ms", "3 minutes", "90 seconds". */
export function duration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  const s = Math.round(ms / 1000);
  return s >= 60 && s % 60 === 0
    ? `${s / 60} minute${s === 60 ? "" : "s"}`
    : `${s} second${s === 1 ? "" : "s"}`;
}
