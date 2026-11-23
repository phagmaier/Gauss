// One line of evidence.jsonl: a recorded result for an objective (brief.md,
// "Evidence"), the learner's override, or a dispute of an answer's grade
// with its outcome (task 3.8). The log is appended to, never rewritten, and
// objective status is derived from it (task 2.3), never stored. Entries
// name objectives by id, which is unique in the course, and a dispute names
// its answer by the question's id.

import { z } from "zod";
import { Slug, Timestamp } from "./course.ts";
import { DisputeOutcome, DisputeReason } from "./dispute.ts";
import { AnswerSubmission, Question, Unsettled, Verdict } from "./question.ts";

/**
 * The runs of questions without teaching that a unit's tutor asks: review
 * at the start of a sitting, the unit gate, and the test before a unit is
 * taught.
 */
export const AssessmentMode = z.enum(["review", "gate", "test-out"]);
export type AssessmentMode = z.infer<typeof AssessmentMode>;

/** The assessment an answer was given in, and the unit whose thread held it. */
export const Assessment = z.object({ mode: AssessmentMode, unit: Slug });
export type Assessment = z.infer<typeof Assessment>;

/** A graded answer to a question of a check or an assessment. */
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
    /**
     * For an answer given in an assessment, and only there: which. None for
     * a segment's check. Retained and slipping read it (record/status.ts).
     */
    assessment: Assessment.optional(),
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
  /** Identifies a pending move-on so retrying it cannot record it twice. */
  moveOnId: z.uuid().optional(),
});
export type OverrideEvidence = z.infer<typeof OverrideEvidence>;

/**
 * The learner disputed the grade of the answer to question `questionId`,
 * and the dispute judge decided (task 3.8). The answer's own line keeps its
 * first grade; it counts with this outcome's verdict where it stands in the
 * log. One per answer. For an "I don't know", which nothing graded, it
 * reports the answer shown as wrong: only the key can change.
 */
export const DisputeEvidence = z.object({
  kind: z.literal("dispute"),
  recordedAt: Timestamp,
  questionId: z.string(),
  reason: DisputeReason,
  outcome: DisputeOutcome,
});
export type DisputeEvidence = z.infer<typeof DisputeEvidence>;

export const EvidenceEntry = z.discriminatedUnion("kind", [
  AnswerEvidence,
  OverrideEvidence,
  DisputeEvidence,
]);
export type EvidenceEntry = z.infer<typeof EvidenceEntry>;
