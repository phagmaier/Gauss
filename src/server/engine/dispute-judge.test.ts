import { expect, test } from "vitest";
import { DisputeJudgment } from "../../shared/dispute.ts";
import { type AnswerEvidence, EvidenceEntry } from "../../shared/evidence.ts";
import { createFakeBackend } from "../backends/fake.ts";
import {
  createDisputeJudge,
  disputeOutcome,
  disputeRequest,
} from "./dispute-judge.ts";
import { mathRubric } from "./grading.ts";

// The answers below are hand-made records; every expected outcome was worked
// out by hand from the rules in dispute-judge.ts and docs/decisions.md,
// "Disputes".

const AT = "2026-11-17T10:00:00.000Z";

function recorded(entry: Record<string, unknown>): AnswerEvidence {
  const parsed = EvidenceEntry.parse({
    kind: "answer",
    recordedAt: AT,
    objective: "chain-rule",
    assisted: false,
    ...entry,
  });
  if (parsed.kind !== "answer") throw new Error("not an answer");
  return parsed;
}

/** Picked B, keyed C: a miss, as the key had it. */
const CHOICE = recorded({
  question: {
    kind: "choice",
    prompt: "What is the derivative of $e^{-x^2}$?",
    choices: ["$e^{-x^2}$", "$-2x e^{-x^2}$", "$2x e^{-x^2}$"],
    answer: "C",
  },
  answer: {
    kind: "choice",
    questionId: "q-choice",
    choice: "B",
    confidence: "75",
    reasoning: "The inside gives $-2x$.",
  },
  verdict: "incorrect",
});

const WRITTEN = recorded({
  question: {
    kind: "written",
    prompt: "What does it mean for $f$ to be continuous at $a$?",
    rubric:
      "Says that $f(a)$ is defined, the limit exists, and they are equal.",
  },
  answer: {
    kind: "written",
    questionId: "q-written",
    text: "For every $\\varepsilon > 0$ there is a $\\delta > 0$ ...",
    confidence: "90",
  },
  verdict: "incorrect",
  flaw: "It does not say that the limit exists.",
});

const MATH_UNSETTLED = recorded({
  question: {
    kind: "math",
    prompt: "Differentiate $(2x+1)^5$.",
    expected: "10(2x+1)^4",
  },
  answer: {
    kind: "math",
    questionId: "q-math",
    expression: "5(2x+1)^4 \\cdot 2 \\oops",
    confidence: "50",
  },
  verdict: "incorrect",
  flaw: "It has a stray command.",
  unsettled: { result: "unparsable", reason: "\\oops is not understood" },
});

const CODE = recorded({
  question: {
    kind: "code",
    prompt: "Finish `d_power` in `chain.py`.",
    files: ["chain.py"],
    tests: [
      {
        path: "test_chain.py",
        content:
          "from chain import d_power\nassert d_power(-1, 4, 2, 1) == 6\n",
      },
    ],
    solution: [
      { path: "chain.py", content: "def d_power(a, b, n, x):\n    return 6\n" },
    ],
    command: [".venv/bin/python", "test_chain.py"],
    inputs: [],
  },
  answer: {
    kind: "code",
    questionId: "q-code",
    confidence: "90",
    files: [
      {
        path: "chain.py",
        content:
          "def d_power(a, b, n, x):\n    return n * a * (a * x + b) ** (n - 1)\n",
      },
    ],
  },
  verdict: "incorrect",
  output: "AssertionError: assert -6 == 6\nExit status 1.",
});

test("a choice dispute's request has the question, the choices, the key, the answer with its reasoning, the grade and the reason, and not the confidence", () => {
  expect(
    disputeRequest(CHOICE, "  B is right: the sign comes from $-x^2$. "),
  ).toBe(
    [
      "The learner disputes the grade of their answer to this question. Decide what the grade should be.",
      "",
      "<question>",
      "What is the derivative of $e^{-x^2}$?",
      "</question>",
      "",
      "<choices>",
      "A. $e^{-x^2}$",
      "B. $-2x e^{-x^2}$",
      "C. $2x e^{-x^2}$",
      "</choices>",
      "",
      "<graded_by>",
      "The choice picked, matched against the key.",
      "</graded_by>",
      "",
      "<key>",
      "C. $2x e^{-x^2}$",
      "</key>",
      "",
      "<answer>",
      "B. $-2x e^{-x^2}$",
      "</answer>",
      "",
      "<reasoning>",
      "The inside gives $-2x$.",
      "</reasoning>",
      "",
      "<grade>",
      "incorrect",
      "</grade>",
      "",
      "<reason>",
      "B is right: the sign comes from $-x^2$.",
      "</reason>",
    ].join("\n"),
  );
});

test("the other kinds' requests carry what graded each: the rubric and the flaw, the rubric the grader had for an unsettled math answer, and the tests with the files and their output", () => {
  const written = disputeRequest(WRITTEN, "It is the same definition.");
  expect(written).toContain(
    "<rubric>\nSays that $f(a)$ is defined, the limit exists, and they are equal.\n</rubric>",
  );
  expect(written).toContain(
    "<flaw>\nIt does not say that the limit exists.\n</flaw>",
  );
  expect(written).not.toContain("90");

  const math = disputeRequest(MATH_UNSETTLED, "The stray command is a typo.");
  expect(math).toContain("<expected_answer>\n10(2x+1)^4\n</expected_answer>");
  expect(math).toContain(
    "The symbolic check could not read the answer (\\oops is not understood), so a grader graded it against the rubric below.",
  );
  expect(math).toContain(
    `<rubric>\n${mathRubric({ kind: "math", prompt: "", expected: "10(2x+1)^4" })}\n</rubric>`,
  );
  expect(math).toContain("<answer>\n5(2x+1)^4 \\cdot 2 \\oops\n</answer>");

  const code = disputeRequest(CODE, "The test expects the wrong sign.");
  expect(code).toContain(
    '<tests>\n<file path="test_chain.py">\nfrom chain import d_power\nassert d_power(-1, 4, 2, 1) == 6\n</file>\n</tests>',
  );
  expect(code).toContain(
    "<command>\n.venv/bin/python test_chain.py\n</command>",
  );
  expect(code).toContain('<answer>\n<file path="chain.py">');
  expect(code).toContain(
    "<output>\nAssertionError: assert -6 == 6\nExit status 1.\n</output>",
  );
  // The tutor's solution is not what graded it, so the judge does not see it.
  expect(code).not.toContain("return 6");
});

test.each<{
  name: string;
  entry: AnswerEvidence;
  judgment: DisputeJudgment;
  gives: ReturnType<typeof disputeOutcome>;
}>([
  {
    name: "a wrong key corrected to the choice picked changes the miss to correct",
    entry: CHOICE,
    judgment: { reason: "B is right.", verdict: "correct", key: "B" },
    gives: {
      ok: true,
      outcome: { verdict: "correct", reason: "B is right.", key: "B" },
    },
  },
  {
    name: "a key corrected to a choice not picked keeps the miss",
    entry: CHOICE,
    judgment: { reason: "A is right.", verdict: "incorrect", key: "A" },
    gives: {
      ok: true,
      outcome: { verdict: "incorrect", reason: "A is right.", key: "A" },
    },
  },
  {
    name: "the key named again is not kept as a correction",
    entry: CHOICE,
    judgment: { reason: "C is right.", verdict: "incorrect", key: "C" },
    gives: {
      ok: true,
      outcome: { verdict: "incorrect", reason: "C is right." },
    },
  },
  {
    name: "a correct verdict with no key names the choice picked",
    entry: CHOICE,
    judgment: { reason: "B is right.", verdict: "correct" },
    gives: {
      ok: true,
      outcome: { verdict: "correct", reason: "B is right.", key: "B" },
    },
  },
  {
    name: "a verdict the key does not give fails",
    entry: CHOICE,
    judgment: { reason: "Odd.", verdict: "correct", key: "A" },
    gives: {
      ok: false,
      error:
        "The judge's verdict, correct, does not follow from the correct choice it named, A.",
    },
  },
  {
    name: "a key that is not one of the choices fails",
    entry: CHOICE,
    judgment: { reason: "Odd.", verdict: "incorrect", key: "E" },
    gives: {
      ok: false,
      error: "The judge named choice E, which the question does not have.",
    },
  },
  {
    name: "a key named for a written answer is dropped",
    entry: WRITTEN,
    judgment: { reason: "It is the definition.", verdict: "correct", key: "A" },
    gives: {
      ok: true,
      outcome: { verdict: "correct", reason: "It is the definition." },
    },
  },
  {
    name: "a corrected expected expression is kept for a math answer",
    entry: MATH_UNSETTLED,
    judgment: {
      reason: "The expected answer is wrong.",
      verdict: "incorrect",
      expected: "10 (2x+1)^{4} + 1",
    },
    gives: {
      ok: true,
      outcome: {
        verdict: "incorrect",
        reason: "The expected answer is wrong.",
        expected: "10 (2x+1)^{4} + 1",
      },
    },
  },
  {
    name: "the expected expression given back, spaced otherwise, is not a correction",
    entry: MATH_UNSETTLED,
    judgment: {
      reason: "A typo.",
      verdict: "correct",
      expected: "10 (2x+1)^4",
    },
    gives: { ok: true, outcome: { verdict: "correct", reason: "A typo." } },
  },
])("$name", ({ entry, judgment, gives }) => {
  expect(disputeOutcome(entry, judgment)).toEqual(gives);
});

test("the judge sends its request with its prompt and the judgment schema, and a failed or slow call is a failure", async () => {
  const backend = createFakeBackend(
    [],
    [
      { output: { reason: "B is right.", verdict: "correct", key: "B" } },
      { fail: "The model is unavailable." },
      { hold: true },
    ],
  );
  const judge = createDisputeJudge({
    backend,
    systemPrompt: "Decide disputes.",
    timeLimitMs: 20,
  });

  expect(await judge.decide(CHOICE, "B.")).toEqual({
    ok: true,
    outcome: { verdict: "correct", reason: "B is right.", key: "B" },
  });
  expect(backend.oneShots[0]?.systemPrompt).toBe("Decide disputes.");
  expect(backend.oneShots[0]?.schema).toBe(DisputeJudgment);
  expect(backend.oneShots[0]?.prompt).toBe(disputeRequest(CHOICE, "B."));
  expect(await judge.decide(CHOICE, "B.")).toEqual({
    ok: false,
    error: "The model is unavailable.",
  });
  expect(await judge.decide(CHOICE, "B.")).toEqual({
    ok: false,
    error: "The judge took longer than 20 ms and was stopped.",
  });
});
