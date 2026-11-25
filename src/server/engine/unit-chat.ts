// The unit chat (tasks 2.6 and 2.7): one tutor
// session bound to one unit, which runs each segment's teach / discuss /
// check rhythm. Opening a unit not in progress plans it (task 2.5) and
// sends segment 1's teaching turn (unit-opening.ts). The engine enforces
// the phases:
//
// - teach to discuss: the teaching turn ends, or the learner stops it;
// - discuss to check: the learner presses "ready";
// - in the check, the tutor posts questions with ask_question, each on an
//   objective of the segment that still needs one (check-rules.ts); each
//   answer is graded, recorded with whether the learner had help, and sent
//   to the tutor in a turn for feedback only, where no tool may be called.
//   When it ends, the engine asks for the next question in a turn of its
//   own (task 2.16a). A miss opens a detour instead (task 2.20): its first
//   turn takes the feedback's place, the tutor works through the confusion
//   with the learner, and no question is posted until the learner asks for
//   another one. Grading an answer, and judging whether the tutor's replies
//   to messages while a question is open gave help, are unit-answers.ts's;
//   what a math or code question must pass when it is posted is
//   unit-questions.ts's;
// - check to closed: the engine closes the segment when the feedback on the
//   answer that leaves every objective done in this check ends (task
//   2.16a), or the learner moves on without the check, recorded as
//   evidence;
// - closed to the next segment's teach: the learner starts it.
//
// A tool called out of phase is refused with a reason the tutor can act on;
// so are the tutor's file writes and commands while a question is open
// (task 3.3), when it has them, and its aids (an HTML aid, a quote, a
// lecture, a search) while a question of the unit is open (unit-aids.ts).
// With install_packages the tutor asks for packages, which the learner
// installs or declines on a card (unit-packages.ts). In a course with a
// source, the tutor reads its sections with read_section and looks at a
// PDF's pages with view_page (task 4.8) in any phase, each shown in the
// thread (source-shelf.ts).
// A dispute of an answer's grade (task 3.8) is decided outside the chat
// (disputes.ts) and, when the chat is open, recorded inside its queue; what
// follows from its outcome is unit-opening.ts's.
// An assessment (task 5.4) runs in the
// unit's thread, asked by its tutor, kept in the position beside the phase,
// which it leaves alone: review, offered on a card when a unit not finished
// is opened in a new sitting with nothing waiting on the learner, at most
// once an hour in a course, on what `pickForReview` finds due in the
// course, only between segments: a sitting begun in a segment holds it
// until the segment closes (task 5.25); review the learner asks for with
// "Review now", started at once in the unit in progress opened last, or
// in a finished unit, which stays finished; the unit's gate (unit-end.ts);
// or the test before a unit. Its rules are assessment-rules.ts's; a run
// from its start to its end, and the test's result card, are
// unit-assessments.ts's. A message sent while a review's card waits skips
// it, and one sent while the gate's waits leaves it waiting. An answer on
// another unit's objective is told to that unit's chat if it is open.
// The engine composes every turn's header (unit-header.ts, in unit-turns.ts's
// words) and writes the unit's position to state.json after every change,
// before the page is told, so a restart reopens the unit where it was
// (unit-opening.ts). The chat's events are its transcripts too
// (transcript.ts, task 2.13), so a reopened unit shows the thread of its
// earlier sessions. The tutor's conversation survives a restart too (task
// 2.14): its session's id is kept in the unit's position, and a reopened
// unit resumes it with its first turn. The tutor's session is closed while
// idle and resumed with the next turn (task 2.15). If it cannot be found,
// as `load` asks the backend, or as a turn finds, the unit starts fresh: a
// new session, seeded from the record and told that it joins a unit under
// way (unit-header.ts), and the thread says so. The learner can start fresh
// too.
// Resuming that fails another way fails the turn, since the fault may pass;
// the next turn tries again, and the learner can start fresh instead.
//
// This file holds the phase rules and coordinates two parts (task 2.8b):
// unit-record.ts keeps the unit's position and evidence and writes every
// change before the page hears of it, and unit-agents.ts runs the tutor and
// the grader. Every change to the unit goes through this chat's one queue
// (`exclusive`), which the agents are given for recording a grade.

import { randomUUID } from "node:crypto";
import type { Course, Slug } from "../../shared/course.ts";
import type { StoredUnit } from "../../shared/curriculum.ts";
import type { PageEvent } from "../../shared/events.ts";
import type {
  AnswerEvidence,
  DisputeEvidence,
  EvidenceEntry,
  OverrideEvidence,
} from "../../shared/evidence.ts";
import type { Misconception } from "../../shared/misconception.ts";
import type { PackageReceipt } from "../../shared/packages.ts";
import type { AnswerPost } from "../../shared/question.ts";
import {
  type AppSettings,
  type TutorModelPost,
  tutorModel,
} from "../../shared/settings.ts";
import type { Outline } from "../../shared/source.ts";
import type { OpenQuestion, State, UnitPosition } from "../../shared/state.ts";
import type { SessionBackends, WorkspaceTools } from "../backends/backend.ts";
import type { Backup } from "../record/backup.ts";
import type { DataRoot } from "../record/data-root.ts";
import { pickForReview, type ReviewPick } from "../record/review.ts";
import { unitStatus } from "../record/status.ts";
import { amendCurriculumTool } from "../tools/amend-curriculum.ts";
import { askQuestionTool } from "../tools/ask-question.ts";
import { installPackagesTool } from "../tools/install-packages.ts";
import { proposeStyleTool } from "../tools/propose-style.ts";
import { showArtifactTool } from "../tools/show-artifact.ts";
import {
  presentLectureTool,
  quoteSourceTool,
  readSectionTool,
  searchSourceTool,
  viewPageTool,
} from "../tools/sources.ts";
import {
  isLastSegment,
  nextSegment,
  type ObjectiveCheck,
  objectiveCheck,
  segmentOf,
} from "./check-rules.ts";
import { type ChoiceOrder, randomOrder } from "./choice-order.ts";
import { type CodeRunner, noCodeRunner } from "./code-run.ts";
import type { ChatResult, Timer } from "./conversation.ts";
import type { CourseHolder, Doing } from "./course-deletion.ts";
import type { Grader } from "./grading.ts";
import {
  createHandoffs,
  type Handoffs,
  type HandoffWriter,
  readEarlier,
} from "./handoff.ts";
import type { HelpJudge } from "./help-judge.ts";
import { type MathCheck, noMathCheck } from "./math-check.ts";
import {
  clearPackageInstall,
  type PackageInstaller,
  recoverPackageInstall,
} from "./packages.ts";
import {
  createReviewAdmission,
  type ReviewAdmission,
} from "./review-admission.ts";
import type { SourceConverter } from "./source-convert.ts";
import { createSourceShelf } from "./source-shelf.ts";
import {
  fixedTeaching,
  gaussTeaching,
  splitTutorPrompt,
  type TutorPrompt,
  tutorInstructions,
} from "./teaching.ts";
import { createTranscribedLog } from "./transcript.ts";
import { createUnitAgents, type UnitAgents } from "./unit-agents.ts";
import { createUnitAids } from "./unit-aids.ts";
import { createUnitAnswers, type UnitAnswers } from "./unit-answers.ts";
import {
  createUnitAssessments,
  readAssessmentHandoffs,
  type UnitAssessments,
} from "./unit-assessments.ts";
import { createUnitEnd, type UnitEnd } from "./unit-end.ts";
import { createUnitHeader, type UnitHeader } from "./unit-header.ts";
import { createUnitOpening, type UnitOpening } from "./unit-opening.ts";
import { createUnitPackages } from "./unit-packages.ts";
import { courseBackend, type UnitPlanner } from "./unit-planning.ts";
import {
  createUnitProgression,
  type UnitProgression,
} from "./unit-progression.ts";
import { createUnitProposals } from "./unit-proposals.ts";
import { createUnitQuestions, QUESTION_STOPPED } from "./unit-questions.ts";
import { openUnitRecord, type UnitRecord } from "./unit-record.ts";
import {
  freshTurn,
  readyTurn,
  teachTurn,
  tutorSystemPrompt,
  type UnitContext,
} from "./unit-turns.ts";

export interface UnitChat {
  /** Changes when the server restarts, so a page can tell. */
  readonly id: string;
  events(): readonly PageEvent[];
  /** Calls the listener with every new event and its index in the log. */
  subscribe(listener: (event: PageEvent, index: number) => void): () => void;
  /** A message from the learner, in any phase. */
  say(text: string): ChatResult;
  /** The learner is ready for the check. */
  ready(): Promise<ChatResult>;
  /**
   * In a detour after a miss: the learner is ready for another question,
   * which ends the detour and asks the tutor for one.
   */
  anotherQuestion(): Promise<ChatResult>;
  /**
   * The learner's answer to the open question. A written, math or code one
   * is graded after this returns; the page hears the grade, or that grading
   * failed. A code answer's files are read from the workspace now.
   */
  answer(submission: AnswerPost): Promise<ChatResult>;
  /** Grades again the written, math or code answer whose grading failed. */
  gradeAgain(): Promise<ChatResult>;
  /**
   * Installs the packages of the tutor's request that waits. The page hears
   * that they are installing, then the outcome.
   */
  installPackages(requestId: string): Promise<ChatResult>;
  /** "Not now" to the tutor's request that waits. */
  declinePackages(requestId: string): Promise<ChatResult>;
  /** Saves an install's original result without running its command again. */
  retryPackageSave(requestId: string): Promise<ChatResult>;
  /**
   * Apply on the card of the tutor's proposed style note: style.md is
   * replaced, and the tutor is told in its next header.
   */
  applyStyle(proposalId: string): Promise<ChatResult>;
  /** "Keep the current one" on the card of the tutor's proposed style note. */
  keepStyle(proposalId: string): Promise<ChatResult>;
  /**
   * Apply on the card of the tutor's proposed curriculum change:
   * curriculum.json is replaced, each kept unit keeping its plan, and the
   * tutor is told in its next header.
   */
  applyCurriculum(proposalId: string): Promise<ChatResult>;
  /** "Keep the current one" on the card of the tutor's proposed curriculum change. */
  keepCurriculum(proposalId: string): Promise<ChatResult>;
  /** The learner moves on without the check, which is recorded. */
  override(): Promise<ChatResult>;
  /** Start on the card of the assessment offered: the tutor is asked for its first question. */
  startAssessment(): Promise<ChatResult>;
  /**
   * Skips the assessment, on its card or partway: a question open is
   * withdrawn with nothing recorded, and the unit goes on where it was.
   */
  skipAssessment(): Promise<ChatResult>;
  /** The learner starts the next segment, once this one is closed. */
  nextSegment(): Promise<ChatResult>;
  /**
   * At the test's result card: skips what it passed, so teaching starts at
   * the first segment with an objective not passed; with every objective
   * passed, finishes the unit.
   */
  skipTested(shown: readonly string[]): Promise<ChatResult>;
  /** At the test's result card: the whole unit is taught, from its first segment. */
  teachWhole(): Promise<ChatResult>;
  /**
   * At the unit's end, with objectives not passed: one more segment, after
   * the plan's last, on them.
   */
  goOverAgain(): Promise<ChatResult>;
  /**
   * Takes the closing card's confirmed move-on, recording its objectives
   * as overridden and offering its gate or finishing the unit.
   */
  finishUnit(finishId: string): Promise<ChatResult>;
  /**
   * Replaces the tutor's conversation with a new one, which has the
   * learner's progress from the record and not the conversation, and which
   * picks up where the unit stands.
   */
  startFresh(): Promise<ChatResult>;
  /** Stops the tutor's turn in progress, if there is one. */
  interrupt(): Promise<void>;
  /**
   * Records the dispute of one of the unit's answers, once the unit is open,
   * and tells the page and, in a unit in progress, the tutor's next header.
   * Resolves to the override recorded with it, if any; false if the unit
   * could not be opened, so nothing was recorded. Throws DisputeRefused if
   * the record refuses it.
   */
  recordDispute(
    entry: DisputeEvidence,
  ): Promise<false | { override: OverrideEvidence | undefined }>;
  /**
   * Takes in a dispute recorded without the chat, with the override recorded
   * with it, if the unit's record read when it opened did not have it: of an
   * answer on one of the unit's objectives, or one given in its assessment
   * on another unit's.
   */
  learnDispute(
    entry: DisputeEvidence,
    override?: OverrideEvidence,
  ): Promise<void>;
  /** Lets the notes writer read the latest transcript and handoff without entering the chat queue. */
  settleNotesContext(): Promise<void>;
  /** Waits for transcript writes, not for the tutor's turn or handoff. */
  flushTranscript(): Promise<void>;
  /** Resolves once the chat has opened and every turn sent so far has finished. */
  settled(): Promise<void>;
  /**
   * What of the chat is shown or runs now, if anything: its page reading
   * the event stream, its loading, the tutor, a grading, a judging, a
   * handoff note, or an install.
   */
  inUse(): Doing | undefined;
  close(): Promise<void>;
}

export type OpenResult =
  | { ok: true; chat: UnitChat }
  | { ok: false; status: 404 | 409; error: string };

export type ReviewResult =
  | { ok: true; unitId: Slug }
  | { ok: false; status: 404 | 409; error: string };

/**
 * The unit chats opened since the server started, one per unit. A chat
 * stays until the server stops, or its course is deleted; its tutor's
 * session is closed while idle (task 2.15).
 */
export interface UnitChats extends CourseHolder {
  /**
   * Opens the unit, marking it and its course opened: its chat if it is
   * open, or a new one, which starts the unit or picks it up where
   * state.json has it. Opening a unit whose planning failed tries again.
   * `testOut` starts a unit not started with its test (task 5.6), and is
   * refused for one started or finished.
   */
  open(
    courseId: string,
    unitId: string,
    options?: { testOut?: boolean },
  ): Promise<OpenResult>;
  get(courseId: string, unitId: string): UnitChat | undefined;
  /**
   * "Review now" on the course view (task 5.25): opens the unit whose
   * thread holds the review (`reviewThread`) and starts a review there of
   * what is due, as `UnitChat.reviewNow` does. Refused with nothing due, or
   * with the unit's reason.
   */
  reviewNow(courseId: string): Promise<ReviewResult>;
  /** The course's side of its planning conversation (task 5.38). */
  courseDesk(courseId: Slug): CourseDesk;
  /**
   * Sets whether the course's tutors may search the web (task 4.11), and
   * closes the tutor session of each of its open chats once it is between
   * turns, so that the setting applies from the next turn. Answers the
   * course as written; throws for a course not approved.
   */
  setWebSearch(courseId: Slug, on: boolean): Promise<Course>;
  /**
   * Sets the tutor's model for one backend's courses, and closes the tutor
   * session of each open chat of those courses once it is between turns,
   * so that the model applies from the next turn. Answers the settings as
   * written.
   */
  setTutorModel(choice: TutorModelPost): Promise<AppSettings>;
  /**
   * Saves the learner's teaching instructions in place of Gauss's
   * paragraph, or removes them when the text is Gauss's, if teaching.md
   * still holds `was` (TeachingChanged otherwise), and closes every open
   * chat's tutor session once it is between turns, so that they apply from
   * the next turn. Answers the learner's text as kept, undefined for none.
   */
  setTeaching(
    text: string,
    was: string | undefined,
  ): Promise<string | undefined>;
  /** Gauss's paragraph of the tutor prompt and the fixed one after it, as the Settings page shows them. */
  teachingDefaults(): { gauss: string; fixed: string };
  /** Closes the tutor session of every chat. */
  close(): Promise<void>;
}

export type Proposed = { proposed: true } | { refused: string };

/**
 * Where the course's planning conversation (engine/course-planning.ts)
 * proposes. Its proposal goes through the course's queue as a unit tutor's
 * does, so that one proposal, of a style note or a curriculum change, waits
 * in a course. The proposal waits in memory, not state.json: the planning
 * conversation dies on restart, and a stored proposal would block tutors
 * with no card.
 */
export interface CourseDesk {
  /**
   * Runs `work`, which makes the planning conversation's proposal, with the
   * state as read, unless a proposal waits in a unit of the course. Once
   * `work` returns `{ proposed: true }`, the unit tutors' proposals are
   * refused until `answered`.
   */
  propose(work: (state: State) => Promise<Proposed>): Promise<Proposed>;
  /** Lifts the block and tells refused tutors; Apply also refreshes the open chats. */
  answered(
    decision:
      | { outcome: "applied"; units: readonly StoredUnit[] }
      | { outcome: "kept" },
  ): void;
}

interface ChatOptions {
  /** The tutor of a course runs on the course's backend; a course whose backend is absent does not open. */
  backends: SessionBackends;
  /** Checks whether Codex can run now; undefined means the unit can open. */
  codexUnavailable?: () => Promise<string | undefined>;
  /**
   * `prompts/tutor.md`, its learner's paragraph between its marks
   * (`engine/teaching.ts`); a prompt with no marks has nothing to edit.
   */
  systemPrompt: string;
  dataRoot: DataRoot;
  planner: UnitPlanner;
  /** Grades written answers, and math answers the symbolic check does not settle. */
  grader: Grader;
  /**
   * Reads math questions' expected expressions and compares answers with
   * them (task 3.5). Without it, math questions are refused, and an answer
   * to one already open goes to the grader.
   */
  mathCheck?: MathCheck;
  /**
   * Runs code questions' tests (task 3.7). Without it, code questions are
   * refused, and an answer to one already open fails its grading.
   */
  codeRunner?: CodeRunner;
  /** Judges the tutor's replies to messages sent while a question is open. */
  judge: HelpJudge;
  /**
   * Writes the unit's handoff note and finds misconceptions when a segment
   * closes or the unit finishes (task 5.7). None if not given.
   */
  handoff?: HandoffWriter;
  /**
   * The clock for the dates in the evidence and the open question, and for
   * when a session starts.
   */
  now?: () => Date;
  /** Closes idle tutor sessions; the system's timer if not given. */
  timer?: Timer;
  /**
   * The order a choice question's choices are shown in (task 2.17); random
   * if not given.
   */
  order?: ChoiceOrder;
  /** Commits the record once a segment closes or a unit ends (task 2.25); none if not given. */
  backup?: Backup;
  /**
   * Gives tutors the file and shell tools in the course's workspace (task
   * 3.3), their commands reading as `reads` says and run, where the backend
   * has no confined commands of its own, by `run`: the sandbox's. Only when
   * the sandbox can run. None if not given.
   */
  workspaceTools?: Pick<WorkspaceTools, "reads" | "run">;
  /**
   * Installs the packages a tutor asks for (task 3.11); only when the
   * sandbox can run. Without it, tutors get no install_packages.
   */
  installer?: PackageInstaller;
  /**
   * Renders the PDF pages view_page asks for (task 4.8), once each. Without
   * it, or without a sandbox to render in, a page not rendered before is
   * refused with the reason.
   */
  converter?: SourceConverter;
}

export function createUnitChats(options: ChatOptions): UnitChats {
  const { dataRoot } = options;
  const tutorPrompt = splitTutorPrompt(options.systemPrompt);
  const testStarted = {
    ok: false,
    status: 409,
    error: "This unit has started, so it can no longer be tested out of.",
  } as const;
  const chats = new Map<string, OpenableChat>();
  const key = (courseId: string, unitId: string) =>
    JSON.stringify([courseId, unitId]);
  const courses = new Map<string, CourseWorkspace>();
  const reviewRequests = new Map<string, Promise<ReviewResult>>();

  function workspace(courseId: Slug) {
    let guard = courses.get(courseId);
    if (guard === undefined) {
      guard = courseWorkspace(dataRoot, courseId);
      courses.set(courseId, guard);
    }
    return guard;
  }

  /** The open chats of the course's units, but this one. */
  function othersIn(courseId: string, unitId: string | undefined) {
    return [...chats]
      .filter(([at]) => {
        const [course, unit] = JSON.parse(at) as [string, string];
        return course === courseId && unit !== unitId;
      })
      .map(([, chat]) => chat);
  }

  /** Tells the open chats of the course's units, but this one, a curriculum the learner applied. */
  function recurriculum(
    courseId: string,
    unitId: string | undefined,
    units?: readonly StoredUnit[],
    blocked?: ReadonlySet<OpenableChat>,
  ) {
    for (const other of othersIn(courseId, unitId)) {
      void other
        .learnCurriculum(
          units,
          blocked?.has(other) ? "planner-applied" : "changed",
        )
        .catch((error: unknown) => {
          console.error("The chat could not refresh its curriculum:", error);
        });
    }
  }

  /** Opens under way, until their chat is kept and opened. */
  const openings = new Set<{ courseId: string; unitId: string }>();

  async function openChat(
    courseId: string,
    unitId: string,
    opening: { testOut?: boolean },
  ): Promise<OpenResult> {
    const stored = await dataRoot.readCourse(courseId);
    const curriculum = stored?.curriculum ?? undefined;
    const unit = curriculum?.units.find((u) => u.id === unitId);
    if (curriculum === undefined || unit === undefined) {
      return {
        ok: false,
        status: 404,
        error: `There is no unit "${unitId}" in the course "${courseId}".`,
      };
    }
    if (curriculum.approval.status !== "approved") {
      return {
        ok: false,
        status: 409,
        error: "The curriculum is not approved yet, so its units cannot start.",
      };
    }
    if (opening.testOut === true) {
      const [state, evidence] = await Promise.all([
        dataRoot.readState(courseId),
        dataRoot.readEvidence(courseId),
      ]);
      if (
        Object.hasOwn(state.units, unitId) ||
        unitStatus(unit, evidence, undefined) !== "not-started"
      ) {
        return testStarted;
      }
    }
    if (
      stored?.course.backend === "codex" &&
      options.backends.codex !== undefined
    ) {
      const reason = await options.codexUnavailable?.();
      if (reason !== undefined) {
        return {
          ok: false,
          status: 409,
          error: `This course runs on Codex. ${reason} After signing in, open the unit again.`,
        };
      }
    }
    await dataRoot.markOpened(courseId, unitId);
    // Looked up after the awaits and kept at once, so two opens of one
    // unit share one chat.
    let chat = chats.get(key(courseId, unitId));
    if (chat === undefined) {
      chat = createUnitChat({
        ...options,
        courseId,
        unitId,
        workspace: workspace(courseId),
        tutorPrompt,
        tell: (unit, entry) => {
          void chats.get(key(courseId, unit))?.learnAnswer(entry);
        },
        restyle: (note) => {
          for (const other of othersIn(courseId, unitId)) {
            void other.learnStyle(note);
          }
        },
        recurriculum: () => recurriculum(courseId, unitId),
      });
      chats.set(key(courseId, unitId), chat);
    }
    if (!chat.open(opening.testOut === true)) return testStarted;
    return { ok: true, chat };
  }

  /** Opens the unit, counted as opening until its chat is kept and opened. */
  async function open(
    courseId: string,
    unitId: string,
    opening: { testOut?: boolean } = {},
  ): Promise<OpenResult> {
    const under = { courseId, unitId };
    openings.add(under);
    try {
      return await openChat(courseId, unitId, opening);
    } finally {
      openings.delete(under);
    }
  }

  async function reviewCourse(courseId: string): Promise<ReviewResult> {
    const stored = await dataRoot.readCourse(courseId);
    const curriculum = stored?.curriculum ?? undefined;
    if (curriculum === undefined) {
      return {
        ok: false,
        status: 404,
        error: `There is no course "${courseId}" with a curriculum.`,
      };
    }
    if (curriculum.approval.status !== "approved") {
      return {
        ok: false,
        status: 409,
        error: "The curriculum is not approved yet, so nothing is reviewed.",
      };
    }
    const [state, evidence] = await Promise.all([
      dataRoot.readState(courseId),
      dataRoot.readEvidence(courseId),
    ]);
    const thread = reviewThread(
      curriculum.units,
      stored?.course.unitsOpenedAt ?? {},
      state,
      evidence,
      (options.now ?? (() => new Date()))(),
    );
    if (typeof thread === "string") {
      return { ok: false, status: 409, error: thread };
    }
    const { unit, number, objectives } = thread;
    const opened = await open(courseId, unit.id);
    if (!opened.ok) return opened;
    const chat = chats.get(key(courseId, unit.id));
    if (chat === undefined) throw new Error("The unit's chat was not kept.");
    const started = await chat.reviewNow(objectives);
    return started.ok
      ? { ok: true, unitId: unit.id }
      : {
          ok: false,
          status: 409,
          error: `In unit ${number}, ${unit.title}: ${started.error}`,
        };
  }

  return {
    open,
    get: (courseId, unitId) => chats.get(key(courseId, unitId)),
    reviewNow(courseId) {
      // A second request during opening or the first save joins that start.
      const pending = reviewRequests.get(courseId);
      if (pending !== undefined) return pending;
      const request = reviewCourse(courseId).finally(() => {
        reviewRequests.delete(courseId);
      });
      reviewRequests.set(courseId, request);
      return request;
    },
    courseDesk(courseId) {
      const desk = workspace(courseId).desk;
      return {
        propose: desk.propose,
        answered(decision) {
          const blocked = desk.answered();
          if (decision.outcome === "applied") {
            recurriculum(courseId, undefined, decision.units, blocked);
          } else if (blocked !== undefined) {
            for (const chat of blocked) chat.learnPlannerKept();
          }
        },
      };
    },
    async setWebSearch(courseId, on) {
      const course = await dataRoot.setWebSearch(courseId, on);
      // A session starting now reads the setting written; one open renews.
      for (const chat of othersIn(courseId, undefined)) chat.renew();
      return course;
    },
    async setTutorModel(choice) {
      const settings = await dataRoot.setTutorModel(choice);
      const open = new Set(
        [...chats.keys()].map((at) => (JSON.parse(at) as [string])[0]),
      );
      for (const courseId of open) {
        const stored = await dataRoot.readCourse(courseId);
        if (stored?.course.backend !== choice.backend) continue;
        for (const chat of othersIn(courseId, undefined)) chat.renew();
      }
      return settings;
    },
    async setTeaching(text, was) {
      if (tutorPrompt.shipped === undefined) {
        throw new Error("This tutor prompt has nothing the learner can edit.");
      }
      const trimmed = text.trim();
      const kept = trimmed === gaussTeaching(tutorPrompt) ? undefined : trimmed;
      await dataRoot.writeTeaching(kept, was);
      for (const chat of chats.values()) chat.renew();
      return kept;
    },
    teachingDefaults() {
      return {
        gauss: gaussTeaching(tutorPrompt),
        fixed: fixedTeaching(tutorPrompt),
      };
    },
    async close() {
      await Promise.allSettled([...chats.values()].map((c) => c.close()));
    },
    inUse(courseId) {
      for (const under of openings) {
        if (under.courseId === courseId) {
          return { doing: "opening", unit: under.unitId };
        }
      }
      for (const [at, chat] of chats) {
        const [course, unit] = JSON.parse(at) as [string, string];
        const doing = course === courseId ? chat.inUse() : undefined;
        if (doing !== undefined) return { doing, unit };
      }
      return undefined;
    },
    async forget(courseId) {
      const gone = othersIn(courseId, undefined);
      for (const at of [...chats.keys()]) {
        if ((JSON.parse(at) as [string, string])[0] === courseId) {
          chats.delete(at);
        }
      }
      courses.delete(courseId);
      await Promise.allSettled(gone.map((chat) => chat.close()));
    },
  };
}

/**
 * The thread and objective pick from one course snapshot. Continue an
 * existing review first; otherwise use the unit in progress opened last
 * or the finished unit that holds the first due objective.
 */
function reviewThread(
  units: readonly StoredUnit[],
  openedAt: Readonly<Record<string, string>>,
  state: State,
  evidence: readonly EvidenceEntry[],
  at: Date,
): { unit: StoredUnit; number: number; objectives?: ReviewPick[] } | string {
  const numbered = units.map((unit, i) => ({ unit, number: i + 1 }));
  const active = numbered.find(({ unit }) => {
    const kept = state.finishedReviews?.[unit.id]?.assessment;
    const running = state.units[unit.id]?.assessment;
    return (
      kept?.mode === "review" ||
      (running?.mode === "review" && running.stage === "on")
    );
  });
  if (active !== undefined) return active;
  const objectives = pickForReview(units, evidence, {
    at,
    count: REVIEW_COUNT,
    leaveOut: [],
  });
  if (objectives.length === 0) return NOTHING_DUE;
  const time = (id: string) =>
    Object.hasOwn(openedAt, id) ? Date.parse(openedAt[id] ?? "") : -Infinity;
  const [inProgress] = numbered
    .filter(({ unit }) => Object.hasOwn(state.units, unit.id))
    .sort((a, b) => time(b.unit.id) - time(a.unit.id) || a.number - b.number);
  if (inProgress !== undefined) return { ...inProgress, objectives };
  for (const { unit: id } of objectives) {
    const found = numbered.find(({ unit }) => unit.id === id);
    const status =
      found === undefined
        ? undefined
        : unitStatus(found.unit, evidence, undefined);
    if (
      found !== undefined &&
      (status === "passed" || status === "overridden")
    ) {
      return { ...found, objectives };
    }
  }
  return "No unit can hold a review now.";
}

type WorkspaceDesk = Pick<CourseDesk, "propose"> & {
  answered(): ReadonlySet<OpenableChat> | undefined;
};

interface CourseWorkspace {
  tools: Pick<WorkspaceTools, "acquire">;
  /** Restores the workspace before the course's first chat uses it. */
  prepare(folder: string): Promise<PackageReceipt | undefined>;
  /** Saves a live or previously unsaved install result. */
  saveInstall(
    folder: string,
    receipt: PackageReceipt,
    save: (completion: PackageReceipt["completion"]) => Promise<boolean>,
  ): Promise<PackageReceipt["completion"]>;
  post<T>(
    attempt: { unitId: Slug; stopped(): boolean; retry(): void },
    work: () => Promise<T>,
  ): Promise<T | { refused: string }>;
  /**
   * Runs `work`, which makes a package request, unless a question is open
   * or a request waits in a unit of the course.
   */
  request<T>(work: () => Promise<T>): Promise<T | { refused: string }>;
  /**
   * Runs `work`, which makes a style or curriculum proposal, with the state
   * as read, unless a proposal of either kind waits in a unit of the course
   * or in its planning conversation.
   */
  propose<T>(
    chat: OpenableChat,
    work: (state: State) => Promise<T>,
  ): Promise<T | { refused: string }>;
  /** The course planning conversation's side of the proposals (task 5.38). */
  desk: WorkspaceDesk;
  /**
   * Closes the workspace to the tutors' changes and to questions while an
   * install runs, unless a question is open or a change is under way; the
   * caller calls `done` once it ends.
   */
  beginInstall(owner: Slug): Promise<{ done(): void } | { refused: string }>;
}

/** The question open in a unit of the course, a finished unit's review included, if there is one. */
function openInCourse(state: State): OpenQuestion | undefined {
  const positions = [
    ...Object.values(state.units),
    ...Object.values(state.finishedReviews ?? {}),
  ];
  return positions.find((p) => p.openQuestion !== undefined)?.openQuestion;
}

/**
 * A style or curriculum proposal waiting in a unit of the course, if there
 * is one: a style note before a curriculum change, as either blocks.
 */
function waitingProposal(
  state: State,
): { what: string; unit: string } | undefined {
  const units = Object.entries(state.units);
  const style = units.find(([, p]) => p.styleProposal !== undefined);
  if (style !== undefined) {
    return { what: "A proposed style note", unit: style[0] };
  }
  const change = units.find(([, p]) => p.curriculumChange !== undefined);
  return change === undefined
    ? undefined
    : { what: "A proposed curriculum change", unit: change[0] };
}

/** Why a unit's tutor cannot propose while the course's planning conversation's proposal waits. */
const PLANNED =
  "A curriculum change proposed from the course view waits for the " +
  "learner's answer there. While it waits, do not propose a style note or " +
  "curriculum change. Look for the learner's decision in a later turn header.";

const INSTALLING =
  "Packages are being installed in the workspace: no file may be written " +
  "and no command run until that ends. You may still read files.";

const PACKAGE_SAVE_FAILED =
  "The install finished, but its result could not be saved. Use Retry saving to save it without installing again.";
const PACKAGE_RECOVERY_BLOCKED =
  "The workspace could not be restored after installing packages.";

/**
 * The course's mutation reservations, question commits, package requests
 * and installs share one queue. Never enter a chat's queue from here:
 * teaching tools already hold it.
 */
function courseWorkspace(dataRoot: DataRoot, courseId: Slug): CourseWorkspace {
  const exclusive = createSerial();
  let active = 0;
  let installing: { owner: Slug; retries: Map<Slug, () => void> } | undefined;
  let prepared = false;
  let recoveryBlocked = false;
  let pending: PackageReceipt | undefined;
  let cleanupNeeded: string | undefined;
  /** Present while the planner's proposal waits, with the chats it has blocked. */
  let planned: Set<OpenableChat> | undefined;

  async function clearSavedInstall(folder: string) {
    try {
      await clearPackageInstall(folder);
      cleanupNeeded = undefined;
    } catch (error) {
      cleanupNeeded = folder;
      console.error("A saved install's journal could not be cleared:", error);
    }
  }

  /**
   * Reconcile before any chat reads this course's state into memory. A
   * finished unit keeps a withdrawal as the receipt's anchor until saved.
   */
  async function settleReceipt(folder: string, receipt: PackageReceipt) {
    const { unitId, completion } = receipt;
    const state = await dataRoot.readState(courseId);
    const position = Object.hasOwn(state.units, unitId)
      ? state.units[unitId]
      : undefined;
    const completions = state.packageCompletions ?? {};
    const recorded = Object.hasOwn(completions, unitId)
      ? completions[unitId]?.[completion.request.id]
      : undefined;
    let next: UnitPosition | null;
    if (position?.packageRequest?.id === completion.request.id) {
      const { packageRequest: _, ...rest } = position;
      next = rest;
    } else if (position === undefined && recorded?.outcome === "withdrawn") {
      next = null;
    } else {
      if (
        recorded?.outcome !== completion.outcome ||
        recorded.output !== completion.output
      ) {
        throw new Error("The saved install does not match a package request.");
      }
      await clearSavedInstall(folder);
      return;
    }
    try {
      await dataRoot.writePosition(courseId, unitId, next, { completion });
    } catch (error) {
      console.error("An install could not be recorded:", error);
      pending = receipt;
      return;
    }
    await clearSavedInstall(folder);
  }

  const tools: CourseWorkspace["tools"] = {
    acquire: () =>
      exclusive(async () => {
        if (installing !== undefined) return { refused: INSTALLING };
        if (recoveryBlocked) return { refused: PACKAGE_RECOVERY_BLOCKED };
        const open = openInCourse(await dataRoot.readState(courseId));
        if (open !== undefined) {
          return {
            refused:
              `Question ${open.number} is open: no file may be written and no ` +
              "command run until its answer is graded, since a change could help " +
              "with the answer. You may still read files.",
          };
        }
        active += 1;
        let released = false;
        return {
          release() {
            if (released) return;
            released = true;
            active -= 1;
          },
        };
      }),
  };
  return {
    tools,
    prepare(folder) {
      return exclusive(async () => {
        if (recoveryBlocked) throw new Error(PACKAGE_RECOVERY_BLOCKED);
        if (!prepared) {
          const receipt = await recoverPackageInstall(folder);
          if (receipt !== undefined) await settleReceipt(folder, receipt);
          prepared = true;
        }
        return pending;
      });
    },
    saveInstall(folder, receipt, save) {
      return exclusive(async () => {
        pending = receipt;
        recoveryBlocked = true;
        const kept = await recoverPackageInstall(folder);
        if (
          kept !== undefined &&
          (kept.unitId !== receipt.unitId ||
            kept.completion.request.id !== receipt.completion.request.id)
        ) {
          throw new Error("The install journal has another request's result.");
        }
        recoveryBlocked = false;
        const completion = kept?.completion ?? receipt.completion;
        if (!(await save(completion))) {
          throw new Error("The install does not match a package request.");
        }
        if (kept !== undefined) await clearSavedInstall(folder);
        pending = undefined;
        return completion;
      });
    },
    post(attempt, work) {
      return exclusive(async () => {
        if (attempt.stopped()) return QUESTION_STOPPED;
        if (installing !== undefined) {
          if (attempt.unitId !== installing.owner) {
            installing.retries.set(attempt.unitId, attempt.retry);
          }
          return {
            refused:
              "Packages are being installed in the workspace. End your turn; " +
              "you are told when the install ends, and can post the question then.",
          };
        }
        if (recoveryBlocked) return { refused: PACKAGE_RECOVERY_BLOCKED };
        if (active > 0) {
          return {
            refused:
              "A file write or command has not been confirmed finished in this course. " +
              "Wait for completion before posting a question. If its session closed " +
              "without a completion report, restart the server.",
          };
        }
        return work();
      });
    },
    request<T>(work: () => Promise<T>): Promise<T | { refused: string }> {
      return exclusive(async () => {
        if (installing !== undefined) {
          return { refused: "Packages are being installed in this course." };
        }
        if (recoveryBlocked) return { refused: PACKAGE_RECOVERY_BLOCKED };
        if (pending !== undefined) {
          return {
            refused:
              "The previous package install's result still needs to be saved.",
          };
        }
        const state = await dataRoot.readState(courseId);
        const open = openInCourse(state);
        if (open !== undefined) {
          return {
            refused:
              `Question ${open.number} is open: packages can be asked for ` +
              "once its answer is graded.",
          };
        }
        const waiting = Object.values(state.units).some(
          (p) => p.packageRequest !== undefined,
        );
        if (waiting) {
          return {
            refused:
              "A request to install packages already waits for the learner's " +
              "answer. Wait for it: you are told when they answer.",
          };
        }
        return work();
      });
    },
    propose<T>(
      chat: OpenableChat,
      work: (state: State) => Promise<T>,
    ): Promise<T | { refused: string }> {
      return exclusive(async () => {
        if (planned !== undefined) {
          planned.add(chat);
          return { refused: PLANNED };
        }
        const state = await dataRoot.readState(courseId);
        const waiting = waitingProposal(state);
        if (waiting !== undefined) {
          return {
            refused:
              `${waiting.what} already waits for the learner's answer. ` +
              "Wait for it: a header says how they answered.",
          };
        }
        return work(state);
      });
    },
    desk: {
      propose: (work) =>
        exclusive(async () => {
          const state = await dataRoot.readState(courseId);
          const waiting = waitingProposal(state);
          if (waiting !== undefined) {
            return {
              refused:
                `${waiting.what} waits for the learner's answer in the chat ` +
                `of unit "${waiting.unit}". Tell the learner to answer it ` +
                "there first; nothing can be proposed here until they do.",
            };
          }
          const result = await work(state);
          if ("proposed" in result) planned ??= new Set();
          return result;
        }),
      answered() {
        const blocked = planned;
        planned = undefined;
        return blocked;
      },
    },
    beginInstall(owner) {
      return exclusive(async () => {
        if (installing !== undefined) {
          return { refused: "Packages are being installed in this course." };
        }
        if (recoveryBlocked) return { refused: PACKAGE_RECOVERY_BLOCKED };
        if (pending !== undefined) return { refused: PACKAGE_SAVE_FAILED };
        if (cleanupNeeded !== undefined) {
          await clearSavedInstall(cleanupNeeded);
          if (cleanupNeeded !== undefined) {
            return {
              refused:
                "The previous install was saved, but its journal could not be cleared.",
            };
          }
        }
        const open = openInCourse(await dataRoot.readState(courseId));
        if (open !== undefined) {
          return {
            refused: `Answer question ${open.number} first: nothing is installed while a question is open.`,
          };
        }
        if (active > 0) {
          return {
            refused:
              "The tutor is changing the workspace. Try again once it has finished.",
          };
        }
        const claim = { owner, retries: new Map<Slug, () => void>() };
        installing = claim;
        return {
          done() {
            if (installing !== claim) return;
            installing = undefined;
            for (const retry of claim.retries.values()) retry();
          },
        };
      });
    },
  };
}

interface OpenableChat extends UnitChat {
  /**
   * Loads the unit, or picks up its existing chat. The first open fixes
   * whether to start with a test; a later test request is refused, even
   * while the first is still loading. A failed load can be tried again.
   */
  open(testOut?: boolean): boolean;
  /**
   * Takes in an answer on one of the unit's objectives that another unit's
   * assessment recorded, if the unit's record read when it opened lacks it.
   */
  learnAnswer(entry: AnswerEvidence): Promise<void>;
  /**
   * "Review now" from the course view (task 5.25), once the chat is open:
   * starts a review of what is due in this unit's thread, a finished
   * unit's too, unless something waits on the learner or the tutor here.
   * A review offered on its card starts; one under way is left to go on.
   */
  reviewNow(objectives: ReviewPick[] | undefined): Promise<ChatResult>;
  /**
   * Takes in a style note the learner applied in another unit's chat: the
   * tutor's next session starts with it, and its next header gives it.
   */
  learnStyle(note: string): Promise<void>;
  /**
   * Refreshes the course's curriculum, and its sources, after an Apply
   * elsewhere, notifying the page and telling the tutor in its next header.
   */
  learnCurriculum(
    units?: readonly StoredUnit[],
    outcome?: "changed" | "planner-applied",
  ): Promise<void>;
  /** Tells a refused tutor the learner kept the curriculum from the course view. */
  learnPlannerKept(): void;
  /**
   * Closes the tutor's session once it is between turns, so that the next
   * turn resumes it with the course's settings as they are then (task 4.11).
   */
  renew(): void;
}

/** The chat once its unit is planned and its record read. */
interface Running {
  /** Its units' plans are read again when an assessment is offered. */
  context: UnitContext;
  /** The course planner's committed curriculum for headers, until the chat queue catches up. */
  plannerContext?: UnitContext;
  record: UnitRecord;
  agents: UnitAgents;
  /** Said once, in the next turn's header. */
  notes: string[];
  /**
   * The unit's handoff note and the course's misconceptions (task 5.7),
   * read when the chat opens, with what this unit's calls write since; the
   * misconceptions are read again when an assessment is offered.
   */
  handoff: { note: string | undefined; misconceptions: Misconception[] };
  header: UnitHeader;
  progression: UnitProgression;
  review: ReviewAdmission;
  answers: UnitAnswers;
  unitEnd: UnitEnd;
  assessments: UnitAssessments;
  opening: UnitOpening;
  /**
   * Takes in the sources a planning conversation's Apply added to the
   * course: a session that can read them resumes with them, and the next
   * header says either way.
   */
  takeSources(): Promise<void>;
}

function createUnitChat(
  options: ChatOptions & {
    courseId: Slug;
    unitId: Slug;
    workspace: CourseWorkspace;
    /** `systemPrompt`, split at its marks. */
    tutorPrompt: TutorPrompt;
    /** Tells the chat of another unit, if it is open, an answer on its objective. */
    tell?: (unitId: Slug, entry: AnswerEvidence) => void;
    /** Tells the chats of the course's other open units a style note the learner applied. */
    restyle?: (note: string) => void;
    /** Tells the chats of the course's other open units a curriculum the learner applied. */
    recurriculum?: () => void;
  },
): OpenableChat {
  const { dataRoot, planner, courseId, unitId } = options;
  const now = options.now ?? (() => new Date());
  const order = options.order ?? randomOrder;
  const log = createTranscribedLog({ dataRoot, courseId, unitId, now });
  const exclusive = createSerial();
  let running: Running | undefined;
  /** Only the active teaching turn of a source segment can publish its lecture. */
  let sourceLecture: { shown: boolean } | undefined;
  /** The agents of the last load, so closing the chat closes them while it loads too. */
  let agents: UnitAgents | undefined;
  /** The handoff writer's calls on this unit, once it has loaded. */
  let handoffs: Handoffs | undefined;
  let loading: Promise<void> | undefined;
  let failed = false;
  /** Shutdown leaves unjudged replies and their waiting answer for reopening. */
  let closing = false;
  /** A Stop cancels automatic next-question turns, including ones still queued. */
  let stopCount = 0;
  /** A message cannot be admitted while the override is entering the queue. */
  let overrideWrite: Promise<ChatResult> | undefined;
  /** The course's workspace, where the tutor works and packages go. */
  let folder: string | undefined;
  /**
   * The course's style note as the tutor's system prompt gives it: read when
   * the unit loads, and replaced when the learner applies a new one.
   */
  let style: string | undefined;
  const code = options.codeRunner ?? noCodeRunner;

  // --- Opening ---------------------------------------------------------------

  async function load(testOut: boolean): Promise<void> {
    try {
      const workspace = await dataRoot.workspaceFolder(courseId);
      const pending = await options.workspace.prepare(workspace);
      folder = workspace;
      packages.recovered(pending);
      // The earlier sessions' thread first, then this session's.
      await log.open();
      const before = await dataRoot.readCourse(courseId);
      // A course's backend is fixed when it is made, so this one stays.
      const runsOn =
        before === undefined
          ? undefined
          : courseBackend(options.backends, before.course.backend);
      if (runsOn !== undefined && "lacking" in runsOn) {
        throw new Error(runsOn.lacking);
      }
      const prior = before?.curriculum?.units.find((u) => u.id === unitId);
      const needsPlan = prior?.plan === undefined;
      if (prior !== undefined && needsPlan) log.emit({ type: "unit_planning" });
      const planned = await planner.plan(courseId, unitId);
      if (!planned.ok) throw new Error(planned.error);
      const { plan } = planned;
      // An amendment while planning can change the new tutor's curriculum.
      const stored = needsPlan ? await dataRoot.readCourse(courseId) : before;
      const units = stored?.curriculum?.units ?? [];
      const storedUnit = needsPlan ? units.find((u) => u.id === unitId) : prior;
      if (
        stored === undefined ||
        storedUnit === undefined ||
        runsOn === undefined
      ) {
        throw new Error(`There is no unit "${unitId}" in "${courseId}".`);
      }
      log.emit({ type: "unit_plan", plan });

      const record = await openUnitRecord({
        dataRoot,
        courseId,
        unit: { ...storedUnit, plan },
        plan,
        emit: log.emit,
        recoveredCurriculumChange: async (decision) => {
          if (running !== undefined) {
            await proposals.publish(running, decision);
          }
        },
        packagePreview: packages.packagePreview,
        savingPackage: packages.savingPackage,
        now,
        ...(options.backup === undefined ? {} : { backup: options.backup }),
        testOut,
        handoff: () => handoffs?.request(),
      });
      // A course's sources change only when a planning conversation's Apply
      // adds some (`takeSources`); none is ever changed or removed.
      let courseSources = await dataRoot.readSources(courseId);
      /**
       * The sources the tutor's session reads: the course's, but for a Codex
       * thread that began with none, which keeps the tools it began with
       * (findings.md, "Codex") and gets the others in its next new session.
       * A thread resumed after a restart is taken to have begun as the
       * course stood then (plan.md, "Known gaps").
       */
      let sessionSources = courseSources;
      const shelfFor = (from: readonly Outline[]) =>
        createSourceShelf({
          dataRoot,
          courseId,
          courseInstance: stored.course.instance,
          sources: from,
          converter: options.converter,
          emit: log.emit,
          quotes: aids.quoteDesk,
          plannedRange(section) {
            const { position } = record;
            if (
              record.finished !== undefined ||
              position.phase !== "teach" ||
              position.assessment !== undefined ||
              (position.testOut !== undefined &&
                position.testOut.stage !== "skip") ||
              position.again !== undefined
            )
              return;
            return plan.segments[position.segment]?.passages?.find(
              (passage) => passage.section === section,
            )?.range;
          },
        });
      let sourceShelf = shelfFor(sessionSources);
      /** The context as the tutor's session sees it: with the sources it reads. */
      const seen = (from: UnitContext): UnitContext =>
        from.sources === sessionSources
          ? from
          : { ...from, sources: sessionSources };
      /** The notes that this session cannot read a source, while they wait. */
      const unreadable = new Set<string>();
      const context: UnitContext = {
        courseTitle: stored.course.title,
        units,
        unitId,
        plan,
        sources: courseSources,
      };
      const readHandoff = (unit: string) =>
        dataRoot.readHandoff(courseId, unit);
      const [
        readStyle,
        background,
        profile,
        handoffNote,
        misconceptions,
        assessmentHandoffs,
        evidence,
      ] = await Promise.all([
        dataRoot.readStyle(courseId),
        dataRoot.readBackground(courseId),
        dataRoot.readProfile(),
        dataRoot.readHandoff(courseId, unitId),
        dataRoot.readMisconceptions(courseId),
        record.position.assessment?.stage === "on"
          ? readAssessmentHandoffs(
              record.position.assessment,
              unitId,
              readHandoff,
            )
          : undefined,
        dataRoot.readEvidence(courseId),
      ]);
      const earlier = await readEarlier(
        dataRoot,
        courseId,
        units,
        unitId,
        evidence,
        misconceptions,
      );
      style = readStyle;
      if (options.handoff !== undefined && handoffs === undefined) {
        handoffs = createHandoffs({
          writer: options.handoff,
          dataRoot,
          courseId,
          unitId,
          context: () => seen(running?.context ?? context),
          flushed: log.flushed,
          now,
          ...(options.backup === undefined ? {} : { backup: options.backup }),
          written(note, found) {
            const kept = running?.handoff;
            if (kept === undefined) return;
            kept.note = note;
            // A read for an assessment offered meanwhile can hold them already.
            const held = new Set(
              kept.misconceptions.map((m) => JSON.stringify(m)),
            );
            kept.misconceptions.push(
              ...found.filter((m) => !held.has(JSON.stringify(m))),
            );
          },
        });
      }
      const loaded = createUnitAgents({
        backend: runsOn.backend,
        // A session started after a new style note, curriculum or teaching
        // instructions are applied starts with them.
        systemPrompt: async () =>
          tutorSystemPrompt(
            tutorInstructions(
              options.tutorPrompt,
              await dataRoot.readTeaching(),
            ),
            seen(running?.plannerContext ?? running?.context ?? context),
            { style, background, profile },
            earlier,
          ),
        // A new session reads every source the course has.
        starting: () => {
          if (sessionSources !== courseSources) {
            sessionSources = courseSources;
            sourceShelf = shelfFor(courseSources);
          }
          const r = running;
          if (r !== undefined && unreadable.size > 0) {
            r.notes = r.notes.filter((note) => !unreadable.has(note));
          }
          unreadable.clear();
        },
        tools: () => [
          askQuestionTool(questions.board),
          showArtifactTool(aids.artifactShelf),
          ...(options.installer === undefined
            ? []
            : [installPackagesTool(packages.desk)]),
          proposeStyleTool(proposals.styleDesk),
          amendCurriculumTool(proposals.curriculumDesk),
          ...(sessionSources.length === 0
            ? []
            : [
                readSectionTool(sourceShelf),
                viewPageTool(sourceShelf),
                quoteSourceTool(sourceShelf),
                presentLectureTool(sourceShelf, aids.lectureDesk),
                searchSourceTool(sourceShelf, aids.sourceSearchRefusal),
              ]),
        ],
        // Read whenever a session starts or resumes (task 4.11).
        webSearch: async () =>
          (await dataRoot.readCourse(courseId))?.course.settings.webSearch ===
          true,
        searchRefusal: aids.webSearchRefusal,
        // Read whenever a session starts or resumes, as the setting stands.
        model: async () =>
          tutorModel(await dataRoot.readSettings(), stored.course.backend),
        cwd: workspace,
        ...(options.workspaceTools === undefined
          ? {}
          : {
              workspace: {
                ...options.workspace.tools,
                ...options.workspaceTools,
              },
            }),
        title: `Gauss: ${stored.course.title}, ${storedUnit.title}`,
        keep: (id) => exclusive(() => record.keepSession(id)),
        // Only a turn calls these, once `r` is set.
        lost: (learnerId) => r.header.fallBack(learnerId),
        turnSent: () => r.header.turnSent(),
        turnEnded: (outcome) => r.header.turnEnded(outcome),
        judge: options.judge,
        log,
        exclusive,
        ...(options.timer === undefined ? {} : { timer: options.timer }),
      });
      agents = loaded;
      const r: Running = {
        context,
        record,
        agents: loaded,
        notes: [],
        handoff: { note: handoffNote?.note, misconceptions },
        header: createUnitHeader({
          record,
          exclusive,
          emit: log.emit,
          context: () => seen(r.context),
          plannerContext: () =>
            r.plannerContext === undefined ? undefined : seen(r.plannerContext),
          notes: () => r.notes,
          clearNotes: () => {
            r.notes = [];
          },
          style: () => style,
          checks: () => checks(r),
          feedback: () => r.progression.feedback,
          runWhere: (run) => r.assessments.runWhere(run),
          shownByTest: () => r.assessments.shownByTest(),
          handoff: () => r.handoff,
        }),
        progression: createUnitProgression({
          record,
          tutor: loaded,
          where: () => r.header.where(),
          exclusive,
          flush: log.flushed,
          stopCount: () => stopCount,
          closing: () => closing,
          checkDone: () => checkDone(r),
          closeSegment: () => closeSegment(r),
          endRun: () => r.assessments.endRun(false),
          sendTestSummary: (text) => r.assessments.sendTestSummary(text),
        }),
        review: createReviewAdmission({
          record,
          plan,
          tutor: loaded,
          exclusive,
          now,
          count: REVIEW_COUNT,
          closing: () => closing,
          feedbackPending: () => r.progression.feedback !== undefined,
          installing: packages.installing,
          unsavedInstall: packages.unsavedInstall,
          overridePending: OVERRIDE_PENDING,
          async readOfferContext() {
            const [stored, evidence, misconceptions] = await Promise.all([
              dataRoot.readCourse(courseId),
              dataRoot.readEvidence(courseId),
              dataRoot.readMisconceptions(courseId),
            ]);
            // Other units' calls write misconceptions on the objectives it asks.
            r.handoff.misconceptions = misconceptions;
            return {
              units: stored?.curriculum?.units ?? r.context.units,
              evidence,
            };
          },
          markOffered: (at, options) =>
            dataRoot.markReviewOffered(courseId, at, options),
          async saveOffer(run, { units, evidence }) {
            r.context = { ...r.context, units };
            if (
              record.finished !== undefined &&
              record.position.tutorSessionId === undefined
            ) {
              r.header.joined();
            }
            await record.offerAssessment(run, evidence, () =>
              r.assessments.showRun(run),
            );
          },
          start: (run) => r.assessments.startRun(run),
          skip: () => r.assessments.endRun(true),
        }),
        answers: createUnitAnswers({
          record,
          agents: loaded,
          exclusive,
          emit: log.emit,
          grader: options.grader,
          mathCheck: options.mathCheck ?? noMathCheck,
          code,
          folder: () => folder,
          closing: () => closing,
          stopCount: () => stopCount,
          unitId,
          where: () => r.header.where(),
          runOn: () => r.assessments.runOn(),
          progression: {
            answered: (answered, stops) =>
              r.progression.answered(answered, stops),
          },
          tell: (unit, entry) => options.tell?.(unit, entry),
        }),
        unitEnd: createUnitEnd({
          record,
          context: () => r.context,
          setUnits: (units) => {
            r.context = { ...r.context, units };
          },
          setMisconceptions: (misconceptions) => {
            r.handoff.misconceptions = misconceptions;
          },
          emit: log.emit,
          showRun: (run) => r.assessments.showRun(run),
          sendTeaching: (cutOff) => sendTeaching(r, cutOff),
          runWaits: () => r.assessments.runWaits(),
          readCourse: () => dataRoot.readCourse(courseId),
          readEvidence: () => dataRoot.readEvidence(courseId),
          readMisconceptions: () => dataRoot.readMisconceptions(courseId),
          now,
          unitId,
        }),
        assessments: createUnitAssessments({
          record,
          agents: loaded,
          exclusive,
          emit: log.emit,
          where: () => r.header.where(),
          progression: {
            askInRun: (event, stops) => r.progression.askInRun(event, stops),
            afterReview: () => r.progression.afterReview(),
            feedback: () => r.progression.feedback,
          },
          stopCount: () => stopCount,
          end: () => r.unitEnd.end(),
          sendTeaching: (cutOff) => sendTeaching(r, cutOff),
          context: () => r.context,
          note: (text) => {
            r.notes.push(text);
          },
          readHandoff,
          handoffs: assessmentHandoffs,
          unitId,
        }),
        opening: createUnitOpening({
          record,
          exclusive,
          emit: log.emit,
          events: log.events,
          plan,
          context: () => r.context,
          folder: () => folder,
          unitId,
          note: (text) => {
            r.notes.push(text);
          },
          checkDone: () => checkDone(r),
          closeSegment: () => closeSegment(r),
          sendTeaching: (cutOff) => sendTeaching(r, cutOff),
          progression: {
            resume: () => r.progression.resume(),
            reopenRecordedAnswer: () => r.progression.reopenRecordedAnswer(),
            feedback: () => r.progression.feedback,
          },
          sittingOpened: () => r.review.sittingOpened(),
          answers: {
            grade: (open, answer) => r.answers.grade(open, answer),
            settleJudging: (open, learnerIds, verdict, tell) =>
              r.answers.settleJudging(open, learnerIds, verdict, tell),
          },
          end: () => r.unitEnd.end(),
          where: () => r.header.where(),
          assessments: {
            showRun: (run) => r.assessments.showRun(run),
            headOf: (open) => r.assessments.headOf(open),
            showTestResult: () => r.assessments.showTestResult(),
            sendTestSummary: (text) => r.assessments.sendTestSummary(text),
            goOnInRun: () => r.assessments.goOnInRun(),
            startTest: () => r.assessments.startTest(),
          },
          packages: {
            restorePackages: (completions) =>
              packages.restorePackages(completions),
            showUnsaved: () => packages.showUnsaved(),
            showWaiting: (position) => packages.showWaiting(position),
          },
          proposals: {
            showAnswered: () => proposals.showAnswered(record),
            showWaiting: (position) => proposals.showWaiting(position),
          },
        }),
        async takeSources() {
          const now = await dataRoot.readSources(courseId);
          const added = now.filter(
            (s) => !courseSources.some((o) => o.id === s.id),
          );
          if (added.length === 0) return;
          courseSources = now;
          // A Claude session takes the tools it is given at its next resume;
          // a Codex thread has the source tools only if it began with them.
          const readable =
            stored.course.backend !== "codex" || sessionSources.length > 0;
          const note = addedSourcesNote(
            added,
            readable,
            record.finished !== undefined,
          );
          r.notes.push(note);
          if (!readable) {
            unreadable.add(note);
            return;
          }
          sessionSources = now;
          sourceShelf = shelfFor(now);
          loaded.renew();
        },
      };
      if (record.reopened) {
        // A unit under way resumes its tutor's conversation with its first
        // turn. One that cannot be found, or was never kept, gives way to a
        // new session at once, so the thread says so before anything else.
        const id = record.position.tutorSessionId;
        const resumes = id !== undefined && (await loaded.resume(id));
        if (!resumes) r.header.fallBack();
      }
      const recoveringOverride =
        record.position.pendingSegmentOverride !== undefined;
      if (recoveringOverride) await record.overrideSegment();
      running = r;
      await r.opening.resume(recoveringOverride);
    } catch (error) {
      failed = true;
      const message = error instanceof Error ? error.message : String(error);
      log.emit({ type: "unit_failed", error: message });
      // Opening it again makes new agents.
      if (running === undefined && agents !== undefined) {
        const unused = agents;
        agents = undefined;
        await unused.close();
      }
    } finally {
      loading = undefined;
    }
  }

  // --- Turns -----------------------------------------------------------------

  /** Where each objective of the segment stands in the check; none outside it. */
  function checks(r: Running): Map<string, ObjectiveCheck> {
    const { position, evidence, checkAnswers } = r.record;
    if (position.phase !== "check") return new Map();
    return new Map(
      segmentOf(r.context.plan, position).objectives.map((id) => [
        id,
        objectiveCheck(id, evidence, checkAnswers),
      ]),
    );
  }

  function sendTeaching(r: Running, cutOff: boolean): void {
    const { segment } = r.record.position;
    const lecture =
      segmentOf(r.context.plan, r.record.position).sections.length === 0
        ? undefined
        : { shown: false };
    r.agents.send({
      text: () => teachTurn(r.header.where(), cutOff),
      ...(lecture === undefined
        ? {}
        : {
            sent: () => {
              sourceLecture = lecture;
            },
            toolReplyProblem: () =>
              lecture.shown
                ? undefined
                : "The tutor did not submit the source lecture. Ask it to explain what was missed.",
          }),
      // The end of the teaching turn, or Stop during it, opens the
      // discussion, whatever the outcome: after an error the learner can
      // ask for what was missed.
      ended: () => {
        // Set once the turn reached the tutor; a Stop or failure before
        // that leaves the tutor nothing it could think was seen.
        const sent = lecture !== undefined && sourceLecture === lecture;
        if (sent) sourceLecture = undefined;
        // The turn's ordinary text was hidden, so with no lecture shown,
        // after a Stop too, the learner saw nothing the tutor wrote.
        const unshown = sent && !lecture.shown;
        return exclusive(async () => {
          const { position } = r.record;
          const discussion: UnitPosition | undefined =
            position.segment === segment && position.phase === "teach"
              ? { ...position, phase: "discuss" }
              : undefined;
          // In one write with the discussion, so a restart before it
          // teaches the segment again instead.
          if (unshown) {
            await r.record.keepNotice({ kind: "unshown-lecture" }, discussion);
          } else if (discussion !== undefined) {
            await r.record.move(discussion);
          }
        });
      },
    });
  }

  /** Every objective of the segment is done in this check. */
  function checkDone(r: Running): boolean {
    const standing = checks(r);
    return segmentObjectives(r).every(
      (id) => standing.get(id)?.state === "done",
    );
  }

  /**
   * Closes the segment, its check done, and ends the unit after its last
   * segment. Runs inside `exclusive`.
   */
  async function closeSegment(r: Running): Promise<void> {
    const { checkFrom: _, ...rest } = r.record.position;
    await r.record.move({ ...rest, phase: "closed" });
    const last = isLastSegment(r.context.plan, r.record.position);
    r.review.segmentClosed(last);
    if (last) await r.unitEnd.end(true);
  }

  function segmentObjectives(r: Running): readonly string[] {
    return segmentOf(r.context.plan, r.record.position).objectives;
  }

  // --- The teaching tools ----------------------------------------------------

  const questions = createUnitQuestions({
    exclusive,
    running: () => running,
    stopCount: () => stopCount,
    closing: () => closing,
    folder: () => folder,
    course: options.workspace,
    mathCheck: options.mathCheck ?? noMathCheck,
    code,
    order,
    now,
    emit: log.emit,
    unitId,
    unitFinished: UNIT_FINISHED,
    where: (r) => r.header.where(),
    checks: (r) => checks(r),
    segmentObjectives: (r) => segmentObjectives(r),
    runOn: (r) => r.assessments.runOn(),
    runWhere: (r, run) => r.assessments.runWhere(run),
    nextOf: (r, run) => r.assessments.nextOf(run),
    headOf: (r, open) => r.assessments.headOf(open),
  });

  const aids = createUnitAids({
    exclusive,
    running: () => running,
    sourceLecture: () => sourceLecture,
    emit: log.emit,
    writeArtifact: (artifact) => dataRoot.writeArtifact(courseId, artifact),
    unitFinished: UNIT_FINISHED,
  });

  const proposals = createUnitProposals({
    exclusive,
    running: () => running,
    closing: () => closing,
    emit: log.emit,
    events: log.events,
    // The course's queue keeps this chat, to tell it when its block lifts.
    propose: (work) => options.workspace.propose(chat, work),
    courseId,
    now,
    readStyle: () => dataRoot.readStyle(courseId),
    readCourse: () => dataRoot.readCourse(courseId),
    readSources: () => dataRoot.readSources(courseId),
    restyle: (note) => options.restyle?.(note),
    recurriculum: () => options.recurriculum?.(),
    backup: options.backup,
    setStyle: (note) => {
      style = note;
    },
    unitFinished: UNIT_FINISHED,
  });

  const packages = createUnitPackages({
    exclusive,
    running: () => running,
    folder: () => folder,
    emit: log.emit,
    events: log.events,
    unitId,
    now,
    installer: options.installer,
    course: options.workspace,
    where: (r) => r.header.where(),
    unitFinished: UNIT_FINISHED,
    saveFailed: PACKAGE_SAVE_FAILED,
  });

  // --- What the learner does -------------------------------------------------

  /**
   * Runs the action once the unit is open and the tutor is not writing. In a
   * finished unit only an action `inRun`, on a review the learner asked for
   * there, is taken, and only while that review is offered or under way.
   */
  function act(
    work: (r: Running) => Promise<ChatResult>,
    { whileWriting = false, inRun = false, overriding = false } = {},
  ): Promise<ChatResult> {
    return exclusive(async () => {
      const r = running;
      if (r === undefined) return notOpen();
      if (
        !overriding &&
        r.record.position.pendingSegmentOverride !== undefined
      ) {
        return refused(OVERRIDE_PENDING);
      }
      if (
        r.record.finished !== undefined &&
        !(inRun && r.record.position.assessment !== undefined)
      ) {
        return refused(UNIT_FINISHED);
      }
      if (!whileWriting && r.agents.busy()) {
        return {
          ok: false,
          status: 409,
          error: "Wait until the tutor has finished, or stop it.",
        };
      }
      return work(r);
    });
  }

  function notOpen(): ChatResult {
    return {
      ok: false,
      status: 409,
      error: failed
        ? "The unit could not be opened. Open it again to try again."
        : "The unit is still opening. Wait a moment.",
    };
  }

  const chat: OpenableChat = {
    id: log.id,
    events: log.events,
    subscribe: log.subscribe,

    open(testOut = false) {
      const r = running;
      if (r !== undefined) {
        if (testOut) return false;
        // Opened again after a quiet hour: a new sitting, which can open
        // with review.
        if (log.quiet()) void r.review.sittingOpened();
        return true;
      }
      if (loading !== undefined) return !testOut;
      failed = false;
      loading = load(testOut);
      return true;
    },

    say(text) {
      const r = running;
      if (r === undefined) return notOpen();
      if (overrideWrite !== undefined) {
        return refused("Wait for Move on to finish.");
      }
      if (r.record.position.pendingSegmentOverride !== undefined) {
        return refused(OVERRIDE_PENDING);
      }
      const id = randomUUID();
      log.emit({ type: "learner", id, text });
      // One per message, shared by its turn's text and end.
      const turn = r.answers.message(id, text);
      const send = () =>
        r.agents.send({
          learnerId: id,
          learnerMessage: text,
          text: turn.text,
          ended: turn.ended,
        });
      r.review.sendMessage(send);
      return { ok: true };
    },

    ready: () =>
      act(async (r) => {
        const waits = r.assessments.runWaits();
        if (waits !== undefined) return waits;
        const { phase } = r.record.position;
        if (phase !== "discuss") return refused(NOT_NOW.ready[phase]);
        await r.record.startCheck();
        r.agents.send({ text: () => readyTurn(r.header.where()) });
        return { ok: true };
      }),

    anotherQuestion: () =>
      act(
        async (r) => {
          if (!(await r.progression.endDetour())) {
            return refused("No detour is open, so there is nothing to end.");
          }
          return { ok: true };
        },
        { inRun: true },
      ),

    answer: (sent) =>
      // An answer is taken while the tutor replies to a message.
      act((r) => r.answers.answer(sent), { whileWriting: true, inRun: true }),

    gradeAgain: () =>
      act((r) => r.answers.gradeAgain(), { whileWriting: true, inRun: true }),

    installPackages: (requestId) =>
      act((r) => packages.installPackages(r, requestId)),

    declinePackages: (requestId) =>
      act((r) => packages.declinePackages(r, requestId), {
        whileWriting: true,
      }),

    retryPackageSave: (requestId) =>
      exclusive(async () => {
        const r = running;
        if (r === undefined || folder === undefined) return notOpen();
        return packages.retryPackageSave(r, folder, requestId);
      }),

    applyStyle: (proposalId) =>
      act((r) => proposals.answerStyle(r, proposalId, "applied"), {
        whileWriting: true,
      }),
    keepStyle: (proposalId) =>
      act((r) => proposals.answerStyle(r, proposalId, "kept"), {
        whileWriting: true,
      }),
    applyCurriculum: (proposalId) =>
      act((r) => proposals.answerCurriculum(r, proposalId, "applied"), {
        whileWriting: true,
      }),
    keepCurriculum: (proposalId) =>
      act((r) => proposals.answerCurriculum(r, proposalId, "kept"), {
        whileWriting: true,
      }),

    override() {
      if (overrideWrite !== undefined) return overrideWrite;
      overrideWrite = act(
        async (r) => {
          const waits = r.assessments.runWaits();
          if (waits !== undefined) return waits;
          const { phase, openQuestion } = r.record.position;
          if (phase !== "discuss" && phase !== "check") {
            return refused(NOT_NOW.override[phase]);
          }
          // Only an infrastructure failure lets a kept answer be withdrawn.
          if (
            openQuestion?.answer !== undefined &&
            !r.agents.canMoveOn(openQuestion.id)
          ) {
            return refused(
              openQuestion.judging !== undefined || r.agents.grading()
                ? "An answer is being graded. Wait for its grade, then move on."
                : "An answer is kept and waits to be graded again. Grade it again, then move on.",
            );
          }
          await r.record.overrideSegment();
          const last = isLastSegment(r.context.plan, r.record.position);
          r.review.segmentClosed(last);
          if (last) await r.unitEnd.end(true);
          return { ok: true };
        },
        { overriding: true },
      ).finally(() => {
        overrideWrite = undefined;
      });
      return overrideWrite;
    },

    startAssessment: () =>
      act((r) => r.assessments.startAssessment(), { inRun: true }),

    skipAssessment: () =>
      act((r) => r.assessments.skipAssessment(), { inRun: true }),

    async reviewNow(objectives) {
      await loading;
      return exclusive(async () => {
        const r = running;
        if (r === undefined) return notOpen();
        return r.review.request(objectives);
      });
    },

    nextSegment: () =>
      act(async (r) => {
        const waits = r.assessments.runWaits();
        if (waits !== undefined) return waits;
        const { position } = r.record;
        const { phase } = position;
        if (phase !== "closed") return refused(NOT_NOW.next[phase]);
        // Skipping what the test passed passes over the segments it leaves
        // nothing to teach.
        const next = nextSegment(r.context.plan, position);
        if (next === undefined) {
          return refused(
            "This was the unit's last segment: go over the objectives not passed again, or move on without them.",
          );
        }
        await r.record.move({ segment: next, phase: "teach" });
        sendTeaching(r, false);
        return { ok: true };
      }),

    skipTested: (shown) => act((r) => r.assessments.skipTested(shown)),

    teachWhole: () => act((r) => r.assessments.teachWhole()),

    goOverAgain: () => act((r) => r.unitEnd.goOverAgain()),

    finishUnit: (finishId) => act((r) => r.unitEnd.finishUnit(finishId)),

    startFresh() {
      return act(async (r) => {
        // Taken out first, so a restart before the new session starts does
        // not resume the old one.
        await r.record.keepSession(undefined);
        r.agents.startFresh();
        r.header.joined();
        log.emit({ type: "fresh_start", reason: "learner" });
        r.agents.send({ text: () => freshTurn(r.header.where()) });
        return { ok: true };
      });
    },

    async interrupt() {
      stopCount += 1;
      questions.stop();
      const r = running;
      if (r === undefined) return;
      await r.progression.interrupt(r.answers.answerAwaitingJudge());
    },
    async recordDispute(entry) {
      await loading;
      return exclusive(async () => {
        const r = running;
        if (r === undefined) return false;
        return r.opening.recordDispute(entry);
      });
    },
    async learnStyle(note) {
      await loading;
      await exclusive(async () => {
        proposals.learnStyle(note);
      });
    },
    renew() {
      agents?.renew();
    },
    learnPlannerKept() {
      proposals.learnPlannerKept();
    },
    async learnCurriculum(units, outcome = "changed") {
      const install = proposals.takeUnits(units, outcome);
      const update = install === undefined ? undefined : exclusive(install);
      // The page hears of it only once the install, if any, is queued.
      log.emit({ type: "curriculum_changed" });
      if (update !== undefined) {
        await update;
      } else {
        if (loading !== undefined) await loading;
        await exclusive(() => proposals.refreshUnits(outcome));
      }
      // An Apply in the course's planning conversation can add sources.
      await exclusive(async () => {
        await running?.takeSources();
      });
    },
    async learnAnswer(entry) {
      await loading;
      await exclusive(async () => {
        const r = running;
        if (r === undefined) return;
        await r.opening.learnAnswer(entry);
      });
    },
    async learnDispute(entry, override) {
      await loading;
      await exclusive(async () => {
        const r = running;
        if (r === undefined) return;
        await r.opening.learnDispute(entry, override);
      });
    },
    async settleNotesContext() {
      await handoffs?.settled();
      await log.flushed();
    },
    flushTranscript: log.flushed,
    async settled() {
      await loading;
      await packages.installDone();
      // A message held behind the skip of a card is sent from the queue.
      await exclusive(async () => {});
      await running?.agents.settled();
      // A review held for a segment's close is offered after the tutor's turn.
      await running?.review.settled();
      await handoffs?.settled();
      await log.flushed();
    },
    inUse() {
      if (log.watched()) return "unit-page";
      if (loading !== undefined) return "opening";
      if (running?.agents.busy()) return "tutor";
      if (running?.agents.grading()) return "grading";
      if (running?.agents.judging()) return "judging";
      if (handoffs?.running()) return "handoff";
      if (packages.installing()) return "install";
      if (exclusive.busy()) return "unit-action";
      return undefined;
    },
    async close() {
      closing = true;
      const posting = questions.stop();
      await Promise.all([agents?.close(), posting, handoffs?.close()]);
      // An install under way is not waited for. Reopening reconciles its
      // journal before the course workspace can be used again.
      await log.flushed();
    },
  };
  return chat;
}

const UNIT_FINISHED = "The unit is finished.";
const OVERRIDE_PENDING = "Choose Move on again to finish the override.";

/** How many objectives review asks about (docs/brief.md, "Assessment modes"). */
const REVIEW_COUNT = 3;

/** Why "Review now" starts nothing. */
const NOTHING_DUE = "Nothing is due for review.";

function refused(error: string): ChatResult {
  return { ok: false, status: 409, error };
}

/**
 * Said once in the next header after an Apply added sources: whether the
 * tutor can read them in this conversation, or only in a new one, which a
 * finished unit's outline does not offer.
 */
function addedSourcesNote(
  added: readonly Outline[],
  readable: boolean,
  finished: boolean,
) {
  const it = added.length === 1 ? "it" : "them";
  const named = added
    .map((s) => `${JSON.stringify(s.title)} (source id "${s.id}")`)
    .join("; ");
  const what =
    added.length === 1
      ? `The course has a new source: ${named}.`
      : `The course has new sources: ${named}.`;
  if (readable) {
    return (
      `${what} Your instructions now list ${it} with ` +
      `${added.length === 1 ? "its outline" : "their outlines"}, and you ` +
      `can read, search and quote ${it} as the course's sources.`
    );
  }
  return (
    `${what} This conversation has no tools to read a source, so you ` +
    `cannot read ${it} here: ${it} can be read in ` +
    (finished
      ? "another unit."
      : 'a new conversation, which the learner starts with "Start fresh" in the unit\'s outline, or in another unit.')
  );
}

/** Why the learner's action is refused in the phase the segment is in. */
const NOT_NOW = {
  ready: {
    teach: "The tutor is still teaching this segment.",
    check: "The check has started already.",
    closed: "The segment is closed already.",
  },
  override: {
    teach: "The tutor is still teaching this segment.",
    closed: "The segment is closed already.",
  },
  next: {
    teach: "This segment has only just started.",
    discuss:
      "Finish this segment first: take its check, or move on without it.",
    check: "Finish this segment first: take its check, or move on without it.",
  },
} as const;

/** Runs work one piece at a time, in the order given. */
function createSerial() {
  let tail: Promise<unknown> = Promise.resolve();
  let pending = 0;
  function release() {
    pending -= 1;
  }
  function run<T>(work: () => Promise<T>): Promise<T> {
    pending += 1;
    const result = tail.then(work);
    tail = result.then(release, release);
    return result;
  }
  run.busy = () => pending > 0;
  return run;
}
