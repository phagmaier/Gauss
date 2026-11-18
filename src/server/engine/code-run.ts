// Code questions in the engine (architecture.md section 6; task 3.7). A code
// question names files in the course's workspace that the learner edits in
// their own editor, and carries the grading material, which the record keeps
// and the workspace never holds: the tests, the tutor's solution, and the
// command that runs the tests.
//
// Every run of the tests has a folder of its own that mirrors the workspace:
// the files under test are written there (the starter versions, the
// solution, or the learner's files as they were when "Run the tests" was
// pressed), the test files at their paths, and every other entry of the
// workspace, `.venv` among them, is a link to it. The command runs there in
// the engine's sandbox, which writes only to that folder and to its own
// temporary one, so a run never changes the workspace, and the files the
// tests ran on are the ones the record keeps. Exit status 0 is a pass.
//
// When the question is posted, the tests must fail on the starter files the
// tutor wrote in the workspace and pass on its solution: tests that cannot
// tell right code from wrong are a code question's wrong key.

import type { Dirent } from "node:fs";
import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
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
} from "../../shared/question.ts";
import { duration } from "./grading.ts";
import type { Sandbox } from "./sandbox.ts";

/** How long one run of a question's tests may take. */
export const CODE_TIME_LIMIT_MS = 60_000;

/** How much of a run's output's end is kept: lines, then characters. */
const OUTPUT_LINES = 40;
const OUTPUT_CHARS = 8000;

/**
 * Entries of the workspace a run's folder does not link to, in the folders
 * it makes itself: Python's compiled files, which could be stale for a file
 * written in their place, and pytest's cache, which a run cannot write.
 */
const NOT_LINKED = new Set(["__pycache__", ".pytest_cache"]);

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
  /**
   * Whether the question can be posted: its starter files are in the
   * workspace, and its tests fail on them and pass on its solution. Nothing,
   * or the reason it cannot, for the tutor.
   */
  check(
    question: CodeQuestion,
    workspace: string,
  ): Promise<{ refused: string } | undefined>;
  /** Runs the question's tests on these files. Never throws. */
  run(
    question: CodeQuestion,
    files: readonly CodeFile[],
    workspace: string,
  ): Promise<CodeRunResult>;
}

/**
 * A runner with no sandbox: code questions are refused when posted, and an
 * answer to one posted earlier fails its grading, to be graded again.
 */
export const noCodeRunner: CodeRunner = {
  check: async () => ({
    refused:
      "Code questions need the sandbox that runs their tests, and it does not run here. Ask another kind of question.",
  }),
  run: async () => ({
    result: "error",
    reason: "the sandbox that runs the tests is not available",
  }),
};

export function createCodeRunner(options: {
  sandbox: Sandbox;
  timeLimitMs?: number;
}): CodeRunner {
  const { sandbox } = options;
  const timeLimitMs = options.timeLimitMs ?? CODE_TIME_LIMIT_MS;
  const limit = duration(timeLimitMs);

  async function run(
    question: CodeQuestion,
    files: readonly CodeFile[],
    workspace: string,
  ): Promise<CodeRunResult> {
    if (!sandbox.available) {
      return {
        result: "error",
        reason: `there is no sandbox to run them in (${sandbox.reason})`,
      };
    }
    let folder: string | undefined;
    try {
      folder = await mkdtemp(join(tmpdir(), "gauss-code-"));
      await mirror(folder, workspace, [...files, ...question.tests]);
      const [program, ...rest] = question.command;
      const ran = await sandbox.run({
        argv: [program ?? "", ...rest],
        cwd: folder,
        writable: [folder],
        timeLimitMs,
        mergeOutput: true,
      });
      if (ran.timedOut) {
        return {
          result: "timed-out",
          output: outputEnd(
            ran.stdout,
            `Stopped after ${limit}, the time limit of the tests.`,
          ),
        };
      }
      const exitCode = ran.exitCode ?? 1;
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
    async check(question, workspace) {
      let starter: Awaited<ReturnType<typeof readWorkspaceFiles>>;
      try {
        starter = await readWorkspaceFiles(workspace, question.files);
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
      // Both at once: posting waits for the slower.
      const [solved, started] = await Promise.all([
        run(question, question.solution, workspace),
        run(question, starter.files, workspace),
      ]);
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
        ? undefined
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
): Promise<CodeOutcome> {
  const ran = await runner.run(question, answer.files, workspace);
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

/**
 * Reads the files from the workspace, by their paths in it, as a code
 * question runs them: each a plain file inside the workspace, no larger
 * than a question's file may be, and text in UTF-8. The first that is not
 * is named, with why.
 */
export async function readWorkspaceFiles(
  workspace: string,
  paths: readonly string[],
): Promise<{ files: CodeFile[] } | { path: string; problem: FileProblem }> {
  const root = await realpath(workspace);
  const files: CodeFile[] = [];
  for (const path of paths) {
    const full = join(root, path);
    let entry: Awaited<ReturnType<typeof lstat>>;
    try {
      entry = await lstat(full);
    } catch {
      return { path, problem: "missing" };
    }
    // A link, or a folder on the way that is one, could lead out of it.
    if (
      !entry.isFile() ||
      !(await realpath(full)).startsWith(`${root}${sep}`)
    ) {
      return { path, problem: "not-a-file" };
    }
    if (entry.size > CODE_FILE_LIMIT) return { path, problem: "too-large" };
    const bytes = await readFile(full);
    if (bytes.length > CODE_FILE_LIMIT) return { path, problem: "too-large" };
    try {
      const content = new TextDecoder("utf-8", {
        fatal: true,
        ignoreBOM: true,
      }).decode(bytes);
      files.push({ path, content });
    } catch {
      return { path, problem: "not-text" };
    }
  }
  return { files };
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

/**
 * Makes `folder` mirror the workspace: `files` written at their paths, and
 * every other entry of the workspace linked, except in the folders that
 * hold a written file, which are made here, their other entries linked.
 */
async function mirror(
  folder: string,
  workspace: string,
  files: readonly CodeFile[],
): Promise<void> {
  const written = new Set(files.map((f) => f.path));
  const made = new Set(
    files.flatMap((f) => {
      const words = f.path.split("/");
      return words.slice(1).map((_, i) => words.slice(0, i + 1).join("/"));
    }),
  );
  async function link(path: string): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await readdir(join(workspace, path), { withFileTypes: true });
    } catch {
      return; // A folder the workspace does not have: nothing to link.
    }
    for (const entry of entries) {
      const at = path === "" ? entry.name : `${path}/${entry.name}`;
      if (written.has(at) || NOT_LINKED.has(entry.name)) continue;
      if (made.has(at)) {
        // A file of the workspace where a folder is made is left out.
        if (entry.isDirectory()) {
          await mkdir(join(folder, at));
          await link(at);
        }
        continue;
      }
      await symlink(join(workspace, at), join(folder, at));
    }
  }
  await link("");
  for (const file of files) {
    const at = join(folder, file.path);
    await mkdir(dirname(at), { recursive: true });
    await writeFile(at, file.content);
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
