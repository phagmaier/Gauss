// state.json: where the learner stands in each unit in progress
// (architecture.md section 3). Several units can be in progress at once,
// each keeping its place (task 2.1, piece 12). A unit is in progress from
// when it starts until it closes; the engine writes its position after every
// change, so an open question, or an open detour (task 2.20), survives a
// restart.

import { z } from "zod";
import { Slug, Timestamp } from "./course.ts";
import { AssessmentMode } from "./evidence.ts";
import { PackageCompletion, PackageRequest } from "./packages.ts";
import { AnswerSubmission, Question } from "./question.ts";

/** A segment's phases, in order (architecture.md section 4, "Phases"). */
export const Phase = z.enum(["teach", "discuss", "check", "closed"]);
export type Phase = z.infer<typeof Phase>;

/** A question posted in the check, or in an assessment, and not yet graded. */
export const OpenQuestion = z
  .object({
    /** The id the page answers it by. */
    id: z.string().min(1),
    /** Its number as the page shows it. */
    number: z.number().int().positive(),
    /**
     * The id of the objective it checks. That it is one of the segment's, or
     * the one an assessment asks about next, is the engine's rule.
     */
    objective: Slug,
    postedAt: Timestamp,
    /** What the learner sees, with the grading material, which the page never gets. */
    question: Question,
    /**
     * Set once a reply of the tutor's to a message the learner sent while
     * the question waited for its answer was judged help, or could not be
     * judged, so the answer is recorded as given with help (task 2.21).
     */
    assisted: z.literal(true).optional(),
    /**
     * The learner's messages, by id, that the tutor received while the
     * question waited for its answer and whose replies are not judged yet
     * (task 2.21): from when the tutor receives one until the judge's call
     * on its reply. An answer sent meanwhile waits for them.
     */
    judging: z.array(z.string().min(1)).min(1).optional(),
    /**
     * The answer, kept from when it is sent until it is recorded: a written
     * one while it is graded, and after a grading that failed, until it is
     * graded again (task 2.8); any answer while replies are still to be
     * judged (task 2.21). The answer is final once sent.
     */
    answer: AnswerSubmission.optional(),
  })
  .refine(
    (q) =>
      q.answer === undefined ||
      q.answer.kind === "unknown" ||
      q.answer.kind === q.question.kind,
    {
      message: "The answer kept is not of its question's kind.",
      path: ["answer", "kind"],
    },
  )
  .refine((q) => q.answer === undefined || q.answer.questionId === q.id, {
    message: "The answer kept is to another question.",
    path: ["answer", "questionId"],
  });
export type OpenQuestion = z.infer<typeof OpenQuestion>;

/**
 * A detour (task 2.20): the pause in a check, or an assessment, after a
 * miss, where the tutor finds the learner's confusion and works through it
 * with them. It opens when the missed answer's question closes and lasts
 * until the learner asks for another question, moves on, or skips the
 * assessment. No question is posted during it.
 */
export const Detour = z.object({
  /** The question missed, by its id. */
  questionId: z.string().min(1),
  /** Its number as the page shows it. */
  number: z.number().int().positive(),
  /** The objective it checked. */
  objective: Slug,
});
export type Detour = z.infer<typeof Detour>;

/** An objective an assessment asks about, with the unit whose plan holds it. */
export const AssessedObjective = z.object({ unit: Slug, objective: Slug });
export type AssessedObjective = z.infer<typeof AssessedObjective>;

/**
 * A run of questions without teaching, asked by the unit's tutor in the
 * unit's thread (docs/decisions.md, "Mastery loop"): review at the start of
 * a sitting, or the unit's gate once its last segment has closed. It is
 * kept beside the phase, which it leaves alone, so a restart reopens it;
 * once it ends, the unit goes on where it was, or after a gate comes to
 * its end. While it is under way, the position's open question and detour
 * are its own.
 */
export const AssessmentRun = z
  .object({
    mode: AssessmentMode,
    /** "offered": its card waits for the learner's Start or Skip; "on": under way. */
    stage: z.enum(["offered", "on"]),
    /** What it asks about, in the order asked: one question each, and one more after a miss. */
    objectives: z.array(AssessedObjective).min(1),
    /**
     * Once under way: how many entries the evidence log held when it began.
     * Its answers are the entries after them that name its mode and this
     * unit (`Assessment` in evidence.ts).
     */
    from: z.number().int().nonnegative().optional(),
  })
  .refine((a) => (a.stage === "on") === (a.from !== undefined), {
    message:
      "Where an assessment began in the evidence is kept once it is under way, and only then.",
    path: ["from"],
  });
export type AssessmentRun = z.infer<typeof AssessmentRun>;

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
    /** The check's question, or the assessment's while one is under way. */
    openQuestion: OpenQuestion.optional(),
    /**
     * In the check, or in an assessment under way, after a miss, until the
     * learner asks for another question.
     */
    detour: Detour.optional(),
    /** An assessment offered or under way, until it ends or is skipped. */
    assessment: AssessmentRun.optional(),
    /**
     * Set once the unit's gate has been offered, since it is offered once:
     * kept until the unit finishes, across going over objectives again.
     */
    gated: z.literal(true).optional(),
    /** The tutor's session on the backend, once the backend has reported it. */
    tutorSessionId: z.string().min(1).optional(),
    /**
     * The tutor's request to install packages in the course's workspace,
     * from when it asks until the learner answers it (task 3.11). Kept
     * across the unit's moves, as the session's id is.
     */
    packageRequest: PackageRequest.optional(),
  })
  .refine((p) => (p.phase === "check") === (p.checkFrom !== undefined), {
    message:
      "Where the check began in the evidence is kept in the check, and only there.",
    path: ["checkFrom"],
  })
  .refine((p) => p.openQuestion === undefined || asking(p), {
    message:
      "A question can be open only in the check, or in an assessment under way.",
    path: ["openQuestion"],
  })
  .refine(
    (p) =>
      p.detour === undefined || (asking(p) && p.openQuestion === undefined),
    {
      message:
        "A detour is open only in the check, or in an assessment under way, and never with a question open.",
      path: ["detour"],
    },
  )
  .refine(
    (p) =>
      p.assessment?.stage !== "offered" ||
      (p.openQuestion === undefined && p.detour === undefined),
    {
      message:
        "An assessment is offered only while no question is open and no detour.",
      path: ["assessment"],
    },
  );
export type UnitPosition = z.infer<typeof UnitPosition>;

/** Whether questions are asked: in the check, or in an assessment under way. */
function asking(p: { phase: Phase; assessment?: AssessmentRun | undefined }) {
  return p.phase === "check" || p.assessment?.stage === "on";
}

export const State = z.object({
  /** The units in progress, by id. */
  units: z.record(Slug, UnitPosition),
  /** Terminal package cards, by unit id and request id, including finished units. */
  packageCompletions: z
    .record(Slug, z.record(z.string().min(1), PackageCompletion))
    .optional(),
});
export type State = z.infer<typeof State>;
