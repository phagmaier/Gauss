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
//   to the tutor. A choice is graded at once; a written answer is kept in
//   state.json and graded by the grader (grading.ts), outside the chat's
//   queue, and if the grading fails it can be graded again;
// - check to closed: the tutor's close_segment, refused until every
//   objective of the segment is done in this check, or the learner's
//   override, recorded as evidence;
// - closed to the next segment's teach: the learner starts it.
//
// When the unit's last segment closes, the unit ends: passed and out of
// state.json when every objective passed; otherwise the learner goes over
// the rest again in one more segment, or moves on without them, which
// records them as overridden and closes the unit.
//
// A tool called out of phase is refused with a reason the tutor can act on.
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
import type { Slug } from "../../shared/course.ts";
import type { PageEvent } from "../../shared/events.ts";
import {
  type AnswerSubmission,
  CHOICE_LETTERS,
  postedQuestion,
  type QuestionInput,
  type QuestionView,
  type Verdict,
  type WrittenAnswer,
  type WrittenQuestion,
} from "../../shared/question.ts";
import type { OpenQuestion, Phase } from "../../shared/state.ts";
import type { TutorBackend } from "../backends/backend.ts";
import type { DataRoot } from "../record/data-root.ts";
import { askQuestionTool } from "../tools/ask-question.ts";
import { closeSegmentTool } from "../tools/close-segment.ts";
import {
  isLastSegment,
  notPassed,
  type ObjectiveCheck,
  objectiveCheck,
  segmentOf,
} from "./check-rules.ts";
import type { ChatResult, Timer } from "./conversation.ts";
import { type Grader, gradeChoice } from "./grading.ts";
import { createTranscribedLog } from "./transcript.ts";
import { createUnitAgents, type UnitAgents } from "./unit-agents.ts";
import type { UnitPlanner } from "./unit-planning.ts";
import {
  type Answered,
  gradedEvent,
  openUnitRecord,
  phaseEvent,
  type UnitRecord,
} from "./unit-record.ts";
import {
  answerTurn,
  checkText,
  freshTurn,
  JOINED_NOTE,
  messageTurn,
  overrideNote,
  quoted,
  readyTurn,
  teachTurn,
  tutorSystemPrompt,
  type UnitContext,
  type Where,
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
   * The learner's answer to the open question. A written one is graded
   * after this returns; the page hears the grade, or that grading failed.
   */
  answer(submission: AnswerSubmission): Promise<ChatResult>;
  /** Grades again the written answer whose grading failed. */
  gradeAgain(): Promise<ChatResult>;
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
  /** Grades written answers. */
  grader: Grader;
  /**
   * The clock for the dates in the evidence and the open question, and for
   * when a session starts.
   */
  now?: () => Date;
  /** Closes idle tutor sessions; the system's timer if not given. */
  timer?: Timer;
}

export function createUnitChats(options: ChatOptions): UnitChats {
  const { dataRoot } = options;
  const chats = new Map<string, OpenableChat>();
  const key = (courseId: string, unitId: string) =>
    JSON.stringify([courseId, unitId]);

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
        chat = createUnitChat({ ...options, courseId, unitId });
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
}

function createUnitChat(
  options: ChatOptions & { courseId: Slug; unitId: Slug },
): OpenableChat {
  const { dataRoot, planner, courseId, unitId } = options;
  const now = options.now ?? (() => new Date());
  const log = createTranscribedLog({ dataRoot, courseId, unitId, now });
  const exclusive = createSerial();
  let running: Running | undefined;
  /** The agents of the last load, so closing the chat closes them while it loads too. */
  let agents: UnitAgents | undefined;
  let loading: Promise<void> | undefined;
  let failed = false;

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
        now,
      });
      const context: UnitContext = {
        courseTitle: stored.course.title,
        units,
        unitId,
        plan,
      };
      const style = await dataRoot.readStyle(courseId);
      const loaded = createUnitAgents({
        backend: options.backend,
        systemPrompt: tutorSystemPrompt(options.systemPrompt, context, style),
        tools: [askQuestionTool(questionBoard), closeSegmentTool(closer)],
        cwd: dataRoot.courseFolder(courseId),
        title: `Gauss: ${stored.course.title}, ${storedUnit.title}`,
        keep: (id) => exclusive(() => record.keepSession(id)),
        // Only a turn calls it, once `r` is set.
        lost: () => fallBack(r),
        grader: options.grader,
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
      log.emit(record.status());
      if (record.finished !== undefined) {
        log.emit({ type: "unit_closed", status: record.finished });
        return;
      }
      const { position } = record;
      log.emit(phaseEvent(position));
      const open = position.openQuestion;
      if (open !== undefined) {
        log.emit({ type: "question", question: view(open) });
        if (record.recordedAnswer(open.id) !== undefined) {
          // A restart came between recording the answer and closing its
          // question: the question is closed with the answer recorded, as
          // recording it would have gone on to do.
          await exclusive(async () => {
            const answered = await record.closeAnswered();
            if (answered !== undefined) tellGrade(r, answered);
          });
        } else if (
          open.answer !== undefined &&
          open.question.kind === "written"
        ) {
          // A written answer that a restart kept from its grade is graded
          // now, as a teaching turn a restart cut off is taught again.
          startGrading(r, open, open.question, open.answer);
        }
      }
      if (position.phase === "teach") {
        // A teaching turn that a restart cut off is sent again.
        sendTeaching(r, record.reopened);
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
  function fallBack(r: Running): void {
    if (!r.notes.includes(JOINED_NOTE)) r.notes.push(JOINED_NOTE);
    log.emit({ type: "fresh_start", reason: "not-resumed" });
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

  /** Sends the tutor the grade of the answer its question was closed with. */
  function tellGrade(r: Running, { question, entry }: Answered): void {
    r.agents.send({
      text: () => answerTurn(where(r), entry, question.number),
    });
  }

  /**
   * Records the graded answer to the open question, closes the question, and
   * sends the grade to the tutor. Runs inside `exclusive`.
   */
  async function recordAnswer(
    r: Running,
    submission: AnswerSubmission,
    grade: { verdict: Verdict; flaw?: string },
  ): Promise<void> {
    tellGrade(r, await r.record.answer(submission, grade));
  }

  /**
   * Grades the open question's kept written answer. The grader runs outside
   * `exclusive`, so the chat goes on while it works; its grade is recorded
   * inside, if the question is still open.
   */
  function startGrading(
    r: Running,
    open: OpenQuestion,
    question: WrittenQuestion,
    answer: WrittenAnswer,
  ): void {
    r.agents.grade({
      questionId: open.id,
      question,
      answer,
      applies: () =>
        r.record.position.openQuestion?.id === open.id &&
        r.record.finished === undefined,
      record: (grade) => recordAnswer(r, answer, grade),
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
    post: (question: QuestionInput) =>
      exclusive(
        async (): Promise<
          { id: string; number: number } | { refused: string }
        > => {
          const r = running;
          if (r === undefined) return { refused: "The unit is not open." };
          if (r.record.finished !== undefined) {
            return { refused: UNIT_FINISHED };
          }
          const { position } = r.record;
          if (position.phase !== "check") {
            return { refused: outOfPhase(position.phase, "ask_question") };
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
                  : "Every objective is done: give your feedback and close the segment."),
            };
          }
          const open: OpenQuestion = {
            id: randomUUID(),
            number: r.record.checkAnswers.length + 1,
            objective: question.objective,
            postedAt: now().toISOString(),
            question: postedQuestion(question),
          };
          await r.record.move({ ...position, openQuestion: open });
          log.emit({ type: "question", question: view(open) });
          return { id: open.id, number: open.number };
        },
      ),
  };

  const closer = {
    close: () =>
      exclusive(async (): Promise<{ closed: true } | { refused: string }> => {
        const r = running;
        if (r === undefined) return { refused: "The unit is not open." };
        if (r.record.finished !== undefined) return { refused: UNIT_FINISHED };
        const { position } = r.record;
        if (position.phase !== "check") {
          return { refused: outOfPhase(position.phase, "close_segment") };
        }
        if (position.openQuestion !== undefined) {
          return {
            refused: `Question ${position.openQuestion.number} is still open. Wait for the learner's answer before closing the segment.`,
          };
        }
        const standing = checks(r);
        const missing = segmentObjectives(r).filter(
          (id) => standing.get(id)?.state !== "done",
        );
        if (missing.length > 0) {
          const why = missing
            .map((id) => `"${id}" is ${checkText(standing.get(id))}`)
            .join("; ");
          return {
            refused: `Not done yet in this check: ${why}. Post a question on each with ask_question before closing the segment.`,
          };
        }
        const { checkFrom: _, ...rest } = position;
        await r.record.move({ ...rest, phase: "closed" });
        if (isLastSegment(r.context.plan, r.record.position)) await endUnit(r);
        return { closed: true };
      }),
  };

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
      log.emit({ type: "learner", text });
      r.agents.send({
        // Help is what the tutor received while a question was open
        // (docs/decisions.md, "Objective status"), so it is noted when the
        // message is sent to the tutor, not when the learner wrote it. Once
        // a written answer is sent, it is final, and help no longer applies.
        text: () =>
          exclusive(async () => {
            const { position } = r.record;
            const open = position.openQuestion;
            if (
              open !== undefined &&
              open.answer === undefined &&
              open.assisted === undefined
            ) {
              await r.record.move({
                ...position,
                openQuestion: { ...open, assisted: true },
              });
            }
            return messageTurn(where(r), text);
          }),
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

    answer: (submission) =>
      // An answer is taken while the tutor replies to a message.
      act(
        async (r) => {
          const open = r.record.position.openQuestion;
          if (open === undefined) return refused("No question is open.");
          if (submission.questionId !== open.id) {
            return refused(
              `That question is not open; question ${open.number} is.`,
            );
          }
          if (open.answer !== undefined) {
            return refused(
              r.agents.grading()
                ? "Your answer to this question is being graded."
                : "Your answer to this question is kept and waits to be graded again.",
            );
          }
          const { question } = open;
          if (
            submission.kind !== "unknown" &&
            submission.kind !== question.kind
          ) {
            return {
              ok: false,
              status: 400,
              error:
                question.kind === "choice"
                  ? `Question ${open.number} is answered with one of its choices.`
                  : `Question ${open.number} is answered in writing.`,
            };
          }
          if (submission.kind === "written" && question.kind === "written") {
            // Kept before it is graded, so a restart does not lose it.
            const kept: OpenQuestion = { ...open, answer: submission };
            await r.record.move({ ...r.record.position, openQuestion: kept });
            startGrading(r, kept, question, submission);
            return { ok: true };
          }
          if (question.kind === "written") {
            await recordAnswer(r, submission, { verdict: "unknown" });
            return { ok: true };
          }
          if (
            submission.kind === "choice" &&
            CHOICE_LETTERS.indexOf(submission.choice) >= question.choices.length
          ) {
            return {
              ok: false,
              status: 400,
              error: `Question ${open.number} has no choice ${submission.choice}.`,
            };
          }
          await recordAnswer(r, submission, {
            verdict: gradeChoice(question.answer, submission),
          });
          return { ok: true };
        },
        { whileWriting: true },
      ),

    gradeAgain: () =>
      act(
        async (r) => {
          const open = r.record.position.openQuestion;
          if (open?.answer === undefined || open.question.kind !== "written") {
            return refused("No answer is waiting to be graded again.");
          }
          if (r.agents.grading()) {
            return refused("The answer is being graded.");
          }
          startGrading(r, open, open.question, open.answer);
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
        // A written answer is final once sent: moving on would withdraw its
        // question, and the answer with it, also after a failed grading.
        if (openQuestion?.answer !== undefined) {
          return refused(
            r.agents.grading()
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
      await running?.agents.interrupt();
    },
    async settled() {
      await loading;
      await running?.agents.settled();
      await log.flushed();
    },
    async close() {
      await agents?.close();
      await log.flushed();
    },
  };
  return chat;
}

const UNIT_FINISHED = "The unit is finished.";

function view(open: OpenQuestion): QuestionView {
  const { id, number, question } = open;
  return question.kind === "choice"
    ? {
        kind: "choice",
        id,
        number,
        prompt: question.prompt,
        choices: question.choices,
      }
    : { kind: "written", id, number, prompt: question.prompt };
}

function refused(error: string): ChatResult {
  return { ok: false, status: 409, error };
}

/** Why the tutor's tool is refused outside the check, said so it can act on it. */
function outOfPhase(
  phase: Exclude<Phase, "check">,
  tool: "ask_question" | "close_segment",
): string {
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
      return tool === "close_segment"
        ? "The segment is closed already."
        : "The segment is closed, so its check is over. The learner starts the next segment.";
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
