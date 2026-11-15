import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { Curriculum } from "../../shared/curriculum.ts";
import { openDataRoot, resolveDataRoot } from "./data-root.ts";

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
};

describe("proposals and approval", () => {
  test("a proposal is stored as the draft curriculum, and its title as the course's", async () => {
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
  });

  test("approval stamps the draft with the clock's time, and then no draft can replace it", async () => {
    const root = openDataRoot({
      path: dir,
      now: clock("2026-11-15T09:00:00.000Z", "2026-11-15T10:30:00.000Z"),
    });
    const { id } = await root.createCourse({ title: "Linear algebra" });
    await root.saveProposal(id, PROPOSAL);

    const approved = await root.approveCurriculum(id);

    const curriculum = {
      approval: { status: "approved", approvedAt: "2026-11-15T10:30:00.000Z" },
      units: PROPOSAL.units,
    };
    expect(approved.curriculum).toEqual(curriculum);
    await expect(root.saveProposal(id, PROPOSAL)).rejects.toThrow(/approved/);
    await expect(root.approveCurriculum(id)).rejects.toThrow(
      /already approved/,
    );
    expect((await root.readCourse(id))?.curriculum).toEqual(curriculum);
  });

  test("approval needs a course with a draft", async () => {
    const root = openDataRoot({ path: dir });
    const { id } = await root.createCourse({ title: "Linear algebra" });

    await expect(root.approveCurriculum(id)).rejects.toThrow(/no curriculum/);
    await expect(root.approveCurriculum("no-such-course")).rejects.toThrow(
      /no course/,
    );
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
