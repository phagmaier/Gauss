import { readFileSync } from "node:fs";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { PageEvent } from "../../shared/events.ts";
import { createFakeBackend, type FakeTurn } from "../backends/fake.ts";
import type { Backup } from "../record/backup.ts";
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

function setUp(script: FakeTurn[], backup?: Backup) {
  const backend = createFakeBackend(script);
  const intake = createIntake({
    backend,
    systemPrompt: "You are a test planner.",
    dataRoot: openDataRoot({ path: dir, now: () => new Date(APPROVED_AT) }),
    ...(backup === undefined ? {} : { backup }),
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
  background:
    "The learner multiplies matrices with ease, but eigenvectors never clicked. They want enough linear algebra to follow PCA.",
  profile:
    "Works as a data analyst and writes Python every day. Likes a picture before the algebra.",
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
  background:
    "The learner multiplies matrices with ease and knows what a linear map is, but eigenvectors never clicked. They want enough linear algebra to follow PCA.",
  profile:
    "Works as a data analyst and writes Python every day. Can multiply matrices, but has had no linear algebra beyond that. Likes a picture before the algebra.",
};

/** The tutor's reply to the learner's first message, where it cannot propose (task 2.22). */
const OPENING: FakeTurn = [
  { text: "Do you know what a matrix does to a vector? Shall I propose?" },
];
const ANSWER = "I do. Go ahead.";

/** The learner's first message, then their answer to the tutor's question. */
async function opened(intake: Intake) {
  intake.say(ASK);
  await intake.settled();
  intake.say(ANSWER);
  await intake.settled();
}

function proposals(intake: Intake) {
  return intake
    .events()
    .filter(
      (e): e is Extract<PageEvent, { type: "curriculum_proposed" }> =>
        e.type === "curriculum_proposed",
    );
}

test("a valid proposal creates the course with a draft curriculum and its notes, shows it, and ends the tutor's turn", async () => {
  const { backend, intake } = setUp([
    OPENING,
    [
      { text: "Here is a course built backwards from PCA." },
      { call: "propose_curriculum", input: FIRST },
      { text: "Text after the card, which the learner must not see." },
    ],
  ]);

  expect(intake.say(ASK)).toEqual({ ok: true });
  await intake.settled();
  expect(intake.say(ANSWER)).toEqual({ ok: true });
  await intake.settled();

  expect(intake.events().slice(4)).toMatchObject([
    { type: "learner", text: ANSWER },
    { type: "turn_start" },
    { type: "tutor_text", text: "Here is a course built backwards from PCA." },
    {
      type: "curriculum_proposed",
      courseId: "linear-algebra-for-pca",
      revision: 1,
      title: "Linear algebra for PCA",
      units: FIRST.units,
      style: FIRST.style,
      background: FIRST.background,
    },
    { type: "turn_end", outcome: "done" },
  ]);
  expect(intake.courseId()).toBe("linear-algebra-for-pca");
  expect(await reload().readCourse("linear-algebra-for-pca")).toMatchObject({
    course: { title: "Linear algebra for PCA" },
    curriculum: { approval: { status: "draft" }, units: FIRST.units },
  });
  expect(await reload().readStyle("linear-algebra-for-pca")).toBe(FIRST.style);
  expect(await reload().readBackground("linear-algebra-for-pca")).toBe(
    FIRST.background,
  );
  expect(backend.sessions).toHaveLength(1);
  expect(backend.sessions[0]?.systemPrompt).toBe("You are a test planner.");
  expect(backend.sessions[0]?.tools.map((t) => t.name)).toEqual([
    "propose_curriculum",
  ]);
  expect(backend.received[1]?.text).toBe(
    `[Message from the learner. Allowed now: reply, or propose a curriculum with propose_curriculum.]\n${ANSWER}`,
  );
});

test("nothing can be proposed in reply to the learner's first message: the tool refuses with the reason, nothing is stored, and the tutor's question stands", async () => {
  const { backend, intake } = setUp([
    [
      { call: "propose_curriculum", input: FIRST },
      { text: "First: what do you know about eigenvectors?" },
    ],
    [{ call: "propose_curriculum", input: FIRST }],
  ]);

  intake.say(ASK);
  await intake.settled();

  const turn = backend.received[0]?.text ?? "";
  expect(turn).toMatch(/^\[Start of the intake\./);
  expect(turn).toContain("propose_curriculum is refused in this turn.");
  expect(turn.endsWith(`</about_the_learner>\n\n${ASK}`)).toBe(true);
  expect(backend.calls[0]?.result).toEqual({
    status: "refused",
    text: expect.stringMatching(
      /^Not in reply to the learner's first message: nothing is proposed before they have answered you once\. Ask what you still need to know/,
    ),
  });
  expect(proposals(intake)).toEqual([]);
  expect(intake.courseId()).toBeUndefined();
  expect(await reload().listCourses()).toEqual([]);
  expect(intake.events().slice(-2)).toEqual([
    {
      type: "tutor_text",
      text: "First: what do you know about eigenvectors?",
    },
    { type: "turn_end", outcome: "done" },
  ]);

  intake.say(ANSWER);
  await intake.settled();

  expect(backend.calls[1]?.result.status).toBe("done");
  expect(proposals(intake).map((p) => p.revision)).toEqual([1]);
});

test("a first message the tutor never received leaves the next one as the first, where nothing can be proposed", async () => {
  const fake = createFakeBackend([
    [{ call: "propose_curriculum", input: FIRST }, { text: "What else?" }],
  ]);
  let first = true;
  const intake = createIntake({
    backend: {
      ...fake,
      async startSession(options) {
        if (first) {
          first = false;
          throw new Error("Temporary startup failure.");
        }
        return fake.startSession(options);
      },
    },
    systemPrompt: "You are a test planner.",
    dataRoot: openDataRoot({ path: dir }),
  });

  intake.say(ASK);
  await intake.settled();
  intake.say(ASK);
  await intake.settled();

  expect(fake.received.map((t) => t.text)).toEqual([
    expect.stringMatching(/^\[Start of the intake\./),
  ]);
  expect(fake.calls[0]?.result.status).toBe("refused");
  expect(proposals(intake)).toEqual([]);
});

test("an invalid proposal is refused with the reason, stores nothing, and the tutor can then propose again", async () => {
  const broken = {
    ...FIRST,
    units: FIRST.units.map((u) =>
      u.id === "matrices" ? { ...u, prerequisites: ["vectors", "algebra"] } : u,
    ),
  };
  const { backend, intake } = setUp([
    OPENING,
    [
      { call: "propose_curriculum", input: broken },
      { text: "That was not right; let me fix it." },
    ],
    [{ call: "propose_curriculum", input: FIRST }],
  ]);

  await opened(intake);

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

  expect(backend.received[2]?.text).toBe(
    "[Message from the learner. Allowed now: reply, or propose a curriculum with propose_curriculum.]\nGo on.",
  );
  expect(proposals(intake).map((p) => p.revision)).toEqual([1]);
  expect((await reload().listCourses()).map((c) => c.id)).toEqual([
    "linear-algebra-for-pca",
  ]);
});

test("a reply to a proposal is a change request, and the revision replaces the draft and its notes in the same course", async () => {
  const { backend, intake } = setUp([
    OPENING,
    [{ call: "propose_curriculum", input: FIRST }],
    [
      { text: "I merged the first two units." },
      { call: "propose_curriculum", input: REVISED },
    ],
  ]);
  await opened(intake);

  intake.say("I can already multiply matrices. Can the start be shorter?");
  await intake.settled();

  const turn = backend.received[2]?.text ?? "";
  expect(turn).toMatch(/^\[Message from the learner about proposal 1,/);
  expect(turn).toContain(
    "call propose_curriculum with the whole revised curriculum, its style note, its background note and the learner's profile.]",
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
    background: REVISED.background,
    profile: REVISED.profile,
    profileWas: null,
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
  expect(await reload().readBackground("linear-algebra-for-pca")).toBe(
    REVISED.background,
  );
});

test("approving the latest revision approves the stored curriculum, keeps its notes, and ends the intake", async () => {
  const { intake } = setUp([
    OPENING,
    [{ call: "propose_curriculum", input: FIRST }],
    [{ call: "propose_curriculum", input: REVISED }],
  ]);
  await opened(intake);
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
  expect(await reload().readBackground("linear-algebra-for-pca")).toBe(
    REVISED.background,
  );
  expect(intake.say("One more thing.")).toMatchObject({
    ok: false,
    status: 409,
  });
  expect(await intake.approve(2)).toMatchObject({ ok: false, status: 409 });
});

test("an approval asks the backup for a commit once the approved curriculum is written; a refused one does not", async () => {
  // What the curriculum on disk says when each commit is asked for.
  const commits: { message: string; approval: string }[] = [];
  const { intake } = setUp(
    [OPENING, [{ call: "propose_curriculum", input: FIRST }]],
    {
      commit(message) {
        const path = join(dir, "courses", "linear-algebra-for-pca");
        const stored = JSON.parse(
          readFileSync(join(path, "curriculum.json"), "utf8"),
        );
        commits.push({ message, approval: stored.approval.status });
      },
      settled: () => Promise.resolve(),
    },
  );
  await opened(intake);

  expect(await intake.approve(2)).toMatchObject({ ok: false, status: 404 });
  expect(commits).toEqual([]);

  expect(await intake.approve(1)).toEqual({ ok: true });
  expect(commits).toEqual([
    {
      message: "linear-algebra-for-pca: curriculum approved",
      approval: "approved",
    },
  ]);
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
    OPENING,
    [{ call: "propose_curriculum", input: FIRST }],
    [{ call: "propose_curriculum", input: REVISED }],
    [{ call: "propose_curriculum", input: REVISED }],
  ]);
  await opened(intake);

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
  ).toEqual({ status: "draft", profile: REVISED.profile, profileWas: null });
  expect(await reload().readProfile()).toBeUndefined();

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

describe("the learner profile (task 5.8)", () => {
  const KEPT =
    "Works as a data analyst and writes Python every day. Prefers proofs to pictures.";

  /** A course of one unit, approved, which the learner moved on from: finished. */
  async function finishedCourse(title: string, finished = true) {
    const root = reload();
    const { id } = await root.createCourse({ title });
    const proposal = {
      title,
      units: [
        {
          id: "basics",
          title: "Basics",
          goal: "Use the basics in a small example.",
          prerequisites: [],
        },
      ],
      style: FIRST.style,
      background: FIRST.background,
    };
    await root.saveProposal(id, proposal);
    await root.approveCurriculum(id, proposal);
    const objective = `${id}-idea`;
    await root.storePlan(id, "basics", {
      objectives: [{ id: objective, statement: "State the idea." }],
      segments: [{ title: "The idea", objectives: [objective] }],
    });
    if (finished) {
      await root.appendEvidence(id, {
        kind: "override",
        recordedAt: APPROVED_AT,
        objectives: [objective],
      });
    }
  }

  test("the planner's first turn gives it the profile and the finished courses, or says there are none; a later turn gives the profile again only once it has changed", async () => {
    const none = setUp([OPENING]);
    none.intake.say(ASK);
    await none.intake.settled();
    expect(none.backend.received[0]?.text).toMatch(
      /^\[Start of the intake\. .* Before their message comes what Gauss keeps about the learner across their courses, in <about_the_learner>\.\]\n<about_the_learner>\nThey have no profile yet\.\nThey have finished no course yet\.\n<\/about_the_learner>\n\nLinear algebra/,
    );

    await reload().writeProfile(KEPT, undefined);
    await finishedCourse("Python for data work");
    await finishedCourse("Calculus I", false);
    await writeFile(join(dir, "courses", "calculus-i", "course.json"), "{");
    const { backend, intake } = setUp([
      OPENING,
      [{ text: "Noted." }],
      [{ text: "Noted again." }],
      [{ text: "And again." }],
    ]);
    await opened(intake);

    expect(backend.received[0]?.text).toContain(
      `]\n<about_the_learner>\nTheir profile:\n<profile>\n${KEPT}\n</profile>\n` +
        'The courses they have finished: "Python for data work".\n' +
        `</about_the_learner>\n\n${ASK}`,
    );
    expect(backend.received[1]?.text).toBe(
      `[Message from the learner. Allowed now: reply, or propose a curriculum with propose_curriculum.]\n${ANSWER}`,
    );

    // Edited on the Profile page during the intake.
    await reload().writeProfile(`${KEPT} Likes short sittings.`, KEPT);
    intake.say("Shorter units, please.");
    await intake.settled();
    intake.say("And fewer of them.");
    await intake.settled();

    expect(backend.received[2]?.text).toContain(
      "]\n<about_the_learner>\nTheir profile changed since you were given it. " +
        "It now reads as follows; propose from this text.\n" +
        `<profile>\n${KEPT} Likes short sittings.\n</profile>\n</about_the_learner>\n\n` +
        "Shorter units, please.",
    );
    expect(backend.received[3]?.text).toBe(
      "[Message from the learner. Allowed now: reply, or propose a curriculum with propose_curriculum.]\nAnd fewer of them.",
    );
  });

  test("each proposal's profile is shown with the profile it would replace, and approval writes the latest with the curriculum", async () => {
    await reload().writeProfile(KEPT, undefined);
    const { intake } = setUp([
      OPENING,
      [{ call: "propose_curriculum", input: FIRST }],
      [{ call: "propose_curriculum", input: REVISED }],
    ]);
    await opened(intake);
    intake.say("Shorter, please.");
    await intake.settled();

    expect(
      proposals(intake).map(({ profile, profileWas }) => ({
        profile,
        profileWas,
      })),
    ).toEqual([
      { profile: FIRST.profile, profileWas: KEPT },
      { profile: REVISED.profile, profileWas: KEPT },
    ]);
    // Nothing is written to it before approval.
    expect(await reload().readProfile()).toBe(KEPT);
    expect(
      (await reload().readCourse("linear-algebra-for-pca"))?.curriculum
        ?.approval,
    ).toEqual({ status: "draft", profile: REVISED.profile, profileWas: KEPT });

    expect(await intake.approve(2)).toEqual({ ok: true });
    expect(await reload().readProfile()).toBe(REVISED.profile);
    expect(
      (await reload().readCourse("linear-algebra-for-pca"))?.curriculum
        ?.approval,
    ).toEqual({ status: "approved", approvedAt: APPROVED_AT });
  });

  test.each(["curriculum.json", "profile.md"])(
    "a failed approval leaves both records unchanged and can be tried again (%s)",
    async (file) => {
      await reload().writeProfile(KEPT, undefined);
      const { intake } = setUp([
        OPENING,
        [{ call: "propose_curriculum", input: FIRST }],
      ]);
      await opened(intake);

      disk.refuses = file;
      await expect(intake.approve(1)).rejects.toThrow(/ENOSPC/);
      disk.refuses = undefined;
      expect(await reload().readProfile()).toBe(KEPT);
      expect(
        (await reload().readCourse("linear-algebra-for-pca"))?.curriculum
          ?.approval.status,
      ).toBe("draft");

      expect(await intake.approve(1)).toEqual({ ok: true });
      expect(await reload().readProfile()).toBe(FIRST.profile);
      expect(
        (await reload().readCourse("linear-algebra-for-pca"))?.curriculum
          ?.approval.status,
      ).toBe("approved");
    },
  );

  test("a profile edit still reaches the planner after Stop during turn composition", async () => {
    const root = reload();
    const backend = createFakeBackend([OPENING, [{ text: "Noted." }]]);
    const intake = createIntake({
      backend,
      dataRoot: root,
      systemPrompt: "You are a test planner.",
    });
    await root.writeProfile(KEPT, undefined);
    intake.say(ASK);
    await intake.settled();
    const edited = `${KEPT} Likes short sittings.`;
    await root.writeProfile(edited, KEPT);

    const reading = Promise.withResolvers<void>();
    const resume = Promise.withResolvers<void>();
    const read = root.readProfile;
    vi.spyOn(root, "readProfile").mockImplementationOnce(async () => {
      reading.resolve();
      await resume.promise;
      return read();
    });
    intake.say("Stop this message.");
    await reading.promise;
    try {
      await intake.interrupt();
    } finally {
      resume.resolve();
      await intake.settled();
    }
    expect(intake.events().at(-1)).toMatchObject({ outcome: "interrupted" });
    intake.say("Please continue.");
    await intake.settled();
    expect(backend.received[1]?.text).toContain(
      `<profile>\n${edited}\n</profile>`,
    );
    expect(backend.received[1]?.text).toContain("Please continue.");
    await intake.close();
  });

  test("approval is refused with the reason, writing nothing, once profile.md changed since the proposal; a proposal made from the changed profile can be approved", async () => {
    const commits: string[] = [];
    const { backend, intake } = setUp(
      [
        OPENING,
        [{ call: "propose_curriculum", input: FIRST }],
        [{ call: "propose_curriculum", input: REVISED }],
      ],
      { commit: (message) => commits.push(message), settled: async () => {} },
    );
    await opened(intake);
    await reload().writeProfile(KEPT, undefined);

    expect(await intake.approve(1)).toEqual({
      ok: false,
      status: 409,
      error:
        "Your profile was changed after this proposal was made, so approving it would replace that change unseen. Ask the tutor to propose again: it will be given your profile as it is now.",
    });
    expect(await reload().readProfile()).toBe(KEPT);
    expect(
      (await reload().readCourse("linear-algebra-for-pca"))?.curriculum
        ?.approval.status,
    ).toBe("draft");
    expect(intake.events().at(-1)?.type).not.toBe("curriculum_approved");
    expect(commits).toEqual([]);

    intake.say("Please propose it again.");
    await intake.settled();
    expect(backend.received[2]?.text).toContain(
      `<profile>\n${KEPT}\n</profile>`,
    );
    expect(proposals(intake).at(-1)).toMatchObject({
      revision: 2,
      profileWas: KEPT,
    });
    expect(await intake.approve(2)).toEqual({ ok: true });
    expect(await reload().readProfile()).toBe(REVISED.profile);
  });
});

describe("a draft reopened for review, its first conversation lost in a restart", () => {
  const DRAFT = {
    id: "linear-algebra-for-pca",
    proposal: { ...FIRST, profileWas: null },
  };

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
    const { intake } = setUp([
      OPENING,
      [{ call: "propose_curriculum", input: FIRST }],
    ]);
    await opened(intake);
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
        profileWas: null,
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
      "call propose_curriculum with the whole revised curriculum, its style note, its background note and the learner's profile (writing any it lacks),",
    );
    expect(
      turn.endsWith("</about_the_learner>\n\nCan the start be shorter?"),
    ).toBe(true);
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
          /<\/about_the_learner>\n\nPlease shorten the start\.$/,
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
      OPENING,
      [{ call: "propose_curriculum", input: FIRST }],
    ]);
    const first = intakes.start();
    await opened(first);

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
      OPENING,
      [{ call: "propose_curriculum", input: FIRST }],
      [{ call: "propose_curriculum", input: REVISED }],
    ]);
    await opened(intake);
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
    expect(backend.received[2]?.text).toMatch(
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
        OPENING,
        [{ call: "propose_curriculum", input: FIRST }],
        [{ text: "The start is two units long." }],
        [{ text: "Yes." }],
      ],
      kept,
    );
    await opened(intake);
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
    const turn = backend.received[2]?.text ?? "";
    expect(turn).toMatch(/^\[The learner is reviewing proposal 1,/);
    expect(turn).toContain(FIRST.units[2]?.goal);
    expect(turn).toContain(FIRST.style);
    expect(turn).toContain(FIRST.background);
    expect(
      turn.endsWith("</about_the_learner>\n\nIs the start too long?"),
    ).toBe(true);

    // Told once.
    intake.say("Good.");
    await intake.settled();
    expect(backend.received[3]?.text).toMatch(
      /^\[Message from the learner about proposal 1,/,
    );
  });

  test("whose session is lost before any proposal has the new one given the conversation so far, and not the messages after", async () => {
    const kept = new Set<string>();
    const { backend, timer, intake } = setUpIdle(
      [
        [{ text: "What do you know " }, { text: "already?" }],
        [{ call: "propose_curriculum", input: FIRST }],
        [{ text: "Noted." }],
      ],
      kept,
    );
    intake.say(ASK);
    await intake.settled();
    timer.advance(IDLE_MS);
    await closing();
    kept.clear();

    // The second is sent before the first's turn: it is not part of what
    // came before it, and arrives as a turn of its own.
    intake.say("Matrices, a little.");
    intake.say("And I want to read PCA papers.");
    await intake.settled();

    expect(backend.received[1]?.text).toBe(
      "[This conversation is new: the one before it with the learner was lost, so you have not seen it. " +
        'What was said in it, oldest first, as JSON (the "planner" messages are your replies):\n' +
        `[{"from":"learner","text":${JSON.stringify(ASK)}},{"from":"planner","text":"What do you know already?"}] ` +
        "Their new message follows. Allowed now: reply, or propose a curriculum with propose_curriculum. " +
        "Before their message comes what Gauss keeps about the learner across their courses, in <about_the_learner>.]\n" +
        "<about_the_learner>\nThey have no profile yet.\nThey have finished no course yet.\n</about_the_learner>\n\n" +
        "Matrices, a little.",
    );
    expect(backend.received[2]?.text).toBe(
      "[Message from the learner. Allowed now: reply, or propose a curriculum with propose_curriculum.]\nAnd I want to read PCA papers.",
    );
    expect(proposals(intake)).toHaveLength(1);
  });
});
