// state.json: where the learner stands in each unit in progress. Several
// units can be in progress at once,
// each keeping its place (task 2.1, piece 12). A unit is in progress from
// when it starts until it closes; the engine writes its position after every
// change, so an open question, or an open detour (task 2.20), survives a
// restart.

import { z } from "zod";
import { Slug, Timestamp } from "./course.ts";
import { CurriculumChange, CurriculumDecision } from "./curriculum-change.ts";
import { AssessmentMode, OverrideEvidence } from "./evidence.ts";
import { PackageCompletion, PackageRequest } from "./packages.ts";
import { AnswerSubmission, Question, QuestionKind } from "./question.ts";
import { StyleDecision, StyleProposal } from "./style.ts";

/** A segment's phases, in order. */
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
    /** Stop canceled the next question while the kept answer waited for judging. */
    stopAfterAnswer: z.literal(true).optional(),
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

/** An objective a self-test passed over: no kind picked fits it, by the tutor's reason. */
export const PassedOver = z.object({
  objective: Slug,
  reason: z.string().trim().min(1),
});
export type PassedOver = z.infer<typeof PassedOver>;

/**
 * A run of questions without teaching, asked by the unit's tutor in the
 * unit's thread: review at the start of
 * a sitting, the unit's gate once its last segment has closed, the test
 * before the unit is taught, which is under way as soon as it starts, or
 * a self-test, under way as soon as the learner sets it up. It is
 * kept beside the phase, which it leaves alone, so a restart reopens it;
 * once it ends, the unit goes on where it was, after a gate comes to its
 * end, and after a test waits on its result card. While it is under way,
 * the position's open question and detour are its own.
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
    /** In a self-test, and only there: the kinds of question the learner picked. */
    kinds: z.array(QuestionKind).min(1).optional(),
    /** In a self-test: the objectives passed over so far, in order. */
    passedOver: z.array(PassedOver).min(1).optional(),
  })
  .refine((a) => (a.stage === "on") === (a.from !== undefined), {
    message:
      "Where an assessment began in the evidence is kept once it is under way, and only then.",
    path: ["from"],
  })
  .refine((a) => (a.mode === "self-test") === (a.kinds !== undefined), {
    message:
      "A self-test keeps the kinds of question picked, and no other run does.",
    path: ["kinds"],
  })
  .refine((a) => a.passedOver === undefined || a.mode === "self-test", {
    message: "Only a self-test passes over an objective.",
    path: ["passedOver"],
  });
export type AssessmentRun = z.infer<typeof AssessmentRun>;

/**
 * The test before the unit is taught (docs/brief.md, "Assessment modes"),
 * beside the run it is while under way: chosen and not
 * started yet, over with its result card waiting, or what the learner chose
 * to skip once they answered it.
 */
export const TestOut = z.discriminatedUnion("stage", [
  /** Chosen before the unit started; it starts once a review offered first ends. */
  z.object({ stage: z.literal("due") }),
  /** Over: its result card waits for the learner, and nothing is skipped until they answer it. */
  z.object({ stage: z.literal("result") }),
  /**
   * The learner chose to skip what it passed: these objectives, as they
   * stood then. A segment with every objective among them is skipped, and
   * one with some teaches and checks only the rest (`skipping` in plan.ts).
   * Kept until the unit finishes.
   */
  z.object({ stage: z.literal("skip"), passed: z.array(Slug).min(1) }),
]);
export type TestOut = z.infer<typeof TestOut>;

/**
 * Something the tutor is told in its next header, kept until a turn
 * carrying it is sent, so a restart does not lose it: the learner moved on
 * without the check (with the question withdrawn, if one was open), or saw
 * none of a source teaching turn that reached the tutor. The wording is the
 * engine's (`noticeText` in `engine/unit-turns.ts`).
 */
export const TutorNotice = z.discriminatedUnion("kind", [
  z.object({
    id: z.uuid(),
    kind: z.literal("override"),
    objectives: z.array(Slug).min(1),
    withdrawn: z.number().int().positive().optional(),
  }),
  z.object({ id: z.uuid(), kind: z.literal("unshown-lecture") }),
]);
export type TutorNotice = z.infer<typeof TutorNotice>;

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
    /** The step owed for a closed question; its grade lives in evidence. */
    afterAnswer: z
      .object({
        questionId: z.string().min(1),
        number: z.number().int().positive(),
        step: z.enum(["feedback", "next", "detour-ended", "stopped"]),
        stopAfterFeedback: z.literal(true).optional(),
        feedbackFailed: z.literal(true).optional(),
      })
      .optional(),
    /** An assessment offered or under way, until it ends or is skipped. */
    assessment: AssessmentRun.optional(),
    /**
     * Set once the unit's gate has been offered, since it is offered once:
     * kept until the unit finishes, across going over objectives again.
     */
    gated: z.literal(true).optional(),
    /** The test before the unit is taught, outside the run it is while under way. */
    testOut: TestOut.optional(),
    /** Another unit's objective with an open question withdrawn when the gate was skipped. */
    gateUnanswered: Slug.optional(),
    /** A segment override whose evidence or closed position has not been saved yet. */
    pendingSegmentOverride: OverrideEvidence.required({
      moveOnId: true,
    }).optional(),
    /** A closing-card override whose gate or finish has not been saved yet. */
    pendingMoveOn: OverrideEvidence.required({ moveOnId: true })
      .extend({
        // The confirmed gate questions, or [] for a finish without a gate.
        // Older pending moves did not keep a pick.
        gate: z.array(AssessedObjective).optional(),
      })
      .optional(),
    /** The tutor's session on the backend, once the backend has reported it. */
    tutorSessionId: z.string().min(1).optional(),
    /**
     * The tutor's request to install packages in the course's workspace,
     * from when it asks until the learner answers it (task 3.11). Kept
     * across the unit's moves, as the session's id is.
     */
    packageRequest: PackageRequest.optional(),
    /**
     * The tutor's proposed change to the course's style note, from when it
     * proposes it until the learner answers it (task 5.11). Kept across the
     * unit's moves, as a package request is.
     */
    styleProposal: StyleProposal.optional(),
    /**
     * The tutor's proposed change to the course's curriculum, from when it
     * proposes it until the learner answers it (task 5.12). Kept across the
     * unit's moves, as a style proposal is.
     */
    curriculumChange: CurriculumChange.optional(),
    /** Notices waiting for the tutor's next header, in order. Kept across moves, as the session's id is. */
    tutorNotices: z.array(TutorNotice).min(1).optional(),
  })
  .refine((p) => (p.phase === "check") === (p.checkFrom !== undefined), {
    message:
      "Where the check began in the evidence is kept in the check, and only there.",
    path: ["checkFrom"],
  })
  .refine(
    (p) =>
      p.pendingSegmentOverride === undefined ||
      ((p.phase === "discuss" || p.phase === "check") &&
        p.assessment === undefined),
    {
      message:
        "A segment override is pending only during discussion or a check.",
      path: ["pendingSegmentOverride"],
    },
  )
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
  )
  .refine(
    (p) =>
      p.testOut === undefined ||
      p.testOut.stage === "skip" ||
      (p.segment === 0 && p.phase === "teach" && p.again === undefined),
    {
      message:
        "A test is due, or its result waits, only before the unit's first segment is taught.",
      path: ["testOut"],
    },
  )
  .refine(
    (p) =>
      p.testOut?.stage !== "result" ||
      (p.assessment === undefined &&
        p.openQuestion === undefined &&
        p.detour === undefined),
    {
      message:
        "A test's result waits only once no assessment, question or detour is open.",
      path: ["testOut"],
    },
  );
export type UnitPosition = z.infer<typeof UnitPosition>;

/** Whether questions are asked: in the check, or in an assessment under way. */
function asking(p: { phase: Phase; assessment?: AssessmentRun | undefined }) {
  return p.phase === "check" || p.assessment?.stage === "on";
}

/**
 * Whether the unit is before its test is answered: the test before the unit
 * is due (behind a review offered first), under way, or its result card
 * waits. No segment has begun.
 */
export function isBeforeTest(
  p: Pick<UnitPosition, "testOut" | "assessment">,
): boolean {
  return (
    p.testOut?.stage === "due" ||
    p.testOut?.stage === "result" ||
    p.assessment?.mode === "test-out"
  );
}

export const State = z.object({
  /** The units in progress, by id. */
  units: z.record(Slug, UnitPosition),
  /**
   * Finished units holding an assessment the learner asked for, a review
   * or a self-test, by id: the unit's position while it runs, with its
   * run, open question, detour and tutor session. The unit stays finished,
   * so it is not in `units`; its entry goes once the run ends. (Named when
   * only a review could run there; the name stays so older records read.)
   */
  finishedReviews: z.record(Slug, UnitPosition).optional(),
  /** Units finished without teaching after the learner accepted a full pass. */
  testedOut: z.record(Slug, z.literal(true)).optional(),
  /** Terminal package cards, by unit id and request id, including finished units. */
  packageCompletions: z
    .record(Slug, z.record(z.string().min(1), PackageCompletion))
    .optional(),
  /** Answers not yet delivered to the tutor, by unit id, in order. */
  styleDecisions: z.record(Slug, z.array(StyleDecision)).optional(),
  /** Original style.md bytes as text, or null if absent, during an Apply. */
  styleRollback: z.object({ was: z.string().nullable() }).optional(),
  /** Answers to curriculum changes not yet delivered to the tutor, by unit id, in order. */
  curriculumDecisions: z.record(Slug, z.array(CurriculumDecision)).optional(),
});
export type State = z.infer<typeof State>;
