// One chat with the tutor, as the minimal page needs it (plan task 0.5): the
// tutor teaches, posts a multiple-choice question, and responds to the graded
// answer. The chat keeps an event log for the page, sends the tutor one turn
// at a time, and grades answers itself. Everything is in memory; the course
// record and the phase rules arrive in stages 1 and 2.

import { randomUUID } from "node:crypto";
import type { PageEvent } from "../../shared/events.ts";
import {
  type AnswerSubmission,
  CHOICE_LETTERS,
  type ChoiceQuestionInput,
  confidenceLabel,
  type Verdict,
} from "../../shared/question.ts";
import type { TutorBackend, TutorSession } from "../backends/backend.ts";
import { askQuestionTool } from "../tools/ask-question.ts";
import { gradeChoice } from "./grading.ts";

export type ChatResult =
  | { ok: true }
  | { ok: false; status: 400 | 404 | 409; error: string };

export interface Chat {
  /** Changes when the server restarts, so a page can tell. */
  readonly id: string;
  events(): readonly PageEvent[];
  /** Calls the listener with every new event and its index in the log. */
  subscribe(listener: (event: PageEvent, index: number) => void): () => void;
  /** Starts the tutor session and sends the opening turn. */
  start(): ChatResult;
  say(text: string): ChatResult;
  answer(submission: AnswerSubmission): ChatResult;
  /** Stops the tutor's turn in progress, if there is one. */
  interrupt(): Promise<void>;
  /** Resolves once every turn sent so far has finished. */
  settled(): Promise<void>;
  close(): Promise<void>;
}

interface PostedQuestion {
  id: string;
  input: ChoiceQuestionInput;
  verdict?: Verdict;
}

export function createChat(options: {
  backend: TutorBackend;
  systemPrompt: string;
}): Chat {
  const id = randomUUID();
  const log: PageEvent[] = [];
  const listeners = new Set<(event: PageEvent, index: number) => void>();
  const questions: PostedQuestion[] = [];
  let session: Promise<TutorSession> | undefined;
  let turnRunning = false;
  let queue: Promise<void> = Promise.resolve();

  function emit(event: PageEvent): void {
    log.push(event);
    const index = log.length - 1;
    // A failing listener must not stop the turn: the tutor's reply has to
    // be read to its end, or the next turn would read its leftovers.
    for (const listener of listeners) {
      try {
        listener(event, index);
      } catch (error) {
        console.error("A chat listener failed:", error);
      }
    }
  }

  function openQuestion(): PostedQuestion | undefined {
    return questions.find((q) => q.verdict === undefined);
  }

  const askQuestion = askQuestionTool({
    openQuestionId: () => openQuestion()?.id,
    post(input) {
      const question = { id: `q${questions.length + 1}`, input };
      questions.push(question);
      emit({
        type: "question",
        question: {
          id: question.id,
          number: questions.length,
          prompt: input.prompt,
          choices: input.choices,
        },
      });
      return question.id;
    },
  });

  function enqueue(text: string): void {
    queue = queue.then(() => runTurn(text));
  }

  async function runTurn(text: string): Promise<void> {
    turnRunning = true;
    emit({ type: "turn_start" });
    try {
      if (session === undefined) throw new Error("The chat has not started.");
      const tutor = await session;
      for await (const event of tutor.send({ text })) {
        if (event.type === "text") {
          emit({ type: "tutor_text", text: event.text });
        } else if (event.type === "turn_end") {
          emit({
            type: "turn_end",
            outcome: event.outcome === "ended_by_tool" ? "done" : event.outcome,
            ...(event.error === undefined ? {} : { error: event.error }),
          });
          return;
        }
      }
      emit({
        type: "turn_end",
        outcome: "error",
        error: "The tutor's reply ended early.",
      });
    } catch (error) {
      emit({
        type: "turn_end",
        outcome: "error",
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      turnRunning = false;
    }
  }

  return {
    id,
    events: () => log,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    start() {
      if (session !== undefined) {
        return { ok: false, status: 409, error: "The chat has started." };
      }
      session = options.backend.startSession({
        systemPrompt: options.systemPrompt,
        tools: [askQuestion],
      });
      // A failed start is reported by the first turn.
      session.catch(() => {});
      enqueue(OPENING_TURN);
      return { ok: true };
    },
    say(text) {
      if (session === undefined) {
        return { ok: false, status: 409, error: "Start the chat first." };
      }
      emit({ type: "learner", text });
      enqueue(messageTurn(text, openQuestion()?.id));
      return { ok: true };
    },
    answer(submission) {
      const question = questions.find((q) => q.id === submission.questionId);
      if (question === undefined) {
        return { ok: false, status: 404, error: "No such question." };
      }
      if (question.verdict !== undefined) {
        return { ok: false, status: 409, error: "Already answered." };
      }
      if (
        submission.kind === "choice" &&
        CHOICE_LETTERS.indexOf(submission.choice) >=
          question.input.choices.length
      ) {
        return { ok: false, status: 400, error: "No such choice." };
      }
      const verdict = gradeChoice(question.input.answer, submission);
      question.verdict = verdict;
      emit({
        type: "graded",
        questionId: question.id,
        verdict,
        choice: submission.kind === "choice" ? submission.choice : null,
        confidence: submission.kind === "choice" ? submission.confidence : null,
        correctChoice: question.input.answer,
      });
      enqueue(answerTurn(question, submission, verdict));
      return { ok: true };
    },
    async interrupt() {
      if (turnRunning && session !== undefined)
        await (await session).interrupt();
    },
    settled: () => queue,
    async close() {
      if (session !== undefined) await (await session).close();
    },
  };
}

// --- Turns: a header saying what is allowed now, then the content ---------

const OPENING_TURN =
  "[Start of the session. Allowed now: teach the topic in your instructions " +
  "briefly, then post one multiple-choice check question on it with " +
  "ask_question.]";

function messageTurn(text: string, openQuestionId: string | undefined): string {
  const open =
    openQuestionId === undefined
      ? "Post a question with ask_question only if the learner asks for one."
      : `Question ${openQuestionId} is still open: do not reveal or hint at its answer.`;
  return `[Message from the learner. Allowed now: reply. ${open}]\n${text}`;
}

function answerTurn(
  question: PostedQuestion,
  submission: AnswerSubmission,
  verdict: Verdict,
): string {
  const { choices, answer } = question.input;
  const choiceText = (letter: (typeof CHOICE_LETTERS)[number]) =>
    `${letter} ("${choices[CHOICE_LETTERS.indexOf(letter)]}")`;
  const header =
    `[Answer submitted for ${question.id}. Allowed now: brief feedback on ` +
    "this answer. Post another question only if the learner asks for one.]";
  if (submission.kind === "unknown") {
    return [
      header,
      `The learner answered "I don't know". It counts as a miss.`,
      `The correct choice is ${choiceText(answer)}. Explain it.`,
    ].join("\n");
  }
  const reasoning = submission.reasoning?.trim();
  return [
    header,
    `The learner chose ${choiceText(submission.choice)} with confidence ${confidenceLabel(submission.confidence)}.`,
    reasoning ? `Reasoning given: "${reasoning}"` : "No reasoning given.",
    `The engine graded it ${verdict}. The correct choice is ${choiceText(answer)}.`,
  ].join("\n");
}
