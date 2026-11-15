// One chat with the tutor, as the minimal page needs it (plan task 0.5): the
// tutor teaches, posts a multiple-choice question, and responds to the graded
// answer. The chat grades answers itself; its event log and turn queue are
// the shared ones in conversation.ts. Everything is in memory. Task 1.5
// replaces this demo with the intake chat.

import type { PageEvent } from "../../shared/events.ts";
import {
  type AnswerSubmission,
  CHOICE_LETTERS,
  type ChoiceQuestionInput,
  confidenceLabel,
  type Verdict,
} from "../../shared/question.ts";
import type { TutorBackend } from "../backends/backend.ts";
import { askQuestionTool } from "../tools/ask-question.ts";
import {
  type ChatResult,
  createConversation,
  createEventLog,
} from "./conversation.ts";
import { gradeChoice } from "./grading.ts";

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
  const log = createEventLog();
  const questions: PostedQuestion[] = [];

  function openQuestion(): PostedQuestion | undefined {
    return questions.find((q) => q.verdict === undefined);
  }

  const askQuestion = askQuestionTool({
    openQuestionId: () => openQuestion()?.id,
    post(input) {
      const question = { id: `q${questions.length + 1}`, input };
      questions.push(question);
      log.emit({
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

  const tutor = createConversation({
    backend: options.backend,
    systemPrompt: options.systemPrompt,
    tools: [askQuestion],
    log,
  });

  return {
    id: log.id,
    events: log.events,
    subscribe: log.subscribe,
    start() {
      if (tutor.started()) {
        return { ok: false, status: 409, error: "The chat has started." };
      }
      tutor.send(OPENING_TURN);
      return { ok: true };
    },
    say(text) {
      if (!tutor.started()) {
        return { ok: false, status: 409, error: "Start the chat first." };
      }
      log.emit({ type: "learner", text });
      tutor.send(messageTurn(text, openQuestion()?.id));
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
      log.emit({
        type: "graded",
        questionId: question.id,
        verdict,
        choice: submission.kind === "choice" ? submission.choice : null,
        confidence: submission.kind === "choice" ? submission.confidence : null,
        correctChoice: question.input.answer,
      });
      tutor.send(answerTurn(question, submission, verdict));
      return { ok: true };
    },
    interrupt: tutor.interrupt,
    settled: tutor.settled,
    close: tutor.close,
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
