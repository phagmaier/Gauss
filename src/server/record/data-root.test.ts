import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  chmod,
  type FileHandle,
  link,
  mkdir,
  mkdtemp,
  open,
  readdir,
  readFile,
  readlink,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative } from "node:path";
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
  const { instance } = created.course;
  expect(instance).toEqual(expect.any(String));

  const expected = {
    id: "calculus-i",
    course: {
      title: "Calculus I",
      backend: "claude",
      settings: { webSearch: false },
      createdAt: "2026-11-15T09:00:00.000Z",
      instance,
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

test("a course made for Codex reads back on Codex after a restart, and a course.json written before Codex existed reads as Claude", async () => {
  const { id } = await openDataRoot({ path: dir }).createCourse({
    title: "Calculus I",
    backend: "codex",
  });
  // As stage 5 wrote it, when Claude was the only backend.
  const older = join(dir, "courses", "older");
  await mkdir(older, { recursive: true });
  await writeFile(
    join(older, "course.json"),
    `{
  "title": "Linear algebra",
  "backend": "claude",
  "settings": { "webSearch": true },
  "createdAt": "2026-11-19T09:00:00.000Z",
  "instance": "0b6f6f53-7a49-4c5e-9d7b-0d9f3b1c2a10",
  "lastOpenedAt": "2026-11-20T09:00:00.000Z"
}
`,
  );

  const restarted = openDataRoot({ path: dir });
  expect((await restarted.readCourse(id))?.course.backend).toBe("codex");
  expect((await restarted.readCourse("older"))?.course).toMatchObject({
    backend: "claude",
    settings: { webSearch: true },
  });
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

test("review is noted as offered once an hour at most: two at once give one, and the next comes an hour after the last", async () => {
  const root = openDataRoot({ path: dir });
  const { id, course } = await root.createCourse({ title: "Calculus I" });
  const at = (minutes: number) =>
    new Date(Date.parse("2026-11-15T09:00:00.000Z") + minutes * 60_000);

  const together = await Promise.all([
    root.markReviewOffered(id, at(0)),
    root.markReviewOffered(id, at(0)),
  ]);
  const within = await root.markReviewOffered(id, at(59));
  const after = await root.markReviewOffered(id, at(60));

  expect(together.toSorted()).toEqual([false, true]);
  expect(within).toBe(false);
  expect(after).toBe(true);
  expect((await openDataRoot({ path: dir }).readCourse(id))?.course).toEqual({
    ...course,
    reviewOfferedAt: at(60).toISOString(),
  });
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
    {
      part: "profile",
      shown: { ...PROPOSAL, profile: "Works as a nurse." },
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
      expect(await root.readProfile()).toBeUndefined();
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

  test.each([false, true])(
    "restart recovers both records after an abrupt exit (profile published: %s)",
    async (published) => {
      const root = openDataRoot({ path: dir });
      const { id } = await root.createCourse({ title: PROPOSAL.title });
      const profileWas = "Prefers proofs.";
      const card = { ...PROPOSAL, profileWas, profile: "Prefers pictures." };
      await root.writeProfile(profileWas, undefined);
      await root.saveProposal(id, card);

      const code = `
        import fs from "node:fs/promises";
        import { syncBuiltinESMExports } from "node:module";
        import { join } from "node:path";
        import { openDataRoot } from ${JSON.stringify(new URL("./data-root.ts", import.meta.url).href)};
        const [dir, id, card, published] = process.argv.slice(1);
        const rename = fs.rename;
        fs.rename = async (from, to) => {
          if (to !== join(dir, "profile.md")) return rename(from, to);
          if (published === "true") await rename(from, to);
          process.exit(73);
        };
        syncBuiltinESMExports();
        await openDataRoot({ path: dir }).approveCurriculum(id, JSON.parse(card));
      `;
      const child = spawn(
        process.execPath,
        [
          "--input-type=module",
          "--eval",
          code,
          dir,
          id,
          JSON.stringify(card),
          String(published),
        ],
        { stdio: ["ignore", "ignore", "inherit"] },
      );
      expect(await once(child, "exit")).toEqual([73, null]);

      // The first course read after restarting must not expose half an approval.
      const after = openDataRoot({ path: dir });
      expect((await after.readCourse(id))?.curriculum?.approval.status).toBe(
        published ? "approved" : "draft",
      );
      expect(await after.readProfile()).toBe(
        published ? card.profile : profileWas,
      );
      if (!published) {
        await after.approveCurriculum(id, card);
        expect(await after.readProfile()).toBe(card.profile);
      }
    },
  );

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

test.each(["before rename", "after rename", "sync failed"])(
  "keeps the published notes and their source together when a rewrite stops: %s",
  async (stop) => {
    const root = openDataRoot({ path: dir });
    const { id } = await root.createCourse({ title: "Notes course" });
    const writtenAt = "2026-11-19T09:00:00.000Z";
    const oldHtml = "<p>Old notes</p>";
    await root.writeNotes(id, "vectors", oldHtml, {
      html: oldHtml,
      instructions: "Old instructions",
      writtenAt,
    });
    const path = join(dir, "courses", id, "notes", "vectors.html");
    const code = `
      import fs from "node:fs/promises";
      import { syncBuiltinESMExports } from "node:module";
      import { dirname } from "node:path";
      import { openDataRoot } from ${JSON.stringify(new URL("./data-root.ts", import.meta.url).href)};
      const [dir, id, path, stop, writtenAt] = process.argv.slice(1);
      const { open, rename } = fs;
      let renamed = false;
      fs.rename = async (from, to) => {
        if (to === path && stop === "before rename") process.exit(73);
        await rename(from, to);
        if (to === path) {
          if (stop === "after rename") process.exit(73);
          renamed = true;
        }
      };
      fs.open = async (pathToOpen, flags, ...args) => {
        if (renamed && pathToOpen === dirname(path) && flags === "r") {
          renamed = false;
          throw new Error("Injected directory sync failure");
        }
        return open(pathToOpen, flags, ...args);
      };
      syncBuiltinESMExports();
      const html = "<p>New notes</p>";
      await openDataRoot({ path: dir }).writeNotes(id, "vectors", html, {
        html, instructions: "New instructions", writtenAt,
      });
    `;
    const child = spawn(
      process.execPath,
      ["--input-type=module", "--eval", code, dir, id, path, stop, writtenAt],
      { stdio: ["ignore", "ignore", "inherit"] },
    );
    const exit = await once(child, "exit");
    const version = stop === "before rename" ? "Old" : "New";
    const after = openDataRoot({ path: dir });
    expect(await after.readNotesHtml(id, "vectors")).toContain(
      `${version} notes`,
    );
    expect((await after.readNotes(id, "vectors"))?.instructions).toBe(
      `${version} instructions`,
    );
    expect(exit).toEqual([stop === "sync failed" ? 0 : 73, null]);
  },
);

// A process that stops while writing a file must not leave it half written.
// A child process rewrites curriculum.json under a file size limit smaller
// than the new version, so the kernel stops the write partway (Node turns
// the limit into an EFBIG error rather than dying of SIGXFSZ). The record is
// then reloaded from disk by a fresh openDataRoot. A writer that wrote the
// file in place would leave the first 512 KB of the new version there. A
// size limit stops the write partway every time; a SIGKILL hit the window
// only 10–20% of the time.
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
});

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

  test('a dispute of an answer the log does not have, or of an "I don\'t know" to a written question, is refused', async () => {
    const root = openDataRoot({ path: dir });
    const id = await courseWithCurriculum(root);
    await root.appendEvidence(id, {
      ...answer(2),
      question: { kind: "written", prompt: "Why?", rubric: "Because." },
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

  test("a code question's files are read in the course's workspace as it is now, from a root that has moved, and the transcript on disk keeps what was written", async () => {
    const root = openDataRoot({ path: dir });
    const id = await courseWithCurriculum(root);
    const workspace = join(dir, "courses", id, "workspace");
    // The workspace where the data root was when the question was posted.
    const old = `/media/old-disk/gauss/courses/${id}/workspace`;
    const code = (files: string[]): PageEvent => ({
      type: "question",
      question: { kind: "code", id: "q1", number: 1, prompt: "Edit.", files },
    });
    const choice: PageEvent = {
      type: "question",
      question: {
        kind: "choice",
        id: "q2",
        number: 2,
        prompt: `Which is ${old}/bpe.py?`,
        choices: [`${old}/bpe.py`, "Neither"],
      },
    };
    const stored = code([
      join(workspace, "bpe.py"),
      `${old}/lib/bpe.py`,
      // The old root holds the workspace's folders, but what follows them
      // there is no path in a workspace: only the last split is one.
      `/media/courses/${id}/workspace/My Data/gauss/courses/${id}/workspace/bpe.py`,
      // In no workspace of this course, or no file a question can have.
      "/etc/passwd",
      `/media/old-disk/gauss/courses/other/workspace/bpe.py`,
      `/media/old-disk/gauss/courses/${id}-2/workspace/bpe.py`,
      `${old}/../../../etc/passwd`,
      `${old}/.venv/bin/python`,
      // Two ways to read it: the old root, or the file's own path, holds
      // the workspace's folders again.
      `/media/courses/${id}/workspace/gauss/courses/${id}/workspace/bpe.py`,
    ]);
    await root.appendTranscript(id, "eigen", 1, [stored, choice]);

    const [transcript] = await root.readTranscripts(id, "eigen");

    expect(transcript?.events).toEqual([
      code([
        join(workspace, "bpe.py"),
        join(workspace, "lib", "bpe.py"),
        join(workspace, "bpe.py"),
        "/etc/passwd",
        `/media/old-disk/gauss/courses/other/workspace/bpe.py`,
        `/media/old-disk/gauss/courses/${id}-2/workspace/bpe.py`,
        `${old}/../../../etc/passwd`,
        `${old}/.venv/bin/python`,
        `/media/courses/${id}/workspace/gauss/courses/${id}/workspace/bpe.py`,
      ]),
      choice,
    ]);
    expect(await readFile(join(sessions(id), "eigen.1.jsonl"), "utf8")).toBe(
      `${JSON.stringify(stored)}\n${JSON.stringify(choice)}\n`,
    );
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

describe("handoff notes and misconceptions (task 5.7)", () => {
  const mark = (events: number) => ({
    writtenAt: "2026-11-18T10:00:00.000Z",
    through: { session: 2, events },
  });
  const found = (believed: string) => ({
    recordedAt: "2026-11-18T10:00:00.000Z",
    unit: "eigen",
    objective: "eigenvalue",
    believed,
    actually: "So.",
    where: { in: "discussion" as const },
  });

  test("a unit's note is replaced whole by the next, with how far it reads, and reads back after a restart", async () => {
    const root = openDataRoot({ path: dir });
    const id = await courseWithCurriculum(root);
    expect(await root.readHandoff(id, "eigen")).toBeUndefined();

    await root.writeHandoff(id, "eigen", "First note.", mark(3));
    await root.writeHandoff(id, "eigen", "  Second note.\n", mark(7));

    const folder = join(dir, "courses", id, "units", "eigen");
    expect(await readFile(join(folder, "handoff.md"), "utf8")).toBe(
      "Second note.\n",
    );
    expect(await openDataRoot({ path: dir }).readHandoff(id, "eigen")).toEqual({
      note: "Second note.",
      mark: mark(7),
    });
    expect(await root.readHandoff(id, "vectors")).toBeUndefined();
  });

  test("a note whose mark a crash kept from being written reads with none, so the next call reads the whole thread", async () => {
    const root = openDataRoot({ path: dir });
    const id = await courseWithCurriculum(root);
    const folder = join(dir, "courses", id, "units", "eigen");
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, "handoff.md"), "A note.\n");

    expect(await root.readHandoff(id, "eigen")).toEqual({
      note: "A note.",
      mark: undefined,
    });
  });

  test("misconceptions are appended, read back oldest first, and refused out of shape", async () => {
    const root = openDataRoot({ path: dir });
    const id = await courseWithCurriculum(root);
    expect(await root.readMisconceptions(id)).toEqual([]);

    await root.appendMisconceptions(id, [found("One."), found("Two.")]);
    await root.appendMisconceptions(id, []);
    await root.appendMisconceptions(id, [found("Three.")]);

    expect(
      (await openDataRoot({ path: dir }).readMisconceptions(id)).map(
        (m) => m.believed,
      ),
    ).toEqual(["One.", "Two.", "Three."]);
    await expect(root.appendMisconceptions(id, [found("")])).rejects.toThrow();
    expect(await root.readMisconceptions(id)).toHaveLength(3);
  });
});

describe("sources (stage 4)", () => {
  const INTAKE = "0f8fad5b-d9cb-469f-a165-70867728950e";

  /** A folder as convert.py writes it for a source of this title, named "source" as the engine's scratch is. */
  async function converted(title: string): Promise<string> {
    const folder = join(
      dir,
      "uploads",
      INTAKE,
      `.${Math.random().toString(36).slice(2)}.tmp`,
      "source",
    );
    await mkdir(join(folder, "sections"), { recursive: true });
    await writeFile(join(folder, "sections", "s1.md"), `# ${title}\n`);
    await writeFile(
      join(folder, "outline.json"),
      JSON.stringify({
        id: "source",
        title,
        file: "original.md",
        name: "notes.md",
        format: "markdown",
        sha256: "a".repeat(64),
        converter: 5,
        limit: 20_000,
        entries: [
          {
            id: "s1",
            title,
            size: title.length + 3,
            place: { paragraphs: { first: 1, last: 1 } },
          },
        ],
      }),
    );
    return folder;
  }

  test("a converted folder is put in place under a slug of its title, unique where it goes, which its outline then names", async () => {
    const root = openDataRoot({ path: dir });
    const { id: course } = await root.createCourse({ title: "Hegel" });

    const copies = await Promise.all([
      converted("Die Phänomenologie"),
      converted("Die Phänomenologie"),
    ]);
    const placed = await Promise.all(
      copies.map((folder) => root.placeSource(folder, { course })),
    );
    const waiting = await root.placeSource(
      await converted("Die Phänomenologie"),
      {
        intake: INTAKE,
      },
    );

    expect(placed.map((outline) => outline.id).sort()).toEqual([
      "die-phanomenologie",
      "die-phanomenologie-2",
    ]);
    expect(waiting.id).toBe("die-phanomenologie");
    // Read back by id, each outline naming its own folder.
    expect((await root.readSources(course)).map((o) => o.id)).toEqual([
      "die-phanomenologie",
      "die-phanomenologie-2",
    ]);
    expect(
      JSON.parse(
        await readFile(
          join(dir, "uploads", INTAKE, "die-phanomenologie", "outline.json"),
          "utf8",
        ),
      ).id,
    ).toBe("die-phanomenologie");
  });

  test("a process that stops during its outline rewrite leaves no published source", async () => {
    const root = openDataRoot({ path: dir });
    const { id: course } = await root.createCourse({ title: "Hegel" });
    const folder = await converted("Preface");
    const code = `
      import fs from "node:fs/promises";
      import { syncBuiltinESMExports } from "node:module";
      import { join } from "node:path";
      import { openDataRoot } from ${JSON.stringify(new URL("./data-root.ts", import.meta.url).href)};
      const [dir, folder, course] = process.argv.slice(1);
      const rename = fs.rename;
      fs.rename = (from, to) => {
        if (to === join(folder, "outline.json")) process.exit(73);
        return rename(from, to);
      };
      syncBuiltinESMExports();
      await openDataRoot({ path: dir }).placeSource(folder, { course });
    `;
    const child = spawn(
      process.execPath,
      ["--input-type=module", "--eval", code, dir, folder, course],
      { stdio: ["ignore", "ignore", "inherit"] },
    );
    expect(await once(child, "exit")).toEqual([73, null]);

    expect(await openDataRoot({ path: dir }).readSources(course)).toEqual([]);
  });

  test("an empty destination keeps its slug and is never overwritten by an upload", async () => {
    const root = openDataRoot({ path: dir });
    const { id: course } = await root.createCourse({ title: "Hegel" });
    const reserved = join(dir, "courses", course, "sources", "preface");
    await mkdir(reserved, { recursive: true });
    await root.placeSource(await converted("Preface"), { intake: INTAKE });

    await expect(root.moveUpload(INTAKE, "preface", course)).rejects.toThrow(
      reserved,
    );
    expect(await readdir(reserved)).toEqual([]);
    expect(await readdir(join(dir, "uploads", INTAKE, "preface"))).toContain(
      "outline.json",
    );
    const placed = await root.placeSource(await converted("Preface"), {
      course,
    });
    expect(placed.id).toBe("preface-2");
    expect(await readdir(reserved)).toEqual([]);
  });

  test("an upload moves into the course under its id, and one removed is gone", async () => {
    const root = openDataRoot({ path: dir });
    const { id: course } = await root.createCourse({ title: "Hegel" });
    await root.placeSource(await converted("Preface"), { intake: INTAKE });
    await root.placeSource(await converted("Introduction"), { intake: INTAKE });

    await root.moveUpload(INTAKE, "preface", course);
    await root.removeUpload(INTAKE, "introduction");

    expect((await root.readSources(course)).map((o) => o.id)).toEqual([
      "preface",
    ]);
    // The scratch folders the converter wrote in are hidden; no source is left.
    const left = await readdir(join(dir, "uploads", INTAKE));
    expect(left.filter((name) => !name.startsWith("."))).toEqual([]);
  });

  test("a course with no source reads none, and a source whose outline names another folder is an error naming the file", async () => {
    const root = openDataRoot({ path: dir });
    const { id: course } = await root.createCourse({ title: "Hegel" });
    expect(await root.readSources(course)).toEqual([]);

    await root.placeSource(await converted("Preface"), { course });
    const file = join(
      dir,
      "courses",
      course,
      "sources",
      "preface",
      "outline.json",
    );
    const outline = JSON.parse(await readFile(file, "utf8"));
    await writeFile(file, JSON.stringify({ ...outline, id: "elsewhere" }));

    await expect(root.readSources(course)).rejects.toThrow(
      `${file} names the source "elsewhere", not its folder's "preface".`,
    );
  });

  test("the start's clean-up removes every intake's uploads, and nothing of the courses", async () => {
    const root = openDataRoot({ path: dir });
    const { id: course } = await root.createCourse({ title: "Hegel" });
    await root.placeSource(await converted("Preface"), { course });
    await root.placeSource(await converted("Introduction"), { intake: INTAKE });

    await root.clearUploads();

    expect(await readdir(dir)).toEqual(["courses"]);
    expect((await root.readSources(course)).map((o) => o.id)).toEqual([
      "preface",
    ]);
    await expect(root.uploadsFolder("../courses")).rejects.toThrow(
      "cannot be an intake's id",
    );
  });
});

describe("what interrupted writes left, cleared at start", () => {
  /** A UUID as randomUUID writes it, as in a temporary file's name. */
  const UUID = "3f2b8c1e-9d4a-4e6b-8a1f-5c7d2e9b0a64";
  /** The name writeFileAtomic gives the temporary file of a write of `name`. */
  const leftover = (name: string) => `.${name}.${UUID}.tmp`;

  /** Every entry under the folder by its path there: a file's text, a folder, or a link's target. */
  async function tree(folder: string): Promise<Map<string, string>> {
    const found = new Map<string, string>();
    const entries = await readdir(folder, {
      withFileTypes: true,
      recursive: true,
    });
    for (const entry of entries) {
      const path = join(entry.parentPath, entry.name);
      found.set(
        relative(folder, path),
        entry.isDirectory()
          ? "(folder)"
          : entry.isSymbolicLink()
            ? `(link to ${await readlink(path)})`
            : await readFile(path, "utf8"),
      );
    }
    return found;
  }

  async function put(path: string, contents = "partly written") {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, contents);
  }

  /** A course with a curriculum, a position, a unit's handoff, notes and an aid, and a profile. */
  async function wholeRecord(root: DataRoot) {
    const id = await courseWithCurriculum(root);
    await root.writePosition(id, "eigen", DISCUSSING);
    await root.writeHandoff(id, "eigen", "A note.", {
      writtenAt: "2026-11-18T10:00:00.000Z",
      through: { session: 1, events: 4 },
    });
    await root.writeNotes(id, "eigen", "<p>Notes</p>", {
      html: "<p>Notes</p>",
      instructions: "Short.",
      writtenAt: "2026-11-19T09:00:00.000Z",
    });
    const { file } = await root.writeArtifact(id, {
      title: "A graph",
      html: "<p>graph</p>",
    });
    await root.writeProfile("Knows calculus.", undefined);
    const course = join(dir, "courses", id);
    return {
      id,
      course,
      unit: join(course, "units", "eigen"),
      artifact: join(course, "artifacts", file),
    };
  }

  test("start removes the temporary files of interrupted record writes, and nothing else", async () => {
    const { course, unit, artifact } = await wholeRecord(
      openDataRoot({ path: dir }),
    );
    const leftovers = [
      join(dir, leftover("profile.md")),
      join(dir, leftover(".notes-write.json")),
      join(course, leftover("course.json")),
      join(course, leftover("state.json")),
      join(course, leftover(".first-proposal-instance.tmp")),
      join(unit, leftover("handoff.md")),
      join(unit, leftover("handoff.json")),
      join(course, "notes", leftover("eigen.html")),
    ];
    for (const path of leftovers) await put(path);
    // writeFileNew stopped after linking the aid's name, before removing
    // its temporary file: two names of one file.
    const linked = join(dirname(artifact), leftover(basename(artifact)));
    await link(artifact, linked);
    leftovers.push(linked);

    // Named like a temporary file, or like a journal or reservation, but
    // not a record write's leftover in a folder the record writes in.
    const learnerFile = join(course, "workspace", leftover("bpe.py"));
    for (const path of [
      join(course, ".first-proposal-instance.tmp"),
      join(course, ".package-install.tmp", "running", "receipt.json"),
      join(course, ".package-install.tmp", "running", leftover("receipt.json")),
      join(dir, "courses", leftover("calculus-i"), "course.json"),
      join(
        dir,
        "uploads",
        "0f8fad5b-d9cb-469f-a165-70867728950e",
        ".9b2c4d6e-1f3a-4b5c-8d7e-0a1b2c3d4e5f.tmp",
        "original",
        "notes.md",
      ),
      join(dir, "uploads", `.seed-${UUID}.tmp`, "source", "outline.json"),
      learnerFile,
      join(course, "workspace", ".venv", leftover("pyvenv.cfg")),
      join(course, "packages", leftover("uv.lock")),
      join(course, "sources", "preface", leftover("outline.json")),
      join(dir, "intake", leftover("plan.md")),
      join(course, leftover("curriculum.json"), "inside.txt"),
      join(course, ".state.json.tmp"),
      join(unit, ".handoff.md.swp"),
    ]) {
      await put(path);
    }
    await symlink(learnerFile, join(course, leftover("style.md")));
    const before = await tree(dir);
    const logged: string[] = [];

    await openDataRoot({ path: dir }).clearInterruptedWrites((line) =>
      logged.push(line),
    );

    const expected = new Map(before);
    for (const path of leftovers) {
      expect(expected.delete(relative(dir, path))).toBe(true);
    }
    expect(await tree(dir)).toEqual(expected);
    expect(logged).toEqual([]);
  });

  test("a write stopped before its rename leaves a file start removes, and the file it was replacing stays", async () => {
    const { id, course } = await wholeRecord(openDataRoot({ path: dir }));
    const state = await readFile(join(course, "state.json"), "utf8");
    const code = `
      import fs from "node:fs/promises";
      import { syncBuiltinESMExports } from "node:module";
      import { openDataRoot } from ${JSON.stringify(new URL("./data-root.ts", import.meta.url).href)};
      const [dir, id] = process.argv.slice(1);
      const { rename } = fs;
      fs.rename = async (from, to) => {
        if (to.endsWith("state.json")) process.exit(73);
        await rename(from, to);
      };
      syncBuiltinESMExports();
      await openDataRoot({ path: dir }).writePosition(id, "eigen", null);
    `;
    const child = spawn(
      process.execPath,
      ["--input-type=module", "--eval", code, dir, id],
      { stdio: ["ignore", "ignore", "inherit"] },
    );
    expect(await once(child, "exit")).toEqual([73, null]);
    const names = async () =>
      (await readdir(course)).filter((name) => name.startsWith(".state.json"));
    expect(await names()).toHaveLength(1);

    await openDataRoot({ path: dir }).clearInterruptedWrites(() => {});

    expect(await names()).toEqual([]);
    expect(await readFile(join(course, "state.json"), "utf8")).toBe(state);
  });

  test.skipIf(process.getuid?.() === 0)(
    "a folder it cannot read and a file it cannot remove are logged and left, and the rest is still removed",
    async () => {
      const { course, unit, artifact } = await wholeRecord(
        openDataRoot({ path: dir }),
      );
      // The course folder is scanned before notes/, notes/ before
      // artifacts/ and the units' folders, so both failures come before
      // files that must still go.
      const notes = join(course, "notes");
      const held = join(course, leftover("state.json"));
      const removable = [
        join(dir, leftover("profile.md")),
        join(dirname(artifact), leftover(basename(artifact))),
        join(unit, leftover("handoff.md")),
      ];
      for (const path of [held, ...removable]) await put(path);
      await chmod(course, 0o555);
      await chmod(notes, 0o000);
      const logged: string[] = [];
      try {
        await openDataRoot({ path: dir }).clearInterruptedWrites((line) =>
          logged.push(line),
        );
      } finally {
        await chmod(notes, 0o755);
        await chmod(course, 0o755);
      }

      expect(logged).toEqual([
        expect.stringContaining(
          `Could not remove ${held}, left by an interrupted write: EACCES`,
        ),
        expect.stringContaining(
          `Could not look for interrupted writes in ${notes}: EACCES`,
        ),
      ]);
      const left = await tree(dir);
      expect(left.has(relative(dir, held))).toBe(true);
      for (const path of removable) {
        expect(left.has(relative(dir, path))).toBe(false);
      }
    },
  );
});
