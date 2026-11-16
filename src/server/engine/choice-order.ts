// The order a choice question's choices are shown in (task 2.17). The tutor
// puts the correct choice first in most questions, and asked to place it at a
// random letter it wrote a wrong answer key (task 2.16), so the engine
// shuffles the choices once, when the question is posted, and moves the
// answer letter with the correct choice. The question is stored in that
// order, so the page, the evidence and the tutor's later turns agree.

import { randomInt } from "node:crypto";
import {
  CHOICE_LETTERS,
  type ChoiceLetter,
  type ChoiceQuestion,
} from "../../shared/question.ts";

/**
 * The order to show `count` choices in: a permutation of their indices, so
 * that position `i` shows the choice the tutor listed at `order[i]`.
 */
export type ChoiceOrder = (count: number) => number[];

/** A uniformly random order (Fisher and Yates), from a secure source. */
export const randomOrder: ChoiceOrder = (count) => {
  const order = givenOrder(count);
  for (let i = count - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    const at = order[i] as number;
    order[i] = order[j] as number;
    order[j] = at;
  }
  return order;
};

/** The order the tutor listed them in. */
export const givenOrder: ChoiceOrder = (count) =>
  Array.from({ length: count }, (_, i) => i);

/**
 * The question with its choices in `order`, and its answer the letter the
 * correct choice has there. An order that is not a permutation of the
 * choices leaves the question as it is.
 */
export function reorder(
  question: ChoiceQuestion,
  order: readonly number[],
): ChoiceQuestion {
  const count = question.choices.length;
  const permutation =
    order.length === count &&
    new Set(order).size === count &&
    order.every((i) => Number.isInteger(i) && i >= 0 && i < count);
  if (!permutation) return question;
  const correct = CHOICE_LETTERS.indexOf(question.answer);
  return {
    ...question,
    choices: order.map((i) => question.choices[i] as string),
    answer: CHOICE_LETTERS[order.indexOf(correct)] as ChoiceLetter,
  };
}
