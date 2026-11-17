import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Calibration } from "../../shared/calibration.ts";
import { EvidenceEntry } from "../../shared/evidence.ts";
import type { Confidence } from "../../shared/question.ts";
import { countCalibration, readCalibration } from "./calibration.ts";
import { openDataRoot } from "./data-root.ts";

// Every expected count below was worked out by hand from the task (plan
// 2.27): per level, the unassisted answers and how many were correct; "I
// don't know" apart; every answer with help left out; overrides ignored.

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

/** Two courses' logs: every level but 50% answered, some with help. */
const FIRST = [
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
];
const SECOND = [
  choice("90", "correct"),
  written("100", "correct"),
  choice("100", "incorrect", true),
  unknown(false, "Where the inner function goes."),
];

/** FIRST and SECOND counted by hand. */
const COUNTED: Omit<Calibration, "skipped"> = {
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
  expect(countCalibration([FIRST, SECOND])).toEqual(COUNTED);
});

test("no answers at all gives every level empty", () => {
  expect(countCalibration([[], [OVERRIDE]])).toEqual({
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

// Each test gets its own data root; none touches ~/gauss (AGENTS.md).
let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "gauss-calibration-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

test("every course of the data root is counted, a draft's empty log too, and a course whose evidence cannot be read is skipped by title", async () => {
  const root = openDataRoot({ path: dir, now: () => new Date(AT) });
  const course = async (title: string, approve: boolean) => {
    const { id } = await root.createCourse({ title });
    const proposal = {
      title,
      units: [{ id: "only", title: "Only", goal: "Learn.", prerequisites: [] }],
      style: "Plain.",
      background: "None.",
    };
    await root.saveProposal(id, proposal);
    if (approve) await root.approveCurriculum(id, proposal);
    return id;
  };
  const first = await course("Calculus I", true);
  const second = await course("Probability", true);
  await course("Topology", false);
  const broken = await course("Group theory", true);
  for (const entry of FIRST) await root.appendEvidence(first, entry);
  for (const entry of SECOND) await root.appendEvidence(second, entry);
  await root.appendEvidence(broken, choice("50", "correct"));
  // A line no append can leave: the log was edited, or the disk failed.
  await writeFile(join(dir, "courses", broken, "evidence.jsonl"), "{\n");
  const quiet = vi.spyOn(console, "error").mockImplementation(() => {});

  const counted = await readCalibration(root);
  quiet.mockRestore();

  // The skipped course's answer, at 50%, would have shown there.
  expect(counted).toEqual({
    ...COUNTED,
    skipped: ["Group theory"],
  } satisfies Calibration);
});
