import { expect, test } from "vitest";
import {
  type AnswerSubmission,
  WrittenGrade,
  type WrittenQuestion,
} from "../../shared/question.ts";
import { createFakeBackend, type FakeReply } from "../backends/fake.ts";
import { createGrader, gradeChoice } from "./grading.ts";

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
