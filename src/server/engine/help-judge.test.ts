import { expect, test } from "vitest";
import {
  type ChoiceQuestion,
  HelpJudgment,
  type WrittenQuestion,
} from "../../shared/question.ts";
import { createFakeBackend, type FakeReply } from "../backends/fake.ts";
import { createHelpJudge } from "./help-judge.ts";

const JUDGE = "You are a test help judge.";
const CHOICE: ChoiceQuestion = {
  kind: "choice",
  prompt: "What is the derivative of $x^2$ at $3$?",
  choices: ["$3$", " $6$ ", "$9$"],
  answer: "B",
};
const WRITTEN: WrittenQuestion = {
  kind: "written",
  prompt: "Prove that the sum of two even integers is even.",
  rubric: "Writes them as $2a$ and $2b$, adds them to get $2(a+b)$.",
};
const MESSAGE = "  What does the prime mean?\n";
const REPLY = "It marks the derivative: $f'(x)$ is the slope at $x$.\n";

function setUp(replies: FakeReply[], timeLimitMs?: number) {
  const backend = createFakeBackend([], replies);
  const judge = createHelpJudge({
    backend,
    systemPrompt: JUDGE,
    ...(timeLimitMs === undefined ? {} : { timeLimitMs }),
  });
  return { backend, judge };
}

const CLARIFICATION = {
  output: { reason: "It explains the notation.", verdict: "clarification" },
};

test("the judge's request holds a choice question as the learner saw it, its correct choice, the message and the reply, between tags, with the judge's own prompt and the judgment's schema", async () => {
  const { backend, judge } = setUp([CLARIFICATION]);

  await judge.judge({ question: CHOICE, message: MESSAGE, reply: REPLY });

  expect(backend.oneShots).toHaveLength(1);
  expect(backend.oneShots[0]).toMatchObject({
    systemPrompt: JUDGE,
    prompt: `While this question was open, the learner sent the tutor the message below, and the tutor replied. Judge whether the reply gave the learner help toward the answer, or only clarified what the question asks.

<question>
What is the derivative of $x^2$ at $3$?
</question>

<choices>
A. $3$
B. $6$
C. $9$
</choices>

<correct_choice>
B. $6$
</correct_choice>

<message>
What does the prime mean?
</message>

<reply>
It marks the derivative: $f'(x)$ is the slope at $x$.
</reply>`,
    schema: HelpJudgment,
  });
});

test("for a written question the request holds its rubric in place of choices", async () => {
  const { backend, judge } = setUp([CLARIFICATION]);

  await judge.judge({ question: WRITTEN, message: MESSAGE, reply: REPLY });

  const prompt = backend.oneShots[0]?.prompt ?? "";
  expect(prompt).toContain(
    "<question>\nProve that the sum of two even integers is even.\n</question>\n\n<rubric>\nWrites them as $2a$ and $2b$, adds them to get $2(a+b)$.\n</rubric>\n\n<message>",
  );
  expect(prompt).not.toContain("<choices>");
});

test("for a math question the request holds its expected answer in place of choices", async () => {
  const { backend, judge } = setUp([CLARIFICATION]);

  await judge.judge({
    question: {
      kind: "math",
      prompt: "Differentiate $(2x+1)^5$.",
      expected: "10(2x+1)^4",
    },
    message: MESSAGE,
    reply: REPLY,
  });

  const prompt = backend.oneShots[0]?.prompt ?? "";
  expect(prompt).toContain(
    "<question>\nDifferentiate $(2x+1)^5$.\n</question>\n\n<expected_answer>\n10(2x+1)^4\n</expected_answer>\n\n<message>",
  );
  expect(prompt).not.toContain("<choices>");
  expect(prompt).not.toContain("<rubric>");
});

test("for a code question the request holds its tests and the tutor's solution, each file between tags with its path", async () => {
  const { backend, judge } = setUp([CLARIFICATION]);

  await judge.judge({
    question: {
      kind: "code",
      prompt: "Finish `double(x)` in `double.py`.",
      files: ["double.py"],
      tests: [
        {
          path: "test_double.py",
          content: "from double import double\n\nassert double(2) == 4\n",
        },
      ],
      solution: [
        { path: "double.py", content: "def double(x):\n    return 2 * x\n" },
      ],
      command: [".venv/bin/python", "test_double.py"],
    },
    message: MESSAGE,
    reply: REPLY,
  });

  const prompt = backend.oneShots[0]?.prompt ?? "";
  expect(prompt).toContain(
    "<question>\nFinish `double(x)` in `double.py`.\n</question>\n\n" +
      '<tests>\n<file path="test_double.py">\nfrom double import double\n\nassert double(2) == 4\n</file>\n</tests>\n\n' +
      '<solution>\n<file path="double.py">\ndef double(x):\n    return 2 * x\n</file>\n</solution>\n\n<message>',
  );
  // The command is how the tests run, not what they check.
  expect(prompt).not.toContain(".venv/bin/python");
});

test.each<{ name: string; reply: FakeReply; outcome: unknown }>([
  {
    name: "a clarification",
    reply: CLARIFICATION,
    outcome: {
      ok: true,
      verdict: "clarification",
      reason: "It explains the notation.",
    },
  },
  {
    name: "help",
    reply: { output: { reason: " It names the rule. ", verdict: "help" } },
    outcome: { ok: true, verdict: "help", reason: "It names the rule." },
  },
  {
    name: "a verdict without a reason",
    reply: { output: { verdict: "help" } },
    outcome: {
      ok: false,
      error: expect.stringMatching(/^The reply was not in the shape asked for/),
    },
  },
  {
    name: "a verdict that is not one of the two",
    reply: { output: { reason: "Some of both.", verdict: "partly" } },
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
  const { judge } = setUp([reply]);

  expect(
    await judge.judge({ question: CHOICE, message: MESSAGE, reply: REPLY }),
  ).toEqual(outcome);
});

test("a request that takes longer than the time limit is stopped and fails", async () => {
  const { judge } = setUp([{ hold: true }], 20);

  expect(
    await judge.judge({ question: CHOICE, message: MESSAGE, reply: REPLY }),
  ).toEqual({
    ok: false,
    error: "The judge took longer than 20 ms and was stopped.",
  });
});

test("the caller can stop a request", async () => {
  const { judge } = setUp([{ hold: true }]);
  const stop = new AbortController();

  const outcome = judge.judge(
    { question: CHOICE, message: MESSAGE, reply: REPLY },
    stop.signal,
  );
  stop.abort();

  expect(await outcome).toEqual({
    ok: false,
    error: "The request was stopped.",
  });
});
