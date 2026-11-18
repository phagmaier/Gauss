import { expect, test } from "vitest";
import type { Calibration } from "../../shared/calibration.ts";
import { EvidenceEntry } from "../../shared/evidence.ts";
import type { Confidence } from "../../shared/question.ts";
import { countCalibration } from "./calibration.ts";

// Every expected count below was worked out by hand from the task (plan
// 2.27): per level, the unassisted answers and how many were correct; "I
// don't know" apart; every answer with help left out; overrides ignored.
// One course's log, as "What I know" counts it (task 2.29).

const AT = "2026-11-15T10:00:00.000Z";
let asked = 0;

/** A choice answer, parsed as the record would read it. */
function choice(
  confidence: Confidence,
  verdict: "correct" | "incorrect",
  assisted = false,
): EvidenceEntry {
  asked += 1;
  return EvidenceEntry.parse({
    kind: "answer",
    recordedAt: AT,
    objective: "chain-rule",
    question: {
      kind: "choice",
      prompt: `Question ${asked}`,
      choices: ["Right", "Wrong"],
      answer: "A",
    },
    answer: {
      kind: "choice",
      questionId: `q${asked}`,
      choice: verdict === "correct" ? "A" : "B",
      confidence,
    },
    assisted,
    verdict,
  });
}

function written(confidence: Confidence, verdict: "correct" | "incorrect") {
  asked += 1;
  return EvidenceEntry.parse({
    kind: "answer",
    recordedAt: AT,
    objective: "chain-rule",
    question: { kind: "written", prompt: "Why?", rubric: "Because." },
    answer: {
      kind: "written",
      questionId: `q${asked}`,
      text: "My answer.",
      confidence,
    },
    assisted: false,
    verdict,
    ...(verdict === "incorrect" ? { flaw: "A step is missing." } : {}),
  });
}

function unknown(assisted = false, stuck?: string): EvidenceEntry {
  asked += 1;
  return EvidenceEntry.parse({
    kind: "answer",
    recordedAt: AT,
    objective: "chain-rule",
    question: { kind: "written", prompt: "Why?", rubric: "Because." },
    answer: {
      kind: "unknown",
      questionId: `q${asked}`,
      ...(stuck === undefined ? {} : { stuck }),
    },
    assisted,
    verdict: "unknown",
  });
}

const OVERRIDE: EvidenceEntry = {
  kind: "override",
  recordedAt: AT,
  objectives: ["chain-rule"],
};

/** One course's log: every level but 50% answered, some with help. */
const LOG = [
  choice("90", "correct"),
  choice("90", "correct"),
  choice("90", "incorrect"),
  choice("90", "correct", true),
  choice("under-50", "incorrect"),
  choice("under-50", "correct"),
  written("75", "incorrect"),
  unknown(),
  unknown(true),
  OVERRIDE,
  choice("90", "correct"),
  written("100", "correct"),
  choice("100", "incorrect", true),
  unknown(false, "Where the inner function goes."),
];

/** LOG counted by hand. */
const COUNTED: Calibration = {
  levels: [
    { confidence: "under-50", correct: 1, answered: 2 },
    { confidence: "50", correct: 0, answered: 0 },
    { confidence: "75", correct: 0, answered: 1 },
    { confidence: "90", correct: 3, answered: 4 },
    { confidence: "100", correct: 1, answered: 1 },
  ],
  unknown: 2,
};

test("each level counts the answers without help, and the correct ones; I don't know is apart, and help and overrides count for nothing", () => {
  expect(countCalibration(LOG)).toEqual(COUNTED);
});

test("no answers at all gives every level empty", () => {
  expect(countCalibration([OVERRIDE])).toEqual({
    levels: [
      { confidence: "under-50", correct: 0, answered: 0 },
      { confidence: "50", correct: 0, answered: 0 },
      { confidence: "75", correct: 0, answered: 0 },
      { confidence: "90", correct: 0, answered: 0 },
      { confidence: "100", correct: 0, answered: 0 },
    ],
    unknown: 0,
  });
});

test("a disputed answer is counted with its dispute's verdict, at the confidence it was given", () => {
  const missed = choice("90", "incorrect");
  const passed = choice("75", "correct");
  const helped = choice("100", "incorrect", true);
  const stands = choice("50", "incorrect");
  const dispute = (entry: EvidenceEntry, verdict: "correct" | "incorrect") =>
    EvidenceEntry.parse({
      kind: "dispute",
      recordedAt: AT,
      questionId: entry.kind === "answer" ? entry.answer.questionId : "",
      reason: "The grade is wrong.",
      outcome: { verdict, reason: "Decided by hand." },
    });
  const log = [
    missed,
    passed,
    helped,
    stands,
    dispute(missed, "correct"),
    dispute(passed, "incorrect"),
    // Still given with help: left out whatever its verdict.
    dispute(helped, "correct"),
    dispute(stands, "incorrect"),
  ];
  // By hand: 90% one correct of one, 75% none of one, 50% none of one.
  expect(countCalibration(log)).toEqual({
    levels: [
      { confidence: "under-50", correct: 0, answered: 0 },
      { confidence: "50", correct: 0, answered: 1 },
      { confidence: "75", correct: 0, answered: 1 },
      { confidence: "90", correct: 1, answered: 1 },
      { confidence: "100", correct: 0, answered: 0 },
    ],
    unknown: 0,
  });
});
