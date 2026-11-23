// Code questions through the unit chat (task 3.7): the tutor writes a starter
// file in the workspace and posts the question with its tests, its solution
// and its command; the engine runs the tests on the starter and on the
// solution before it posts; "Run the tests" reads the learner's files and
// runs the tests on them. The tutor is the fake backend, the runs are real,
// in the real sandbox, on the project's own pytest (`pytools/.venv`, which
// the workspace's `.venv` links to here, as an install would leave it), so
// these tests need what the sandbox needs and fail where it cannot run.

import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
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
  onTestFinished,
  test,
} from "vitest";
import type { CurriculumProposal } from "../../shared/curriculum.ts";
import type { Plan } from "../../shared/plan.ts";
import { emptyTimeline, reduce } from "../../shared/timeline.ts";
import { nextStep, openQuestion } from "../../web/session.ts";
import { answerLine } from "../../web/what-i-know.ts";
import {
  createFakeBackend,
  type FakeStep,
  type FakeTurn,
} from "../backends/fake.ts";
import { openDataRoot } from "../record/data-root.ts";
import { whatIKnow } from "../record/what-i-know.ts";
import { sandboxPython } from "../sandbox-command.ts";
import { givenOrder } from "./choice-order.ts";
import { type CodeRunner, createCodeRunner, noCodeRunner } from "./code-run.ts";
import { createFakeTimer } from "./fake-timer.ts";
import { createGrader } from "./grading.ts";
import { createHelpJudge } from "./help-judge.ts";
import { type Sandbox, startSandbox } from "./sandbox.ts";
import { createUnitChats, type UnitChat } from "./unit-chat.ts";
import { createUnitPlanner } from "./unit-planning.ts";

let sandbox: Extract<Sandbox, { available: true }>;
let runner: CodeRunner;
beforeAll(async () => {
  // The records are made per test, outside the data root it closes.
  const started = await startSandbox({
    log: () => {},
    dataRoot: join(tmpdir(), "gauss-no-record"),
  });
  if (!started.available) {
    throw new Error(`These tests need the sandbox: ${started.reason}`);
  }
  sandbox = started;
  runner = createCodeRunner({ sandbox });
});
afterAll(async () => {
  await sandbox?.close();
});

// Each test gets its own data root; none touches ~/gauss (AGENTS.md).
let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "gauss-code-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const NOW = "2026-11-17T10:00:00.000Z";
const COURSE = "tokenization";
const CURRICULUM: CurriculumProposal = {
  title: "Tokenization",
  units: [
    {
      id: "bpe",
      title: "Byte-pair encoding",
      goal: "Write the steps of byte-pair encoding.",
      prerequisites: [],
    },
  ],
  style: "Short.",
  background: "The learner writes Python.",
};
const PLAN: Plan = {
  objectives: [
    { id: "count-pairs", statement: "Count the neighbouring pairs of a list." },
  ],
  segments: [{ title: "Pairs", objectives: ["count-pairs"] }],
};

const STARTER = `def most_common_pair(ids):
    raise NotImplementedError
`;
const SOLUTION = `def most_common_pair(ids):
    counts = {}
    for pair in zip(ids, ids[1:]):
        counts[pair] = counts.get(pair, 0) + 1
    return max(counts, key=counts.get)
`;
/** Keeps the last of tied pairs, where the question asks for the first. */
const LAST_OF_TIED = SOLUTION.replace("max(counts,", "max(reversed(counts),");
const TESTS = `from bpe import most_common_pair


def test_one_pair():
    assert most_common_pair([1, 2, 3, 1, 2]) == (1, 2)


def test_tie_takes_the_first():
    assert most_common_pair([5, 6, 7, 8, 5, 6, 7, 8]) == (5, 6)
`;
const PROMPT =
  "Finish `most_common_pair(ids)` in `bpe.py`: the pair of neighbouring ids that occurs most often, the first one on a tie.";
const CODE = {
  objective: "count-pairs",
  kind: "code" as const,
  prompt: PROMPT,
  files: ["bpe.py"],
  tests: [{ path: "test_bpe.py", content: TESTS }],
  solution: [{ path: "bpe.py", content: SOLUTION }],
  command: [".venv/bin/python", "-m", "pytest", "-q", "test_bpe.py"],
};
const QUESTION = (({ objective: _, ...rest }) => ({ ...rest, inputs: [] }))(
  CODE,
);

const TEACH: FakeTurn = [{ text: "Count each pair." }];
/** The tutor writes the starter file, then posts the question. */
const ask = (question: unknown, starter = STARTER): FakeStep[] => [
  { builtIn: "Write", path: "bpe.py", content: starter },
  { text: "One on counting pairs." },
  { call: "ask_question", input: question },
];
const FEEDBACK: FakeTurn = [{ text: "Feedback." }];

async function seedCourse() {
  const root = openDataRoot({ path: dir, now: () => new Date(NOW) });
  const { id } = await root.createCourse({ title: CURRICULUM.title });
  await root.saveProposal(id, CURRICULUM);
  await root.approveCurriculum(id, CURRICULUM);
  await root.storePlan(id, "bpe", PLAN);
  const workspace = await root.workspaceFolder(id);
  // The workspace's environment, as installing pytest would leave it.
  await symlink(dirname(dirname(sandboxPython)), join(workspace, ".venv"));
  return workspace;
}

/** The course, its unit planned, then the unit opened and in its check. */
async function setUp(script: FakeTurn[], codeRunner: CodeRunner = runner) {
  const workspace = await seedCourse();
  const opened = await openChat(script, codeRunner);
  expect(await opened.chat.ready()).toEqual({ ok: true });
  await opened.chat.settled();
  return { ...opened, workspace };
}

async function openChat(
  script: FakeTurn[],
  codeRunner: CodeRunner,
  path: string = dir,
) {
  const root = openDataRoot({ path, now: () => new Date(NOW) });
  const backend = createFakeBackend(script);
  const units = createUnitChats({
    backend,
    systemPrompt: "Tutor.",
    dataRoot: root,
    planner: createUnitPlanner({
      backend,
      systemPrompt: "Plan.",
      dataRoot: root,
    }),
    grader: createGrader({ backend, systemPrompt: "Grader." }),
    judge: createHelpJudge({ backend, systemPrompt: "Judge." }),
    codeRunner,
    workspaceTools: sandbox.reads,
    now: () => new Date(NOW),
    timer: createFakeTimer(),
    order: givenOrder,
  });
  const opened = await units.open(COURSE, "bpe");
  if (!opened.ok) throw new Error(opened.error);
  const chat = opened.chat;
  await chat.settled();
  return { backend, root, units, chat };
}

function openQuestionId(chat: UnitChat): string {
  const posted = chat.events().findLast((e) => e.type === "question");
  if (posted?.type !== "question") throw new Error("no question posted");
  return posted.question.id;
}

/** The learner's file as they leave it in their editor. */
async function edit(workspace: string, content: string, path = "bpe.py") {
  await mkdir(dirname(join(workspace, path)), { recursive: true });
  await writeFile(join(workspace, path), content);
}

async function runTests(
  chat: UnitChat,
  confidence: "50" | "90" = "50",
  reasoning?: string,
) {
  const result = await chat.answer({
    kind: "code",
    questionId: openQuestionId(chat),
    confidence,
    ...(reasoning === undefined ? {} : { reasoning }),
  });
  expect(result).toEqual({ ok: true });
  await chat.settled();
}

/** The turn that told the tutor the grade of question 1. */
function answerTurn(backend: { received: { text: string }[] }): string {
  const turn = backend.received.find((t) =>
    t.text.includes("The learner answered question 1."),
  );
  if (turn === undefined) throw new Error("no answer turn");
  return turn.text;
}

/** The answer's line in "What I know", as the server derives it and the page words it. */
async function known(root: ReturnType<typeof openDataRoot>) {
  const stored = await root.readCourse(COURSE);
  if (stored?.curriculum === undefined || stored.curriculum === null) {
    throw new Error("no curriculum");
  }
  const view = whatIKnow(
    stored.course.title,
    stored.curriculum,
    await root.readState(COURSE),
    await root.readEvidence(COURSE),
  );
  const objective = view.units[0]?.objectives?.[0];
  const entry = objective?.evidence[0];
  if (entry?.kind !== "answer") throw new Error("no answer shown");
  return { status: objective?.status, entry, line: answerLine(entry) };
}

test("a code question is posted once its tests fail on the starter and pass on the solution, and the card names the file by its full path", async () => {
  const { backend, chat, workspace } = await setUp([TEACH, ask(CODE)]);

  expect(chat.events()).toContainEqual({
    type: "file_written",
    path: "bpe.py",
  });
  expect(chat.events()).toContainEqual({
    type: "question",
    question: {
      kind: "code",
      id: openQuestionId(chat),
      number: 1,
      prompt: PROMPT,
      files: [join(workspace, "bpe.py")],
    },
  });
  expect(backend.calls.at(-1)?.result).toMatchObject({ status: "done" });
});

test.each([
  { ending: "with a final newline", tail: "  \n\n" },
  { ending: "without a final newline", tail: "  \n\n  " },
])("preserves submitted code $ending in feedback", async ({ tail }) => {
  const { backend, root, chat, workspace } = await setUp([
    TEACH,
    ask(CODE),
    FEEDBACK,
  ]);
  const submitted = SOLUTION + tail;
  await edit(workspace, submitted);

  await runTests(chat, "90");

  const questionId = openQuestionId(chat);
  const answer = {
    kind: "code",
    questionId,
    confidence: "90",
    files: [{ path: "bpe.py", content: submitted }],
  };
  expect(chat.events()).toContainEqual({
    type: "grading",
    questionId,
    answer,
  });
  const graded = chat.events().find((e) => e.type === "graded");
  expect(graded).toMatchObject({
    questionId,
    verdict: "correct",
    answer,
    assisted: false,
  });
  const output = graded?.type === "graded" ? graded.output : undefined;
  expect(output).toMatch(/^2 passed in /m);
  const [entry] = await root.readEvidence(COURSE);
  expect(entry).toEqual({
    kind: "answer",
    recordedAt: NOW,
    objective: "count-pairs",
    question: QUESTION,
    answer,
    assisted: false,
    verdict: "correct",
    output,
  });
  // No model graded it.
  expect(backend.oneShots).toEqual([]);
  const turn = answerTurn(backend);
  const fileBlock = /^bpe\.py:\n```\n(.*?)\n```\n\n/ms.exec(turn);
  expect(fileBlock?.[1]).toBe(submitted);
  expect(turn).toContain(
    "The learner ran the tests, at 90% confidence, on their files as they were then:\n\n" +
      "bpe.py:\n```\n",
  );
  expect(turn).toContain(
    "\n```\n\n" +
      "They gave no reasoning.\n" +
      "The tests passed: correct. The end of their output:",
  );

  // Passed at 90%; "What I know" names the file, never the tests.
  const { status, entry: shown, line } = await known(root);
  expect(status).toBe("passed");
  expect(shown.question).toEqual({
    kind: "code",
    prompt: PROMPT,
    files: ["bpe.py"],
  });
  expect(shown.output).toBe(output);
  expect(line.verdict.text).toBe("Correct");
});

test("a failing run is a miss that opens a detour, its output's end saying which test failed, and the tutor has the learner's reasoning", async () => {
  const { backend, root, chat, workspace } = await setUp([
    TEACH,
    ask(CODE),
    [{ text: "Ties keep the first pair." }],
  ]);
  await edit(workspace, LAST_OF_TIED);

  await runTests(chat, "50", "I compared counts with >=.");

  const questionId = openQuestionId(chat);
  expect(chat.events()).toContainEqual({
    type: "detour",
    questionId,
    number: 1,
  });
  const [entry] = await root.readEvidence(COURSE);
  expect(entry).toMatchObject({
    verdict: "incorrect",
    answer: {
      files: [{ path: "bpe.py", content: LAST_OF_TIED }],
      reasoning: "I compared counts with >=.",
    },
  });
  expect(entry).not.toHaveProperty("flaw");
  const output = entry?.kind === "answer" ? (entry.output ?? "") : "";
  expect(output).toContain("FAILED test_bpe.py::test_tie_takes_the_first");
  expect(output.split("\n").at(-1)).toBe("Exit status 1.");
  const turn = answerTurn(backend);
  expect(turn).toContain(
    "Their reasoning: I compared counts with >=.\n" +
      "The tests failed: incorrect. The end of their output:",
  );
  expect(turn).toContain("FAILED test_bpe.py::test_tie_takes_the_first");
  expect(turn).toContain("The miss opens a detour");
  expect(turn).toContain(
    "from the end of the tests' output, the files they ran and their reasoning",
  );
  expect((await known(root)).line.verdict.text).toBe("Not quite");
});

test("a file changed after it was submitted leaves the record as it was: the tests ran on the file as sent", async () => {
  const { root, chat, workspace } = await setUp([TEACH, ask(CODE), FEEDBACK]);
  await edit(workspace, SOLUTION);

  const result = await chat.answer({
    kind: "code",
    questionId: openQuestionId(chat),
    confidence: "50",
  });
  expect(result).toEqual({ ok: true });
  // Changed while the tests run, and again once they have.
  await edit(workspace, STARTER);
  await chat.settled();
  await edit(workspace, LAST_OF_TIED);

  const [entry] = await root.readEvidence(COURSE);
  expect(entry).toMatchObject({
    verdict: "correct",
    answer: { files: [{ path: "bpe.py", content: SOLUTION }] },
  });
});

test("a question whose tests pass on the starter is refused with the reason, and the tutor posts another in the same turn", async () => {
  const { backend, chat } = await setUp([
    TEACH,
    [
      // The "starter" already solves it.
      ...ask(CODE, SOLUTION),
      ...ask(CODE),
    ],
  ]);

  const [refused, posted] = backend.calls.filter(
    (c) => c.name === "ask_question",
  );
  expect(refused?.result.status).toBe("refused");
  expect(refused?.result.text).toContain(
    "The tests pass on the starter files in the workspace, so they cannot tell right code from wrong",
  );
  expect(posted?.result).toMatchObject({ status: "done" });
  expect(chat.events().filter((e) => e.type === "question")).toHaveLength(1);
});

test("a question whose tests fail on the solution is refused, with the end of their output", async () => {
  const { backend, chat } = await setUp([
    TEACH,
    ask({ ...CODE, solution: [{ path: "bpe.py", content: LAST_OF_TIED }] }),
  ]);

  const call = backend.calls.find((c) => c.name === "ask_question");
  expect(call?.result.status).toBe("refused");
  expect(call?.result.text).toContain("The tests fail on your solution");
  expect(call?.result.text).toContain(
    "FAILED test_bpe.py::test_tie_takes_the_first",
  );
  expect(chat.events().some((e) => e.type === "question")).toBe(false);
});

test("a run past its time limit fails its grading, to be run again; past it again on the same files, it is a miss", async () => {
  const quick = createCodeRunner({ sandbox, timeLimitMs: 1500 });
  const { root, chat, workspace } = await setUp(
    [TEACH, ask(CODE), [{ text: "The loop never ends." }]],
    quick,
  );
  const LOOPS = "def most_common_pair(ids):\n    while True:\n        pass\n";
  await edit(workspace, LOOPS);

  await runTests(chat);

  const questionId = openQuestionId(chat);
  expect(chat.events().at(-1)).toEqual({
    type: "grading_failed",
    questionId,
    error:
      "The tests ran past their time limit and were stopped. Your files are kept as you ran them. Run them again; if they run past it again, the answer is graded as a miss.",
  });
  expect(await root.readEvidence(COURSE)).toEqual([]);
  // Fixing the file now changes nothing: the answer was sent.
  await edit(workspace, SOLUTION);

  expect(await chat.gradeAgain()).toEqual({ ok: true });
  await chat.settled();

  const [entry] = await root.readEvidence(COURSE);
  expect(entry).toMatchObject({
    verdict: "incorrect",
    answer: { files: [{ path: "bpe.py", content: LOOPS }] },
  });
  const output = entry?.kind === "answer" ? (entry.output ?? "") : "";
  expect(output.split("\n").at(-1)).toBe(
    "Stopped after 2 seconds, the time limit of the tests.",
  );
  expect(chat.events()).toContainEqual({
    type: "detour",
    questionId,
    number: 1,
  });
});

test("'Run the tests' with a file gone from the workspace is refused, nothing recorded, and runs once it is back", async () => {
  const { root, chat, workspace } = await setUp([TEACH, ask(CODE), FEEDBACK]);
  await rm(join(workspace, "bpe.py"));

  const refused = await chat.answer({
    kind: "code",
    questionId: openQuestionId(chat),
    confidence: "50",
  });

  expect(refused).toEqual({
    ok: false,
    status: 409,
    error: `"bpe.py" is not in the workspace. Nothing was run or recorded: put it right at ${join(workspace, "bpe.py")} and run the tests again, or answer "I don't know".`,
  });
  expect(chat.events().some((e) => e.type === "grading")).toBe(false);
  await edit(workspace, SOLUTION);
  await runTests(chat);
  expect(await root.readEvidence(COURSE)).toMatchObject([
    { verdict: "correct" },
  ]);
});

test("after the data root moves, the reopened thread names the files of an answered and an open code question in the workspace as it is now, and the transcripts keep what was written", async () => {
  const old = await setUp([
    TEACH,
    ask(CODE),
    [{ text: "Ties keep the first pair." }],
    ask(CODE),
  ]);
  await edit(old.workspace, LAST_OF_TIED);
  await runTests(old.chat);
  const answered = openQuestionId(old.chat);
  expect(await old.chat.anotherQuestion()).toEqual({ ok: true });
  await old.chat.settled();
  const asked = openQuestionId(old.chat);
  expect(asked).not.toBe(answered);
  await old.units.close();

  const parent = await mkdtemp(join(tmpdir(), "gauss-moved-"));
  onTestFinished(() => rm(parent, { recursive: true, force: true }));
  const moved = join(parent, "gauss");
  await rename(dir, moved);
  const { chat, units } = await openChat([], runner, moved);
  try {
    const now = join(moved, "courses", COURSE, "workspace", "bpe.py");
    const page = chat
      .events()
      .reduce(
        (state, event, index) => reduce(state, { type: "event", index, event }),
        emptyTimeline,
      );
    expect(
      page.items.flatMap((item) =>
        item.kind === "question" && item.question.kind === "code"
          ? [[item.question.id, item.question.files, item.graded?.verdict]]
          : [],
      ),
    ).toEqual([
      [answered, [now], "incorrect"],
      [asked, [now], undefined],
    ]);
    // The pinned card, whose "Copy path" copies the path it shows.
    expect(openQuestion(page)?.question).toMatchObject({
      id: asked,
      files: [now],
    });
    expect(JSON.stringify(chat.events())).not.toContain(dir);
    const stored = await readFile(
      join(moved, "courses", COURSE, "sessions", "bpe.1.jsonl"),
      "utf8",
    );
    expect(stored).toContain(JSON.stringify([join(old.workspace, "bpe.py")]));
  } finally {
    await units.close();
  }
});

test("without the sandbox a code question is refused, saying to ask another kind", async () => {
  const { backend } = await setUp([TEACH, ask(CODE)], noCodeRunner);

  const call = backend.calls.find((c) => c.name === "ask_question");
  expect(call?.result).toEqual({
    status: "refused",
    text: "Code questions need the sandbox that runs their tests, and it does not run here. Ask another kind of question.",
  });
});

test("Stop cancels code preflight without publishing the question", async () => {
  await seedCourse();
  const started = Promise.withResolvers<AbortSignal | undefined>();
  const held = Promise.withResolvers<{ question: typeof QUESTION }>();
  const { chat, root, units } = await openChat([TEACH, ask(CODE)], {
    ...runner,
    check(_question, _workspace, _dependencies, signal) {
      signal?.addEventListener(
        "abort",
        () => held.resolve({ question: QUESTION }),
        { once: true },
      );
      started.resolve(signal);
      return held.promise;
    },
  });
  try {
    expect(await chat.ready()).toEqual({ ok: true });
    const signal = await started.promise;
    await chat.interrupt();
    expect(signal?.aborted).toBe(true);
    await chat.settled();
    expect(chat.events().filter((e) => e.type === "question")).toEqual([]);
    expect(
      (await root.readState(COURSE)).units.bpe?.openQuestion,
    ).toBeUndefined();
  } finally {
    held.resolve({ question: QUESTION });
    await units.close();
  }
});

test("an open code question cannot accept a new submission without a sandbox", async () => {
  const old = await setUp([TEACH, ask(CODE)]);
  const questionId = openQuestionId(old.chat);
  await old.units.close();
  const { chat, root, units } = await openChat([], noCodeRunner);
  try {
    expect(
      await chat.answer({ kind: "code", questionId, confidence: "90" }),
    ).toMatchObject({ ok: false, error: expect.stringContaining("sandbox") });
    expect(
      (await root.readState(COURSE)).units.bpe?.openQuestion?.answer,
    ).toBeUndefined();
    expect(await chat.override()).toEqual({ ok: true });
    expect(await root.readEvidence(COURSE)).toMatchObject([
      { kind: "override", recordedAt: NOW, objectives: ["count-pairs"] },
    ]);
  } finally {
    await units.close();
  }
});

test("shutdown stops grading; an infrastructure failure after reopen allows moving on", async () => {
  const started = Promise.withResolvers<AbortSignal | undefined>();
  const lateMiss = {
    result: "failed",
    exitCode: 1,
    output: "Assertion failed.",
  } as const;
  const held = Promise.withResolvers<typeof lateMiss>();
  const old = await setUp([TEACH, ask(CODE)], {
    ...runner,
    run(_question, _files, _workspace, signal) {
      signal?.addEventListener("abort", () => held.resolve(lateMiss), {
        once: true,
      });
      started.resolve(signal);
      return held.promise;
    },
  });
  const questionId = openQuestionId(old.chat);
  const submission = { kind: "code", questionId, confidence: "90" } as const;
  expect(await old.chat.answer(submission)).toEqual({ ok: true });
  const signal = await started.promise;
  const closed = old.units.close();
  try {
    expect(signal?.aborted).toBe(true);
    await closed;
    expect(await old.root.readEvidence(COURSE)).toEqual([]);
    expect(
      (await old.root.readState(COURSE)).units.bpe?.openQuestion?.answer,
    ).toMatchObject(submission);
  } finally {
    held.resolve(lateMiss);
    await closed;
  }

  const { chat, root, units } = await openChat([], noCodeRunner);
  try {
    expect(chat.events().at(-1)).toMatchObject({
      type: "grading_failed",
      questionId,
      error: expect.stringContaining("sandbox"),
    });
    const page = chat
      .events()
      .reduce(
        (state, event, index) => reduce(state, { type: "event", index, event }),
        emptyTimeline,
      );
    expect(nextStep(page)).toBe("move-on");
    expect(await chat.override()).toEqual({ ok: true });
    expect(await root.readEvidence(COURSE)).toMatchObject([
      { kind: "override", recordedAt: NOW, objectives: ["count-pairs"] },
    ]);
  } finally {
    await units.close();
  }
});
