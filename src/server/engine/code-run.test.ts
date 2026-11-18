// A code question's tests as the engine runs them (task 3.7): in a folder
// that mirrors the workspace, in the real sandbox, so these tests need what
// the sandbox needs and fail where it cannot run. The tests run on the
// project's own pytest, in `pytools/.venv`, which a workspace's `.venv`
// links to here as an installed environment would be there.

import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  test,
} from "vitest";
import type { CodeQuestion } from "../../shared/question.ts";
import { sandboxPython } from "../sandbox-command.ts";
import {
  type CodeRunner,
  createCodeRunner,
  gradeCode,
  readWorkspaceFiles,
} from "./code-run.ts";
import { type Sandbox, startSandbox } from "./sandbox.ts";

let sandbox: Extract<Sandbox, { available: true }>;
let runner: CodeRunner;
beforeAll(async () => {
  const started = await startSandbox({ log: () => {} });
  if (!started.available) {
    throw new Error(`These tests need the sandbox: ${started.reason}`);
  }
  sandbox = started;
  runner = createCodeRunner({ sandbox });
});
afterAll(async () => {
  await sandbox?.close();
});

let workspace: string;
beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "gauss-code-test-"));
  // The workspace's environment, as an install would leave it.
  await symlink(dirname(dirname(sandboxPython)), join(workspace, ".venv"));
});
afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

const STARTER = `def most_common_pair(ids):
    raise NotImplementedError
`;
const SOLUTION = `from counting import pairs


def most_common_pair(ids):
    counts = {}
    for pair in pairs(ids):
        counts[pair] = counts.get(pair, 0) + 1
    return max(counts, key=counts.get)
`;
/** A helper the solution imports, which stays in the workspace. */
const HELPER = `def pairs(ids):
    return list(zip(ids, ids[1:]))
`;
const TESTS = `from bpe import most_common_pair


def test_one_pair():
    assert most_common_pair([1, 2, 3, 1, 2]) == (1, 2)


def test_tie_takes_the_first():
    assert most_common_pair([5, 6, 7, 8, 5, 6, 7, 8]) == (5, 6)
`;

const QUESTION: CodeQuestion = {
  kind: "code",
  prompt: "Finish `most_common_pair(ids)` in `bpe.py`.",
  files: ["bpe.py"],
  tests: [{ path: "test_bpe.py", content: TESTS }],
  solution: [{ path: "bpe.py", content: SOLUTION }],
  command: [".venv/bin/python", "-m", "pytest", "-q", "test_bpe.py"],
};

async function write(path: string, content: string) {
  await mkdir(dirname(join(workspace, path)), { recursive: true });
  await writeFile(join(workspace, path), content);
}

test("the tests pass on the solution, through the workspace's environment and with the workspace's other files, and leave the workspace as it was", async () => {
  await write("bpe.py", STARTER);
  await write("counting.py", HELPER);
  // The caches a run of pytest in the workspace leaves, as the tutor's might.
  await mkdir(join(workspace, ".pytest_cache"));
  await mkdir(join(workspace, "__pycache__"));

  const ran = await runner.run(QUESTION, QUESTION.solution, workspace);

  expect(ran).toMatchObject({ result: "passed", exitCode: 0 });
  expect(ran.result === "passed" && ran.output).toMatch(/^2 passed in /m);
  // Nothing of the run is left in the workspace: no test file, no caches.
  expect((await readdir(workspace)).sort()).toEqual([
    ".pytest_cache",
    ".venv",
    "__pycache__",
    "bpe.py",
    "counting.py",
  ]);
  expect(await readdir(join(workspace, "__pycache__"))).toEqual([]);
});

test("a failing run is a miss whose output's end says which test failed and why", async () => {
  await write("counting.py", HELPER);
  const answer = {
    kind: "code" as const,
    questionId: "q1",
    confidence: "75" as const,
    // Keeps the last of the tied pairs.
    files: [
      {
        path: "bpe.py",
        content: SOLUTION.replace(
          "return max(counts, key=counts.get)",
          "return max(reversed(counts), key=counts.get)",
        ),
      },
    ],
  };

  const graded = await gradeCode(runner, QUESTION, answer, workspace);

  expect(graded).toMatchObject({ ok: true, verdict: "incorrect" });
  const output = graded.ok ? graded.output : "";
  expect(output).toContain("FAILED test_bpe.py::test_tie_takes_the_first");
  expect(output).toMatch(/1 failed, 1 passed in /);
  expect(output.split("\n").at(-1)).toBe("Exit status 1.");
});

test("a question is refused when its tests pass on the starter files, and when they fail on the solution, with the output", async () => {
  await write("counting.py", HELPER);
  await write("bpe.py", SOLUTION);
  const passes = await runner.check(QUESTION, workspace);
  expect(passes?.refused).toContain(
    "The tests pass on the starter files in the workspace",
  );

  await write("bpe.py", STARTER);
  const wrong = {
    ...QUESTION,
    solution: [
      {
        path: "bpe.py",
        content: "def most_common_pair(ids):\n    return (1, 2)\n",
      },
    ],
  };
  const fails = await runner.check(wrong, workspace);
  expect(fails?.refused).toContain("The tests fail on your solution");
  expect(fails?.refused).toContain(
    "FAILED test_bpe.py::test_tie_takes_the_first",
  );

  expect(await runner.check(QUESTION, workspace)).toBeUndefined();
});

test("a question whose starter file is not in the workspace is refused, saying to write it first", async () => {
  const refused = await runner.check(QUESTION, workspace);
  expect(refused?.refused).toBe(
    '"bpe.py" is not in the workspace. Write its starter version there with your Write tool first, then post the question.',
  );
});

test("a run past its time limit is stopped, and its grading fails with the output's end", async () => {
  const quick = createCodeRunner({ sandbox, timeLimitMs: 1500 });
  const answer = {
    kind: "code" as const,
    questionId: "q1",
    confidence: "50" as const,
    files: [
      {
        path: "bpe.py",
        content:
          "print('counting', flush=True)\n\ndef most_common_pair(ids):\n    while True:\n        pass\n",
      },
    ],
  };

  const graded = await gradeCode(quick, QUESTION, answer, workspace);

  expect(graded.ok).toBe(false);
  if (graded.ok) return;
  expect(graded.error).toContain("ran past their time limit");
  expect(graded.timedOut?.output.split("\n").at(-1)).toBe(
    "Stopped after 2 seconds, the time limit of the tests.",
  );
});

test("files in subfolders are written in folders of their own, beside links to the workspace's other entries", async () => {
  await write("src/bpe.py", STARTER);
  await write("src/counting.py", HELPER);
  await write("data/ids.txt", "1 2 3\n");
  const nested: CodeQuestion = {
    ...QUESTION,
    files: ["src/bpe.py"],
    tests: [
      {
        path: "tests/test_bpe.py",
        content: `import sys
sys.path.insert(0, "src")
from bpe import most_common_pair


def test_reads_the_data():
    ids = [int(w) for w in open("data/ids.txt").read().split()]
    assert most_common_pair(ids + ids[:2]) == (1, 2)
`,
      },
    ],
    solution: [{ path: "src/bpe.py", content: SOLUTION }],
    command: [".venv/bin/python", "-m", "pytest", "-q", "tests"],
  };

  expect(await runner.check(nested, workspace)).toBeUndefined();
  expect((await readdir(join(workspace, "src"))).sort()).toEqual([
    "bpe.py",
    "counting.py",
  ]);
});

test("the learner's files are read as plain text files inside the workspace, and the first that is not is named", async () => {
  await write("bpe.py", STARTER);
  await write("big.py", "x".repeat(100_001));
  await writeFile(
    join(workspace, "latin1.py"),
    Buffer.from([0x63, 0xe9, 0x0a]),
  );
  await symlink(join(workspace, "bpe.py"), join(workspace, "link.py"));

  expect(await readWorkspaceFiles(workspace, ["bpe.py"])).toEqual({
    files: [{ path: "bpe.py", content: STARTER }],
  });
  expect(await readWorkspaceFiles(workspace, ["bpe.py", "gone.py"])).toEqual({
    path: "gone.py",
    problem: "missing",
  });
  expect(await readWorkspaceFiles(workspace, ["big.py"])).toEqual({
    path: "big.py",
    problem: "too-large",
  });
  expect(await readWorkspaceFiles(workspace, ["latin1.py"])).toEqual({
    path: "latin1.py",
    problem: "not-text",
  });
  expect(await readWorkspaceFiles(workspace, ["link.py"])).toEqual({
    path: "link.py",
    problem: "not-a-file",
  });
});

test("a run cannot change the workspace through the links to it", async () => {
  await write("counting.py", HELPER);
  const sneaky: CodeQuestion = {
    ...QUESTION,
    tests: [
      {
        path: "test_bpe.py",
        content: `import errno


def test_the_links_are_read_only():
    for path in ("counting.py", ".venv/planted.txt"):
        try:
            with open(path, "w") as f:
                f.write("changed")
        except OSError as error:
            assert error.errno in (errno.EROFS, errno.EACCES, errno.EPERM)
        else:
            raise AssertionError(f"wrote {path} through the link")
`,
      },
    ],
  };

  const ran = await runner.run(sneaky, QUESTION.solution, workspace);

  expect(ran).toMatchObject({ result: "passed" });
  expect(await readFile(join(workspace, "counting.py"), "utf8")).toBe(HELPER);
});
