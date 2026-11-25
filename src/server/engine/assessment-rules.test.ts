import { expect, test } from "vitest";
import type { AnswerEvidence, AssessmentMode } from "../../shared/evidence.ts";
import type { AssessmentRun } from "../../shared/state.ts";
import { nextInRun, type RunStep } from "./assessment-rules.ts";

const AT = "2026-11-25T10:00:00.000Z";

/** A run under way over these objectives of unit "u", in this order. */
function run(mode: AssessmentMode, objectives: string[]): AssessmentRun {
  return {
    mode,
    stage: "on",
    objectives: objectives.map((objective) => ({ unit: "u", objective })),
    from: 0,
    ...(mode === "self-test" ? { kinds: ["choice" as const] } : {}),
  };
}

let asked = 0;
/** An answer in the run, correct or missed, given after those before it. */
function given(
  objective: string,
  verdict: "correct" | "incorrect",
  mode: AssessmentMode = "self-test",
): AnswerEvidence {
  asked += 1;
  return {
    kind: "answer",
    recordedAt: AT,
    objective,
    question: {
      kind: "choice",
      prompt: `Question ${asked} on ${objective}`,
      choices: ["Yes", "No"],
      answer: "A",
    },
    answer: {
      kind: "choice",
      questionId: `q${asked}`,
      choice: verdict === "correct" ? "A" : "B",
      confidence: "90",
    },
    assisted: false,
    verdict,
    assessment: { mode, unit: "u" },
  };
}

/** The step asked on the objective at `index`. */
function step(index: number, objective: string, second = false): RunStep {
  return { index, unit: "u", objective, second };
}

const ABC = ["a", "b", "c"];

// Each case: the answers given so far in a self-test of a, b and c, in
// order, and the question it asks next, worked out by hand from the rule in
// assessment-rules.ts: a missed objective's second question waits until
// another objective has been answered since its miss, while another is
// still to ask; otherwise the run's order.
test.each<{
  name: string;
  answers: () => AnswerEvidence[];
  next: RunStep | undefined;
}>([
  {
    name: "nothing answered: the first",
    answers: () => [],
    next: step(0, "a"),
  },
  {
    name: "a missed: not a again at once, but b",
    answers: () => [given("a", "incorrect")],
    next: step(1, "b"),
  },
  {
    name: "a missed, then b answered: a's second question comes back",
    answers: () => [given("a", "incorrect"), given("b", "correct")],
    next: step(0, "a", true),
  },
  {
    name: "a missed, b answered, a asked again: c",
    answers: () => [
      given("a", "incorrect"),
      given("b", "correct"),
      given("a", "correct"),
    ],
    next: step(2, "c"),
  },
  {
    name: "a missed, then b missed: a, answered past since, before b, which waits",
    answers: () => [given("a", "incorrect"), given("b", "incorrect")],
    next: step(0, "a", true),
  },
  {
    name: "a and b missed, then a asked again: b's second, now that a was answered since",
    answers: () => [
      given("a", "incorrect"),
      given("b", "incorrect"),
      given("a", "incorrect"),
    ],
    next: step(1, "b", true),
  },
  {
    name: "c missed with a and b done: c's second at once, none other left",
    answers: () => [
      given("a", "correct"),
      given("b", "correct"),
      given("c", "incorrect"),
    ],
    next: step(2, "c", true),
  },
  {
    name: "every objective asked all it will be: none",
    answers: () => [
      given("a", "correct"),
      given("b", "incorrect"),
      given("c", "correct"),
      given("b", "incorrect"),
    ],
    next: undefined,
  },
])("self-test: $name", ({ answers, next }) => {
  expect(nextInRun(run("self-test", ABC), answers(), [])).toEqual(next);
});

test("a self-test of one objective asks its second question after the detour at once", () => {
  const answers = [given("a", "incorrect")];
  expect(nextInRun(run("self-test", ["a"]), answers, [])).toEqual(
    step(0, "a", true),
  );
});

test("review and the gate still ask a missed objective again at once, before the next", () => {
  for (const mode of ["review", "gate"] as const) {
    const answers = [given("a", "incorrect", mode)];
    expect(nextInRun(run(mode, ABC), answers, [])).toEqual(step(0, "a", true));
  }
});

test("a dispute that overturns a self-test's miss leaves no second question: the run moves on to c", () => {
  const miss = given("a", "incorrect");
  const answers = [miss, given("b", "correct")];
  // Without the dispute, a's second question would come next.
  expect(nextInRun(run("self-test", ABC), answers, answers)).toEqual(
    step(0, "a", true),
  );
  const evidence = [
    ...answers,
    {
      kind: "dispute" as const,
      recordedAt: AT,
      questionId: miss.answer.questionId,
      reason: "A is what I chose.",
      outcome: { verdict: "correct" as const, reason: "The key was wrong." },
    },
  ];
  expect(nextInRun(run("self-test", ABC), answers, evidence)).toEqual(
    step(2, "c"),
  );
});
