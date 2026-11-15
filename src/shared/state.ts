// state.json: where the learner stands in each unit in progress
// (architecture.md section 3). Several units can be in progress at once,
// each keeping its place (task 2.1, piece 12). A unit is in progress from
// when it starts until it closes; the engine writes its position after every
// change, so an open question survives a restart. Detours join in stage 5.

import { z } from "zod";
import { Slug, Timestamp } from "./course.ts";
import { Question, WrittenAnswer } from "./question.ts";

/** A segment's phases, in order (architecture.md section 4, "Phases"). */
export const Phase = z.enum(["teach", "discuss", "check", "closed"]);
export type Phase = z.infer<typeof Phase>;

/** A question posted in the check and not yet graded. */
export const OpenQuestion = z
  .object({
    /** The id the page answers it by. */
    id: z.string().min(1),
    /** Its number as the page shows it. */
    number: z.number().int().positive(),
    /** The id of the objective it checks. That it is one of the segment's is the engine's rule (task 2.6). */
    objective: Slug,
    postedAt: Timestamp,
    /** What the learner sees, with the grading material, which the page never gets. */
    question: Question,
    /**
     * Set once the tutor has received a message from the learner while the
     * question waited for its answer, so the answer is recorded as given with
     * help (docs/decisions.md, "Objective status"; task 2.7).
     */
    assisted: z.literal(true).optional(),
    /**
     * A written answer, kept from when it is sent until its grade is recorded:
     * while it is graded, and after a grading that failed, until it is graded
     * again (task 2.8). The answer is final once sent.
     */
    answer: WrittenAnswer.optional(),
  })
  .refine((q) => q.answer === undefined || q.question.kind === "written", {
    message: "Only a written question keeps its answer while it is graded.",
    path: ["answer"],
  })
  .refine((q) => q.answer === undefined || q.answer.questionId === q.id, {
    message: "The answer kept is to another question.",
    path: ["answer", "questionId"],
  });
export type OpenQuestion = z.infer<typeof OpenQuestion>;

export const UnitPosition = z
  .object({
    /**
     * The segment in progress, or the last one closed: its index in the
     * plan, from 0, or the plan's segment count for the segment that goes
     * over objectives again.
     */
    segment: z.number().int().nonnegative(),
    /**
     * Set for a segment after the plan's last, which goes over objectives
     * that did not pass (task 2.7): their ids. An objective is taught in one
     * segment of the plan, so this one is kept here and not in the plan.
     */
    again: z.array(Slug).min(1).optional(),
    /** "closed" once the segment has closed, until the learner starts the next. */
    phase: Phase,
    /**
     * In the check, and only there: how many entries the evidence log held
     * when the check began. The check's answers are the entries after them
     * that name the segment's objectives (task 2.6).
     */
    checkFrom: z.number().int().nonnegative().optional(),
    openQuestion: OpenQuestion.optional(),
    /** The tutor's session on the backend, once the backend has reported it. */
    tutorSessionId: z.string().min(1).optional(),
  })
  .refine((p) => (p.phase === "check") === (p.checkFrom !== undefined), {
    message:
      "Where the check began in the evidence is kept in the check, and only there.",
    path: ["checkFrom"],
  })
  .refine((p) => p.openQuestion === undefined || p.phase === "check", {
    message: "A question can be open only in the check.",
    path: ["openQuestion"],
  });
export type UnitPosition = z.infer<typeof UnitPosition>;

export const State = z.object({
  /** The units in progress, by id. */
  units: z.record(Slug, UnitPosition),
});
export type State = z.infer<typeof State>;
