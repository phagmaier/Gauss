import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { openDataRoot } from "./record/data-root.ts";

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
