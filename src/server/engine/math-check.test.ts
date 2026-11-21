// The symbolic check as the engine runs it: `pytools/mathcheck.py` in the
// real sandbox, so these tests need what the sandbox needs (on Linux
// `bwrap`, `socat` and `rg`) and fail, rather than skip, where it cannot
// run. The pairs are worked by hand; `pytools/tests/test_mathcheck.py`
// covers the check's own rules.

import { afterAll, beforeAll, expect, test } from "vitest";
import { createMathCheck, type MathCheck } from "./math-check.ts";
import { type Sandbox, startSandbox } from "./sandbox.ts";

let sandbox: Extract<Sandbox, { available: true }>;
let check: MathCheck;

beforeAll(async () => {
  // The check keeps no record.
  const started = await startSandbox({
    log: () => {},
    dataRoot: "/nonexistent/gauss",
  });
  if (!started.available) {
    throw new Error(`These tests need the sandbox: ${started.reason}`);
  }
  sandbox = started;
  check = createMathCheck({ sandbox });
});
afterAll(async () => {
  await sandbox?.close();
});

test("an expected answer the check reads is accepted, and one it cannot is refused with the check's reason", async () => {
  expect(await check.read("10(2x+1)^4")).toBeUndefined();
  expect(await check.read("y = 2x + 1")).toBeUndefined();

  const refused = await check.read("\\frac{dy}{dx} = 2x");
  expect(refused?.refused).toContain(
    "derivative notation is not understood: give the derivative itself",
  );
  expect(refused?.refused).toContain('repost with mathGrading: "grader"');
});

test.each([
  {
    name: "an equal expression in another form",
    expected: "10(2x+1)^4",
    answer: "5(2x+1)^4 \\cdot 2",
    result: { result: "equivalent" },
  },
  {
    name: "an expression missing the inner derivative",
    expected: "10(2x+1)^4",
    answer: "5(2x+1)^4",
    result: { result: "different" },
  },
  {
    name: "an answer with a command the check does not know",
    expected: "4x",
    answer: "2x \\oops",
    result: { result: "unparsable", reason: "\\oops is not understood" },
  },
  {
    name: "an expression given for an equation",
    expected: "x^2 + y^2 = 1",
    answer: "x^2 + y^2 - 1",
    result: {
      result: "undecided",
      reason: "one side is an equation and the other an expression",
    },
  },
])("$name: $result.result", async ({ expected, answer, result }) => {
  expect(await check.compare(expected, answer)).toEqual(result);
});

test("two checks at once, as two units grading together, each get their own result", async () => {
  expect(
    await Promise.all([
      check.compare("10(2x+1)^4", "5(2x+1)^4 \\cdot 2"),
      check.compare("10(2x+1)^4", "5(2x+1)^4"),
    ]),
  ).toEqual([{ result: "equivalent" }, { result: "different" }]);
});

test("a check past its time limit fails, and so does one with no sandbox, each with the reason", async () => {
  const hurried = createMathCheck({ sandbox, timeLimitMs: 50 });
  expect(await hurried.compare("4x", "2x + 2x")).toEqual({
    result: "failed",
    reason: "it took longer than 50 ms",
  });

  const none = createMathCheck({
    sandbox: {
      available: false,
      reason: "bwrap is missing",
      close: () => Promise.resolve(),
    },
  });
  expect(await none.compare("4x", "2x + 2x")).toEqual({
    result: "failed",
    reason: "there is no sandbox to run it in (bwrap is missing)",
  });
  expect((await none.read("4x"))?.refused).toContain(
    "there is no sandbox to run it in (bwrap is missing)",
  );
});
