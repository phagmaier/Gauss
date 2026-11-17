// Grading dispatch (architecture.md section 6). Multiple choice is an exact
// match, done by the engine and never by a model. A written answer is graded
// against its rubric in a one-shot request with the grader's own prompt
// (`prompts/grader.md`, task 2.8): the request holds the question, the rubric
// and the answer, and nothing of the tutor's conversation, so the grade does
// not lean on what the tutor said or hoped. A math answer is compared with
// the expected expression by the symbolic check (math-check.ts, task 3.5);
// one the check does not settle goes to the grader, with a rubric made from
// the expression.

import {
  type AnswerSubmission,
  type ChoiceLetter,
  type MathAnswer,
  type MathQuestion,
  type Unsettled,
  type Verdict,
  WrittenGrade,
  type WrittenQuestion,
} from "../../shared/question.ts";
import type { TutorBackend } from "../backends/backend.ts";
import type { MathCheck } from "./math-check.ts";

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

/** A math answer's grade, or why there is none. */
export type MathOutcome =
  | {
      ok: true;
      verdict: "correct" | "incorrect";
      /** Set when the grader graded it incorrect. */
      flaw?: string;
      /** Set when the check did not settle it, so the grader graded it. */
      unsettled?: Unsettled;
    }
  | { ok: false; error: string };

/**
 * Grades a math answer by the symbolic check, or, when the check does not
 * settle it, by the grader against a rubric made from the expected
 * expression. Never throws: a failed grading is the grader's failure.
 */
export async function gradeMath(
  question: MathQuestion,
  answer: MathAnswer,
  by: { check: MathCheck; grader: Grader },
  signal?: AbortSignal,
): Promise<MathOutcome> {
  const checked = await by.check.compare(question.expected, answer.expression);
  if (checked.result === "equivalent") return { ok: true, verdict: "correct" };
  if (checked.result === "different") return { ok: true, verdict: "incorrect" };
  const graded = await by.grader.grade(
    { kind: "written", prompt: question.prompt, rubric: mathRubric(question) },
    answer.expression,
    signal,
  );
  return graded.ok ? { ...graded, unsettled: checked } : graded;
}

/**
 * The rubric the grader gets for a math answer the check did not settle:
 * correct if equal to the expected expression, as the check counts
 * equality (decisions.md, "Symbolic check").
 */
export function mathRubric(question: MathQuestion): string {
  const expected = question.expected.replaceAll("$", "");
  return [
    "The question asks only for a result, typed in a math field as LaTeX or plain text; no working is needed.",
    `Correct if the answer is mathematically equal to the expected answer, $${expected}$, in any form: rearranged, factored or expanded, simplified or not, or in other notation. A decimal counts if it is the exact value correctly rounded to at least three significant figures. Values separated by commas are compared as a set, in any order.`,
    "If the expected answer has a constant of integration ($+ C$), an answer that differs from it by a constant and has a constant of its own is equal to it; one with no constant is incorrect.",
    "Read the notation charitably where its meaning is plain. An answer whose meaning cannot be made out is incorrect.",
    "Incorrect: anything not equal to the expected answer. As the flaw, say where the answer differs from the expected one.",
  ].join("\n");
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
