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
// so a restart reopens the unit where it was. The tutor's own conversation
// does not survive a restart yet (task 2.14): a reopened unit gets a new
// session, told that it joins a unit under way.

import { randomUUID } from "node:crypto";
import type { Slug } from "../../shared/course.ts";
import type { StoredUnit } from "../../shared/curriculum.ts";
import type { PageEvent } from "../../shared/events.ts";
import type { AnswerEvidence, EvidenceEntry } from "../../shared/evidence.ts";
import type { Plan } from "../../shared/plan.ts";
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
import type { OpenQuestion, Phase, UnitPosition } from "../../shared/state.ts";
import type { TutorBackend } from "../backends/backend.ts";
import type { DataRoot } from "../record/data-root.ts";
import { objectiveStatus, unitStatus } from "../record/status.ts";
import { askQuestionTool } from "../tools/ask-question.ts";
import { closeSegmentTool } from "../tools/close-segment.ts";
import {
  isLastSegment,
  notPassed,
  type ObjectiveCheck,
  objectiveCheck,
  segmentOf,
} from "./check-rules.ts";
import {
  type ChatResult,
  type Conversation,
  createConversation,
  createEventLog,
} from "./conversation.ts";
import { type Grader, gradeChoice } from "./grading.ts";
import type { UnitPlanner } from "./unit-planning.ts";
import {
  answerTurn,
  checkText,
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
 * stays open until the server stops; 2.15 closes idle ones.
 */
export interface UnitChats {
  /**
   * Opens the unit, marking the course opened: its chat if it is open, or a
   * new one, which starts the unit or picks it up where state.json has it.
   * Opening a unit whose planning failed tries again.
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
  /** The clock for the dates in the evidence and the open question. */
  now?: () => Date;
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
      await dataRoot.markOpened(courseId);
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

/** The chat once its unit is planned and its position read. */
interface Running {
  context: UnitContext;
  /** The unit as the curriculum has it, with its plan. */
  unit: StoredUnit;
  /** Kept in memory once the unit is finished, but no longer in state.json. */
  position: UnitPosition;
  /** The evidence on the unit's objectives, in log order. */
  evidence: EvidenceEntry[];
  /** The answers to the segment's objectives in this check, in order. */
  checkAnswers: AnswerEvidence[];
  /** Set once the unit is finished and taken out of state.json. */
  finished?: "passed" | "overridden";
  /** Said once, in the next turn's header. */
  notes: string[];
  tutor: Conversation;
  /** The grading of the open question's written answer, while it runs. */
  grading?: { stop: AbortController; done: Promise<void> };
}

function createUnitChat(
  options: ChatOptions & { courseId: Slug; unitId: Slug },
): OpenableChat {
  const { dataRoot, planner, courseId, unitId } = options;
  const now = options.now ?? (() => new Date());
  const log = createEventLog();
  const exclusive = createSerial();
  let running: Running | undefined;
  let loading: Promise<void> | undefined;
  let failed = false;

  // --- Opening ---------------------------------------------------------------

  async function load(): Promise<void> {
    try {
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
      const unit: StoredUnit = { ...storedUnit, plan };
      log.emit({ type: "unit_plan", plan });

      const storedPosition = (await dataRoot.readState(courseId)).units[unitId];
      if (storedPosition !== undefined) checkPosition(plan, storedPosition);
      const allEvidence = await dataRoot.readEvidence(courseId);
      const evidence = concerning(allEvidence, plan);
      // A unit without a position is finished if its objectives say so, and
      // is not started again.
      const before = unitStatus(unit, evidence, undefined);
      const finished =
        storedPosition === undefined &&
        (before === "passed" || before === "overridden")
          ? before
          : undefined;
      const position: UnitPosition =
        storedPosition ??
        (finished === undefined
          ? { segment: 0, phase: "teach" }
          : { segment: plan.segments.length - 1, phase: "closed" });
      if (storedPosition === undefined && finished === undefined) {
        await dataRoot.writePosition(courseId, unitId, position);
      }
      const context: UnitContext = {
        courseTitle: stored.course.title,
        units,
        unitId,
        plan,
      };
      const style = await dataRoot.readStyle(courseId);
      const r: Running = {
        context,
        unit,
        position,
        evidence,
        checkAnswers: answersInCheck(allEvidence, position, plan),
        ...(finished === undefined ? {} : { finished }),
        // A unit under way gets a new session (until task 2.14), which must
        // not pretend to remember the conversation before it.
        notes: storedPosition === undefined ? [] : [JOINED_NOTE],
        tutor: createConversation({
          backend: options.backend,
          systemPrompt: tutorSystemPrompt(options.systemPrompt, context, style),
          tools: [askQuestionTool(questionBoard), closeSegmentTool(closer)],
          log,
        }),
      };
      running = r;
      log.emit(statusEvent(r));
      if (finished !== undefined) {
        log.emit({ type: "unit_closed", status: finished });
        return;
      }
      log.emit(phaseEvent(position));
      const open = position.openQuestion;
      if (open !== undefined) {
        log.emit({ type: "question", question: view(open) });
        // A written answer that a restart kept from its grade is graded now,
        // as a teaching turn a restart cut off is taught again.
        if (open.answer !== undefined && open.question.kind === "written") {
          startGrading(r, open, open.question, open.answer);
        }
      }
      if (position.phase === "teach") {
        // A teaching turn that a restart cut off is sent again.
        sendTeaching(r, storedPosition !== undefined);
      } else if (position.phase === "closed" && isLastSegment(plan, position)) {
        // The closing card was waiting on the learner, or a restart came
        // between closing the last segment and closing the unit.
        await exclusive(() => endUnit(r));
      }
    } catch (error) {
      failed = true;
      log.emit({
        type: "unit_failed",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // --- Turns -----------------------------------------------------------------

  /** Where the unit stands now, with the notes not yet given, which this takes. */
  function where(r: Running): Where {
    const notes = r.notes;
    r.notes = [];
    return {
      context: r.context,
      position: r.position,
      checks: checks(r),
      notPassed: notPassed(r.context.plan, r.evidence),
      ...(r.finished === undefined ? {} : { finished: r.finished }),
      notes,
    };
  }

  /** Where each objective of the segment stands in the check; none outside it. */
  function checks(r: Running): Map<string, ObjectiveCheck> {
    if (r.position.phase !== "check") return new Map();
    return new Map(
      segmentOf(r.context.plan, r.position).objectives.map((id) => [
        id,
        objectiveCheck(id, r.evidence, r.checkAnswers),
      ]),
    );
  }

  function sendTeaching(r: Running, cutOff: boolean): void {
    const { segment } = r.position;
    r.tutor.send({
      text: () => teachTurn(where(r), cutOff),
      // The end of the teaching turn, or Stop during it, opens the
      // discussion, whatever the outcome: after an error the learner can
      // ask for what was missed.
      ended: () =>
        exclusive(async () => {
          if (r.position.segment === segment && r.position.phase === "teach") {
            await move(r, { ...r.position, phase: "discuss" });
          }
        }),
    });
  }

  /** Writes the position to state.json, then keeps it and tells the page. */
  async function move(r: Running, position: UnitPosition): Promise<void> {
    await dataRoot.writePosition(courseId, unitId, position);
    const before = r.position;
    r.position = position;
    if (
      before.segment !== position.segment ||
      before.phase !== position.phase
    ) {
      log.emit(phaseEvent(position));
    }
  }

  /** Records the entry, keeps it for the unit's statuses, and tells the page. */
  async function record(r: Running, entry: EvidenceEntry): Promise<void> {
    await dataRoot.appendEvidence(courseId, entry);
    r.evidence.push(entry);
  }

  function statusEvent(r: Running): PageEvent {
    return {
      type: "unit_status",
      unit: unitStatus(
        r.unit,
        r.evidence,
        r.finished === undefined ? r.position : undefined,
      ),
      objectives: objectiveStatuses(r),
    };
  }

  function objectiveStatuses(r: Running) {
    return Object.fromEntries(
      r.context.plan.objectives.map((o) => [
        o.id,
        objectiveStatus(r.evidence, o.id),
      ]),
    );
  }

  /**
   * The last segment has closed: shows the closing card, and closes the unit
   * at once if every objective passed. Runs inside `exclusive`.
   */
  async function endUnit(r: Running): Promise<void> {
    const passed = notPassed(r.context.plan, r.evidence).length === 0;
    log.emit({ type: "unit_end", passed, objectives: objectiveStatuses(r) });
    if (passed) await closeUnit(r, "passed");
  }

  /** Takes the unit out of state.json: it is no longer in progress. */
  async function closeUnit(
    r: Running,
    status: "passed" | "overridden",
  ): Promise<void> {
    await dataRoot.writePosition(courseId, unitId, null);
    r.finished = status;
    log.emit(statusEvent(r));
    log.emit({ type: "unit_closed", status });
  }

  function segmentObjectives(r: Running): readonly string[] {
    return segmentOf(r.context.plan, r.position).objectives;
  }

  /**
   * Records a graded answer, closes its question, and sends the grade to the
   * tutor. Runs inside `exclusive`.
   */
  async function recordAnswer(
    r: Running,
    open: OpenQuestion,
    submission: AnswerSubmission,
    grade: { verdict: Verdict; flaw?: string },
  ): Promise<void> {
    const flaw = grade.verdict === "incorrect" ? grade.flaw : undefined;
    const entry: AnswerEvidence = {
      kind: "answer",
      recordedAt: now().toISOString(),
      objective: open.objective,
      question: open.question,
      answer: submission,
      assisted: open.assisted === true,
      verdict: grade.verdict,
      ...(flaw === undefined ? {} : { flaw }),
    };
    // The evidence first: a crash before the position is written leaves the
    // question open with its answer kept, never an answer lost.
    await record(r, entry);
    r.checkAnswers.push(entry);
    const { openQuestion: _, ...rest } = r.position;
    await move(r, rest);
    log.emit({
      type: "graded",
      questionId: open.id,
      verdict: entry.verdict,
      answer: submission,
      ...(open.question.kind === "choice"
        ? { correctChoice: open.question.answer }
        : {}),
      ...(flaw === undefined ? {} : { flaw }),
      assisted: entry.assisted,
    });
    log.emit(statusEvent(r));
    r.tutor.send({ text: () => answerTurn(where(r), entry, open.number) });
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
    const stop = new AbortController();
    log.emit({ type: "grading", questionId: open.id, answer });
    const done = (async () => {
      const outcome = await options.grader.grade(
        question,
        answer.text,
        stop.signal,
      );
      await exclusive(async () => {
        const failed = (error: string) =>
          log.emit({ type: "grading_failed", questionId: open.id, error });
        try {
          const current = r.position.openQuestion;
          if (current?.id !== open.id || r.finished !== undefined) return;
          if (!outcome.ok) return failed(outcome.error);
          await recordAnswer(r, current, answer, outcome);
        } catch (error) {
          failed(error instanceof Error ? error.message : String(error));
        } finally {
          // Inside the queue, so an action queued after this sees it done.
          if (r.grading?.stop === stop) delete r.grading;
        }
      });
    })();
    r.grading = { stop, done };
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
          if (r.finished !== undefined) return { refused: UNIT_FINISHED };
          const { position } = r;
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
            number: r.checkAnswers.length + 1,
            objective: question.objective,
            postedAt: now().toISOString(),
            question: postedQuestion(question),
          };
          await move(r, { ...position, openQuestion: open });
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
        if (r.finished !== undefined) return { refused: UNIT_FINISHED };
        const { position } = r;
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
        await move(r, { ...rest, phase: "closed" });
        if (isLastSegment(r.context.plan, r.position)) await endUnit(r);
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
      if (r.finished !== undefined) return refused(UNIT_FINISHED);
      if (!whileWriting && r.tutor.busy()) {
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
    if (
      r.position.phase !== "closed" ||
      !isLastSegment(r.context.plan, r.position)
    ) {
      return "The unit has not reached its end.";
    }
    const rest = notPassed(r.context.plan, r.evidence);
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
      r.tutor.send({
        // Help is what the tutor received while a question was open
        // (docs/decisions.md, "Objective status"), so it is noted when the
        // message is sent to the tutor, not when the learner wrote it. Once
        // a written answer is sent, it is final, and help no longer applies.
        text: () =>
          exclusive(async () => {
            const open = r.position.openQuestion;
            if (
              open !== undefined &&
              open.answer === undefined &&
              open.assisted === undefined
            ) {
              await move(r, {
                ...r.position,
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
        if (r.position.phase !== "discuss") {
          return refused(NOT_NOW.ready[r.position.phase]);
        }
        const checkFrom = (await dataRoot.readEvidence(courseId)).length;
        await move(r, { ...r.position, phase: "check", checkFrom });
        r.checkAnswers = [];
        r.tutor.send({ text: () => readyTurn(where(r)) });
        return { ok: true };
      }),

    answer: (submission) =>
      // An answer is taken while the tutor replies to a message.
      act(
        async (r) => {
          const open = r.position.openQuestion;
          if (open === undefined) return refused("No question is open.");
          if (submission.questionId !== open.id) {
            return refused(
              `That question is not open; question ${open.number} is.`,
            );
          }
          if (open.answer !== undefined) {
            return refused(
              r.grading === undefined
                ? "Your answer to this question is kept and waits to be graded again."
                : "Your answer to this question is being graded.",
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
            await move(r, { ...r.position, openQuestion: kept });
            startGrading(r, kept, question, submission);
            return { ok: true };
          }
          if (question.kind === "written") {
            await recordAnswer(r, open, submission, { verdict: "unknown" });
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
          await recordAnswer(r, open, submission, {
            verdict: gradeChoice(question.answer, submission),
          });
          return { ok: true };
        },
        { whileWriting: true },
      ),

    gradeAgain: () =>
      act(
        async (r) => {
          const open = r.position.openQuestion;
          if (open?.answer === undefined || open.question.kind !== "written") {
            return refused("No answer is waiting to be graded again.");
          }
          if (r.grading !== undefined) {
            return refused("The answer is being graded.");
          }
          startGrading(r, open, open.question, open.answer);
          return { ok: true };
        },
        { whileWriting: true },
      ),

    override: () =>
      act(async (r) => {
        const { phase, segment } = r.position;
        if (phase !== "discuss" && phase !== "check") {
          return refused(NOT_NOW.override[phase]);
        }
        if (r.grading !== undefined) {
          return refused(
            "An answer is being graded. Wait for its grade, then move on.",
          );
        }
        const objectives = [...segmentObjectives(r)];
        await record(r, {
          kind: "override",
          recordedAt: now().toISOString(),
          objectives,
        });
        const withdrawn = r.position.openQuestion;
        log.emit({
          type: "overridden",
          segment,
          objectives,
          ...(withdrawn === undefined
            ? {}
            : { withdrawnQuestionId: withdrawn.id }),
        });
        log.emit(statusEvent(r));
        const { checkFrom: _, openQuestion: __, ...rest } = r.position;
        await move(r, { ...rest, phase: "closed" });
        r.checkAnswers = [];
        // Told with the next turn, so moving on costs no reply.
        r.notes.push(overrideNote(objectives, withdrawn?.number));
        if (isLastSegment(r.context.plan, r.position)) await endUnit(r);
        return { ok: true };
      }),

    nextSegment: () =>
      act(async (r) => {
        const { phase, segment } = r.position;
        if (phase !== "closed") return refused(NOT_NOW.next[phase]);
        if (isLastSegment(r.context.plan, r.position)) {
          return refused(
            "This was the unit's last segment: go over the objectives not passed again, or move on without them.",
          );
        }
        await move(r, { segment: segment + 1, phase: "teach" });
        sendTeaching(r, false);
        return { ok: true };
      }),

    goOverAgain: () =>
      act(async (r) => {
        const again = atUnitEnd(r);
        if (typeof again === "string") return refused(again);
        await move(r, {
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
        await record(r, {
          kind: "override",
          recordedAt: now().toISOString(),
          objectives,
        });
        await closeUnit(r, "overridden");
        return { ok: true };
      }),

    async interrupt() {
      await running?.tutor.interrupt();
    },
    async settled() {
      await loading;
      // A grade sends the tutor a turn, and a turn can be followed by
      // nothing else that grades, so this ends.
      while (true) {
        const grading = running?.grading;
        if (grading !== undefined) {
          await grading.done;
          continue;
        }
        await running?.tutor.settled();
        if (running?.grading === undefined) return;
      }
    },
    async close() {
      running?.grading?.stop.abort();
      await running?.tutor.close();
    },
  };
  return chat;
}

const UNIT_FINISHED = "The unit is finished.";

/**
 * A position read back from state.json fits the unit's plan: a segment of
 * the plan, or the one after it that goes over objectives of the plan.
 */
function checkPosition(plan: Plan, position: UnitPosition): void {
  const ids = new Set(plan.objectives.map((o) => o.id));
  const fits =
    position.again === undefined
      ? plan.segments[position.segment] !== undefined
      : position.segment === plan.segments.length &&
        position.again.every((id) => ids.has(id));
  if (!fits) {
    throw new Error(
      `state.json puts the unit at segment ${position.segment + 1}, which its plan does not have.`,
    );
  }
}

/** The entries about the plan's objectives: answers on them, overrides naming them. */
function concerning(
  evidence: readonly EvidenceEntry[],
  plan: Plan,
): EvidenceEntry[] {
  const ids = new Set(plan.objectives.map((o) => o.id));
  return evidence.filter((e) =>
    e.kind === "answer"
      ? ids.has(e.objective)
      : e.objectives.some((id) => ids.has(id)),
  );
}

/** The answers in the position's check to its segment's objectives. */
function answersInCheck(
  evidence: readonly EvidenceEntry[],
  position: UnitPosition,
  plan: Plan,
): AnswerEvidence[] {
  if (position.phase !== "check" || position.checkFrom === undefined) {
    return [];
  }
  const { objectives } = segmentOf(plan, position);
  return evidence
    .slice(position.checkFrom)
    .filter(
      (e): e is AnswerEvidence =>
        e.kind === "answer" && objectives.includes(e.objective),
    );
}

function phaseEvent(position: UnitPosition): PageEvent {
  return {
    type: "phase",
    segment: position.segment,
    phase: position.phase,
    ...(position.again === undefined ? {} : { again: position.again }),
  };
}

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
