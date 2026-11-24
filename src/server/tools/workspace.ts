// Gauss's own file and command tools, for a tutor whose backend's tools
// cannot be refused with a reason or confined as the engine requires (Codex,
// docs/findings.md, "Codex"). Reading, listing and searching run here, kept
// to the workspace by its real path, and take no reservation. Writing,
// editing and a command ask the engine first (`WorkspaceTools.acquire`),
// whose refusal is the call's result, and hold the reservation until they
// finish, fail or are stopped. A command runs in the engine's sandbox, in
// the foreground, as Claude's tutor's commands are confined: no network,
// writes only in the workspace and the course's temporary folder.

import { createHash } from "node:crypto";
import { constants, type Dirent } from "node:fs";
import {
  type FileHandle,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
} from "node:fs/promises";
import { basename, dirname, join, matchesGlob, relative, sep } from "node:path";
import { z } from "zod";
import type { WorkspaceTools } from "../backends/backend.ts";
import { CODE_TIME_LIMIT_MS } from "../engine/code-run.ts";
import { duration } from "../engine/grading.ts";
import { defineTool, type TeachingTool, type ToolResult } from "./tool.ts";

/**
 * The private temporary folder of the tutor working in `cwd`, one per
 * course. Claude Code gives sandboxed
 * commands `<it>/claude-<uid>` as $TMPDIR only if that path is at most 44
 * bytes, and otherwise a folder shared by every Claude Code session of the
 * user; one in the course's folder would be longer. So it lies under /tmp,
 * named from the workspace's path.
 */
export function workspaceTmpDir(cwd: string): string {
  const name = createHash("sha256").update(cwd).digest("hex").slice(0, 8);
  return `/tmp/gauss-${name}`;
}

/**
 * Makes the folder, closed to other users, or checks that the one there is:
 * a folder and not a link, this user's, closed to others. /tmp is shared,
 * so another user could have made it first.
 */
export async function makePrivateFolder(path: string): Promise<void> {
  try {
    await mkdir(path, { mode: 0o700 });
  } catch (error) {
    if (!isCode(error, "EEXIST")) throw error;
  }
  const found = await lstat(path);
  if (
    !found.isDirectory() ||
    found.uid !== process.getuid?.() ||
    (found.mode & 0o077) !== 0
  ) {
    throw new Error(
      `The tutor's temporary folder ${path} is not closed to other users.`,
    );
  }
}

/** The most a read returns, and the largest file it reads. */
const READ_LINES = 2000;
const READ_BYTES = 256 * 1024;
const LARGEST_FILE = 10 * 1024 * 1024;
const LISTED = 500;
const MATCHES = 200;
const MATCH_CHARS = 300;
/** Folders a listing or search does not enter: installed packages, compiled files. */
const skipped = (name: string) => name === ".venv" || name === "__pycache__";
const STOPPED = "The learner stopped this turn.";
/**
 * Names a file tool may not write at any depth: what the learner's git,
 * editor or shell runs or reads as settings, outside every sandbox. A
 * command may not change those at the workspace's top that exist when it
 * starts. The sandbox runtime protects the same names only in the server's
 * own folder. A missing one is not denied to a command: the runtime would
 * leave an empty placeholder in the workspace for as long as any sandboxed
 * command runs, which the record's backup would take and git would read as
 * a broken `.git`. So a command can make one, as it can deeper down.
 */
const PROTECTED = [
  ".git",
  ".vscode",
  ".idea",
  ".claude",
  ".gitconfig",
  ".gitmodules",
  ".bashrc",
  ".bash_profile",
  ".zshrc",
  ".zprofile",
  ".profile",
  ".ripgreprc",
  ".mcp.json",
];

function isProtected(found: Place) {
  if (!found.shown.split(sep).some((part) => PROTECTED.includes(part))) {
    return undefined;
  }
  return {
    status: "refused" as const,
    text: `${found.shown} is where the learner's git, editor or shell finds settings or what it runs; no tool may change it.`,
  };
}

const Path = z
  .string()
  .min(1)
  .describe(
    "A path in the course's workspace, your working folder: relative to it (`exercise_1.py`), or absolute inside it.",
  );

/** The file and command tools of a session working in `cwd`. */
export function workspaceTools(
  cwd: string,
  workspace: Pick<WorkspaceTools, "acquire" | "run">,
): TeachingTool[] {
  const tmpDir = workspaceTmpDir(cwd);

  /** Runs `change` holding the engine's reservation, or says why it may not. */
  async function reserved(
    signal: AbortSignal | undefined,
    change: () => Promise<ToolResult>,
  ): Promise<ToolResult> {
    const reservation = await workspace.acquire();
    if ("refused" in reservation) {
      return { status: "refused", text: reservation.refused };
    }
    try {
      // Stop can come while the course's queue holds the reservation back.
      if (signal?.aborted === true) {
        return { status: "refused", text: STOPPED };
      }
      return await change();
    } finally {
      reservation.release();
    }
  }

  return [
    defineTool({
      name: "read_file",
      description:
        `Read a text file in the course's workspace: up to ${READ_LINES} ` +
        "lines from the line given (the first if none). Nothing outside " +
        "the workspace can be read.",
      input: z.object({
        path: Path,
        offset: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe("The first line to read, counting from 1."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(READ_LINES)
          .optional()
          .describe(`How many lines to read; ${READ_LINES} if not given.`),
      }),
      async run({ path, offset = 1, limit = READ_LINES }) {
        const found = await place(cwd, path);
        if ("status" in found) return found;
        const text = await readText(found);
        if (typeof text !== "string") return text;
        const lines = text.split("\n");
        if (lines.at(-1) === "") lines.pop();
        if (lines.length === 0) {
          return { status: "done", text: `${found.shown} is empty.` };
        }
        if (offset > lines.length) {
          return {
            status: "refused",
            text: `${found.shown} has ${lines.length} lines; line ${offset} is past its end.`,
          };
        }
        let shown = lines.slice(offset - 1, offset - 1 + limit).join("\n");
        let cut = offset - 1 + limit < lines.length;
        if (Buffer.byteLength(shown) > READ_BYTES) {
          const start = Buffer.from(shown)
            .subarray(0, READ_BYTES)
            .toString("utf8");
          const end = start.lastIndexOf("\n");
          if (end === -1) {
            return {
              status: "done",
              text: `${start}\n\n(Line ${offset} of ${found.shown} is longer than ${READ_BYTES / 1024} KB; this is its start. Search the file, or run a command, for the rest.)`,
            };
          }
          shown = start.slice(0, end);
          cut = true;
        }
        const last = offset - 1 + shown.split("\n").length;
        return {
          status: "done",
          text: cut
            ? `${shown}\n\n(Lines ${offset} to ${last} of ${lines.length} of ${found.shown}. Read on from line ${last + 1}.)`
            : shown,
        };
      },
    }),
    defineTool({
      name: "list_files",
      description:
        "List the files in a folder of the course's workspace and the " +
        "folders under it, by their paths in the workspace, folders ending " +
        "in `/`. A link is listed, not followed. Installed packages " +
        "(`.venv`) and `__pycache__` are not entered.",
      input: z.object({
        path: Path.optional().describe(
          "The folder to list, in the workspace; the workspace itself if not given.",
        ),
        pattern: z
          .string()
          .min(1)
          .optional()
          .describe(
            "Only paths matching this glob, relative to the folder listed (`**/*.py`).",
          ),
      }),
      async run({ path = ".", pattern }) {
        const found = await place(cwd, path);
        if ("status" in found) return found;
        const listed: string[] = [];
        let more = false;
        for await (const entry of walk(found.real)) {
          const inFolder = relative(found.real, entry.path);
          if (pattern !== undefined && !matchesGlob(inFolder, pattern)) {
            continue;
          }
          if (listed.length === LISTED) {
            more = true;
            break;
          }
          const shown = relative(found.root, entry.path);
          listed.push(entry.folder ? `${shown}/` : shown);
        }
        if (listed.length === 0) {
          return { status: "done", text: `Nothing in ${found.shown} matches.` };
        }
        return {
          status: "done",
          text: more
            ? `${listed.join("\n")}\n\n(The first ${LISTED}. Name a folder or a pattern to see the rest.)`
            : listed.join("\n"),
        };
      },
    }),
    defineTool({
      name: "search_files",
      description:
        "Find the lines of text files in the course's workspace that hold " +
        "the text given, as `path:line: text`. The text is matched as " +
        "written, not as a pattern. Links are not followed; installed " +
        "packages (`.venv`) and `__pycache__` are not searched.",
      input: z.object({
        text: z.string().min(1).describe("The text to find, as written."),
        path: Path.optional().describe(
          "A file or folder to search, in the workspace; the whole workspace if not given.",
        ),
        ignore_case: z
          .boolean()
          .optional()
          .describe("Match letters in either case."),
      }),
      async run({ text, path = ".", ignore_case = false }) {
        const found = await place(cwd, path);
        if ("status" in found) return found;
        const wanted = ignore_case ? text.toLowerCase() : text;
        const matches: string[] = [];
        let more = false;
        search: for await (const entry of walk(found.real, true)) {
          if (entry.folder) continue;
          const content = await readText({ ...found, real: entry.path });
          if (typeof content !== "string") continue;
          const lines = content.split("\n");
          for (const [index, line] of lines.entries()) {
            const seen = ignore_case ? line.toLowerCase() : line;
            if (!seen.includes(wanted)) continue;
            if (matches.length === MATCHES) {
              more = true;
              break search;
            }
            const shown =
              line.length > MATCH_CHARS
                ? `${line.slice(0, MATCH_CHARS)}…`
                : line;
            matches.push(
              `${relative(found.root, entry.path)}:${index + 1}: ${shown}`,
            );
          }
        }
        if (matches.length === 0) {
          return {
            status: "done",
            text: `No line in ${found.shown} holds it.`,
          };
        }
        return {
          status: "done",
          text: more
            ? `${matches.join("\n")}\n\n(The first ${MATCHES} lines. Search a narrower path to see the rest.)`
            : matches.join("\n"),
        };
      },
    }),
    defineTool({
      name: "write_file",
      description:
        "Write a file in the course's workspace, in place of any file " +
        "there, making the folders it needs. The learner sees a line for " +
        "it in the thread. Nothing outside the workspace can be written, " +
        "nor a file through a link, nor git's or an editor's settings " +
        "(`.git`, `.vscode` and the like). Refused, with the reason, when " +
        "the app does not allow changes now.",
      input: z.object({
        path: Path,
        content: z.string().describe("The file's whole new content."),
      }),
      run({ path, content }, signal) {
        return reserved(signal, async () => {
          const found = await place(cwd, path);
          if ("status" in found) return found;
          const kept = isProtected(found);
          if (kept !== undefined) return kept;
          if (found.real === found.root) {
            return {
              status: "refused",
              text: "Name a file, not the workspace.",
            };
          }
          await mkdir(dirname(found.real), { recursive: true });
          const written = await writeText(found, content);
          if (written !== undefined) return written;
          return {
            status: "done",
            text: `Wrote ${found.shown}.`,
            fileWritten: found.shown,
          };
        });
      },
    }),
    defineTool({
      name: "edit_file",
      description:
        "Change a text file in the course's workspace: replace the text " +
        "given, which must appear in it exactly once unless every " +
        "occurrence is to be replaced. The learner sees a line for it in " +
        "the thread. Refused, with the reason, when the app does not allow " +
        "changes now.",
      input: z.object({
        path: Path,
        old_text: z
          .string()
          .min(1)
          .describe("The text to replace, exactly as the file has it."),
        new_text: z.string().describe("The text to put in its place."),
        replace_all: z
          .boolean()
          .optional()
          .describe("Replace every occurrence, not only one."),
      }),
      run({ path, old_text, new_text, replace_all = false }, signal) {
        return reserved(signal, async () => {
          const found = await place(cwd, path);
          if ("status" in found) return found;
          const kept = isProtected(found);
          if (kept !== undefined) return kept;
          const text = await readText(found);
          if (typeof text !== "string") return text;
          const count = text.split(old_text).length - 1;
          if (count === 0) {
            return {
              status: "refused",
              text: `${found.shown} does not hold the text to replace. Read it again and copy the text exactly.`,
            };
          }
          if (count > 1 && !replace_all) {
            return {
              status: "refused",
              text: `The text to replace appears ${count} times in ${found.shown}. Give more of the text around it, or replace every occurrence.`,
            };
          }
          const written = await writeText(
            found,
            replace_all
              ? text.split(old_text).join(new_text)
              : text.replace(old_text, () => new_text),
          );
          if (written !== undefined) return written;
          return {
            status: "done",
            text: `Edited ${found.shown}.`,
            fileWritten: found.shown,
          };
        });
      },
    }),
    defineTool({
      name: "run_command",
      description:
        "Run a bash command in the course's workspace and wait for it to " +
        "end: its output and exit status come back. It has no network, " +
        "writes only in the workspace and in `$TMPDIR` (the course's " +
        "temporary folder, kept between commands), and reads nothing of " +
        `the app's. It is stopped after ${duration(CODE_TIME_LIMIT_MS)}, ` +
        "with everything it started. Leave git's, an editor's and the " +
        "shell's settings (`.git`, `.vscode`, `.bashrc` and the like) " +
        "alone. Refused, with the reason, when the app does not allow " +
        "changes now.",
      input: z.object({
        command: z.string().min(1).describe("The command, as bash reads it."),
      }),
      run({ command }, signal) {
        return reserved(signal, async () => {
          const root = await realpath(cwd);
          await makePrivateFolder(tmpDir);
          const ran = await workspace.run({
            argv: ["bash", "-c", command],
            cwd: root,
            writable: [root, tmpDir],
            unwritable: await existing(
              PROTECTED.map((name) => join(root, name)),
            ),
            readable: [root],
            env: { TMPDIR: tmpDir },
            timeLimitMs: CODE_TIME_LIMIT_MS,
            mergeOutput: true,
            verifyLaunch: true,
            ...(signal === undefined ? {} : { signal }),
          });
          const output = ran.stdout.trimEnd();
          const parts = [
            ...(ran.cut ? ["(The start of the output was cut.)"] : []),
            output === "" ? "(No output.)" : output,
            ran.timedOut
              ? `Stopped after ${duration(CODE_TIME_LIMIT_MS)}, the time limit of a command.`
              : `Exit status ${ran.exitCode}.`,
          ];
          return { status: "done", text: parts.join("\n\n") };
        });
      },
    }),
  ];
}

/** A path in the workspace: its real path, the workspace's, and how the model names it. */
interface Place {
  real: string;
  root: string;
  shown: string;
}

/**
 * Where `path` really lies, if in the workspace. Each part that exists is
 * resolved, links included, so a link out of the workspace is refused; a
 * part that does not exist yet is taken as written. A link at the end
 * that leads nowhere is caught when the file is opened.
 */
async function place(
  cwd: string,
  path: string,
): Promise<Place | { status: "refused"; text: string }> {
  const root = await realpath(cwd);
  const given = join(path.startsWith("/") ? "" : cwd, path);
  const outside = {
    status: "refused" as const,
    text: `${path} is outside the course's workspace, ${cwd}. Only files in it can be used.`,
  };
  const inside = [cwd, root]
    .map((folder) => relative(folder, given))
    .find((rest) => !isOutside(rest));
  if (inside === undefined) return outside;
  const missing: string[] = [];
  let existing = join(root, inside);
  let real: string;
  for (;;) {
    try {
      real = await realpath(existing);
      break;
    } catch (error) {
      if (!isCode(error, "ENOENT")) throw error;
      missing.unshift(basename(existing));
      existing = dirname(existing);
    }
  }
  const resolved = join(real, ...missing);
  const rest = relative(root, resolved);
  if (isOutside(rest)) return outside;
  return { real: resolved, root, shown: rest === "" ? "." : rest };
}

function isOutside(rest: string): boolean {
  return rest === ".." || rest.startsWith(`..${sep}`) || rest.startsWith(sep);
}

/**
 * Never follows a link, and never waits: a pipe the tutor made would hold
 * an open, and its reservation, until something wrote or read at its end.
 */
const NO_WAIT = constants.O_NOFOLLOW | constants.O_NONBLOCK;

/** A text file's content, or why it is not read. */
async function readText(
  found: Place,
): Promise<string | { status: "refused"; text: string }> {
  let file: FileHandle;
  try {
    file = await open(found.real, constants.O_RDONLY | NO_WAIT);
  } catch (error) {
    if (isCode(error, "ENOENT")) {
      return { status: "refused", text: `${found.shown} does not exist.` };
    }
    if (isCode(error, "ELOOP")) return throughLink(found);
    throw error;
  }
  try {
    const info = await file.stat();
    if (!info.isFile()) return notAFile(found);
    if (info.size > LARGEST_FILE) {
      return {
        status: "refused",
        text: `${found.shown} is ${Math.round(info.size / 1024 / 1024)} MB, too large to read here.`,
      };
    }
    const data = await readFile(file);
    if (data.includes(0)) {
      return { status: "refused", text: `${found.shown} is not a text file.` };
    }
    return data.toString("utf8");
  } finally {
    await file.close();
  }
}

/** Writes the file's whole content, or says why not. */
async function writeText(
  found: Place,
  content: string,
): Promise<{ status: "refused"; text: string } | undefined> {
  let file: FileHandle;
  try {
    file = await open(
      found.real,
      constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | NO_WAIT,
      0o644,
    );
  } catch (error) {
    if (isCode(error, "ELOOP")) return throughLink(found);
    if (isCode(error, "EISDIR")) {
      return { status: "refused", text: `${found.shown} is a folder.` };
    }
    if (isCode(error, "ENXIO")) return notAFile(found);
    throw error;
  }
  try {
    if (!(await file.stat()).isFile()) return notAFile(found);
    await file.writeFile(content, "utf8");
  } finally {
    await file.close();
  }
  return undefined;
}

function notAFile(found: Place) {
  return { status: "refused" as const, text: `${found.shown} is not a file.` };
}

function throughLink(found: Place) {
  return {
    status: "refused" as const,
    text: `${found.shown} is a link that leads nowhere in the workspace. Use a file in it.`,
  };
}

/**
 * The folders and files under `folder`, in name order, without entering a
 * link or the skipped folders. `filesOnly` leaves folders out.
 */
async function* walk(
  folder: string,
  filesOnly = false,
): AsyncGenerator<{ path: string; folder: boolean }> {
  let entries: Dirent[];
  try {
    entries = await readdir(folder, { withFileTypes: true });
  } catch (error) {
    // A file named as the place to search is searched itself.
    if (isCode(error, "ENOTDIR")) {
      yield { path: folder, folder: false };
      return;
    }
    if (isCode(error, "ENOENT")) return;
    throw error;
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of entries) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) {
      if (!filesOnly) yield { path, folder: true };
      if (!skipped(entry.name)) yield* walk(path, filesOnly);
    } else if (!filesOnly || entry.isFile()) {
      yield { path, folder: false };
    }
  }
}

/** The paths given that exist, a link counting as itself. */
async function existing(paths: readonly string[]): Promise<string[]> {
  const found = await Promise.all(
    paths.map((path) =>
      lstat(path).then(
        () => path,
        (error: unknown) => {
          if (isCode(error, "ENOENT")) return undefined;
          throw error;
        },
      ),
    ),
  );
  return found.filter((path) => path !== undefined);
}

function isCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
