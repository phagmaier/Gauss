import { spawn } from "node:child_process";
import { once } from "node:events";
import type * as FsPromises from "node:fs/promises";
import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  readlink,
  rename,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, vi } from "vitest";
import { openDataRoot } from "./record/data-root.ts";

vi.mock(import("node:fs/promises"), async (original) => {
  const fs = await original();
  return { ...fs, rename: vi.fn(fs.rename), unlink: vi.fn(fs.unlink) };
});

const script = fileURLToPath(
  new URL("../../scripts/dev-fake.ts", import.meta.url),
);

function start(root: string, port = 0, args = ["--empty"]) {
  const child = spawn(process.execPath, [script, ...args], {
    env: {
      ...process.env,
      GAUSS_BACKUP: "off",
      GAUSS_DATA_ROOT: root,
      GAUSS_PORT: String(port),
    },
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const listening = Promise.withResolvers<{ port: number }>();
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
    stdout += chunk;
    const match = /Gauss is running at http:\/\/localhost:(\d+)\//.exec(stdout);
    if (match) listening.resolve({ port: Number(match[1]) });
  });
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
    stderr += chunk;
  });
  const exited = once(child, "close").then(([code, signal]) => ({
    code,
    signal,
    stdout,
    stderr,
  }));
  return {
    child,
    exited,
    startup: () => Promise.race([listening.promise, exited]),
  };
}

async function listening(server: ReturnType<typeof start>): Promise<number> {
  const result = await server.startup();
  if (!("port" in result)) {
    throw new Error(
      `Fake server exited before listening (${result.code ?? result.signal}):\n${result.stdout}${result.stderr}`,
    );
  }
  return result.port;
}

test("fake servers keep a data root exclusive until their process exits", async ({
  onTestFinished,
  signal,
}) => {
  const dir = await mkdtemp(join(tmpdir(), "gauss-serve-lock-"));
  const servers: ReturnType<typeof start>[] = [];
  onTestFinished(async () => {
    // A hard stop can leave the sandbox's bridge running in the group.
    for (const { child } of servers) {
      if (child.pid === undefined) continue;
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch (error) {
        if (
          !(error instanceof Error && "code" in error && error.code === "ESRCH")
        ) {
          throw error;
        }
      }
    }
    await Promise.allSettled(servers.map(({ exited }) => exited));
    await rm(dir, { recursive: true, force: true });
  });

  function launch(...args: Parameters<typeof start>) {
    signal.throwIfAborted();
    const server = start(...args);
    servers.push(server);
    return server;
  }

  const root = join(dir, "active");
  await mkdir(root);
  const alias = join(dir, "alias");
  await symlink(root, alias, "dir");
  const active = launch(alias);
  const port = await listening(active);
  const uploads = join(root, "uploads");
  const upload = join(uploads, "staged-source.md");
  const temporary = join(
    root,
    ".profile.md.12345678-1234-1234-1234-123456789abc.tmp",
  );
  await mkdir(uploads);
  await writeFile(upload, "staged source");
  await writeFile(temporary, "write in progress");

  const courses = join(root, "courses");
  const course = join(courses, "calculus");
  const sources = join(course, "sources");
  const source = join(sources, "textbook");
  const pages = join(source, "pages");
  const outsideCourses = join(dir, "outside-courses");
  const outsideCourse = join(outsideCourses, "calculus");
  const outsideSources = join(outsideCourse, "sources");
  const outsideSource = join(outsideSources, "textbook");
  const outsidePages = join(outsideSource, "pages");
  const preserved = [
    join(pages, "1.png"),
    join(pages, ".render-a1b2c3"),
    join(pages, ".render-notes", "notes.txt"),
    join(source, "original.pdf"),
    join(course, "workspace", "pages", ".render-a1b2c3", "page.png"),
    join(
      courses,
      ".calculus.12345678-1234-1234-1234-123456789abc.tmp",
      "sources",
      "textbook",
      "pages",
      ".render-a1b2c3",
      "page.png",
    ),
    join(outsidePages, ".render-a1b2c3", "page.png"),
  ];
  for (const path of preserved) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, path);
  }
  const otherRoot = join(dir, "independent");
  const links = [
    [join(otherRoot, "courses"), outsideCourses],
    [join(courses, "external-course"), outsideCourse],
    [join(courses, "linked-course", "sources"), outsideSources],
    [join(sources, "external-source"), outsideSource],
    [join(sources, "linked-book", "pages"), outsidePages],
    [join(pages, ".render-d4e5f6"), outsidePages],
  ] as const;
  for (const [link, target] of links) {
    await mkdir(dirname(link), { recursive: true });
    await symlink(target, link, "dir");
  }
  const scratch = await mkdtemp(join(pages, ".render-"));
  const partial = join(scratch, "page.png");
  await writeFile(partial, "unfinished render");

  // The owner is unseeded; this contender would seed it before recovery.
  const refused = launch(root, port === 4330 ? 4331 : 4330, []);
  expect(await refused.startup()).toMatchObject({
    code: 1,
    stderr: expect.stringContaining(
      `Data root "${root}" is already in use by another Gauss server`,
    ),
  });
  expect(await readFile(upload, "utf8")).toBe("staged source");
  expect(await readFile(partial, "utf8")).toBe("unfinished render");
  expect(await readFile(temporary, "utf8")).toBe("write in progress");
  const url = `http://127.0.0.1:${port}`;
  const library = await fetch(`${url}/api/courses`, { signal });
  expect(await library.json()).toEqual({ courses: [] });

  const independent = launch(otherRoot);
  expect(await listening(independent)).not.toBe(port);

  // Retargeting the startup alias must not move the active server's record
  // onto the independent server's root.
  await writeFile(join(root, "profile.md"), "Profile in the locked root");
  await rm(alias);
  await symlink(otherRoot, alias, "dir");
  const profile = await fetch(`${url}/api/profile`, { signal });
  expect(await profile.json()).toMatchObject({
    text: "Profile in the locked root",
  });

  active.child.kill("SIGTERM");
  expect(await active.exited).toMatchObject({ code: 0, signal: null });

  // Startup promotes the journal's staged source before sweeping its cache.
  const record = openDataRoot({ path: root });
  const intakeId = "0f8fad5b-d9cb-469f-a165-70867728950e";
  const stagedPages = join(
    await record.uploadsFolder(intakeId),
    "atlas",
    "pages",
  );
  const stagedScratch = ".render-g7h8i9";
  await mkdir(join(stagedPages, stagedScratch), { recursive: true });
  await writeFile(join(stagedPages, "1.png"), "published atlas page");
  const title = "Geometry";
  const { id } = await record.createCourse({
    title,
    firstProposal: {
      intakeId,
      sources: ["atlas"],
      proposal: {
        title,
        units: [
          {
            id: "angles",
            title: "Angles",
            goal: "Compare angles.",
            prerequisites: [],
          },
        ],
        style: "Use diagrams.",
        background: "The learner knows basic shapes.",
      },
    },
  });

  const restarted = launch(root);
  await listening(restarted);
  await expect(readFile(upload)).rejects.toMatchObject({ code: "ENOENT" });
  await expect(readFile(temporary)).rejects.toMatchObject({ code: "ENOENT" });
  await expect(lstat(scratch)).rejects.toMatchObject({ code: "ENOENT" });
  for (const path of preserved) expect(await readFile(path, "utf8")).toBe(path);
  for (const [link, target] of links) expect(await readlink(link)).toBe(target);
  const recoveredPages = join(courses, id, "sources", "atlas", "pages");
  expect(await readFile(join(recoveredPages, "1.png"), "utf8")).toBe(
    "published atlas page",
  );
  const recoveredScratch = join(recoveredPages, stagedScratch);
  await expect(lstat(recoveredScratch)).rejects.toMatchObject({
    code: "ENOENT",
  });

  restarted.child.kill("SIGKILL");
  expect(await restarted.exited).toMatchObject({
    code: null,
    signal: "SIGKILL",
  });
  await listening(launch(root));
});

test("locked startup finishes only verified parked course deletions", async ({
  onTestFinished,
  signal,
}) => {
  const dir = await mkdtemp(join(tmpdir(), "gauss-serve-deletion-"));
  const shutdowns: (() => Promise<unknown>)[] = [];
  onTestFinished(async () => {
    await Promise.allSettled(shutdowns.map((stop) => stop()));
    await rm(dir, { recursive: true, force: true });
  });
  function launch(path: string) {
    signal.throwIfAborted();
    const server = start(path);
    shutdowns.push(() => {
      server.child.kill("SIGTERM");
      return server.exited;
    });
    return listening(server);
  }

  const root = join(dir, "record");
  const courses = join(root, "courses");
  const record = openDataRoot({ path: root });

  const fs = await vi.importActual<typeof FsPromises>("node:fs/promises");
  async function parked(id: string) {
    const name = (await readdir(courses)).find((name) =>
      name.startsWith(`.${id}.`),
    );
    if (name === undefined) throw new Error(`No parked entry for ${id}`);
    const parking = join(courses, name);
    return { id, parking, course: join(parking, "course") };
  }

  async function park(title: string) {
    const { id } = await record.createCourse({ title });
    // Remove one real file, then fail before the recursive removal can return.
    vi.mocked(unlink).mockImplementationOnce(async (path) => {
      await fs.unlink(path);
      throw new Error("Interrupted recursive removal");
    });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await record.deleteCourse(id)).toBe(true);
    } finally {
      vi.mocked(unlink).mockReset();
      errors.mockRestore();
    }
    const entry = await parked(id);
    await expect(
      readFile(join(entry.course, "course.json")),
    ).rejects.toMatchObject({
      code: "ENOENT",
    });
    return entry;
  }

  const partial = await park("Calculus");
  await writeFile(join(partial.course, "remaining"), "partially removed");
  const replacement = await record.createCourse({ title: "Calculus" });
  expect(replacement.id).toBe(partial.id);
  const activeWork = join(
    await record.workspaceFolder(replacement.id),
    "notes",
  );
  await writeFile(activeWork, "active course");

  const { id: unmoved } = await record.createCourse({ title: "Before rename" });
  vi.mocked(rename).mockImplementation(async (from, to) => {
    if (String(from).endsWith(`/${unmoved}`))
      throw new Error("Interrupted move");
    await fs.rename(from, to);
  });
  try {
    await expect(record.deleteCourse(unmoved)).rejects.toThrow(
      "Interrupted move",
    );
  } finally {
    vi.mocked(rename).mockReset();
  }
  const beforeRename = await parked(unmoved);

  const replaced = await park("Replaced payload");
  await rename(replaced.course, join(dir, "moved-course"));
  await mkdir(replaced.course);
  const unrelated = join(replaced.course, "notes");
  await writeFile(unrelated, "unrelated replacement");

  const linked = await park("Linked payload");
  const outside = join(dir, "outside-course");
  await rename(linked.course, outside);
  await writeFile(join(outside, "sentinel"), "external target");
  await symlink(outside, linked.course, "dir");
  await symlink(outside, join(partial.course, "external"), "dir");

  const legacy = join(
    courses,
    ".calculus.12345678-1234-4234-8234-123456789abc.tmp",
    "course.json",
  );
  const lookalike = join(
    courses,
    ".lookalike.12345678-1234-4234-8234-123456789abc.tmp",
    "course",
    "course.json",
  );
  const activeCourseJson = await readFile(
    join(courses, replacement.id, "course.json"),
    "utf8",
  );
  for (const path of [legacy, lookalike]) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, activeCourseJson);
  }

  // Even a verified remnant must not be removed through a linked courses/.
  const aliasRoot = join(dir, "alias-record");
  await mkdir(aliasRoot);
  await symlink(courses, join(aliasRoot, "courses"), "dir");
  await launch(aliasRoot);
  expect(await readFile(join(partial.course, "remaining"), "utf8")).toBe(
    "partially removed",
  );

  await launch(root);
  await expect(lstat(partial.parking)).rejects.toMatchObject({
    code: "ENOENT",
  });
  await expect(lstat(beforeRename.parking)).rejects.toMatchObject({
    code: "ENOENT",
  });
  expect((await record.readCourse(beforeRename.id))?.course.title).toBe(
    "Before rename",
  );
  expect(await readFile(activeWork, "utf8")).toBe("active course");
  expect(await readFile(unrelated, "utf8")).toBe("unrelated replacement");
  for (const path of [legacy, lookalike]) {
    expect(await readFile(path, "utf8")).toBe(activeCourseJson);
  }
  expect(await readlink(linked.course)).toBe(outside);
  expect(await readFile(join(outside, "sentinel"), "utf8")).toBe(
    "external target",
  );
});
