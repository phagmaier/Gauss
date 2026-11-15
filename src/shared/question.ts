// Check questions: what the tutor posts, what the record keeps, what the page
// shows, and what the learner sends back. Only multiple choice so far (plan task 0.5); the other
// answer kinds in architecture.md section 6 join in stages 2 and 3.

import { z } from "zod";

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

/** A multiple-choice question's fields, grading material included. */
const choiceFields = {
  prompt: z
    .string()
    .min(1)
    .describe("The question, in plain text. Do not list the choices here."),
  choices: z
    .array(z.string().min(1))
    .min(2)
    .max(CHOICE_LETTERS.length)
    .describe(
      "The choices in display order. The learner sees them labelled A, B, C and so on.",
    ),
  answer: ChoiceLetter.describe(
    "The letter of the correct choice. Never shown to the learner.",
  ),
};

function answerIsAChoice(q: {
  choices: string[];
  answer: ChoiceLetter;
}): boolean {
  return CHOICE_LETTERS.indexOf(q.answer) < q.choices.length;
}
const NOT_A_CHOICE = {
  message: "The answer must be the letter of one of the choices.",
  path: ["answer"],
};

/** A multiple-choice question as the tutor posts it, grading material included. */
export const ChoiceQuestionInput = z
  .object({
    objective: z
      .string()
      .min(1)
      .describe("The objective the question checks, in a few words"),
    ...choiceFields,
  })
  .refine(answerIsAChoice, NOT_A_CHOICE);
export type ChoiceQuestionInput = z.infer<typeof ChoiceQuestionInput>;

/**
 * A posted question as the record keeps it, in `state.json` while it is open
 * and in the evidence once answered: what the learner saw and the grading
 * material. The objective it checks is kept beside it, by id.
 */
export const ChoiceQuestion = z
  .object({ kind: z.literal("choice"), ...choiceFields })
  .refine(answerIsAChoice, NOT_A_CHOICE);
export type ChoiceQuestion = z.infer<typeof ChoiceQuestion>;

/** Every kind of posted question. Written answers join in task 2.8. */
export const Question = z.discriminatedUnion("kind", [ChoiceQuestion]);
export type Question = z.infer<typeof Question>;

/** A posted question as the page sees it: never the answer. */
export const QuestionView = z.object({
  id: z.string(),
  number: z.number().int().positive(),
  prompt: z.string(),
  choices: z.array(z.string()),
});
export type QuestionView = z.infer<typeof QuestionView>;

/** The learner's answer, or "I don't know", which asks no confidence. */
export const AnswerSubmission = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("choice"),
    questionId: z.string(),
    choice: ChoiceLetter,
    confidence: Confidence,
    reasoning: z.string().max(10_000).optional(),
  }),
  z.object({
    kind: z.literal("unknown"),
    questionId: z.string(),
  }),
]);
export type AnswerSubmission = z.infer<typeof AnswerSubmission>;

/** "unknown" is the learner's "I don't know": a miss, never a confident one. */
export const Verdict = z.enum(["correct", "incorrect", "unknown"]);
export type Verdict = z.infer<typeof Verdict>;
