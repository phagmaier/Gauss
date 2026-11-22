import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createCourseDeletion } from "../engine/course-deletion.ts";
import { startBackup } from "./backup.ts";
import { openDataRoot } from "./data-root.ts";

let dir: string;
let said: string[];
const log = (line: string) => said.push(line);

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "gauss-backup-"));
  said = [];
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});

async function put(path: string, contents = "{}\n"): Promise<void> {
  await mkdir(dirname(join(dir, path)), { recursive: true });
  await writeFile(join(dir, path), contents);
}

/** Runs git in the data root, outside the code under test. */
function git(...args: string[]): string {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")),
  );
  return execFileSync("git", args, { cwd: dir, env, encoding: "utf8" }).trim();
}
const subjects = () => git("log", "--format=%s").split("\n");
const tracked = () => git("ls-files").split("\n");

describe("starting", () => {
  test("a new data root becomes a repository whose first commit holds the courses and the profile, not the intake or temporary files", async () => {
    await put("courses/limits/course.json");
    await put("courses/limits/.state.json.0c1d.tmp");
    await put("profile.md", "A learner.\n");
    await put("intake/session.txt", "kept by the intake\n");
    await put("courses/limits/workspace/count.py", "print(1)\n");
    await put("courses/limits/workspace/.venv/bin/python", "");
    await put("courses/limits/workspace/.venv/lib/site.py", "");
    await put("courses/limits/workspace/__pycache__/count.pyc", "");
    await put("courses/limits/workspace/tests/__pycache__/t.pyc", "");
    await put("courses/limits/workspace/.pytest_cache/v/x", "");

    const backup = await startBackup({ path: dir, log });
    await backup.settled();

    expect(subjects()).toEqual(["Backup started"]);
    expect(tracked()).toEqual([
      ".gitignore",
      "courses/limits/course.json",
      "courses/limits/workspace/count.py",
      "profile.md",
    ]);
    expect(said).toEqual([`The record is backed up with git in ${dir}.`]);
  });

  test("a data root that does not exist yet is made", async () => {
    const path = join(dir, "gauss");

    const backup = await startBackup({ path, log });
    await backup.settled();

    expect(existsSync(join(path, ".git"))).toBe(true);
    expect(existsSync(join(path, ".gitignore"))).toBe(true);
  });

  test("an existing repository is kept, with its history and its own ignore rules, and what changed since is committed", async () => {
    git("init", "-q");
    await put("notes.txt", "the learner's own file\n");
    git(
      "-c",
      "user.name=Learner",
      "-c",
      "user.email=learner@example.com",
      "-c",
      "commit.gpgsign=false",
      "add",
      "-A",
    );
    git(
      "-c",
      "user.name=Learner",
      "-c",
      "user.email=learner@example.com",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-q",
      "-m",
      "Their own commit",
    );
    await put("courses/limits/course.json");

    const backup = await startBackup({ path: dir, log });
    await backup.settled();

    expect(subjects()).toEqual(["Gauss started", "Their own commit"]);
    expect(existsSync(join(dir, ".gitignore"))).toBe(false);
  });

  test("a .gitignore Gauss wrote before workspaces had packages is brought up to today's, and the venv stays out", async () => {
    git("init", "-q");
    const before = `# Written by Gauss (task 2.25). The backup keeps the course record only.
/*
!/.gitignore
!/courses/
!/profile.md
.*.tmp
`;
    await put(".gitignore", before);
    await put("courses/limits/workspace/.venv/bin/python", "");
    await put("courses/limits/workspace/count.py", "print(1)\n");

    const backup = await startBackup({ path: dir, log });
    await backup.settled();

    expect(tracked()).toEqual([
      ".gitignore",
      "courses/limits/workspace/count.py",
    ]);
  });

  test("a .gitignore Gauss wrote before sources had page images is brought up to today's: a source's original and text are kept, its pages/ left out, and a workspace's pages/ kept", async () => {
    git("init", "-q");
    const before = `# Written by Gauss. The backup keeps the course record only.
/*
!/.gitignore
!/courses/
!/profile.md
.*.tmp
.venv/
__pycache__/
.pytest_cache/
`;
    await put(".gitignore", before);
    const source = "courses/hegel/sources/phenomenology";
    await put(`${source}/original.pdf`, "%PDF-");
    await put(`${source}/outline.json`);
    await put(`${source}/sections/s1.md`, "Preface.\n");
    await put(`${source}/pages/1.png`, "");
    await put("courses/hegel/workspace/pages/index.md", "the learner's\n");
    await put("uploads/0f8fad5b-d9cb-469f-a165-70867728950e/notes/x.md", "");

    const backup = await startBackup({ path: dir, log });
    await backup.settled();

    expect(tracked()).toEqual([
      ".gitignore",
      `${source}/original.pdf`,
      `${source}/outline.json`,
      `${source}/sections/s1.md`,
      "courses/hegel/workspace/pages/index.md",
    ]);
  });

  test("a .gitignore of the learner's own is left as it is", async () => {
    git("init", "-q");
    await put(".gitignore", "/intake/\n");
    await put("courses/limits/workspace/.venv/bin/python", "");

    const backup = await startBackup({ path: dir, log });
    await backup.settled();

    expect(git("show", "HEAD:.gitignore")).toBe("/intake/");
  });

  test("with nothing changed since the last run, starting commits nothing", async () => {
    await put("courses/limits/course.json");
    await (await startBackup({ path: dir, log })).settled();

    await (await startBackup({ path: dir, log })).settled();

    expect(subjects()).toEqual(["Backup started"]);
  });

  test("with no git, it says so once and backs nothing up", async () => {
    await put("courses/limits/course.json");

    const backup = await startBackup({
      path: dir,
      log,
      git: join(dir, "no-such-git"),
    });
    backup.commit("limits: curriculum approved");
    await backup.settled();

    expect(said).toEqual([
      "No git on the path, so the record is not backed up.",
    ]);
    expect(existsSync(join(dir, ".git"))).toBe(false);
  });

  test("a GIT_DIR in the server's environment is not followed", async () => {
    const elsewhere = join(dir, "elsewhere.git");
    vi.stubEnv("GIT_DIR", elsewhere);
    await put("courses/limits/course.json");

    const backup = await startBackup({ path: dir, log });
    await backup.settled();

    vi.unstubAllEnvs();
    expect(existsSync(elsewhere)).toBe(false);
    expect(subjects()).toEqual(["Backup started"]);
  });
});

test("deleting an unsnapshotted course keeps its latest files in backup history", async () => {
  const dataRoot = openDataRoot({ path: dir });
  const backup = await startBackup({
    path: dir,
    log,
    stageSnapshot: dataRoot.withConsistentSnapshot,
  });
  const { id, course } = await dataRoot.createCourse({ title: "Limits" });
  await put(`courses/${id}/workspace/example.py`, "print(42)\n");
  const deletion = createCourseDeletion({ dataRoot, backup, holders: [] });

  expect(
    await deletion.delete(id, {
      instance: course.instance ?? course.createdAt,
    }),
  ).toEqual({ ok: true });
  await backup.settled();

  expect(subjects()).toEqual([
    "limits: course deleted",
    "limits: before deleting course",
    "Backup started",
  ]);
  expect(git("show", "HEAD^:courses/limits/workspace/example.py")).toBe(
    "print(42)",
  );
  expect(tracked()).toEqual([".gitignore"]);
});

describe("committing", () => {
  test("a commit holds what changed, under its message, by Gauss; with nothing changed there is none", async () => {
    await put("courses/limits/course.json");
    const backup = await startBackup({ path: dir, log });
    await put("courses/limits/evidence.jsonl", '{"kind":"answer"}\n');

    backup.commit("limits: segment 1 of epsilon-delta closed");
    backup.commit("limits: nothing new");
    await backup.settled();

    expect(subjects()).toEqual([
      "limits: segment 1 of epsilon-delta closed",
      "Backup started",
    ]);
    expect(git("show", "--name-only", "--format=", "HEAD")).toBe(
      "courses/limits/evidence.jsonl",
    );
    expect(git("log", "-1", "--format=%an <%ae>")).toBe(
      "Gauss <gauss@localhost>",
    );
  });

  test("a commit that fails is logged and never thrown, and the next one still runs", async () => {
    await put("courses/limits/course.json");
    const backup = await startBackup({ path: dir, log });
    await backup.settled();
    await put("courses/limits/state.json");
    // Another git process holds the index.
    await writeFile(join(dir, ".git", "index.lock"), "");

    backup.commit("limits: segment 1 of epsilon-delta closed");
    await backup.settled();

    expect(said.at(-1)).toMatch(
      /^The backup could not commit "limits: segment 1 of epsilon-delta closed": .*index\.lock/,
    );
    expect(subjects()).toEqual(["Backup started"]);

    await rm(join(dir, ".git", "index.lock"));
    backup.commit("limits: unit epsilon-delta finished, passed");
    await backup.settled();

    expect(subjects()).toEqual([
      "limits: unit epsilon-delta finished, passed",
      "Backup started",
    ]);
  });
});
