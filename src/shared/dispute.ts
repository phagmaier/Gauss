// Disputes (brief.md, "Mastery and evidence"; docs/decisions.md,
// "Disputes"): the learner contests the grade of one recorded answer, once,
// with a reason, and a separate one-shot call, the dispute judge, decides.
// After an "I don't know" to a choice or math question, the learner can
// report the answer shown as wrong in the same way: the judge decides only
// the key, and the miss stands. The outcome is kept in the evidence beside
// the answer's line, which keeps its first grade (`DisputeEvidence` in
// evidence.ts); the answer then counts with the outcome's verdict wherever
// it stands in the log.

import { z } from "zod";
import { Timestamp } from "./course.ts";
import { ChoiceLetter, CodeFile, SavedCodeInput, Verdict } from "./question.ts";

/** The learner's reason, required, as long as a choice's reasoning may be. */
export const DisputeReason = z.string().trim().min(1).max(10_000);

/**
 * What a dispute decided, as the record keeps it. The verdict is the one the
 * answer now counts with: the first grade's when it stands, and "unknown",
 * always, for an "I don't know".
 */
export const DisputeOutcome = z.object({
  verdict: Verdict,
  /** The judge's reason, shown to the learner with the outcome. */
  reason: z.string().trim().min(1),
  /**
   * For a choice question whose key was wrong: the right letter, in the
   * order the choices were shown. It then shows wherever the key did.
   */
  key: ChoiceLetter.optional(),
  /**
   * For a math question whose expected expression was wrong: the right one,
   * which then shows wherever the expected expression did.
   */
  expected: z.string().trim().min(1).max(1000).optional(),
});
export type DisputeOutcome = z.infer<typeof DisputeOutcome>;

/** The verdict an answer counts with: its dispute's outcome's, or its own. */
export function countedVerdict<V extends string>(
  verdict: V,
  dispute: { outcome: DisputeOutcome } | undefined,
): V | DisputeOutcome["verdict"] {
  return dispute === undefined ? verdict : dispute.outcome.verdict;
}

// --- What the dispute judge returns ------------------------------------------

/**
 * The dispute judge's reply (prompts/dispute-judge.md), asked of the model
 * as JSON in this shape. The engine keeps a key only for a choice question
 * and an expected expression only for a math one, and only when they differ
 * from the question's; a choice question's verdict must agree with its key.
 * For an "I don't know" the verdict is not read: the miss stands.
 */
export const DisputeJudgment = z.object({
  reason: z
    .string()
    .trim()
    .min(1)
    .describe(
      "Shown to the learner beside the outcome: one to three sentences on why the grade is right or wrong, about the answer itself. Written before the verdict.",
    ),
  verdict: z
    .enum(["correct", "incorrect"])
    .describe(
      'What the grade should be: "correct" only if the answer is right, by what the question asks; otherwise "incorrect". The same as the grade when it stands.',
    ),
  key: ChoiceLetter.optional().describe(
    "Choice questions only: the letter of the correct choice, as the choices are listed in the request. Give it always for a choice question: the key's letter if the key is right, another if it is wrong.",
  ),
  expected: z
    .string()
    .trim()
    .min(1)
    .max(1000)
    .optional()
    .describe(
      "Math questions only, and only when the expected answer is wrong: the right answer, in LaTeX without $ signs.",
    ),
});
export type DisputeJudgment = z.infer<typeof DisputeJudgment>;

// --- What the page sees and sends --------------------------------------------

/**
 * What a recorded answer was graded by, which the learner sees while
 * disputing it, and nowhere else: the choice key, the expected expression
 * (with the rubric the grader had, when the symbolic check left it to the
 * grader), the rubric, or a code question's tests, saved inputs and command.
 */
export const GradedBy = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("choice"), key: ChoiceLetter }),
  z.object({
    kind: z.literal("math"),
    expected: z.string(),
    /** Set when the grader graded it, against this rubric made from the expression. */
    rubric: z.string().optional(),
  }),
  z.object({ kind: z.literal("written"), rubric: z.string() }),
  z.object({
    kind: z.literal("code"),
    tests: z.array(CodeFile),
    /** Missing from answers recorded before dependency snapshots. */
    inputs: z.array(SavedCodeInput).optional(),
    command: z.array(z.string()),
  }),
]);
export type GradedBy = z.infer<typeof GradedBy>;

/** A dispute as the page sends it, for the answer the route names. */
export const DisputePost = z.object({ reason: DisputeReason });
export type DisputePost = z.infer<typeof DisputePost>;

/** A dispute as the page shows it: with the answer it names, on its card. */
export const ShownDispute = z.object({
  recordedAt: Timestamp,
  reason: z.string(),
  outcome: DisputeOutcome,
});
export type ShownDispute = z.infer<typeof ShownDispute>;
