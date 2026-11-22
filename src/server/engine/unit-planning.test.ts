import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { EvidenceEntry } from "../../shared/evidence.ts";
import type { Plan } from "../../shared/plan.ts";
import type { Outline } from "../../shared/source.ts";
import type { TutorBackend } from "../backends/backend.ts";
import { createFakeBackend, type FakeTurn } from "../backends/fake.ts";
import { type DataRoot, openDataRoot } from "../record/data-root.ts";
import { placeTestSource } from "./fake-converter.ts";
import { createGrader } from "./grading.ts";
import { createHelpJudge } from "./help-judge.ts";
import { createUnitChats } from "./unit-chat.ts";
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
  background:
    "The learner took calculus at school and remembers the power rule. They want to differentiate anything they meet.",
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

const PROFILE =
  "Works as a nurse and computes doses every day. Likes a worked example first.";

async function course(approved = true): Promise<string> {
  const { id } = await root.createCourse({ title: PROPOSAL.title });
  await root.saveProposal(id, PROPOSAL);
  if (approved) await root.approveCurriculum(id, PROPOSAL);
  return id;
}

/** The fake backend, counting the sessions closed. */
function setUp(script: FakeTurn[], beforeToolCall?: () => Promise<void>) {
  const fake = createFakeBackend(script);
  let closed = 0;
  const backend: TutorBackend = {
    async startSession(options) {
      const session = await fake.startSession(options);
      return {
        ...session,
        async *send(turn) {
          for await (const event of session.send(turn)) {
            if (event.type === "tool_call") await beforeToolCall?.();
            yield event;
          }
        },
        async close() {
          closed += 1;
          await session.close();
        },
      };
    },
    hasSession: fake.hasSession,
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
  test("names the unit, and gives the background note, then the curriculum with how the learner stands on each planned objective", async () => {
    const id = await course();
    await root.storePlan(id, "derivative", DERIVATIVE_PLAN);
    // The definition passed at 90% and was answered again in a review: it
    // is retained. The rate passed at 90%, then was missed in a gate: it is
    // slipping.
    const answer = (
      objective: string,
      n: number,
      verdict: string,
      mode?: string,
    ) =>
      EvidenceEntry.parse({
        kind: "answer",
        recordedAt: "2026-11-15T10:40:00.000Z",
        objective,
        question: {
          kind: "choice",
          prompt: `Question ${n} on ${objective}`,
          choices: ["One", "Two"],
          answer: "A",
        },
        answer: {
          kind: "choice",
          questionId: `${objective}-${n}`,
          choice: verdict === "correct" ? "A" : "B",
          confidence: "90",
        },
        assisted: false,
        verdict,
        ...(mode === undefined
          ? {}
          : { assessment: { mode, unit: "derivative" } }),
      });
    for (const entry of [
      answer("difference-quotient", 1, "correct"),
      answer("rate", 1, "correct"),
      answer("difference-quotient", 2, "correct", "review"),
      answer("rate", 2, "incorrect", "gate"),
    ]) {
      await root.appendEvidence(id, entry);
    }
    const { fake, planner } = setUp([
      [{ call: "plan_unit", input: RULES_PLAN }],
    ]);

    await planner.plan(id, "rules");

    const text = fake.received[0]?.text ?? "";
    const lines = text.split("\n");
    const [header, intro, json] = [lines[0], lines.at(-2), lines.at(-1)];
    expect(header).toMatch(
      /^\[Plan unit 2 of 2 of the course "Calculus I": "Differentiation rules" \(id "rules"\)\. Allowed now: plan_unit/,
    );
    expect(text).toContain(
      `]\n# The learner\n\nWhat the learner told the planner when the course was made:\n${PROPOSAL.background}\n\nThe curriculum, in order`,
    );
    expect(text).not.toContain("profile");
    expect(intro).toMatch(/with how the learner stands on it/);
    expect(JSON.parse(json ?? "")).toEqual({
      course: "Calculus I",
      unitToPlan: "rules",
      units: [
        {
          ...PROPOSAL.units[0],
          objectives: [
            { ...DERIVATIVE_PLAN.objectives[0], status: "retained" },
            { ...DERIVATIVE_PLAN.objectives[1], status: "slipping" },
          ],
        },
        PROPOSAL.units[1],
      ],
    });
  });

  test("says no background note was recorded for a course approved before there were any", async () => {
    const id = await course();
    await rm(join(dir, "courses", id, "background.md"));
    const { fake, planner } = setUp([
      [{ call: "plan_unit", input: DERIVATIVE_PLAN }],
    ]);

    await planner.plan(id, "derivative");

    const text = fake.received[0]?.text ?? "";
    expect(text).toContain(
      "]\n# The learner\n\nNo background note was recorded for this course: nothing is known about the learner beyond their record.\n\nThe curriculum, in order",
    );
    expect(text).not.toContain("What the learner told");
  });

  // Task 5.8: the profile holds across courses, so it comes before this course's note.
  test("gives the learner profile under the learner, before the background note or the line saying there is none", async () => {
    const id = await course();
    await root.writeProfile(PROFILE, undefined);
    const { fake, planner } = setUp([
      [{ call: "plan_unit", input: DERIVATIVE_PLAN }],
      [{ call: "plan_unit", input: RULES_PLAN }],
    ]);
    const profile = `]\n# The learner\n\nThe learner's profile, which holds across their courses:\n<learner_profile>\n${PROFILE}\n</learner_profile>\n\n`;

    await planner.plan(id, "derivative");
    await rm(join(dir, "courses", id, "background.md"));
    await planner.plan(id, "rules");

    expect(fake.received[0]?.text).toContain(
      `${profile}What the learner told the planner when the course was made:\n${PROPOSAL.background}\n\nThe curriculum, in order`,
    );
    expect(fake.received[1]?.text).toContain(
      `${profile}No background note was recorded for this course.\n\nThe curriculum, in order`,
    );
  });
});

// Task 4.7: a unit that names sections is planned from their text.
test("a unit that names sections is planned from their whole text, after the curriculum; a segment naming another unit's section is refused, and the corrected plan names the unit's", async () => {
  const book: Outline = {
    id: "phenomenology",
    title: "Phenomenology",
    file: "original.pdf",
    name: "hegel.pdf",
    format: "pdf",
    sha256: "a".repeat(64),
    converter: 5,
    limit: 20_000,
    pages: {
      count: 8,
      labels: ["i", "ii", "iii", "1", "2", "3", "4", "5"],
      blank: [],
    },
    entries: [
      {
        title: "Preface",
        entries: [
          {
            id: "s1",
            title: "Preface (part 1 of 2)",
            size: 50,
            place: { pages: { first: 1, last: 3 } },
            part: { number: 1, of: 2 },
          },
          {
            id: "s2",
            title: "Preface (part 2 of 2)",
            size: 22,
            place: { pages: { first: 3, last: 4 } },
            part: { number: 2, of: 2 },
          },
        ],
      },
      {
        id: "s3",
        title: "Introduction",
        size: 19,
        place: { pages: { first: 5, last: 8 } },
      },
    ],
  };
  const proposal = {
    title: "Reading Hegel",
    units: [
      {
        id: "preface",
        title: "The Preface",
        goal: "Say why the true is the whole.",
        prerequisites: [],
        sections: ["phenomenology/s1", "phenomenology/s2"],
      },
      {
        id: "introduction",
        title: "The Introduction",
        goal: "Say how knowing tests itself.",
        prerequisites: ["preface"],
        sections: ["phenomenology/s3"],
      },
    ],
    style: "Close reading.",
    background: "The learner has read Kant.",
  };
  const { id } = await root.createCourse({ title: proposal.title });
  await placeTestSource(root, dir, id, book, {
    s1: '<!-- page 1 label "i" -->\nThe true is the whole.\n',
    s2: "Substance is subject.\n",
    s3: "Knowing is a test.\n",
  });
  await root.saveProposal(id, proposal);
  await root.approveCurriculum(id, proposal);
  const plan = (substance: string[]): Plan => ({
    objectives: [
      { id: "whole", statement: "Explain why the true is the whole." },
      { id: "subject", statement: "Explain how substance is subject." },
    ],
    segments: [
      {
        title: "The whole",
        objectives: ["whole"],
        sections: ["phenomenology/s1"],
      },
      { title: "Substance", objectives: ["subject"], sections: substance },
    ],
  });
  const { fake, planner } = setUp([
    [
      { call: "plan_unit", input: plan(["phenomenology/s3"]) },
      { call: "plan_unit", input: plan(["phenomenology/s2"]) },
    ],
  ]);

  const result = await planner.plan(id, "preface");

  const text = fake.received[0]?.text ?? "";
  expect(text).toMatch(
    /^\[Plan unit 1 of 2 [^\n]* Last, under "# The unit's text", the sections it teaches, whole: name in each segment those it draws on\.\]\n/,
  );
  expect(text).toContain(
    '"prerequisites":[],"sections":["phenomenology/s1","phenomenology/s2"]}',
  );
  expect(text.slice(text.lastIndexOf("# The unit's text"))).toBe(
    "# The unit's text\n\n" +
      '<section id="phenomenology/s1" title="Preface (part 1 of 2)" place="pages 1–3 (printed i–iii)">\n' +
      '<!-- page 1 label "i" -->\nThe true is the whole.\n</section>\n\n' +
      '<section id="phenomenology/s2" title="Preface (part 2 of 2)" place="pages 3–4 (printed iii–1)">\n' +
      "Substance is subject.\n</section>",
  );
  expect(fake.calls.map((c) => c.result)).toEqual([
    {
      status: "refused",
      text: 'Segment 2 ("Substance") names "phenomenology/s3", which is not one of this unit\'s sections. Name only the unit\'s: "phenomenology/s1", "phenomenology/s2".',
    },
    expect.objectContaining({ status: "done" }),
  ]);
  expect(result).toEqual({ ok: true, plan: plan(["phenomenology/s2"]) });
  expect(await storedPlan(id, "preface")).toEqual(plan(["phenomenology/s2"]));
});

test.each([
  {
    change: "adds a section",
    before: ["notes/s1"],
    after: ["notes/s1", "notes/s2"],
  },
  {
    change: "reorders the sections",
    before: ["notes/s1", "notes/s2"],
    after: ["notes/s2", "notes/s1"],
  },
])("replans when an amendment $change", async ({ before, after }) => {
  const unit = {
    id: "derivative",
    title: "The derivative",
    goal: "Read and compute a derivative.",
    prerequisites: [],
    sections: before,
  };
  const proposal = { ...PROPOSAL, units: [unit] };
  const texts = {
    s1: "A limit defines the derivative.\n",
    s2: "The rate doubles here.\n",
  };
  const { id } = await root.createCourse({ title: proposal.title });
  await placeTestSource(
    root,
    dir,
    id,
    {
      id: "notes",
      title: "Notes",
      file: "original.md",
      name: "notes.md",
      format: "markdown",
      sha256: "a".repeat(64),
      converter: 5,
      limit: 20_000,
      entries: [
        {
          id: "s1",
          title: "Definition",
          size: texts.s1.length,
          place: { paragraphs: { first: 1, last: 1 } },
        },
        {
          id: "s2",
          title: "Example",
          size: texts.s2.length,
          place: { paragraphs: { first: 2, last: 2 } },
        },
      ],
    },
    texts,
  );
  await root.saveProposal(id, proposal);
  await root.approveCurriculum(id, proposal);
  const plan = (sections: string[]): Plan => ({
    ...DERIVATIVE_PLAN,
    segments: DERIVATIVE_PLAN.segments.map((segment) => ({
      ...segment,
      sections,
    })),
  });
  const updated = { ...unit, title: "Rates and derivatives", sections: after };
  let amended = false;
  const { fake, planner, closed } = setUp(
    [
      [{ call: "plan_unit", input: plan(before) }],
      [{ call: "plan_unit", input: plan(after) }],
    ],
    async () => {
      // The first session already got its text but has not called the tool.
      if (amended) return;
      amended = true;
      await root.changeCurriculum(id, [updated]);
    },
  );

  const tutor = createFakeBackend([[{ text: "Teaching rates." }]]);
  const chats = createUnitChats({
    dataRoot: root,
    backend: tutor,
    planner,
    systemPrompt: "Tutor.",
    grader: createGrader({ backend: tutor, systemPrompt: "Grade." }),
    judge: createHelpJudge({ backend: tutor, systemPrompt: "Judge." }),
  });
  const opened = await chats.open(id, unit.id);
  if (!opened.ok) throw new Error(opened.error);
  try {
    await opened.chat.settled();
    expect(opened.chat.events()).toContainEqual({
      type: "unit_plan",
      plan: plan(after),
    });
    expect(tutor.sessions[0]?.systemPrompt).toContain(
      `Rates and derivatives (id "derivative"): ${unit.goal} Reads ${after.map((ref) => JSON.stringify(ref)).join(", ")}.`,
    );
  } finally {
    await chats.close();
  }
  expect(fake.calls[0]?.result).toEqual({
    status: "refused",
    text: expect.stringMatching(/sections.*changed/),
  });
  const retry = fake.received[1]?.text;
  expect(retry).toContain(
    'of the course "Calculus I": "Rates and derivatives"',
  );
  expect(retry).toContain(`"sections":${JSON.stringify(after)}`);
  expect(retry).toContain("changed during planning.");
  expect(retry).toContain("The rate doubles here.");
  expect(closed()).toBe(2);
  expect(
    fake.received.map(({ text }) =>
      [...text.matchAll(/^<section id="([^"]+)"/gm)].map((match) => match[1]),
    ),
  ).toEqual([before, after]);
  expect(await storedPlan(id, unit.id)).toEqual(plan(after));

  // An amendment after storing the plan still keeps it.
  await root.changeCurriculum(id, [{ ...updated, sections: before }]);
  expect(await storedPlan(id, unit.id)).toEqual(plan(after));
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
