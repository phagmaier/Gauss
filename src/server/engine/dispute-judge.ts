// The dispute judge (task 3.8; architecture.md section 6, "Disputes"): one
// one-shot request with its own prompt (`prompts/dispute-judge.md`), which
// sees the question as the learner saw it, what the answer was graded by,
// the answer, the grade and the learner's reason, each between tags, and
// nothing of the conversation, as the grader does. Its reply says what the
// grade should be, and for a choice question which choice is correct, so a
// wrong key is corrected; for a math question a wrong expected expression
// is a wrong key, and the reply can give the right one.

import {
  DisputeJudgment,
  type DisputeOutcome,
  type DisputeJudgment as Judgment,
} from "../../shared/dispute.ts";
import type { AnswerEvidence } from "../../shared/evidence.ts";
import {
  CHOICE_LETTERS,
  type ChoiceLetter,
  type ChoiceQuestion,
  type CodeFile,
} from "../../shared/question.ts";
import type { TutorBackend } from "../backends/backend.ts";
import { duration, mathRubric } from "./grading.ts";

/** A dispute's outcome, or why there is none. */
export type DisputeDecision =
  | { ok: true; outcome: DisputeOutcome }
  | { ok: false; error: string };

export interface DisputeJudge {
  /**
   * Decides the dispute of a recorded answer. Never throws: a failed
   * request, or a reply not in shape or at odds with itself, is a failure.
   */
  decide(
    answer: AnswerEvidence,
    reason: string,
    signal?: AbortSignal,
  ): Promise<DisputeDecision>;
}

/** How long a deciding request may take before it is stopped and fails; the grader's. */
export const DECIDING_TIME_LIMIT_MS = 3 * 60_000;

export function createDisputeJudge(options: {
  backend: TutorBackend;
  /** `prompts/dispute-judge.md`. */
  systemPrompt: string;
  timeLimitMs?: number;
}): DisputeJudge {
  const timeLimitMs = options.timeLimitMs ?? DECIDING_TIME_LIMIT_MS;
  return {
    async decide(answer, reason, signal) {
      const limit = AbortSignal.timeout(timeLimitMs);
      const result = await options.backend.oneShot({
        systemPrompt: options.systemPrompt,
        prompt: disputeRequest(answer, reason),
        schema: DisputeJudgment,
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
      return disputeOutcome(answer, result.value);
    },
  };
}

/**
 * The outcome the judge's reply gives the answer. A key is kept only for a
 * choice question, and an expected expression only for a math one, each
 * only when it differs from the question's. A choice question's verdict
 * follows from its key: a reply whose verdict and key disagree, or whose key
 * is not one of the choices, is a failure. An "I don't know" stays a miss,
 * "unknown", whatever verdict the reply gives: only its key can change.
 */
export function disputeOutcome(
  entry: AnswerEvidence,
  judgment: Judgment,
): DisputeDecision {
  const { question, answer } = entry;
  const { reason } = judgment;
  if (question.kind === "choice") {
    const picked = answer.kind === "choice" ? answer.choice : undefined;
    // Without a key, a correct verdict names the choice picked; an incorrect
    // one, or an "I don't know", keeps the key.
    const key =
      judgment.key ??
      (judgment.verdict === "correct" && picked !== undefined
        ? picked
        : question.answer);
    if (CHOICE_LETTERS.indexOf(key) >= question.choices.length) {
      return {
        ok: false,
        error: `The judge named choice ${key}, which the question does not have.`,
      };
    }
    const corrected = key === question.answer ? {} : { key };
    if (picked === undefined) {
      return {
        ok: true,
        outcome: { verdict: "unknown", reason, ...corrected },
      };
    }
    const verdict = key === picked ? "correct" : "incorrect";
    if (verdict !== judgment.verdict) {
      return {
        ok: false,
        error: `The judge's verdict, ${judgment.verdict}, does not follow from the correct choice it named, ${key}.`,
      };
    }
    return { ok: true, outcome: { verdict, reason, ...corrected } };
  }
  const expected =
    question.kind === "math" &&
    judgment.expected !== undefined &&
    spaced(judgment.expected) !== spaced(question.expected)
      ? judgment.expected
      : undefined;
  return {
    ok: true,
    outcome: {
      verdict: answer.kind === "unknown" ? "unknown" : judgment.verdict,
      reason,
      ...(expected === undefined ? {} : { expected }),
    },
  };
}

const spaced = (text: string) => text.replaceAll(/\s+/g, "");

/**
 * The judge's request: the question as the learner saw it, with its
 * choices; what graded the answer (the key, the expected answer, with the
 * rubric the grader had when the symbolic check left it to the grader, the
 * rubric, or the tests and their command); the answer with any reasoning;
 * the grade, with the grader's flaw or the tests' output; and the learner's
 * reason. Each is between tags, so that an answer or a reason that reads
 * like instructions stays what it is. Not the confidence, which must not
 * sway the outcome, and nothing of the conversation. For an "I don't know",
 * which has no grade, the question, the answer shown and the reason, and not
 * where the learner got stuck, which says nothing of the answer shown.
 */
export function disputeRequest(entry: AnswerEvidence, reason: string): string {
  const { question, answer } = entry;
  const tag = (name: string, text: string) => [
    `<${name}>`,
    text.trim(),
    `</${name}>`,
    "",
  ];
  const lines = [
    answer.kind === "unknown"
      ? `The learner answered "I don't know" to this question, which stays a miss. ` +
        "They say the answer shown to them afterwards as the right one is wrong. " +
        "Decide whether it is."
      : "The learner disputes the grade of their answer to this question. " +
        "Decide what the grade should be.",
    "",
    ...tag("question", question.prompt),
  ];
  const reasoning = (said: string | undefined) =>
    said === undefined || said.trim() === "" ? [] : tag("reasoning", said);

  if (answer.kind === "unknown") {
    if (question.kind === "choice") {
      lines.push(
        ...tag("choices", choiceList(question)),
        ...tag("key", choiceLine(question, question.answer)),
      );
    } else if (question.kind === "math") {
      lines.push(...tag("expected_answer", question.expected));
    } else {
      // Nothing was shown (disputes.ts refuses it).
      throw new Error(
        `"I don't know" to a ${question.kind} question shows no answer.`,
      );
    }
    lines.push(...tag("answer", "I don't know"));
  } else if (question.kind === "choice" && answer.kind === "choice") {
    lines.push(
      ...tag("choices", choiceList(question)),
      ...tag("graded_by", "The choice picked, matched against the key."),
      ...tag("key", choiceLine(question, question.answer)),
      ...tag("answer", choiceLine(question, answer.choice)),
      ...reasoning(answer.reasoning),
      ...tag("grade", entry.verdict),
    );
  } else if (question.kind === "math" && answer.kind === "math") {
    const { unsettled } = entry;
    const how =
      unsettled === undefined
        ? `The symbolic check, which compares the answer with the expected answer, found them ${entry.verdict === "correct" ? "equal" : "not equal"}.`
        : `The symbolic check ${
            unsettled.result === "unparsable"
              ? "could not read the answer"
              : unsettled.result === "undecided"
                ? "could not decide whether the answer equals the expected answer"
                : "did not run"
          } (${unsettled.reason}), so a grader graded it against the rubric below.`;
    lines.push(
      ...tag("expected_answer", question.expected),
      ...tag("graded_by", how),
      ...(unsettled === undefined ? [] : tag("rubric", mathRubric(question))),
      ...tag("answer", answer.expression),
      ...reasoning(answer.reasoning),
      ...tag("grade", entry.verdict),
      ...(entry.flaw === undefined ? [] : tag("flaw", entry.flaw)),
    );
  } else if (question.kind === "written" && answer.kind === "written") {
    lines.push(
      ...tag("graded_by", "A grader, against the rubric below."),
      ...tag("rubric", question.rubric),
      ...tag("answer", answer.text),
      ...reasoning(answer.reasoning),
      ...tag("grade", entry.verdict),
      ...(entry.flaw === undefined ? [] : tag("flaw", entry.flaw)),
    );
  } else if (question.kind === "code" && answer.kind === "code") {
    lines.push(
      ...tag(
        "graded_by",
        "The tests below, run with the command below on the learner's files and the saved inputs (if shown); exit status 0 is correct, anything else incorrect.",
      ),
      "<tests>",
      ...question.tests.flatMap(fileBlock),
      "</tests>",
      "",
      ...(question.inputs?.length
        ? [
            "<inputs>",
            ...question.inputs.flatMap((file) => [
              `<file path="${file.path}" executable="${file.executable === true}">`,
              file.content,
              "</file>",
            ]),
            "</inputs>",
            "",
          ]
        : []),
      ...tag("command", question.command.join(" ")),
      "<answer>",
      ...answer.files.flatMap(fileBlock),
      "</answer>",
      "",
      ...reasoning(answer.reasoning),
      ...tag("grade", entry.verdict),
      ...tag("output", entry.output ?? ""),
    );
  } else {
    // The evidence's schema refuses an answer of another kind.
    throw new Error("The answer is not of its question's kind.");
  }
  lines.push("<reason>", reason.trim(), "</reason>");
  return lines.join("\n");
}

/** A choice by its letter and its text, as the request lists it. */
function choiceLine(question: ChoiceQuestion, letter: ChoiceLetter): string {
  return `${letter}. ${question.choices[CHOICE_LETTERS.indexOf(letter)]?.trim() ?? ""}`;
}

function choiceList(question: ChoiceQuestion): string {
  return CHOICE_LETTERS.slice(0, question.choices.length)
    .map((letter) => choiceLine(question, letter))
    .join("\n");
}

/** A file of a code question, between tags that name it. */
function fileBlock(file: CodeFile): string[] {
  return [`<file path="${file.path}">`, file.content.trimEnd(), "</file>"];
}
