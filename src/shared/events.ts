// What the server tells the page over the event stream, and what the page
// posts back.

import { z } from "zod";
import { Slug } from "./course.ts";
import { Unit } from "./curriculum.ts";
import { ChoiceLetter, Confidence, QuestionView, Verdict } from "./question.ts";

/**
 * One entry in a chat's event log. The log is replayed to every page that
 * connects, so a reload rebuilds the thread.
 */
export const PageEvent = z.discriminatedUnion("type", [
  /** The learner's own message, echoed so a replay shows it. */
  z.object({ type: z.literal("learner"), text: z.string() }),
  /** The tutor has been sent a turn and is writing. */
  z.object({ type: z.literal("turn_start") }),
  /** A piece of the tutor's reply. */
  z.object({ type: z.literal("tutor_text"), text: z.string() }),
  /** The tutor posted a question. */
  z.object({ type: z.literal("question"), question: QuestionView }),
  /** The engine graded an answer. The correct choice is revealed here. */
  z.object({
    type: z.literal("graded"),
    questionId: z.string(),
    verdict: Verdict,
    choice: ChoiceLetter.nullable(),
    confidence: Confidence.nullable(),
    correctChoice: ChoiceLetter,
  }),
  /**
   * The intake starts from a stored draft, because the conversation that
   * proposed it was lost in a restart. Its proposal follows as revision 1.
   */
  z.object({ type: z.literal("draft_reopened") }),
  /**
   * The tutor proposed a curriculum. Each revision replaces the one before;
   * only the latest can be approved.
   */
  z.object({
    type: z.literal("curriculum_proposed"),
    courseId: Slug,
    revision: z.number().int().positive(),
    title: z.string(),
    units: z.array(Unit),
  }),
  /** The learner approved a revision of the curriculum. The intake is over. */
  z.object({
    type: z.literal("curriculum_approved"),
    courseId: Slug,
    revision: z.number().int().positive(),
  }),
  /** The tutor's turn is over. */
  z.object({
    type: z.literal("turn_end"),
    outcome: z.enum(["done", "interrupted", "error"]),
    error: z.string().optional(),
  }),
]);
export type PageEvent = z.infer<typeof PageEvent>;

/**
 * Sent first on every connection, outside the log. A page that sees a chat id
 * other than the one it was showing starts over, because the server
 * restarted.
 */
export const Hello = z.object({ chatId: z.string() });
export type Hello = z.infer<typeof Hello>;

/** A message the learner typed in the message box. */
export const LearnerMessage = z.object({
  text: z.string().trim().min(1).max(20_000),
});
export type LearnerMessage = z.infer<typeof LearnerMessage>;

/**
 * The answer to starting a new course: the id of its intake, which the page
 * uses until the intake ends. It lasts only as long as the server runs.
 */
export const IntakeStarted = z.object({ intakeId: z.string() });
export type IntakeStarted = z.infer<typeof IntakeStarted>;

/** The learner approves the proposal with this revision number. */
export const Approval = z.object({
  revision: z.number().int().positive(),
});
export type Approval = z.infer<typeof Approval>;
