// The unit chat (architecture.md section 4; task 2.6): one tutor session
// bound to one unit, which runs each segment's teach / discuss / check
// rhythm. Opening a unit not in progress plans it (task 2.5) and sends
// segment 1's teaching turn. The engine enforces the phases:
//
// - teach to discuss: the teaching turn ends, or the learner stops it;
// - discuss to check: the learner presses "ready";
// - in the check, the tutor posts questions with ask_question, each on an
//   objective of the segment; each answer is graded, appended to the
//   evidence and sent to the tutor;
// - check to closed: the tutor's close_segment, refused until every
//   objective of the segment has an answer from this check, or the
//   learner's override, recorded as evidence;
// - closed to the next segment's teach: the learner starts it.
//
// A tool called out of phase is refused with a reason the tutor can act on.
// The engine composes every turn's header (unit-turns.ts) and writes the
// unit's position to state.json after every change, before the page is told,
// so a restart reopens the unit where it was. The tutor's own conversation
// does not survive a restart yet (task 2.14): a reopened unit gets a new
// session, told that it joins a unit under way.

import { randomUUID } from "node:crypto";
import type { Slug } from "../../shared/course.ts";
import type { PageEvent } from "../../shared/events.ts";
import type { AnswerEvidence, EvidenceEntry } from "../../shared/evidence.ts";
import type { Plan } from "../../shared/plan.ts";
import {
  type AnswerSubmission,
  CHOICE_LETTERS,
  type ChoiceQuestionInput,
} from "../../shared/question.ts";
import type { OpenQuestion, Phase, UnitPosition } from "../../shared/state.ts";
import type { TutorBackend } from "../backends/backend.ts";
import type { DataRoot } from "../record/data-root.ts";
import { askQuestionTool } from "../tools/ask-question.ts";
import { closeSegmentTool } from "../tools/close-segment.ts";
import {
  type ChatResult,
  type Conversation,
  createConversation,
  createEventLog,
} from "./conversation.ts";
import { gradeChoice } from "./grading.ts";
import type { UnitPlanner } from "./unit-planning.ts";
import {
  answerTurn,
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
  /** The learner's answer to the open question. */
  answer(submission: AnswerSubmission): Promise<ChatResult>;
  /** The learner moves on without the check, which is recorded. */
  override(): Promise<ChatResult>;
  /** The learner starts the next segment, once this one is closed. */
  nextSegment(): Promise<ChatResult>;
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
  position: UnitPosition;
  /** The answers to the segment's objectives in this check, in order. */
  checkAnswers: AnswerEvidence[];
  /** Said once, in the next turn's header. */
  notes: string[];
  tutor: Conversation;
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
      const unit = units.find((u) => u.id === unitId);
      if (stored === undefined || unit === undefined) {
        throw new Error(`There is no unit "${unitId}" in "${courseId}".`);
      }
      if (unit.plan === undefined) log.emit({ type: "unit_planning" });
      const planned = await planner.plan(courseId, unitId);
      if (!planned.ok) throw new Error(planned.error);
      const { plan } = planned;
      log.emit({ type: "unit_plan", plan });

      const storedPosition = (await dataRoot.readState(courseId)).units[unitId];
      if (
        storedPosition !== undefined &&
        plan.segments[storedPosition.segment] === undefined
      ) {
        throw new Error(
          `state.json puts the unit at segment ${storedPosition.segment + 1}, which its plan does not have.`,
        );
      }
      const position = storedPosition ?? { segment: 0, phase: "teach" };
      if (storedPosition === undefined) {
        await dataRoot.writePosition(courseId, unitId, position);
      }
      const evidence =
        position.phase === "check" ? await dataRoot.readEvidence(courseId) : [];
      const context: UnitContext = {
        courseTitle: stored.course.title,
        units,
        unitId,
        plan,
      };
      const style = await dataRoot.readStyle(courseId);
      const r: Running = {
        context,
        position,
        checkAnswers: answersInCheck(evidence, position, plan),
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
      log.emit({
        type: "phase",
        segment: position.segment,
        phase: position.phase,
      });
      if (position.openQuestion !== undefined) {
        log.emit({ type: "question", question: view(position.openQuestion) });
      }
      // A teaching turn that a restart cut off is sent again.
      if (position.phase === "teach") {
        sendTeaching(r, storedPosition !== undefined);
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
      answered: new Set(
        r.position.phase === "check"
          ? r.checkAnswers.map((a) => a.objective)
          : [],
      ),
      notes,
    };
  }

  function sendTeaching(r: Running, again: boolean): void {
    const { segment } = r.position;
    r.tutor.send({
      text: () => teachTurn(where(r), again),
      // The end of the teaching turn, or Stop during it, opens the
      // discussion, whatever the outcome: after an error the learner can
      // ask for what was missed.
      ended: () =>
        exclusive(async () => {
          if (r.position.segment === segment && r.position.phase === "teach") {
            await move(r, { segment, phase: "discuss" });
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
      log.emit({
        type: "phase",
        segment: position.segment,
        phase: position.phase,
      });
    }
  }

  function segmentObjectives(r: Running): readonly string[] {
    return r.context.plan.segments[r.position.segment]?.objectives ?? [];
  }

  // --- The teaching tools ----------------------------------------------------

  const questionBoard = {
    post: (question: ChoiceQuestionInput) =>
      exclusive(
        async (): Promise<
          { id: string; number: number } | { refused: string }
        > => {
          const r = running;
          if (r === undefined) return { refused: "The unit is not open." };
          const { position } = r;
          if (position.phase !== "check") {
            return { refused: outOfPhase(position.phase, "ask_question") };
          }
          if (position.openQuestion !== undefined) {
            return {
              refused: `Question ${position.openQuestion.number} is still open. End your turn and wait for the learner's answer.`,
            };
          }
          const objectives = segmentObjectives(r);
          if (!objectives.includes(question.objective)) {
            return {
              refused: `"${question.objective}" is not an objective of this segment. Name one of ${quoted(objectives)}.`,
            };
          }
          const open: OpenQuestion = {
            id: randomUUID(),
            number: r.checkAnswers.length + 1,
            objective: question.objective,
            postedAt: now().toISOString(),
            question: {
              kind: "choice",
              prompt: question.prompt,
              choices: question.choices,
              answer: question.answer,
            },
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
        const { position } = r;
        if (position.phase !== "check") {
          return { refused: outOfPhase(position.phase, "close_segment") };
        }
        if (position.openQuestion !== undefined) {
          return {
            refused: `Question ${position.openQuestion.number} is still open. Wait for the learner's answer before closing the segment.`,
          };
        }
        const answered = new Set(r.checkAnswers.map((a) => a.objective));
        const missing = segmentObjectives(r).filter((id) => !answered.has(id));
        if (missing.length > 0) {
          return {
            refused: `No answer yet in this check on ${quoted(missing)}. Post a question on each with ask_question before closing the segment.`,
          };
        }
        await move(r, { segment: position.segment, phase: "closed" });
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
      r.tutor.send({ text: () => messageTurn(where(r), text) });
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
          if (
            submission.kind === "choice" &&
            CHOICE_LETTERS.indexOf(submission.choice) >=
              open.question.choices.length
          ) {
            return {
              ok: false,
              status: 400,
              error: `Question ${open.number} has no choice ${submission.choice}.`,
            };
          }
          const entry: AnswerEvidence = {
            kind: "answer",
            recordedAt: now().toISOString(),
            objective: open.objective,
            question: open.question,
            answer: submission,
            // Help is recorded from task 2.7.
            assisted: false,
            verdict: gradeChoice(open.question.answer, submission),
          };
          // The evidence first: a crash before the position is written
          // leaves the question open with its answer kept, never an answer
          // lost.
          await dataRoot.appendEvidence(courseId, entry);
          r.checkAnswers.push(entry);
          const { openQuestion: _, ...rest } = r.position;
          await move(r, rest);
          log.emit({
            type: "graded",
            questionId: open.id,
            verdict: entry.verdict,
            choice: submission.kind === "choice" ? submission.choice : null,
            confidence:
              submission.kind === "choice" ? submission.confidence : null,
            correctChoice: open.question.answer,
          });
          r.tutor.send({
            text: () => answerTurn(where(r), entry, open.number),
          });
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
        const objectives = [...segmentObjectives(r)];
        await dataRoot.appendEvidence(courseId, {
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
        await move(r, { segment, phase: "closed" });
        r.checkAnswers = [];
        // Told with the next turn, so moving on costs no reply.
        r.notes.push(overrideNote(objectives, withdrawn?.number));
        return { ok: true };
      }),

    nextSegment: () =>
      act(async (r) => {
        const { phase, segment } = r.position;
        if (phase !== "closed") return refused(NOT_NOW.next[phase]);
        if (segment + 1 >= r.context.plan.segments.length) {
          return refused("This was the unit's last segment.");
        }
        await move(r, { segment: segment + 1, phase: "teach" });
        sendTeaching(r, false);
        return { ok: true };
      }),

    async interrupt() {
      await running?.tutor.interrupt();
    },
    async settled() {
      await loading;
      await running?.tutor.settled();
    },
    async close() {
      await running?.tutor.close();
    },
  };
  return chat;
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
  const objectives = plan.segments[position.segment]?.objectives ?? [];
  return evidence
    .slice(position.checkFrom)
    .filter(
      (e): e is AnswerEvidence =>
        e.kind === "answer" && objectives.includes(e.objective),
    );
}

function view(open: OpenQuestion) {
  return {
    id: open.id,
    number: open.number,
    prompt: open.question.prompt,
    choices: open.question.choices,
  };
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
