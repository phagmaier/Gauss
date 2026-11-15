import { expect, test } from "vitest";
import type { ChoiceQuestionInput } from "../../shared/question.ts";
import { askQuestionTool } from "./ask-question.ts";

const QUESTION = {
  objective: "Apply the power rule",
  prompt: "What is the derivative of x³?",
  choices: ["3x²", "x²", "3x³"],
  answer: "A",
};

function setUp(open?: string) {
  const posted: ChoiceQuestionInput[] = [];
  const tool = askQuestionTool({
    openQuestionId: () => open,
    post(question) {
      posted.push(question);
      return `q${posted.length}`;
    },
  });
  return { posted, tool };
}

test("a question is posted and ends the tutor's turn", async () => {
  const { posted, tool } = setUp();

  expect(await tool.run(QUESTION)).toEqual({
    status: "done",
    text: "Posted as q1. Your turn is over; the learner's answer will arrive in the next message.",
    endTurn: true,
  });
  expect(posted).toEqual([QUESTION]);
});

test("a second question while one is open is refused with the reason", async () => {
  const { posted, tool } = setUp("q1");

  expect(await tool.run({ ...QUESTION, prompt: "Another one?" })).toEqual({
    status: "refused",
    text: "Question q1 is still open. End your turn and wait for the learner's answer.",
  });
  expect(posted).toEqual([]);
});

test("a question whose answer is not one of its choices is refused with the reason", async () => {
  const { posted, tool } = setUp();

  const result = await tool.run({ ...QUESTION, answer: "D" });

  expect(result.status).toBe("refused");
  expect(result.text).toContain(
    "The answer must be the letter of one of the choices.",
  );
  expect(posted).toEqual([]);
});
