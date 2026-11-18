// One line of evidence.jsonl: a recorded result for an objective (brief.md,
// "Evidence"), or the learner's override. The log is appended to, never
// rewritten, and objective status is derived from it (task 2.3), never
// stored. Entries name objectives by id, which is unique in the course.
// Disputes join in task 3.8.

import { z } from "zod";
import { Slug, Timestamp } from "./course.ts";
import { AnswerSubmission, Question, Unsettled, Verdict } from "./question.ts";

/** A graded answer to a check question. */
export const AnswerEvidence = z
  .object({
    kind: z.literal("answer"),
    recordedAt: Timestamp,
    /** The id of the objective the question checked. */
    objective: Slug,
    /** The question as posted, with its grading material. */
    question: Question,
    /** The learner's answer as submitted, with confidence and reasoning. */
    answer: AnswerSubmission,
    /**
     * Whether the learner had help: a reply of the tutor's to a message they
     * sent while the question was open was judged help, or could not be
     * judged (task 2.21). Before task 2.21, any message the tutor received
     * while the question was open.
     */
    assisted: z.boolean(),
    verdict: Verdict,
    /**
     * For an answer the grader graded incorrect, and only there: the first
     * flawed step or missing element, as the grader named it (task 2.8).
     */
    flaw: z.string().min(1).optional(),
    /**
     * For a math answer the symbolic check did not settle, and only there:
     * why. The grader graded it instead (task 3.5).
     */
    unsettled: Unsettled.optional(),
    /**
     * For a code answer, and only there: the end of what the tests wrote as
     * they ran on the learner's files (task 3.7).
     */
    output: z.string().optional(),
  })
  .refine((e) => (e.answer.kind === "unknown") === (e.verdict === "unknown"), {
    message: `An "I don't know" is graded "unknown", and nothing else is.`,
    path: ["verdict"],
  })
  .refine(
    (e) => e.answer.kind === "unknown" || e.answer.kind === e.question.kind,
    {
      message: "The answer is not of its question's kind.",
      path: ["answer", "kind"],
    },
  )
  .refine(
    (e) =>
      e.unsettled === undefined ||
      (e.question.kind === "math" && e.answer.kind === "math"),
    {
      message: "Only a math answer can be left unsettled by the check.",
      path: ["unsettled"],
    },
  )
  .refine((e) => (e.output !== undefined) === (e.answer.kind === "code"), {
    message:
      "A code answer keeps the end of its tests' output, and no other answer does.",
    path: ["output"],
  })
  .refine((e) => (e.flaw !== undefined) === gradedIncorrectByGrader(e), {
    message:
      "An answer the grader graded incorrect names its flaw, and no other answer does.",
    path: ["flaw"],
  });
export type AnswerEvidence = z.infer<typeof AnswerEvidence>;

/**
 * The grader grades a written answer, and a math answer the check did not
 * settle; it names a flaw in each one it grades incorrect.
 */
function gradedIncorrectByGrader(e: {
  question: Question;
  verdict: Verdict;
  unsettled?: Unsettled | undefined;
}): boolean {
  return (
    e.verdict === "incorrect" &&
    (e.question.kind === "written" ||
      (e.question.kind === "math" && e.unsettled !== undefined))
  );
}

/** The learner moved on without passing these objectives (brief.md, "Override"). */
export const OverrideEvidence = z.object({
  kind: z.literal("override"),
  recordedAt: Timestamp,
  objectives: z.array(Slug).min(1),
});
export type OverrideEvidence = z.infer<typeof OverrideEvidence>;

export const EvidenceEntry = z.discriminatedUnion("kind", [
  AnswerEvidence,
  OverrideEvidence,
]);
export type EvidenceEntry = z.infer<typeof EvidenceEntry>;
