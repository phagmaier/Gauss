// Code questions in the engine (architecture.md section 6; task 3.7). A code
// question names files in the course's workspace that the learner edits in
// their own editor, and carries the grading material, which the record keeps
// and the workspace never holds: the tests, the tutor's solution, and the
// command that runs the tests.
//
// Every run has a folder of its own that contains only the files under test
// (the starter versions, the solution, or the learner's files as sent), the
// test files, the saved dependency files, and a read-only link to the live
// `.venv` if present. The command runs there in the sandbox, which writes
// only to that folder and to its own temporary one, and of the course's
// folder reads only that `.venv`. Exit status 0 is a pass.
//
// When the question is posted, the tests must fail on the starter files the
// tutor wrote in the workspace and pass on its solution: tests that cannot
// tell right code from wrong are a code question's wrong key.

import type { Stats } from "node:fs";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import {
  CODE_FILE_LIMIT,
  type CodeAnswer,
  type CodeFile,
  type CodeQuestion,
  type SavedCodeInput,
} from "../../shared/question.ts";
import { duration } from "./grading.ts";
import type { Sandbox } from "./sandbox.ts";

/** How long one run of a question's tests may take. */
export const CODE_TIME_LIMIT_MS = 60_000;

/** How much of a run's output's end is kept: lines, then characters. */
const OUTPUT_LINES = 40;
const OUTPUT_CHARS = 8000;

/** What one run of the tests gave, or why it gave nothing. */
export type CodeRunResult =
  | {
      result: "passed" | "failed";
      exitCode: number;
      /** The end of what the command wrote, both streams in order. */
      output: string;
    }
  | { result: "timed-out"; output: string }
  | { result: "error"; reason: string };

export interface CodeRunner {
  /** Why a code question cannot be submitted here, as a sentence. */
  unavailable?: string;
  /**
   * Checks the starter files and saves the dependencies before running both
   * preflights. Returns the checked question, or the reason not to post it.
   */
  check(
    question: CodeQuestion,
    workspace: string,
    dependencies: readonly string[],
    signal?: AbortSignal,
  ): Promise<{ question: CodeQuestion } | { refused: string }>;
  /** Runs the question's tests on these files. Never throws. */
  run(
    question: CodeQuestion,
    files: readonly CodeFile[],
    workspace: string,
    signal?: AbortSignal,
  ): Promise<CodeRunResult>;
}

/**
 * A runner with no sandbox: neither posting nor grading is available.
 */
export const noCodeRunner = unavailableCodeRunner(
  "The sandbox that runs the tests is not available",
  "Code questions need the sandbox that runs their tests, and it does not run here. Ask another kind of question.",
);

function unavailableCodeRunner(reason: string, refused: string): CodeRunner {
  return {
    unavailable: `${reason}.`,
    check: async () => ({ refused }),
    run: async () => ({ result: "error", reason }),
  };
}

const NO_INPUTS = "this question predates saved exercise inputs";

export function createCodeRunner(options: {
  sandbox: Sandbox;
  timeLimitMs?: number;
}): CodeRunner {
  const { sandbox } = options;
  if (!sandbox.available) {
    return unavailableCodeRunner(
      `The sandbox that runs the tests is not available (${sandbox.reason})`,
      `Code questions need the sandbox that runs their tests, and it does not run here (${sandbox.reason}). Ask another kind of question.`,
    );
  }
  const activeSandbox = sandbox;
  const timeLimitMs = options.timeLimitMs ?? CODE_TIME_LIMIT_MS;
  const limit = duration(timeLimitMs);

  async function run(
    question: CodeQuestion,
    files: readonly CodeFile[],
    workspace: string,
    signal?: AbortSignal,
  ): Promise<CodeRunResult> {
    let folder: string | undefined;
    try {
      signal?.throwIfAborted();
      if (question.inputs === undefined) {
        return { result: "error", reason: NO_INPUTS };
      }
      folder = await mkdtemp(join(tmpdir(), "gauss-code-"));
      // By its real path, the one the sandbox opens again inside the data
      // root. Its last step is left as it is: the tutor can make it a link,
      // and the sandbox opens no link that leads into a folder it closes.
      const venv = join(await realpath(workspace), ".venv");
      await populate(
        folder,
        venv,
        [...files, ...question.tests, ...question.inputs],
        signal,
      );
      signal?.throwIfAborted();
      const [program, ...rest] = question.command;
      const ran = await activeSandbox.run({
        argv: [program ?? "", ...rest],
        cwd: folder,
        writable: [folder],
        readable: [venv],
        timeLimitMs,
        mergeOutput: true,
        verifyLaunch: true,
        ...(signal === undefined ? {} : { signal }),
      });
      signal?.throwIfAborted();
      if (ran.timedOut) {
        return {
          result: "timed-out",
          output: outputEnd(
            ran.stdout,
            `Stopped after ${limit}, the time limit of the tests.`,
          ),
        };
      }
      const { exitCode } = ran;
      if (exitCode === null) {
        return {
          result: "error",
          reason: "the tests ended without an exit status",
        };
      }
      return exitCode === 0
        ? {
            result: "passed",
            exitCode,
            output: outputEnd(ran.stdout) || "Exit status 0.",
          }
        : {
            result: "failed",
            exitCode,
            output: outputEnd(ran.stdout, `Exit status ${exitCode}.`),
          };
    } catch (error) {
      return {
        result: "error",
        reason: error instanceof Error ? error.message : String(error),
      };
    } finally {
      if (folder !== undefined) {
        await rm(folder, { recursive: true, force: true }).catch(() => {});
      }
    }
  }

  return {
    run,
    async check(question, workspace, dependencies, signal) {
      let starter: WorkspaceFilesResult;
      try {
        starter = await readWorkspaceFiles(workspace, question.files, {
          signal,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { refused: `The starter files could not be read: ${message}` };
      }
      if ("problem" in starter) {
        return {
          refused:
            starter.problem === "missing"
              ? `"${starter.path}" is not in the workspace. Write its starter version there with your Write tool first, then post the question.`
              : `The starter version of ${fileProblem(starter)} Write it again with your Write tool, then post the question.`,
        };
      }
      let inputs: WorkspaceFilesResult;
      try {
        inputs = await readWorkspaceFiles(workspace, dependencies, {
          signal,
          preserveExecutable: true,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { refused: `The dependencies could not be read: ${message}` };
      }
      if ("problem" in inputs) {
        return {
          refused: `Dependency ${fileProblem(inputs)} Write it as a plain UTF-8 file in the workspace before posting the question.`,
        };
      }
      const checked = { ...question, inputs: inputs.files };
      // Both at once: posting waits for the slower.
      const [solved, started] = await Promise.all([
        run(checked, question.solution, workspace, signal),
        run(checked, starter.files, workspace, signal),
      ]);
      if (signal?.aborted === true) {
        return {
          refused:
            "The tests were stopped before the question could be posted.",
        };
      }
      for (const ran of [solved, started]) {
        if (ran.result === "error") {
          return { refused: `The tests could not be run: ${ran.reason}.` };
        }
      }
      const problems: string[] = [];
      if (solved.result === "timed-out") {
        problems.push(
          `On your solution the tests ran past ${limit} and were stopped. The end of their output:\n\n${solved.output}`,
        );
      } else if (solved.result === "failed") {
        problems.push(
          "The tests fail on your solution, so they cannot tell right code " +
            "from wrong, or the command does not run them. The end of their " +
            `output:\n\n${solved.output}`,
        );
      }
      if (started.result === "timed-out") {
        problems.push(
          `On the starter files the tests ran past ${limit} and were stopped: a starter version should fail at once (raise NotImplementedError, say).`,
        );
      } else if (started.result === "passed") {
        problems.push(
          "The tests pass on the starter files in the workspace, so they " +
            "cannot tell right code from wrong: make the starter fall short " +
            "of what the question asks, or test what it leaves undone.",
        );
      }
      return problems.length === 0
        ? { question: checked }
        : { refused: `The question was not posted. ${problems.join("\n\n")}` };
    },
  };
}

/** A code answer's grade, or why there is none. */
export type CodeOutcome =
  | { ok: true; verdict: "correct" | "incorrect"; output: string }
  | { ok: false; error: string; timedOut?: { output: string } };

/**
 * Grades a code answer by running the tests on the learner's files as they
 * were sent: exit status 0 is correct, any other is a miss, with the end of
 * the output saying why. A run past the time limit, or one that could not
 * start, is a failed grading. Never throws.
 */
export async function gradeCode(
  runner: CodeRunner,
  question: CodeQuestion,
  answer: CodeAnswer,
  workspace: string,
  signal?: AbortSignal,
): Promise<CodeOutcome> {
  if (question.inputs === undefined) {
    return { ok: false, error: `The tests could not be run: ${NO_INPUTS}.` };
  }
  const ran = await runner.run(question, answer.files, workspace, signal);
  switch (ran.result) {
    case "passed":
      return { ok: true, verdict: "correct", output: ran.output };
    case "failed":
      return { ok: true, verdict: "incorrect", output: ran.output };
    case "timed-out":
      return {
        ok: false,
        error:
          "The tests ran past their time limit and were stopped. Your files are kept as you ran them.",
        timedOut: { output: ran.output },
      };
    case "error":
      return { ok: false, error: `The tests could not be run: ${ran.reason}.` };
  }
}

/** Why a file of the workspace cannot be read as a code question's file. */
export type FileProblem = "missing" | "not-a-file" | "too-large" | "not-text";

export type WorkspaceFilesResult =
  | { files: SavedCodeInput[] }
  | { path: string; problem: FileProblem };

/**
 * Reads the files from the workspace, by their paths in it, as a code
 * question runs them: each a plain file inside the workspace, no larger
 * than a question's file may be, and text in UTF-8. The first that is not
 * is named, with why.
 */
export async function readWorkspaceFiles(
  workspace: string,
  paths: readonly string[],
  options?: { signal?: AbortSignal | undefined; preserveExecutable?: boolean },
): Promise<WorkspaceFilesResult> {
  const { signal, preserveExecutable } = options ?? {};
  signal?.throwIfAborted();
  if (paths.length === 0) return { files: [] };
  const root = await realpath(workspace);
  const files: SavedCodeInput[] = [];
  for (const path of paths) {
    signal?.throwIfAborted();
    const found = await plainFile(root, path);
    signal?.throwIfAborted();
    if ("problem" in found) return { path, problem: found.problem };
    const { full, entry } = found;
    if (entry.size > CODE_FILE_LIMIT) return { path, problem: "too-large" };
    const bytes = await readFile(
      full,
      signal === undefined ? undefined : { signal },
    );
    signal?.throwIfAborted();
    if (bytes.length > CODE_FILE_LIMIT) return { path, problem: "too-large" };
    try {
      const content = new TextDecoder("utf-8", {
        fatal: true,
        ignoreBOM: true,
      }).decode(bytes);
      files.push(
        preserveExecutable === true && (entry.mode & 0o111) !== 0
          ? { path, content, executable: true }
          : { path, content },
      );
    } catch {
      return { path, problem: "not-text" };
    }
  }
  return { files };
}

/**
 * The full path of a code question's file, by its path in the workspace,
 * if it is a plain file there; otherwise why not, as `fileProblem` says it.
 */
export async function workspaceFile(
  workspace: string,
  path: string,
): Promise<{ full: string } | { problem: FileProblem }> {
  const found = await plainFile(await realpath(workspace), path);
  return "problem" in found ? found : { full: found.full };
}

/** The file by its path in the workspace's real folder, if it is a plain file there. */
async function plainFile(
  root: string,
  path: string,
): Promise<
  { full: string; entry: Stats } | { problem: "missing" | "not-a-file" }
> {
  const prefix = root.endsWith(sep) ? root : `${root}${sep}`;
  const full = join(root, path);
  if (!full.startsWith(prefix)) return { problem: "not-a-file" };
  let entry: Stats;
  try {
    entry = await lstat(full);
  } catch {
    return { problem: "missing" };
  }
  // Reject links, including in parent folders: a declared path must name
  // a plain file directly, not an alias for another workspace path.
  if (!entry.isFile() || (await realpath(full)) !== full) {
    return { problem: "not-a-file" };
  }
  return { full, entry };
}

/** "`bpe.py` is larger than 100 KB.", and so on. */
export function fileProblem(found: {
  path: string;
  problem: FileProblem;
}): string {
  const { path, problem } = found;
  switch (problem) {
    case "missing":
      return `"${path}" is not in the workspace.`;
    case "not-a-file":
      return `"${path}" in the workspace is not a plain file.`;
    case "too-large":
      return `"${path}" is larger than ${CODE_FILE_LIMIT / 1000} KB.`;
    case "not-text":
      return `"${path}" is not text in UTF-8.`;
  }
}

/** Writes the exercise into its own folder, sharing only the environment. */
async function populate(
  folder: string,
  venv: string,
  files: readonly SavedCodeInput[],
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  const installed = await lstat(venv).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
    return undefined;
  });
  signal?.throwIfAborted();
  if (installed !== undefined) {
    await symlink(venv, join(folder, ".venv"));
  }
  for (const file of files) {
    signal?.throwIfAborted();
    const at = join(folder, file.path);
    await mkdir(dirname(at), { recursive: true });
    signal?.throwIfAborted();
    await writeFile(
      at,
      file.content,
      file.executable ? { mode: 0o755 } : undefined,
    );
  }
}

/** The last lines of what a command wrote, without blank ones, then `last`. */
function outputEnd(text: string, last?: string): string {
  const lines = text
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line !== "");
  if (last !== undefined) lines.push(last);
  let end = lines.slice(-OUTPUT_LINES).join("\n");
  if (end.length > OUTPUT_CHARS) {
    end = end.slice(-OUTPUT_CHARS);
    const cut = end.indexOf("\n");
    if (cut !== -1) end = end.slice(cut + 1);
  }
  return end;
}
