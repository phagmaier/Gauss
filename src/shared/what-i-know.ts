// "What I know" (brief.md, "Other features"; task 2.26): a course's planned
// units, each objective with its status and the evidence behind it, as
// `GET /api/courses/<id>/what-i-know` sends it to the page. Derived from the
// record when asked (src/server/record/what-i-know.ts), never stored.
//
// A question is shown as the learner saw it, and a choice question with its
// right letter, since it has been answered. A written question's rubric is
// left out: it is written for the grader and never shown to the learner
// (`rubric` in question.ts).

import { z } from "zod";
import { Calibration } from "./calibration.ts";
import { Slug, Timestamp } from "./course.ts";
import { Objective } from "./plan.ts";
import {
  AnswerSubmission,
  ChoiceQuestion,
  Verdict,
  WrittenQuestion,
} from "./question.ts";
import { ObjectiveStatus, UnitStatus } from "./status.ts";

export const ShownQuestion = z.discriminatedUnion("kind", [
  ChoiceQuestion,
  WrittenQuestion.omit({ rubric: true }),
]);
export type ShownQuestion = z.infer<typeof ShownQuestion>;

/**
 * One line of an objective's evidence: an answer that checked it, or an
 * override that named it (with any other objectives, which are not listed).
 * The fields of an answer are the evidence's (`AnswerEvidence` in
 * evidence.ts), less the objective, which is the one it sits under.
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
  }),
  z.object({ kind: z.literal("override"), recordedAt: Timestamp }),
]);
export type ShownEvidence = z.infer<typeof ShownEvidence>;

export const KnownObjective = Objective.extend({
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
