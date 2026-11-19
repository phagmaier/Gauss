// What the server tells the page over the event stream, and what the page
// posts back.

import { z } from "zod";
import { ArtifactFile } from "./artifact.ts";
import { Slug, Timestamp } from "./course.ts";
import { Unit } from "./curriculum.ts";
import { ShownDispute } from "./dispute.ts";
import { AssessmentMode } from "./evidence.ts";
import { PackageSpec, PackagesOutcome } from "./packages.ts";
import { Plan } from "./plan.ts";
import {
  AnswerSubmission,
  ChoiceLetter,
  GradedAnswer,
  QuestionView,
  Unsettled,
  Verdict,
} from "./question.ts";
import { Phase } from "./state.ts";
import { ObjectiveStatus, UnitStatus } from "./status.ts";

/**
 * How long a unit is quiet before the next thing that happens starts a new
 * session, a new sitting (engine/transcript.ts). Review leaves alone an
 * objective answered within it (record/review.ts).
 */
export const SESSION_GAP_MS = 60 * 60 * 1000;

/** A segment by its index in the unit's plan, from 0, as in state.json. */
const SegmentIndex = z.number().int().nonnegative();

/**
 * One entry in a chat's event log. The log is replayed to every page that
 * connects, so a reload rebuilds the thread. A unit chat's log is also its
 * transcripts (task 2.13): it starts with the unit's earlier sessions, read
 * back from them, and each event of its own session is appended to its own.
 */
export const PageEvent = z.discriminatedUnion("type", [
  /**
   * A unit chat: a session, one sitting, began (task 2.13). Each transcript
   * starts with one. A session starts when the unit's chat opens, as after a
   * restart, and when something happens after the unit has been quiet for
   * SESSION_GAP_MS; what came before it belongs to an earlier sitting.
   */
  z.object({ type: z.literal("session"), startedAt: Timestamp }),
  /**
   * The tutor's conversation was replaced by a new one, which has the
   * learner's progress from the record and not the conversation before
   * (task 2.14). "learner": the learner chose to start fresh, in a unit.
   * "not-resumed": the earlier conversation could not be found to resume,
   * when a unit was reopened, or at a turn after its session was closed for
   * being idle (task 2.15); a turn's comes after the message it sends, and
   * an intake's new conversation has the latest proposal.
   */
  z.object({
    type: z.literal("fresh_start"),
    reason: z.enum(["learner", "not-resumed"]),
    /** The learner message delivered by this turn; absent for non-message turns and old transcripts. */
    learnerId: z.string().optional(),
  }),
  /** The learner's own message, echoed so a replay shows it. Old transcripts have no id. */
  z.object({
    type: z.literal("learner"),
    text: z.string(),
    id: z.string().optional(),
  }),
  /** The tutor has been sent a turn and is writing. */
  z.object({ type: z.literal("turn_start") }),
  /** A piece of the tutor's reply. */
  z.object({ type: z.literal("tutor_text"), text: z.string() }),
  /**
   * The tutor wrote a file with its file tools (task 3.3), once per file in
   * a reply: its path in the course's workspace, or absolute outside it.
   * Files its commands write are not seen.
   */
  z.object({ type: z.literal("file_written"), path: z.string() }),
  /**
   * The tutor showed an artifact (task 3.6), stored in the course's
   * artifacts/ folder: the thread keeps a reference that opens it in the
   * side pane.
   */
  z.object({
    type: z.literal("artifact"),
    file: ArtifactFile,
    title: z.string(),
    /** Restored from a transcript: the thread refers to it without opening it. */
    historical: z.literal(true).optional(),
  }),
  /**
   * The tutor asked to install packages in the course's workspace (task
   * 3.11): the card with the packages, the commands Install runs and where.
   * Sent again when the chat opens with the request still waiting.
   */
  z.object({
    type: z.literal("packages_requested"),
    requestId: z.string(),
    packages: z.array(PackageSpec),
    /** Each command, its words as they are passed. */
    commands: z.array(z.array(z.string())),
    /** The workspace, an absolute path, where the commands run. */
    folder: z.string(),
    /** A card replayed from a transcript does not grant approval by itself. */
    historical: z.literal(true).optional(),
  }),
  /** The learner pressed Install, and the commands run. */
  z.object({ type: z.literal("packages_installing"), requestId: z.string() }),
  /** The command ended but its result has not been written to state.json. */
  z.object({ type: z.literal("packages_save_failed"), requestId: z.string() }),
  /**
   * The request is answered: installed, failed, or "Not now". An install
   * keeps the end of its output.
   */
  z.object({
    type: z.literal("packages_answered"),
    requestId: z.string(),
    outcome: PackagesOutcome,
    output: z.string().optional(),
  }),
  /** The tutor posted a question. */
  z.object({ type: z.literal("question"), question: QuestionView }),
  /**
   * A written, math or code answer was sent and is being graded (tasks 2.8,
   * 3.5 and 3.7). Sent again when it is graded again after a failure, and
   * when a unit reopens with an answer a restart kept from its grade.
   */
  z.object({
    type: z.literal("grading"),
    questionId: z.string(),
    answer: GradedAnswer,
  }),
  /**
   * An answer was sent while replies of the tutor's to the learner's
   * messages during the question were still to be judged (task 2.21). It
   * is kept, and graded once they are; a written, math or code one is then
   * `grading`.
   */
  z.object({
    type: z.literal("answer_waiting"),
    questionId: z.string(),
    answer: AnswerSubmission,
  }),
  /**
   * The tutor's reply to a message the learner sent while question `number`
   * was open is being judged: clarification, or help (task 2.21). It
   * follows the reply.
   */
  z.object({
    type: z.literal("judging"),
    /** The learner's message, by its id. */
    learnerId: z.string(),
    number: z.number().int().positive(),
  }),
  /**
   * The judge's call on the reply to that message. Help makes the answer to
   * the question given with help. A reply that could not be judged counts
   * as help: the call failed, or the server stopped before it was made,
   * and then no `judging` came before it in this session.
   */
  z.object({
    type: z.literal("judged"),
    learnerId: z.string(),
    number: z.number().int().positive(),
    verdict: z.enum(["clarification", "help"]),
    unjudged: z.enum(["failed", "restart"]).optional(),
  }),
  /**
   * The grading of a written, math or code answer failed. The answer is
   * kept, the question stays open, and the learner can have it graded again.
   */
  z.object({
    type: z.literal("grading_failed"),
    questionId: z.string(),
    error: z.string(),
    /** No verdict was possible; the learner may also move on without the check. */
    canMoveOn: z.literal(true).optional(),
  }),

  /**
   * An answer was graded. The correct choice, the expected expression, or
   * the flaw, is revealed here.
   */
  z.object({
    type: z.literal("graded"),
    questionId: z.string(),
    verdict: Verdict,
    /** The learner's answer as sent. */
    answer: AnswerSubmission,
    /** For a choice question: the correct choice. */
    correctChoice: ChoiceLetter.optional(),
    /** For a math question: the expected answer (task 3.5). */
    expected: z.string().optional(),
    /** For a math answer the symbolic check did not settle: why, so the grader graded it. */
    unsettled: Unsettled.optional(),
    /** For an answer the grader graded incorrect: the first flawed step or missing element. */
    flaw: z.string().optional(),
    /** For a code answer: the end of the tests' output on the learner's files (task 3.7). */
    output: z.string().optional(),
    /** Given with help, so a correct answer does not count toward passing. */
    assisted: z.boolean(),
  }),
  /**
   * The learner disputed the grade of the answer to a question, and the
   * dispute judge decided (task 3.8): the answer now counts with the
   * outcome's verdict, and a corrected key shows in place of the first.
   * Sent too when the chat opens with a dispute its thread does not show,
   * raised from "What I know" while the chat was not open.
   */
  z.object({
    type: z.literal("disputed"),
    questionId: z.string(),
    dispute: ShownDispute,
  }),
  /**
   * A detour opened after a miss in the check (task 2.20), or the chat
   * opened in one: the tutor works through the confusion with the learner,
   * and no question is posted until the learner asks for another one, or
   * moves on. It follows the missed question's `graded`.
   */
  z.object({
    type: z.literal("detour"),
    /** The question missed. */
    questionId: z.string(),
    number: z.number().int().positive(),
  }),
  /**
   * The learner asked for another question, which ends the detour. A
   * detour also ends when the learner moves on, with the segment's
   * "closed" phase, and when an assessment ends or is skipped.
   */
  z.object({ type: z.literal("detour_end") }),
  /**
   * An assessment (docs/decisions.md, "Mastery loop"; piece 15): "offered",
   * its card, with Start and Skip; "on", the learner started it, and its
   * questions follow, each with an `assessment` head. Sent again when the
   * chat opens with one offered or under way. The unit's own steps wait
   * until it ends.
   */
  z.object({
    type: z.literal("assessment"),
    mode: AssessmentMode,
    stage: z.enum(["offered", "on"]),
    /** How many objectives it asks about: a question on each, and one more after a miss. */
    count: z.number().int().positive(),
  }),
  /**
   * The assessment ended, every objective asked, or the learner skipped it,
   * on its card or partway, which withdraws a question still open with
   * nothing recorded. The unit goes on where it was.
   */
  z.object({
    type: z.literal("assessment_end"),
    mode: AssessmentMode,
    skipped: z.boolean(),
    /** The objectives it recorded an answer on, with their statuses now. */
    statuses: z.record(Slug, ObjectiveStatus),
    withdrawnQuestionId: z.string().optional(),
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
    /** The style note; a draft stored before notes existed (task 2.10) has none. */
    style: z.string().optional(),
    /** The background note; a draft stored before task 2.22 has none. */
    background: z.string().optional(),
  }),
  /** The learner approved a revision of the curriculum. The intake is over. */
  z.object({
    type: z.literal("curriculum_approved"),
    courseId: Slug,
    revision: z.number().int().positive(),
  }),
  /** A unit chat: the unit has no plan yet and is being planned (task 2.5). */
  z.object({ type: z.literal("unit_planning") }),
  /**
   * The unit could not be opened: it could not be planned, or its record
   * could not be read. Opening it again tries again. Transcripts from task
   * 2.14 can have `resumeFailed` on it, which is read and dropped.
   */
  z.object({ type: z.literal("unit_failed"), error: z.string() }),
  /** The unit's plan, for the outline: its objectives and segments. */
  z.object({ type: z.literal("unit_plan"), plan: Plan }),
  /**
   * A phase of a segment began, or the chat opened in it. "teach" starts the
   * segment; "closed" ends it, until the learner starts the next.
   */
  z.object({
    type: z.literal("phase"),
    segment: SegmentIndex,
    phase: Phase,
    /** For a segment after the plan's last: the objectives it goes over again. */
    again: z.array(Slug).optional(),
  }),
  /**
   * How each objective of the unit and the unit stand, derived from the
   * evidence (task 2.3). Sent when the chat opens and after every change.
   */
  z.object({
    type: z.literal("unit_status"),
    unit: UnitStatus,
    objectives: z.record(Slug, ObjectiveStatus),
  }),
  /**
   * The unit's last segment has closed: the closing card (task 2.1, piece
   * 10). When every objective passed, "unit_closed" follows at once. When
   * some did not, the learner goes over them again, which starts a segment
   * after the plan's last, or moves on without them. At this point an
   * objective "attempted" reached the check's limit, and one "overridden"
   * was moved on from without its check.
   */
  z.object({
    type: z.literal("unit_end"),
    passed: z.boolean(),
    objectives: z.record(Slug, ObjectiveStatus),
  }),
  /** The unit is finished and no longer in progress. */
  z.object({
    type: z.literal("unit_closed"),
    status: z.enum(["passed", "overridden"]),
  }),
  /**
   * The learner moved on without the check, recorded as an override of the
   * segment's objectives. A question still open is withdrawn. The segment's
   * "closed" phase follows.
   */
  z.object({
    type: z.literal("overridden"),
    segment: SegmentIndex,
    objectives: z.array(Slug),
    withdrawnQuestionId: z.string().optional(),
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
export const Hello = z.object({
  chatId: z.string(),
  /** The index of the last event in the log when the stream connected, or -1. */
  last: z.number().int().min(-1),
});
export type Hello = z.infer<typeof Hello>;

/** A unit opened, with the last event it already had when the page asked. */
export const UnitOpened = Hello.extend({ ok: z.literal(true) });
export type UnitOpened = z.infer<typeof UnitOpened>;

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
