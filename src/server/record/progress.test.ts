import { expect, test } from "vitest";
import type { Curriculum, StoredUnit } from "../../shared/curriculum.ts";
import { EvidenceEntry } from "../../shared/evidence.ts";
import { courseProgress } from "./progress.ts";

// The expected progress below was worked out by hand from the rules in
// docs/brief.md, "Mastery and evidence": what passes, what is retained and
// slipping, and that a unit with a position in state.json is in progress.

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

test("each unit's status, and the position of each unit with one", () => {
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
    limits: {
      status: "passed",
      objectives: { "limit-law": "passed", squeeze: "passed" },
    },
    derivative: {
      status: "overridden",
      objectives: { definition: "overridden" },
    },
    rules: {
      status: "in-progress",
      segment: 1,
      phase: "discuss",
      objectives: { power: "passed", chain: "not-started" },
    },
    integral: {
      status: "in-progress",
      segment: 0,
      phase: "teach",
      objectives: { riemann: "not-started" },
    },
    substitution: {
      status: "in-progress",
      objectives: { "reverse-chain": "attempted" },
    },
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

test("each started unit's objective statuses, and where a unit in progress is: its phase, what it goes over again, what its test skipped", () => {
  const curriculum = approved([
    planned("limits", ["limit-law", "squeeze"]),
    planned("rules", ["power", "product", "chain"]),
    planned("integral", ["riemann"]),
    unplanned("substitution"),
    planned("optimisation", ["extremum"]),
  ]);
  const state = {
    units: {
      rules: {
        segment: 1,
        phase: "discuss" as const,
        testOut: { stage: "skip" as const, passed: ["chain"] },
      },
      integral: { segment: 1, phase: "teach" as const, again: ["riemann"] },
      // Just opened: its plan is not written yet.
      substitution: { segment: 0, phase: "teach" as const },
    },
  };
  const evidence = [
    // Limits, finished: one retained by a review, one slipping after a gate.
    sure("limit-law", "correct"),
    sure("squeeze", "correct"),
    assessed("limit-law", "correct", "review"),
    assessed("squeeze", "incorrect", "gate"),
    // The rules: the test passed the chain rule; powers moved on from.
    sure("chain", "correct"),
    {
      kind: "override" as const,
      recordedAt: "2026-11-15T11:00:00.000Z",
      objectives: ["power"],
    },
    sure("riemann", "incorrect"),
  ];

  expect(courseProgress(curriculum, state, evidence)).toEqual({
    limits: {
      status: "passed",
      objectives: { "limit-law": "retained", squeeze: "slipping" },
    },
    rules: {
      status: "in-progress",
      segment: 1,
      phase: "discuss",
      skipping: ["chain"],
      objectives: {
        power: "overridden",
        product: "not-started",
        chain: "passed",
      },
    },
    integral: {
      status: "in-progress",
      segment: 1,
      phase: "teach",
      again: ["riemann"],
      objectives: { riemann: "attempted" },
    },
    substitution: { status: "in-progress", segment: 0, phase: "teach" },
    optimisation: { status: "not-started" },
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
