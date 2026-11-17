import { expect, test } from "vitest";
import {
  type AnswerSubmission,
  type MathAnswer,
  type MathQuestion,
  WrittenGrade,
  type WrittenQuestion,
} from "../../shared/question.ts";
import { createFakeBackend, type FakeReply } from "../backends/fake.ts";
import { createGrader, gradeChoice, gradeMath } from "./grading.ts";
import type { MathCheck, MathResult } from "./math-check.ts";

test.each([
  {
    name: "the correct choice",
    submission: {
      kind: "choice",
      questionId: "q1",
      choice: "B",
      confidence: "50",
    },
    verdict: "correct",
  },
  {
    name: "another choice",
    submission: {
      kind: "choice",
      questionId: "q1",
      choice: "A",
      confidence: "100",
    },
    verdict: "incorrect",
  },
  {
    name: '"I don\'t know"',
    submission: { kind: "unknown", questionId: "q1" },
    verdict: "unknown",
  },
] as const satisfies {
  name: string;
  submission: AnswerSubmission;
  verdict: string;
}[])("with B correct, $name is graded $verdict", ({ submission, verdict }) => {
  expect(gradeChoice("B", submission)).toBe(verdict);
});

// --- Written answers ----------------------------------------------------------

const GRADER = "You are a test grader.";
const QUESTION: WrittenQuestion = {
  kind: "written",
  prompt: "Prove that the sum of two even integers is even.",
  rubric:
    "Writes them as $2a$ and $2b$ with $a$, $b$ integers, adds them to get $2(a+b)$, and concludes.",
};
const ANSWER = "  Take 2 and 4: their sum 6 is even.\n";

function setUp(replies: FakeReply[], timeLimitMs?: number) {
  const backend = createFakeBackend([], replies);
  const grader = createGrader({
    backend,
    systemPrompt: GRADER,
    ...(timeLimitMs === undefined ? {} : { timeLimitMs }),
  });
  return { backend, grader };
}

test("the grader's request holds the question, the rubric and the answer, between tags, with the grader's own prompt and the grade's schema", async () => {
  const { backend, grader } = setUp([{ output: { verdict: "correct" } }]);

  await grader.grade(QUESTION, ANSWER);

  expect(backend.oneShots).toHaveLength(1);
  expect(backend.oneShots[0]).toMatchObject({
    systemPrompt: GRADER,
    prompt: `Grade the learner's answer to this question against the rubric.

<question>
Prove that the sum of two even integers is even.
</question>

<rubric>
Writes them as $2a$ and $2b$ with $a$, $b$ integers, adds them to get $2(a+b)$, and concludes.
</rubric>

<answer>
Take 2 and 4: their sum 6 is even.
</answer>`,
    schema: WrittenGrade,
  });
});

test.each<{ name: string; reply: FakeReply; outcome: unknown }>([
  {
    name: "a correct verdict",
    reply: { output: { verdict: "correct" } },
    outcome: { ok: true, verdict: "correct" },
  },
  {
    name: "a correct verdict with a flaw, which is not kept",
    reply: { output: { verdict: "correct", flaw: "A slip of notation." } },
    outcome: { ok: true, verdict: "correct" },
  },
  {
    name: "an incorrect verdict with its flaw",
    reply: {
      output: { verdict: "incorrect", flaw: "  It checks one example only. " },
    },
    outcome: {
      ok: true,
      verdict: "incorrect",
      flaw: "It checks one example only.",
    },
  },
  {
    name: "an incorrect verdict without a flaw",
    reply: { output: { verdict: "incorrect" } },
    outcome: {
      ok: false,
      error: expect.stringMatching(
        /^The reply was not in the shape asked for: .*An incorrect verdict must name the first flawed step or missing element/s,
      ),
    },
  },
  {
    name: "a verdict that is not one of the two",
    reply: { output: { verdict: "partly correct" } },
    outcome: {
      ok: false,
      error: expect.stringMatching(/^The reply was not in the shape asked for/),
    },
  },
  {
    name: "a failed request",
    reply: { fail: "Usage limit reached." },
    outcome: { ok: false, error: "Usage limit reached." },
  },
])("$name", async ({ reply, outcome }) => {
  const { grader } = setUp([reply]);

  expect(await grader.grade(QUESTION, ANSWER)).toEqual(outcome);
});

test("a request that takes longer than the time limit is stopped and fails", async () => {
  const { grader } = setUp([{ hold: true }], 20);

  expect(await grader.grade(QUESTION, ANSWER)).toEqual({
    ok: false,
    error: "The grader took longer than 20 ms and was stopped.",
  });
});

// The fake backend has to fail a stopped request whatever its scripted reply,
// as Claude's does (readOneShot in claude.ts), or a test of a stop could pass
// on behaviour the real backend never has.
test.each<{ name: string; reply: FakeReply; stopFirst?: true }>([
  { name: "while it holds", reply: { hold: true } },
  {
    name: "while its reply is still to come",
    reply: { later: new Promise<FakeReply>(() => {}) },
  },
  {
    name: "before it is made, with a reply in shape",
    reply: { output: { verdict: "correct" } },
    stopFirst: true,
  },
])("the caller can stop a request $name", async ({ reply, stopFirst }) => {
  const { grader } = setUp([reply]);
  const stop = new AbortController();
  if (stopFirst) stop.abort();

  const outcome = grader.grade(QUESTION, ANSWER, stop.signal);
  stop.abort();

  expect(await outcome).toEqual({
    ok: false,
    error: "The request was stopped.",
  });
});

// --- Math answers the check does not settle (task 3.5) ------------------------
// The check itself is the real one in math-check.test.ts and
// math-questions.test.ts; here it is faked to give each result.

const MATH: MathQuestion = {
  kind: "math",
  prompt: "Give the derivative of $x^3$.",
  expected: "3x^2",
};
const MATH_ANSWER: MathAnswer = {
  kind: "math",
  questionId: "q1",
  expression: "3x^2",
  confidence: "90",
};
const checkGiving = (result: MathResult): MathCheck => ({
  read: async () => undefined,
  compare: async () => result,
});

test.each<{ name: string; result: MathResult; outcome: unknown }>([
  {
    name: "equal",
    result: { result: "equivalent" },
    outcome: { ok: true, verdict: "correct" },
  },
  {
    name: "not equal",
    result: { result: "different" },
    outcome: { ok: true, verdict: "incorrect" },
  },
])(
  "an answer the check finds $name is graded by it alone",
  async ({ result, outcome }) => {
    const { backend, grader } = setUp([]);

    expect(
      await gradeMath(MATH, MATH_ANSWER, {
        check: checkGiving(result),
        grader,
      }),
    ).toEqual(outcome);
    expect(backend.oneShots).toEqual([]);
  },
);

test("an answer the check could not grade, because it failed or ran out of time, is graded by the grader against a rubric made from the expression", async () => {
  const { backend, grader } = setUp([{ output: { verdict: "correct" } }]);
  const failed = {
    result: "failed",
    reason: "it took longer than 12 seconds",
  } as const;

  expect(
    await gradeMath(MATH, MATH_ANSWER, { check: checkGiving(failed), grader }),
  ).toEqual({ ok: true, verdict: "correct", unsettled: failed });
  const prompt = backend.oneShots[0]?.prompt ?? "";
  expect(prompt).toContain(
    "<question>\nGive the derivative of $x^3$.\n</question>",
  );
  expect(prompt).toContain(
    "Correct if the answer is mathematically equal to the expected answer, $3x^2$, in any form",
  );
  expect(prompt).toContain("<answer>\n3x^2\n</answer>");
});

test("when the grader then fails, the grading fails, and nothing is graded", async () => {
  const { grader } = setUp([{ fail: "The model was busy." }]);

  expect(
    await gradeMath(MATH, MATH_ANSWER, {
      check: checkGiving({ result: "undecided", reason: "no proof found" }),
      grader,
    }),
  ).toEqual({ ok: false, error: "The model was busy." });
});
