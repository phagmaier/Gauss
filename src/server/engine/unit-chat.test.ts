import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import type { CurriculumProposal } from "../../shared/curriculum.ts";
import type { PageEvent } from "../../shared/events.ts";
import type { Plan } from "../../shared/plan.ts";
import type { ChoiceQuestionInput } from "../../shared/question.ts";
import { createFakeBackend, type FakeTurn } from "../backends/fake.ts";
import { openDataRoot } from "../record/data-root.ts";
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

const Q_QUOTIENT: ChoiceQuestionInput = {
  objective: "difference-quotient",
  prompt: "Which is the difference quotient of $f$ at $a$?",
  choices: ["$\\frac{f(a+h)-f(a)}{h}$", "$f(a+h)-f(a)$", "$\\frac{f(a)}{h}$"],
  answer: "A",
};
const Q_SECANT: ChoiceQuestionInput = {
  objective: "secant-slope",
  prompt: "The difference quotient of $f$ at $a$ is the slope of which line?",
  choices: [
    "The tangent at $a$",
    "The secant through $a$ and $a+h$",
    "The normal at $a$",
  ],
  answer: "B",
};
const Q_LIMIT: ChoiceQuestionInput = {
  objective: "derivative-limit",
  prompt: "What is the derivative of $x^2$ at $3$?",
  choices: ["$3$", "$6$", "$9$"],
  answer: "B",
};

const TEACH: FakeTurn = [{ text: "A secant joins two points." }];
const ask = (question: ChoiceQuestionInput): FakeTurn => [
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
function stored(question: ChoiceQuestionInput) {
  const { objective: _, ...rest } = question;
  return { kind: "choice" as const, ...rest };
}

/**
 * An approved course, made the day before, with its first unit planned
 * unless `planned` is false.
 */
async function makeCourse(planned = true): Promise<void> {
  const root = openDataRoot({ path: dir, now: () => new Date(CREATED) });
  const { id } = await root.createCourse({ title: CURRICULUM.title });
  await root.saveProposal(id, CURRICULUM);
  await root.approveCurriculum(id);
  if (planned) await root.storePlan(id, "derivative", PLAN);
}

function setUp(script: FakeTurn[], planner?: UnitPlanner) {
  const backend = createFakeBackend(script);
  const dataRoot = openDataRoot({ path: dir, now: () => new Date(NOW) });
  const units = createUnitChats({
    backend,
    systemPrompt: TUTOR,
    dataRoot,
    planner:
      planner ??
      createUnitPlanner({ backend, systemPrompt: "Plan.", dataRoot }),
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

async function answer(chat: UnitChat, choice: "A" | "B" | "C") {
  const result = await chat.answer({
    kind: "choice",
    questionId: openQuestionId(chat),
    choice,
    confidence: "75",
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

test("the tutor's system prompt holds tutor.md, the course, the unit's plan and the default style", async () => {
  const setup = setUp([TEACH]);
  await makeCourse();

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

test("a course's style note takes the default's place in the system prompt", async () => {
  const setup = setUp([TEACH]);
  await makeCourse();
  const note = "Very short explanations. Many small exercises.";
  await writeFile(join(dir, "courses", COURSE, "style.md"), `${note}\n`);

  await open(setup);

  const prompt = setup.backend.sessions[0]?.systemPrompt ?? "";
  expect(prompt.endsWith(`# This course's style\n\n${note}\n`)).toBe(true);
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
    '[Unit 1 of 2, "The derivative"; segment 1 of 2, "Difference quotients", on "difference-quotient" and "secant-slope". Phase: check. The learner pressed "ready". Without an answer in this check: "difference-quotient" and "secant-slope". Allowed now: post a question on one of them with ask_question. Posting ends your turn, so give any feedback first. close_segment is refused until each objective of the segment has an answer.]',
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
    choice: "B",
    confidence: "75",
    correctChoice: "A",
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
    '[Unit 1 of 2, "The derivative"; segment 1 of 2, "Difference quotients", on "difference-quotient" and "secant-slope". Phase: check. The learner answered question 1. Without an answer in this check: "secant-slope". Allowed now: post a question on one of them with ask_question. Posting ends your turn, so give any feedback first. close_segment is refused until each objective of the segment has an answer.]\n' +
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
    choice: null,
    confidence: null,
    correctChoice: "A",
  });
  expect((await reload().readEvidence(COURSE))[0]).toMatchObject({
    verdict: "unknown",
  });
  expect(setup.backend.received[2]?.text).toContain(
    'The learner answered "I don\'t know", which counts as a miss. The correct choice is A.',
  );
});

test("close_segment is refused, with the reason, until every objective has an answer from this check; then it closes the segment", async () => {
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
      text: 'No answer yet in this check on "secant-slope". Post a question on each with ask_question before closing the segment.',
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
    'Question 1, on "difference-quotient", is open. Allowed now: reply without giving its answer away.',
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

  expect(await chat.override()).toEqual({ ok: true });
  await chat.settled();

  expect(since(chat, "overridden")).toEqual([
    {
      type: "overridden",
      segment: 0,
      objectives: ["difference-quotient", "secant-slope"],
      withdrawnQuestionId: id,
    },
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
    { type: "phase", segment: 0, phase: "closed" },
  ]);
  expect(await reload().readEvidence(COURSE)).toHaveLength(1);
});

test("the learner starts the next segment once one closes, and the last segment has none after it", async () => {
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
  expect(await position()).toEqual({
    derivative: { segment: 1, phase: "closed" },
  });
  expect(await chat.nextSegment()).toEqual({
    ok: false,
    status: 409,
    error: "This was the unit's last segment.",
  });

  expect(chat.say("Thanks!")).toEqual({ ok: true });
  await chat.settled();

  expect(setup.backend.received[7]?.text).toBe(
    '[Unit 1 of 2, "The derivative"; segment 2 of 2, "The limit", on "derivative-limit". Phase: closed. Message from the learner. The segment is closed, and it was the unit\'s last. Allowed now: reply to the learner. No teaching tools.]\nThanks!',
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
  const Q_QUOTIENT_AGAIN: ChoiceQuestionInput = {
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
  await answer(first, "A");
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
    { type: "phase", segment: 0, phase: "check" },
    {
      type: "question",
      question: {
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
    `The learner answered question 2. ${JOINED_NOTE} Without an answer in this check: "secant-slope".`,
  );
  expect(turn).toContain(
    `Question 2, on "difference-quotient":\n${Q_QUOTIENT_AGAIN.prompt}`,
  );
  expect(after.backend.calls.map((c) => c.result)).toEqual([
    {
      status: "refused",
      text: 'No answer yet in this check on "secant-slope". Post a question on each with ask_question before closing the segment.',
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
  const setup = setUp([TEACH], planner);
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
