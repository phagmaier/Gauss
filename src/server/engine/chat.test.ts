import { describe, expect, test } from "vitest";
import { createFakeBackend, type FakeTurn } from "../backends/fake.ts";
import { createChat } from "./chat.ts";

const QUESTION = {
  objective: "Apply the power rule",
  prompt: "What is the derivative of x³?",
  choices: ["3x²", "x²", "3x³"],
  answer: "A",
};

function setUp(script: FakeTurn[]) {
  const backend = createFakeBackend(script);
  const chat = createChat({ backend, systemPrompt: "You are a test tutor." });
  return { backend, chat };
}

test("the tutor teaches and posts a question, which ends its turn; the page gets the question without its answer", async () => {
  const { backend, chat } = setUp([
    [
      { text: "The power rule brings the exponent down." },
      { call: "ask_question", input: QUESTION },
      { text: "A hint the learner must not see." },
    ],
  ]);

  expect(chat.start()).toEqual({ ok: true });
  await chat.settled();

  expect(chat.events()).toEqual([
    { type: "turn_start" },
    { type: "tutor_text", text: "The power rule brings the exponent down." },
    {
      type: "question",
      question: {
        id: "q1",
        number: 1,
        prompt: "What is the derivative of x³?",
        choices: ["3x²", "x²", "3x³"],
      },
    },
    { type: "turn_end", outcome: "done" },
  ]);
  expect(backend.sessions[0]?.systemPrompt).toBe("You are a test tutor.");
  expect(backend.sessions[0]?.tools.map((t) => t.name)).toEqual([
    "ask_question",
  ]);
});

test("a correct answer is graded by exact match and sent to the tutor as its next turn", async () => {
  const { backend, chat } = setUp([
    [{ call: "ask_question", input: QUESTION }],
    [{ text: "Right: 3 comes down and the exponent drops to 2." }],
  ]);
  chat.start();
  await chat.settled();

  const result = chat.answer({
    kind: "choice",
    questionId: "q1",
    choice: "A",
    confidence: "90",
    reasoning: "Bring the 3 down.",
  });
  await chat.settled();

  expect(result).toEqual({ ok: true });
  expect(chat.events().slice(-4)).toEqual([
    {
      type: "graded",
      questionId: "q1",
      verdict: "correct",
      choice: "A",
      confidence: "90",
      correctChoice: "A",
    },
    { type: "turn_start" },
    {
      type: "tutor_text",
      text: "Right: 3 comes down and the exponent drops to 2.",
    },
    { type: "turn_end", outcome: "done" },
  ]);
  const turn = backend.received[1]?.text ?? "";
  expect(turn).toMatch(/^\[Answer submitted for q1\./);
  expect(turn).toContain('The learner chose A ("3x²") with confidence 90%.');
  expect(turn).toContain('Reasoning given: "Bring the 3 down."');
  expect(turn).toContain(
    'The engine graded it correct. The correct choice is A ("3x²").',
  );
});

describe("a miss reveals the correct choice to the page and the tutor", () => {
  test.each([
    {
      name: "a wrong choice",
      submission: {
        kind: "choice",
        questionId: "q1",
        choice: "C",
        confidence: "under-50",
      },
      graded: { verdict: "incorrect", choice: "C", confidence: "under-50" },
      told: [
        'The learner chose C ("3x³") with confidence under 50%.',
        "No reasoning given.",
        "The engine graded it incorrect.",
      ],
    },
    {
      name: '"I don\'t know"',
      submission: { kind: "unknown", questionId: "q1" },
      graded: { verdict: "unknown", choice: null, confidence: null },
      told: [`The learner answered "I don't know". It counts as a miss.`],
    },
  ] as const)("$name", async ({ submission, graded, told }) => {
    const { backend, chat } = setUp([
      [{ call: "ask_question", input: QUESTION }],
      [{ text: "Feedback." }],
    ]);
    chat.start();
    await chat.settled();

    chat.answer(submission);
    await chat.settled();

    expect(chat.events()).toContainEqual({
      type: "graded",
      questionId: "q1",
      correctChoice: "A",
      ...graded,
    });
    const turn = backend.received[1]?.text ?? "";
    for (const line of told) expect(turn).toContain(line);
    expect(turn).toContain('The correct choice is A ("3x²")');
  });
});

test("a second question while one is open is refused, and the tutor is told why and keeps its turn", async () => {
  const { backend, chat } = setUp([
    [{ call: "ask_question", input: QUESTION }],
    [
      { call: "ask_question", input: { ...QUESTION, prompt: "Another one?" } },
      { text: "Answer the first question when you are ready." },
    ],
  ]);
  chat.start();
  await chat.settled();

  chat.say("Can I have an easier one?");
  await chat.settled();

  expect(backend.calls[1]?.result).toEqual({
    status: "refused",
    text: "Question q1 is still open. End your turn and wait for the learner's answer.",
  });
  expect(chat.events().filter((e) => e.type === "question")).toHaveLength(1);
  expect(chat.events().slice(-2)).toEqual([
    {
      type: "tutor_text",
      text: "Answer the first question when you are ready.",
    },
    { type: "turn_end", outcome: "done" },
  ]);
  expect(backend.received[1]?.text).toBe(
    "[Message from the learner. Allowed now: reply. Question q1 is still open: do not reveal or hint at its answer.]\nCan I have an easier one?",
  );
});

test("a question whose answer is not one of its choices is refused with the reason, and nothing is posted", async () => {
  const { backend, chat } = setUp([
    [{ call: "ask_question", input: { ...QUESTION, answer: "D" } }],
  ]);
  chat.start();
  await chat.settled();

  const result = backend.calls[0]?.result;
  expect(result?.status).toBe("refused");
  expect(result?.text).toContain(
    "The answer must be the letter of one of the choices.",
  );
  expect(chat.events().some((e) => e.type === "question")).toBe(false);
});

test("answers and messages that do not fit the chat are refused", async () => {
  const { chat } = setUp([[{ call: "ask_question", input: QUESTION }], []]);

  expect(chat.say("Hello?")).toMatchObject({ ok: false, status: 409 });
  chat.start();
  expect(chat.start()).toMatchObject({ ok: false, status: 409 });
  await chat.settled();

  expect(chat.answer({ kind: "unknown", questionId: "q9" })).toMatchObject({
    ok: false,
    status: 404,
  });
  expect(
    chat.answer({
      kind: "choice",
      questionId: "q1",
      choice: "D",
      confidence: "50",
    }),
  ).toMatchObject({ ok: false, status: 400 });
  expect(chat.answer({ kind: "unknown", questionId: "q1" })).toEqual({
    ok: true,
  });
  expect(chat.answer({ kind: "unknown", questionId: "q1" })).toMatchObject({
    ok: false,
    status: 409,
  });
  await chat.settled();
  expect(chat.events().filter((e) => e.type === "graded")).toHaveLength(1);
});
