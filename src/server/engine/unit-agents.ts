// The tutor and the grader of one unit chat (unit-chat.ts; split out in task
// 2.8b): the tutor's conversation, and the grading of a written answer while
// it runs. Both run outside the chat's queue, so the chat goes on while they
// work; a grade is recorded inside it. The queue is the chat's, given here,
// so there is one order for every change to the unit.
//
// Resume (task 2.14) and closing idle sessions (2.15) belong here: this is
// where it is known whether a turn is queued or a grading still running.

import type {
  Verdict,
  WrittenAnswer,
  WrittenQuestion,
} from "../../shared/question.ts";
import type { TutorBackend } from "../backends/backend.ts";
import type { TeachingTool } from "../tools/tool.ts";
import {
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
  /** Queues a turn for the tutor. The first one starts the session. */
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
  grader: Grader;
  log: EventLog;
  /** The chat's queue. */
  exclusive: <T>(work: () => Promise<T>) => Promise<T>;
}): UnitAgents {
  const { grader, log, exclusive } = options;
  const tutor = createConversation({
    backend: options.backend,
    systemPrompt: options.systemPrompt,
    tools: options.tools,
    log,
  });
  let running: { stop: AbortController; done: Promise<void> } | undefined;

  return {
    send: (turn) => tutor.send(turn),
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
      running?.stop.abort();
      await tutor.close();
    },
  };
}
