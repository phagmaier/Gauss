import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { PageEvent } from "../../shared/events.ts";
import { createFakeBackend, type FakeTurn } from "../backends/fake.ts";
import { openDataRoot } from "../record/data-root.ts";
import { IDLE_MS } from "./conversation.ts";
import { createFakeTimer } from "./fake-timer.ts";
import { createIntake, createIntakes, type Intake } from "./intake.ts";

// Lets a test make the disk refuse writes to one file, as a full disk would.
const disk = vi.hoisted(() => ({ refuses: undefined as string | undefined }));
vi.mock("../record/atomic-write.ts", async (importOriginal) => {
  const real =
    await importOriginal<typeof import("../record/atomic-write.ts")>();
  return {
    ...real,
    async writeFileAtomic(path: string, contents: string) {
      if (disk.refuses !== undefined && path.endsWith(disk.refuses)) {
        throw Object.assign(new Error("ENOSPC: no space left on device"), {
          code: "ENOSPC",
        });
      }
      return real.writeFileAtomic(path, contents);
    },
  };
});

// Each test gets its own data root; none touches ~/gauss (AGENTS.md).
let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "gauss-intake-"));
});
afterEach(async () => {
  disk.refuses = undefined;
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
  style:
    "Short explanations, each starting from a picture in two dimensions. Checks are mostly small computations by hand. One new idea per segment.",
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
  style:
    "Short explanations, each starting from a picture in two dimensions. Checks ask you to predict and explain more than to compute.",
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

  expect(intake.events()).toMatchObject([
    { type: "learner", text: ASK },
    { type: "turn_start" },
    { type: "tutor_text", text: "Here is a course built backwards from PCA." },
    {
      type: "curriculum_proposed",
      courseId: "linear-algebra-for-pca",
      revision: 1,
      title: "Linear algebra for PCA",
      units: FIRST.units,
      style: FIRST.style,
    },
    { type: "turn_end", outcome: "done" },
  ]);
  expect(intake.courseId()).toBe("linear-algebra-for-pca");
  expect(await reload().readCourse("linear-algebra-for-pca")).toMatchObject({
    course: { title: "Linear algebra for PCA" },
    curriculum: { approval: { status: "draft" }, units: FIRST.units },
  });
  expect(await reload().readStyle("linear-algebra-for-pca")).toBe(FIRST.style);
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

test("a reply to a proposal is a change request, and the revision replaces the draft and its style note in the same course", async () => {
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
    style: REVISED.style,
  });
  const courses = await reload().listCourses();
  expect(courses).toHaveLength(1);
  expect(courses[0]).toMatchObject({
    id: "linear-algebra-for-pca",
    course: { title: "Linear algebra, then PCA" },
    curriculum: { approval: { status: "draft" }, units: REVISED.units },
  });
  expect(await reload().readStyle("linear-algebra-for-pca")).toBe(
    REVISED.style,
  );
});

test("approving the latest revision approves the stored curriculum, keeps its style note, and ends the intake", async () => {
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
  expect(await reload().readStyle("linear-algebra-for-pca")).toBe(
    REVISED.style,
  );
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

// Review of 2.10: a revision whose style note failed to save had already
// replaced the units on disk, and approving the card before it approved
// those unseen units.
test("a revision saved only in part cannot be approved through the card before it; a full proposal then can", async () => {
  const { backend, intake } = setUp([
    [{ call: "propose_curriculum", input: FIRST }],
    [{ call: "propose_curriculum", input: REVISED }],
    [{ call: "propose_curriculum", input: REVISED }],
  ]);
  intake.say(ASK);
  await intake.settled();

  disk.refuses = "style.md";
  intake.say("Shorter, please.");
  await intake.settled();
  disk.refuses = undefined;

  expect(backend.calls[1]?.result).toEqual({
    status: "refused",
    text: "The tool failed: ENOSPC: no space left on device",
  });
  expect(proposals(intake).map((p) => p.revision)).toEqual([1]);
  // Saving stopped between the files: the new units, the old note.
  expect(await reload().readCourse("linear-algebra-for-pca")).toMatchObject({
    curriculum: { units: REVISED.units },
  });

  expect(await intake.approve(1)).toEqual({
    ok: false,
    status: 409,
    error: expect.stringMatching(/not the one on this card/),
  });
  expect(
    (await reload().readCourse("linear-algebra-for-pca"))?.curriculum?.approval,
  ).toEqual({ status: "draft" });

  intake.say("Please try that again.");
  await intake.settled();
  expect(await intake.approve(2)).toEqual({ ok: true });
  expect(await reload().readCourse("linear-algebra-for-pca")).toMatchObject({
    course: { title: REVISED.title },
    curriculum: { approval: { status: "approved" }, units: REVISED.units },
  });
  expect(await reload().readStyle("linear-algebra-for-pca")).toBe(
    REVISED.style,
  );
});

describe("a draft reopened for review, its first conversation lost in a restart", () => {
  const DRAFT = { id: "linear-algebra-for-pca", proposal: FIRST };

  function reopen(script: FakeTurn[]) {
    const backend = createFakeBackend(script);
    const dataRoot = openDataRoot({
      path: dir,
      now: () => new Date(APPROVED_AT),
    });
    const intakes = createIntakes({
      backend,
      systemPrompt: "You are a test planner.",
      dataRoot,
    });
    return { backend, intakes, dataRoot };
  }

  /** The course as the first intake left it: one draft on disk. */
  async function storeDraft() {
    const { intake } = setUp([[{ call: "propose_curriculum", input: FIRST }]]);
    intake.say(ASK);
    await intake.settled();
    await intake.close();
  }

  test("shows the stored draft as proposal 1, and a reply sends the tutor the whole draft", async () => {
    await storeDraft();
    const { backend, intakes } = reopen([
      [{ call: "propose_curriculum", input: REVISED }],
    ]);
    const intake = intakes.review(DRAFT);

    expect(intake.events()).toEqual([
      { type: "draft_reopened" },
      {
        type: "curriculum_proposed",
        courseId: "linear-algebra-for-pca",
        revision: 1,
        ...FIRST,
      },
    ]);
    expect(intake.courseId()).toBe("linear-algebra-for-pca");
    expect(backend.sessions).toEqual([]);

    intake.say("Can the start be shorter?");
    await intake.settled();

    const turn = backend.received[0]?.text ?? "";
    expect(turn).toMatch(/^\[The learner is reviewing proposal 1,/);
    expect(turn).toContain(JSON.stringify(FIRST));
    expect(turn).toContain(
      "call propose_curriculum with the whole revised curriculum",
    );
    expect(turn.endsWith("]\nCan the start be shorter?")).toBe(true);
    expect(proposals(intake).at(-1)).toMatchObject({
      courseId: "linear-algebra-for-pca",
      revision: 2,
    });
    expect(await reload().listCourses()).toMatchObject([
      {
        id: "linear-algebra-for-pca",
        course: { title: REVISED.title },
        curriculum: { approval: { status: "draft" }, units: REVISED.units },
      },
    ]);
  });

  test.each(["failed", "stopped"] as const)(
    "the first delivered turn includes the draft after a %s startup attempt",
    async (attempt) => {
      await storeDraft();
      const fake = createFakeBackend([
        [{ call: "propose_curriculum", input: REVISED }],
      ]);
      const starting = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      let first = true;
      const intake = createIntake({
        backend: {
          ...fake,
          async startSession(options) {
            if (first) {
              first = false;
              starting.resolve();
              await release.promise;
              if (attempt === "failed")
                throw new Error("Temporary startup failure.");
            }
            return fake.startSession(options);
          },
        },
        dataRoot: openDataRoot({ path: dir }),
        systemPrompt: "You are a test planner.",
        draft: DRAFT,
      });
      try {
        intake.say("Can the start be shorter?");
        await starting.promise;
        if (attempt === "stopped") await intake.interrupt();
        release.resolve();
        await intake.settled();
        expect(fake.received).toEqual([]);

        intake.say("Please shorten the start.");
        await intake.settled();

        expect(fake.received.map((turn) => turn.text)).toEqual([
          expect.stringContaining(JSON.stringify(FIRST)),
        ]);
        expect(fake.received[0]?.text).toMatch(
          /\]\nPlease shorten the start\.$/,
        );
        expect(proposals(intake).at(-1)).toMatchObject({
          revision: 2,
          units: REVISED.units,
        });
      } finally {
        release.resolve();
        await intake.close();
      }
    },
  );

  test("can be approved without a word to the tutor", async () => {
    await storeDraft();
    const { backend, intakes } = reopen([]);
    const intake = intakes.review(DRAFT);

    expect(await intake.approve(1)).toEqual({ ok: true });
    expect(backend.sessions).toEqual([]);
    expect(
      (await reload().readCourse("linear-algebra-for-pca"))?.curriculum
        ?.approval,
    ).toEqual({ status: "approved", approvedAt: APPROVED_AT });
  });

  test("keeps the intake for that course, including after approval", async () => {
    const { intakes } = reopen([
      [{ call: "propose_curriculum", input: FIRST }],
    ]);
    const first = intakes.start();
    first.say(ASK);
    await first.settled();

    expect(intakes.review(DRAFT)).toBe(first);
    expect(intakes.get(first.id)).toBe(first);
    await first.approve(1);
    expect(intakes.review(DRAFT)).toBe(first);
  });
});

describe("an intake left idle (task 2.15)", () => {
  function setUpIdle(script: FakeTurn[], kept = new Set<string>()) {
    const backend = createFakeBackend(script, [], { kept });
    const timer = createFakeTimer();
    const intake = createIntake({
      backend,
      systemPrompt: "You are a test planner.",
      dataRoot: openDataRoot({ path: dir, now: () => new Date(APPROVED_AT) }),
      timer,
    });
    return { backend, timer, intake };
  }

  /** Lets the closing of a session, which the timer starts, run. */
  const closing = () => new Promise((resolve) => setImmediate(resolve));
  const intakeFolder = () => join(dir, "intake");

  test("has its session kept in the intakes' folder, closed once idle for IDLE_MS, resumed by the next message, and closed for good by approval", async () => {
    const { backend, timer, intake } = setUpIdle([
      [{ call: "propose_curriculum", input: FIRST }],
      [{ call: "propose_curriculum", input: REVISED }],
    ]);
    intake.say(ASK);
    await intake.settled();
    const [id] = backend.ids;
    expect(backend.sessions[0]).toMatchObject({
      cwd: intakeFolder(),
      title: "Gauss: new course",
    });
    expect((await stat(intakeFolder())).isDirectory()).toBe(true);

    timer.advance(IDLE_MS - 1);
    await closing();
    expect(backend.closed).toEqual([]);
    timer.advance(1);
    await closing();
    expect(backend.closed).toEqual([id]);

    intake.say("Shorter, please.");
    await intake.settled();

    expect(backend.sessions).toHaveLength(2);
    expect(backend.sessions[1]).toMatchObject({
      cwd: intakeFolder(),
      resumeId: id,
    });
    expect(backend.received[1]?.text).toMatch(
      /^\[Message from the learner about proposal 1,/,
    );
    expect(proposals(intake).at(-1)).toMatchObject({ revision: 2 });

    expect(await intake.approve(2)).toEqual({ ok: true });
    expect(backend.closed).toEqual([id, id]);
    timer.advance(IDLE_MS);
    await closing();
    expect(backend.closed).toEqual([id, id]);
  });

  test("whose session is then lost gives way to a new one, which is given the latest proposal, and the thread says so", async () => {
    const kept = new Set<string>();
    const { backend, timer, intake } = setUpIdle(
      [
        [{ call: "propose_curriculum", input: FIRST }],
        [{ text: "The start is two units long." }],
        [{ text: "Yes." }],
      ],
      kept,
    );
    intake.say(ASK);
    await intake.settled();
    const [lost] = backend.ids;
    timer.advance(IDLE_MS);
    await closing();
    kept.delete(lost ?? "");

    intake.say("Is the start too long?");
    await intake.settled();

    expect(intake.events().slice(-5)).toMatchObject([
      { type: "learner", text: "Is the start too long?" },
      { type: "turn_start" },
      { type: "fresh_start", reason: "not-resumed" },
      { type: "tutor_text", text: "The start is two units long." },
      { type: "turn_end", outcome: "done" },
    ]);
    expect(backend.sessions.map((s) => s.resumeId)).toEqual([
      undefined,
      lost,
      undefined,
    ]);
    const turn = backend.received[1]?.text ?? "";
    expect(turn).toMatch(/^\[The learner is reviewing proposal 1,/);
    expect(turn).toContain(FIRST.units[2]?.goal);
    expect(turn).toContain(FIRST.style);
    expect(turn.endsWith("]\nIs the start too long?")).toBe(true);

    // Told once.
    intake.say("Good.");
    await intake.settled();
    expect(backend.received[2]?.text).toMatch(
      /^\[Message from the learner about proposal 1,/,
    );
  });

  test("whose session is lost before any proposal has the new one told it has not seen the conversation", async () => {
    const kept = new Set<string>();
    const { backend, timer, intake } = setUpIdle(
      [
        [{ text: "What do you know already?" }],
        [{ call: "propose_curriculum", input: FIRST }],
      ],
      kept,
    );
    intake.say(ASK);
    await intake.settled();
    timer.advance(IDLE_MS);
    await closing();
    kept.clear();

    intake.say("Matrices, a little.");
    await intake.settled();

    expect(backend.received[1]?.text).toBe(
      "[This conversation is new: the one before it with the learner was lost, so you have not seen what they said before. Their message follows. Allowed now: reply, or propose a curriculum with propose_curriculum.]\nMatrices, a little.",
    );
    expect(proposals(intake)).toHaveLength(1);
  });
});
