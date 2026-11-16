// The tutor and the grader of one unit chat (unit-chat.ts; split out in task
// 2.8b): the tutor's conversation, and the grading of a written answer while
// it runs. Both run outside the chat's queue, so the chat goes on while they
// work; a grade is recorded inside it. The queue is the chat's, given here,
// so there is one order for every change to the unit.
//
// The tutor's sessions run in the course's folder and are kept, so a unit
// reopened after a restart resumes its tutor (task 2.14). A new session's id
// is handed to the chat to keep before the session's first turn is sent.
// Closing idle sessions (2.15) belongs here too: this is where it is known
// whether a turn is queued or a grading still running.

import type {
  Verdict,
  WrittenAnswer,
  WrittenQuestion,
} from "../../shared/question.ts";
import {
  SessionNotFound,
  type TutorBackend,
  type TutorSession,
} from "../backends/backend.ts";
import type { TeachingTool } from "../tools/tool.ts";
import {
  type Conversation,
  createConversation,
  type EventLog,
  type Turn,
} from "./conversation.ts";
import type { Grader } from "./grading.ts";

/** The grading of an open question's kept written answer. */
export interface Grading {
  questionId: string;
  question: WrittenQuestion;
  answer: WrittenAnswer;
  /** Whether the grade still applies when it comes: the question is open. */
  applies(): boolean;
  /** Records the grade. Runs inside the chat's queue. */
  record(grade: { verdict: Verdict; flaw?: string }): Promise<void>;
}

export interface UnitAgents {
  /**
   * Resumes the tutor's kept session with this id, before any turn is sent.
   * False if the backend cannot find it: the first turn then starts a new
   * session. Throws if resuming fails another way.
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
   * Grades a kept written answer and tells the page it is being graded. The
   * grade is recorded inside the queue, if it still applies; a failed
   * grading, or a record that throws, is `grading_failed`. The grading
   * counts as running until then.
   */
  grade(grading: Grading): void;
  /** A grading is running. */
  grading(): boolean;
  /**
   * Resolves once every turn sent and every grading started so far has
   * finished, with the turns a grade sends.
   */
  settled(): Promise<void>;
  /** Stops a grading in progress and closes the tutor's session. */
  close(): Promise<void>;
}

export function createUnitAgents(options: {
  backend: TutorBackend;
  /** The tutor's whole system prompt. */
  systemPrompt: string;
  tools: TeachingTool[];
  /** The course's folder, where the tutor's sessions run and are kept. */
  cwd: string;
  /**
   * Keeps the id of a session just started, before its first turn is sent.
   * A failure is logged, and the session goes on.
   */
  keep: (id: string) => Promise<void>;
  grader: Grader;
  log: EventLog;
  /** The chat's queue. */
  exclusive: <T>(work: () => Promise<T>) => Promise<T>;
}): UnitAgents {
  const { backend, systemPrompt, tools, cwd, grader, log, exclusive } = options;

  async function startNew(): Promise<TutorSession> {
    const session = await backend.startSession({ systemPrompt, tools, cwd });
    try {
      await options.keep(session.backendSessionId);
    } catch (error) {
      // Only a restart needs the id, and it then starts the unit fresh.
      console.error("The tutor's session id could not be kept:", error);
    }
    return session;
  }

  let tutor: Conversation = createConversation({ start: startNew, log });
  /** Sessions being closed after a fresh start. */
  const closing: Promise<void>[] = [];
  let closed = false;
  let running: { stop: AbortController; done: Promise<void> } | undefined;

  return {
    async resume(id) {
      let session: TutorSession;
      try {
        session = await backend.startSession({
          systemPrompt,
          tools,
          cwd,
          resumeId: id,
        });
      } catch (error) {
        if (error instanceof SessionNotFound) return false;
        throw error;
      }
      if (closed) {
        await session.close();
        return true;
      }
      tutor = createConversation({ start: startNew, session, log });
      return true;
    },

    startFresh() {
      const old = tutor;
      tutor = createConversation({ start: startNew, log });
      closing.push(
        old.close().catch((error: unknown) => {
          console.error("The tutor's session could not be closed:", error);
        }),
      );
    },

    send(turn) {
      if (!closed) tutor.send(turn);
    },
    busy: () => tutor.busy(),
    interrupt: () => tutor.interrupt(),

    grade(grading) {
      const { questionId, question, answer } = grading;
      const stop = new AbortController();
      log.emit({ type: "grading", questionId, answer });
      const done = (async () => {
        const outcome = await grader.grade(question, answer.text, stop.signal);
        await exclusive(async () => {
          const failed = (error: string) =>
            log.emit({ type: "grading_failed", questionId, error });
          try {
            if (!grading.applies()) return;
            if (!outcome.ok) return failed(outcome.error);
            await grading.record(outcome);
          } catch (error) {
            failed(error instanceof Error ? error.message : String(error));
          } finally {
            // Inside the queue, so an action queued after this sees it done.
            if (running?.stop === stop) running = undefined;
          }
        });
      })();
      running = { stop, done };
    },

    grading: () => running !== undefined,

    async settled() {
      // A grade sends the tutor a turn, and a turn can be followed by
      // nothing else that grades, so this ends.
      while (true) {
        if (running !== undefined) {
          await running.done;
          continue;
        }
        await tutor.settled();
        if (running === undefined) return;
      }
    },

    async close() {
      closed = true;
      running?.stop.abort();
      await Promise.all([tutor.close(), ...closing]);
    },
  };
}
