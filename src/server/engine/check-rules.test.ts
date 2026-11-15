import { expect, test } from "vitest";
import type { AnswerEvidence, EvidenceEntry } from "../../shared/evidence.ts";
import type { Confidence } from "../../shared/question.ts";
import { objectiveCheck } from "./check-rules.ts";

const AT = "2026-11-15T10:00:00.000Z";

/** An answer on "slope", to the question numbered `q`. */
function answer(
  q: number,
  verdict: "correct" | "incorrect" | "unknown",
  confidence: Confidence = "75",
  assisted = false,
): AnswerEvidence {
  return {
    kind: "answer",
    recordedAt: AT,
    objective: "slope",
    question: {
      kind: "choice",
      prompt: `Question ${q}`,
      choices: ["Yes", "No"],
      answer: "A",
    },
    answer:
      verdict === "unknown"
        ? { kind: "unknown", questionId: `q${q}` }
        : {
            kind: "choice",
            questionId: `q${q}`,
            choice: verdict === "correct" ? "A" : "B",
            confidence,
          },
    assisted,
    verdict,
  };
}

// Each case: the evidence before the check, the check's answers, and where
// the objective stands, worked out by hand from the rules in check-rules.ts.
test.each<{
  name: string;
  before?: EvidenceEntry[];
  check: AnswerEvidence[];
  expected: ReturnType<typeof objectiveCheck>;
}>([
  { name: "nothing asked", check: [], expected: { state: "unasked" } },
  {
    name: "passed before the check, not asked in it",
    before: [answer(1, "correct", "100")],
    check: [],
    expected: { state: "unasked" },
  },
  {
    name: "a miss",
    check: [answer(1, "incorrect", "90")],
    expected: { state: "more", reason: "missed", asked: 1 },
  },
  {
    name: 'an "I don\'t know"',
    check: [answer(1, "unknown")],
    expected: { state: "more", reason: "missed", asked: 1 },
  },
  {
    name: "one correct answer at 75%",
    check: [answer(1, "correct", "75")],
    expected: { state: "more", reason: "unconfident", asked: 1 },
  },
  {
    name: "one correct answer at 90%",
    check: [answer(1, "correct", "90")],
    expected: { state: "done", reason: "passed", asked: 1 },
  },
  {
    name: "a confident correct answer with help",
    check: [answer(1, "correct", "100", true)],
    expected: { state: "more", reason: "assisted", asked: 1 },
  },
  {
    name: "two unsure correct answers to different questions",
    check: [answer(1, "correct", "50"), answer(2, "correct", "75")],
    expected: { state: "done", reason: "passed", asked: 2 },
  },
  {
    name: "the same question answered correctly twice",
    check: [answer(1, "correct", "50"), answer(1, "correct", "75")],
    expected: { state: "more", reason: "unconfident", asked: 2 },
  },
  {
    name: "a correct answer before the check, and one unsure in it",
    before: [answer(1, "correct", "50")],
    check: [answer(2, "correct", "50")],
    expected: { state: "done", reason: "passed", asked: 1 },
  },
  {
    name: "a miss, then a confident correct answer",
    check: [answer(1, "incorrect"), answer(2, "correct", "100")],
    expected: { state: "done", reason: "passed", asked: 2 },
  },
  {
    name: "three questions without a pass",
    check: [
      answer(1, "incorrect"),
      answer(2, "correct", "50"),
      answer(3, "incorrect"),
    ],
    expected: { state: "done", reason: "limit", asked: 3 },
  },
  {
    name: "a pass on the third question",
    check: [
      answer(1, "incorrect"),
      answer(2, "correct", "50"),
      answer(3, "correct", "75"),
    ],
    expected: { state: "done", reason: "passed", asked: 3 },
  },
])("$name", ({ before = [], check, expected }) => {
  expect(objectiveCheck("slope", [...before, ...check], check)).toEqual(
    expected,
  );
});

test("answers on other objectives are not counted", () => {
  const other = { ...answer(1, "incorrect"), objective: "tangent" };

  expect(objectiveCheck("slope", [other], [other])).toEqual({
    state: "unasked",
  });
});
