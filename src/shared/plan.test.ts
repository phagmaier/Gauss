import { describe, expect, test } from "vitest";
import { Plan } from "./plan.ts";

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
