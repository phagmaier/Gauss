import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import type { PageEvent } from "../../shared/events.ts";
import { createFakeBackend, type FakeTurn } from "../backends/fake.ts";
import { openDataRoot } from "../record/data-root.ts";
import { createIntake, type Intake } from "./intake.ts";

// Each test gets its own data root; none touches ~/gauss (AGENTS.md).
let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "gauss-intake-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const APPROVED_AT = "2026-11-15T10:30:00.000Z";

function setUp(script: FakeTurn[]) {
  const backend = createFakeBackend(script);
  const intake = createIntake({
    backend,
    systemPrompt: "You are a test planner.",
    dataRoot: openDataRoot({ path: dir, now: () => new Date(APPROVED_AT) }),
  });
  return { backend, intake };
}

/** The record as a restarted server would read it. */
const reload = () => openDataRoot({ path: dir });

const ASK =
  "Linear algebra, enough to understand PCA. I can multiply matrices, but eigenvectors never clicked.";

const FIRST = {
  title: "Linear algebra for PCA",
  units: [
    {
      id: "vectors",
      title: "Vectors and linear maps",
      goal: "Describe a linear map by what it does to a basis.",
      prerequisites: [],
    },
    {
      id: "matrices",
      title: "Matrices as maps",
      goal: "Read a matrix as a linear map, and a product as a composition.",
      prerequisites: ["vectors"],
    },
    {
      id: "eigen",
      title: "Eigenvalues and eigenvectors",
      goal: "Find the directions a map only stretches, and by how much.",
      prerequisites: ["matrices"],
    },
  ],
};

// The learner asked for a shorter start: the first two units are merged into
// "vectors", and the course is renamed.
const REVISED = {
  title: "Linear algebra, then PCA",
  units: [
    {
      id: "vectors",
      title: "Vectors, maps and matrices",
      goal: "Describe a linear map by what it does to a basis, and read a matrix that way.",
      prerequisites: [],
    },
    { ...FIRST.units[2], prerequisites: ["vectors"] },
  ],
};

function proposals(intake: Intake) {
  return intake
    .events()
    .filter(
      (e): e is Extract<PageEvent, { type: "curriculum_proposed" }> =>
        e.type === "curriculum_proposed",
    );
}

test("a valid proposal creates the course with a draft curriculum, shows it, and ends the tutor's turn", async () => {
  const { backend, intake } = setUp([
    [
      { text: "Here is a course built backwards from PCA." },
      { call: "propose_curriculum", input: FIRST },
      { text: "Text after the card, which the learner must not see." },
    ],
  ]);

  expect(intake.say(ASK)).toEqual({ ok: true });
  await intake.settled();

  expect(intake.events()).toEqual([
    { type: "learner", text: ASK },
    { type: "turn_start" },
    { type: "tutor_text", text: "Here is a course built backwards from PCA." },
    {
      type: "curriculum_proposed",
      courseId: "linear-algebra-for-pca",
      revision: 1,
      title: "Linear algebra for PCA",
      units: FIRST.units,
    },
    { type: "turn_end", outcome: "done" },
  ]);
  expect(intake.courseId()).toBe("linear-algebra-for-pca");
  expect(await reload().readCourse("linear-algebra-for-pca")).toMatchObject({
    course: { title: "Linear algebra for PCA" },
    curriculum: { approval: { status: "draft" }, units: FIRST.units },
  });
  expect(backend.sessions[0]?.systemPrompt).toBe("You are a test planner.");
  expect(backend.sessions[0]?.tools.map((t) => t.name)).toEqual([
    "propose_curriculum",
  ]);
  const turn = backend.received[0]?.text ?? "";
  expect(turn).toMatch(/^\[Start of the intake\./);
  expect(turn).toMatch(/propose_curriculum/);
  expect(turn.endsWith(`]\n${ASK}`)).toBe(true);
});

test("an invalid proposal is refused with the reason, stores nothing, and the tutor can then propose again", async () => {
  const broken = {
    ...FIRST,
    units: FIRST.units.map((u) =>
      u.id === "matrices" ? { ...u, prerequisites: ["vectors", "algebra"] } : u,
    ),
  };
  const { backend, intake } = setUp([
    [
      { call: "propose_curriculum", input: broken },
      { text: "That was not right; let me fix it." },
    ],
    [{ call: "propose_curriculum", input: FIRST }],
  ]);

  intake.say(ASK);
  await intake.settled();

  const refused = backend.calls[0]?.result;
  expect(refused?.status).toBe("refused");
  expect(refused?.text).toContain(
    '"matrices" builds on "algebra", which is not a unit in this curriculum.',
  );
  expect(proposals(intake)).toEqual([]);
  expect(intake.courseId()).toBeUndefined();
  expect(await reload().listCourses()).toEqual([]);
  expect(intake.events().slice(-2)).toEqual([
    { type: "tutor_text", text: "That was not right; let me fix it." },
    { type: "turn_end", outcome: "done" },
  ]);

  intake.say("Go on.");
  await intake.settled();

  expect(backend.received[1]?.text).toBe(
    "[Message from the learner. Allowed now: reply, or propose a curriculum with propose_curriculum.]\nGo on.",
  );
  expect(proposals(intake).map((p) => p.revision)).toEqual([1]);
  expect((await reload().listCourses()).map((c) => c.id)).toEqual([
    "linear-algebra-for-pca",
  ]);
});

test("a reply to a proposal is a change request, and the revision replaces the draft in the same course", async () => {
  const { backend, intake } = setUp([
    [{ call: "propose_curriculum", input: FIRST }],
    [
      { text: "I merged the first two units." },
      { call: "propose_curriculum", input: REVISED },
    ],
  ]);
  intake.say(ASK);
  await intake.settled();

  intake.say("I can already multiply matrices. Can the start be shorter?");
  await intake.settled();

  const turn = backend.received[1]?.text ?? "";
  expect(turn).toMatch(/^\[Message from the learner about proposal 1,/);
  expect(turn).toContain(
    "call propose_curriculum with the whole revised curriculum",
  );
  expect(turn).toMatch(
    /\nI can already multiply matrices\. Can the start be shorter\?$/,
  );
  expect(proposals(intake).at(-1)).toEqual({
    type: "curriculum_proposed",
    courseId: "linear-algebra-for-pca",
    revision: 2,
    title: "Linear algebra, then PCA",
    units: REVISED.units,
  });
  const courses = await reload().listCourses();
  expect(courses).toHaveLength(1);
  expect(courses[0]).toMatchObject({
    id: "linear-algebra-for-pca",
    course: { title: "Linear algebra, then PCA" },
    curriculum: { approval: { status: "draft" }, units: REVISED.units },
  });
});

test("approving the latest revision approves the stored curriculum and ends the intake", async () => {
  const { intake } = setUp([
    [{ call: "propose_curriculum", input: FIRST }],
    [{ call: "propose_curriculum", input: REVISED }],
  ]);
  intake.say(ASK);
  await intake.settled();
  intake.say("Shorter, please.");
  await intake.settled();

  expect(await intake.approve(1)).toMatchObject({ ok: false, status: 409 });
  expect(await intake.approve(3)).toMatchObject({ ok: false, status: 404 });
  expect(await intake.approve(2)).toEqual({ ok: true });

  expect(intake.events().at(-1)).toEqual({
    type: "curriculum_approved",
    courseId: "linear-algebra-for-pca",
    revision: 2,
  });
  expect(
    (await reload().readCourse("linear-algebra-for-pca"))?.curriculum,
  ).toEqual({
    approval: { status: "approved", approvedAt: APPROVED_AT },
    units: REVISED.units,
  });
  expect(intake.say("One more thing.")).toMatchObject({
    ok: false,
    status: 409,
  });
  expect(await intake.approve(2)).toMatchObject({ ok: false, status: 409 });
});

test("approval is refused before any proposal, and while the tutor is writing", async () => {
  const { intake } = setUp([
    [{ text: "What do you already know about matrices?" }],
    [{ call: "propose_curriculum", input: FIRST }],
    [{ text: "Let me think about that" }, { hold: true }],
  ]);
  intake.say(ASK);
  await intake.settled();
  expect(await intake.approve(1)).toMatchObject({ ok: false, status: 409 });

  intake.say("I can multiply them.");
  await intake.settled();
  const writing = new Promise<void>((resolve) => {
    const stop = intake.subscribe((event) => {
      if (event.type === "tutor_text") {
        stop();
        resolve();
      }
    });
  });
  intake.say("Why eigenvectors first?");
  await writing;

  expect(await intake.approve(1)).toMatchObject({ ok: false, status: 409 });
  await intake.interrupt();
  await intake.settled();
  expect(await intake.approve(1)).toEqual({ ok: true });
});
