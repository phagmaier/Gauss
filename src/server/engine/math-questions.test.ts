// Math questions through the unit chat (task 3.5): posted with an expected
// expression the symbolic check must read, answered with an expression, and
// graded by the check, or by the grader when the check cannot settle it.
// The tutor and the grader are the fake backend; the check is the real one,
// `pytools/mathcheck.py` in the real sandbox, so these tests need what the
// sandbox needs and fail where it cannot run. One check takes about a
// second here, most of it starting SymPy, so the tests have room for it.

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  test,
} from "vitest";
import type { CurriculumProposal } from "../../shared/curriculum.ts";
import type { PageEvent } from "../../shared/events.ts";
import type { Plan } from "../../shared/plan.ts";
import type { AnswerSubmission } from "../../shared/question.ts";
import { answerLine } from "../../web/what-i-know.ts";
import {
  createFakeBackend,
  type FakeReply,
  type FakeStep,
  type FakeTurn,
} from "../backends/fake.ts";
import { openDataRoot } from "../record/data-root.ts";
import { whatIKnow } from "../record/what-i-know.ts";
import { givenOrder } from "./choice-order.ts";
import { createFakeTimer } from "./fake-timer.ts";
import { createGrader } from "./grading.ts";
import { createHelpJudge } from "./help-judge.ts";
import { createMathCheck, type MathCheck } from "./math-check.ts";
import { type Sandbox, startSandbox } from "./sandbox.ts";
import { createUnitChats, type UnitChat } from "./unit-chat.ts";
import { createUnitPlanner } from "./unit-planning.ts";

/** Room for two or three runs of the check, each a second or so. */
const CHECKED_MS = 20_000;

let sandbox: Extract<Sandbox, { available: true }>;
let check: MathCheck;
beforeAll(async () => {
  const started = await startSandbox({ log: () => {} });
  if (!started.available) {
    throw new Error(`These tests need the sandbox: ${started.reason}`);
  }
  sandbox = started;
  check = createMathCheck({ sandbox });
});
afterAll(async () => {
  await sandbox?.close();
});

// Each test gets its own data root; none touches ~/gauss (AGENTS.md).
let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "gauss-math-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const NOW = "2026-11-17T10:00:00.000Z";
const COURSE = "chain-rule";
const CURRICULUM: CurriculumProposal = {
  title: "Chain rule",
  units: [
    {
      id: "chain",
      title: "The chain rule",
      goal: "Differentiate composite functions.",
      prerequisites: [],
    },
  ],
  style: "Short.",
  background: "The learner knows the power rule.",
};
const PLAN: Plan = {
  objectives: [
    {
      id: "chain-power",
      statement: "Differentiate a power of a linear function.",
    },
  ],
  segments: [{ title: "Powers", objectives: ["chain-power"] }],
};

const PROMPT = "Differentiate $h(x) = (2x+1)^5$. Give $h'(x)$.";
const EXPECTED = "10(2x+1)^4";
const MATH = {
  objective: "chain-power",
  kind: "math",
  prompt: PROMPT,
  expected: EXPECTED,
};

const TEACH: FakeTurn = [{ text: "The inside's rate multiplies." }];
const ask = (question: unknown): FakeStep[] => [
  { text: "One on the chain rule." },
  { call: "ask_question", input: question },
];
const FEEDBACK: FakeTurn = [{ text: "Feedback." }];

/** The course, its unit planned, then the unit opened and in its check. */
async function setUp(
  script: FakeTurn[],
  given: { replies?: FakeReply[]; mathCheck?: MathCheck | null } = {},
) {
  const root = openDataRoot({ path: dir, now: () => new Date(NOW) });
  const { id } = await root.createCourse({ title: CURRICULUM.title });
  await root.saveProposal(id, CURRICULUM);
  await root.approveCurriculum(id, CURRICULUM);
  await root.storePlan(id, "chain", PLAN);

  const started = await start(script, given);
  expect(await started.chat.ready()).toEqual({ ok: true });
  await started.chat.settled();
  return started;
}

/** A server's unit chats on the record in `dir`, with the unit opened. */
async function start(
  script: FakeTurn[],
  given: { replies?: FakeReply[]; mathCheck?: MathCheck | null } = {},
) {
  const root = openDataRoot({ path: dir, now: () => new Date(NOW) });
  const backend = createFakeBackend(script, given.replies);
  const mathCheck = given.mathCheck === undefined ? check : given.mathCheck;
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
    ...(mathCheck === null ? {} : { mathCheck }),
    now: () => new Date(NOW),
    timer: createFakeTimer(),
    order: givenOrder,
  });
  const opened = await units.open(COURSE, "chain");
  if (!opened.ok) throw new Error(opened.error);
  const chat = opened.chat;
  await chat.settled();
  return { backend, root, units, chat };
}

/** The turn that told the tutor the grade of question 1. */
function answerTurn(backend: { received: { text: string }[] }): string {
  const turn = backend.received.find((t) =>
    t.text.includes("The learner answered question 1."),
  );
  if (turn === undefined) throw new Error("no answer turn");
  return turn.text;
}

function openQuestionId(chat: UnitChat): string {
  const posted = chat.events().findLast((e) => e.type === "question");
  if (posted?.type !== "question") throw new Error("no question posted");
  return posted.question.id;
}

async function answerWith(
  chat: UnitChat,
  expression: string,
  extra: Partial<Extract<AnswerSubmission, { kind: "math" }>> = {},
) {
  const result = await chat.answer({
    kind: "math",
    questionId: openQuestionId(chat),
    expression,
    confidence: "75",
    ...extra,
  });
  expect(result).toEqual({ ok: true });
  await chat.settled();
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

test(
  "an answer equal to the expected expression is graded correct by the check alone, and the tutor and 'What I know' have the expression",
  async () => {
    const { backend, root, chat } = await setUp([TEACH, ask(MATH), FEEDBACK]);
    expect(chat.events()).toContainEqual({
      type: "question",
      question: {
        kind: "math",
        id: openQuestionId(chat),
        number: 1,
        prompt: PROMPT,
      },
    });

    await answerWith(chat, "5(2x+1)^4 \\cdot 2", {
      reasoning: "Power rule, times the inside's 2.",
    });

    const questionId = openQuestionId(chat);
    const answer = {
      kind: "math",
      questionId,
      expression: "5(2x+1)^4 \\cdot 2",
      confidence: "75",
      reasoning: "Power rule, times the inside's 2.",
    };
    expect(chat.events()).toContainEqual({
      type: "grading",
      questionId,
      answer,
    });
    expect(chat.events()).toContainEqual({
      type: "graded",
      questionId,
      verdict: "correct",
      answer,
      expected: EXPECTED,
      assisted: false,
    });
    expect(await root.readEvidence(COURSE)).toEqual([
      {
        kind: "answer",
        recordedAt: NOW,
        objective: "chain-power",
        question: { kind: "math", prompt: PROMPT, expected: EXPECTED },
        answer,
        assisted: false,
        verdict: "correct",
      },
    ]);
    // No model graded it.
    expect(backend.oneShots).toEqual([]);
    expect(answerTurn(backend)).toContain(
      "The learner's answer, at 75% confidence: 5(2x+1)^4 \\cdot 2\n" +
        "Their reasoning: Power rule, times the inside's 2.\n" +
        "The symbolic check found it equal to the expected answer, 10(2x+1)^4: correct.",
    );

    // A correct answer below 90% does not pass alone; the expected answer
    // is shown with the question, but not as a correction.
    const { status, entry, line } = await known(root);
    expect(status).toBe("attempted");
    expect(entry.question).toEqual({
      kind: "math",
      prompt: PROMPT,
      expected: EXPECTED,
    });
    expect(line.expected).toBeUndefined();
    expect(line.gradedBy).toBeUndefined();
  },
  CHECKED_MS,
);

test(
  "an answer not equal to it is a miss that opens a detour, with the expected answer shown on the card and in 'What I know'",
  async () => {
    const { backend, root, chat } = await setUp([
      TEACH,
      ask(MATH),
      [{ text: "The inside contributes a factor of 2." }],
    ]);

    await answerWith(chat, "5(2x+1)^4");

    const questionId = openQuestionId(chat);
    expect(chat.events()).toContainEqual(
      expect.objectContaining({
        type: "graded",
        questionId,
        verdict: "incorrect",
        expected: EXPECTED,
      }),
    );
    expect(chat.events()).toContainEqual({
      type: "detour",
      questionId,
      number: 1,
    });
    const [entry] = await root.readEvidence(COURSE);
    expect(entry).toMatchObject({ verdict: "incorrect" });
    expect(entry).not.toHaveProperty("flaw");
    expect(entry).not.toHaveProperty("unsettled");
    expect(backend.oneShots).toEqual([]);
    const turn = answerTurn(backend);
    expect(turn).toContain(
      "The symbolic check found it not equal to the expected answer, 10(2x+1)^4: incorrect.",
    );
    expect(turn).toContain("The miss opens a detour");
    expect(turn).toContain(
      "from the answer they gave, or, if that does not show it",
    );

    const { status, line } = await known(root);
    expect(status).toBe("attempted");
    expect(line.verdict.text).toBe("Not quite");
    expect(line.expected).toBe(EXPECTED);
  },
  CHECKED_MS,
);

test(
  "an expected expression the check cannot read is refused when posted, with its reason, and the tutor posts another in the same turn",
  async () => {
    const unreadable = { ...MATH, expected: "\\frac{dh}{dx} = 10(2x+1)^4" };
    const { backend, chat } = await setUp([
      TEACH,
      [
        { call: "ask_question", input: unreadable },
        { call: "ask_question", input: MATH },
      ],
    ]);

    const [refused, posted] = backend.calls;
    expect(refused?.result.status).toBe("refused");
    expect(refused?.result.text).toContain(
      "The symbolic check cannot read the expected answer: derivative notation is not understood: give the derivative itself.",
    );
    expect(posted?.result).toMatchObject({ status: "done", endTurn: true });
    const questions = chat.events().filter((e) => e.type === "question");
    expect(questions).toHaveLength(1);
  },
  CHECKED_MS,
);

test(
  "an answer the check cannot read goes to the grader with a rubric made from the expression, and the evidence keeps why and the flaw",
  async () => {
    const { backend, root, chat } = await setUp(
      [TEACH, ask(MATH), [{ text: "Detour." }]],
      {
        replies: [
          {
            output: {
              verdict: "incorrect",
              flaw: "The factor of 2 from the inside is missing.",
            },
          },
        ],
      },
    );

    await answerWith(chat, "5(2x+1)^4 \\times \\oops");

    // The grader saw the question, the rubric made from the expression and
    // the answer, and nothing else.
    const [request] = backend.oneShots;
    expect(request?.prompt).toContain(`<question>\n${PROMPT}\n</question>`);
    expect(request?.prompt).toContain(
      "Correct if the answer is mathematically equal to the expected answer, $10(2x+1)^4$, in any form",
    );
    expect(request?.prompt).toContain(
      "<answer>\n5(2x+1)^4 \\times \\oops\n</answer>",
    );

    const unsettled = {
      result: "unparsable",
      reason: "\\oops is not understood",
    };
    const [entry] = await root.readEvidence(COURSE);
    expect(entry).toMatchObject({
      verdict: "incorrect",
      flaw: "The factor of 2 from the inside is missing.",
      unsettled,
    });
    expect(chat.events()).toContainEqual(
      expect.objectContaining({
        type: "graded",
        verdict: "incorrect",
        expected: EXPECTED,
        unsettled,
        flaw: "The factor of 2 from the inside is missing.",
      }),
    );
    expect(answerTurn(backend)).toContain(
      "The symbolic check could not read it (\\oops is not understood), so the grader, " +
        "which saw only the question, the expected answer, 10(2x+1)^4, and this answer, " +
        "graded it incorrect. The flaw it found: The factor of 2 from the inside is missing.",
    );

    const { line } = await known(root);
    expect(line.expected).toBe(EXPECTED);
    expect(line.gradedBy).toBe(
      "The grader, since the symbolic check could not read the answer (\\oops is not understood).",
    );
  },
  CHECKED_MS,
);

test("with no symbolic check, a math question is refused when posted", async () => {
  const { backend, chat } = await setUp([TEACH, ask(MATH)], {
    mathCheck: null,
  });

  expect(backend.calls[0]?.result).toEqual({
    status: "refused",
    text: "The symbolic check that grades math questions is not available. Ask a written question instead.",
  });
  expect(chat.events().some((e: PageEvent) => e.type === "question")).toBe(
    false,
  );
});

test(
  "a math answer kept across a restart onto a server with no symbolic check is graded by the grader, not left waiting",
  async () => {
    const first = await setUp([TEACH, ask(MATH)]);
    const questionId = openQuestionId(first.chat);
    await first.units.close();
    // The server stopped while the answer was being graded: it is kept on
    // the open question (state.json).
    const state = await first.root.readState(COURSE);
    const position = state.units.chain;
    if (position?.openQuestion === undefined) throw new Error("no question");
    const kept = {
      kind: "math",
      questionId,
      expression: "10(2x+1)^4",
      confidence: "90",
    } as const;
    await writeFile(
      join(dir, "courses", COURSE, "state.json"),
      JSON.stringify({
        units: {
          chain: {
            ...position,
            openQuestion: { ...position.openQuestion, answer: kept },
          },
        },
      }),
    );

    const restarted = await start([FEEDBACK], {
      mathCheck: null,
      replies: [{ output: { verdict: "correct" } }],
    });

    expect(restarted.backend.oneShots).toHaveLength(1);
    expect(await restarted.root.readEvidence(COURSE)).toEqual([
      expect.objectContaining({
        answer: kept,
        verdict: "correct",
        unsettled: {
          result: "failed",
          reason: "the symbolic check is not available",
        },
      }),
    ]);
    expect(
      (await restarted.root.readState(COURSE)).units.chain?.openQuestion,
    ).toBeUndefined();
  },
  CHECKED_MS,
);
