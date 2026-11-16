import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { EvidenceEntry } from "../../shared/evidence.ts";
import type { Plan } from "../../shared/plan.ts";
import type { TutorBackend } from "../backends/backend.ts";
import { createFakeBackend, type FakeTurn } from "../backends/fake.ts";
import { type DataRoot, openDataRoot } from "../record/data-root.ts";
import { createUnitPlanner } from "./unit-planning.ts";

// Each test gets its own data root; none touches ~/gauss (AGENTS.md).
let dir: string;
let root: DataRoot;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "gauss-planning-"));
  root = openDataRoot({
    path: dir,
    now: () => new Date("2026-11-15T10:30:00.000Z"),
  });
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const PROMPT = "You are a test unit planner.";

// A course of two units, the second building on the first.
const PROPOSAL = {
  title: "Calculus I",
  units: [
    {
      id: "derivative",
      title: "The derivative",
      goal: "Compute a derivative from its definition and read it as a rate.",
      prerequisites: [],
    },
    {
      id: "rules",
      title: "Differentiation rules",
      goal: "Differentiate products and composite functions.",
      prerequisites: ["derivative"],
    },
  ],
  style: "Short explanations, many small exercises.",
};

const DERIVATIVE_PLAN: Plan = {
  objectives: [
    {
      id: "difference-quotient",
      statement: "Compute a derivative as a limit.",
    },
    { id: "rate", statement: "Read a derivative as a rate of change." },
  ],
  segments: [
    { title: "The derivative as a limit", objectives: ["difference-quotient"] },
    { title: "Rates", objectives: ["rate"] },
  ],
};

const RULES_PLAN: Plan = {
  objectives: [
    { id: "product-rule", statement: "Apply the product rule." },
    { id: "chain-rule", statement: "Apply the chain rule to a composite." },
  ],
  segments: [
    { title: "Products", objectives: ["product-rule"] },
    { title: "Composites", objectives: ["chain-rule"] },
  ],
};

async function course(approved = true): Promise<string> {
  const { id } = await root.createCourse({ title: PROPOSAL.title });
  await root.saveProposal(id, PROPOSAL);
  if (approved) await root.approveCurriculum(id);
  return id;
}

/** The fake backend, counting the sessions closed. */
function setUp(script: FakeTurn[]) {
  const fake = createFakeBackend(script);
  let closed = 0;
  const backend: TutorBackend = {
    async startSession(options) {
      const session = await fake.startSession(options);
      return {
        ...session,
        async close() {
          closed += 1;
          await session.close();
        },
      };
    },
    oneShot: fake.oneShot,
  };
  const planner = createUnitPlanner({
    backend,
    systemPrompt: PROMPT,
    dataRoot: root,
  });
  return { fake, planner, closed: () => closed };
}

/** The plan stored on the unit, as a restarted server would read it. */
async function storedPlan(courseId: string, unitId: string) {
  const stored = await openDataRoot({ path: dir }).readCourse(courseId);
  return stored?.curriculum?.units.find((u) => u.id === unitId)?.plan;
}

test("a planning session stores the plan, then closes", async () => {
  const id = await course();
  const { fake, planner, closed } = setUp([
    [
      { text: "Planning the derivative." },
      { call: "plan_unit", input: DERIVATIVE_PLAN },
      { text: "Text after the plan, which the turn never reaches." },
    ],
  ]);

  const result = await planner.plan(id, "derivative");

  expect(result).toEqual({ ok: true, plan: DERIVATIVE_PLAN });
  expect(await storedPlan(id, "derivative")).toEqual(DERIVATIVE_PLAN);
  expect(fake.sessions).toHaveLength(1);
  expect(fake.sessions[0]?.systemPrompt).toBe(PROMPT);
  expect(fake.sessions[0]?.tools.map((t) => t.name)).toEqual(["plan_unit"]);
  expect(fake.calls.map((c) => c.result)).toEqual([
    expect.objectContaining({ status: "done", endTurn: true }),
  ]);
  expect(fake.received).toHaveLength(1);
  expect(closed()).toBe(1);
});

describe("the session's one turn", () => {
  test("names the unit, and gives the curriculum with how the learner stands on each planned objective", async () => {
    const id = await course();
    await root.storePlan(id, "derivative", DERIVATIVE_PLAN);
    // The definition passed at 90%; the rate was missed.
    const answer = (objective: string, choice: string, verdict: string) =>
      EvidenceEntry.parse({
        kind: "answer",
        recordedAt: "2026-11-15T10:40:00.000Z",
        objective,
        question: {
          kind: "choice",
          prompt: `A question on ${objective}`,
          choices: ["One", "Two"],
          answer: "A",
        },
        answer: {
          kind: "choice",
          questionId: objective,
          choice,
          confidence: "90",
        },
        assisted: false,
        verdict,
      });
    await root.appendEvidence(
      id,
      answer("difference-quotient", "A", "correct"),
    );
    await root.appendEvidence(id, answer("rate", "B", "incorrect"));
    const { fake, planner } = setUp([
      [{ call: "plan_unit", input: RULES_PLAN }],
    ]);

    await planner.plan(id, "rules");

    const [header, intro, json] = fake.received[0]?.text.split("\n") ?? [];
    expect(header).toMatch(
      /^\[Plan unit 2 of 2 of the course "Calculus I": "Differentiation rules" \(id "rules"\)\. Allowed now: plan_unit/,
    );
    expect(intro).toMatch(/with how the learner stands on it/);
    expect(JSON.parse(json ?? "")).toEqual({
      course: "Calculus I",
      unitToPlan: "rules",
      units: [
        {
          ...PROPOSAL.units[0],
          objectives: [
            { ...DERIVATIVE_PLAN.objectives[0], status: "passed" },
            { ...DERIVATIVE_PLAN.objectives[1], status: "attempted" },
          ],
        },
        PROPOSAL.units[1],
      ],
    });
  });
});

describe("a refused plan goes back with its reason and is corrected", () => {
  const NO_SEGMENT: Plan = {
    ...RULES_PLAN,
    segments: [{ title: "Products", objectives: ["product-rule"] }],
  };
  const CLASH: Plan = {
    ...RULES_PLAN,
    objectives: [
      { id: "rate", statement: "Apply the product rule." },
      RULES_PLAN.objectives[1] ?? { id: "x", statement: "x" },
    ],
    segments: [
      { title: "Products", objectives: ["rate"] },
      { title: "Composites", objectives: ["chain-rule"] },
    ],
  };

  test.each([
    {
      name: "by the plan's own rules",
      first: NO_SEGMENT,
      reason: /"chain-rule" is in no segment/,
    },
    {
      name: "by the record, for an objective id used in another unit",
      first: CLASH,
      reason:
        /"rate" is the id of an objective in both "derivative" and "rules"/,
    },
  ])("$name", async ({ first, reason }) => {
    const id = await course();
    await root.storePlan(id, "derivative", DERIVATIVE_PLAN);
    const { fake, planner } = setUp([
      [
        { call: "plan_unit", input: first },
        { call: "plan_unit", input: RULES_PLAN },
      ],
    ]);

    const result = await planner.plan(id, "rules");

    expect(fake.calls.map((c) => c.result)).toEqual([
      { status: "refused", text: expect.stringMatching(reason) },
      expect.objectContaining({ status: "done", endTurn: true }),
    ]);
    expect(result).toEqual({ ok: true, plan: RULES_PLAN });
    expect(await storedPlan(id, "rules")).toEqual(RULES_PLAN);
    expect(fake.sessions).toHaveLength(1);
  });
});

describe("a session that ends without a plan is tried once more", () => {
  test("in a new session, told why, which stores the plan", async () => {
    const id = await course();
    const { fake, planner, closed } = setUp([
      [{ text: "Should the unit cover the definition again?" }],
      [{ call: "plan_unit", input: DERIVATIVE_PLAN }],
    ]);

    const result = await planner.plan(id, "derivative");

    expect(result).toEqual({ ok: true, plan: DERIVATIVE_PLAN });
    expect(fake.sessions).toHaveLength(2);
    expect(closed()).toBe(2);
    expect(fake.received[0]?.text).not.toMatch(/earlier planning session/);
    expect(fake.received[1]?.text).toMatch(
      /An earlier planning session for this unit stored nothing: the planning session ended without a plan\.\]/,
    );
  });

  test("with the reason its plan was refused", async () => {
    const id = await course();
    const { fake, planner } = setUp([
      [{ call: "plan_unit", input: { ...DERIVATIVE_PLAN, segments: [] } }],
      [{ call: "plan_unit", input: DERIVATIVE_PLAN }],
    ]);

    expect(await planner.plan(id, "derivative")).toEqual({
      ok: true,
      plan: DERIVATIVE_PLAN,
    });
    expect(fake.received[1]?.text).toMatch(
      /stored nothing: the planning session ended with its plan refused: .*segments/s,
    );
  });

  test("and after two, the failure is reported for the learner, with nothing stored", async () => {
    const id = await course();
    // The second session's turn has no script, so the fake reports an error.
    const { fake, planner, closed } = setUp([
      [{ text: "I will plan it later." }],
    ]);

    const result = await planner.plan(id, "derivative");

    expect(result).toEqual({
      ok: false,
      problem: "failed",
      error:
        "The tutor could not plan this unit: the planning session failed " +
        "(The fake backend has no scripted turn 2.). Try starting it again.",
    });
    expect(fake.sessions).toHaveLength(2);
    expect(closed()).toBe(2);
    expect(await storedPlan(id, "derivative")).toBeUndefined();
  });
});

describe("no session is started", () => {
  test("for a unit that already has a plan, whose plan is returned", async () => {
    const id = await course();
    await root.storePlan(id, "derivative", DERIVATIVE_PLAN);
    const { fake, planner } = setUp([]);

    expect(await planner.plan(id, "derivative")).toEqual({
      ok: true,
      plan: DERIVATIVE_PLAN,
    });
    expect(fake.sessions).toHaveLength(0);
  });

  test.each([
    {
      name: "for a curriculum that is not approved",
      approved: false,
      courseId: undefined,
      unitId: "derivative",
      problem: "not-approved",
    },
    {
      name: "for a unit not in the curriculum",
      approved: true,
      courseId: undefined,
      unitId: "integrals",
      problem: "not-found",
    },
    {
      name: "for a course that does not exist",
      approved: true,
      courseId: "no-such-course",
      unitId: "derivative",
      problem: "not-found",
    },
  ])("$name", async ({ approved, courseId, unitId, problem }) => {
    const id = await course(approved);
    const { fake, planner } = setUp([]);

    const result = await planner.plan(courseId ?? id, unitId);

    expect(result).toEqual({
      ok: false,
      problem,
      error: expect.any(String),
    });
    expect(fake.sessions).toHaveLength(0);
    expect(await storedPlan(id, "derivative")).toBeUndefined();
  });
});

test("two starts of one unit at once share one planning session", async () => {
  const id = await course();
  const { fake, planner } = setUp([
    [{ call: "plan_unit", input: DERIVATIVE_PLAN }],
  ]);

  const results = await Promise.all([
    planner.plan(id, "derivative"),
    planner.plan(id, "derivative"),
  ]);

  expect(results).toEqual([
    { ok: true, plan: DERIVATIVE_PLAN },
    { ok: true, plan: DERIVATIVE_PLAN },
  ]);
  expect(fake.sessions).toHaveLength(1);
});
