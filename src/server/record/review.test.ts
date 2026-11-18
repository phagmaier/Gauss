import { describe, expect, test } from "vitest";
import type { StoredUnit } from "../../shared/curriculum.ts";
import { SESSION_GAP_MS } from "../../shared/events.ts";
import { type AssessmentMode, EvidenceEntry } from "../../shared/evidence.ts";
import type { Confidence } from "../../shared/question.ts";
import { pickForReview } from "./review.ts";

// Every expected pick below was worked out by hand from the rules in
// docs/decisions.md, "Mastery loop" ("Review"), and the statuses from
// "Objective status", not by running the code.

const AT = new Date("2026-11-18T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;
/** The time `ms` before AT. */
const ago = (ms: number) => new Date(AT.getTime() - ms).toISOString();

/** Two units with plans, and one not planned yet. */
const UNITS: StoredUnit[] = [
  unit("limits", ["l-one", "l-two", "l-three"]),
  unit("derivatives", ["d-one", "d-two", "d-three"]),
  {
    id: "integrals",
    title: "Integrals",
    goal: "Integrate.",
    prerequisites: ["derivatives"],
  },
];

function unit(id: string, objectives: string[]): StoredUnit {
  return {
    id,
    title: id,
    goal: `Use ${id}.`,
    prerequisites: [],
    plan: {
      objectives: objectives.map((o) => ({ id: o, statement: `Do ${o}.` })),
      segments: [{ title: "All of it", objectives }],
    },
  };
}

interface Given {
  /** When it was recorded: three hours before AT unless given. */
  at?: string;
  confidence?: Confidence;
  assisted?: boolean;
  in?: AssessmentMode;
}

let asked = 0;

/** An answer to a question of its own, as the record would read it. */
function answer(
  objective: string,
  verdict: "correct" | "incorrect",
  given: Given = {},
): EvidenceEntry {
  asked += 1;
  return EvidenceEntry.parse({
    kind: "answer",
    recordedAt: given.at ?? ago(3 * HOUR),
    objective,
    question: {
      kind: "choice",
      prompt: `Question ${asked}.`,
      choices: ["Right", "Wrong"],
      answer: "A",
    },
    answer: {
      kind: "choice",
      questionId: `q${asked}`,
      choice: verdict === "correct" ? "A" : "B",
      confidence: given.confidence ?? "75",
    },
    assisted: given.assisted ?? false,
    verdict,
    ...(given.in === undefined
      ? {}
      : { assessment: { mode: given.in, unit: "limits" } }),
  });
}

const right = (objective: string, given: Given = {}) =>
  answer(objective, "correct", given);
const wrong = (objective: string, given: Given = {}) =>
  answer(objective, "incorrect", given);
/** Passed by one answer at 90%, never missed. */
const pass = (objective: string, at?: string) =>
  right(objective, { confidence: "90", ...(at === undefined ? {} : { at }) });

const pick = (
  evidence: EvidenceEntry[],
  options: { count?: number; leaveOut?: string[] } = {},
) =>
  pickForReview(UNITS, evidence, {
    at: AT,
    count: options.count ?? 10,
    leaveOut: options.leaveOut ?? [],
  }).map((p) => p.objective);

describe("which objectives review may ask", () => {
  test("only passed, retained and slipping ones, each with the unit whose plan holds it", () => {
    const evidence = [
      // l-one passed; l-two attempted, one answer at 75% not passing;
      // l-three overridden after a miss; d-one never answered.
      pass("l-one"),
      right("l-two"),
      wrong("l-three"),
      EvidenceEntry.parse({
        kind: "override",
        recordedAt: ago(3 * HOUR),
        objectives: ["l-three"],
      }),
      // d-two retained, by a gate's confident answer; d-three slipping, a
      // pass then a review's miss.
      right("d-two", { confidence: "100", in: "gate" }),
      pass("d-three"),
      wrong("d-three", { in: "review" }),
    ];
    expect(
      pickForReview(UNITS, evidence, { at: AT, count: 10, leaveOut: [] }),
    ).toEqual([
      { unit: "derivatives", objective: "d-three" },
      { unit: "limits", objective: "l-one" },
      { unit: "derivatives", objective: "d-two" },
    ]);
  });

  test("slipping objectives overridden together on the closing card are left out", () => {
    const evidence = [
      pass("l-one"),
      wrong("l-one", { in: "gate" }),
      pass("l-two"),
      wrong("l-two", { in: "gate" }),
      pass("d-one"),
      EvidenceEntry.parse({
        kind: "override",
        recordedAt: ago(2 * HOUR),
        objectives: ["l-one", "l-two"],
      }),
    ];
    expect(pick(evidence)).toEqual(["d-one"]);
  });

  test("an objective no plan holds is left out, though the evidence has it passed", () => {
    expect(pick([pass("i-one"), pass("l-two")])).toEqual(["l-two"]);
  });

  test("an empty record, or one answered only within the hour, gives nothing", () => {
    expect(pick([])).toEqual([]);
    expect(pick([pass("l-one", ago(10 * MINUTE))])).toEqual([]);
  });
});

describe("the hour", () => {
  test("an objective answered within the hour is left out, by any answer on it, while one answered an hour ago is asked", () => {
    const evidence = [
      // l-one passed long ago, then answered with help 59 minutes ago,
      // which changes nothing in its status.
      pass("l-one", ago(5 * HOUR)),
      right("l-one", { assisted: true, at: ago(59 * MINUTE) }),
      // l-two passed exactly an hour ago, as a new sitting begins.
      pass("l-two", ago(SESSION_GAP_MS)),
      // d-one passed, then missed in this sitting's review: slipping, and
      // just asked.
      pass("d-one", ago(26 * HOUR)),
      wrong("d-one", { in: "review", at: ago(5 * MINUTE) }),
    ];
    expect(pick(evidence)).toEqual(["l-two"]);
  });
});

describe("the order", () => {
  test("slipping first, then passed, then retained, whatever the confidence and the times", () => {
    const evidence = [
      // Retained, answered a day ago.
      right("l-one", { confidence: "100", in: "review", at: ago(24 * HOUR) }),
      // Passed at 90%, two hours ago, so less confident than the retained
      // one and answered more recently.
      pass("l-two", ago(2 * HOUR)),
      // Slipping, answered two hours ago, passed at 100% before.
      right("d-one", { confidence: "100", at: ago(30 * HOUR) }),
      wrong("d-one", { in: "gate", at: ago(2 * HOUR) }),
    ];
    expect(pick(evidence)).toEqual(["d-one", "l-two", "l-one"]);
  });

  test("passed ones by the lowest confidence among the answers that passed them", () => {
    const evidence = [
      // l-one: two correct answers, at 100% and 50%; the lowest is 50%.
      right("l-one", { confidence: "100" }),
      right("l-one", { confidence: "50" }),
      // l-two: under 50% and then a miss, both cleared by it; then an
      // answer with help at 50%, which counts for nothing, and two at 90%
      // and 100%. The lowest of those that passed it is 90%.
      right("l-two", { confidence: "under-50" }),
      wrong("l-two"),
      right("l-two", { confidence: "50", assisted: true }),
      right("l-two", { confidence: "90" }),
      right("l-two", { confidence: "100" }),
      // d-one: two at 75%.
      right("d-one", { confidence: "75" }),
      right("d-one", { confidence: "75" }),
    ];
    expect(pick(evidence)).toEqual(["l-one", "d-one", "l-two"]);
  });

  test("an answer disputed into a correct one counts with its confidence", () => {
    // l-one: graded wrong at 50%, which a dispute overturned, then right at
    // 100%: passed by two answers, the lowest at 50%. l-two: passed at 75%.
    const disputed = wrong("l-one", { confidence: "50" });
    const evidence = [
      disputed,
      right("l-one", { confidence: "100" }),
      right("l-two"),
      right("l-two"),
      EvidenceEntry.parse({
        kind: "dispute",
        recordedAt: ago(2 * HOUR),
        questionId:
          disputed.kind === "answer" ? disputed.answer.questionId : "",
        reason: "The choice I picked is also right.",
        outcome: { verdict: "correct", reason: "It is." },
      }),
    ];
    expect(pick(evidence)).toEqual(["l-one", "l-two"]);
  });

  test("passed ones of equal confidence: the longest unanswered first", () => {
    const evidence = [
      pass("l-one", ago(2 * HOUR)),
      pass("l-two", ago(5 * HOUR)),
      // d-one: passed at 90% eight hours ago, and answered since, with help.
      pass("d-one", ago(8 * HOUR)),
      right("d-one", { assisted: true, at: ago(3 * HOUR) }),
    ];
    expect(pick(evidence)).toEqual(["l-two", "d-one", "l-one"]);
  });

  test("retained ones: the longest unanswered first", () => {
    const evidence = [
      right("l-one", { confidence: "90", in: "gate", at: ago(2 * HOUR) }),
      right("l-two", { confidence: "100", in: "review", at: ago(9 * HOUR) }),
      right("d-one", { confidence: "50", at: ago(30 * HOUR) }),
      right("d-one", { confidence: "50", in: "review", at: ago(4 * HOUR) }),
    ];
    expect(pick(evidence)).toEqual(["l-two", "d-one", "l-one"]);
  });

  test("slipping ones: the longest unanswered first", () => {
    const evidence = [
      pass("l-one", ago(30 * HOUR)),
      wrong("l-one", { in: "review", at: ago(2 * HOUR) }),
      pass("d-two", ago(30 * HOUR)),
      wrong("d-two", { in: "gate", at: ago(6 * HOUR) }),
    ];
    expect(pick(evidence)).toEqual(["d-two", "l-one"]);
  });

  test("otherwise equal: in the course's order, by unit and then by the plan, not by the log", () => {
    const evidence = [
      pass("d-one"),
      pass("l-three"),
      pass("l-one"),
      right("d-two", { confidence: "100", in: "review" }),
      right("l-two", { confidence: "100", in: "review" }),
    ];
    expect(pick(evidence)).toEqual([
      "l-one",
      "l-three",
      "d-one",
      "l-two",
      "d-two",
    ]);
  });
});

describe("the count and the objectives left out", () => {
  const evidence = [
    pass("l-one", ago(2 * HOUR)),
    pass("l-two", ago(3 * HOUR)),
    pass("d-one", ago(4 * HOUR)),
    pass("d-two", ago(5 * HOUR)),
  ];

  test("up to the count", () => {
    expect(pick(evidence)).toEqual(["d-two", "d-one", "l-two", "l-one"]);
    expect(pick(evidence, { count: 3 })).toEqual(["d-two", "d-one", "l-two"]);
    expect(pick(evidence, { count: 0 })).toEqual([]);
  });

  test("those left out are skipped, and the next ones take their place", () => {
    expect(
      pick(evidence, { count: 3, leaveOut: ["d-two", "l-two", "d-three"] }),
    ).toEqual(["d-one", "l-one"]);
    expect(pick(evidence, { count: 2, leaveOut: ["d-one"] })).toEqual([
      "d-two",
      "l-two",
    ]);
  });
});
