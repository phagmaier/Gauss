import { describe, expect, test } from "vitest";
import { StoredUnit } from "../../shared/curriculum.ts";
import { type AssessmentMode, EvidenceEntry } from "../../shared/evidence.ts";
import type { Confidence } from "../../shared/question.ts";
import type { UnitPosition } from "../../shared/state.ts";
import type { ObjectiveStatus, UnitStatus } from "../../shared/status.ts";
import { objectiveStatus, takesPass, unitStatus } from "./status.ts";

// Every expected status below was worked out by hand from the rules in
// docs/decisions.md, "Objective status", with the passing rule of task 2.23
// ("Passing without a confident answer"), and "Mastery loop" for retained
// and slipping, not by running the code.

const CHAIN = "chain-rule";
const PRODUCT = "product-rule";
const IMPLICIT = "implicit";

interface Given {
  /** The chain rule unless named. */
  objective?: string;
  /** Each answer gets a question of its own unless the prompt is named. */
  prompt?: string;
  choices?: string[];
  confidence?: Confidence;
  assisted?: boolean;
  recordedAt?: string;
  /** The assessment it was given in; none for a segment's check. */
  in?: AssessmentMode;
}

let asked = 0;

/** One line of evidence.jsonl, parsed as the record would read it. */
function answer(
  verdict: "correct" | "incorrect" | "unknown",
  given: Given,
): EvidenceEntry {
  asked += 1;
  const questionId = `q${asked}`;
  return EvidenceEntry.parse({
    kind: "answer",
    recordedAt: given.recordedAt ?? "2026-11-15T10:00:00.000Z",
    objective: given.objective ?? CHAIN,
    question: {
      kind: "choice",
      prompt: given.prompt ?? `Question ${asked}: differentiate this.`,
      choices: given.choices ?? ["$2x\\cos(x^2)$", "$\\cos(x^2)$"],
      answer: "A",
    },
    answer:
      verdict === "unknown"
        ? { kind: "unknown", questionId }
        : {
            kind: "choice",
            questionId,
            choice: verdict === "correct" ? "A" : "B",
            confidence: given.confidence ?? "75",
          },
    assisted: given.assisted ?? false,
    verdict,
    ...(given.in === undefined
      ? {}
      : { assessment: { mode: given.in, unit: "differentiation" } }),
  });
}
/** A written answer, graded as the grader would. */
function written(
  verdict: "correct" | "incorrect",
  prompt: string,
  confidence: Confidence = "75",
): EvidenceEntry {
  asked += 1;
  const questionId = `q${asked}`;
  return EvidenceEntry.parse({
    kind: "answer",
    recordedAt: "2026-11-15T10:00:00.000Z",
    objective: CHAIN,
    question: {
      kind: "written",
      prompt,
      rubric: "Names the outer and the inner function, and multiplies.",
    },
    answer: {
      kind: "written",
      questionId,
      text: "By the chain rule.",
      confidence,
    },
    assisted: false,
    verdict,
    ...(verdict === "incorrect"
      ? { flaw: "The inner derivative is missing." }
      : {}),
  });
}
const right = (confidence: Confidence, given: Given = {}) =>
  answer("correct", { ...given, confidence });
const wrong = (confidence: Confidence, given: Given = {}) =>
  answer("incorrect", { ...given, confidence });
const dontKnow = (given: Given = {}) => answer("unknown", given);
const override = (...objectives: string[]) =>
  EvidenceEntry.parse({
    kind: "override",
    recordedAt: "2026-11-15T10:30:00.000Z",
    objectives,
  });

const SPACED = "Differentiate $\\sin(x^2)$.";

test("the same two-file exercise in a different display order counts once", () => {
  function solved(questionId: string, files: string[], prompt: string) {
    const code = files.map((path) => ({ path, content: "value = 42\n" }));
    return EvidenceEntry.parse({
      kind: "answer",
      recordedAt: "2026-11-15T10:00:00.000Z",
      objective: CHAIN,
      question: {
        kind: "code",
        prompt,
        files,
        solution: code,
        tests: [{ path: "check.py", content: "assert True\n" }],
        command: ["python", "check.py"],
      },
      answer: { kind: "code", questionId, confidence: "50", files: code },
      verdict: "correct",
      output: "Exit status 0.",
      assisted: false,
    });
  }
  const first = solved("q1", ["a.py", "b.py"], "Set both values to 42.");
  const reordered = solved("q2", ["b.py", "a.py"], "Set both values to 42.");
  const different = solved("q3", ["a.py", "b.py"], "Return the sum.");
  expect(objectiveStatus([first, reordered], CHAIN)).toBe("attempted");
  expect(objectiveStatus([first, different], CHAIN)).toBe("passed");
});

describe("objective status", () => {
  const cases: { name: string; log: EvidenceEntry[]; is: ObjectiveStatus }[] = [
    { name: "no evidence", log: [], is: "not-started" },
    {
      name: "evidence on other objectives only",
      log: [right("100", { objective: PRODUCT }), override(PRODUCT)],
      is: "not-started",
    },

    { name: "one correct answer at 90%", log: [right("90")], is: "passed" },
    {
      name: "correct answers to two questions at 75% and under 50%",
      log: [right("75"), right("under-50")],
      is: "passed",
    },
    {
      name: "after a miss, two correct answers at 75%",
      log: [wrong("90"), right("75"), right("75")],
      is: "passed",
    },
    {
      name: "correct at 75%, correct with help, then correct at 50%",
      log: [right("75"), right("90", { assisted: true }), right("50")],
      is: "passed",
    },
    {
      name: "after a miss, a confident correct answer and an unsure one to another question",
      log: [wrong("50"), right("100"), right("50")],
      is: "passed",
    },
    {
      name: "after a miss, an unsure correct answer and a confident one to another question",
      log: [dontKnow(), right("50"), right("90")],
      is: "passed",
    },
    {
      name: "after a miss, two correct answers with one with help between them",
      log: [
        wrong("75"),
        right("90"),
        right("100", { assisted: true }),
        right("50"),
      ],
      is: "passed",
    },
    {
      name: "after a miss, one prompt with other choices, which is another question",
      log: [
        wrong("75"),
        right("90", { prompt: SPACED }),
        right("75", { prompt: SPACED, choices: ["$2x$", "$x^2$", "$0$"] }),
      ],
      is: "passed",
    },
    {
      name: "an override after the pass",
      log: [right("90"), override(CHAIN)],
      is: "passed",
    },
    {
      name: "a pass after an override",
      log: [override(CHAIN), right("90")],
      is: "passed",
    },

    {
      name: "one correct answer at 75%",
      log: [right("75")],
      is: "attempted",
    },
    {
      name: `a correct answer at 100% after a miss and an "I don't know"`,
      log: [wrong("100"), dontKnow(), right("100")],
      is: "attempted",
    },
    {
      name: "after a miss, a confident correct answer, then one with help",
      log: [wrong("75"), right("90"), right("100", { assisted: true })],
      is: "attempted",
    },
    {
      name: `the user's sitting: "I don't know", correct at 75%, correct at 90% with help`,
      log: [dontKnow(), right("75"), right("90", { assisted: true })],
      is: "attempted",
    },
    {
      name: `the user's sitting: three "I don't know"s`,
      log: [dontKnow(), dontKnow(), dontKnow()],
      is: "attempted",
    },
    { name: "a wrong answer at 100%", log: [wrong("100")], is: "attempted" },
    { name: `an "I don't know"`, log: [dontKnow()], is: "attempted" },
    {
      name: "a correct answer at 100% with help",
      log: [right("100", { assisted: true })],
      is: "attempted",
    },
    {
      name: "two correct answers at 75%, the second with help",
      log: [right("75"), right("75", { assisted: true })],
      is: "attempted",
    },
    {
      name: "one question answered correctly twice at 75%, never missed",
      log: [right("75", { prompt: SPACED }), right("75", { prompt: SPACED })],
      is: "attempted",
    },
    {
      name: "after a miss, one question answered correctly twice, spaced differently",
      log: [
        wrong("75"),
        right("90", { prompt: SPACED }),
        right("90", { prompt: `  Differentiate  $\\sin(x^2)$.\n` }),
      ],
      is: "attempted",
    },
    {
      name: "after a miss, written answers at 90% and 75% to different questions",
      log: [
        wrong("75"),
        written("correct", "Explain why $(\\sin x^2)' = 2x\\cos x^2$.", "90"),
        written("correct", "Differentiate $e^{3x}$ and explain each step."),
      ],
      is: "passed",
    },
    {
      name: "two written answers at 75% to different questions",
      log: [
        written("correct", "Explain why $(\\sin x^2)' = 2x\\cos x^2$."),
        written("correct", "Differentiate $e^{3x}$ and explain each step."),
      ],
      is: "passed",
    },
    {
      name: "after a miss, one written question answered correctly twice",
      log: [
        wrong("75"),
        written("correct", SPACED, "90"),
        written("correct", SPACED, "90"),
      ],
      is: "attempted",
    },
    {
      name: "after a miss, a written question with the prompt of a choice question",
      log: [
        wrong("75"),
        right("90", { prompt: SPACED }),
        written("correct", SPACED),
      ],
      is: "passed",
    },
    {
      name: "a miss between two confident correct answers",
      log: [right("90"), wrong("50"), right("90")],
      is: "attempted",
    },
    {
      name: `an "I don't know" between two correct answers at 100%`,
      log: [right("100"), dontKnow(), right("100")],
      is: "attempted",
    },
    {
      name: "a miss with help between two confident correct answers",
      log: [right("90"), wrong("75", { assisted: true }), right("90")],
      is: "attempted",
    },
    {
      name: "a miss after a pass",
      log: [right("100"), wrong("75")],
      is: "attempted",
    },
    {
      name: "a miss logged after a pass, though its clock reads earlier",
      log: [
        right("90", { recordedAt: "2026-11-15T10:05:00.000Z" }),
        wrong("75", { recordedAt: "2026-11-15T10:00:00.000Z" }),
      ],
      is: "attempted",
    },
    {
      name: "a miss after an override",
      log: [override(CHAIN), wrong("50")],
      is: "attempted",
    },

    {
      name: "an override of the segment's two objectives, with no answers",
      log: [override(IMPLICIT, CHAIN)],
      is: "overridden",
    },
    {
      name: "a correct answer at 75%, then an override",
      log: [right("75"), override(CHAIN)],
      is: "overridden",
    },
  ];

  test.each(cases)("$name: $is", ({ log, is }) => {
    expect(objectiveStatus(log, CHAIN)).toBe(is);
  });
});

describe("retained and slipping", () => {
  const cases: { name: string; log: EvidenceEntry[]; is: ObjectiveStatus }[] = [
    {
      name: "a pass, then a correct answer in a review",
      log: [right("90"), right("50", { in: "review" })],
      is: "retained",
    },
    {
      name: "a pass by two answers, then a correct answer in a gate",
      log: [right("75"), right("50"), right("75", { in: "gate" })],
      is: "retained",
    },
    {
      // A gate's answer counts even with no time since the pass, and it
      // can be the one that passes.
      name: "after a miss, a correct answer in a check and one in a gate",
      log: [wrong("75"), right("75"), right("50", { in: "gate" })],
      is: "retained",
    },
    {
      name: "one confident correct answer testing out passes, and is not retained",
      log: [right("100", { in: "test-out" })],
      is: "passed",
    },
    {
      name: "a pass, then a correct answer testing out",
      log: [right("90"), right("90", { in: "test-out" })],
      is: "passed",
    },
    {
      name: "a pass, then a correct answer in a review with help",
      log: [right("90"), right("90", { in: "review", assisted: true })],
      is: "passed",
    },
    {
      name: "a pass, then a miss in a review",
      log: [right("90"), wrong("75", { in: "review" })],
      is: "slipping",
    },
    {
      name: `a retained objective, then "I don't know" in a gate`,
      log: [
        right("90"),
        right("75", { in: "review" }),
        dontKnow({ in: "gate" }),
      ],
      is: "slipping",
    },
    {
      name: "slipping, then one confident correct answer, which does not pass after a miss",
      log: [right("90"), wrong("75", { in: "review" }), right("100")],
      is: "slipping",
    },
    {
      name: "slipping, then missed again in a check",
      log: [right("90"), wrong("75", { in: "gate" }), right("75"), wrong("50")],
      is: "slipping",
    },
    {
      name: "slipping, then two correct answers in checks",
      log: [
        right("90"),
        wrong("75", { in: "review" }),
        right("75"),
        right("50"),
      ],
      is: "passed",
    },
    {
      name: "slipping, then two correct answers, one of them in a review",
      log: [
        right("90"),
        wrong("75", { in: "review" }),
        right("75", { in: "review" }),
        right("50"),
      ],
      is: "retained",
    },
    {
      // The miss clears the review's answer before it, and nothing since
      // was given cold.
      name: "retained, missed in a gate, then passed again in checks",
      log: [
        right("90"),
        right("75", { in: "review" }),
        wrong("50", { in: "gate" }),
        right("75"),
        right("75"),
      ],
      is: "passed",
    },
    {
      name: "a miss in a review after a correct answer that did not pass",
      log: [right("75"), wrong("75", { in: "review" })],
      is: "attempted",
    },
    {
      // Slipping needs the miss to be in a review or a gate, as the brief
      // has it; an old record could miss a passed objective in a check.
      name: "a pass, then a miss in a check",
      log: [right("90"), wrong("50")],
      is: "attempted",
    },
    {
      name: "slipping, passed again, then missed in a check",
      log: [
        right("90"),
        wrong("75", { in: "review" }),
        right("75"),
        right("50"),
        wrong("50"),
      ],
      is: "attempted",
    },
    {
      name: "a miss while testing out counts as an answer",
      log: [dontKnow({ in: "test-out" })],
      is: "attempted",
    },
    {
      name: "a miss while testing out, then one confident correct answer",
      log: [wrong("90", { in: "test-out" }), right("90")],
      is: "passed",
    },
    {
      // Not a miss, so it clears neither the correct answer before it nor
      // the pass that answer and the next one make.
      name: "an unsure correct answer and a miss testing out, then one correct answer",
      log: [
        right("75", { in: "test-out" }),
        wrong("50", { in: "test-out" }),
        right("50"),
      ],
      is: "passed",
    },
    {
      name: "a pass testing out, then a miss testing out",
      log: [right("100", { in: "test-out" }), dontKnow({ in: "test-out" })],
      is: "passed",
    },
    {
      name: "slipping, then moved on from",
      log: [right("90"), wrong("75", { in: "gate" }), override(CHAIN)],
      is: "overridden",
    },
    {
      name: "overridden, then passed and missed in a review",
      log: [override(CHAIN), right("90"), wrong("75", { in: "review" })],
      is: "slipping",
    },
  ];

  test.each(cases)("$name: $is", ({ log, is }) => {
    expect(objectiveStatus(log, CHAIN)).toBe(is);
  });

  test("cold answers leave an override in place until the pass is reestablished", () => {
    const log = [
      override(CHAIN),
      wrong("75", { in: "review" }),
      right("90", { in: "gate" }),
      right("50", { in: "review" }),
      wrong("50", { in: "gate" }),
    ];
    const statuses = log.map((_, i) =>
      objectiveStatus(log.slice(0, i + 1), CHAIN),
    );
    expect(statuses).toEqual([
      "overridden",
      "overridden",
      "overridden",
      "retained",
      "slipping",
    ]);
  });
});

// The theology course's first objective as the user answered it on
// 2026-11-17. Under task 2.19's rule the first two answers never counted,
// and it ended overridden.
const THEOLOGY = [
  written(
    "correct",
    "Answer a Protestant friend who calls Tradition a human addition.",
  ),
  right("50", { prompt: "Why do the Orthodox insist on triple immersion?" }),
  dontKnow(),
  written(
    "correct",
    "Criticise 'partly in Scripture, partly in Tradition'.",
    "90",
  ),
  written(
    "correct",
    "Say what Dei Verbum changed, and what difference remains.",
  ),
];

describe("the theology sitting", () => {
  test.each([
    { after: "a correct answer at 75%", answers: 1, is: "attempted" },
    {
      after: "a second, at 50%, to another question",
      answers: 2,
      is: "passed",
    },
    {
      after: `then "I don't know" and a correct answer at 90%`,
      answers: 4,
      is: "attempted",
    },
    {
      after: "then a correct answer to a new question",
      answers: 5,
      is: "passed",
    },
  ])("after $after: $is", ({ answers, is }) => {
    expect(objectiveStatus(THEOLOGY.slice(0, answers), CHAIN)).toBe(is);
  });
});

// A unit of three objectives in two segments, and one sitting in it worked
// by hand, its objectives' answers interleaved as a check interleaves them.
const UNIT = StoredUnit.parse({
  id: "differentiation",
  title: "Differentiation rules",
  goal: "Differentiate products, composites and curves given implicitly.",
  prerequisites: [],
  plan: {
    objectives: [
      { id: PRODUCT, statement: "Apply the product rule." },
      { id: CHAIN, statement: "Apply the chain rule to a composite function." },
      { id: IMPLICIT, statement: "Differentiate a curve given implicitly." },
    ],
    segments: [
      { title: "The product rule", objectives: [PRODUCT] },
      {
        title: "Composites and implicit curves",
        objectives: [CHAIN, IMPLICIT],
      },
    ],
  },
});
const SITTING = [
  // Segment 1's check: a miss clears the first correct answer, and two
  // more pass the product rule.
  right("75", { objective: PRODUCT }),
  wrong("90", { objective: PRODUCT }),
  right("50", { objective: PRODUCT }),
  right("90", { objective: PRODUCT }),
  // Segment 2's check: the learner wrote to the tutor while the first
  // question was open, so its answer had help. Implicit passes at 90%.
  right("100", { assisted: true }),
  right("90", { objective: IMPLICIT }),
  dontKnow(),
  right("75"),
  // "Move on without the check": the chain rule has one correct answer
  // since its miss, so it is overridden; implicit stays passed.
  override(CHAIN, IMPLICIT),
  // "Go over the one again": the chain rule passes at 90%, its second
  // correct answer since its miss.
  right("90"),
];
const CLOSED_AT_END: UnitPosition = { segment: 1, phase: "closed" };

describe("a sitting worked by hand", () => {
  test.each([
    {
      after: "segment 1's check",
      log: SITTING.slice(0, 4),
      is: {
        [PRODUCT]: "passed",
        [CHAIN]: "not-started",
        [IMPLICIT]: "not-started",
      },
    },
    {
      after: "segment 2's last answer",
      log: SITTING.slice(0, 8),
      is: { [PRODUCT]: "passed", [CHAIN]: "attempted", [IMPLICIT]: "passed" },
    },
    {
      after: "the override",
      log: SITTING.slice(0, 9),
      is: { [PRODUCT]: "passed", [CHAIN]: "overridden", [IMPLICIT]: "passed" },
    },
    {
      after: "going over the chain rule again",
      log: SITTING,
      is: { [PRODUCT]: "passed", [CHAIN]: "passed", [IMPLICIT]: "passed" },
    },
  ])("after $after", ({ log, is }) => {
    const statuses = Object.fromEntries(
      [PRODUCT, CHAIN, IMPLICIT].map((id) => [id, objectiveStatus(log, id)]),
    );
    expect(statuses).toEqual(is);
  });
});

describe("unit status", () => {
  const { plan: _, ...unplanned } = UNIT;
  const cases: {
    name: string;
    unit: StoredUnit;
    log: EvidenceEntry[];
    position?: UnitPosition;
    is: UnitStatus;
  }[] = [
    {
      name: "a unit with no plan",
      unit: unplanned,
      log: [],
      is: "not-started",
    },
    {
      name: "a planned unit with evidence only on another unit's objective",
      unit: UNIT,
      log: [right("90", { objective: "power-rule" })],
      is: "not-started",
    },
    {
      name: "a unit just started, before any answer",
      unit: UNIT,
      log: [],
      position: { segment: 0, phase: "teach" },
      is: "in-progress",
    },
    {
      name: "one objective overridden and the rest passed, still at the closing card",
      unit: UNIT,
      log: SITTING.slice(0, 9),
      position: CLOSED_AT_END,
      is: "in-progress",
    },
    {
      name: "every objective passed, still at the closing card",
      unit: UNIT,
      log: SITTING,
      position: CLOSED_AT_END,
      is: "in-progress",
    },
    {
      name: "every objective passed, and the unit closed",
      unit: UNIT,
      log: SITTING,
      is: "passed",
    },
    {
      name: "one objective overridden and the rest passed, and the unit closed",
      unit: UNIT,
      log: SITTING.slice(0, 9),
      is: "overridden",
    },
    {
      name: "evidence on part of the unit, one objective overridden, and no position",
      unit: UNIT,
      log: SITTING.slice(4, 9),
      is: "in-progress",
    },
    {
      name: "every objective passed, one retained since, and the unit closed",
      unit: UNIT,
      log: [...SITTING, right("50", { in: "review" })],
      is: "passed",
    },
    {
      // A miss in a later unit's review does not reopen a finished unit.
      name: "every objective passed, one slipping since, and the unit closed",
      unit: UNIT,
      log: [...SITTING, wrong("75", { in: "review" })],
      is: "passed",
    },
    {
      name: "one objective overridden, one slipping since, and the unit closed",
      unit: UNIT,
      log: [
        ...SITTING.slice(0, 9),
        wrong("75", { objective: IMPLICIT, in: "gate" }),
      ],
      is: "overridden",
    },
    {
      name: "one objective slipping, one only attempted, and no position",
      unit: UNIT,
      log: [
        right("90", { objective: PRODUCT }),
        wrong("75", { objective: PRODUCT, in: "review" }),
        right("75"),
      ],
      is: "in-progress",
    },
  ];

  test.each(cases)("$name: $is", ({ unit, log, position, is }) => {
    expect(unitStatus(unit, log, position)).toBe(is);
  });
});

/** The dispute of an answer's grade, decided `verdict` (task 3.8). */
function disputed(
  entry: EvidenceEntry,
  verdict: "correct" | "incorrect",
): EvidenceEntry & { kind: "dispute" } {
  if (entry.kind !== "answer") throw new Error("Only an answer is disputed.");
  return EvidenceEntry.parse({
    kind: "dispute",
    recordedAt: "2026-11-16T09:00:00.000Z",
    questionId: entry.answer.questionId,
    reason: "The grade is wrong.",
    outcome: { verdict, reason: "Decided by hand." },
  }) as EvidenceEntry & { kind: "dispute" };
}

describe("a disputed answer counts with its dispute's verdict, where the answer stands", () => {
  // Worked by hand: the log read with each disputed answer's verdict
  // replaced, at the answer's place, and the dispute itself ignored.
  const missed90 = wrong("90");
  const then75 = right("75");
  const alone100 = right("100");
  const first75 = right("75", { prompt: "First." });
  const second75 = right("75", { prompt: "Second." });
  const early = wrong("75");
  const reviewMissed = wrong("75", { in: "review" });
  const reviewRight = right("50", { in: "review" });
  const cases: { name: string; log: EvidenceEntry[]; is: ObjectiveStatus }[] = [
    {
      name: "a miss at 90% then one unsure correct answer, as graded",
      log: [missed90, then75],
      is: "attempted",
    },
    {
      // Never missed now, and the first answer was at 90%.
      name: "the same with the miss overturned: it passes",
      log: [missed90, then75, disputed(missed90, "correct")],
      is: "passed",
    },
    {
      name: "the same with the miss's grade standing: nothing changes",
      log: [missed90, then75, disputed(missed90, "incorrect")],
      is: "attempted",
    },
    {
      name: "one correct answer at 100%, as graded",
      log: [alone100],
      is: "passed",
    },
    {
      name: "the same with the pass overturned: it is taken away",
      log: [alone100, disputed(alone100, "incorrect")],
      is: "attempted",
    },
    {
      // The first is a miss now, which clears nothing after it: one
      // unsure correct answer is left.
      name: "two unsure correct answers, the first overturned",
      log: [first75, second75, disputed(first75, "incorrect")],
      is: "attempted",
    },
    {
      // In place, the overturned miss is an unsure correct answer before
      // the override, which then stands; counted at the dispute's place it
      // would come after the override and take its place.
      name: "a miss overturned to an unsure correct answer before an override",
      log: [early, override(CHAIN), disputed(early, "correct")],
      is: "overridden",
    },
    {
      name: "a pass, then a miss in a review overturned",
      log: [alone100, reviewMissed, disputed(reviewMissed, "correct")],
      is: "retained",
    },
    {
      name: "a pass, then a review's correct answer overturned",
      log: [alone100, reviewRight, disputed(reviewRight, "incorrect")],
      is: "slipping",
    },
  ];
  test.each(cases)("$name: $is", ({ log, is }) => {
    expect(objectiveStatus(log, CHAIN)).toBe(is);
  });

  test("a dispute takes the pass only when it leaves the objective attempted", () => {
    const alone = right("100");
    expect(takesPass([alone], disputed(alone, "incorrect"), CHAIN)).toBe(true);
    // Slipping or retained, the objective never passed once its pass goes.
    const missed75 = wrong("75", { in: "review" });
    expect(
      takesPass([alone, missed75], disputed(alone, "incorrect"), CHAIN),
    ).toBe(true);
    const confirmed = right("50", { in: "review" });
    expect(
      takesPass([alone, confirmed], disputed(alone, "incorrect"), CHAIN),
    ).toBe(true);
    // Retained to slipping: it passed once, and its unit stays finished.
    expect(
      takesPass([alone, confirmed], disputed(confirmed, "incorrect"), CHAIN),
    ).toBe(false);
    // Overridden after the answer: the override stands once the pass goes.
    expect(
      takesPass([alone, override(CHAIN)], disputed(alone, "incorrect"), CHAIN),
    ).toBe(false);
    const missed = wrong("50");
    expect(takesPass([missed], disputed(missed, "correct"), CHAIN)).toBe(false);
    expect(takesPass([alone], disputed(alone, "correct"), CHAIN)).toBe(false);
  });
});
