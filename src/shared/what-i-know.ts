// "What I know" (brief.md, "Other features"; task 2.26): a course's planned
// units, each objective with its status and the evidence behind it, as
// `GET /api/courses/<id>/what-i-know` sends it to the page. Derived from the
// record when asked (src/server/record/what-i-know.ts), never stored.
//
// A question is shown as the learner saw it, and a choice question with its
// right letter and a math question with its expected answer, since it has
// been answered. A written question's rubric is left out: it is written for
// the grader and never shown to the learner (`rubric` in question.ts); so
// are a code question's tests, solution and command (task 3.7), whose
// output the answer keeps. A disputed answer carries its dispute (task
// 3.8): the answer keeps its first grade, and the dispute the outcome it
// now counts with; what it was graded by is asked for only to dispute it
// (`GradedBy` in dispute.ts).

import { z } from "zod";
import { Calibration } from "./calibration.ts";
import { Slug, Timestamp } from "./course.ts";
import { ShownDispute } from "./dispute.ts";
import { Assessment } from "./evidence.ts";
import { Objective } from "./plan.ts";
import {
  AnswerSubmission,
  ChoiceQuestion,
  CodeFile,
  MathQuestion,
  Unsettled,
  Verdict,
  WrittenQuestion,
} from "./question.ts";
import { ObjectiveStatus, UnitStatus } from "./status.ts";

export const ShownQuestion = z.discriminatedUnion("kind", [
  ChoiceQuestion,
  MathQuestion,
  WrittenQuestion.omit({ rubric: true }),
  z.object({
    kind: z.literal("code"),
    prompt: z.string(),
    /** The files the learner edits, by their paths in the workspace. */
    files: z.array(CodeFile.shape.path),
  }),
]);
export type ShownQuestion = z.infer<typeof ShownQuestion>;

/**
 * One line of an objective's evidence: an answer that checked it, or an
 * override that named it (with any other objectives, which are not listed).
 * The fields of an answer are the evidence's (`AnswerEvidence` in
 * evidence.ts), less the objective, which is the one it sits under, with
 * its dispute if it has one. `verdict` is the first grade.
 */
export const ShownEvidence = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("answer"),
    recordedAt: Timestamp,
    question: ShownQuestion,
    answer: AnswerSubmission,
    assisted: z.boolean(),
    verdict: Verdict,
    flaw: z.string().min(1).optional(),
    unsettled: Unsettled.optional(),
    output: z.string().optional(),
    assessment: Assessment.optional(),
    dispute: ShownDispute.optional(),
  }),
  z.object({ kind: z.literal("override"), recordedAt: Timestamp }),
]);
export type ShownEvidence = z.infer<typeof ShownEvidence>;

export const KnownObjective = Objective.extend({
  /** With each disputed answer counted by its dispute's verdict. */
  status: ObjectiveStatus,
  /** In log order, the order it was recorded in, whatever its timestamps say. */
  evidence: z.array(ShownEvidence),
});
export type KnownObjective = z.infer<typeof KnownObjective>;

export const KnownUnit = z.object({
  id: Slug,
  /** Its place in the curriculum, from 1. */
  number: z.number().int().positive(),
  title: z.string(),
  status: UnitStatus,
  /**
   * In the order the plan's segments teach them; null until the unit is
   * planned, which happens when it starts.
   */
  objectives: z.array(KnownObjective).nullable(),
});
export type KnownUnit = z.infer<typeof KnownUnit>;

export const WhatIKnow = z.object({
  title: z.string(),
  /** Every unit of the approved curriculum, in order. */
  units: z.array(KnownUnit),
  /** The course's answers counted by confidence level (task 2.29). */
  calibration: Calibration,
});
export type WhatIKnow = z.infer<typeof WhatIKnow>;
