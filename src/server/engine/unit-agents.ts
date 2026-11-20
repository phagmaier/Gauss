// The tutor, the grader and the help judge of one unit chat (unit-chat.ts;
// split out in task 2.8b): the tutor's conversation, the grading of a
// written, math or code answer, and the judging of a reply to a message sent while a
// question was open (task 2.21). They run outside the chat's queue, so the
// chat goes on while they work; a grade and a judge's call are recorded
// inside it. The queue is the chat's, given here, so there is one order for
// every change to the unit.
//
// The tutor's sessions run in the course's workspace and are kept, so a
// unit reopened after a restart resumes its tutor (task 2.14). A new session's id
// is handed to the chat to keep before the session's first turn is sent.
// A session is closed once it has been idle for a while, with no turn queued
// or running and no grading whose grade it will be sent, and resumed with
// the next turn (task 2.15). A reopened unit resumes its tutor the same way:
// opening it only asks the backend whether the session is there.

import type {
  GradedAnswer,
  Question,
  Unsettled,
  Verdict,
} from "../../shared/question.ts";
import {
  SessionNotFound,
  type TutorBackend,
  type TutorSession,
  type WorkspaceTools,
} from "../backends/backend.ts";
import type { TeachingTool } from "../tools/tool.ts";
import {
  type Conversation,
  createConversation,
  type EventLog,
  type Timer,
  type Turn,
  type TurnOutcome,
} from "./conversation.ts";
import type { HelpJudge, HelpOutcome } from "./help-judge.ts";

/**
 * A grade, with the flaw and why the check left it to the grader, if so, and
 * for a code answer the end of its tests' output.
 */
export interface Grade {
  verdict: Verdict;
  flaw?: string;
  unsettled?: Unsettled;
  output?: string;
}

/** The grading of an open question's kept written, math or code answer. */
export interface Grading {
  questionId: string;
  answer: GradedAnswer;
  /** Grades the answer, by the grader, the symbolic check or the tests. Never throws. */
  run(
    signal: AbortSignal,
  ): Promise<
    ({ ok: true } & Grade) | { ok: false; error: string; canMoveOn?: true }
  >;
  /** Whether the grade still applies when it comes: the question is open. */
  applies(): boolean;
  /** Records the grade. Runs inside the chat's queue. */
  record(grade: Grade): Promise<void>;
}

/** The judging of the tutor's reply to a message sent while a question was open. */
export interface Judging {
  /** The learner's message, by its id. */
  learnerId: string;
  /** The open question's number, as the page shows it. */
  number: number;
  question: Question;
  message: string;
  reply: string;
  /** Records the judge's call, or its failure. Runs inside the chat's queue. */
  record(outcome: HelpOutcome): Promise<void>;
}

export interface UnitAgents {
  /**
   * Has the first turn resume the tutor's kept session with this id, if the
   * backend has it; asked before any turn is sent, and without starting the
   * session. False if the backend cannot find it: the first turn then starts
   * a new session.
   */
  resume(id: string): Promise<boolean>;
  /**
   * Ends the tutor's session; the next turn starts a new one. Only while no
   * turn is queued or running.
   */
  startFresh(): void;
  /**
   * Queues a turn for the tutor. The first one starts a session, unless one
   * was resumed. Nothing is sent once the agents are closed.
   */
  send(turn: Turn): void;
  /** A tutor turn is queued or running. */
  busy(): boolean;
  /** Stops the tutor's turn in progress, if there is one. */
  interrupt(): Promise<void>;
  /**
   * Grades a kept written, math or code answer and tells the page it is being
   * graded. The grade is recorded inside the queue, if it still applies; a
   * failed grading, or a record that throws, is `grading_failed`. The
   * grading counts as running until then.
   */
  grade(grading: Grading): void;
  /** A grading is running. */
  grading(): boolean;
  /** A code grading failed before it could determine a verdict. */
  canMoveOn(questionId: string): boolean;
  /**
   * Judges a reply and tells the page it is being judged. The call, or its
   * failure, is recorded inside the queue; a record that throws is logged.
   * A call stopped by `close` is not recorded.
   */
  judge(judging: Judging): void;
  /** A judging is running. */
  judging(): boolean;
  /**
   * Resolves once every turn sent and every grading and judging started so
   * far has finished, with the turns they send.
   */
  settled(): Promise<void>;
  /** Stops the gradings and judgings in progress and closes the tutor's session. */
  close(): Promise<void>;
}

export function createUnitAgents(options: {
  backend: TutorBackend;
  /**
   * The tutor's whole system prompt, read whenever a session starts or
   * resumes, so one started after the style note changed gets the new one.
   */
  systemPrompt: () => string;
  tools: TeachingTool[];
  /** The course's workspace, where the tutor's sessions run and are kept. */
  cwd: string;
  /** The file and shell tools in the workspace; none if not given. */
  workspace?: WorkspaceTools;
  /** What the tutor's sessions are called among the backend's kept sessions. */
  title: string;
  /**
   * Keeps the id of a session just started, before its first turn is sent.
   * A failure is logged, and the session goes on.
   */
  keep: (id: string) => Promise<void>;
  /**
   * A turn found that the session to resume is gone, so a new one starts.
   * Called before the turn's text is composed.
   */
  lost: (learnerId?: string) => void;
  /** Called before a turn's own end work, to acknowledge notices it delivered. */
  turnEnded?: (outcome: TurnOutcome) => Promise<void> | void;
  judge: HelpJudge;
  log: EventLog;
  /** The chat's queue. */
  exclusive: <T>(work: () => Promise<T>) => Promise<T>;
  /** Closes idle sessions; the system's timer if not given. */
  timer?: Timer;
}): UnitAgents {
  const { backend, systemPrompt, tools, cwd, judge, log, exclusive } = options;
  const workspace =
    options.workspace === undefined ? {} : { workspace: options.workspace };

  async function startNew(): Promise<TutorSession> {
    const session = await backend.startSession({
      systemPrompt: systemPrompt(),
      tools,
      cwd,
      ...workspace,
      title: options.title,
    });
    try {
      await options.keep(session.backendSessionId);
    } catch (error) {
      // Only a restart needs the id, and it then starts the unit fresh.
      console.error("The tutor's session id could not be kept:", error);
    }
    return session;
  }

  /** The tutor's conversation, which resumes the kept session with this id if given. */
  function conversation(resumeId?: string): Conversation {
    return createConversation({
      start: startNew,
      kept: {
        async resume(id) {
          try {
            return await backend.startSession({
              systemPrompt: systemPrompt(),
              tools,
              cwd,
              ...workspace,
              resumeId: id,
            });
          } catch (error) {
            if (error instanceof SessionNotFound) throw error;
            const message =
              error instanceof Error ? error.message : String(error);
            throw new Error(
              `The conversation with the tutor could not be resumed: ${message.replace(/\.$/, "")}. Sending again tries again, and "Start fresh" starts a new one.`,
            );
          }
        },
        ...(resumeId === undefined ? {} : { resumeId }),
        lost: options.lost,
        // The grade is sent to the tutor, as is the grade of an answer that
        // waits for a judging.
        waiting: () => running !== undefined || judgings.size > 0,
        ...(options.timer === undefined ? {} : { timer: options.timer }),
      },
      log,
    });
  }

  /** The grading running. */
  let running:
    | { stop: AbortController; done: Promise<void>; code: boolean }
    | undefined;
  let failedCodeQuestion: string | undefined;
  /** The judgings running: one per reply, and replies can end while one runs. */
  const judgings = new Set<{ stop: AbortController; done: Promise<void> }>();
  let tutor = conversation();
  /** Sessions being closed after a fresh start. */
  const closing: Promise<void>[] = [];
  let closed = false;

  return {
    async resume(id) {
      let found: boolean;
      try {
        found = await backend.hasSession(id, cwd);
      } catch (error) {
        // The turn that resumes it finds out whether it is there.
        console.error(
          "The tutor's kept session could not be looked up:",
          error,
        );
        found = true;
      }
      if (found && !closed) tutor = conversation(id);
      return found;
    },

    startFresh() {
      const old = tutor;
      tutor = conversation();
      closing.push(
        old.close().catch((error: unknown) => {
          console.error("The tutor's session could not be closed:", error);
        }),
      );
    },

    send(turn) {
      if (closed) return;
      const { turnEnded } = options;
      if (turnEnded === undefined) {
        tutor.send(turn);
        return;
      }
      tutor.send({
        ...turn,
        async ended(outcome, reply) {
          try {
            await turnEnded(outcome);
          } finally {
            await turn.ended?.(outcome, reply);
          }
        },
      });
    },
    busy: () => tutor.busy(),
    interrupt: () => tutor.interrupt(),

    grade(grading) {
      const { questionId, answer } = grading;
      if (closed) return;
      failedCodeQuestion = undefined;
      const stop = new AbortController();
      log.emit({ type: "grading", questionId, answer });
      const done = (async () => {
        const outcome = await grading.run(stop.signal);
        await exclusive(async () => {
          const failed = (error: string) =>
            log.emit({ type: "grading_failed", questionId, error });
          try {
            if (stop.signal.aborted || !grading.applies()) return;
            if (!outcome.ok) {
              if (outcome.canMoveOn) failedCodeQuestion = questionId;
              log.emit({
                type: "grading_failed",
                questionId,
                error: outcome.error,
                ...(outcome.canMoveOn ? { canMoveOn: true as const } : {}),
              });
              return;
            }
            const { ok: _, ...grade } = outcome;
            await grading.record(grade);
          } catch (error) {
            failed(error instanceof Error ? error.message : String(error));
          } finally {
            // Inside the queue, so an action queued after this sees it done.
            if (running?.stop === stop) running = undefined;
          }
        });
      })();
      running = { stop, done, code: answer.kind === "code" };
    },

    grading: () => running !== undefined,
    canMoveOn: (questionId) => failedCodeQuestion === questionId,

    judge(judging) {
      if (closed) return;
      const { learnerId, number, question, message, reply } = judging;
      const stop = new AbortController();
      log.emit({ type: "judging", learnerId, number });
      const work = { stop, done: Promise.resolve() };
      work.done = (async () => {
        const outcome = await judge.judge(
          { question, message, reply },
          stop.signal,
        );
        // Stopped because the chat is closing: the reply is still waiting
        // in state.json, and the unit reopened next decides it.
        if (stop.signal.aborted) {
          judgings.delete(work);
          return;
        }
        await exclusive(async () => {
          try {
            // Shutdown may have begun while this result waited for the queue.
            if (stop.signal.aborted) return;
            await judging.record(outcome);
          } catch (error) {
            console.error("The judge's call could not be recorded:", error);
          } finally {
            // Inside the queue, so an action queued after this sees it done.
            judgings.delete(work);
          }
        });
      })();
      judgings.add(work);
    },

    judging: () => judgings.size > 0,

    async settled() {
      // A grade sends the tutor a turn; the end of a reply can start a
      // judging, and a judging can let a kept answer be graded. Each comes
      // from one before it, and none goes on by itself, so this ends.
      while (true) {
        if (running !== undefined) {
          await running.done;
          continue;
        }
        const judging = judgings.values().next();
        if (!judging.done) {
          await judging.value.done;
          continue;
        }
        await tutor.settled();
        if (running === undefined && judgings.size === 0) return;
      }
    },

    async close() {
      closed = true;
      const grading = running;
      grading?.stop.abort();
      for (const judging of judgings) judging.stop.abort();
      await Promise.all([
        tutor.close(),
        ...closing,
        grading?.code ? grading.done : undefined,
      ]);
    },
  };
}
