// Check questions: what the tutor posts, what the record keeps, what the page
// shows, and what the learner sends back. Two answer kinds so far: multiple
// choice, graded by the engine, and written answers (proofs, derivations,
// explanations), graded against a rubric by a separate model call (task
// 2.8). The other kinds in architecture.md section 6 join in stage 3.

import { z } from "zod";
import { Slug } from "./course.ts";

/** Choices are labelled by position, and the tutor names them the same way. */
export const CHOICE_LETTERS = ["A", "B", "C", "D", "E", "F"] as const;
export const ChoiceLetter = z.enum(CHOICE_LETTERS);
export type ChoiceLetter = z.infer<typeof ChoiceLetter>;

/** How sure the learner is, in the five levels of brief.md. */
export const Confidence = z.enum(["under-50", "50", "75", "90", "100"]);
export type Confidence = z.infer<typeof Confidence>;

export function confidenceLabel(confidence: Confidence): string {
  return confidence === "under-50" ? "under 50%" : `${confidence}%`;
}

/** "Confident" means 90% or 100% (brief.md, "Confidence"). */
export function isConfident(confidence: Confidence): boolean {
  return confidence === "90" || confidence === "100";
}

// --- The fields, described for the tutor -------------------------------------

const prompt = z
  .string()
  .min(1)
  .describe(
    "The question, in Markdown, with LaTeX math between $ signs. For a choice question, do not list the choices here.",
  );
const choices = z
  .array(z.string().min(1))
  .min(2)
  .max(CHOICE_LETTERS.length)
  .describe(
    "Choice questions only: the choices in display order, each one line of Markdown with LaTeX math between $ signs. The learner sees them labelled A, B, C and so on.",
  );
const answer = ChoiceLetter.describe(
  "Choice questions only: the letter of the correct choice. Never shown to the learner.",
);
const rubric = z
  .string()
  .min(1)
  .describe(
    "Written questions only: how to grade the answer, for a grader who sees only the question, this rubric and the answer. Say what a complete, correct answer must establish, step by step, and the errors or gaps that make it wrong. Never shown to the learner.",
  );

function answerIsAChoice(q: {
  choices: string[];
  answer: ChoiceLetter;
}): boolean {
  return CHOICE_LETTERS.indexOf(q.answer) < q.choices.length;
}
const NOT_A_CHOICE = "The answer must be the letter of one of the choices.";

// --- What the tutor posts ----------------------------------------------------

/**
 * A question as the tutor posts it with ask_question, grading material
 * included. One object for both kinds, because a tool's input is described
 * by its fields; which fields a kind takes is checked here.
 */
export const QuestionInput = z
  .object({
    objective: Slug.describe(
      "The id of the objective the question checks: one of the segment's objectives, as the header lists them",
    ),
    kind: z
      .enum(["choice", "written"])
      .describe(
        '"choice": the learner picks one of the choices, graded against `answer`. "written": the learner writes the answer (a proof, a derivation, an explanation), graded against `rubric` by a separate grader.',
      ),
    prompt,
    choices: choices.optional(),
    answer: answer.optional(),
    rubric: rubric.optional(),
  })
  .superRefine((q, ctx) => {
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: "custom", path: [path], message });
    if (q.kind === "choice") {
      if (q.choices === undefined) {
        issue("choices", "A choice question needs its choices.");
      }
      if (q.answer === undefined) {
        issue("answer", "A choice question needs the letter of its answer.");
      }
      if (
        q.choices !== undefined &&
        q.answer !== undefined &&
        !answerIsAChoice({ choices: q.choices, answer: q.answer })
      ) {
        issue("answer", NOT_A_CHOICE);
      }
      if (q.rubric !== undefined) {
        issue(
          "rubric",
          "A choice question has no rubric: its answer grades it.",
        );
      }
    } else {
      if (q.rubric === undefined) {
        issue("rubric", "A written question needs a rubric to be graded by.");
      }
      if (q.choices !== undefined || q.answer !== undefined) {
        issue(
          q.choices !== undefined ? "choices" : "answer",
          "A written question has no choices and no answer letter: the learner writes the answer.",
        );
      }
    }
  });
export type QuestionInput = z.infer<typeof QuestionInput>;

// --- What the record keeps ---------------------------------------------------

/**
 * A posted question as the record keeps it, in `state.json` while it is open
 * and in the evidence once answered: what the learner saw and the grading
 * material. The objective it checks is kept beside it, by id.
 */
export const ChoiceQuestion = z
  .object({ kind: z.literal("choice"), prompt, choices, answer })
  .refine(answerIsAChoice, { message: NOT_A_CHOICE, path: ["answer"] });
export type ChoiceQuestion = z.infer<typeof ChoiceQuestion>;

export const WrittenQuestion = z.object({
  kind: z.literal("written"),
  prompt,
  rubric,
});
export type WrittenQuestion = z.infer<typeof WrittenQuestion>;

export const Question = z.discriminatedUnion("kind", [
  ChoiceQuestion,
  WrittenQuestion,
]);
export type Question = z.infer<typeof Question>;

/**
 * The question a checked input describes, as the record keeps it: the
 * fields of its kind, the objective left beside it.
 */
export function postedQuestion({
  objective: _,
  ...fields
}: QuestionInput): Question {
  return Question.parse(fields);
}

// --- What the page sees and sends --------------------------------------------

/** A posted question as the page sees it: never the answer or the rubric. */
export const QuestionView = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("choice"),
    id: z.string(),
    number: z.number().int().positive(),
    prompt: z.string(),
    choices: z.array(z.string()),
  }),
  z.object({
    kind: z.literal("written"),
    id: z.string(),
    number: z.number().int().positive(),
    prompt: z.string(),
  }),
]);
export type QuestionView = z.infer<typeof QuestionView>;

/**
 * A written answer as the learner sends it. It is its own reasoning, so it
 * has no separate field for that (mock 2).
 */
export const WrittenAnswer = z.object({
  kind: z.literal("written"),
  questionId: z.string(),
  text: z.string().trim().min(1).max(20_000),
  confidence: Confidence,
});
export type WrittenAnswer = z.infer<typeof WrittenAnswer>;

/** The learner's answer, or "I don't know", which asks no confidence. */
export const AnswerSubmission = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("choice"),
    questionId: z.string(),
    choice: ChoiceLetter,
    confidence: Confidence,
    reasoning: z.string().max(10_000).optional(),
  }),
  WrittenAnswer,
  z.object({
    kind: z.literal("unknown"),
    questionId: z.string(),
  }),
]);
export type AnswerSubmission = z.infer<typeof AnswerSubmission>;

/** "unknown" is the learner's "I don't know": a miss, never a confident one. */
export const Verdict = z.enum(["correct", "incorrect", "unknown"]);
export type Verdict = z.infer<typeof Verdict>;

// --- What the grader returns -------------------------------------------------

/**
 * The grader's reply on a written answer (architecture.md section 6), asked
 * of the model as JSON in this shape and checked against it. A flaw named on
 * a correct answer is not kept.
 */
export const WrittenGrade = z
  .object({
    verdict: z
      .enum(["correct", "incorrect"])
      .describe(
        '"correct" only if the answer meets the rubric in full; otherwise "incorrect".',
      ),
    flaw: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe(
        "Required when the verdict is incorrect: the first flawed step or the first missing element, pointed at so the learner can find it, and what is wrong with it. Leave it out when the answer is correct.",
      ),
  })
  .refine((g) => g.verdict === "correct" || g.flaw !== undefined, {
    message:
      "An incorrect verdict must name the first flawed step or missing element.",
    path: ["flaw"],
  });
export type WrittenGrade = z.infer<typeof WrittenGrade>;
