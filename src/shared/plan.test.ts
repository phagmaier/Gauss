import { describe, expect, test } from "vitest";
import { currentObjective, Plan } from "./plan.ts";
import type { ObjectiveStatus } from "./status.ts";

// A hand-written plan for a unit on the derivative: three objectives taught
// in two segments, the second covering two of them.
const PLAN = {
  objectives: [
    {
      id: "derivative-definition",
      statement: "Compute a derivative as the limit of difference quotients.",
    },
    {
      id: "derivative-rate",
      statement: "Read a derivative as a rate of change in a word problem.",
    },
    {
      id: "tangent-line",
      statement: "Write the tangent line to a graph at a point.",
    },
  ],
  segments: [
    {
      title: "The derivative as a limit",
      objectives: ["derivative-definition"],
    },
    {
      title: "Rates and tangent lines",
      objectives: ["derivative-rate", "tangent-line"],
    },
  ],
};

// The smallest plan, and segments that teach the objectives in another
// order than they are listed: the segments set the order of teaching.
const SMALL = {
  objectives: [
    { id: "dot-product", statement: "Compute a dot product." },
    {
      id: "orthogonal",
      statement: "Decide whether two vectors are orthogonal.",
    },
  ],
  segments: [
    { title: "Right angles", objectives: ["orthogonal"] },
    { title: "The dot product", objectives: ["dot-product"] },
  ],
};

test.each([
  { name: "a plan of two segments", plan: PLAN },
  { name: "segments in another order than the objectives", plan: SMALL },
])("$name parses unchanged", ({ plan }) => {
  expect(Plan.parse(plan)).toEqual(plan);
});

type Segments = (typeof PLAN)["segments"];

/** PLAN with its segments replaced. */
function withSegments(change: (segments: Segments) => unknown[]) {
  return { ...PLAN, segments: change(structuredClone(PLAN.segments)) };
}

describe("rejects", () => {
  test.each([
    {
      name: "a segment that names an objective not in the plan",
      input: withSegments(([first, second]) => [
        { ...first, objectives: ["derivative-definition", "chain-rule"] },
        second,
      ]),
      path: ["segments", 0, "objectives", 1],
      message: /"chain-rule" is not an objective of this plan/,
    },
    {
      name: "an objective in no segment",
      input: withSegments(([first, second]) => [
        first,
        { ...second, objectives: ["derivative-rate"] },
      ]),
      path: ["objectives", 2],
      message: /"tangent-line" is in no segment/,
    },
    {
      name: "a segment of three objectives",
      input: withSegments(() => [
        {
          title: "Everything at once",
          objectives: [
            "derivative-definition",
            "derivative-rate",
            "tangent-line",
          ],
        },
      ]),
      path: ["segments", 0, "objectives"],
      message: /one or two objectives/,
    },
    {
      // The segments are left as they are: with two objectives sharing an
      // id, which one a segment names is unclear, so only the id is reported.
      name: "a repeated objective id",
      input: {
        ...PLAN,
        objectives: PLAN.objectives.map((o) =>
          o.id === "tangent-line" ? { ...o, id: "derivative-rate" } : o,
        ),
      },
      path: ["objectives", 2, "id"],
      message: /"derivative-rate" is the id of more than one objective/,
    },
    {
      name: "an objective taught in two segments",
      input: withSegments((segments) => [
        ...segments,
        { title: "The limit again", objectives: ["derivative-definition"] },
      ]),
      path: ["segments", 2, "objectives", 0],
      message: /"derivative-definition" is already taught in segment 1/,
    },
    {
      name: "a segment with no objectives",
      input: withSegments(([first, second]) => [
        first,
        second,
        { title: "Nothing", objectives: [] },
      ]),
      path: ["segments", 2, "objectives"],
      message: /one or two objectives/,
    },
  ])("$name", ({ input, path, message }) => {
    const result = Plan.safeParse(input);

    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual([
      expect.objectContaining({
        path,
        message: expect.stringMatching(message),
      }),
    ]);
  });
});

describe("the current objective", () => {
  // A unit of three segments; the second teaches its objectives in another
  // order than the plan lists them, and the segment's order is the one taught.
  const UNIT = {
    segments: [
      { title: "Limits", objectives: ["limit-laws", "squeeze"] },
      { title: "Continuity", objectives: ["continuity-ivt", "continuity-def"] },
      { title: "Asymptotes", objectives: ["asymptote"] },
    ],
  };
  type Statuses = Record<string, ObjectiveStatus>;

  test("is the first not passed in the active segment, past an earlier override", () => {
    // The learner moved on from "squeeze" in the first segment.
    const moved: Statuses = { "limit-laws": "passed", squeeze: "overridden" };
    expect(currentObjective(UNIT, { segment: 1, phase: "teach" }, moved)).toBe(
      "continuity-ivt",
    );
    expect(
      currentObjective(
        UNIT,
        { segment: 1, phase: "check" },
        { ...moved, "continuity-ivt": "retained" },
      ),
    ).toBe("continuity-def");
    // Slipping is not passed.
    expect(
      currentObjective(
        UNIT,
        { segment: 1, phase: "discuss" },
        { ...moved, "continuity-ivt": "slipping", "continuity-def": "passed" },
      ),
    ).toBe("continuity-ivt");
  });

  test("leaves out what the learner skipped after testing out", () => {
    // "continuity-ivt" passed in the test and was skipped; a review has
    // missed it since, so it is slipping, but its segment no longer teaches it.
    expect(
      currentObjective(
        UNIT,
        { segment: 1, phase: "teach", skipping: ["continuity-ivt"] },
        { "continuity-ivt": "slipping" },
      ),
    ).toBe("continuity-def");
  });

  test("in the segment that goes over objectives again, is among its own", () => {
    const left: Statuses = {
      "limit-laws": "passed",
      squeeze: "overridden",
      "continuity-ivt": "passed",
      "continuity-def": "attempted",
      asymptote: "attempted",
    };
    expect(
      currentObjective(
        UNIT,
        { segment: 3, phase: "teach", again: ["continuity-def", "asymptote"] },
        left,
      ),
    ).toBe("continuity-def");
  });

  test("is none with no active segment, or nothing left in it", () => {
    // A finished unit has no position.
    expect(currentObjective(UNIT, null, {})).toBeUndefined();
    // Between segments: the first closed, by moving on, and the next not started.
    expect(
      currentObjective(
        UNIT,
        { segment: 0, phase: "closed" },
        { "limit-laws": "passed", squeeze: "overridden" },
      ),
    ).toBeUndefined();
    // The check's last pass, before the segment closes.
    expect(
      currentObjective(
        UNIT,
        { segment: 2, phase: "check" },
        { asymptote: "passed" },
      ),
    ).toBeUndefined();
  });
});
