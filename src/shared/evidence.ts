// One line of evidence.jsonl: a recorded result for an objective (brief.md,
// "Evidence"), or the learner's override. The log is appended to, never
// rewritten, and objective status is derived from it (task 2.3), never
// stored. Entries name objectives by id, which is unique in the course.
// Disputes join in stage 3.

import { z } from "zod";
import { Slug, Timestamp } from "./course.ts";
import { AnswerSubmission, Question, Verdict } from "./question.ts";

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
     * Whether the learner had help: the tutor received a message from them
     * while the question was open (docs/decisions.md, "Objective status").
     */
    assisted: z.boolean(),
    verdict: Verdict,
  })
  .refine((e) => (e.answer.kind === "unknown") === (e.verdict === "unknown"), {
    message: `An "I don't know" is graded "unknown", and nothing else is.`,
    path: ["verdict"],
  });
export type AnswerEvidence = z.infer<typeof AnswerEvidence>;

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
