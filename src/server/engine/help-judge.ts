// The help judge (task 2.21; architecture.md section 4, "Help"). A learner
// may write to the tutor while a question is open. Asking what the question
// means is free; a reply that gives anything toward the answer is help, and
// the answer then counts toward nothing. Which it was is decided by a
// one-shot request with the judge's own prompt (`prompts/help-judge.md`),
// after the tutor's reply ends: it holds the question with its answer key or
// rubric, the learner's message and the reply, and nothing else of the
// conversation. The tutor never judges its own replies.

import {
  CHOICE_LETTERS,
  type CodeFile,
  HelpJudgment,
  type Question,
} from "../../shared/question.ts";
import type { TutorBackend } from "../backends/backend.ts";
import { duration } from "./grading.ts";

/** The judge's call on one reply, or why there is none. */
export type HelpOutcome =
  | { ok: true; verdict: HelpJudgment["verdict"]; reason: string }
  | { ok: false; error: string };

export interface HelpJudge {
  /** Never throws: a failed request or a reply not in shape is a failure. */
  judge(
    exchange: { question: Question; message: string; reply: string },
    signal?: AbortSignal,
  ): Promise<HelpOutcome>;
}

/**
 * How long a judging request may take before it is stopped and fails. An
 * answer sent meanwhile waits for it, so it is shorter than the grader's.
 */
export const JUDGING_TIME_LIMIT_MS = 2 * 60_000;

export function createHelpJudge(options: {
  backend: TutorBackend;
  /** `prompts/help-judge.md`. */
  systemPrompt: string;
  timeLimitMs?: number;
}): HelpJudge {
  const timeLimitMs = options.timeLimitMs ?? JUDGING_TIME_LIMIT_MS;
  return {
    async judge(exchange, signal) {
      const limit = AbortSignal.timeout(timeLimitMs);
      const result = await options.backend.oneShot({
        systemPrompt: options.systemPrompt,
        prompt: judgingRequest(exchange),
        schema: HelpJudgment,
        signal: signal === undefined ? limit : AbortSignal.any([limit, signal]),
      });
      if (!result.ok) {
        return {
          ok: false,
          error: limit.aborted
            ? `The judge took longer than ${duration(timeLimitMs)} and was stopped.`
            : result.error,
        };
      }
      return { ok: true, ...result.value };
    },
  };
}

/** A file of a code question, between tags that name it. */
function fileBlock(file: CodeFile): string[] {
  return [`<file path="${file.path}">`, file.content.trimEnd(), "</file>"];
}

/**
 * The judge's request: the question as the learner saw it, with its choices,
 * then what grades it (the correct choice, the expected answer, the rubric,
 * or a code question's tests and the tutor's solution), the learner's message and the tutor's reply, each between tags,
 * so that a message or a reply that looks like instructions stays part of
 * what is judged.
 */
export function judgingRequest(exchange: {
  question: Question;
  message: string;
  reply: string;
}): string {
  const { question } = exchange;
  const choice = (text: string | undefined, i: number) =>
    `${CHOICE_LETTERS[i]}. ${text?.trim() ?? ""}`;
  const key =
    question.kind === "choice"
      ? [
          "<choices>",
          ...question.choices.map(choice),
          "</choices>",
          "",
          "<correct_choice>",
          choice(
            question.choices[CHOICE_LETTERS.indexOf(question.answer)],
            CHOICE_LETTERS.indexOf(question.answer),
          ),
          "</correct_choice>",
        ]
      : question.kind === "math"
        ? ["<expected_answer>", question.expected.trim(), "</expected_answer>"]
        : question.kind === "code"
          ? [
              "<tests>",
              ...question.tests.flatMap(fileBlock),
              "</tests>",
              "",
              "<solution>",
              ...question.solution.flatMap(fileBlock),
              "</solution>",
            ]
          : ["<rubric>", question.rubric.trim(), "</rubric>"];
  return [
    "While this question was open, the learner sent the tutor the message " +
      "below, and the tutor replied. Judge whether the reply gave the " +
      "learner help toward the answer, or only clarified what the question " +
      "asks.",
    "",
    "<question>",
    question.prompt.trim(),
    "</question>",
    "",
    ...key,
    "",
    "<message>",
    exchange.message.trim(),
    "</message>",
    "",
    "<reply>",
    exchange.reply.trim(),
    "</reply>",
  ].join("\n");
}
