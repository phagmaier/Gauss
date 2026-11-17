import { describe, expect, test } from "vitest";
import { Curriculum, CurriculumProposal } from "./curriculum.ts";
import type { Plan } from "./plan.ts";

// A hand-written curriculum.json for a short calculus course. "fundamental"
// builds on two units that share a prerequisite, so two paths meet there
// without forming a cycle. The prerequisites are not in list order: the list
// is the order the units are shown in, and nothing more.
const APPROVED = {
  approval: { status: "approved", approvedAt: "2026-11-15T09:30:00.000Z" },
  units: [
    {
      id: "limits",
      title: "Limits and continuity",
      goal: "Evaluate limits and decide where a function is continuous.",
      prerequisites: [],
    },
    {
      id: "fundamental",
      title: "The fundamental theorem",
      goal: "Connect derivatives and integrals, and evaluate integrals with antiderivatives.",
      prerequisites: ["derivative", "integral"],
    },
    {
      id: "derivative",
      title: "The derivative",
      goal: "Compute a derivative from its definition and read it as a rate of change.",
      prerequisites: ["limits"],
    },
    {
      id: "integral",
      title: "The integral as area",
      goal: "Define the definite integral as a limit of sums, and estimate it.",
      prerequisites: ["limits"],
    },
  ],
};

const DRAFT = {
  approval: { status: "draft" },
  units: [
    {
      id: "tls-handshake",
      title: "How a TLS handshake works",
      goal: "Explain each message of a TLS 1.3 handshake and what it protects against.",
      prerequisites: [],
    },
  ],
};

test("a hand-written approved curriculum parses unchanged", () => {
  expect(Curriculum.parse(APPROVED)).toEqual(APPROVED);
});

test("a hand-written draft with one unit parses unchanged", () => {
  expect(Curriculum.parse(DRAFT)).toEqual(DRAFT);
});

type Units = (typeof APPROVED)["units"];

/** APPROVED with its units replaced. */
function withUnits(change: (units: Units) => unknown[]) {
  return { ...APPROVED, units: change(structuredClone(APPROVED.units)) };
}

/** A unit with a goal, building on the given units. */
function unit(id: string, prerequisites: string[]) {
  return {
    id,
    title: id,
    goal: `Do the ${id} thing.`,
    prerequisites,
  };
}

describe("rejects", () => {
  test.each([
    {
      name: "a unit with no goal",
      input: withUnits((units) =>
        units.map(({ goal, ...rest }) =>
          rest.id === "derivative" ? rest : { goal, ...rest },
        ),
      ),
      path: ["units", 2, "goal"],
      message: /expected string/i,
    },
    {
      name: "a unit whose goal is only spaces",
      input: withUnits((units) =>
        units.map((u) => (u.id === "integral" ? { ...u, goal: "   " } : u)),
      ),
      path: ["units", 3, "goal"],
      message: /too small/i,
    },
    {
      // The prerequisite checks must not run on a unit that failed to parse.
      name: "a unit with no prerequisites list",
      input: withUnits((units) =>
        units.map(({ prerequisites, ...rest }) =>
          rest.id === "limits" ? rest : { prerequisites, ...rest },
        ),
      ),
      path: ["units", 0, "prerequisites"],
      message: /expected array/i,
    },
    {
      name: "a prerequisite that names no unit in the curriculum",
      input: withUnits((units) =>
        units.map((u) =>
          u.id === "integral" ? { ...u, prerequisites: ["limits", "sums"] } : u,
        ),
      ),
      path: ["units", 3, "prerequisites", 1],
      message: /"integral" builds on "sums", which is not a unit/,
    },
    {
      // The first unit cannot reach the cycle, and "lead" reaches it from
      // outside, so the report must leave "lead" out and start at "a".
      name: "a cycle of three units, reached only from a unit outside it",
      input: withUnits(() => [
        unit("start", []),
        unit("lead", ["b"]),
        unit("a", ["start", "c"]),
        unit("b", ["a"]),
        unit("c", ["b"]),
      ]),
      path: ["units", 2, "prerequisites", 1],
      message:
        /cycle: "a" builds on "c", "c" builds on "b", "b" builds on "a"\./,
    },
    {
      name: "a unit that is its own prerequisite",
      input: withUnits(() => [
        unit("start", []),
        unit("loop", ["start", "loop"]),
      ]),
      path: ["units", 1, "prerequisites", 1],
      message: /cycle: "loop" builds on "loop"/,
    },
    {
      name: "two units with the same id",
      input: withUnits((units) =>
        units.map((u) =>
          u.id === "integral" ? { ...u, id: "derivative" } : u,
        ),
      ),
      path: ["units", 3, "id"],
      message: /"derivative" is the id of more than one unit/,
    },
    {
      name: "a prerequisite listed twice",
      input: withUnits((units) =>
        units.map((u) =>
          u.id === "derivative"
            ? { ...u, prerequisites: ["limits", "limits"] }
            : u,
        ),
      ),
      path: ["units", 2, "prerequisites", 1],
      message: /"derivative" lists "limits" more than once/,
    },
    {
      name: "a unit id that is not a lowercase slug",
      input: withUnits((units) =>
        units.map((u) => (u.id === "limits" ? { ...u, id: "../limits" } : u)),
      ),
      path: ["units", 0, "id"],
      message: /lowercase letters, digits and single hyphens/,
    },
    {
      name: "a curriculum with no units",
      input: { ...APPROVED, units: [] },
      path: ["units"],
      message: /too small/i,
    },
    {
      name: "an approval with no date",
      input: { ...APPROVED, approval: { status: "approved" } },
      path: ["approval", "approvedAt"],
      message: /expected string/i,
    },
  ])("$name", ({ input, path, message }) => {
    const result = Curriculum.safeParse(input);

    expect(result.success).toBe(false);
    expect(result.error?.issues).toContainEqual(
      expect.objectContaining({
        path,
        message: expect.stringMatching(message),
      }),
    );
  });
});

// Units gain a plan once they start (task 2.2). APPROVED, with two of its
// units planned.
const PLANNED = withUnits((units) =>
  units.map((u) => {
    if (u.id === "limits") {
      return {
        ...u,
        plan: {
          objectives: [
            { id: "limit-value", statement: "Evaluate a limit at a point." },
            {
              id: "continuity",
              statement: "Decide where a function is continuous.",
            },
          ],
          segments: [
            { title: "Limits", objectives: ["limit-value"] },
            { title: "Continuity", objectives: ["continuity"] },
          ],
        },
      };
    }
    if (u.id === "derivative") {
      return {
        ...u,
        plan: {
          objectives: [
            {
              id: "derivative-definition",
              statement: "Compute a derivative from its definition.",
            },
          ],
          segments: [
            { title: "The definition", objectives: ["derivative-definition"] },
          ],
        },
      };
    }
    return u;
  }),
);

describe("planned units", () => {
  test("a curriculum with planned and unplanned units parses unchanged", () => {
    expect(Curriculum.parse(PLANNED)).toEqual(PLANNED);
  });

  test("an objective id used in two units is rejected, naming both", () => {
    // Evidence names objectives by id alone, so ids are unique in the course.
    const clash = structuredClone(PLANNED);
    const derivative = clash.units[2] as { plan: Plan };
    derivative.plan = {
      objectives: [{ id: "continuity", statement: "Something else." }],
      segments: [{ title: "Again", objectives: ["continuity"] }],
    };

    const result = Curriculum.safeParse(clash);

    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual([
      expect.objectContaining({
        path: ["units", 2, "plan", "objectives", 0, "id"],
        message: expect.stringMatching(
          /"continuity" is the id of an objective in both "limits" and "derivative"/,
        ),
      }),
    ]);
  });
});

// The style note (task 2.10) and the background note (task 2.22).
describe.each(["style", "background"] as const)(
  "a proposal's %s note",
  (note) => {
    const proposal = {
      title: "Calculus I",
      units: APPROVED.units,
      style: "Short explanations. Many small exercises.",
      background: "The learner knows limits and wants derivatives next.",
    };

    test("is kept trimmed", () => {
      const text = proposal[note];
      expect(
        CurriculumProposal.parse({ ...proposal, [note]: `  ${text}\n` })[note],
      ).toBe(text);
    });

    // The tutor gets these reasons back when propose_curriculum refuses.
    test.each([
      { name: "missing", text: undefined, message: /expected string/i },
      { name: "only spaces", text: "  \n ", message: /too small/i },
      { name: "too long", text: "x".repeat(801), message: /too big/i },
    ])("is required and short: $name is refused", ({ text, message }) => {
      const result = CurriculumProposal.safeParse({
        ...proposal,
        [note]: text,
      });
      expect(result.error?.issues).toEqual([
        expect.objectContaining({
          path: [note],
          message: expect.stringMatching(message),
        }),
      ]);
    });
  },
);
