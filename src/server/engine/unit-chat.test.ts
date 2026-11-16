import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import type { CurriculumProposal } from "../../shared/curriculum.ts";
import type { PageEvent } from "../../shared/events.ts";
import type { Plan } from "../../shared/plan.ts";
import type { ChoiceLetter, Confidence } from "../../shared/question.ts";
import type { UnitPosition } from "../../shared/state.ts";
import type { ObjectiveStatus, UnitStatus } from "../../shared/status.ts";
import {
  createFakeBackend,
  type FakeReply,
  type FakeStep,
  type FakeTurn,
} from "../backends/fake.ts";
import { type DataRoot, openDataRoot } from "../record/data-root.ts";
import { createGrader } from "./grading.ts";
import { createUnitChats, type UnitChat } from "./unit-chat.ts";
import { createUnitPlanner, type UnitPlanner } from "./unit-planning.ts";
import { JOINED_NOTE } from "./unit-turns.ts";

// Each test gets its own data root; none touches ~/gauss (AGENTS.md).
let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "gauss-unit-chat-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const CREATED = "2026-11-14T09:00:00.000Z";
const NOW = "2026-11-15T14:00:00.000Z";
const TUTOR = "You are a test tutor.";
const GRADER = "You are a test grader.";
const COURSE = "derivatives-from-scratch";

const CURRICULUM: CurriculumProposal = {
  title: "Derivatives from scratch",
  units: [
    {
      id: "derivative",
      title: "The derivative",
      goal: "Compute a derivative from its definition.",
      prerequisites: [],
    },
    {
      id: "rules",
      title: "Rules of differentiation",
      goal: "Differentiate sums, products and quotients.",
      prerequisites: ["derivative"],
    },
  ],
  style: "Very short explanations. Many small exercises.",
};

// Segment 1 teaches two objectives, so its check needs an answer on each.
const PLAN: Plan = {
  objectives: [
    {
      id: "difference-quotient",
      statement: "Form the difference quotient of a function at a point.",
    },
    {
      id: "secant-slope",
      statement: "Read a difference quotient as the slope of a secant line.",
    },
    {
      id: "derivative-limit",
      statement: "Compute a derivative as the limit of difference quotients.",
    },
  ],
  segments: [
    {
      title: "Difference quotients",
      objectives: ["difference-quotient", "secant-slope"],
    },
    { title: "The limit", objectives: ["derivative-limit"] },
  ],
};

/** A choice question as the tutor posts it. */
interface ChoiceInput {
  objective: string;
  kind: "choice";
  prompt: string;
  choices: string[];
  answer: ChoiceLetter;
}

/** A written question as the tutor posts it. */
interface WrittenInput {
  objective: string;
  kind: "written";
  prompt: string;
  rubric: string;
}

const Q_QUOTIENT: ChoiceInput = {
  objective: "difference-quotient",
  kind: "choice",
  prompt: "Which is the difference quotient of $f$ at $a$?",
  choices: ["$\\frac{f(a+h)-f(a)}{h}$", "$f(a+h)-f(a)$", "$\\frac{f(a)}{h}$"],
  answer: "A",
};
const Q_SECANT: ChoiceInput = {
  objective: "secant-slope",
  kind: "choice",
  prompt: "The difference quotient of $f$ at $a$ is the slope of which line?",
  choices: [
    "The tangent at $a$",
    "The secant through $a$ and $a+h$",
    "The normal at $a$",
  ],
  answer: "B",
};
const Q_LIMIT: ChoiceInput = {
  objective: "derivative-limit",
  kind: "choice",
  prompt: "What is the derivative of $x^2$ at $3$?",
  choices: ["$3$", "$6$", "$9$"],
  answer: "B",
};

/** A unit_status event: the unit's status, then each objective's in plan order. */
function status(
  unit: UnitStatus,
  quotient: ObjectiveStatus = "not-started",
  secant: ObjectiveStatus = "not-started",
  limit: ObjectiveStatus = "not-started",
): PageEvent {
  return {
    type: "unit_status",
    unit,
    objectives: {
      "difference-quotient": quotient,
      "secant-slope": secant,
      "derivative-limit": limit,
    },
  };
}

const TEACH: FakeTurn = [{ text: "A secant joins two points." }];
const ask = (question: ChoiceInput | WrittenInput): FakeStep[] => [
  { text: "Here is a question." },
  { call: "ask_question", input: question },
  { text: "Written after posting, which the learner must not see." },
];
const CLOSE: FakeTurn = [
  { text: "Well done." },
  { call: "close_segment", input: {} },
  { text: "Written after closing, which the learner must not see." },
];

/** The question as the record keeps it, with its objective beside it. */
function stored(question: ChoiceInput | WrittenInput) {
  const { objective: _, ...rest } = question;
  return rest;
}

/**
 * An approved course, made the day before, with its first unit planned
 * unless `planned` is false.
 */
async function makeCourse(planned = true, plan = PLAN): Promise<void> {
  const root = openDataRoot({ path: dir, now: () => new Date(CREATED) });
  const { id } = await root.createCourse({ title: CURRICULUM.title });
  await root.saveProposal(id, CURRICULUM);
  await root.approveCurriculum(id, CURRICULUM);
  if (planned) await root.storePlan(id, "derivative", plan);
}

function setUp(
  script: FakeTurn[],
  given: {
    planner?: UnitPlanner;
    /** The grader's replies, in order. */
    replies?: FakeReply[];
    gradingLimitMs?: number;
    /** Changes the record the chats are given, to make it fail. */
    record?: (root: DataRoot) => DataRoot;
  } = {},
) {
  const backend = createFakeBackend(script, given.replies);
  const root = openDataRoot({ path: dir, now: () => new Date(NOW) });
  const dataRoot = given.record?.(root) ?? root;
  const units = createUnitChats({
    backend,
    systemPrompt: TUTOR,
    dataRoot,
    planner:
      given.planner ??
      createUnitPlanner({ backend, systemPrompt: "Plan.", dataRoot }),
    grader: createGrader({
      backend,
      systemPrompt: GRADER,
      ...(given.gradingLimitMs === undefined
        ? {}
        : { timeLimitMs: given.gradingLimitMs }),
    }),
    now: () => new Date(NOW),
  });
  return { backend, dataRoot, units };
}

/** Opens the unit and waits until it is open and the tutor is done. */
async function open(
  setup: ReturnType<typeof setUp>,
  unit = "derivative",
): Promise<UnitChat> {
  const opened = await setup.units.open(COURSE, unit);
  if (!opened.ok) throw new Error(opened.error);
  await opened.chat.settled();
  return opened.chat;
}

/** The record as a restarted server would read it. */
const reload = () => openDataRoot({ path: dir });
const position = async () => (await reload().readState(COURSE)).units;
/** The unit's position on disk now, for a listener, which cannot wait. */
const positionNow = (): unknown =>
  JSON.parse(readFileSync(join(dir, "courses", COURSE, "state.json"), "utf8"))
    .units.derivative;

/** The events from the last one of this type on, or every event if none. */
function since(chat: UnitChat, type: PageEvent["type"]): PageEvent[] {
  const events = chat.events();
  const at = events.findLastIndex((e) => e.type === type);
  return events.slice(Math.max(at, 0));
}

/** Waits for an event of this type after the first `from` events. */
function waitFor(
  chat: UnitChat,
  type: PageEvent["type"],
  from = 0,
): Promise<void> {
  if (chat.events().some((e, i) => i >= from && e.type === type)) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const stop = chat.subscribe((event, index) => {
      if (index >= from && event.type === type) {
        stop();
        resolve();
      }
    });
  });
}

function openQuestionId(chat: UnitChat): string {
  const posted = chat.events().findLast((e) => e.type === "question");
  if (posted?.type !== "question") throw new Error("no question posted");
  return posted.question.id;
}

/** Answers the open question, at 100% unless told otherwise. */
async function answer(
  chat: UnitChat,
  choice: "A" | "B" | "C",
  confidence: Confidence = "100",
) {
  const result = await chat.answer({
    kind: "choice",
    questionId: openQuestionId(chat),
    choice,
    confidence,
  });
  expect(result).toEqual({ ok: true });
  await chat.settled();
}

/** Takes the unit to its check, with nothing asked yet. */
async function toCheck(chat: UnitChat) {
  expect(await chat.ready()).toEqual({ ok: true });
  await chat.settled();
}

// --- Starting a unit and teaching -------------------------------------------

test("starting a unit plans it, sends segment 1's teaching turn, and the end of that turn opens the discussion", async () => {
  const setup = setUp([
    [{ call: "plan_unit", input: PLAN }],
    [{ text: "A difference quotient is a slope." }],
  ]);
  await makeCourse(false);

  const chat = await open(setup);

  expect(chat.events()).toEqual([
    { type: "unit_planning" },
    { type: "unit_plan", plan: PLAN },
    status("in-progress"),
    { type: "phase", segment: 0, phase: "teach" },
    { type: "turn_start" },
    { type: "tutor_text", text: "A difference quotient is a slope." },
    { type: "turn_end", outcome: "done" },
    { type: "phase", segment: 0, phase: "discuss" },
  ]);
  expect(await position()).toEqual({
    derivative: { segment: 0, phase: "discuss" },
  });
  // Session 1 planned the unit; session 2 is the tutor's.
  expect(setup.backend.sessions).toHaveLength(2);
  expect(setup.backend.sessions[1]?.tools.map((t) => t.name)).toEqual([
    "ask_question",
    "close_segment",
  ]);
  expect(setup.backend.received[1]?.text).toBe(
    '[Unit 1 of 2, "The derivative"; segment 1 of 2, "Difference quotients", on "difference-quotient" and "secant-slope". Phase: teach. Start of the segment. Allowed now: teach the segment\'s objectives in this turn, within the length the style sets, then stop; the learner can ask anything next. No questions yet: ask_question and close_segment are refused until the learner presses "ready".]\n' +
      "Teach these objectives:\n" +
      '- "difference-quotient": Form the difference quotient of a function at a point.\n' +
      '- "secant-slope": Read a difference quotient as the slope of a secant line.',
  );
  const course = await reload().readCourse(COURSE);
  expect(course?.course.lastOpenedAt).toBe(NOW);
});

test("the tutor's system prompt holds tutor.md, the course, the unit's plan and, for a course approved before style notes existed, the default style", async () => {
  const setup = setUp([TEACH]);
  await makeCourse();
  await rm(join(dir, "courses", COURSE, "style.md"));

  await open(setup);

  expect(setup.backend.sessions[0]?.systemPrompt).toBe(
    [
      TUTOR,
      "",
      "# This course",
      "",
      'The course is "Derivatives from scratch". Its units, in order:',
      "",
      '1. The derivative (id "derivative"): Compute a derivative from its definition.',
      '2. Rules of differentiation (id "rules"): Differentiate sums, products and quotients.',
      "",
      'You teach unit 1, "The derivative". Its goal: Compute a derivative from its definition.',
      "",
      "Its plan, in teaching order:",
      "",
      'Segment 1, "Difference quotients":',
      '- "difference-quotient": Form the difference quotient of a function at a point.',
      '- "secant-slope": Read a difference quotient as the slope of a secant line.',
      'Segment 2, "The limit":',
      '- "derivative-limit": Compute a derivative as the limit of difference quotients.',
      "",
      "# This course's style",
      "",
      "This course has no style note of its own: use the default style above.",
      "",
    ].join("\n"),
  );
});

test("the style note approved with the curriculum takes the default's place in the system prompt", async () => {
  const setup = setUp([TEACH]);
  await makeCourse();

  await open(setup);

  const prompt = setup.backend.sessions[0]?.systemPrompt ?? "";
  expect(
    prompt.endsWith(`# This course's style\n\n${CURRICULUM.style}\n`),
  ).toBe(true);
  expect(prompt).not.toContain("default style above");
});

test("stopping the teaching turn opens the discussion, and a message sent during it reaches the tutor as a discussion turn", async () => {
  const setup = setUp([
    [{ text: "A long lecture" }, { hold: true }, { text: "never written" }],
    [{ text: "Good question." }],
  ]);
  await makeCourse();
  const opened = await setup.units.open(COURSE, "derivative");
  if (!opened.ok) throw new Error(opened.error);
  const chat = opened.chat;
  await waitFor(chat, "tutor_text");

  expect(chat.say("Wait, why divide by h?")).toEqual({ ok: true });
  await chat.interrupt();
  await chat.settled();

  expect(chat.events()).toEqual([
    { type: "unit_plan", plan: PLAN },
    status("in-progress"),
    { type: "phase", segment: 0, phase: "teach" },
    { type: "turn_start" },
    { type: "tutor_text", text: "A long lecture" },
    { type: "learner", text: "Wait, why divide by h?" },
    { type: "turn_end", outcome: "interrupted" },
    { type: "phase", segment: 0, phase: "discuss" },
    { type: "turn_start" },
    { type: "tutor_text", text: "Good question." },
    { type: "turn_end", outcome: "done" },
  ]);
  expect(await position()).toEqual({
    derivative: { segment: 0, phase: "discuss" },
  });
  // Composed when it was sent, after the teaching turn had ended.
  expect(setup.backend.received[1]?.text).toBe(
    '[Unit 1 of 2, "The derivative"; segment 1 of 2, "Difference quotients", on "difference-quotient" and "secant-slope". Phase: discuss. Message from the learner. Allowed now: answer the learner; nothing here is graded. You may suggest they press "ready" for the check when they seem ready. ask_question and close_segment are refused until they do.]\n' +
      "Wait, why divide by h?",
  );
});

test("a teaching turn that fails still opens the discussion", async () => {
  const setup = setUp([]);
  await makeCourse();

  const chat = await open(setup);

  expect(since(chat, "turn_end")).toEqual([
    {
      type: "turn_end",
      outcome: "error",
      error: "The fake backend has no scripted turn 1.",
    },
    { type: "phase", segment: 0, phase: "discuss" },
  ]);
});

// --- The check ----------------------------------------------------------------

test('"ready" starts the check, and the tutor\'s question is stored in state.json before the page sees it', async () => {
  const setup = setUp([TEACH, ask(Q_QUOTIENT)]);
  await makeCourse();
  const chat = await open(setup);

  await toCheck(chat);

  const id = openQuestionId(chat);
  expect(since(chat, "phase")).toEqual([
    { type: "phase", segment: 0, phase: "check" },
    { type: "turn_start" },
    { type: "tutor_text", text: "Here is a question." },
    {
      type: "question",
      question: {
        kind: "choice",
        id,
        number: 1,
        prompt: Q_QUOTIENT.prompt,
        choices: Q_QUOTIENT.choices,
      },
    },
    { type: "turn_end", outcome: "done" },
  ]);
  expect(await position()).toEqual({
    derivative: {
      segment: 0,
      phase: "check",
      checkFrom: 0,
      openQuestion: {
        id,
        number: 1,
        objective: "difference-quotient",
        postedAt: NOW,
        question: {
          kind: "choice",
          prompt: Q_QUOTIENT.prompt,
          choices: Q_QUOTIENT.choices,
          answer: "A",
        },
      },
    },
  });
  expect(setup.backend.received[1]?.text).toBe(
    '[Unit 1 of 2, "The derivative"; segment 1 of 2, "Difference quotients", on "difference-quotient" and "secant-slope". Phase: check. The learner pressed "ready". In this check, "difference-quotient": not asked yet; "secant-slope": not asked yet. Allowed now: post a question on "difference-quotient" and "secant-slope" with ask_question, unlike the ones asked before. Posting ends your turn, so give any feedback first. close_segment is refused until each objective is done.]',
  );
});

test("an answer is graded, appended to the evidence, and sent to the tutor with the question", async () => {
  const setup = setUp([TEACH, ask(Q_QUOTIENT), [{ text: "Not quite." }]]);
  await makeCourse();
  const chat = await open(setup);
  await toCheck(chat);
  const id = openQuestionId(chat);

  expect(
    await chat.answer({
      kind: "choice",
      questionId: id,
      choice: "B",
      confidence: "75",
      reasoning: "The change in f.",
    }),
  ).toEqual({ ok: true });
  await chat.settled();

  expect(since(chat, "graded")[0]).toEqual({
    type: "graded",
    questionId: id,
    verdict: "incorrect",
    answer: {
      kind: "choice",
      questionId: id,
      choice: "B",
      confidence: "75",
      reasoning: "The change in f.",
    },
    correctChoice: "A",
    assisted: false,
  });
  expect(await reload().readEvidence(COURSE)).toEqual([
    {
      kind: "answer",
      recordedAt: NOW,
      objective: "difference-quotient",
      question: stored(Q_QUOTIENT),
      answer: {
        kind: "choice",
        questionId: id,
        choice: "B",
        confidence: "75",
        reasoning: "The change in f.",
      },
      assisted: false,
      verdict: "incorrect",
    },
  ]);
  expect(await position()).toEqual({
    derivative: { segment: 0, phase: "check", checkFrom: 0 },
  });
  expect(setup.backend.received[2]?.text).toBe(
    '[Unit 1 of 2, "The derivative"; segment 1 of 2, "Difference quotients", on "difference-quotient" and "secant-slope". Phase: check. The learner answered question 1. In this check, "difference-quotient": missed, so another question is needed (1 of at most 3 asked); "secant-slope": not asked yet. Allowed now: post a question on "difference-quotient" and "secant-slope" with ask_question, unlike the ones asked before. Posting ends your turn, so give any feedback first. close_segment is refused until each objective is done.]\n' +
      'Question 1, on "difference-quotient":\n' +
      `${Q_QUOTIENT.prompt}\n` +
      "A. $\\frac{f(a+h)-f(a)}{h}$\n" +
      "B. $f(a+h)-f(a)$\n" +
      "C. $\\frac{f(a)}{h}$\n" +
      "\n" +
      "The learner chose B, at 75% confidence.\n" +
      "Their reasoning: The change in f.\n" +
      "Graded: incorrect. The correct choice is A.",
  );
});

test('"I don\'t know" is recorded as unknown and the tutor is told it is a miss', async () => {
  const setup = setUp([TEACH, ask(Q_QUOTIENT), [{ text: "Let me explain." }]]);
  await makeCourse();
  const chat = await open(setup);
  await toCheck(chat);

  await chat.answer({ kind: "unknown", questionId: openQuestionId(chat) });
  await chat.settled();

  expect(since(chat, "graded")[0]).toMatchObject({
    verdict: "unknown",
    answer: { kind: "unknown" },
    correctChoice: "A",
  });
  expect((await reload().readEvidence(COURSE))[0]).toMatchObject({
    verdict: "unknown",
  });
  expect(setup.backend.received[2]?.text).toContain(
    'The learner answered "I don\'t know", which counts as a miss. The correct choice is A.',
  );
});

test("close_segment is refused, with the reason, until every objective has an answer from this check, even one passed before it; then it closes the segment", async () => {
  const setup = setUp([
    TEACH,
    ask(Q_QUOTIENT),
    // After one answer: closing is refused, and the tutor asks again.
    [
      { call: "close_segment", input: {} },
      { text: "One more." },
      { call: "ask_question", input: Q_SECANT },
    ],
    CLOSE,
  ]);
  await makeCourse();
  // An earlier answer on the second objective, from before this check.
  await reload().appendEvidence(COURSE, {
    kind: "answer",
    recordedAt: NOW,
    objective: "secant-slope",
    question: stored(Q_SECANT),
    answer: {
      kind: "choice",
      questionId: "earlier",
      choice: "B",
      confidence: "100",
    },
    assisted: false,
    verdict: "correct",
  });
  const chat = await open(setup);
  await toCheck(chat);

  await answer(chat, "A");

  expect(setup.backend.calls[1]).toMatchObject({
    name: "close_segment",
    result: {
      status: "refused",
      text: 'Not done yet in this check: "secant-slope" is not asked yet. Post a question on each with ask_question before closing the segment.',
    },
  });
  // The refusal did not end the turn.
  expect(setup.backend.calls[2]).toMatchObject({
    name: "ask_question",
    result: { status: "done", text: expect.stringMatching(/question 2\./) },
  });

  await answer(chat, "B");

  expect(setup.backend.calls[3]).toMatchObject({
    name: "close_segment",
    result: { status: "done", endTurn: true },
  });
  expect(since(chat, "turn_start")).toEqual([
    { type: "turn_start" },
    { type: "tutor_text", text: "Well done." },
    { type: "phase", segment: 0, phase: "closed" },
    { type: "turn_end", outcome: "done" },
  ]);
  expect(await position()).toEqual({
    derivative: { segment: 0, phase: "closed" },
  });
});

test.each([
  {
    phase: "teach",
    script: [
      [
        { call: "ask_question", input: Q_QUOTIENT },
        { call: "close_segment", input: {} },
        { text: "Teaching on." },
      ],
    ] satisfies FakeTurn[],
    act: async (_chat: UnitChat) => {},
    last: "Teaching on.",
    refusals: [
      'The check has not started: the segment is in its teach phase. Teach now; the learner moves to the check by pressing "ready" after the discussion.',
      'The check has not started: the segment is in its teach phase. Teach now; the learner moves to the check by pressing "ready" after the discussion.',
    ],
  },
  {
    phase: "discuss",
    script: [
      TEACH,
      [
        { call: "ask_question", input: Q_QUOTIENT },
        { call: "close_segment", input: {} },
        { text: "Ask me anything." },
      ],
    ] satisfies FakeTurn[],
    act: async (chat: UnitChat) => {
      chat.say("Can you quiz me?");
    },
    last: "Ask me anything.",
    refusals: [
      'The check has not started: the learner has not pressed "ready". Answer their questions; you may suggest they press "ready" when they seem ready.',
      'The check has not started: the learner has not pressed "ready". Answer their questions; you may suggest they press "ready" when they seem ready.',
    ],
  },
  {
    phase: "closed",
    script: [
      TEACH,
      [
        { call: "ask_question", input: Q_QUOTIENT },
        { call: "close_segment", input: {} },
        { text: "Start the next segment when you like." },
      ],
    ] satisfies FakeTurn[],
    act: async (chat: UnitChat) => {
      await chat.override();
      chat.say("One more question, please?");
    },
    last: "Start the next segment when you like.",
    refusals: [
      "The segment is closed, so its check is over. The learner starts the next segment.",
      "The segment is closed already.",
    ],
  },
])(
  "in $phase, ask_question and close_segment are refused with a reason that reaches the tutor",
  async ({ script, act, last, refusals }) => {
    const setup = setUp(script);
    await makeCourse();
    const chat = await open(setup);

    await act(chat);
    await chat.settled();

    expect(setup.backend.calls.map((c) => c.result)).toEqual(
      refusals.map((text) => ({ status: "refused", text })),
    );
    expect(chat.events().some((e) => e.type === "question")).toBe(false);
    // The turn went on after the refusals.
    expect(chat.events().findLast((e) => e.type === "tutor_text")).toEqual({
      type: "tutor_text",
      text: last,
    });
  },
);

test("in the check, a second question while one is open and a question on another segment's objective are refused", async () => {
  const setup = setUp([
    TEACH,
    [
      { call: "ask_question", input: Q_LIMIT },
      { call: "ask_question", input: Q_QUOTIENT },
    ],
    [
      { text: "Think about the slope." },
      { call: "ask_question", input: Q_SECANT },
    ],
  ]);
  await makeCourse();
  const chat = await open(setup);
  await toCheck(chat);
  chat.say("Can I have a hint?");
  await chat.settled();

  expect(setup.backend.calls.map((c) => c.result)).toEqual([
    {
      status: "refused",
      text: '"derivative-limit" is not an objective of this segment. Name one of "difference-quotient" and "secant-slope".',
    },
    {
      status: "done",
      text: "Posted as question 1. Your turn is over; the learner's answer will arrive in the next message.",
      endTurn: true,
    },
    {
      status: "refused",
      text: "Question 1 is still open. End your turn and wait for the learner's answer.",
    },
  ]);
  expect(chat.events().filter((e) => e.type === "question")).toHaveLength(1);
  expect(setup.backend.received[2]?.text).toContain(
    'Question 1, on "difference-quotient", is open. The learner has written to you while it is open, so their answer will be recorded as given with help. Allowed now: reply without giving its answer away.',
  );
});

// --- Moving on ----------------------------------------------------------------

test("the learner's override closes the segment, is recorded as evidence, withdraws the open question, and is told to the tutor with the next turn", async () => {
  const setup = setUp([TEACH, ask(Q_QUOTIENT), [{ text: "The limit." }]]);
  await makeCourse();
  const chat = await open(setup);
  await toCheck(chat);
  const id = openQuestionId(chat);
  const turnsBefore = setup.backend.received.length;
  let whenTold: unknown;
  chat.subscribe((event) => {
    if (event.type === "overridden") whenTold = positionNow();
  });

  expect(await chat.override()).toEqual({ ok: true });
  await chat.settled();

  // The segment was closed on disk before the page heard of it.
  expect(whenTold).toEqual({ segment: 0, phase: "closed" });
  expect(since(chat, "overridden")).toEqual([
    {
      type: "overridden",
      segment: 0,
      objectives: ["difference-quotient", "secant-slope"],
      withdrawnQuestionId: id,
    },
    status("in-progress", "overridden", "overridden"),
    { type: "phase", segment: 0, phase: "closed" },
  ]);
  expect(await reload().readEvidence(COURSE)).toEqual([
    {
      kind: "override",
      recordedAt: NOW,
      objectives: ["difference-quotient", "secant-slope"],
    },
  ]);
  expect(await position()).toEqual({
    derivative: { segment: 0, phase: "closed" },
  });
  // Moving on costs no reply from the tutor.
  expect(setup.backend.received).toHaveLength(turnsBefore);

  expect(await chat.nextSegment()).toEqual({ ok: true });
  await chat.settled();

  expect(setup.backend.received.at(-1)?.text).toMatch(
    /^\[Unit 1 of 2, "The derivative"; segment 2 of 2, "The limit", on "derivative-limit"\. Phase: teach\. Start of the segment\. The learner moved on without finishing the check of the segment just closed, which is recorded as an override of "difference-quotient" and "secant-slope"\. Question 1 was withdrawn\. Allowed now: teach/,
  );
});

test("the learner can also move on from the discussion, without pressing ready", async () => {
  const setup = setUp([TEACH]);
  await makeCourse();
  const chat = await open(setup);

  expect(await chat.override()).toEqual({ ok: true });

  expect(since(chat, "overridden")).toEqual([
    {
      type: "overridden",
      segment: 0,
      objectives: ["difference-quotient", "secant-slope"],
    },
    status("in-progress", "overridden", "overridden"),
    { type: "phase", segment: 0, phase: "closed" },
  ]);
  expect(await reload().readEvidence(COURSE)).toHaveLength(1);
});

test("the learner starts each next segment, and the unit closes passed with its last segment when every objective passed", async () => {
  const setup = setUp([
    TEACH,
    ask(Q_QUOTIENT),
    ask(Q_SECANT),
    CLOSE,
    [{ text: "Now the limit." }],
    ask(Q_LIMIT),
    CLOSE,
    [{ text: "You're welcome." }],
  ]);
  await makeCourse();
  const chat = await open(setup);
  await toCheck(chat);
  await answer(chat, "A");
  await answer(chat, "B");

  expect(await chat.nextSegment()).toEqual({ ok: true });
  await chat.settled();

  expect(setup.backend.received[4]?.text).toMatch(
    /^\[Unit 1 of 2, "The derivative"; segment 2 of 2, "The limit", on "derivative-limit"\. Phase: teach\. Start of the segment\./,
  );

  await toCheck(chat);
  await answer(chat, "B");

  expect(
    chat
      .events()
      .filter((e) => e.type === "phase")
      .map((e) => (e.type === "phase" ? [e.segment, e.phase] : [])),
  ).toEqual([
    [0, "teach"],
    [0, "discuss"],
    [0, "check"],
    [0, "closed"],
    [1, "teach"],
    [1, "discuss"],
    [1, "check"],
    [1, "closed"],
  ]);
  expect(since(chat, "unit_end")).toEqual([
    {
      type: "unit_end",
      passed: true,
      objectives: {
        "difference-quotient": "passed",
        "secant-slope": "passed",
        "derivative-limit": "passed",
      },
    },
    status("passed", "passed", "passed", "passed"),
    { type: "unit_closed", status: "passed" },
    { type: "turn_end", outcome: "done" },
  ]);
  // No longer in progress.
  expect(await position()).toEqual({});
  for (const step of [
    chat.nextSegment(),
    chat.ready(),
    chat.goOverAgain(),
    chat.finishUnit(),
  ]) {
    expect(await step).toEqual({
      ok: false,
      status: 409,
      error: "The unit is finished.",
    });
  }

  expect(chat.say("Thanks!")).toEqual({ ok: true });
  await chat.settled();

  expect(setup.backend.received[7]?.text).toBe(
    '[Unit 1 of 2, "The derivative". The unit is finished: every objective passed. Message from the learner. Allowed now: reply to the learner. No teaching tools.]\nThanks!',
  );
});

test.each([
  {
    name: '"ready" in the check',
    at: "check",
    act: (chat: UnitChat) => chat.ready(),
    error: "The check has started already.",
  },
  {
    name: "an answer with no question open",
    at: "check",
    act: (chat: UnitChat) =>
      chat.answer({ kind: "unknown", questionId: "no-such-question" }),
    error: "No question is open.",
  },
  {
    name: "the next segment during the discussion",
    at: "discuss",
    act: (chat: UnitChat) => chat.nextSegment(),
    error: "Finish this segment first: take its check, or move on without it.",
  },
  {
    name: "moving on once the segment is closed",
    at: "closed",
    act: (chat: UnitChat) => chat.override(),
    error: "The segment is closed already.",
  },
  {
    name: '"ready" once the segment is closed',
    at: "closed",
    act: (chat: UnitChat) => chat.ready(),
    error: "The segment is closed already.",
  },
] as const)("$name is refused", async ({ at, act, error }) => {
  const setup = setUp([TEACH, [{ text: "Ready when you are." }]]);
  await makeCourse();
  const chat = await open(setup);
  if (at === "check") await toCheck(chat);
  if (at === "closed") await chat.override();
  const record = await position();
  const events = chat.events().length;

  expect(await act(chat)).toEqual({ ok: false, status: 409, error });
  expect(await position()).toEqual(record);
  expect(chat.events()).toHaveLength(events);
});

test("an answer to another question, or naming a choice the question does not have, is refused", async () => {
  const setup = setUp([TEACH, ask(Q_QUOTIENT)]);
  await makeCourse();
  const chat = await open(setup);
  await toCheck(chat);
  const questionId = openQuestionId(chat);

  expect(await chat.answer({ kind: "unknown", questionId: "q-old" })).toEqual({
    ok: false,
    status: 409,
    error: "That question is not open; question 1 is.",
  });
  expect(
    await chat.answer({
      kind: "choice",
      questionId,
      choice: "D",
      confidence: "50",
    }),
  ).toEqual({
    ok: false,
    status: 400,
    error: "Question 1 has no choice D.",
  });
  expect(await reload().readEvidence(COURSE)).toEqual([]);
});

test('"ready", moving on and the next segment wait until the tutor has finished', async () => {
  const setup = setUp([
    TEACH,
    [{ text: "Let me think" }, { hold: true }],
    [{ text: "Here is the check." }],
  ]);
  await makeCourse();
  const chat = await open(setup);
  const from = chat.events().length;
  chat.say("What is h?");
  await waitFor(chat, "tutor_text", from);

  const wait = {
    ok: false,
    status: 409,
    error: "Wait until the tutor has finished, or stop it.",
  };
  expect(await chat.ready()).toEqual(wait);
  expect(await chat.override()).toEqual(wait);
  expect(await chat.nextSegment()).toEqual(wait);

  await chat.interrupt();
  await chat.settled();
  expect(await chat.ready()).toEqual({ ok: true });
  await chat.settled();
});

// --- Opening -------------------------------------------------------------------

test("a new engine over the same data root reopens a unit mid-check from state.json", async () => {
  // A second question on the first objective, so the restart lands with it open.
  const Q_QUOTIENT_AGAIN: ChoiceInput = {
    ...Q_QUOTIENT,
    prompt: "Which is the difference quotient of $g$ at $2$?",
    choices: ["$\\frac{g(2+h)-g(2)}{h}$", "$\\frac{g(h)-g(2)}{h}$"],
  };
  const before = setUp([TEACH, ask(Q_QUOTIENT), ask(Q_QUOTIENT_AGAIN)]);
  await makeCourse();
  // An answer on the second objective from before the check, which must not
  // count for it, after the restart either.
  await reload().appendEvidence(COURSE, {
    kind: "answer",
    recordedAt: CREATED,
    objective: "secant-slope",
    question: stored(Q_SECANT),
    answer: {
      kind: "choice",
      questionId: "earlier",
      choice: "B",
      confidence: "100",
    },
    assisted: false,
    verdict: "correct",
  });
  const first = await open(before);
  await toCheck(first);
  // Correct but unsure, so the objective needs another question.
  await answer(first, "A", "75");
  const id = openQuestionId(first);
  await before.units.close();

  // The server restarts: a new engine, a new backend, the same data root.
  const after = setUp([
    [
      { call: "close_segment", input: {} },
      { text: "Now the secant." },
      { call: "ask_question", input: Q_SECANT },
    ],
  ]);
  const chat = await open(after);

  expect(chat.events()).toEqual([
    { type: "unit_plan", plan: PLAN },
    status("in-progress", "attempted", "passed"),
    { type: "phase", segment: 0, phase: "check" },
    {
      type: "question",
      question: {
        kind: "choice",
        id,
        number: 2,
        prompt: Q_QUOTIENT_AGAIN.prompt,
        choices: Q_QUOTIENT_AGAIN.choices,
      },
    },
  ]);
  // Nothing is sent to the tutor until the learner acts.
  expect(after.backend.received).toEqual([]);

  await answer(chat, "A");

  const turn = after.backend.received[0]?.text ?? "";
  expect(turn).toContain(
    `The learner answered question 2. ${JOINED_NOTE} In this check, "difference-quotient": passed; "secant-slope": not asked yet.`,
  );
  expect(turn).toContain(
    `Question 2, on "difference-quotient":\n${Q_QUOTIENT_AGAIN.prompt}`,
  );
  expect(after.backend.calls.map((c) => c.result)).toEqual([
    {
      status: "refused",
      text: 'Not done yet in this check: "secant-slope" is not asked yet. Post a question on each with ask_question before closing the segment.',
    },
    // Numbered after both answers of this check, the one before the restart too.
    {
      status: "done",
      text: "Posted as question 3. Your turn is over; the learner's answer will arrive in the next message.",
      endTurn: true,
    },
  ]);
  expect(
    (await reload().readEvidence(COURSE)).map((e) =>
      e.kind === "answer" ? [e.objective, e.verdict] : e.kind,
    ),
  ).toEqual([
    ["secant-slope", "correct"],
    ["difference-quotient", "correct"],
    ["difference-quotient", "correct"],
  ]);
});

test("a unit reopened in its teach phase, whose teaching a restart cut off, is taught again", async () => {
  const setup = setUp([TEACH]);
  await makeCourse();
  await reload().writePosition(COURSE, "derivative", {
    segment: 1,
    phase: "teach",
  });

  const chat = await open(setup);

  expect(setup.backend.received[0]?.text).toMatch(
    new RegExp(
      `^\\[Unit 1 of 2, "The derivative"; segment 2 of 2, "The limit", on "derivative-limit"\\. Phase: teach\\. Your teaching of this segment was cut off before it ended\\. Teach it again, from the start\\. ${JOINED_NOTE}`,
    ),
  );
  expect(since(chat, "phase").at(-1)).toEqual({
    type: "phase",
    segment: 1,
    phase: "discuss",
  });
});

test("opening a unit in progress again keeps its chat and sends nothing", async () => {
  const setup = setUp([TEACH]);
  await makeCourse();
  const [one, two] = await Promise.all([
    setup.units.open(COURSE, "derivative"),
    setup.units.open(COURSE, "derivative"),
  ]);
  if (!one.ok || !two.ok) throw new Error("not opened");
  await one.chat.settled();

  const three = await setup.units.open(COURSE, "derivative");

  expect(two.chat).toBe(one.chat);
  expect(three.ok && three.chat).toBe(one.chat);
  expect(setup.backend.sessions).toHaveLength(1);
  expect(setup.backend.received).toHaveLength(1);
  expect(setup.units.get(COURSE, "derivative")).toBe(one.chat);
});

test("a unit that cannot be planned says so in its thread, takes no action, and opening it again tries again", async () => {
  let attempts = 0;
  const planner: UnitPlanner = {
    async plan() {
      attempts += 1;
      return attempts === 1
        ? {
            ok: false,
            problem: "failed",
            error: "The tutor could not plan this unit. Try starting it again.",
          }
        : { ok: true, plan: PLAN };
    },
  };
  const setup = setUp([TEACH], { planner });
  await makeCourse(false);

  const chat = await open(setup);

  expect(chat.events()).toEqual([
    { type: "unit_planning" },
    {
      type: "unit_failed",
      error: "The tutor could not plan this unit. Try starting it again.",
    },
  ]);
  const notOpen = {
    ok: false,
    status: 409,
    error: "The unit could not be opened. Open it again to try again.",
  };
  expect(chat.say("Hello?")).toEqual(notOpen);
  expect(await chat.ready()).toEqual(notOpen);
  expect(await position()).toEqual({});

  expect(await open(setup)).toBe(chat);

  expect(attempts).toBe(2);
  expect(since(chat, "unit_plan")[0]).toEqual({
    type: "unit_plan",
    plan: PLAN,
  });
  expect(await position()).toEqual({
    derivative: { segment: 0, phase: "discuss" },
  });
});

test.each([
  { course: "no-such-course", unit: "derivative", status: 404 },
  { course: COURSE, unit: "no-such-unit", status: 404 },
])(
  "opening $unit in $course is refused as not found",
  async ({ course, unit, status }) => {
    const setup = setUp([]);
    await makeCourse();

    const opened = await setup.units.open(course, unit);

    expect(opened).toMatchObject({ ok: false, status });
    expect(setup.units.get(course, unit)).toBeUndefined();
  },
);

test("a unit of a draft curriculum cannot be opened, and the course is not marked opened", async () => {
  const setup = setUp([]);
  const root = openDataRoot({ path: dir, now: () => new Date(CREATED) });
  const { id } = await root.createCourse({ title: CURRICULUM.title });
  await root.saveProposal(id, CURRICULUM);

  expect(await setup.units.open(id, "derivative")).toEqual({
    ok: false,
    status: 409,
    error: "The curriculum is not approved yet, so its units cannot start.",
  });
  expect(
    JSON.parse(await readFile(join(dir, "courses", id, "course.json"), "utf8"))
      .lastOpenedAt,
  ).toBe(CREATED);
  expect(setup.backend.sessions).toEqual([]);
});

test('a unit whose id every object has as a property, "constructor", opens like any other', async () => {
  const setup = setUp([TEACH]);
  const root = openDataRoot({ path: dir, now: () => new Date(CREATED) });
  const { id } = await root.createCourse({ title: CURRICULUM.title });
  const proposal = {
    title: CURRICULUM.title,
    units: [
      {
        id: "constructor",
        title: "Constructions",
        goal: "Construct the tangent to a curve at a point.",
        prerequisites: [],
      },
    ],
    style: CURRICULUM.style,
  };
  await root.saveProposal(id, proposal);
  await root.approveCurriculum(id, proposal);
  await root.storePlan(id, "constructor", PLAN);

  const chat = await open(setup, "constructor");

  expect(chat.events().filter((e) => e.type === "unit_failed")).toEqual([]);
  expect(await position()).toEqual({
    constructor: { segment: 0, phase: "discuss" },
  });
});

// --- Task 2.7: how many questions, help, and the unit's end -----------------

// One segment, so closing its check ends the unit.
const SHORT: Plan = {
  objectives: PLAN.objectives.slice(0, 2),
  segments: [PLAN.segments[0] as Plan["segments"][number]],
};
const Q_QUOTIENT_2: ChoiceInput = {
  ...Q_QUOTIENT,
  prompt: "Which is the difference quotient of $g$ at $2$?",
  choices: ["$\\frac{g(2+h)-g(2)}{h}$", "$\\frac{g(h)-g(2)}{h}$"],
};
const Q_SECANT_2: ChoiceInput = {
  ...Q_SECANT,
  prompt: "Between which points does that secant run?",
  choices: ["$a$ and $0$", "$a$ and $a+h$", "$h$ and $a+h$"],
};

/** The SHORT unit's unit_status event. */
function shortStatus(
  unit: UnitStatus,
  quotient: ObjectiveStatus,
  secant: ObjectiveStatus,
): PageEvent {
  return {
    type: "unit_status",
    unit,
    objectives: { "difference-quotient": quotient, "secant-slope": secant },
  };
}

/** The reason each close_segment call was refused, or "closed". */
function closings(setup: ReturnType<typeof setUp>): string[] {
  return setup.backend.calls
    .filter((c) => c.name === "close_segment")
    .map((c) => (c.result.status === "done" ? "closed" : c.result.text));
}

test("a miss on an objective requires another question on it before the segment closes", async () => {
  const setup = setUp([
    TEACH,
    ask(Q_QUOTIENT),
    [{ call: "close_segment", input: {} }, ...ask(Q_SECANT)],
    [{ call: "close_segment", input: {} }, ...ask(Q_QUOTIENT_2)],
    CLOSE,
  ]);
  await makeCourse(true, SHORT);
  const chat = await open(setup);
  await toCheck(chat);

  await answer(chat, "B"); // a confident miss
  await answer(chat, "B");
  await answer(chat, "A");

  expect(closings(setup)).toEqual([
    'Not done yet in this check: "difference-quotient" is missed, so another question is needed (1 of at most 3 asked); "secant-slope" is not asked yet. Post a question on each with ask_question before closing the segment.',
    'Not done yet in this check: "difference-quotient" is missed, so another question is needed (1 of at most 3 asked). Post a question on each with ask_question before closing the segment.',
    "closed",
  ]);
  expect(setup.backend.received[3]?.text).toContain(
    'In this check, "difference-quotient": missed, so another question is needed (1 of at most 3 asked); "secant-slope": passed. Allowed now: post a question on "difference-quotient" with ask_question',
  );
});

test("the limit lets the segment close with an objective not passed, after which no more questions are asked on it", async () => {
  const setup = setUp([
    TEACH,
    ask(Q_QUOTIENT),
    ask(Q_QUOTIENT_2),
    ask(Q_QUOTIENT),
    [
      { call: "ask_question", input: Q_QUOTIENT_2 },
      { call: "ask_question", input: Q_SECANT },
    ],
    CLOSE,
  ]);
  await makeCourse(true, SHORT);
  const chat = await open(setup);
  await toCheck(chat);

  await answer(chat, "B");
  await answer(chat, "A", "50"); // correct but unsure: not passed yet
  await answer(chat, "C");

  expect(setup.backend.calls[3]?.result).toEqual({
    status: "refused",
    text: '"difference-quotient" needs no more questions in this check: not passed after 3 questions, the limit. Ask about "secant-slope" instead.',
  });

  await answer(chat, "B");

  expect(closings(setup)).toEqual(["closed"]);
  expect(since(chat, "unit_end")[0]).toEqual({
    type: "unit_end",
    passed: false,
    objectives: {
      "difference-quotient": "attempted",
      "secant-slope": "passed",
    },
  });
  // The unit stays in progress while its closing card waits.
  expect(await position()).toEqual({
    derivative: { segment: 0, phase: "closed" },
  });
});

test("a confident correct answer ends an objective's check at one question; an unsure one asks for another", async () => {
  const setup = setUp([
    TEACH,
    ask(Q_QUOTIENT),
    ask(Q_SECANT),
    [{ call: "close_segment", input: {} }, ...ask(Q_SECANT_2)],
    CLOSE,
  ]);
  await makeCourse(true, SHORT);
  const chat = await open(setup);
  await toCheck(chat);

  await answer(chat, "A", "90");

  expect(since(chat, "graded")[1]).toEqual(
    shortStatus("in-progress", "passed", "not-started"),
  );

  await answer(chat, "B", "75");
  await answer(chat, "B", "50");

  expect(closings(setup)).toEqual([
    'Not done yet in this check: "secant-slope" is answered correctly but not confidently, so another question is needed (1 of at most 3 asked). Post a question on each with ask_question before closing the segment.',
    "closed",
  ]);
  // Three questions in all: one for the confident answer, two for the unsure ones.
  expect(
    (await reload().readEvidence(COURSE)).map((e) =>
      e.kind === "answer" ? e.objective : e.kind,
    ),
  ).toEqual(["difference-quotient", "secant-slope", "secant-slope"]);
});

test("an answer is recorded as given with help when the tutor received a message while its question was open, and a correct one then does not count", async () => {
  const setup = setUp([
    TEACH,
    ask(Q_QUOTIENT),
    [{ text: "Think of rise over run." }],
    [{ text: "Right, with a nudge." }],
    // Between questions a message is not help.
    [
      { text: "Here is another." },
      { call: "ask_question", input: Q_QUOTIENT_2 },
    ],
    [{ text: "Good." }],
  ]);
  await makeCourse(true, SHORT);
  const chat = await open(setup);
  await toCheck(chat);

  chat.say("Is it the change in f over h?");
  await chat.settled();

  expect((await position()).derivative?.openQuestion?.assisted).toBe(true);

  await answer(chat, "A");

  expect(since(chat, "graded").slice(0, 2)).toEqual([
    expect.objectContaining({
      type: "graded",
      verdict: "correct",
      assisted: true,
    }),
    shortStatus("in-progress", "attempted", "not-started"),
  ]);
  expect(setup.backend.received[3]?.text).toContain(
    '"difference-quotient": answered correctly with help, which does not count, so another question is needed (1 of at most 3 asked)',
  );
  expect(setup.backend.received[3]?.text).toContain(
    "They had help: you received a message from them while the question was open, so this answer does not count toward passing.",
  );

  chat.say("Got it, thanks.");
  await chat.settled();
  await answer(chat, "A");

  expect(
    (await reload().readEvidence(COURSE)).map((e) =>
      e.kind === "answer" ? e.assisted : e.kind,
    ),
  ).toEqual([true, false]);
  expect(since(chat, "unit_status")[0]).toEqual(
    shortStatus("in-progress", "passed", "not-started"),
  );
});

test("a message written before a question was posted, and received by the tutor while it was open, counts as help", async () => {
  let chat: UnitChat | undefined;
  const setup = setUp([
    TEACH,
    // The learner writes while the tutor is still leading in to the question.
    () => {
      chat?.say("Is it the change in f over h?");
      return ask(Q_QUOTIENT);
    },
    [{ text: "Think of rise over run." }],
    [{ text: "Right." }],
  ]);
  await makeCourse(true, SHORT);
  chat = await open(setup);
  await toCheck(chat);

  expect(setup.backend.received[2]?.text).toMatch(
    /^\[.*Question 1, on "difference-quotient", is open\. The learner has written to you while it is open/,
  );

  await answer(chat, "A");

  expect((await reload().readEvidence(COURSE))[0]).toMatchObject({
    assisted: true,
  });
});

test("a unit not passed waits on its closing card; going over again teaches one more segment on what did not pass, and passing it closes the unit", async () => {
  const setup = setUp([
    TEACH,
    ask(Q_QUOTIENT),
    [{ text: "Right." }],
    [{ text: "Let us go over it." }],
    [{ call: "ask_question", input: Q_QUOTIENT_2 }, ...ask(Q_SECANT)],
    CLOSE,
  ]);
  await makeCourse(true, SHORT);
  const chat = await open(setup);
  await toCheck(chat);
  await answer(chat, "A");
  // The learner moves on before the second objective is asked.
  expect(await chat.override()).toEqual({ ok: true });

  expect(since(chat, "unit_end")).toEqual([
    {
      type: "unit_end",
      passed: false,
      objectives: {
        "difference-quotient": "passed",
        "secant-slope": "overridden",
      },
    },
  ]);
  expect(await chat.nextSegment()).toEqual({
    ok: false,
    status: 409,
    error:
      "This was the unit's last segment: go over the objectives not passed again, or move on without them.",
  });

  expect(await chat.goOverAgain()).toEqual({ ok: true });
  await chat.settled();

  expect(await position()).toEqual({
    derivative: { segment: 1, phase: "discuss", again: ["secant-slope"] },
  });
  expect(chat.events()).toContainEqual({
    type: "phase",
    segment: 1,
    phase: "teach",
    again: ["secant-slope"],
  });
  expect(setup.backend.received[3]?.text).toBe(
    '[Unit 1 of 2, "The derivative"; a segment after the plan\'s 1, going over "secant-slope" again. Phase: teach. Start of a segment that goes over objectives the learner has not passed. The learner moved on without finishing the check of the segment just closed, which is recorded as an override of "difference-quotient" and "secant-slope". Allowed now: teach the segment\'s objectives in this turn, within the length the style sets, then stop; the learner can ask anything next. No questions yet: ask_question and close_segment are refused until the learner presses "ready".]\n' +
      "Teach these objectives again, another way, starting from what went wrong:\n" +
      '- "secant-slope": Read a difference quotient as the slope of a secant line.',
  );

  await toCheck(chat);

  // Only what did not pass is checked again.
  expect(setup.backend.calls[1]?.result).toEqual({
    status: "refused",
    text: '"difference-quotient" is not an objective of this segment. Name one of "secant-slope".',
  });

  await answer(chat, "B");

  expect(closings(setup)).toEqual(["closed"]);
  expect(since(chat, "unit_end")).toEqual([
    {
      type: "unit_end",
      passed: true,
      objectives: { "difference-quotient": "passed", "secant-slope": "passed" },
    },
    shortStatus("passed", "passed", "passed"),
    { type: "unit_closed", status: "passed" },
    { type: "turn_end", outcome: "done" },
  ]);
  expect(await position()).toEqual({});
});

test("moving on without the objectives not passed records them as overridden and closes the unit", async () => {
  const setup = setUp([
    TEACH,
    ask(Q_QUOTIENT),
    ask(Q_QUOTIENT_2),
    ask(Q_QUOTIENT),
    ask(Q_SECANT),
    CLOSE,
  ]);
  await makeCourse(true, SHORT);
  const chat = await open(setup);
  await toCheck(chat);
  await answer(chat, "B");
  await answer(chat, "B");
  await answer(chat, "B");
  await answer(chat, "B");
  const turns = setup.backend.received.length;

  expect(await chat.finishUnit()).toEqual({ ok: true });

  expect((await reload().readEvidence(COURSE)).at(-1)).toEqual({
    kind: "override",
    recordedAt: NOW,
    objectives: ["difference-quotient"],
  });
  expect(chat.events().slice(-2)).toEqual([
    shortStatus("overridden", "overridden", "passed"),
    { type: "unit_closed", status: "overridden" },
  ]);
  expect(await position()).toEqual({});
  // Moving on costs no reply from the tutor.
  expect(setup.backend.received).toHaveLength(turns);
  expect(await chat.goOverAgain()).toEqual({
    ok: false,
    status: 409,
    error: "The unit is finished.",
  });
});

test.each([
  {
    name: "before the unit's last segment has closed",
    plan: PLAN,
    error: "The unit has not reached its end.",
  },
  {
    name: "when every objective passed",
    plan: SHORT,
    error: "The unit is finished.",
  },
])(
  "going over again and moving on without them are refused $name",
  async ({ plan, error }) => {
    const setup = setUp([TEACH, ask(Q_QUOTIENT), ask(Q_SECANT), CLOSE]);
    await makeCourse(true, plan);
    const chat = await open(setup);
    await toCheck(chat);
    await answer(chat, "A");
    await answer(chat, "B");

    for (const result of [await chat.goOverAgain(), await chat.finishUnit()]) {
      expect(result).toEqual({ ok: false, status: 409, error });
    }
  },
);

test("a unit finished before a restart opens finished, and is not started again", async () => {
  const before = setUp([TEACH, ask(Q_QUOTIENT), ask(Q_SECANT), CLOSE]);
  await makeCourse(true, SHORT);
  const first = await open(before);
  await toCheck(first);
  await answer(first, "A");
  await answer(first, "B");
  await before.units.close();

  const after = setUp([]);
  const chat = await open(after);

  expect(chat.events()).toEqual([
    { type: "unit_plan", plan: SHORT },
    shortStatus("passed", "passed", "passed"),
    { type: "unit_closed", status: "passed" },
  ]);
  expect(after.backend.received).toEqual([]);
  expect(await position()).toEqual({});
  expect(await chat.ready()).toEqual({
    ok: false,
    status: 409,
    error: "The unit is finished.",
  });
});

test("a closing card that was waiting before a restart is shown again, and going over again works after it", async () => {
  const before = setUp([TEACH, ask(Q_QUOTIENT)]);
  await makeCourse(true, SHORT);
  const first = await open(before);
  await toCheck(first);
  await answer(first, "A");
  await first.override();
  await before.units.close();

  const after = setUp([[{ text: "The secant again." }]]);
  const chat = await open(after);

  expect(chat.events()).toEqual([
    { type: "unit_plan", plan: SHORT },
    shortStatus("in-progress", "passed", "overridden"),
    { type: "phase", segment: 0, phase: "closed" },
    {
      type: "unit_end",
      passed: false,
      objectives: {
        "difference-quotient": "passed",
        "secant-slope": "overridden",
      },
    },
  ]);
  expect(await chat.goOverAgain()).toEqual({ ok: true });
  await chat.settled();
  expect(await position()).toEqual({
    derivative: { segment: 1, phase: "discuss", again: ["secant-slope"] },
  });
});

// --- Task 2.8: written answers, graded against a rubric ----------------------

const Q_PROOF: WrittenInput = {
  objective: "difference-quotient",
  kind: "written",
  prompt:
    "Show that the difference quotient of $f(x) = x^2$ at $a$ is $2a + h$.",
  rubric:
    "Writes $\\frac{(a+h)^2 - a^2}{h}$, expands the square to $2ah + h^2$, and divides by $h$, which is not $0$.",
};
const PROOF = "$\\frac{(a+h)^2-a^2}{h} = \\frac{2ah+h^2}{h} = 2a+h$.";
const FLAW = "It divides by $h$ without saying that $h \\neq 0$.";
const CORRECT: FakeReply = { output: { verdict: "correct" } };

/** The written answer as the learner sends it. */
function written(chat: UnitChat, confidence: Confidence = "100") {
  return {
    kind: "written" as const,
    questionId: openQuestionId(chat),
    text: PROOF,
    confidence,
  };
}

/** Sends the written answer, then waits until it is graded and the tutor has replied. */
async function write(chat: UnitChat, confidence: Confidence = "100") {
  expect(await chat.answer(written(chat, confidence))).toEqual({ ok: true });
  await chat.settled();
}

test("a written answer is kept, graded by the grader, and recorded with its grade, which the tutor is sent; the page never sees the rubric", async () => {
  const setup = setUp([TEACH, ask(Q_PROOF), [{ text: "Well argued." }]], {
    replies: [CORRECT],
  });
  await makeCourse();
  const chat = await open(setup);
  await toCheck(chat);
  const id = openQuestionId(chat);

  expect(since(chat, "question")[0]).toEqual({
    type: "question",
    question: { kind: "written", id, number: 1, prompt: Q_PROOF.prompt },
  });

  await write(chat);

  const sent = {
    kind: "written",
    questionId: id,
    text: PROOF,
    confidence: "100",
  };
  expect(since(chat, "grading")).toEqual([
    { type: "grading", questionId: id, answer: sent },
    {
      type: "graded",
      questionId: id,
      verdict: "correct",
      answer: sent,
      assisted: false,
    },
    status("in-progress", "passed"),
    { type: "turn_start" },
    { type: "tutor_text", text: "Well argued." },
    { type: "turn_end", outcome: "done" },
  ]);
  expect(await reload().readEvidence(COURSE)).toEqual([
    {
      kind: "answer",
      recordedAt: NOW,
      objective: "difference-quotient",
      question: stored(Q_PROOF),
      answer: sent,
      assisted: false,
      verdict: "correct",
    },
  ]);
  expect(await position()).toEqual({
    derivative: { segment: 0, phase: "check", checkFrom: 0 },
  });
  expect(setup.backend.received[2]?.text).toBe(
    '[Unit 1 of 2, "The derivative"; segment 1 of 2, "Difference quotients", on "difference-quotient" and "secant-slope". Phase: check. The learner answered question 1. In this check, "difference-quotient": passed; "secant-slope": not asked yet. Allowed now: post a question on "secant-slope" with ask_question, unlike the ones asked before. Posting ends your turn, so give any feedback first. close_segment is refused until each objective is done.]\n' +
      'Question 1, on "difference-quotient":\n' +
      `${Q_PROOF.prompt}\n` +
      "\n" +
      "The learner wrote, at 100% confidence:\n" +
      "\n" +
      `${PROOF}\n` +
      "\n" +
      "The grader, which saw only the question, your rubric and this answer, graded it correct.",
  );
});

test("a written answer graded incorrect is recorded with the flaw the grader named, which the page and the tutor are given", async () => {
  const setup = setUp([TEACH, ask(Q_PROOF), [{ text: "Nearly." }]], {
    replies: [{ output: { verdict: "incorrect", flaw: FLAW } }],
  });
  await makeCourse();
  const chat = await open(setup);
  await toCheck(chat);

  await write(chat, "90");

  expect(since(chat, "graded").slice(0, 2)).toEqual([
    expect.objectContaining({
      type: "graded",
      verdict: "incorrect",
      flaw: FLAW,
      assisted: false,
    }),
    status("in-progress", "attempted"),
  ]);
  expect(await reload().readEvidence(COURSE)).toEqual([
    expect.objectContaining({ verdict: "incorrect", flaw: FLAW }),
  ]);
  expect(setup.backend.received[2]?.text).toContain(
    "The learner wrote, at 90% confidence:\n\n" +
      `${PROOF}\n\n` +
      "The grader, which saw only the question, your rubric and this answer, graded it incorrect. " +
      `The first flaw it found: ${FLAW}`,
  );
  expect(setup.backend.received[2]?.text).toContain(
    '"difference-quotient": missed, so another question is needed (1 of at most 3 asked)',
  );
});

test("a grader reply not in the grade's shape is shown as a failed grading; the answer stays kept, is not changed, and can be graded again", async () => {
  const setup = setUp([TEACH, ask(Q_PROOF), [{ text: "Well argued." }]], {
    replies: [{ output: { verdict: "incorrect" } }, CORRECT],
  });
  await makeCourse();
  const chat = await open(setup);
  await toCheck(chat);
  const id = openQuestionId(chat);

  await write(chat);

  expect(since(chat, "grading")).toEqual([
    { type: "grading", questionId: id, answer: written(chat) },
    {
      type: "grading_failed",
      questionId: id,
      error: expect.stringMatching(
        /^The reply was not in the shape asked for: .*An incorrect verdict must name the first flawed step or missing element/s,
      ),
    },
  ]);
  expect(await reload().readEvidence(COURSE)).toEqual([]);
  expect((await position()).derivative?.openQuestion).toMatchObject({
    id,
    answer: written(chat),
  });
  // Nothing goes to the tutor without a grade.
  expect(setup.backend.received).toHaveLength(2);
  expect(await chat.answer({ ...written(chat), text: "Another try." })).toEqual(
    {
      ok: false,
      status: 409,
      error:
        "Your answer to this question is kept and waits to be graded again.",
    },
  );
  // Moving on would withdraw the question, and with it the answer sent.
  expect(await chat.override()).toEqual({
    ok: false,
    status: 409,
    error:
      "An answer is kept and waits to be graded again. Grade it again, then move on.",
  });

  expect(await chat.gradeAgain()).toEqual({ ok: true });
  await chat.settled();

  expect(since(chat, "grading").slice(0, 2)).toEqual([
    { type: "grading", questionId: id, answer: written(chat) },
    expect.objectContaining({ type: "graded", verdict: "correct" }),
  ]);
  expect(setup.backend.oneShots.map((r) => r.prompt)).toEqual([
    setup.backend.oneShots[0]?.prompt,
    setup.backend.oneShots[0]?.prompt,
  ]);
  expect(await reload().readEvidence(COURSE)).toEqual([
    expect.objectContaining({ answer: written(chat), verdict: "correct" }),
  ]);
  expect(await chat.gradeAgain()).toEqual({
    ok: false,
    status: 409,
    error: "No answer is waiting to be graded again.",
  });
});

test("the grader's request holds the question, the rubric and the answer with the grader's prompt, and nothing of the tutor's conversation", async () => {
  const setup = setUp(
    [
      [{ text: "A secant joins two points of the graph." }],
      [{ text: "Here h is the step between the two points." }],
      ask(Q_PROOF),
      [{ text: "Well argued." }],
    ],
    { replies: [CORRECT] },
  );
  await makeCourse();
  const chat = await open(setup);
  chat.say("What is h?");
  await chat.settled();
  await toCheck(chat);

  await write(chat);

  // Written out by hand: the grader's request is this and only this.
  expect(setup.backend.oneShots).toEqual([
    {
      systemPrompt: GRADER,
      prompt:
        "Grade the learner's answer to this question against the rubric.\n" +
        "\n" +
        "<question>\n" +
        "Show that the difference quotient of $f(x) = x^2$ at $a$ is $2a + h$.\n" +
        "</question>\n" +
        "\n" +
        "<rubric>\n" +
        "Writes $\\frac{(a+h)^2 - a^2}{h}$, expands the square to $2ah + h^2$, and divides by $h$, which is not $0$.\n" +
        "</rubric>\n" +
        "\n" +
        "<answer>\n" +
        "$\\frac{(a+h)^2-a^2}{h} = \\frac{2ah+h^2}{h} = 2a+h$.\n" +
        "</answer>",
      schema: expect.anything(),
      signal: expect.any(AbortSignal),
    },
  ]);
  // The tutor's session was the only session, and it heard the grade.
  expect(setup.backend.sessions).toHaveLength(1);
  expect(setup.backend.received.at(-1)?.text).toContain("graded it correct");
});

test("a message while a written answer is graded is not help; the tutor is told the answer is being graded, and its tools wait for the grade", async () => {
  const grade = Promise.withResolvers<FakeReply>();
  const setup = setUp(
    [
      TEACH,
      ask(Q_PROOF),
      [
        { call: "ask_question", input: Q_SECANT },
        { text: "It is being graded." },
      ],
      [{ text: "Well argued." }],
    ],
    { replies: [{ later: grade.promise }] },
  );
  await makeCourse();
  const chat = await open(setup);
  await toCheck(chat);
  const id = openQuestionId(chat);

  expect(await chat.answer(written(chat))).toEqual({ ok: true });
  const from = chat.events().length;
  chat.say("How long does grading take?");
  await waitFor(chat, "turn_end", from);

  expect((await position()).derivative?.openQuestion).toEqual(
    expect.objectContaining({ id, answer: written(chat) }),
  );
  expect((await position()).derivative?.openQuestion?.assisted).toBeUndefined();
  expect(setup.backend.received[2]?.text).toMatch(
    /^\[.*Question 1, on "difference-quotient", is answered, and the answer is being graded\. Allowed now: reply to the learner\. ask_question and close_segment are refused until the grade arrives, in a message of its own\.\]\nHow long does grading take\?$/,
  );
  expect(setup.backend.calls.at(-1)?.result).toEqual({
    status: "refused",
    text: "Question 1 is answered and its answer is being graded. End your turn; the grade arrives in a message of its own.",
  });

  grade.resolve(CORRECT);
  await chat.settled();

  expect(since(chat, "graded")[0]).toMatchObject({
    verdict: "correct",
    assisted: false,
  });
  expect((await reload().readEvidence(COURSE))[0]).toMatchObject({
    assisted: false,
  });
});

test("a message the tutor received before a written answer was sent makes it given with help", async () => {
  const setup = setUp(
    [
      TEACH,
      ask(Q_PROOF),
      [{ text: "Think of the square." }],
      [{ text: "Right." }],
    ],
    { replies: [CORRECT] },
  );
  await makeCourse();
  const chat = await open(setup);
  await toCheck(chat);
  chat.say("Do I expand the square?");
  await chat.settled();

  await write(chat);

  expect(since(chat, "graded").slice(0, 2)).toEqual([
    expect.objectContaining({ verdict: "correct", assisted: true }),
    status("in-progress", "attempted"),
  ]);
  expect((await reload().readEvidence(COURSE))[0]).toMatchObject({
    assisted: true,
  });
});

test("while a written answer is graded, another answer, grading again and moving on are refused", async () => {
  const grade = Promise.withResolvers<FakeReply>();
  const setup = setUp([TEACH, ask(Q_PROOF), [{ text: "Well argued." }]], {
    replies: [{ later: grade.promise }],
  });
  await makeCourse();
  const chat = await open(setup);
  await toCheck(chat);
  expect(await chat.answer(written(chat))).toEqual({ ok: true });

  expect(await chat.answer(written(chat))).toEqual({
    ok: false,
    status: 409,
    error: "Your answer to this question is being graded.",
  });
  expect(await chat.gradeAgain()).toEqual({
    ok: false,
    status: 409,
    error: "The answer is being graded.",
  });
  expect(await chat.override()).toEqual({
    ok: false,
    status: 409,
    error: "An answer is being graded. Wait for its grade, then move on.",
  });

  grade.resolve(CORRECT);
  await chat.settled();
  expect(await reload().readEvidence(COURSE)).toHaveLength(1);
});

test('a written question takes a written answer or "I don\'t know", which is recorded at once, without the grader', async () => {
  const setup = setUp([TEACH, ask(Q_PROOF), [{ text: "Let us look." }]]);
  await makeCourse();
  const chat = await open(setup);
  await toCheck(chat);
  const id = openQuestionId(chat);

  expect(
    await chat.answer({
      kind: "choice",
      questionId: id,
      choice: "A",
      confidence: "90",
    }),
  ).toEqual({
    ok: false,
    status: 400,
    error: "Question 1 is answered in writing.",
  });

  await chat.answer({ kind: "unknown", questionId: id });
  await chat.settled();

  expect(setup.backend.oneShots).toEqual([]);
  expect(since(chat, "graded")[0]).toEqual({
    type: "graded",
    questionId: id,
    verdict: "unknown",
    answer: { kind: "unknown", questionId: id },
    assisted: false,
  });
  expect(setup.backend.received[2]?.text).toContain(
    `${Q_PROOF.prompt}\n\nThe learner answered "I don't know", which counts as a miss.`,
  );
  expect(setup.backend.received[2]?.text).not.toContain("correct choice");
});

test("a choice question refuses a written answer", async () => {
  const setup = setUp([TEACH, ask(Q_QUOTIENT)]);
  await makeCourse();
  const chat = await open(setup);
  await toCheck(chat);

  expect(await chat.answer(written(chat))).toEqual({
    ok: false,
    status: 400,
    error: "Question 1 is answered with one of its choices.",
  });
  expect(setup.backend.oneShots).toEqual([]);
});

test("a written answer kept before a restart is graded when the unit reopens", async () => {
  const before = setUp([TEACH, ask(Q_PROOF)], { replies: [{ hold: true }] });
  await makeCourse();
  const first = await open(before);
  await toCheck(first);
  expect(await first.answer(written(first))).toEqual({ ok: true });
  await waitFor(first, "grading");
  const id = openQuestionId(first);
  // The server stops while the grader is working.
  await before.units.close();

  const after = setUp([[{ text: "Well argued." }]], { replies: [CORRECT] });
  const chat = await open(after);

  expect(chat.events().slice(0, 6)).toEqual([
    { type: "unit_plan", plan: PLAN },
    status("in-progress"),
    { type: "phase", segment: 0, phase: "check" },
    {
      type: "question",
      question: { kind: "written", id, number: 1, prompt: Q_PROOF.prompt },
    },
    { type: "grading", questionId: id, answer: written(chat) },
    expect.objectContaining({ type: "graded", verdict: "correct" }),
  ]);
  expect(await reload().readEvidence(COURSE)).toEqual([
    expect.objectContaining({ answer: written(chat), verdict: "correct" }),
  ]);
  expect(after.backend.received[0]?.text).toContain(JOINED_NOTE);
});

// --- Task 2.8a: a question has one answer -----------------------------------

/**
 * Stops the server and puts the unit back at the position it had before its
 * answer was recorded, as a stop between appending an answer to the evidence
 * and closing its question leaves state.json.
 */
async function stopBeforeClosing(
  setup: ReturnType<typeof setUp>,
  kept: UnitPosition | undefined,
) {
  if (kept === undefined) throw new Error("no position kept");
  await setup.units.close();
  await reload().writePosition(COURSE, "derivative", kept);
}

test("a written answer graded before a restart that left its question open is not graded again: reopening closes the question with the grade recorded, and tells the tutor", async () => {
  const grade = Promise.withResolvers<FakeReply>();
  const before = setUp([TEACH, ask(Q_PROOF), [{ text: "Well argued." }]], {
    replies: [{ later: grade.promise }],
  });
  await makeCourse();
  const first = await open(before);
  await toCheck(first);
  expect(await first.answer(written(first))).toEqual({ ok: true });
  await waitFor(first, "grading");
  const kept = (await position()).derivative;
  grade.resolve(CORRECT);
  await first.settled();
  const id = openQuestionId(first);
  await stopBeforeClosing(before, kept);

  // Asked again, this grader would contradict the grade recorded.
  const after = setUp([[{ text: "Well argued." }]], {
    replies: [{ output: { verdict: "incorrect", flaw: FLAW } }],
  });
  const chat = await open(after);

  expect(after.backend.oneShots).toEqual([]);
  expect(chat.events().slice(3, 6)).toEqual([
    {
      type: "question",
      question: { kind: "written", id, number: 1, prompt: Q_PROOF.prompt },
    },
    {
      type: "graded",
      questionId: id,
      verdict: "correct",
      answer: written(chat),
      assisted: false,
    },
    status("in-progress", "passed"),
  ]);
  expect(await reload().readEvidence(COURSE)).toEqual([
    expect.objectContaining({ answer: written(chat), verdict: "correct" }),
  ]);
  expect(await position()).toEqual({
    derivative: { segment: 0, phase: "check", checkFrom: 0 },
  });
  expect(after.backend.received[0]?.text).toContain(
    `The learner answered question 1. ${JOINED_NOTE}`,
  );
});

test("a choice answer recorded before a restart that left its question open closes the question on reopening, so it cannot be answered twice", async () => {
  const before = setUp([TEACH, ask(Q_QUOTIENT), [{ text: "Right." }]]);
  await makeCourse();
  const first = await open(before);
  await toCheck(first);
  const kept = (await position()).derivative;
  const id = openQuestionId(first);
  await answer(first, "A");
  await stopBeforeClosing(before, kept);

  const after = setUp([[{ text: "Right." }]]);
  const chat = await open(after);

  expect(since(chat, "graded").slice(0, 2)).toEqual([
    {
      type: "graded",
      questionId: id,
      verdict: "correct",
      answer: {
        kind: "choice",
        questionId: id,
        choice: "A",
        confidence: "100",
      },
      correctChoice: "A",
      assisted: false,
    },
    status("in-progress", "passed"),
  ]);
  expect(
    await chat.answer({
      kind: "choice",
      questionId: id,
      choice: "B",
      confidence: "100",
    }),
  ).toEqual({ ok: false, status: 409, error: "No question is open." });
  expect(await reload().readEvidence(COURSE)).toHaveLength(1);
  expect(after.backend.received[0]?.text).toContain(
    `The learner answered question 1. ${JOINED_NOTE}`,
  );
});

test("an answer recorded when state.json then could not be written is the one kept: the answer sent again closes the question with it, and nothing more is recorded", async () => {
  let failNextWrite = false;
  const setup = setUp([TEACH, ask(Q_QUOTIENT), [{ text: "Right." }]], {
    record: (root) => ({
      ...root,
      writePosition(...args) {
        if (!failNextWrite) return root.writePosition(...args);
        failNextWrite = false;
        return Promise.reject(new Error("The disk is full."));
      },
    }),
  });
  await makeCourse();
  const chat = await open(setup);
  await toCheck(chat);
  const id = openQuestionId(chat);
  const choose = (choice: ChoiceLetter) =>
    chat.answer({ kind: "choice", questionId: id, choice, confidence: "100" });

  failNextWrite = true;
  await expect(choose("A")).rejects.toThrow("The disk is full.");
  expect(await choose("B")).toEqual({ ok: true });
  await chat.settled();

  expect(await reload().readEvidence(COURSE)).toEqual([
    expect.objectContaining({
      answer: expect.objectContaining({ choice: "A" }),
      verdict: "correct",
    }),
  ]);
  expect(since(chat, "graded")[0]).toMatchObject({
    verdict: "correct",
    answer: { choice: "A" },
  });
  expect((await position()).derivative?.openQuestion).toBeUndefined();
});
