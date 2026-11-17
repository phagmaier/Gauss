import { expect, test } from "vitest";
import {
  type ChoiceQuestion,
  postedQuestion,
  type QuestionInput,
} from "../../shared/question.ts";
import { askQuestionTool } from "./ask-question.ts";

const QUESTION = {
  objective: "power-rule",
  kind: "choice",
  prompt: "What is the derivative of x³?",
  choices: ["3x²", "x²", "3x³"],
  answer: "A",
};

/**
 * A board that posts everything, as the tutor gave it unless `shown` is
 * given, or refuses everything with this reason.
 */
function setUp(refusal?: string, shown?: ChoiceQuestion) {
  const posted: QuestionInput[] = [];
  const tool = askQuestionTool({
    async post(question) {
      if (refusal !== undefined) return { refused: refusal };
      posted.push(question);
      return {
        id: `q${posted.length}`,
        number: posted.length,
        question: shown ?? postedQuestion(question),
      };
    },
  });
  return { posted, tool };
}

test("a choice question is posted and ends the tutor's turn, which is told the order the learner sees the choices in", async () => {
  // Shuffled by the board: the correct choice, 3x², is now C.
  const { posted, tool } = setUp(undefined, {
    kind: "choice",
    prompt: QUESTION.prompt,
    choices: ["x²", "3x³", "3x²"],
    answer: "C",
  });

  expect(await tool.run(QUESTION)).toEqual({
    status: "done",
    text:
      "Posted as question 1. The app shuffled the choices. The learner sees them in this order, so use these letters from now on:\n" +
      "A. x²\n" +
      "B. 3x³\n" +
      "C. 3x²\n" +
      "The correct one is C. Your turn is over; the learner's answer will arrive in the next message.",
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

const WRITTEN = {
  objective: "power-rule",
  kind: "written",
  prompt: "Show that the derivative of $x^3$ is $3x^2$, from the definition.",
  rubric:
    "Expands $(x+h)^3$, divides by $h$, and takes the limit as $h \\to 0$.",
};

test("a written question is posted with its rubric", async () => {
  const { posted, tool } = setUp();

  expect(await tool.run(WRITTEN)).toEqual({
    status: "done",
    text: "Posted as question 1. Your turn is over; the learner's answer will arrive in the next message.",
    endTurn: true,
  });
  expect(posted).toEqual([WRITTEN]);
});

const MATH = {
  objective: "power-rule",
  kind: "math",
  prompt: "Give the derivative of $x^3$.",
  expected: "3x^2",
};

test("a math question is posted with its expected answer", async () => {
  const { posted, tool } = setUp();

  expect(await tool.run(MATH)).toEqual({
    status: "done",
    text: "Posted as question 1. Your turn is over; the learner's answer will arrive in the next message.",
    endTurn: true,
  });
  expect(posted).toEqual([MATH]);
});

test.each([
  {
    name: "an answer that is not one of its choices",
    input: { ...QUESTION, answer: "D" },
    reason: "The answer must be the letter of one of the choices.",
  },
  {
    name: "no kind",
    input: { ...QUESTION, kind: undefined },
    reason: "kind",
  },
  {
    name: "no choices, as a choice question",
    input: { ...QUESTION, choices: undefined },
    reason: "A choice question needs its choices.",
  },
  {
    name: "a rubric, as a choice question",
    input: { ...QUESTION, rubric: "Any." },
    reason: "A choice question has no rubric",
  },
  {
    name: "no rubric, as a written question",
    input: { ...WRITTEN, rubric: undefined },
    reason: "A written question needs a rubric",
  },
  {
    name: "choices, as a written question",
    input: { ...WRITTEN, choices: ["$3x^2$", "$x^2$"], answer: "A" },
    reason: "A written question has no choices",
  },
  {
    name: "an expected answer, as a written question",
    input: { ...WRITTEN, expected: "3x^2" },
    reason: "A written question has no expected expression",
  },
  {
    name: "an expected answer, as a choice question",
    input: { ...QUESTION, expected: "3x^2" },
    reason: "A choice question has no rubric and no expected expression",
  },
  {
    name: "no expected answer, as a math question",
    input: { ...MATH, expected: undefined },
    reason: "A math question needs the expected answer",
  },
  {
    name: "a blank expected answer, as a math question",
    input: { ...MATH, expected: "  " },
    reason: "expected",
  },
  {
    name: "a rubric, as a math question",
    input: { ...MATH, rubric: "Any form of $3x^2$." },
    reason: "A math question has no rubric",
  },
  {
    name: "choices, as a math question",
    input: { ...MATH, choices: ["$3x^2$", "$x^2$"], answer: "A" },
    reason: "A math question has no choices",
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
