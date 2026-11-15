import { expect, test } from "vitest";
import type { ChoiceQuestionInput } from "../../shared/question.ts";
import { askQuestionTool } from "./ask-question.ts";

const QUESTION = {
  objective: "power-rule",
  prompt: "What is the derivative of x³?",
  choices: ["3x²", "x²", "3x³"],
  answer: "A",
};

/** A board that posts everything, or refuses everything with this reason. */
function setUp(refusal?: string) {
  const posted: ChoiceQuestionInput[] = [];
  const tool = askQuestionTool({
    async post(question) {
      if (refusal !== undefined) return { refused: refusal };
      posted.push(question);
      return { id: `q${posted.length}`, number: posted.length };
    },
  });
  return { posted, tool };
}

test("a question is posted and ends the tutor's turn", async () => {
  const { posted, tool } = setUp();

  expect(await tool.run(QUESTION)).toEqual({
    status: "done",
    text: "Posted as question 1. Your turn is over; the learner's answer will arrive in the next message.",
    endTurn: true,
  });
  expect(posted).toEqual([QUESTION]);
});

test("the board's refusal reaches the tutor and does not end its turn", async () => {
  const { tool } = setUp("Question 1 is still open.");

  expect(await tool.run(QUESTION)).toEqual({
    status: "refused",
    text: "Question 1 is still open.",
  });
});

test.each([
  {
    name: "an answer that is not one of its choices",
    input: { ...QUESTION, answer: "D" },
    reason: "The answer must be the letter of one of the choices.",
  },
  {
    name: "an objective named in words rather than by its id",
    input: { ...QUESTION, objective: "Apply the power rule" },
    reason: "Use lowercase letters, digits and single hyphens",
  },
])(
  "a question with $name is refused with the reason, before the board",
  async ({ input, reason }) => {
    const { posted, tool } = setUp();

    const result = await tool.run(input);

    expect(result.status).toBe("refused");
    expect(result.text).toContain(reason);
    expect(posted).toEqual([]);
  },
);
