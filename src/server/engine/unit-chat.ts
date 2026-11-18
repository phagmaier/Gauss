// The unit chat (architecture.md section 4; tasks 2.6 and 2.7): one tutor
// session bound to one unit, which runs each segment's teach / discuss /
// check rhythm. Opening a unit not in progress plans it (task 2.5) and sends
// segment 1's teaching turn. The engine enforces the phases:
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
//   another one. A choice is graded at once; a written answer is kept
//   in state.json and graded by the grader (grading.ts), outside the
//   chat's queue, and if the grading fails it can be graded again. A math
//   question's expected expression must read when it is posted, and its
//   answer is kept and graded the same way, by the symbolic check
//   (math-check.ts, task 3.5), or by the grader when the check does not
//   settle it. A code question names files in the workspace that the
//   learner edits (task 3.7); its tests must fail on the starter files and
//   pass on the tutor's solution when it is posted, and its answer, the
//   learner's files as they are when "Run the tests" is pressed, is kept and
//   graded the same way, by running the tests on them (code-run.ts).
//   A message the tutor receives while a question waits for its answer
//   has the tutor's reply judged, once it ends, by the help judge
//   (help-judge.ts, task 2.21): clarification leaves the answer counting,
//   help, or a call that fails, makes it given with help. An answer sent
//   before the judge's calls are in is kept and waits for them;
// - check to closed: the engine closes the segment when the feedback on the
//   answer that leaves every objective done in this check ends (task
//   2.16a), or the learner moves on without the check, recorded as
//   evidence;
// - closed to the next segment's teach: the learner starts it.
//
// When the unit's last segment closes, the unit ends: passed and out of
// state.json when every objective passed; otherwise the learner goes over
// the rest again in one more segment, or moves on without them, which
// records them as overridden and closes the unit.
//
// A tool called out of phase is refused with a reason the tutor can act on;
// so are the tutor's file writes and commands while a question is open
// (task 3.3), when it has them, and an artifact while a question of the
// unit is open (task 3.6): show_artifact stores the aid in the course's
// artifacts/ folder, and the thread keeps a reference to it. With
// install_packages (task 3.11) the tutor asks for packages, which the
// learner installs or declines on a card; the request is kept in the unit's
// position, the install runs outside the chat's queue with the course's
// workspace closed to every other change, and the answer goes to the tutor
// in a turn of its own.
// A dispute of an answer's grade (task 3.8) is decided outside the chat
// (disputes.ts) and, when the chat is open, recorded inside its queue, so it
// lands in order with the chat's own writes; one recorded while the chat
// was not open is shown, and told, when it opens. The tutor of a unit in
// progress is told the outcome in its next header. An outcome changes no
// phase: where the check rules would decide next (the end of a detour, a
// check with nothing left to ask, the closing card), they decide with the
// corrected verdict.
// The engine composes every turn's header (unit-turns.ts) and writes the
// unit's position to state.json after every change, before the page is told,
// so a restart reopens the unit where it was. The chat's events are its
// transcripts too (transcript.ts, task 2.13), so a reopened unit shows the
// thread of its earlier sessions. The tutor's conversation survives a
// restart too (task 2.14): its session's id is kept in the unit's position,
// and a reopened unit resumes it with its first turn. The tutor's session is
// closed while idle and resumed with the next turn (task 2.15). If it cannot
// be found, as the opening asks the backend, or as a turn finds, the unit
// starts fresh: a new session, seeded from the record and told that it joins
// a unit under way, and the thread says so. The learner can start fresh too.
// Resuming that fails another way fails the turn, since the fault may pass;
// the next turn tries again, and the learner can start fresh instead.
//
// This file holds the phase rules and coordinates two parts (task 2.8b):
// unit-record.ts keeps the unit's position and evidence and writes every
// change before the page hears of it, and unit-agents.ts runs the tutor and
// the grader. Every change to the unit goes through this chat's one queue
// (`exclusive`), which the agents are given for recording a grade.

import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { Slug } from "../../shared/course.ts";
import type { PageEvent } from "../../shared/events.ts";
import type {
  DisputeEvidence,
  OverrideEvidence,
} from "../../shared/evidence.ts";
import type {
  PackageCompletion,
  PackageRequest,
} from "../../shared/packages.ts";
import {
  type AnswerPost,
  type AnswerSubmission,
  CHOICE_LETTERS,
  type CodeFile,
  type GradedAnswer,
  postedQuestion,
  type Question,
  type QuestionInput,
  type QuestionView,
} from "../../shared/question.ts";
import type {
  OpenQuestion,
  Phase,
  State,
  UnitPosition,
} from "../../shared/state.ts";
import type { TutorBackend, WorkspaceTools } from "../backends/backend.ts";
import type { Backup } from "../record/backup.ts";
import type { DataRoot } from "../record/data-root.ts";
import { askQuestionTool } from "../tools/ask-question.ts";
import {
  installPackagesTool,
  type PackageDesk,
} from "../tools/install-packages.ts";
import {
  type ArtifactShelf,
  showArtifactTool,
} from "../tools/show-artifact.ts";
import {
  isLastSegment,
  notPassed,
  type ObjectiveCheck,
  objectiveCheck,
  segmentOf,
} from "./check-rules.ts";
import { type ChoiceOrder, randomOrder, reorder } from "./choice-order.ts";
import {
  type CodeRunner,
  fileProblem,
  gradeCode,
  noCodeRunner,
  readWorkspaceFiles,
} from "./code-run.ts";
import type { ChatResult, Timer } from "./conversation.ts";
import { type Grader, gradeChoice, gradeMath } from "./grading.ts";
import type { HelpJudge, HelpOutcome } from "./help-judge.ts";
import { type MathCheck, noMathCheck } from "./math-check.ts";
import type { InstallResult, PackageInstaller } from "./packages.ts";
import { createTranscribedLog } from "./transcript.ts";
import {
  createUnitAgents,
  type Grade,
  type Grading,
  type UnitAgents,
} from "./unit-agents.ts";
import type { UnitPlanner } from "./unit-planning.ts";
import {
  type Answered,
  detourEvent,
  disputedEvent,
  gradedEvent,
  openUnitRecord,
  packagesAnsweredEvent,
  phaseEvent,
  type UnitRecord,
} from "./unit-record.ts";
import {
  answerTurn,
  checkText,
  disputeNote,
  freshTurn,
  JOINED_NOTE,
  messageTurn,
  nextQuestionTurn,
  overrideNote,
  packagesNote,
  packagesTurn,
  quoted,
  readyTurn,
  teachTurn,
  tutorSystemPrompt,
  type UnitContext,
  type Where,
  workspaceReadyTurn,
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
  /** The learner moves on without the check, which is recorded. */
  override(): Promise<ChatResult>;
  /** The learner starts the next segment, once this one is closed. */
  nextSegment(): Promise<ChatResult>;
  /**
   * At the unit's end, with objectives not passed: one more segment, after
   * the plan's last, on them.
   */
  goOverAgain(): Promise<ChatResult>;
  /**
   * At the unit's end, with objectives not passed: moves on without them,
   * which records them as overridden and closes the unit.
   */
  finishUnit(): Promise<ChatResult>;
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
   * False if the unit could not be opened, so nothing was recorded. Throws
   * DisputeRefused if the record refuses it.
   */
  recordDispute(entry: DisputeEvidence): Promise<boolean>;
  /**
   * Takes in a dispute recorded without the chat, with the override recorded
   * with it, if the unit's record read when it opened did not have it.
   */
  learnDispute(
    entry: DisputeEvidence,
    override?: OverrideEvidence,
  ): Promise<void>;
  /** Resolves once the chat has opened and every turn sent so far has finished. */
  settled(): Promise<void>;
  close(): Promise<void>;
}

export type OpenResult =
  | { ok: true; chat: UnitChat }
  | { ok: false; status: 404 | 409; error: string };

/**
 * The unit chats opened since the server started, one per unit. A chat
 * stays until the server stops; its tutor's session is closed while idle
 * (task 2.15).
 */
export interface UnitChats {
  /**
   * Opens the unit, marking it and its course opened: its chat if it is
   * open, or a new one, which starts the unit or picks it up where
   * state.json has it. Opening a unit whose planning failed tries again.
   */
  open(courseId: string, unitId: string): Promise<OpenResult>;
  get(courseId: string, unitId: string): UnitChat | undefined;
  /** Closes the tutor session of every chat. */
  close(): Promise<void>;
}

interface ChatOptions {
  backend: TutorBackend;
  /** `prompts/tutor.md`. */
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
   * 3.3); only when the sandbox can run. None if not given.
   */
  workspaceTools?: boolean;
  /**
   * Installs the packages a tutor asks for (task 3.11); only when the
   * sandbox can run. Without it, tutors get no install_packages.
   */
  installer?: PackageInstaller;
}

export function createUnitChats(options: ChatOptions): UnitChats {
  const { dataRoot } = options;
  const chats = new Map<string, OpenableChat>();
  const key = (courseId: string, unitId: string) =>
    JSON.stringify([courseId, unitId]);
  const courses = new Map<string, CourseWorkspace>();

  function workspace(courseId: Slug) {
    let guard = courses.get(courseId);
    if (guard === undefined) {
      guard = courseWorkspace(dataRoot, courseId);
      courses.set(courseId, guard);
    }
    return guard;
  }

  return {
    async open(courseId, unitId) {
      const stored = await dataRoot.readCourse(courseId);
      const curriculum = stored?.curriculum ?? undefined;
      if (!curriculum?.units.some((u) => u.id === unitId)) {
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
          error:
            "The curriculum is not approved yet, so its units cannot start.",
        };
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
        });
        chats.set(key(courseId, unitId), chat);
      }
      chat.open();
      return { ok: true, chat };
    },
    get: (courseId, unitId) => chats.get(key(courseId, unitId)),
    async close() {
      await Promise.allSettled([...chats.values()].map((c) => c.close()));
    },
  };
}

interface CourseWorkspace {
  tools: WorkspaceTools;
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
   * Closes the workspace to the tutors' changes and to questions while an
   * install runs, unless a question is open or a change is under way; the
   * caller calls `done` once it ends.
   */
  beginInstall(owner: Slug): Promise<{ done(): void } | { refused: string }>;
}

/** The question open in a unit of the course, if there is one. */
function openInCourse(state: State): OpenQuestion | undefined {
  for (const position of Object.values(state.units)) {
    if (position.openQuestion !== undefined) return position.openQuestion;
  }
  return undefined;
}

const INSTALLING =
  "Packages are being installed in the workspace: no file may be written " +
  "and no command run until that ends. You may still read files.";

/**
 * The course's mutation reservations, question commits, package requests
 * and installs share one queue. Never enter a chat's queue from here:
 * teaching tools already hold it.
 */
function courseWorkspace(dataRoot: DataRoot, courseId: Slug): CourseWorkspace {
  const exclusive = createSerial();
  let active = 0;
  let installing: { owner: Slug; retries: Map<Slug, () => void> } | undefined;
  const tools: WorkspaceTools = {
    acquire: () =>
      exclusive(async () => {
        if (installing !== undefined) return { refused: INSTALLING };
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
    beginInstall(owner) {
      return exclusive(async () => {
        if (installing !== undefined) {
          return { refused: "Packages are being installed in this course." };
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
  /** Loads the unit, unless it is loaded or loading; again after a failure. */
  open(): void;
}

/** The chat once its unit is planned and its record read. */
interface Running {
  context: UnitContext;
  record: UnitRecord;
  agents: UnitAgents;
  /** Said once, in the next turn's header. */
  notes: string[];
  /** Blocks new questions from when feedback is queued until it ends. */
  feedback?: { number: number; started: boolean } | undefined;
  /**
   * How many Stops there had been when the answer kept for the judging was
   * sent, so a Stop after it cancels the automatic next question as it does
   * for an answer recorded at once (task 2.17a).
   */
  answerStops?: number | undefined;
}

function createUnitChat(
  options: ChatOptions & {
    courseId: Slug;
    unitId: Slug;
    workspace: CourseWorkspace;
  },
): OpenableChat {
  const { dataRoot, planner, courseId, unitId } = options;
  const now = options.now ?? (() => new Date());
  const order = options.order ?? randomOrder;
  const log = createTranscribedLog({ dataRoot, courseId, unitId, now });
  const exclusive = createSerial();
  let running: Running | undefined;
  /** The agents of the last load, so closing the chat closes them while it loads too. */
  let agents: UnitAgents | undefined;
  let loading: Promise<void> | undefined;
  let failed = false;
  /** Shutdown leaves unjudged replies and their waiting answer for reopening. */
  let closing = false;
  /** A Stop cancels automatic next-question turns, including ones still queued. */
  let stopCount = 0;
  /** The course's workspace, where the tutor works and packages go. */
  let folder: string | undefined;
  /** The install that runs, by its request's id; `settled` waits for it. */
  let install: { requestId: string; done: Promise<void> } | undefined;
  /** The install ran, but its result still needs to be written to state.json. */
  let pendingInstall: PackageCompletion | undefined;
  /** The code questions whose kept answer's tests have run past their limit once. */
  const timedOut = new Set<string>();
  const code = options.codeRunner ?? noCodeRunner;
  let codePosting:
    | { stop: AbortController; done: Promise<unknown> }
    | undefined;

  // --- Opening ---------------------------------------------------------------

  async function load(): Promise<void> {
    try {
      // The earlier sessions' thread first, then this session's.
      await log.open();
      const stored = await dataRoot.readCourse(courseId);
      const units = stored?.curriculum?.units ?? [];
      const storedUnit = units.find((u) => u.id === unitId);
      if (stored === undefined || storedUnit === undefined) {
        throw new Error(`There is no unit "${unitId}" in "${courseId}".`);
      }
      if (storedUnit.plan === undefined) log.emit({ type: "unit_planning" });
      const planned = await planner.plan(courseId, unitId);
      if (!planned.ok) throw new Error(planned.error);
      const { plan } = planned;
      log.emit({ type: "unit_plan", plan });

      const record = await openUnitRecord({
        dataRoot,
        courseId,
        unit: { ...storedUnit, plan },
        plan,
        emit: log.emit,
        packagePreview,
        now,
        ...(options.backup === undefined ? {} : { backup: options.backup }),
      });
      const context: UnitContext = {
        courseTitle: stored.course.title,
        units,
        unitId,
        plan,
      };
      const notes = {
        style: await dataRoot.readStyle(courseId),
        background: await dataRoot.readBackground(courseId),
      };
      folder = await dataRoot.workspaceFolder(courseId);
      const loaded = createUnitAgents({
        backend: options.backend,
        systemPrompt: tutorSystemPrompt(options.systemPrompt, context, notes),
        tools: [
          askQuestionTool(questionBoard),
          showArtifactTool(artifactShelf),
          ...(options.installer === undefined
            ? []
            : [installPackagesTool(packageDesk)]),
        ],
        cwd: folder,
        ...(options.workspaceTools === true
          ? { workspace: options.workspace.tools }
          : {}),
        title: `Gauss: ${stored.course.title}, ${storedUnit.title}`,
        keep: (id) => exclusive(() => record.keepSession(id)),
        // Only a turn calls it, once `r` is set.
        lost: (learnerId) => fallBack(r, learnerId),
        judge: options.judge,
        log,
        exclusive,
        ...(options.timer === undefined ? {} : { timer: options.timer }),
      });
      agents = loaded;
      const r: Running = { context, record, agents: loaded, notes: [] };
      if (record.reopened) {
        // A unit under way resumes its tutor's conversation with its first
        // turn. One that cannot be found, or was never kept, gives way to a
        // new session at once, so the thread says so before anything else.
        const id = record.position.tutorSessionId;
        const resumes = id !== undefined && (await loaded.resume(id));
        if (!resumes) fallBack(r);
      }
      running = r;
      restoreGrades(record);
      restoreDisputes(r);
      restorePackages(record.packageCompletions);
      log.emit(record.status());
      if (record.finished !== undefined) {
        log.emit({ type: "unit_closed", status: record.finished });
        return;
      }
      const { position } = record;
      log.emit(phaseEvent(position));
      // A request waits on the learner, as an open question does.
      if (position.packageRequest !== undefined) {
        log.emit(requestedEvent(position.packageRequest));
      }
      // A detour waits on the learner, as an open question does.
      if (position.detour !== undefined) log.emit(detourEvent(position.detour));
      const open = position.openQuestion;
      if (open !== undefined) {
        log.emit({ type: "question", question: view(open, folder) });
        await exclusive(async () => {
          if (record.recordedAnswer(open.id) !== undefined) {
            // A restart came between recording the answer and closing its
            // question: the question is closed with the answer recorded, as
            // recording it would have gone on to do.
            const answered = await record.closeAnswered();
            if (answered !== undefined) tellGrade(r, answered);
          } else if (open.judging !== undefined) {
            // The replies a restart kept from the judge cannot be judged
            // now, so they count as help (task 2.21), and an answer kept
            // for them is graded.
            const { judging, number } = open;
            await settleJudging(r, open, judging, "help", () => {
              for (const learnerId of judging) {
                log.emit({
                  type: "judged",
                  learnerId,
                  number,
                  verdict: "help",
                  unjudged: "restart",
                });
              }
            });
          } else if (open.answer !== undefined) {
            // An answer that a restart kept from its grade is graded now,
            // as a teaching turn a restart cut off is taught again.
            await grade(r, open, open.answer);
          }
        });
      }
      if (position.phase === "teach") {
        // A teaching turn that a restart cut off is sent again.
        sendTeaching(r, record.reopened);
      } else if (
        position.phase === "check" &&
        open === undefined &&
        checkDone(r)
      ) {
        // A restart came between the check's last answer and the end of the
        // feedback on it, which closes the segment.
        await exclusive(() => closeSegment(r));
      } else if (position.phase === "closed" && isLastSegment(plan, position)) {
        // The closing card was waiting on the learner, or a restart came
        // between closing the last segment and closing the unit.
        await exclusive(() => endUnit(r));
      }
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
    }
  }

  /**
   * The tutor's conversation could not be resumed: a new session takes over,
   * told in its first header that it is new, and the thread says so.
   */
  function fallBack(r: Running, learnerId?: string): void {
    if (!r.notes.includes(JOINED_NOTE)) r.notes.push(JOINED_NOTE);
    log.emit({
      type: "fresh_start",
      reason: "not-resumed",
      ...(learnerId === undefined ? {} : { learnerId }),
    });
  }

  /**
   * Shows the grade of each question that the earlier sessions' thread left
   * open and the evidence has the answer to. Its `graded` line was lost
   * after the answer was recorded: the machine stopped, or the line could
   * not be written. The question still open is closed by `load`.
   */
  function restoreGrades(record: UnitRecord): void {
    const posted = new Set<string>();
    const graded = new Set<string>();
    for (const event of log.events()) {
      if (event.type === "question") posted.add(event.question.id);
      else if (event.type === "graded") graded.add(event.questionId);
    }
    const open = record.position.openQuestion?.id;
    for (const id of posted) {
      if (id === open || graded.has(id)) continue;
      const entry = record.recordedAnswer(id);
      if (entry !== undefined) log.emit(gradedEvent(entry));
    }
  }

  /**
   * Shows the outcome of each dispute of the unit's answers that the earlier
   * sessions' thread does not: one raised from "What I know" while the chat
   * was not open, or whose line was lost. In a unit in progress, the tutor
   * is told it in its next header.
   */
  function restoreDisputes(r: Running): void {
    const shown = new Set<string>();
    for (const event of log.events()) {
      if (event.type === "disputed") shown.add(event.questionId);
    }
    for (const entry of r.record.evidence) {
      if (entry.kind !== "dispute" || shown.has(entry.questionId)) continue;
      if (r.record.disputeOf(entry.questionId) !== entry) continue;
      shown.add(entry.questionId);
      log.emit(disputedEvent(entry));
      tellDispute(r, entry);
    }
  }

  /** Tells the tutor of a unit in progress the outcome, in its next header. */
  function tellDispute(r: Running, entry: DisputeEvidence): void {
    const answered = r.record.recordedAnswer(entry.questionId);
    if (r.record.finished === undefined && answered !== undefined) {
      r.notes.push(disputeNote(answered, entry));
    }
  }

  /**
   * After a dispute's outcome is kept: the tutor is told, and the check rules
   * decide with the corrected verdict where nothing else is waiting for
   * them. A check with no question open, no detour and no feedback to come
   * closes if nothing is left to ask; at the unit's end, the closing card is
   * shown again with the statuses as they are now, and the unit finishes if
   * every objective has passed. A detour stays open until the learner asks
   * for another question. Runs inside `exclusive`.
   */
  async function disputeKept(
    r: Running,
    entry: DisputeEvidence,
  ): Promise<void> {
    tellDispute(r, entry);
    const { position, finished } = r.record;
    if (finished !== undefined) return;
    if (
      position.phase === "check" &&
      position.openQuestion === undefined &&
      position.detour === undefined &&
      r.feedback === undefined &&
      checkDone(r)
    ) {
      await closeSegment(r);
    } else if (
      position.phase === "closed" &&
      isLastSegment(r.context.plan, position)
    ) {
      await endUnit(r);
    }
  }

  /** Replays a completed card if the transcript did not keep it or its outcome. */
  function restorePackages(completions: readonly PackageCompletion[]): void {
    if (completions.length === 0) return;
    const shown = new Map<
      string,
      Extract<PageEvent, { type: "packages_answered" }> | undefined
    >();
    for (const event of log.events()) {
      if (event.type === "packages_requested" && !shown.has(event.requestId)) {
        shown.set(event.requestId, undefined);
      } else if (
        event.type === "packages_answered" &&
        shown.has(event.requestId)
      ) {
        shown.set(event.requestId, event);
      }
    }
    for (const completion of completions) {
      const { request, preview, outcome, output } = completion;
      const was = shown.get(request.id);
      if (!shown.has(request.id)) log.emit(requestedEvent(request, preview));
      if (
        was === undefined ||
        was.outcome !== outcome ||
        was.output !== output
      ) {
        log.emit(packagesAnsweredEvent(completion));
      }
    }
  }

  // --- Turns -----------------------------------------------------------------

  /** Where the unit stands now, with the notes not yet given, which this takes. */
  function where(r: Running): Where {
    const notes = r.notes;
    r.notes = [];
    const { record } = r;
    return {
      context: r.context,
      position: record.position,
      checks: checks(r),
      notPassed: notPassed(r.context.plan, record.evidence),
      ...(record.finished === undefined ? {} : { finished: record.finished }),
      ...(r.feedback !== undefined && !r.feedback.started
        ? { feedbackPending: r.feedback.number }
        : {}),
      notes,
    };
  }

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
    r.agents.send({
      text: () => teachTurn(where(r), cutOff),
      // The end of the teaching turn, or Stop during it, opens the
      // discussion, whatever the outcome: after an error the learner can
      // ask for what was missed.
      ended: () =>
        exclusive(async () => {
          const { position } = r.record;
          if (position.segment === segment && position.phase === "teach") {
            await r.record.move({ ...position, phase: "discuss" });
          }
        }),
    });
  }

  /**
   * Sends the tutor the grade of the answer its question was closed with,
   * in a turn for feedback only: no tool may be called in it (task 2.16a).
   * Given the next question to plan in the same reply, the tutor wrote its
   * feedback in its thinking, which the learner never sees (task 2.16).
   * When the turn ends, the segment closes if the check is done; otherwise,
   * unless the learner stopped it, the next question is asked for. After a
   * miss the turn opens the detour the miss opened (task 2.20), and nothing
   * follows it: the learner asks for the next question. A Stop after
   * `stops` cancels that next question.
   */
  function tellGrade(
    r: Running,
    { question, entry }: Answered,
    stops = stopCount,
  ): void {
    const { number } = question;
    const feedback = { number, started: false };
    r.feedback = feedback;
    r.agents.send({
      text: () => {
        feedback.started = true;
        return answerTurn(where(r), entry, number);
      },
      ended: (outcome) =>
        exclusive(async () => {
          r.feedback = undefined;
          if (!nextAfter(r, number)) return;
          if (checkDone(r)) await closeSegment(r);
          else if (
            outcome !== "interrupted" &&
            r.record.position.detour === undefined
          ) {
            askNext(r, number, stops);
          }
        }),
    });
  }

  /**
   * Whether the check still waits for what follows question `number`: no
   * question has been posted since it was answered.
   */
  function nextAfter(r: Running, number: number): boolean {
    const { position, checkAnswers, finished } = r.record;
    return (
      finished === undefined &&
      position.phase === "check" &&
      position.openQuestion === undefined &&
      checkAnswers.length === number
    );
  }

  /**
   * Asks the tutor for the check's next question, after feedback on question
   * `number` or the learner ending its detour. Skipped if an intervening
   * reply has posted one, even if already answered, or the learner pressed
   * Stop since the feedback or detour-ending action began.
   */
  function askNext(
    r: Running,
    number: number,
    stops: number,
    after: "feedback" | "detour" = "feedback",
  ): void {
    r.agents.send({
      skip: () => stopCount !== stops || !nextAfter(r, number),
      text: () => nextQuestionTurn(where(r), number, after),
    });
  }

  /** Continues the same check after another unit's workspace install. */
  function retryAfterInstall(
    r: Running,
    check: UnitPosition,
    number: number,
    stopped: () => boolean,
  ): void {
    const skip = () =>
      closing ||
      stopped() ||
      !nextAfter(r, number) ||
      r.record.position.segment !== check.segment ||
      r.record.position.checkFrom !== check.checkFrom ||
      r.record.position.detour !== undefined ||
      r.feedback !== undefined;
    if (skip()) return;
    r.agents.send({ skip, text: () => workspaceReadyTurn(where(r)) });
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
    if (isLastSegment(r.context.plan, r.record.position)) await endUnit(r);
  }

  /**
   * Records the graded answer to the open question, closes the question, and
   * sends the grade to the tutor. Runs inside `exclusive`.
   */
  async function recordAnswer(
    r: Running,
    submission: AnswerSubmission,
    grade: Grade,
    stops?: number,
  ): Promise<void> {
    tellGrade(r, await r.record.answer(submission, grade), stops);
  }

  /**
   * Grades an answer to the open question once no reply during it waits
   * for the judge: a written, math or code one outside the queue, kept in
   * state.json first, and any other at once. Runs inside `exclusive`.
   */
  async function grade(
    r: Running,
    open: OpenQuestion,
    answer: AnswerSubmission,
    stops?: number,
  ): Promise<void> {
    const { question } = open;
    if (
      answer.kind === "written" ||
      answer.kind === "math" ||
      answer.kind === "code"
    ) {
      // Kept before it is graded, so a restart does not lose it.
      const kept: OpenQuestion = { ...open, answer };
      if (open.answer === undefined) {
        await r.record.move({ ...r.record.position, openQuestion: kept });
      }
      startGrading(r, kept, answer, stops);
      return;
    }
    await recordAnswer(
      r,
      answer,
      {
        verdict:
          question.kind === "choice"
            ? gradeChoice(question.answer, answer)
            : "unknown",
      },
      stops,
    );
  }

  /**
   * The learner's files of a code question as they are now, read from the
   * workspace, or why the tests cannot be run on them.
   */
  async function readFiles(
    paths: readonly string[],
  ): Promise<CodeFile[] | string> {
    if (folder === undefined) return "The unit is not open.";
    try {
      const read = await readWorkspaceFiles(folder, paths);
      if ("files" in read) return read.files;
      return (
        `${fileProblem(read)} Nothing was run or recorded: put it right ` +
        `at ${join(folder, read.path)} and run the tests again, or answer "I don't know".`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return `Your files could not be read: ${message}`;
    }
  }

  // --- Help (task 2.21) ------------------------------------------------------

  /**
   * The tutor's reply to the learner's message `learnerId`, received while
   * the question `questionId` was open, has ended: it is judged, unless the
   * question has been withdrawn since. A reply with no text gave the learner
   * nothing, so it is not judged and is no help. Runs inside `exclusive`.
   */
  async function replyEnded(
    r: Running,
    exchange: { learnerId: string; questionId: string; message: string },
    reply: string,
  ): Promise<void> {
    if (closing) return;
    const { learnerId, questionId, message } = exchange;
    const open = r.record.position.openQuestion;
    if (open?.id !== questionId || !open.judging?.includes(learnerId)) return;
    if (reply.trim() === "") {
      await settleJudging(r, open, [learnerId], "clarification");
      return;
    }
    const { number, question } = open;
    r.agents.judge({
      learnerId,
      number,
      question,
      message,
      reply,
      record: (outcome) => judged(r, questionId, learnerId, number, outcome),
    });
  }

  /**
   * Records the judge's call on a reply, and tells the page. A failed call
   * counts as help. A question withdrawn since keeps nothing of it. Runs
   * inside `exclusive`.
   */
  async function judged(
    r: Running,
    questionId: string,
    learnerId: string,
    number: number,
    outcome: HelpOutcome,
  ): Promise<void> {
    if (!outcome.ok) {
      console.error(
        "A reply could not be judged, so it counts as help:",
        outcome.error,
      );
    }
    const verdict = outcome.ok ? outcome.verdict : "help";
    const tell = () =>
      log.emit({
        type: "judged",
        learnerId,
        number,
        verdict,
        ...(outcome.ok ? {} : { unjudged: "failed" as const }),
      });
    const open = r.record.position.openQuestion;
    if (open?.id !== questionId || !open.judging?.includes(learnerId)) {
      tell();
      return;
    }
    await settleJudging(r, open, [learnerId], verdict, tell);
  }

  /**
   * Takes these replies out of those the open question waits on, with
   * their verdict, and once none is left grades the answer kept for them.
   * Runs inside `exclusive`.
   */
  async function settleJudging(
    r: Running,
    open: OpenQuestion,
    learnerIds: readonly string[],
    verdict: "clarification" | "help",
    tell?: () => void,
  ): Promise<void> {
    const judging = (open.judging ?? []).filter(
      (id) => !learnerIds.includes(id),
    );
    const { judging: _, ...rest } = open;
    const next: OpenQuestion = {
      ...rest,
      ...(verdict === "help" ? { assisted: true } : {}),
      ...(judging.length > 0 ? { judging } : {}),
    };
    await r.record.move({ ...r.record.position, openQuestion: next }, tell);
    if (judging.length === 0 && next.answer !== undefined) {
      const stops = r.answerStops;
      r.answerStops = undefined;
      await grade(r, next, next.answer, stops);
    }
  }

  /**
   * Grades the open question's kept written, math or code answer. The
   * grading runs outside `exclusive`, so the chat goes on while it works;
   * its grade is recorded inside, if the question is still open.
   */
  function startGrading(
    r: Running,
    open: OpenQuestion,
    answer: GradedAnswer,
    stops?: number,
  ): void {
    const { question } = open;
    const { grader } = options;
    const check = options.mathCheck ?? noMathCheck;
    let run: Grading["run"];
    if (answer.kind === "written" && question.kind === "written") {
      run = (signal) => grader.grade(question, answer.text, signal);
    } else if (answer.kind === "math" && question.kind === "math") {
      run = (signal) => gradeMath(question, answer, { check, grader }, signal);
    } else if (answer.kind === "code" && question.kind === "code") {
      const workspace = folder;
      if (workspace === undefined) throw new Error("The unit is not open.");
      run = async (signal) => {
        const graded = await gradeCode(
          code,
          question,
          answer,
          workspace,
          signal,
        );
        if (graded.ok) return graded;
        if (graded.timedOut === undefined) {
          return { ok: false, error: graded.error, canMoveOn: true };
        }
        // Past the limit a second time on the same files: the code, not a
        // slow moment, kept the tests from ending, so it is a miss.
        if (timedOut.has(open.id)) {
          return {
            ok: true,
            verdict: "incorrect",
            output: graded.timedOut.output,
          };
        }
        timedOut.add(open.id);
        return {
          ok: false,
          error: `${graded.error} Run them again; if they run past it again, the answer is graded as a miss.`,
        };
      };
    } else {
      // The answer's kind is its question's: `answer` and the schema check it.
      throw new Error("The answer is not of its question's kind.");
    }
    r.agents.grade({
      questionId: open.id,
      answer,
      run,
      applies: () =>
        r.record.position.openQuestion?.id === open.id &&
        r.record.finished === undefined,
      record: (grade: Grade) => recordAnswer(r, answer, grade, stops),
    });
  }

  /**
   * The last segment has closed: shows the closing card, and closes the unit
   * at once if every objective passed. Runs inside `exclusive`.
   */
  async function endUnit(r: Running): Promise<void> {
    const passed = notPassed(r.context.plan, r.record.evidence).length === 0;
    log.emit({
      type: "unit_end",
      passed,
      objectives: r.record.objectiveStatuses(),
    });
    if (passed) await r.record.finish("passed");
  }

  function segmentObjectives(r: Running): readonly string[] {
    return segmentOf(r.context.plan, r.record.position).objectives;
  }

  // --- The teaching tools ----------------------------------------------------

  const questionBoard = {
    post(question: QuestionInput) {
      const stops = stopCount;
      const stopped = () => closing || stopCount !== stops;
      return exclusive(
        async (): Promise<
          | { id: string; number: number; question: Question }
          | { refused: string }
        > => {
          const r = running;
          if (stopped()) return QUESTION_STOPPED;
          if (r === undefined) return { refused: "The unit is not open." };
          if (r.record.finished !== undefined) {
            return { refused: UNIT_FINISHED };
          }
          const { position } = r.record;
          if (position.detour !== undefined) {
            return { refused: inDetour(position.detour.number) };
          }
          if (r.feedback !== undefined) {
            const { number, started } = r.feedback;
            return {
              refused: started ? feedbackOnly(number) : feedbackPending(number),
            };
          }
          if (position.phase !== "check") {
            return { refused: outOfPhase(position.phase) };
          }
          if (position.openQuestion !== undefined) {
            const { number, answer } = position.openQuestion;
            return {
              refused:
                answer === undefined
                  ? `Question ${number} is still open. End your turn and wait for the learner's answer.`
                  : `Question ${number} is answered and its answer is being graded. End your turn; the grade arrives in a message of its own.`,
            };
          }
          const objectives = segmentObjectives(r);
          if (!objectives.includes(question.objective)) {
            return {
              refused: `"${question.objective}" is not an objective of this segment. Name one of ${quoted(objectives)}.`,
            };
          }
          const standing = checks(r);
          const check = standing.get(question.objective);
          if (check?.state === "done") {
            const open = objectives.filter(
              (id) => standing.get(id)?.state !== "done",
            );
            return {
              refused:
                `"${question.objective}" needs no more questions in this check: ${checkText(check)}. ` +
                (open.length > 0
                  ? `Ask about ${quoted(open)} instead.`
                  : "Every objective is done, and the segment is closing: no more questions."),
            };
          }
          const posted = postedQuestion(question);
          const workspace = folder;
          if (workspace === undefined)
            return { refused: "The unit is not open." };
          if (posted.kind === "math") {
            // Read before it is posted, so that every answer is compared
            // with an expression the check can read.
            const unread = await (options.mathCheck ?? noMathCheck).read(
              posted.expected,
            );
            if (unread !== undefined) return unread;
          }
          const since = r.record.checkAnswers.length;
          return options.workspace.post(
            {
              unitId,
              stopped,
              retry: () => retryAfterInstall(r, position, since, stopped),
            },
            async () => {
              let checked = posted;
              if (posted.kind === "code") {
                // Hold the course queue until both runs and their cleanup finish.
                const stop = new AbortController();
                const done = code.check(
                  posted,
                  workspace,
                  question.dependencies ?? [],
                  stop.signal,
                );
                codePosting = { stop, done };
                try {
                  const result = await done;
                  if (stopped()) return QUESTION_STOPPED;
                  if ("refused" in result) return result;
                  checked = result.question;
                } finally {
                  codePosting = undefined;
                }
              }
              const open: OpenQuestion = {
                id: randomUUID(),
                number: since + 1,
                objective: question.objective,
                postedAt: now().toISOString(),
                // Shown and stored in the engine's order (task 2.17).
                question:
                  checked.kind === "choice"
                    ? reorder(checked, order(checked.choices.length))
                    : checked,
              };
              await r.record.move({ ...position, openQuestion: open });
              log.emit({ type: "question", question: view(open, workspace) });
              return {
                id: open.id,
                number: open.number,
                question: open.question,
              };
            },
          );
        },
      );
    },
  };

  // Not while a question of the unit is open, answered or not: an aid could
  // help with the answer, and the help judge reads only the tutor's text.
  const artifactShelf: ArtifactShelf = {
    show: (artifact) =>
      exclusive(async () => {
        const r = running;
        if (r === undefined) return { refused: "The unit is not open." };
        if (r.record.finished !== undefined) return { refused: UNIT_FINISHED };
        const open = r.record.position.openQuestion;
        if (open !== undefined) {
          return {
            refused:
              `Question ${open.number} is open: nothing can be shown beside ` +
              "the conversation until its answer is graded, since an aid " +
              "could help with the answer.",
          };
        }
        const stored = await dataRoot.writeArtifact(courseId, artifact);
        log.emit({
          type: "artifact",
          file: stored.file,
          title: artifact.title,
        });
        return stored;
      }),
  };

  // Not while a question of the course is open: the install closes the
  // workspace, which an open question has closed already.
  const packageDesk: PackageDesk = {
    request: (packages) =>
      exclusive(async () => {
        const r = running;
        if (r === undefined) return { refused: "The unit is not open." };
        if (r.record.finished !== undefined) {
          return { refused: UNIT_FINISHED };
        }
        return options.workspace.request(async () => {
          const request: PackageRequest = {
            id: randomUUID(),
            packages: [...packages],
            requestedAt: now().toISOString(),
          };
          await r.record.keepPackageRequest(request, () =>
            log.emit(requestedEvent(request)),
          );
          return { requested: true as const };
        });
      }),
  };

  function packagePreview(
    request: PackageRequest,
  ): PackageCompletion["preview"] {
    return {
      commands:
        options.installer?.commands(folder ?? "", request.packages) ?? [],
      folder: folder ?? "",
    };
  }

  /** The card that presents a package request. */
  function requestedEvent(
    request: PackageRequest,
    preview = packagePreview(request),
  ): PageEvent {
    return {
      type: "packages_requested",
      requestId: request.id,
      packages: request.packages,
      ...preview,
    };
  }

  /** The request that waits, if it is this one, or why not. */
  function waitingRequest(
    r: Running,
    requestId: string,
  ): PackageRequest | string {
    const request = r.record.position.packageRequest;
    if (request === undefined || request.id !== requestId) {
      return "That request to install packages is not waiting.";
    }
    if (install?.requestId === requestId) {
      return "The packages are being installed.";
    }
    return request;
  }

  /**
   * Saves the outcome before the page sees it. The note goes in the next
   * turn's header, with a turn of its own only if no question is open
   * and something else has not delivered it first. Runs inside `exclusive`.
   */
  async function answerRequest(
    r: Running,
    completion: PackageCompletion,
  ): Promise<void> {
    const saved = await r.record.completePackageRequest(completion);
    if (!saved || r.record.finished !== undefined) return;
    const { request, outcome, output } = completion;
    const note = packagesNote(outcome, request.packages, output);
    r.notes.push(note);
    if (r.record.position.openQuestion !== undefined) return;
    r.agents.send({
      skip: () =>
        r.record.finished !== undefined ||
        r.record.position.openQuestion !== undefined ||
        !r.notes.includes(note),
      text: () => packagesTurn(where(r)),
    });
  }

  /** A retry writes the result of the original command; it never runs it again. */
  async function recordInstall(
    r: Running,
    completion: PackageCompletion,
  ): Promise<ChatResult> {
    try {
      await answerRequest(r, completion);
    } catch (error) {
      pendingInstall = completion;
      console.error("An install could not be recorded:", error);
      if (r.record.finished === undefined) {
        // Re-enable the card's controls after the background write failed.
        log.emit(requestedEvent(completion.request, completion.preview));
      }
      return refused(
        "The install finished, but its result could not be saved. Try again to save it without running the install again.",
      );
    }
    pendingInstall = undefined;
    return { ok: true };
  }

  /** Installs the request's packages outside the chat's queue. */
  function runInstall(
    r: Running,
    request: PackageRequest,
    installer: PackageInstaller,
    workspace: string,
    claim: { done(): void },
  ): Promise<void> {
    const preview = packagePreview(request);
    return (async () => {
      let result: InstallResult;
      try {
        result = await installer.install(workspace, request.packages);
      } finally {
        claim.done();
      }
      await exclusive(async () => {
        try {
          await recordInstall(r, {
            request,
            preview,
            outcome: result.ok ? "installed" : "failed",
            output: result.output,
          });
        } finally {
          install = undefined;
        }
      });
    })().catch((error: unknown) => {
      install = undefined;
      console.error("An install could not be recorded:", error);
    });
  }

  // --- What the learner does -------------------------------------------------

  /** Runs the action once the unit is open and the tutor is not writing. */
  function act(
    work: (r: Running) => Promise<ChatResult>,
    { whileWriting = false } = {},
  ): Promise<ChatResult> {
    return exclusive(async () => {
      const r = running;
      if (r === undefined) return notOpen();
      if (r.record.finished !== undefined) return refused(UNIT_FINISHED);
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

  /** At the unit's end with objectives not passed: those objectives, or why not. */
  function atUnitEnd(r: Running): string[] | string {
    const { position, evidence } = r.record;
    if (
      position.phase !== "closed" ||
      !isLastSegment(r.context.plan, position)
    ) {
      return "The unit has not reached its end.";
    }
    const rest = notPassed(r.context.plan, evidence);
    return rest.length > 0 ? rest : "Every objective has passed.";
  }

  const chat: OpenableChat = {
    id: log.id,
    events: log.events,
    subscribe: log.subscribe,

    open() {
      if (running !== undefined) return;
      if (loading !== undefined && !failed) return;
      failed = false;
      loading = load();
    },

    say(text) {
      const r = running;
      if (r === undefined) return notOpen();
      const id = randomUUID();
      log.emit({ type: "learner", id, text });
      /** Set if the tutor received the message while a question waited for its answer. */
      let exchange:
        | { learnerId: string; questionId: string; message: string }
        | undefined;
      r.agents.send({
        learnerId: id,
        // Help is judged on what the tutor received while a question was
        // open (task 2.21), so the exchange begins when the message is sent
        // to the tutor, not when the learner wrote it, and is kept in
        // state.json until the judge's call on the reply. Once an answer is
        // sent, it is final, and help no longer applies.
        text: () =>
          exclusive(async () => {
            const { position } = r.record;
            const open = position.openQuestion;
            if (open !== undefined && open.answer === undefined) {
              await r.record.move({
                ...position,
                openQuestion: {
                  ...open,
                  judging: [...(open.judging ?? []), id],
                },
              });
              exchange = { learnerId: id, questionId: open.id, message: text };
            }
            return messageTurn(where(r), text);
          }),
        ended: (_, reply) => {
          const asked = exchange;
          if (asked === undefined) return;
          return exclusive(() => replyEnded(r, asked, reply));
        },
      });
      return { ok: true };
    },

    ready: () =>
      act(async (r) => {
        const { phase } = r.record.position;
        if (phase !== "discuss") return refused(NOT_NOW.ready[phase]);
        await r.record.startCheck();
        r.agents.send({ text: () => readyTurn(where(r)) });
        return { ok: true };
      }),

    anotherQuestion: () =>
      act(async (r) => {
        const { detour } = r.record.position;
        if (detour === undefined) {
          return refused("No detour is open, so there is nothing to end.");
        }
        const stops = stopCount;
        await r.record.endDetour();
        // A dispute during the detour can have left nothing to ask.
        if (checkDone(r)) await closeSegment(r);
        else askNext(r, detour.number, stops, "detour");
        return { ok: true };
      }),

    answer: (sent) =>
      // An answer is taken while the tutor replies to a message.
      act(
        async (r) => {
          const open = r.record.position.openQuestion;
          if (open === undefined) return refused("No question is open.");
          if (sent.questionId !== open.id) {
            return refused(
              `That question is not open; question ${open.number} is.`,
            );
          }
          if (open.answer !== undefined) {
            return refused(
              open.judging !== undefined
                ? WAITS_FOR_JUDGE
                : r.agents.grading()
                  ? "Your answer to this question is being graded."
                  : "Your answer to this question is kept and waits to be graded again.",
            );
          }
          const { question } = open;
          if (sent.kind !== "unknown" && sent.kind !== question.kind) {
            return {
              ok: false,
              status: 400,
              error:
                question.kind === "choice"
                  ? `Question ${open.number} is answered with one of its choices.`
                  : question.kind === "math"
                    ? `Question ${open.number} is answered with an expression.`
                    : question.kind === "code"
                      ? `Question ${open.number} is answered by running the tests on your files.`
                      : `Question ${open.number} is answered in writing.`,
            };
          }
          let submission: AnswerSubmission;
          if (sent.kind !== "code") {
            submission = sent;
          } else {
            if (question.kind !== "code")
              throw new Error("Expected a code question.");
            const unavailable =
              code.unavailable ??
              (question.inputs === undefined
                ? "This question predates saved exercise inputs."
                : undefined);
            if (unavailable !== undefined) {
              return refused(
                `${unavailable} Nothing was run or recorded. Move on without the check.`,
              );
            }
            // The files as they are now are the answer, final once sent.
            const read = await readFiles(question.files);
            if (typeof read === "string") return refused(read);
            submission = { ...sent, files: read };
          }
          if (
            submission.kind === "choice" &&
            question.kind === "choice" &&
            CHOICE_LETTERS.indexOf(submission.choice) >= question.choices.length
          ) {
            return {
              ok: false,
              status: 400,
              error: `Question ${open.number} has no choice ${submission.choice}.`,
            };
          }
          if (open.judging !== undefined) {
            // Replies during the question still wait for the judge, whose
            // calls say whether the answer had help (task 2.21): the answer
            // waits for them, kept so a restart does not lose it.
            r.answerStops = stopCount;
            await r.record.move(
              {
                ...r.record.position,
                openQuestion: { ...open, answer: submission },
              },
              () =>
                log.emit({
                  type: "answer_waiting",
                  questionId: open.id,
                  answer: submission,
                }),
            );
            return { ok: true };
          }
          await grade(r, open, submission);
          return { ok: true };
        },
        { whileWriting: true },
      ),

    gradeAgain: () =>
      act(
        async (r) => {
          const open = r.record.position.openQuestion;
          const kept = open?.answer;
          if (
            open === undefined ||
            (kept?.kind !== "written" &&
              kept?.kind !== "math" &&
              kept?.kind !== "code")
          ) {
            return refused("No answer is waiting to be graded again.");
          }
          if (open.judging !== undefined) return refused(WAITS_FOR_JUDGE);
          if (r.agents.grading()) {
            return refused("The answer is being graded.");
          }
          startGrading(r, open, kept);
          return { ok: true };
        },
        { whileWriting: true },
      ),

    installPackages: (requestId) =>
      act(async (r) => {
        const request = waitingRequest(r, requestId);
        if (typeof request === "string") return refused(request);
        if (pendingInstall?.request.id === requestId) {
          return recordInstall(r, pendingInstall);
        }
        const { installer } = options;
        if (installer === undefined || folder === undefined) {
          return refused(
            "Packages cannot be installed: the sandbox does not run.",
          );
        }
        const claim = await options.workspace.beginInstall(unitId);
        if ("refused" in claim) return refused(claim.refused);
        log.emit({ type: "packages_installing", requestId });
        install = {
          requestId,
          done: runInstall(r, request, installer, folder, claim),
        };
        return { ok: true };
      }),

    declinePackages: (requestId) =>
      act(
        async (r) => {
          const request = waitingRequest(r, requestId);
          if (typeof request === "string") return refused(request);
          if (pendingInstall?.request.id === requestId) {
            return recordInstall(r, pendingInstall);
          }
          await answerRequest(r, {
            request,
            preview: packagePreview(request),
            outcome: "declined",
          });
          return { ok: true };
        },
        { whileWriting: true },
      ),

    override: () =>
      act(async (r) => {
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
        const { objectives, withdrawn } = await r.record.overrideSegment();
        // Told with the next turn, so moving on costs no reply.
        r.notes.push(overrideNote(objectives, withdrawn?.number));
        if (isLastSegment(r.context.plan, r.record.position)) await endUnit(r);
        return { ok: true };
      }),

    nextSegment: () =>
      act(async (r) => {
        const { phase, segment } = r.record.position;
        if (phase !== "closed") return refused(NOT_NOW.next[phase]);
        if (isLastSegment(r.context.plan, r.record.position)) {
          return refused(
            "This was the unit's last segment: go over the objectives not passed again, or move on without them.",
          );
        }
        await r.record.move({ segment: segment + 1, phase: "teach" });
        sendTeaching(r, false);
        return { ok: true };
      }),

    goOverAgain: () =>
      act(async (r) => {
        const again = atUnitEnd(r);
        if (typeof again === "string") return refused(again);
        await r.record.move({
          segment: r.context.plan.segments.length,
          phase: "teach",
          again,
        });
        sendTeaching(r, false);
        return { ok: true };
      }),

    finishUnit: () =>
      act(async (r) => {
        const objectives = atUnitEnd(r);
        if (typeof objectives === "string") return refused(objectives);
        await r.record.finish("overridden", objectives);
        return { ok: true };
      }),

    startFresh() {
      return act(async (r) => {
        // Taken out first, so a restart before the new session starts does
        // not resume the old one.
        await r.record.keepSession(undefined);
        r.agents.startFresh();
        if (!r.notes.includes(JOINED_NOTE)) r.notes.push(JOINED_NOTE);
        log.emit({ type: "fresh_start", reason: "learner" });
        r.agents.send({ text: () => freshTurn(where(r)) });
        return { ok: true };
      });
    },

    async interrupt() {
      stopCount += 1;
      codePosting?.stop.abort();
      await running?.agents.interrupt();
    },
    async recordDispute(entry) {
      await loading;
      return exclusive(async () => {
        const r = running;
        if (r === undefined) return false;
        await r.record.dispute(entry);
        await disputeKept(r, entry);
        return true;
      });
    },
    async learnDispute(entry, override) {
      await loading;
      await exclusive(async () => {
        const r = running;
        if (r === undefined) return;
        if (r.record.learnDispute(entry, override)) await disputeKept(r, entry);
      });
    },
    async settled() {
      await loading;
      await install?.done;
      await running?.agents.settled();
      await log.flushed();
    },
    async close() {
      closing = true;
      const posting = codePosting;
      posting?.stop.abort();
      await Promise.all([agents?.close(), posting?.done]);
      // An install under way is not waited for: it stops with the server,
      // and its request still waits when the unit opens again.
      await log.flushed();
    },
  };
  return chat;
}

const UNIT_FINISHED = "The unit is finished.";
const QUESTION_STOPPED = { refused: "Stop canceled posting this question." };

/** An answer kept while the tutor's replies during its question are judged (task 2.21). */
const WAITS_FOR_JUDGE =
  "Your answer to this question is kept, and is graded once the tutor's replies while it was open have been judged.";

/**
 * The question as the page sees it: never its grading material. A code
 * question's files are named by their full paths in the workspace.
 */
function view(open: OpenQuestion, workspace: string | undefined): QuestionView {
  const { id, number, question } = open;
  const { prompt } = question;
  switch (question.kind) {
    case "choice":
      return { kind: "choice", id, number, prompt, choices: question.choices };
    case "code":
      return {
        kind: "code",
        id,
        number,
        prompt,
        files: question.files.map((path) => join(workspace ?? "", path)),
      };
    default:
      return { kind: question.kind, id, number, prompt };
  }
}

function refused(error: string): ChatResult {
  return { ok: false, status: 409, error };
}

/** Why ask_question is refused in a detour (task 2.20), in its first turn or later. */
function inDetour(number: number): string {
  return (
    `A detour is open after the miss on question ${number}: no question ` +
    'may be posted until the learner presses "Ready for another question". ' +
    "The learner sees only the text you write, never your thinking: work " +
    "through the confusion with them as text, suggest pressing it if they " +
    "seem ready, then end your reply."
  );
}

/** A learner's earlier message must not post a question before feedback. */
function feedbackPending(number: number): string {
  return (
    `The feedback on question ${number} is queued in a message of its own. ` +
    "Reply to the learner without posting a question, then end your reply " +
    "so that feedback can be sent."
  );
}

/** Why ask_question is refused during the feedback turn itself (task 2.16a). */
function feedbackOnly(number: number): string {
  return (
    `This reply is for your feedback on question ${number} only, and no ` +
    "tool may be called in it. The learner sees only the text you write, " +
    "never your thinking: write your feedback as text if you have not, " +
    "then end your reply. The app then asks you for the next question in " +
    "a message of its own, or closes the segment if the check is done."
  );
}

/** Why ask_question is refused outside the check, said so it can act on it. */
function outOfPhase(phase: Exclude<Phase, "check">): string {
  switch (phase) {
    case "teach":
      return (
        "The check has not started: the segment is in its teach phase. " +
        'Teach now; the learner moves to the check by pressing "ready" ' +
        "after the discussion."
      );
    case "discuss":
      return (
        'The check has not started: the learner has not pressed "ready". ' +
        'Answer their questions; you may suggest they press "ready" when ' +
        "they seem ready."
      );
    case "closed":
      return "The segment is closed, so its check is over. The learner starts the next segment.";
  }
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
  return <T>(work: () => Promise<T>): Promise<T> => {
    const result = tail.then(work);
    tail = result.catch(() => {});
    return result;
  };
}
