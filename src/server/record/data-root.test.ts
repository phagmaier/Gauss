import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  type FileHandle,
  mkdir,
  mkdtemp,
  open,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Curriculum, ShownProposal } from "../../shared/curriculum.ts";
import type { PageEvent } from "../../shared/events.ts";
import type { AnswerEvidence, EvidenceEntry } from "../../shared/evidence.ts";
import type { Plan } from "../../shared/plan.ts";
import type { UnitPosition } from "../../shared/state.ts";
import {
  type DataRoot,
  DraftMismatch,
  openDataRoot,
  resolveDataRoot,
} from "./data-root.ts";

// Every test gets its own data root in the system's temporary folder; none
// touches ~/gauss (AGENTS.md).
let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "gauss-data-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** A clock that reads the given times in turn, then stays on the last. */
function clock(...times: string[]): () => Date {
  let next = 0;
  return () => new Date(times[Math.min(next++, times.length - 1)] ?? "");
}

const CURRICULUM: Curriculum = {
  approval: { status: "draft" },
  units: [
    {
      id: "limits",
      title: "Limits and continuity",
      goal: "Evaluate limits and decide where a function is continuous.",
      prerequisites: [],
    },
  ],
};

describe("resolveDataRoot", () => {
  test.each([
    { env: {}, expected: "/home/learner/gauss" },
    { env: { GAUSS_DATA_ROOT: "" }, expected: "/home/learner/gauss" },
    { env: { GAUSS_DATA_ROOT: "/srv/study" }, expected: "/srv/study" },
    {
      env: { GAUSS_DATA_ROOT: "/srv/study/../notes/" },
      expected: "/srv/notes",
    },
  ])("$env gives $expected", ({ env, expected }) => {
    expect(resolveDataRoot(env, "/home/learner")).toBe(expected);
  });

  test("a relative override is taken from the current folder", () => {
    expect(resolveDataRoot({ GAUSS_DATA_ROOT: "study" }, "/home/learner")).toBe(
      join(process.cwd(), "study"),
    );
  });
});

test("a created course is written as course.json and reads back", async () => {
  const root = openDataRoot({
    path: dir,
    now: clock("2026-11-15T09:00:00.000Z"),
  });

  const created = await root.createCourse({ title: "  Calculus I " });

  const expected = {
    id: "calculus-i",
    course: {
      title: "Calculus I",
      backend: "claude",
      settings: { webSearch: false },
      createdAt: "2026-11-15T09:00:00.000Z",
      lastOpenedAt: "2026-11-15T09:00:00.000Z",
    },
    curriculum: null,
  };
  expect(created).toEqual(expected);
  expect(await root.readCourse("calculus-i")).toEqual(expected);

  const folder = join(dir, "courses", "calculus-i");
  expect(await readdir(folder)).toEqual(["course.json"]);
  expect(
    JSON.parse(await readFile(join(folder, "course.json"), "utf8")),
  ).toEqual(expected.course);
});

test.each([
  { title: "Bayes' theorem", id: "bayes-theorem" },
  { title: "Éléments d'analyse", id: "elements-d-analyse" },
  { title: "C++ & Rust: 2026 edition", id: "c-rust-2026-edition" },
  { title: "線形代数", id: "course" },
  {
    title:
      "A very long title that goes on about everything the course will eventually cover",
    id: "a-very-long-title-that-goes-on-about-everything",
  },
])("the title $title gives the id $id", async ({ title, id }) => {
  const created = await openDataRoot({ path: dir }).createCourse({ title });

  expect(created.id).toBe(id);
});

test("a second course with the same title gets its own id", async () => {
  const root = openDataRoot({ path: dir });

  const ids = [];
  for (let n = 0; n < 3; n++) {
    ids.push((await root.createCourse({ title: "Calculus I" })).id);
  }

  expect(ids).toEqual(["calculus-i", "calculus-i-2", "calculus-i-3"]);
});

test("a blank title is refused and makes no folder", async () => {
  await expect(
    openDataRoot({ path: dir }).createCourse({ title: "  " }),
  ).rejects.toThrow();

  expect(await readdir(dir)).toEqual([]);
});

test("the list is empty before any course exists", async () => {
  expect(
    await openDataRoot({ path: join(dir, "not-made-yet") }).listCourses(),
  ).toEqual([]);
});

test("the list holds every course, most recently opened first, after a restart", async () => {
  const before = openDataRoot({
    path: dir,
    now: clock(
      "2026-11-10T08:00:00.000Z",
      "2026-11-14T08:00:00.000Z",
      "2026-11-12T08:00:00.000Z",
    ),
  });
  await before.createCourse({ title: "Calculus I" });
  await before.createCourse({ title: "Transformers from the papers" });
  await before.createCourse({ title: "Phenomenology of Spirit" });

  const after = openDataRoot({ path: dir });
  const listed = await after.listCourses();

  expect(listed.map((c) => [c.id, c.course.lastOpenedAt])).toEqual([
    ["transformers-from-the-papers", "2026-11-14T08:00:00.000Z"],
    ["phenomenology-of-spirit", "2026-11-12T08:00:00.000Z"],
    ["calculus-i", "2026-11-10T08:00:00.000Z"],
  ]);
});

test("opening a course moves it to the top of the list, and only its lastOpenedAt changes", async () => {
  const root = openDataRoot({
    path: dir,
    now: clock(
      "2026-11-10T08:00:00.000Z",
      "2026-11-12T08:00:00.000Z",
      "2026-11-15T09:30:00.000Z",
    ),
  });
  const calculus = await root.createCourse({ title: "Calculus I" });
  await root.createCourse({ title: "Phenomenology of Spirit" });

  const opened = await root.markOpened(calculus.id);

  expect(opened.course).toEqual({
    ...calculus.course,
    lastOpenedAt: "2026-11-15T09:30:00.000Z",
  });
  const listed = await openDataRoot({ path: dir }).listCourses();
  expect(listed.map((c) => c.id)).toEqual([
    "calculus-i",
    "phenomenology-of-spirit",
  ]);
  expect(listed[0]?.course).toEqual(opened.course);
});

test("opening a unit marks its course opened and keeps the latest time each unit was opened", async () => {
  const root = openDataRoot({
    path: dir,
    now: clock(
      "2026-11-10T08:00:00.000Z",
      "2026-11-12T08:00:00.000Z",
      "2026-11-13T08:00:00.000Z",
      "2026-11-15T09:30:00.000Z",
    ),
  });
  const { id, course } = await root.createCourse({ title: "Calculus I" });

  await root.markOpened(id, "limits");
  await root.markOpened(id, "derivative");
  await root.markOpened(id, "limits");

  expect((await openDataRoot({ path: dir }).readCourse(id))?.course).toEqual({
    ...course,
    lastOpenedAt: "2026-11-15T09:30:00.000Z",
    unitsOpenedAt: {
      limits: "2026-11-15T09:30:00.000Z",
      derivative: "2026-11-13T08:00:00.000Z",
    },
  });
  await expect(root.markOpened(id, "../limits")).rejects.toThrow();
});

test.each([
  { note: "style", file: "style.md" },
  { note: "background", file: "background.md" },
] as const)(
  "a course's $note note is read from $file, trimmed, and a course without one, or with a blank one, has none",
  async ({ note, file }) => {
    const root = openDataRoot({ path: dir });
    const { id } = await root.createCourse({ title: "Calculus I" });
    const path = join(dir, "courses", id, file);
    const read = () =>
      note === "style" ? root.readStyle(id) : root.readBackground(id);

    expect(await read()).toBeUndefined();

    await writeFile(path, "\nShort explanations, many small exercises.\n");
    expect(await read()).toBe("Short explanations, many small exercises.");

    await writeFile(path, " \n");
    expect(await read()).toBeUndefined();
  },
);

test("a course reads back with its curriculum once there is one", async () => {
  const root = openDataRoot({ path: dir });
  const { id } = await root.createCourse({ title: "Calculus I" });
  await writeFile(
    join(dir, "courses", id, "curriculum.json"),
    JSON.stringify(CURRICULUM),
  );

  expect((await root.readCourse(id))?.curriculum).toEqual(CURRICULUM);
  expect((await root.listCourses())[0]?.curriculum).toEqual(CURRICULUM);
});

test.each(["no-such-course", "../courses/calculus-i", "Calculus", ""])(
  "reading the id %j finds nothing",
  async (id) => {
    const root = openDataRoot({ path: dir });
    await root.createCourse({ title: "Calculus I" });

    expect(await root.readCourse(id)).toBeUndefined();
  },
);

test("a course whose course.json is damaged is an error that names the file", async () => {
  const root = openDataRoot({ path: dir });
  const { id } = await root.createCourse({ title: "Calculus I" });
  await writeFile(
    join(dir, "courses", id, "course.json"),
    '{"title": "Calculus I"}',
  );

  await expect(root.readCourse(id)).rejects.toThrow(/calculus-i\/course\.json/);
  await expect(root.listCourses()).rejects.toThrow(/calculus-i\/course\.json/);
});

test("what a crash leaves behind is ignored: a folder without course.json, a temporary file", async () => {
  const root = openDataRoot({ path: dir });
  await root.createCourse({ title: "Calculus I" });
  await mkdir(join(dir, "courses", "half-made"));
  await writeFile(join(dir, "courses", "notes.txt"), "not a course");
  // What a crash partway through writeFileAtomic leaves beside the file.
  await writeFile(
    join(dir, "courses", "calculus-i", ".course.json.2f1c.tmp"),
    '{"title": "Calc',
  );

  expect((await root.listCourses()).map((c) => c.id)).toEqual(["calculus-i"]);
  expect(await root.readCourse("half-made")).toBeUndefined();
  expect((await root.createCourse({ title: "Half made" })).id).toBe(
    "half-made-2",
  );
});

const PROPOSAL = {
  title: "Linear algebra for PCA",
  units: [
    {
      id: "vectors",
      title: "Vectors and linear maps",
      goal: "Describe a linear map by what it does to a basis.",
      prerequisites: [],
    },
    {
      id: "eigen",
      title: "Eigenvalues and eigenvectors",
      goal: "Find the directions a map only stretches, and by how much.",
      prerequisites: ["vectors"],
    },
  ],
  style: "Short explanations, a picture before the algebra.",
  background:
    "The learner multiplies matrices with ease, but eigenvectors never clicked.",
};

describe("proposals and approval", () => {
  // Approval names what the learner saw, so a draft that differs from it,
  // such as one whose save failed partway, is never approved unseen.
  test.each([
    { part: "title", shown: { ...PROPOSAL, title: "Linear algebra" } },
    {
      part: "units",
      shown: { ...PROPOSAL, units: PROPOSAL.units.slice(0, 1) },
    },
    { part: "style note", shown: { ...PROPOSAL, style: "Long lectures." } },
    {
      part: "style note, none shown",
      shown: { ...PROPOSAL, style: undefined },
    },
    {
      part: "background note",
      shown: { ...PROPOSAL, background: "The learner is new to matrices." },
    },
    {
      part: "background note, none shown",
      shown: { ...PROPOSAL, background: undefined },
    },
  ])(
    "approval is refused, changing nothing, when the stored draft differs from the one shown in its $part",
    async ({ part, shown }) => {
      const root = openDataRoot({ path: dir });
      const { id } = await root.createCourse({ title: "Linear algebra" });
      await root.saveProposal(id, PROPOSAL);
      // A card for a draft without a note has no such field at all.
      const card = Object.fromEntries(
        Object.entries(shown).filter(([, value]) => value !== undefined),
      ) as ShownProposal;

      const refused = root.approveCurriculum(id, card);
      await expect(refused).rejects.toThrow(DraftMismatch);
      await expect(refused).rejects.toThrow(
        new RegExp(`differ in ${part.replace(/, none shown$/, "")}\\.`),
      );
      expect((await root.readCourse(id))?.curriculum?.approval).toEqual({
        status: "draft",
      });
    },
  );

  test("a proposal is stored as the draft curriculum, its title as the course's, its style note as style.md and its background note as background.md", async () => {
    const root = openDataRoot({ path: dir });
    const { id } = await root.createCourse({ title: "Linear algebra" });

    const saved = await root.saveProposal(id, PROPOSAL);

    const expected = {
      id: "linear-algebra",
      course: expect.objectContaining({ title: "Linear algebra for PCA" }),
      curriculum: { approval: { status: "draft" }, units: PROPOSAL.units },
    };
    expect(saved).toEqual(expected);
    expect(await openDataRoot({ path: dir }).readCourse(id)).toEqual(expected);
    expect(await readFile(join(dir, "courses", id, "style.md"), "utf8")).toBe(
      "Short explanations, a picture before the algebra.\n",
    );
    expect(
      await readFile(join(dir, "courses", id, "background.md"), "utf8"),
    ).toBe(
      "The learner multiplies matrices with ease, but eigenvectors never clicked.\n",
    );
  });

  test("an invalid proposal is refused and changes nothing", async () => {
    const root = openDataRoot({ path: dir });
    const { id } = await root.createCourse({ title: "Linear algebra" });
    const cycle = {
      ...PROPOSAL,
      units: PROPOSAL.units.map((u) =>
        u.id === "vectors" ? { ...u, prerequisites: ["eigen"] } : u,
      ),
    };

    await expect(root.saveProposal(id, cycle)).rejects.toThrow(/cycle/);
    expect(await root.readCourse(id)).toMatchObject({
      course: { title: "Linear algebra" },
      curriculum: null,
    });
    expect(await root.readStyle(id)).toBeUndefined();
    expect(await root.readBackground(id)).toBeUndefined();
  });

  test("approval stamps the draft with the clock's time, and then no draft can replace it or its notes", async () => {
    const root = openDataRoot({
      path: dir,
      now: clock("2026-11-15T09:00:00.000Z", "2026-11-15T10:30:00.000Z"),
    });
    const { id } = await root.createCourse({ title: "Linear algebra" });
    await root.saveProposal(id, PROPOSAL);

    const approved = await root.approveCurriculum(id, PROPOSAL);

    const curriculum = {
      approval: { status: "approved", approvedAt: "2026-11-15T10:30:00.000Z" },
      units: PROPOSAL.units,
    };
    expect(approved.curriculum).toEqual(curriculum);
    await expect(
      root.saveProposal(id, {
        ...PROPOSAL,
        style: "Long lectures.",
        background: "The learner is new to matrices.",
      }),
    ).rejects.toThrow(/approved/);
    expect(await root.readStyle(id)).toBe(PROPOSAL.style);
    expect(await root.readBackground(id)).toBe(PROPOSAL.background);
    await expect(root.approveCurriculum(id, PROPOSAL)).rejects.toThrow(
      /already approved/,
    );
    expect((await root.readCourse(id))?.curriculum).toEqual(curriculum);
  });

  test("approval needs a course with a draft", async () => {
    const root = openDataRoot({ path: dir });
    const { id } = await root.createCourse({ title: "Linear algebra" });

    await expect(root.approveCurriculum(id, PROPOSAL)).rejects.toThrow(
      /no curriculum/,
    );
    await expect(
      root.approveCurriculum("no-such-course", PROPOSAL),
    ).rejects.toThrow(/no course/);
    await expect(root.saveProposal("no-such-course", PROPOSAL)).rejects.toThrow(
      /no course/,
    );
  });
});

// A process that stops while writing a file must not leave it half written.
// A child process rewrites curriculum.json under a file size limit smaller
// than the new version, so the kernel stops the write partway (Node turns
// the limit into an EFBIG error rather than dying of SIGXFSZ). The record is
// then reloaded from disk by a fresh openDataRoot. A writer that wrote the
// file in place would leave the first 512 KB of the new version there.
const WRITER = new URL("./write-in-child.ts", import.meta.url).pathname;
/** In the 512-byte blocks of POSIX sh, 512 KB; where blocks are 1 KB, 1 MB. */
const LIMIT_BLOCKS = 1024;

async function writeInChild(
  target: string,
  source: string,
  limit: number | "unlimited",
): Promise<{ code: number | null; stderr: string }> {
  const child = spawn(
    "/bin/sh",
    [
      "-c",
      `ulimit -f ${limit} && exec "$0" "$@"`,
      process.execPath,
      WRITER,
      target,
      source,
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  let stderr = "";
  child.stderr.setEncoding("utf8").on("data", (piece: string) => {
    stderr += piece;
  });
  // "close", not "exit": it waits for the child's stderr to be read in full.
  const [code] = await once(child, "close");
  return { code, stderr };
}

/** A valid curriculum of about 2 MB, over the limit in either block size. */
function largeCurriculum(): Curriculum {
  return {
    approval: { status: "draft" },
    units: Array.from({ length: 5000 }, (_, i) => ({
      id: `unit-${i}`,
      title: `Unit ${i}`,
      goal: `Do the thing that unit ${i} teaches. `.repeat(8).trim(),
      prerequisites: i === 0 ? [] : ["unit-0"],
    })),
  };
}

test("a reload after a crash mid-write finds the old file whole, and the write then succeeds", async () => {
  const { id } = await openDataRoot({ path: dir }).createCourse({
    title: "Crash test",
  });
  const target = join(dir, "courses", id, "curriculum.json");
  await writeFile(target, JSON.stringify(CURRICULUM));
  const large = largeCurriculum();
  const source = join(dir, "large.json");
  await writeFile(source, `${JSON.stringify(large, null, 2)}\n`);
  expect((await readFile(source)).length).toBeGreaterThan(LIMIT_BLOCKS * 1024);

  const cut = await writeInChild(target, source, LIMIT_BLOCKS);

  expect(cut.code).not.toBe(0);
  expect(cut.stderr).toMatch(/EFBIG/);
  const reloaded = openDataRoot({ path: dir });
  expect((await reloaded.readCourse(id))?.curriculum).toEqual(CURRICULUM);
  expect((await reloaded.listCourses()).map((c) => c.id)).toEqual([id]);

  const whole = await writeInChild(target, source, "unlimited");

  expect(whole).toEqual({ code: 0, stderr: "" });
  expect((await reloaded.readCourse(id))?.curriculum).toEqual(large);
}, 20_000);

// Task 2.2: a unit's plan in curriculum.json, the position of each unit in
// progress in state.json, and the evidence log.

const VECTORS_PLAN: Plan = {
  objectives: [
    {
      id: "basis-image",
      statement: "Describe a linear map by the images of a basis.",
    },
    { id: "map-matrix", statement: "Write the matrix of a linear map." },
  ],
  segments: [
    { title: "Maps and bases", objectives: ["basis-image", "map-matrix"] },
  ],
};

const EIGEN_PLAN: Plan = {
  objectives: [
    {
      id: "eigenvector",
      statement: "Check whether a vector is an eigenvector of a matrix.",
    },
    {
      id: "eigenvalues",
      statement: "Find the eigenvalues of a 2-by-2 matrix.",
    },
  ],
  segments: [
    { title: "Directions that only stretch", objectives: ["eigenvector"] },
    { title: "The characteristic polynomial", objectives: ["eigenvalues"] },
  ],
};

/** A course whose curriculum is PROPOSAL, approved unless asked otherwise. */
async function courseWithCurriculum(root: DataRoot, approve = true) {
  const { id } = await root.createCourse({ title: "Linear algebra" });
  await root.saveProposal(id, PROPOSAL);
  if (approve) await root.approveCurriculum(id, PROPOSAL);
  return id;
}

describe("unit plans", () => {
  test("a plan is stored on its unit in curriculum.json and reads back after a restart", async () => {
    const root = openDataRoot({ path: dir });
    const id = await courseWithCurriculum(root);
    const before = (await root.readCourse(id))?.curriculum;

    const stored = await root.storePlan(id, "eigen", EIGEN_PLAN);

    const expected = {
      approval: before?.approval,
      units: [PROPOSAL.units[0], { ...PROPOSAL.units[1], plan: EIGEN_PLAN }],
    };
    expect(stored.curriculum).toEqual(expected);
    expect(
      (await openDataRoot({ path: dir }).readCourse(id))?.curriculum,
    ).toEqual(expected);
  });

  test.each([
    {
      name: "a curriculum not yet approved",
      approve: false,
      unit: "eigen",
      plan: EIGEN_PLAN,
      message: /not approved/,
    },
    {
      name: "a unit not in the curriculum",
      unit: "matrices",
      plan: EIGEN_PLAN,
      message: /"matrices" is not a unit of "linear-algebra"/,
    },
    {
      name: "a unit that already has a plan",
      earlier: { unit: "eigen", plan: EIGEN_PLAN },
      unit: "eigen",
      plan: VECTORS_PLAN,
      message: /"eigen" already has a plan/,
    },
    {
      name: "an objective id that another unit's plan uses",
      earlier: { unit: "vectors", plan: VECTORS_PLAN },
      unit: "eigen",
      plan: {
        objectives: [
          { id: "eigenvector", statement: "Check an eigenvector." },
          { id: "basis-image", statement: "Find the eigenvalues." },
        ],
        segments: [
          { title: "Stretching", objectives: ["eigenvector", "basis-image"] },
        ],
      },
      message:
        /"basis-image" is the id of an objective in both "vectors" and "eigen"/,
    },
  ])(
    "refused for $name, and nothing changes",
    async ({ approve, earlier, unit, plan, message }) => {
      const root = openDataRoot({ path: dir });
      const id = await courseWithCurriculum(root, approve);
      if (earlier) await root.storePlan(id, earlier.unit, earlier.plan);
      const before = (await root.readCourse(id))?.curriculum;

      await expect(root.storePlan(id, unit, plan)).rejects.toThrow(message);

      expect((await root.readCourse(id))?.curriculum).toEqual(before);
    },
  );

  test("plans for two units stored together both land", async () => {
    const root = openDataRoot({ path: dir });
    const id = await courseWithCurriculum(root);

    await Promise.all([
      root.storePlan(id, "vectors", VECTORS_PLAN),
      root.storePlan(id, "eigen", EIGEN_PLAN),
    ]);

    const units = (await root.readCourse(id))?.curriculum?.units;
    expect(units?.map((u) => u.plan)).toEqual([VECTORS_PLAN, EIGEN_PLAN]);
  });
});

/** A position mid-check, with a question open whose prompt has this length. */
function inCheck(promptLength = 60): UnitPosition {
  return {
    segment: 0,
    phase: "check",
    checkFrom: 0,
    openQuestion: {
      id: "q1",
      number: 1,
      objective: "eigenvector",
      postedAt: "2026-11-15T10:12:00.000Z",
      question: {
        kind: "choice",
        prompt: "x".repeat(promptLength),
        choices: ["Yes", "No"],
        answer: "A",
      },
    },
  };
}

const DISCUSSING: UnitPosition = {
  segment: 1,
  phase: "discuss",
  tutorSessionId: "5d0c2c4e-8a51-4f7e-9a7e-2f1b6c1e0a93",
};

describe("state", () => {
  test("a course with no unit in progress has an empty state", async () => {
    const root = openDataRoot({ path: dir });
    const id = await courseWithCurriculum(root);

    expect(await root.readState(id)).toEqual({ units: {} });
  });

  test("a position is written to state.json and reads back after a restart; null takes the unit out", async () => {
    const root = openDataRoot({ path: dir });
    const id = await courseWithCurriculum(root);

    await root.writePosition(id, "eigen", inCheck());
    await root.writePosition(id, "vectors", DISCUSSING);

    const after = openDataRoot({ path: dir });
    expect(await after.readState(id)).toEqual({
      units: { eigen: inCheck(), vectors: DISCUSSING },
    });
    expect(
      JSON.parse(
        await readFile(join(dir, "courses", id, "state.json"), "utf8"),
      ),
    ).toEqual({ units: { eigen: inCheck(), vectors: DISCUSSING } });

    await after.writePosition(id, "eigen", null);

    expect(await after.readState(id)).toEqual({
      units: { vectors: DISCUSSING },
    });
  });

  test("two writes for one unit issued together land in the order issued", async () => {
    const root = openDataRoot({ path: dir });
    const id = await courseWithCurriculum(root);

    // The first write is large and the second small, so without waiting
    // for each other the second would finish first and be overwritten.
    await Promise.all([
      root.writePosition(id, "eigen", inCheck(4_000_000)),
      root.writePosition(id, "eigen", DISCUSSING),
    ]);

    expect(await openDataRoot({ path: dir }).readState(id)).toEqual({
      units: { eigen: DISCUSSING },
    });
  });

  test("writes for two units issued together keep both", async () => {
    const root = openDataRoot({ path: dir });
    const id = await courseWithCurriculum(root);

    await Promise.all([
      root.writePosition(id, "eigen", inCheck()),
      root.writePosition(id, "vectors", DISCUSSING),
    ]);

    expect(await root.readState(id)).toEqual({
      units: { eigen: inCheck(), vectors: DISCUSSING },
    });
  });

  test("a position that fails its schema is refused and changes nothing", async () => {
    const root = openDataRoot({ path: dir });
    const id = await courseWithCurriculum(root);
    await root.writePosition(id, "vectors", DISCUSSING);

    await expect(
      root.writePosition(id, "eigen", {
        ...inCheck(),
        phase: "teach",
        checkFrom: undefined,
      }),
    ).rejects.toThrow(/only in the check/);

    expect(await root.readState(id)).toEqual({
      units: { vectors: DISCUSSING },
    });
  });
});

/** An answer to question `q<n>`, recorded at minute n past ten. */
function answer(n: number, promptLength = 40): AnswerEvidence {
  return {
    kind: "answer",
    recordedAt: `2026-11-15T10:${String(n).padStart(2, "0")}:00.000Z`,
    objective: "eigenvector",
    question: {
      kind: "choice",
      prompt: "y".repeat(promptLength),
      choices: ["Yes", "No"],
      answer: "A",
    },
    answer: {
      kind: "choice",
      questionId: `q${n}`,
      choice: "A",
      confidence: "75",
    },
    assisted: false,
    verdict: "correct",
  };
}

const OVERRIDE: EvidenceEntry = {
  kind: "override",
  recordedAt: "2026-11-15T10:30:00.000Z",
  objectives: ["eigenvalues"],
};

/** An entry as one line of evidence.jsonl. */
const line = (entry: EvidenceEntry) => `${JSON.stringify(entry)}\n`;

describe("evidence", () => {
  test("a course with no evidence has an empty log", async () => {
    const root = openDataRoot({ path: dir });
    const id = await courseWithCurriculum(root);

    expect(await root.readEvidence(id)).toEqual([]);
  });

  // That appends wait for each other is file-lock.test.ts's to show: here
  // the thread pool keeps them in order even without the lock.
  test("entries appended together land one per line and read back after a restart", async () => {
    const root = openDataRoot({ path: dir });
    const id = await courseWithCurriculum(root);

    await Promise.all([
      root.appendEvidence(id, answer(1)),
      root.appendEvidence(id, answer(2)),
      root.appendEvidence(id, OVERRIDE),
    ]);

    const expected = [answer(1), answer(2), OVERRIDE];
    expect(await openDataRoot({ path: dir }).readEvidence(id)).toEqual(
      expected,
    );
    expect(
      await readFile(join(dir, "courses", id, "evidence.jsonl"), "utf8"),
    ).toBe(expected.map(line).join(""));
  });

  // What a crash partway through an append leaves: the whole lines before
  // it, then the start of the line it was writing. An entry counts once its
  // line ends, so a cut line is skipped when reading and cleared before the
  // next append, which would otherwise be glued onto it.
  test.each([
    {
      name: "a cut line after whole entries",
      whole: [answer(1), OVERRIDE],
      cut: line(answer(3)).slice(0, 50),
    },
    {
      name: "a cut line longer than one read",
      whole: [answer(1)],
      cut: line(answer(3, 20_000)).slice(0, 15_000),
    },
    {
      name: "a log that is only a cut line",
      whole: [],
      cut: line(answer(3)).slice(0, 50),
    },
    {
      name: "a whole entry that lacks only its newline",
      whole: [answer(1)],
      cut: line(answer(3)).slice(0, -1),
    },
  ])(
    "$name: reading skips it, and the next entry is appended whole",
    async ({ whole, cut }) => {
      const root = openDataRoot({ path: dir });
      const id = await courseWithCurriculum(root);
      const log = join(dir, "courses", id, "evidence.jsonl");
      await writeFile(log, whole.map(line).join("") + cut);

      expect(await openDataRoot({ path: dir }).readEvidence(id)).toEqual(whole);

      await root.appendEvidence(id, answer(4));

      expect(await root.readEvidence(id)).toEqual([...whole, answer(4)]);
      expect(await readFile(log, "utf8")).toBe(
        [...whole, answer(4)].map(line).join(""),
      );
    },
  );

  // A write may store fewer bytes than it was given, and says how many. The
  // rest must be written before the append returns, or an entry the engine
  // takes as recorded would read back as a cut line, and the next append
  // would clear it.
  test("an entry the file system takes only part of at a time is still appended whole", async () => {
    const root = openDataRoot({ path: dir });
    const id = await courseWithCurriculum(root);
    const any = await open(join(dir, "courses", id, "course.json"), "r");
    const prototype: FileHandle = Object.getPrototypeOf(any);
    await any.close();
    const write = prototype.write;
    // Every write stores the first half of what it is given.
    const halves = vi.spyOn(prototype, "write").mockImplementation(function (
      this: FileHandle,
      data: string | Uint8Array,
      offset?: number | null,
      length?: number | null,
    ) {
      const bytes = typeof data === "string" ? Buffer.from(data) : data;
      const start = typeof data === "string" ? 0 : (offset ?? 0);
      const asked = length ?? bytes.byteLength - start;
      return Reflect.apply(write, this, [bytes, start, Math.ceil(asked / 2)]);
    } as typeof write);

    try {
      await root.appendEvidence(id, answer(1));
      await root.appendEvidence(id, answer(2));
      expect(halves.mock.calls.length).toBeGreaterThan(2);
    } finally {
      halves.mockRestore();
    }

    const expected = [answer(1), answer(2)];
    expect(await openDataRoot({ path: dir }).readEvidence(id)).toEqual(
      expected,
    );
    expect(
      await readFile(join(dir, "courses", id, "evidence.jsonl"), "utf8"),
    ).toBe(expected.map(line).join(""));
  });

  test("a damaged line before the last is an error that names the file and line", async () => {
    const root = openDataRoot({ path: dir });
    const id = await courseWithCurriculum(root);
    await writeFile(
      join(dir, "courses", id, "evidence.jsonl"),
      `${line(answer(1))}{"kind": "answer"}\n${line(answer(2))}`,
    );

    await expect(root.readEvidence(id)).rejects.toThrow(
      /linear-algebra\/evidence\.jsonl, line 2/,
    );
  });

  test("an entry that fails its schema is refused and not appended", async () => {
    const root = openDataRoot({ path: dir });
    const id = await courseWithCurriculum(root);

    await expect(
      root.appendEvidence(id, { ...answer(1), verdict: "unknown" }),
    ).rejects.toThrow(/I don't know/);

    expect(await root.readEvidence(id)).toEqual([]);
  });
});

describe("disputes", () => {
  const dispute = (questionId: string, reason: string) => ({
    kind: "dispute" as const,
    recordedAt: "2026-11-17T10:00:00.000Z",
    questionId,
    reason,
    outcome: { verdict: "incorrect" as const, reason: "By hand." },
  });

  test("two disputes of one answer sent together: one lands with its override, the other is refused and nothing of it is written", async () => {
    const root = openDataRoot({ path: dir });
    const id = await courseWithCurriculum(root);
    await root.appendEvidence(id, answer(1));
    const override: EvidenceEntry = {
      kind: "override",
      recordedAt: "2026-11-17T10:00:00.000Z",
      objectives: ["eigenvector"],
    };

    const results = await Promise.allSettled([
      root.appendDispute(id, dispute("q1", "First."), override),
      root.appendDispute(id, dispute("q1", "Second.")),
    ]);

    expect(results[0]?.status).toBe("fulfilled");
    expect(results[1]).toMatchObject({
      status: "rejected",
      reason: { name: "DisputeRefused", status: 409 },
    });
    expect(await openDataRoot({ path: dir }).readEvidence(id)).toEqual([
      answer(1),
      dispute("q1", "First."),
      override,
    ]);
  });

  test('a dispute of an answer the log does not have, or of an "I don\'t know", is refused', async () => {
    const root = openDataRoot({ path: dir });
    const id = await courseWithCurriculum(root);
    await root.appendEvidence(id, {
      ...answer(2),
      answer: { kind: "unknown", questionId: "q2" },
      verdict: "unknown",
    });

    await expect(
      root.appendDispute(id, dispute("q9", "Wrong.")),
    ).rejects.toMatchObject({
      name: "DisputeRefused",
      status: 404,
    });
    await expect(
      root.appendDispute(id, dispute("q2", "Wrong.")),
    ).rejects.toMatchObject({
      name: "DisputeRefused",
      status: 409,
    });
    // A blank reason fails its schema.
    await expect(root.appendDispute(id, dispute("q2", "  "))).rejects.toThrow();
    expect((await root.readEvidence(id)).map((e) => e.kind)).toEqual([
      "answer",
    ]);
  });
});

describe("transcripts", () => {
  const begun = (startedAt: string): PageEvent => ({
    type: "session",
    startedAt,
  });
  const said = (text: string): PageEvent => ({ type: "learner", text });
  const sessions = (id: string) => join(dir, "courses", id, "sessions");

  test("a unit with no sessions has no transcripts", async () => {
    const root = openDataRoot({ path: dir });
    const id = await courseWithCurriculum(root);

    expect(await root.readTranscripts(id, "eigen")).toEqual([]);
  });

  test("a unit's transcripts read back after a restart in the order of their numbers, and not another unit's", async () => {
    const root = openDataRoot({ path: dir });
    const id = await courseWithCurriculum(root);
    // Out of order, and 10 after 2, as a name sorted as text would not put it.
    await root.appendTranscript(id, "eigen", 10, [
      begun("2026-11-17T09:00:00.000Z"),
      said("Third sitting."),
    ]);
    await root.appendTranscript(id, "eigen", 1, [
      begun("2026-11-15T09:00:00.000Z"),
    ]);
    await root.appendTranscript(id, "eigen", 1, [said("First sitting.")]);
    await root.appendTranscript(id, "eigen", 2, [
      begun("2026-11-16T09:00:00.000Z"),
    ]);
    // Another unit whose id starts with this one's, and a file of no session.
    await root.appendTranscript(id, "eigen-values", 1, [said("Elsewhere.")]);
    await writeFile(join(sessions(id), "eigen.notes.jsonl"), "");

    expect(
      await openDataRoot({ path: dir }).readTranscripts(id, "eigen"),
    ).toEqual([
      {
        session: 1,
        events: [begun("2026-11-15T09:00:00.000Z"), said("First sitting.")],
        unreadable: [],
      },
      {
        session: 2,
        events: [begun("2026-11-16T09:00:00.000Z")],
        unreadable: [],
      },
      {
        session: 10,
        events: [begun("2026-11-17T09:00:00.000Z"), said("Third sitting.")],
        unreadable: [],
      },
    ]);
    expect(await readFile(join(sessions(id), "eigen.1.jsonl"), "utf8")).toBe(
      `${JSON.stringify(begun("2026-11-15T09:00:00.000Z"))}\n${JSON.stringify(said("First sitting."))}\n`,
    );
  });

  test("a last line a crash cut short is skipped, and a damaged line before it is left out and named, not an error", async () => {
    const root = openDataRoot({ path: dir });
    const id = await courseWithCurriculum(root);
    await mkdir(sessions(id));
    await writeFile(
      join(sessions(id), "eigen.1.jsonl"),
      `${JSON.stringify(said("Kept."))}\n` +
        '{"type": "learner"}\n' +
        "not json\n" +
        `${JSON.stringify(said("Kept too."))}\n` +
        JSON.stringify(said("Cut short.")).slice(0, 20),
    );

    const [transcript] = await root.readTranscripts(id, "eigen");

    expect(transcript?.events).toEqual([said("Kept."), said("Kept too.")]);
    expect(transcript?.unreadable).toEqual([
      expect.stringMatching(
        /sessions\/eigen\.1\.jsonl, line 2 does not match its schema/,
      ),
      expect.stringMatching(
        /sessions\/eigen\.1\.jsonl, line 3 is not valid JSON/,
      ),
    ]);
  });

  test("an event that fails its schema is refused and not appended", async () => {
    const root = openDataRoot({ path: dir });
    const id = await courseWithCurriculum(root);

    await expect(
      root.appendTranscript(id, "eigen", 1, [
        { type: "session", startedAt: "yesterday" },
      ]),
    ).rejects.toThrow(/startedAt/);
    await expect(
      root.appendTranscript(id, "eigen", 0, [said("Hello.")]),
    ).rejects.toThrow();

    expect(await root.readTranscripts(id, "eigen")).toEqual([]);
  });
});

test.each(["no-such-course", "../linear-algebra"])(
  "plans, state, evidence, opening, notes and transcripts of the course %j are refused",
  async (missing) => {
    const root = openDataRoot({ path: dir });
    await courseWithCurriculum(root);

    await expect(root.storePlan(missing, "eigen", EIGEN_PLAN)).rejects.toThrow(
      /no course/,
    );
    await expect(root.readState(missing)).rejects.toThrow(/no course/);
    await expect(
      root.writePosition(missing, "eigen", DISCUSSING),
    ).rejects.toThrow(/no course/);
    await expect(root.readEvidence(missing)).rejects.toThrow(/no course/);
    await expect(root.appendEvidence(missing, OVERRIDE)).rejects.toThrow(
      /no course/,
    );
    await expect(root.markOpened(missing)).rejects.toThrow(/no course/);
    await expect(root.readStyle(missing)).rejects.toThrow(/no course/);
    await expect(root.readBackground(missing)).rejects.toThrow(/no course/);
    await expect(
      root.appendTranscript(missing, "eigen", 1, [
        { type: "learner", text: "Hello." },
      ]),
    ).rejects.toThrow(/no course/);
    await expect(root.readTranscripts(missing, "eigen")).rejects.toThrow(
      /no course/,
    );
    await expect(
      root.writeArtifact(missing, { title: "A graph", html: "<p>x</p>" }),
    ).rejects.toThrow(/no course/);
    expect(await root.readArtifact(missing, "1-a-graph.html")).toBeUndefined();
    expect(await readdir(join(dir, "courses"))).toEqual(["linear-algebra"]);
  },
);

describe("artifacts (task 3.6)", () => {
  const GRAPH = "<!doctype html><p>The graph of x²</p>";

  test("each artifact is stored whole as a new file, numbered on from the highest number in the folder, and reads back", async () => {
    const root = openDataRoot({ path: dir });
    const { id } = await root.createCourse({ title: "Linear algebra" });

    expect(
      await root.writeArtifact(id, {
        title: "The slope of sin(x²)",
        html: GRAPH,
      }),
    ).toEqual({ number: 1, file: "1-the-slope-of-sin-x2.html" });
    // A file the folder holds already, which is not one of Gauss's, and one
    // whose number is higher than any written.
    const folder = join(dir, "courses", id, "artifacts");
    await writeFile(join(folder, "notes.txt"), "mine");
    await writeFile(join(folder, "7-kept.html"), "kept");
    expect(
      await root.writeArtifact(id, { title: "??", html: "<p>second</p>" }),
    ).toEqual({ number: 8, file: "8-artifact.html" });

    expect(await root.readArtifact(id, "1-the-slope-of-sin-x2.html")).toBe(
      GRAPH,
    );
    expect(await root.readArtifact(id, "8-artifact.html")).toBe(
      "<p>second</p>",
    );
    expect(await root.readArtifact(id, "7-kept.html")).toBe("kept");
    expect((await readdir(folder)).sort()).toEqual([
      "1-the-slope-of-sin-x2.html",
      "7-kept.html",
      "8-artifact.html",
      "notes.txt",
    ]);
  });

  test("two artifacts stored at once get two numbers", async () => {
    const root = openDataRoot({ path: dir });
    const { id } = await root.createCourse({ title: "Linear algebra" });

    const [first, second] = await Promise.all([
      root.writeArtifact(id, { title: "A", html: "a" }),
      root.writeArtifact(id, { title: "B", html: "b" }),
    ]);

    expect([first.number, second.number].sort()).toEqual([1, 2]);
    expect(first.file).toBe(`${first.number}-a.html`);
    expect(second.file).toBe(`${second.number}-b.html`);
    expect(await root.readArtifact(id, first.file)).toBe("a");
    expect(await root.readArtifact(id, second.file)).toBe("b");
  });

  test("artifact numbering refuses exhaustion instead of reusing an unsafe number", async () => {
    const root = openDataRoot({ path: dir });
    const { id } = await root.createCourse({ title: "Linear algebra" });
    const folder = join(dir, "courses", id, "artifacts");
    await mkdir(folder);
    await writeFile(join(folder, "9007199254740992-kept.html"), "kept");

    await expect(
      root.writeArtifact(id, { title: "New aid", html: "new" }),
    ).rejects.toThrow(/artifact number/i);
    expect(await readdir(folder)).toEqual(["9007199254740992-kept.html"]);
  });

  test.each([
    "2-missing.html",
    "../course.json",
    "1-a.html/../../course.json",
    "0-zero.html",
    "1-A.html",
    "1-a.htm",
    "notes.txt",
  ])("%j is no artifact", async (file) => {
    const root = openDataRoot({ path: dir });
    const { id } = await root.createCourse({ title: "Linear algebra" });
    await root.writeArtifact(id, { title: "A", html: "a" });
    await writeFile(join(dir, "courses", id, "artifacts", "notes.txt"), "x");

    expect(await root.readArtifact(id, file)).toBeUndefined();
  });
});
