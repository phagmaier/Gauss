// A code question's tests as the engine runs them (task 3.7): in their own
// exercise folder, in the real sandbox, so these tests fail where the
// sandbox cannot run. The workspace's `.venv` links to `pytools/.venv` to
// run the project's own pytest.

import {
  chmod,
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
import { type CodeAnswer, CodeQuestion } from "../../shared/question.ts";
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
/** A workspace helper the solution imports. */
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
const DEPENDENCIES = ["counting.py"];
const EXERCISE = {
  ...QUESTION,
  inputs: [{ path: "counting.py", content: HELPER }],
};

function submission(files = QUESTION.solution): CodeAnswer {
  return { kind: "code", questionId: "q1", confidence: "75", files };
}

async function write(path: string, content: string) {
  await mkdir(dirname(join(workspace, path)), { recursive: true });
  await writeFile(join(workspace, path), content);
}

test("a published exercise keeps its helper and executable launcher when their sources change", async () => {
  await write("bpe.py", STARTER);
  await write("counting.py", HELPER);
  const launcher =
    "#!/bin/sh\nexec .venv/bin/python -m pytest -q test_bpe.py\n";
  await write("run-tests.sh", launcher);
  await chmod(join(workspace, "run-tests.sh"), 0o755);
  // The caches a run of pytest in the workspace leaves, as the tutor's might.
  await mkdir(join(workspace, ".pytest_cache"));
  await mkdir(join(workspace, "__pycache__"));

  const checked = await runner.check(
    { ...QUESTION, command: ["./run-tests.sh"] },
    workspace,
    [...DEPENDENCIES, "run-tests.sh"],
  );
  if ("refused" in checked) throw new Error(checked.refused);
  const question = CodeQuestion.parse(
    JSON.parse(JSON.stringify(checked.question)),
  );
  expect(question.inputs).toEqual([
    { path: "counting.py", content: HELPER },
    { path: "run-tests.sh", content: launcher, executable: true },
  ]);
  const changed = "def pairs(ids):\n    return []\n";
  await write("counting.py", changed);
  await chmod(join(workspace, "run-tests.sh"), 0o644);

  const graded = await gradeCode(runner, question, submission(), workspace);

  expect(graded).toMatchObject({ ok: true, verdict: "correct" });
  expect(graded.ok && graded.output).toMatch(/^2 passed in /m);
  // Nothing of the run is left in the workspace: no test file, no caches.
  expect((await readdir(workspace)).sort()).toEqual([
    ".pytest_cache",
    ".venv",
    "__pycache__",
    "bpe.py",
    "counting.py",
    "run-tests.sh",
  ]);
  expect(await readdir(join(workspace, "__pycache__"))).toEqual([]);
  expect(await readFile(join(workspace, "counting.py"), "utf8")).toBe(changed);
});

test("a failing run is a miss whose output's end says which test failed and why", async () => {
  // Keeps the last of the tied pairs.
  const answer = submission([
    {
      path: "bpe.py",
      content: SOLUTION.replace(
        "return max(counts, key=counts.get)",
        "return max(reversed(counts), key=counts.get)",
      ),
    },
  ]);

  const graded = await gradeCode(runner, EXERCISE, answer, workspace);

  expect(graded).toMatchObject({ ok: true, verdict: "incorrect" });
  const output = graded.ok ? graded.output : "";
  expect(output).toContain("FAILED test_bpe.py::test_tie_takes_the_first");
  expect(output).toMatch(/1 failed, 1 passed in /);
  expect(output.split("\n").at(-1)).toBe("Exit status 1.");
});

test("a question is refused when its tests pass on the starter files, and when they fail on the solution, with the output", async () => {
  await write("counting.py", HELPER);
  await write("bpe.py", SOLUTION);
  const passes = await runner.check(QUESTION, workspace, DEPENDENCIES);
  expect(passes).toHaveProperty(
    "refused",
    expect.stringContaining(
      "The tests pass on the starter files in the workspace",
    ),
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
  const fails = await runner.check(wrong, workspace, DEPENDENCIES);
  expect(fails).toHaveProperty(
    "refused",
    expect.stringContaining("The tests fail on your solution"),
  );
  expect(fails).toHaveProperty(
    "refused",
    expect.stringContaining("FAILED test_bpe.py::test_tie_takes_the_first"),
  );
});

test("a question whose starter file is not in the workspace is refused, saying to write it first", async () => {
  const refused = await runner.check(QUESTION, workspace, DEPENDENCIES);
  expect(refused).toHaveProperty(
    "refused",
    '"bpe.py" is not in the workspace. Write its starter version there with your Write tool first, then post the question.',
  );
});

test("a missing declared dependency prevents publication", async () => {
  await write("bpe.py", STARTER);
  expect(await runner.check(QUESTION, workspace, DEPENDENCIES)).toHaveProperty(
    "refused",
    expect.stringContaining(
      'Dependency "counting.py" is not in the workspace.',
    ),
  );
});

test("imports cannot fall back to files left undeclared in the workspace", async () => {
  await write("bpe.py", STARTER);
  await write("counting.py", HELPER);

  expect(await runner.check(QUESTION, workspace, [])).toHaveProperty(
    "refused",
    expect.stringContaining("ModuleNotFoundError: No module named 'counting'"),
  );
});

test("an old open question with no snapshot cannot be graded", async () => {
  const legacy = CodeQuestion.parse(QUESTION);
  const graded = await gradeCode(runner, legacy, submission(), workspace);
  expect(graded).toMatchObject({
    ok: false,
    error: expect.stringContaining("predates saved exercise inputs"),
  });
});

test("grading fails without a verdict when the published command cannot launch", async () => {
  await write("bpe.py", STARTER);
  const standalone = {
    ...QUESTION,
    solution: [
      {
        path: "bpe.py",
        content: SOLUTION.replace("from counting import pairs", HELPER),
      },
    ],
  };
  const checked = await runner.check(standalone, workspace, []);
  if ("refused" in checked) throw new Error(checked.refused);
  expect(checked.question.inputs).toEqual([]);
  await rm(join(workspace, ".venv"));

  const graded = await gradeCode(
    runner,
    checked.question,
    submission(standalone.solution),
    workspace,
  );
  expect(graded).toEqual({
    ok: false,
    error: expect.stringContaining("The tests could not be run:"),
  });
});

test("a run past its time limit is stopped, and its grading fails with the output's end", async () => {
  const quick = createCodeRunner({ sandbox, timeLimitMs: 1500 });
  const answer = submission([
    {
      path: "bpe.py",
      content:
        "print('counting', flush=True)\n\ndef most_common_pair(ids):\n    while True:\n        pass\n",
    },
  ]);

  const graded = await gradeCode(quick, EXERCISE, answer, workspace);

  expect(graded.ok).toBe(false);
  if (graded.ok) return;
  expect(graded.error).toContain("ran past their time limit");
  expect(graded.timedOut?.output.split("\n").at(-1)).toBe(
    "Stopped after 2 seconds, the time limit of the tests.",
  );
});

test("nested learner files, tests and dependency files retain their paths", async () => {
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

  const checked = await runner.check(nested, workspace, [
    "src/counting.py",
    "data/ids.txt",
  ]);
  expect(checked).toMatchObject({
    question: {
      inputs: [
        { path: "src/counting.py", content: HELPER },
        { path: "data/ids.txt", content: "1 2 3\n" },
      ],
    },
  });
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
  await symlink(workspace, join(workspace, "alias"));

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
  expect(await readWorkspaceFiles(workspace, ["alias/bpe.py"])).toEqual({
    path: "alias/bpe.py",
    problem: "not-a-file",
  });
});

test("a run cannot write through the environment link or change a workspace dependency", async () => {
  await write("counting.py", HELPER);
  const sneaky: CodeQuestion = {
    ...EXERCISE,
    tests: [
      {
        path: "test_bpe.py",
        content: `import errno


def test_the_workspace_is_unchanged():
    with open("counting.py", "w") as f:
        f.write("changed")
    try:
        with open(".venv/planted.txt", "w") as f:
            f.write("changed")
    except OSError as error:
        assert error.errno in (errno.EROFS, errno.EACCES, errno.EPERM)
    else:
        raise AssertionError("wrote through the environment link")
`,
      },
    ],
  };

  const ran = await runner.run(sneaky, QUESTION.solution, workspace);

  expect(ran).toMatchObject({ result: "passed" });
  expect(await readFile(join(workspace, "counting.py"), "utf8")).toBe(HELPER);
});
