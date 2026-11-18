import { expect, test } from "vitest";
import type { Curriculum, StoredUnit } from "../../shared/curriculum.ts";
import { EvidenceEntry } from "../../shared/evidence.ts";
import { courseProgress } from "./progress.ts";

// The expected progress below was worked out by hand from the rules in
// docs/decisions.md, "Objective status": what passes, and that a unit with a
// position in state.json is in progress; and "Mastery loop": what is
// retained and slipping.

const planned = (id: string, objectives: string[]): StoredUnit => ({
  id,
  title: `The ${id}`,
  goal: `Learn ${id}.`,
  prerequisites: [],
  plan: {
    objectives: objectives.map((o) => ({ id: o, statement: `Do ${o}.` })),
    segments: objectives.map((o) => ({ title: o, objectives: [o] })),
  },
});
const unplanned = (id: string): StoredUnit => ({
  id,
  title: `The ${id}`,
  goal: `Learn ${id}.`,
  prerequisites: [],
});

/** One unassisted answer at 90%, enough to pass its objective alone. */
const sure = (objective: string, verdict: "correct" | "incorrect") =>
  EvidenceEntry.parse({
    kind: "answer",
    recordedAt: "2026-11-15T10:00:00.000Z",
    objective,
    question: {
      kind: "choice",
      prompt: `About ${objective}.`,
      choices: ["Yes", "No"],
      answer: "A",
    },
    answer: {
      kind: "choice",
      questionId: `q-${objective}-${verdict}`,
      choice: verdict === "correct" ? "A" : "B",
      confidence: "90",
    },
    assisted: false,
    verdict,
  });

const approved = (units: StoredUnit[]): Curriculum => ({
  approval: { status: "approved", approvedAt: "2026-11-14T10:00:00.000Z" },
  units,
});

test("each unit's status, and the segment of each unit with a position", () => {
  const curriculum = approved([
    planned("limits", ["limit-law", "squeeze"]),
    planned("derivative", ["definition"]),
    planned("rules", ["power", "chain"]),
    planned("integral", ["riemann"]),
    planned("substitution", ["reverse-chain"]),
    // An id that every object inherits a property of: not in progress.
    unplanned("constructor"),
  ]);
  const state = {
    units: {
      rules: { segment: 1, phase: "discuss" as const },
      // Just started: a position, no evidence yet.
      integral: { segment: 0, phase: "teach" as const },
      // A unit the curriculum no longer has is left out.
      gone: { segment: 2, phase: "closed" as const },
    },
  };
  const evidence = [
    sure("limit-law", "correct"),
    sure("squeeze", "correct"),
    sure("definition", "incorrect"),
    {
      kind: "override" as const,
      recordedAt: "2026-11-15T11:00:00.000Z",
      objectives: ["definition"],
    },
    sure("power", "correct"),
    // Answered, not passed, and its position gone: a record left half-written.
    sure("reverse-chain", "incorrect"),
  ];

  expect(courseProgress(curriculum, state, evidence)).toEqual({
    limits: { status: "passed", retained: 0, slipping: 0 },
    derivative: { status: "overridden", retained: 0, slipping: 0 },
    rules: { status: "in-progress", segment: 1 },
    integral: { status: "in-progress", segment: 0 },
    substitution: { status: "in-progress" },
    constructor: { status: "not-started" },
  });
});

/** An answer at 90% given in another unit's assessment. */
const assessed = (
  objective: string,
  verdict: "correct" | "incorrect",
  mode: "review" | "gate",
) => {
  const entry = sure(objective, verdict);
  if (entry.kind !== "answer") throw new Error("An answer was made.");
  return EvidenceEntry.parse({
    ...entry,
    question: { ...entry.question, prompt: `Again, about ${objective}.` },
    answer: { ...entry.answer, questionId: `${mode}-${objective}` },
    assessment: { mode, unit: "later" },
  });
};

test("how many of a finished unit's objectives are retained and slipping, and none counted for a unit in progress", () => {
  const curriculum = approved([
    planned("limits", ["limit-law", "squeeze", "continuity"]),
    planned("derivative", ["definition", "rate"]),
    planned("rules", ["power"]),
  ]);
  const state = { units: { rules: { segment: 0, phase: "check" as const } } };
  const evidence = [
    // Limits: one retained by a review, one slipping after a gate, one passed.
    sure("limit-law", "correct"),
    sure("squeeze", "correct"),
    sure("continuity", "correct"),
    assessed("limit-law", "correct", "review"),
    assessed("squeeze", "incorrect", "gate"),
    // The derivative: one retained, one overridden.
    sure("definition", "correct"),
    assessed("definition", "correct", "gate"),
    {
      kind: "override" as const,
      recordedAt: "2026-11-15T11:00:00.000Z",
      objectives: ["rate"],
    },
    // The rules, in progress: retained, but not counted.
    sure("power", "correct"),
    assessed("power", "correct", "review"),
  ];

  expect(courseProgress(curriculum, state, evidence)).toEqual({
    limits: { status: "passed", retained: 1, slipping: 1 },
    derivative: { status: "overridden", retained: 1, slipping: 0 },
    rules: { status: "in-progress", segment: 0 },
  });
});

test("the segment that goes over objectives again is the plan's segment count", () => {
  const curriculum = approved([planned("limits", ["limit-law", "squeeze"])]);
  const state = {
    units: {
      limits: { segment: 2, phase: "teach" as const, again: ["squeeze"] },
    },
  };

  expect(courseProgress(curriculum, state, [])).toEqual({
    limits: { status: "in-progress", segment: 2 },
  });
});

test("a draft, or no curriculum, has no progress", () => {
  const units = [planned("limits", ["limit-law"])];
  const state = { units: { limits: { segment: 0, phase: "teach" as const } } };

  expect(
    courseProgress({ approval: { status: "draft" }, units }, state, []),
  ).toEqual({});
  expect(courseProgress(null, state, [])).toEqual({});
});
