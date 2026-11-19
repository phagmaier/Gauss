// A history of the course record (task 2.25; brief.md, "Other features"):
// the data root is a git repository, committed after the steps that matter
// (a segment closed, a unit finished, a curriculum approved), so a write
// that is valid but wrong can be undone. It runs the `git` on the path; no
// package does it.
//
// A data root that is not a repository becomes one, with a `.gitignore`
// that keeps `courses/` and `profile.md` (architecture.md section 3) and
// leaves out `intake/`, the record's temporary files (atomic-write.ts), and
// in a course's workspace what its tools make again: a Python environment
// and Python's caches. The learner's files in the workspace are kept. One
// that is a repository already is kept as it is, with its own rules; only a
// `.gitignore` Gauss wrote that lacks a line of today's is brought up to it.
//
// Commits run in the background, one at a time, in the order asked. Each
// takes the record as it stands when it runs, so writes made since it was
// asked for go into it too. One that fails is logged and never thrown: the
// backup must not stop the learner. Commits are by "Gauss", never by the
// learner's own git identity, and are not signed, which would ask for a key.

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface Backup {
  /** Commits the record as it stands, under this message. Never throws. */
  commit(message: string): void;
  /** Waits for every commit asked for so far. */
  settled(): Promise<void>;
}

/** The backup when it is off, or when there is no git. */
export const noBackup: Backup = {
  commit() {},
  settled: () => Promise.resolve(),
};

const GITIGNORE = `# Written by Gauss. The backup keeps the course record only.
/*
!/.gitignore
!/courses/
!/profile.md
.*.tmp
.venv/
__pycache__/
.pytest_cache/
`;

/** The `.gitignore` Gauss wrote before workspaces had packages, replaced by today's. */
const GITIGNORE_BEFORE = `# Written by Gauss (task 2.25). The backup keeps the course record only.
/*
!/.gitignore
!/courses/
!/profile.md
.*.tmp
`;

const AS_GAUSS = [
  "-c",
  "user.name=Gauss",
  "-c",
  "user.email=gauss@localhost",
  "-c",
  "commit.gpgsign=false",
];

/**
 * Starts the backup of the data root at `path`, making it a repository if
 * it is not one, and commits what changed since the last run before it
 * returns.
 */
export async function startBackup(options: {
  path: string;
  /** Where the backup's lines go: that it runs, or why it does not. */
  log: (line: string) => void;
  /** Holds the record's approval lock while staging a snapshot. */
  stageSnapshot?: (stage: () => Promise<void>) => Promise<void>;
  /** The git to run; `git` on the path unless given. */
  git?: string;
}): Promise<Backup> {
  const { path, log } = options;
  // Variables such as GIT_DIR, set when the server is started from inside a
  // git command, would point git at another repository.
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")),
  );
  const run = (args: string[]) =>
    new Promise<string>((resolve, reject) => {
      execFile(
        options.git ?? "git",
        args,
        { cwd: path, env },
        (error, stdout, stderr) => {
          if (error === null) resolve(stdout);
          else reject(new Error(stderr.trim() || error.message));
        },
      );
    });

  await mkdir(path, { recursive: true });
  try {
    await run(["--version"]);
  } catch {
    log("No git on the path, so the record is not backed up.");
    return noBackup;
  }

  let queue = Promise.resolve();
  const stage = async () => {
    await run(["add", "--all"]);
  };
  const backup: Backup = {
    commit(message) {
      queue = queue
        .then(async () => {
          await (options.stageSnapshot === undefined
            ? stage()
            : options.stageSnapshot(stage));
          if ((await run(["status", "--porcelain"])).trim() === "") return;
          await run([...AS_GAUSS, "commit", "--quiet", "--message", message]);
        })
        .catch((error: unknown) => {
          const reason = error instanceof Error ? error.message : String(error);
          log(`The backup could not commit "${message}": ${reason}`);
        });
    },
    settled: () => queue,
  };

  const fresh = !existsSync(join(path, ".git"));
  const ignore = join(path, ".gitignore");
  if (!fresh) {
    const rules = await readFile(ignore, "utf8").catch(() => undefined);
    if (rules === GITIGNORE_BEFORE) await writeFile(ignore, GITIGNORE);
  }
  if (fresh) {
    try {
      await run(["init", "--quiet"]);
      await writeFile(ignore, GITIGNORE, { flag: "wx" });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      log(`The record is not backed up: ${reason}`);
      return noBackup;
    }
  }
  log(`The record is backed up with git in ${path}.`);
  backup.commit(fresh ? "Backup started" : "Gauss started");
  await backup.settled();
  return backup;
}
