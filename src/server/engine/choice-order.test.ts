import { expect, test } from "vitest";
import type { ChoiceQuestion } from "../../shared/question.ts";
import { givenOrder, randomOrder, reorder } from "./choice-order.ts";

const QUESTION: ChoiceQuestion = {
  kind: "choice",
  prompt: "What is $2 + 2$?",
  choices: ["$3$", "$4$", "$5$"],
  answer: "B",
};

test("reordering shows each position the choice the order names there, and moves the answer letter with the correct choice", () => {
  expect(reorder(QUESTION, [2, 0, 1])).toEqual({
    ...QUESTION,
    choices: ["$5$", "$3$", "$4$"],
    answer: "C",
  });
  expect(reorder(QUESTION, givenOrder(3))).toEqual(QUESTION);
});

test.each([
  { name: "too short", order: [1, 0] },
  { name: "a repeat", order: [0, 0, 1] },
  { name: "out of range", order: [0, 1, 3] },
])(
  "an order that is not a permutation ($name) leaves the question as it is",
  ({ order }) => {
    expect(reorder(QUESTION, order)).toEqual(QUESTION);
  },
);

test("a random order is a permutation, and puts the first choice at every position over many questions", () => {
  const firstAt = new Set<number>();
  for (let run = 0; run < 400; run += 1) {
    const order = randomOrder(4);
    expect([...order].sort()).toEqual([0, 1, 2, 3]);
    firstAt.add(order.indexOf(0));
  }
  // Each position is missed with probability (3/4)^400 in a uniform order.
  expect([...firstAt].sort()).toEqual([0, 1, 2, 3]);
});
