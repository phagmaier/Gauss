import { describe, expect, test } from "vitest";
import type { StoredUnit } from "../../shared/curriculum.ts";
import { SESSION_GAP_MS } from "../../shared/events.ts";
import { type AssessmentMode, EvidenceEntry } from "../../shared/evidence.ts";
import type { Confidence } from "../../shared/question.ts";
import { pickForGate, pickForReview } from "./review.ts";

// Every expected pick below was worked out by hand from the rules in
// docs/decisions.md, "Mastery loop" ("Review": due after 1, 3, 7, 21, then
// 60 days by the correct answers in a row in reviews and gates; the most
// overdue for its interval first), and the statuses from "Objective
// status", not by running the code.

const AT = new Date("2026-11-18T12:00:00.000Z");
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
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
  /** When it was recorded: thirty days before AT unless given, so due whatever the row. */
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
    recordedAt: given.at ?? ago(30 * DAY),
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
/** Passed in a check by one answer at 90%, never missed. */
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
    // d-three slipping first; then l-one, 30 days into its 1-day interval,
    // before d-two, 30 days into its 3-day one.
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
      // l-one passed five days ago, due, then answered with help 59 minutes
      // ago, which changes nothing in its status or its due time.
      pass("l-one", ago(5 * DAY)),
      right("l-one", { assisted: true, at: ago(59 * MINUTE) }),
      // l-two the same, answered with help exactly an hour ago, as a new
      // sitting begins.
      pass("l-two", ago(5 * DAY)),
      right("l-two", { assisted: true, at: ago(SESSION_GAP_MS) }),
      // d-one passed, then missed in this sitting's review: slipping, and
      // just asked.
      pass("d-one", ago(26 * DAY)),
      wrong("d-one", { in: "review", at: ago(5 * MINUTE) }),
    ];
    expect(pick(evidence)).toEqual(["l-two"]);
  });
});

describe("when an objective is due", () => {
  // The row is the correct answers in a review or a gate since the last
  // miss; the interval is counted from the last correct answer.
  test.each([
    { row: 0, days: 1 },
    { row: 1, days: 3 },
    { row: 2, days: 7 },
    { row: 3, days: 21 },
    { row: 4, days: 60 },
    { row: 5, days: 60 },
  ])(
    "after $days days with $row in a row in reviews and gates, and not a minute before",
    ({ row, days }) => {
      const answered = (at: string) => [
        pass("l-one", at),
        ...Array.from({ length: row }, (_, i) =>
          right("l-one", { in: i % 2 === 0 ? "review" : "gate", at }),
        ),
      ];
      expect(pick(answered(ago(days * DAY)))).toEqual(["l-one"]);
      expect(pick(answered(ago(days * DAY - MINUTE)))).toEqual([]);
    },
  );

  test("a miss starts the row again; a check's correct answer restarts the clock but keeps the row; an answer with help does neither", () => {
    const evidence = [
      // l-one: three in a row (21 days), then a review's miss, then passed
      // again in a check three days ago: a row of none, due after a day.
      pass("l-one", ago(40 * DAY)),
      right("l-one", { in: "review", at: ago(35 * DAY) }),
      right("l-one", { in: "gate", at: ago(30 * DAY) }),
      right("l-one", { in: "review", at: ago(25 * DAY) }),
      wrong("l-one", { in: "review", at: ago(20 * DAY) }),
      right("l-one", { at: ago(3 * DAY) }),
      right("l-one", { at: ago(3 * DAY) }),
      // l-two: one in a row (3 days), then right in a check two days ago:
      // not due for another day.
      pass("l-two", ago(30 * DAY)),
      right("l-two", { in: "review", at: ago(30 * DAY) }),
      right("l-two", { at: ago(2 * DAY) }),
      // l-three: passed two days ago, then right in a review with help a
      // day ago: still a row of none from two days ago, so due.
      pass("l-three", ago(2 * DAY)),
      right("l-three", { in: "review", assisted: true, at: ago(DAY) }),
    ];
    // l-one three days into one day, l-three two days into one day.
    expect(pick(evidence)).toEqual(["l-one", "l-three"]);
  });

  test("a review's miss disputed into a correct answer counts in the row", () => {
    const disputed = wrong("l-one", { in: "review", at: ago(5 * DAY) });
    const evidence = [
      pass("l-one", ago(10 * DAY)),
      disputed,
      // l-two: passed two days ago, two days into one day.
      pass("l-two", ago(2 * DAY)),
      EvidenceEntry.parse({
        kind: "dispute",
        recordedAt: ago(4 * DAY),
        questionId:
          disputed.kind === "answer" ? disputed.answer.questionId : "",
        reason: "The choice I picked is also right.",
        outcome: { verdict: "correct", reason: "It is." },
      }),
    ];
    // l-one, retained, five days into its 3-day interval, so after l-two;
    // undisputed it would be slipping and first.
    expect(pick(evidence)).toEqual(["l-two", "l-one"]);
  });
});

describe("the order", () => {
  test("slipping first, however overdue the others", () => {
    const evidence = [
      // Retained, answered in a review sixty days ago: 20 times its 3 days.
      right("l-one", { confidence: "100", in: "review", at: ago(60 * DAY) }),
      // Passed thirty days ago: 30 times its day.
      pass("l-two", ago(30 * DAY)),
      // Slipping, missed in a gate two hours ago.
      right("d-one", { confidence: "100", at: ago(30 * DAY) }),
      wrong("d-one", { in: "gate", at: ago(2 * HOUR) }),
    ];
    expect(pick(evidence)).toEqual(["d-one", "l-two", "l-one"]);
  });

  test("a retained objective long unasked comes before a passed one answered the day before", () => {
    const evidence = [
      // l-one retained by a review thirty days ago: ten times its 3 days.
      pass("l-one", ago(40 * DAY)),
      right("l-one", { in: "review", at: ago(30 * DAY) }),
      // l-two passed 25 hours ago: just past its day.
      pass("l-two", ago(25 * HOUR)),
    ];
    expect(pick(evidence)).toEqual(["l-one", "l-two"]);
  });

  test("the most overdue for its interval first, not by the days past due", () => {
    const evidence = [
      // l-one: a row of none, two days ago: twice its day, a day past due.
      pass("l-one", ago(2 * DAY)),
      // l-two: one in a row, nine days ago: three times its 3 days, six
      // days past due.
      pass("l-two", ago(40 * DAY)),
      right("l-two", { in: "review", at: ago(9 * DAY) }),
      // d-one: four in a row, the last 62 days ago: just past its 60 days,
      // two days past due.
      pass("d-one", ago(100 * DAY)),
      right("d-one", { in: "review", at: ago(90 * DAY) }),
      right("d-one", { in: "gate", at: ago(80 * DAY) }),
      right("d-one", { in: "review", at: ago(70 * DAY) }),
      right("d-one", { in: "gate", at: ago(62 * DAY) }),
    ];
    expect(pick(evidence)).toEqual(["l-two", "l-one", "d-one"]);
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
    // All answered thirty days ago: the passed ones 30 times their day, the
    // retained ones 10 times their 3 days.
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
  // Each a row of none: two to five times its day.
  const evidence = [
    pass("l-one", ago(2 * DAY)),
    pass("l-two", ago(3 * DAY)),
    pass("d-one", ago(4 * DAY)),
    pass("d-two", ago(5 * DAY)),
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

describe("what the unit gate asks", () => {
  const gate = (evidence: EvidenceEntry[], unitId = "derivatives") =>
    pickForGate(UNITS, unitId, evidence, AT).map(
      (p) => `${p.unit}/${p.objective}`,
    );

  test("the unit's objectives passed and not yet retained, in its plan's order, then up to three of other units' by review's pick", () => {
    const evidence = [
      // Own: d-three passed by two answers at 75%, d-one passed at 90%
      // minutes ago (neither the hour nor the due time applies to the
      // unit's own), d-two retained by a review's answer.
      right("d-three"),
      right("d-three"),
      pass("d-one", ago(5 * MINUTE)),
      right("d-two", { confidence: "90", in: "review" }),
      // Others, as review picks them: l-two slipping, then l-one and
      // l-three, both thirty days into their day, in the plan's order; the
      // integrals have no plan.
      pass("l-one"),
      right("l-one"),
      pass("l-two"),
      wrong("l-two", { in: "review" }),
      pass("l-three"),
    ];
    expect(gate(evidence)).toEqual([
      "derivatives/d-one",
      "derivatives/d-three",
      "limits/l-two",
      "limits/l-one",
      "limits/l-three",
    ]);
  });

  test("not an objective of the unit slipping, overridden or not passed, nor one whose pass rests on an answer given while testing out", () => {
    const evidence = [
      // d-one passed by the test's confident answer; d-two slipping; d-three
      // overridden; nothing else in the course passed.
      right("d-one", { confidence: "90", in: "test-out" }),
      pass("d-two"),
      wrong("d-two", { in: "gate" }),
      EvidenceEntry.parse({
        kind: "override",
        recordedAt: ago(3 * HOUR),
        objectives: ["d-three"],
      }),
    ];
    expect(gate(evidence)).toEqual([]);
  });

  test("an objective missed in its test and passed after it is asked, and so is one missed since its test's answer; one whose pass rests partly on that answer is not", () => {
    const evidence = [
      // d-one: missed in the test, which is no miss, then passed in a check.
      wrong("d-one", { in: "test-out" }),
      pass("d-one"),
      // d-two: the test's unsure answer and a check's: the pass rests on both.
      right("d-two", { in: "test-out" }),
      right("d-two"),
      // d-three: the test's answer, then a check's miss and two answers that
      // pass it again.
      right("d-three", { confidence: "90", in: "test-out" }),
      wrong("d-three"),
      right("d-three"),
      right("d-three"),
    ];
    expect(gate(evidence)).toEqual([
      "derivatives/d-one",
      "derivatives/d-three",
    ]);
  });

  test("other units' objectives answered within the hour or not yet due are left out, and three at most are asked", () => {
    const units = [...UNITS.slice(0, 2), unit("integrals", ["i-one"])];
    const asked = (lOneAt: string) =>
      pickForGate(
        units,
        "derivatives",
        [
          pass("d-one"),
          pass("l-one", lOneAt),
          pass("l-two"),
          pass("l-three"),
          pass("i-one"),
        ],
        AT,
      ).map((p) => p.objective);
    // l-one answered within the hour, or passed three hours ago and due
    // after a day: the other three, standing equal, in the course's order.
    const withoutLOne = ["d-one", "l-two", "l-three", "i-one"];
    expect(asked(ago(30 * MINUTE))).toEqual(withoutLOne);
    expect(asked(ago(3 * HOUR))).toEqual(withoutLOne);
    // All four due and standing equal: the first three.
    expect(asked(ago(30 * DAY))).toEqual([
      "d-one",
      "l-one",
      "l-two",
      "l-three",
    ]);
  });
});
