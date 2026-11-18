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
// the objective stands, worked out by hand from the rules in check-rules.ts
// and status.ts (tasks 2.19 and 2.23).
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
    expected: { state: "more", reason: "missed", asked: 1, missed: 1 },
  },
  {
    name: 'an "I don\'t know"',
    check: [answer(1, "unknown")],
    expected: { state: "more", reason: "missed", asked: 1, missed: 1 },
  },
  {
    name: "one correct answer at 75%",
    check: [answer(1, "correct", "75")],
    expected: { state: "more", reason: "second", asked: 1, missed: 0 },
  },
  {
    name: "one correct answer at 90%, never missed",
    check: [answer(1, "correct", "90")],
    expected: { state: "done", asked: 1 },
  },
  {
    name: "a confident correct answer with help",
    check: [answer(1, "correct", "100", true)],
    expected: { state: "more", reason: "assisted", asked: 1, missed: 0 },
  },
  {
    name: "two unsure correct answers to different questions",
    check: [answer(1, "correct", "50"), answer(2, "correct", "75")],
    expected: { state: "done", asked: 2 },
  },
  {
    name: "one question answered correctly twice at 75%",
    check: [answer(1, "correct", "75"), answer(1, "correct", "75")],
    expected: { state: "more", reason: "second", asked: 2, missed: 0 },
  },
  {
    name: "a pass before the check, and an unsure correct answer in it",
    before: [answer(1, "correct", "90")],
    check: [answer(2, "correct", "50")],
    expected: { state: "done", asked: 1 },
  },
  {
    name: "a miss, then a confident correct answer",
    check: [answer(1, "incorrect"), answer(2, "correct", "100")],
    expected: { state: "more", reason: "second", asked: 2, missed: 1 },
  },
  {
    name: "a miss, then two unsure correct answers",
    check: [
      answer(1, "unknown"),
      answer(2, "correct", "under-50"),
      answer(3, "correct", "50"),
    ],
    expected: { state: "done", asked: 3 },
  },
  {
    name: "a miss, then a confident and an unsure correct answer",
    check: [
      answer(1, "incorrect"),
      answer(2, "correct", "100"),
      answer(3, "correct", "50"),
    ],
    expected: { state: "done", asked: 3 },
  },
  {
    name: "a miss, then the same question answered confidently twice",
    check: [
      answer(1, "incorrect"),
      answer(2, "correct", "90"),
      answer(2, "correct", "90"),
    ],
    expected: { state: "more", reason: "second", asked: 3, missed: 1 },
  },
  {
    name: "the user's sitting: \"I don't know\", correct at 75%, correct at 90% with help",
    check: [
      answer(1, "unknown"),
      answer(2, "correct", "75"),
      answer(3, "correct", "90", true),
    ],
    expected: { state: "more", reason: "assisted", asked: 3, missed: 1 },
  },
  {
    name: 'three "I don\'t know"s, with no limit',
    check: [answer(1, "unknown"), answer(2, "unknown"), answer(3, "unknown")],
    expected: { state: "more", reason: "missed", asked: 3, missed: 3 },
  },
  {
    name: "a miss before the check is not counted among the check's misses",
    before: [answer(1, "incorrect")],
    check: [answer(2, "correct", "50"), answer(3, "incorrect")],
    expected: { state: "more", reason: "missed", asked: 2, missed: 1 },
  },
  {
    name: "a pass on the fifth question",
    check: [
      answer(1, "incorrect"),
      answer(2, "correct", "50"),
      answer(3, "incorrect"),
      answer(4, "correct", "75"),
      answer(5, "correct", "90"),
    ],
    expected: { state: "done", asked: 5 },
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

test("a disputed answer in the check counts with its dispute's verdict, for why another question is needed and how many were missed", () => {
  const dispute = (
    q: number,
    verdict: "correct" | "incorrect",
  ): EvidenceEntry => ({
    kind: "dispute",
    recordedAt: AT,
    questionId: `q${q}`,
    reason: "The grade is wrong.",
    outcome: { verdict, reason: "Decided by hand." },
  });
  // A miss at 75% overturned: one unsure correct answer, which needs a second.
  const missed = [answer(1, "incorrect", "75")];
  expect(
    objectiveCheck("slope", [...missed, dispute(1, "correct")], missed),
  ).toEqual({
    state: "more",
    reason: "second",
    asked: 1,
    missed: 0,
  });
  // A pass at 90% overturned: a miss, which a detour then teaches from.
  const passed = [answer(1, "correct", "90")];
  expect(
    objectiveCheck("slope", [...passed, dispute(1, "incorrect")], passed),
  ).toEqual({
    state: "more",
    reason: "missed",
    asked: 1,
    missed: 1,
  });
});
