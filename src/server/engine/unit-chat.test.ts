import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { CurriculumProposal } from "../../shared/curriculum.ts";
import type { PageEvent } from "../../shared/events.ts";
import type { Plan } from "../../shared/plan.ts";
import type { ChoiceLetter, Confidence } from "../../shared/question.ts";
import type { UnitPosition } from "../../shared/state.ts";
import type { ObjectiveStatus, UnitStatus } from "../../shared/status.ts";
import { nextStep } from "../../web/session.ts";
import {
  conversations,
  emptyTimeline,
  reduce,
  type Timeline,
} from "../../web/timeline.ts";
import type { TutorBackend } from "../backends/backend.ts";
import {
  createFakeBackend,
  type FakeBackend,
  type FakeReply,
  type FakeStep,
  type FakeTurn,
} from "../backends/fake.ts";
import { type Backup, startBackup } from "../record/backup.ts";
import { type DataRoot, openDataRoot } from "../record/data-root.ts";
import { type ChoiceOrder, givenOrder } from "./choice-order.ts";
import { IDLE_MS } from "./conversation.ts";
import { createFakeTimer, type FakeTimer } from "./fake-timer.ts";
import { createGrader } from "./grading.ts";
import { createHelpJudge } from "./help-judge.ts";
import { SESSION_GAP_MS } from "./transcript.ts";
import { createUnitChats, type UnitChat } from "./unit-chat.ts";
import { createUnitPlanner, type UnitPlanner } from "./unit-planning.ts";
import { JOINED_NOTE } from "./unit-turns.ts";

// Each test gets its own data root; none touches ~/gauss (AGENTS.md).
let dir: string;
/** The tutor sessions kept, as the SDK keeps them on disk, so a restart resumes them. */
let keptSessions: Set<string>;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "gauss-unit-chat-"));
  keptSessions = new Set();
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const CREATED = "2026-11-14T09:00:00.000Z";
const NOW = "2026-11-15T14:00:00.000Z";
const TUTOR = "You are a test tutor.";
const GRADER = "You are a test grader.";
const JUDGE = "You are a test help judge.";
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
  background:
    "The learner knows limits well and has never seen a derivative. They want to differentiate the functions of a first course.",
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

/** A session begun at the clock's time, as every chat's own opens. */
const SESSION: PageEvent = { type: "session", startedAt: NOW };

const TEACH: FakeTurn = [{ text: "A secant joins two points." }];
const ask = (question: ChoiceInput | WrittenInput): FakeStep[] => [
  { text: "Here is a question." },
  { call: "ask_question", input: question },
  { text: "Written after posting, which the learner must not see." },
];
/** The tutor's feedback on an answer, in a turn of its own (task 2.16a). */
const FEEDBACK: FakeTurn = [{ text: "Well done." }];

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
    /** The help judge's replies, in order, on a backend of its own. */
    judgments?: FakeReply[];
    /** Changes the record the chats are given, to make it fail. */
    record?: (root: DataRoot) => DataRoot;
    /** The chats' clock; NOW unless given. */
    now?: () => Date;
    /** The sessions the backend can resume; the test's own unless given. */
    kept?: Set<string>;
    /** Changes the backend the chats are given, to make it fail. */
    wrap?: (backend: FakeBackend) => TutorBackend;
    /** Closes idle tutor sessions; one the test never moves on unless given. */
    timer?: FakeTimer;
    /** The order choices are shown in; the tutor's unless given. */
    order?: ChoiceOrder;
    /** Commits the record after the steps that matter (task 2.25). */
    backup?: Backup;
    /** Gives tutors the file and shell tools (task 3.3). */
    workspaceTools?: boolean;
  } = {},
) {
  const backend = createFakeBackend(script, given.replies, {
    kept: given.kept ?? keptSessions,
  });
  const judgeBackend = createFakeBackend([], given.judgments);
  const root = openDataRoot({ path: dir, now: () => new Date(NOW) });
  const dataRoot = given.record?.(root) ?? root;
  const units = createUnitChats({
    backend: given.wrap?.(backend) ?? backend,
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
    judge: createHelpJudge({ backend: judgeBackend, systemPrompt: JUDGE }),
    now: given.now ?? (() => new Date(NOW)),
    timer: given.timer ?? createFakeTimer(),
    order: given.order ?? givenOrder,
    ...(given.backup === undefined ? {} : { backup: given.backup }),
    ...(given.workspaceTools === undefined
      ? {}
      : { workspaceTools: given.workspaceTools }),
  });
  return { backend, judgeBackend, dataRoot, units };
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
/**
 * The positions on disk, without the tutor's session id, which the tests
 * of resuming check on their own.
 */
const position = async () =>
  Object.fromEntries(
    Object.entries((await reload().readState(COURSE)).units).map(
      ([unit, { tutorSessionId: _, ...rest }]) => [unit, rest],
    ),
  );
/** The unit's position on disk as it is, the tutor's session id with it. */
const positionWritten = async (unit = "derivative") =>
  (await reload().readState(COURSE)).units[unit];
/** The tutor session id kept in the unit's position on disk. */
const sessionKept = async (unit = "derivative") =>
  (await reload().readState(COURSE)).units[unit]?.tutorSessionId;
/** The unit's position on disk now, for a listener, which cannot wait. */
const positionNow = (): unknown => {
  const { tutorSessionId: _, ...rest } = JSON.parse(
    readFileSync(join(dir, "courses", COURSE, "state.json"), "utf8"),
  ).units.derivative;
  return rest;
};

/** The thread the page builds from the chat's events. */
function replay(chat: UnitChat): Timeline {
  return chat
    .events()
    .reduce(
      (state, event, index) => reduce(state, { type: "event", index, event }),
      reduce(emptyTimeline, { type: "hello", chatId: chat.id }),
    );
}

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

/** Ends the detour a miss opened, which asks the tutor for the next question (task 2.20). */
async function anotherQuestion(chat: UnitChat) {
  expect(await chat.anotherQuestion()).toEqual({ ok: true });
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
    SESSION,
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
    "show_artifact",
  ]);
  expect(setup.backend.received[1]?.text).toBe(
    '[Unit 1 of 2, "The derivative"; segment 1 of 2, "Difference quotients", on "difference-quotient" and "secant-slope". Phase: teach. Start of the segment. Allowed now: teach the segment\'s objectives in this turn, within the length the style sets, then stop; the learner can ask anything next. No questions yet: ask_question is refused until the learner presses "ready".]\n' +
      "Teach these objectives:\n" +
      '- "difference-quotient": Form the difference quotient of a function at a point.\n' +
      '- "secant-slope": Read a difference quotient as the slope of a secant line.',
  );
  const course = await reload().readCourse(COURSE);
  expect(course?.course.lastOpenedAt).toBe(NOW);
});

test("the tutor's system prompt holds tutor.md, the course, the unit's plan and, for a course approved before its notes existed, a line saying no background was recorded and the default style", async () => {
  const setup = setUp([TEACH]);
  await makeCourse();
  await rm(join(dir, "courses", COURSE, "style.md"));
  await rm(join(dir, "courses", COURSE, "background.md"));

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
      "# The learner",
      "",
      "No background note was recorded for this course: learn what the learner knows from what they ask and answer.",
      "",
      "# This course's style",
      "",
      "This course has no style note of its own: use the default style above.",
      "",
    ].join("\n"),
  );
});

test("the background and style notes approved with the curriculum end the system prompt, the style note in the default's place", async () => {
  const setup = setUp([TEACH]);
  await makeCourse();

  await open(setup);

  const prompt = setup.backend.sessions[0]?.systemPrompt ?? "";
  expect(
    prompt.endsWith(
      [
        "# The learner",
        "",
        `What the learner told the planner when the course was made: ${CURRICULUM.background}`,
        "",
        "# This course's style",
        "",
        `${CURRICULUM.style}\n`,
      ].join("\n"),
    ),
  ).toBe(true);
  expect(prompt).not.toContain("No background note was recorded");
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

  expect(chat.events()).toMatchObject([
    SESSION,
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
    '[Unit 1 of 2, "The derivative"; segment 1 of 2, "Difference quotients", on "difference-quotient" and "secant-slope". Phase: discuss. Message from the learner. Allowed now: answer the learner; nothing here is graded. You may suggest they press "ready" for the check when they seem ready. ask_question is refused until they do.]\n' +
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
    '[Unit 1 of 2, "The derivative"; segment 1 of 2, "Difference quotients", on "difference-quotient" and "secant-slope". Phase: check. The learner pressed "ready". In this check, "difference-quotient": not asked yet; "secant-slope": not asked yet. Allowed now: post a question on "difference-quotient" and "secant-slope" with ask_question, unlike the ones asked before. Posting ends your turn, so write what you have to say first, then a one-sentence lead-in.]',
  );
});

test("a miss is graded, appended to the evidence and opens a detour, whose first turn sends the tutor the question and asks it to find the confusion; no question follows", async () => {
  const setup = setUp([
    TEACH,
    ask(Q_QUOTIENT),
    [{ text: "Not quite: A divides by $h$. Where did B come from?" }],
  ]);
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

  const choice = {
    kind: "choice",
    questionId: id,
    choice: "B",
    confidence: "75",
    reasoning: "The change in f.",
  } as const;
  // The detour opens after the grade, before the tutor's first turn in it.
  expect(since(chat, "graded")).toEqual([
    {
      type: "graded",
      questionId: id,
      verdict: "incorrect",
      answer: choice,
      correctChoice: "A",
      assisted: false,
    },
    status("in-progress", "attempted"),
    { type: "detour", questionId: id, number: 1 },
    { type: "turn_start" },
    {
      type: "tutor_text",
      text: "Not quite: A divides by $h$. Where did B come from?",
    },
    { type: "turn_end", outcome: "done" },
  ]);
  expect(await reload().readEvidence(COURSE)).toEqual([
    {
      kind: "answer",
      recordedAt: NOW,
      objective: "difference-quotient",
      question: stored(Q_QUOTIENT),
      answer: choice,
      assisted: false,
      verdict: "incorrect",
    },
  ]);
  // The position holds the open detour, so a restart reopens it.
  expect(await position()).toEqual({
    derivative: {
      segment: 0,
      phase: "check",
      checkFrom: 0,
      detour: { questionId: id, number: 1, objective: "difference-quotient" },
    },
  });
  expect(setup.backend.received[2]?.text).toBe(
    '[Unit 1 of 2, "The derivative"; segment 1 of 2, "Difference quotients", on "difference-quotient" and "secant-slope". Phase: check. The learner answered question 1. In this check, "difference-quotient": missed, so another question is needed (1 asked); "secant-slope": not asked yet. The miss opens a detour, a pause in the check: no question is posted until the learner presses "Ready for another question", and nothing said in it is graded. Allowed now, as text, with no tool: give the right answer and why it is right; then find where the confusion is, from the choice they picked and their reasoning, or, if that does not show it, by asking them one question, and work through it with them. You may suggest pressing "Ready for another question" once the confusion seems cleared.]\n' +
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
  // The engine asks for no next question: the learner ends the detour.
  expect(setup.backend.received).toHaveLength(3);
  expect(nextStep(replay(chat))).toBe("detour");
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
    'The learner answered "I don\'t know", which counts as a miss. The correct choice is A.\nThey did not say where they got stuck.',
  );
  // With nothing to go on, the tutor asks where the confusion is.
  expect(setup.backend.received[2]?.text).toContain(
    "then find where the confusion is, by asking them one question, and work through it with them.",
  );
  expect((await position()).derivative?.detour?.number).toBe(1);
});

test("the line saying where an \"I don't know\" got stuck is kept with the answer and given to the tutor in the detour's first turn", async () => {
  const setup = setUp([TEACH, ask(Q_QUOTIENT), [{ text: "Let me explain." }]]);
  await makeCourse();
  const chat = await open(setup);
  await toCheck(chat);
  const stuck = "I did not see why $h$ goes in the denominator.";

  expect(
    await chat.answer({
      kind: "unknown",
      questionId: openQuestionId(chat),
      stuck,
    }),
  ).toEqual({ ok: true });
  await chat.settled();

  expect((await reload().readEvidence(COURSE))[0]).toMatchObject({
    answer: { kind: "unknown", questionId: openQuestionId(chat), stuck },
  });
  expect(since(chat, "graded")[0]).toMatchObject({ answer: { stuck } });
  const turn = setup.backend.received[2]?.text ?? "";
  expect(turn).toContain(`\nWhere they got stuck, in their words: ${stuck}`);
  expect(turn).toContain(
    "then find where the confusion is, from where they say they got stuck, or, if that does not show it, by asking them one question,",
  );
});

test('in a detour no question can be posted and a message is not help; "Ready for another question" ends it and asks for a question on an objective still open, whose answer counts', async () => {
  const setup = setUp([
    TEACH,
    ask(Q_QUOTIENT),
    [{ text: "A is right. What made B look right?" }],
    // A reply in the detour that tries to post a question.
    [
      { call: "ask_question", input: Q_QUOTIENT_2 },
      { text: "Because $h$ is the run." },
    ],
    ask(Q_QUOTIENT_2),
    FEEDBACK,
  ]);
  await makeCourse();
  const chat = await open(setup);
  await toCheck(chat);
  await answer(chat, "B");

  chat.say("I forgot to divide. Why by h?");
  await chat.settled();

  expect(setup.backend.calls.at(-1)?.result).toEqual({
    status: "refused",
    text: 'A detour is open after the miss on question 1: no question may be posted until the learner presses "Ready for another question". The learner sees only the text you write, never your thinking: work through the confusion with them as text, suggest pressing it if they seem ready, then end your reply.',
  });
  expect(setup.backend.received[3]?.text).toBe(
    '[Unit 1 of 2, "The derivative"; segment 1 of 2, "Difference quotients", on "difference-quotient" and "secant-slope". Phase: check. Message from the learner. In this check, "difference-quotient": missed, so another question is needed (1 asked); "secant-slope": not asked yet. A detour is open after the miss on question 1, on "difference-quotient": nothing in it is graded, and the learner\'s messages are not help. Allowed now: work through the confusion with the learner. ask_question is refused until they press "Ready for another question"; you may suggest it once the confusion seems cleared.]\n' +
      "I forgot to divide. Why by h?",
  );
  expect(chat.events().filter((e) => e.type === "question")).toHaveLength(1);

  const from = chat.events().length;
  await anotherQuestion(chat);

  expect(chat.events()[from]).toEqual({ type: "detour_end" });
  expect(setup.backend.received[4]?.text).toBe(
    '[Unit 1 of 2, "The derivative"; segment 1 of 2, "Difference quotients", on "difference-quotient" and "secant-slope". Phase: check. The learner pressed "Ready for another question": the detour after question 1 is over, and the check goes on. In this check, "difference-quotient": missed, so another question is needed (1 asked); "secant-slope": not asked yet. Allowed now: a lead-in of one sentence, then a question on "difference-quotient" and "secant-slope" with ask_question, unlike the ones asked before. Do not go back over the detour. Posting ends your turn.]',
  );
  const at = (await position()).derivative;
  expect(at?.detour).toBeUndefined();
  expect(at?.openQuestion).toMatchObject({
    number: 2,
    objective: "difference-quotient",
  });
  // Once ended, there is no detour to end.
  expect(await chat.anotherQuestion()).toEqual({
    ok: false,
    status: 409,
    error: "No detour is open, so there is nothing to end.",
  });

  await answer(chat, "A");

  // The message in the detour was not help: the answer counts.
  expect(
    (await reload().readEvidence(COURSE)).map((e) =>
      e.kind === "answer" ? [e.verdict, e.assisted] : e.kind,
    ),
  ).toEqual([
    ["incorrect", false],
    ["correct", false],
  ]);
  expect(setup.backend.received[5]?.text).not.toContain("They had help");
});

test.each(["open", "missed", "stopped"] as const)(
  "ending a detour skips its queued question request after an intervening reply is %s",
  async (outcome) => {
    const writing = Promise.withResolvers<void>();
    const finishWrite = Promise.withResolvers<void>();
    const posted = Promise.withResolvers<void>();
    const finishReply = Promise.withResolvers<void>();
    let ending = false;
    const message = "Continue from the detour.";
    const setup = setUp(
      [
        TEACH,
        ask(Q_QUOTIENT),
        FEEDBACK,
        outcome === "stopped"
          ? [{ text: "Working through the detour." }, { hold: true }]
          : ask(Q_QUOTIENT_2),
        outcome === "stopped" ? ask(Q_QUOTIENT_2) : FEEDBACK,
        FEEDBACK,
      ],
      {
        record: (root) => ({
          ...root,
          async writePosition(course, unit, position) {
            if (
              ending &&
              position?.phase === "check" &&
              position.detour === undefined &&
              position.openQuestion === undefined
            ) {
              ending = false;
              writing.resolve();
              await finishWrite.promise;
            }
            return root.writePosition(course, unit, position);
          },
        }),
        wrap: (backend) => ({
          ...backend,
          async startSession(options) {
            const session = await backend.startSession(options);
            return {
              ...session,
              async *send(turn) {
                for await (const event of session.send(turn)) {
                  if (
                    turn.text.endsWith(`\n${message}`) &&
                    event.type === "turn_end" &&
                    event.outcome === "ended_by_tool"
                  ) {
                    // The learner can answer a posted question before the
                    // tutor's posting turn has finished.
                    posted.resolve();
                    await finishReply.promise;
                  }
                  yield event;
                }
              },
            };
          },
        }),
      },
    );
    try {
      await makeCourse();
      const chat = await open(setup);
      await toCheck(chat);
      await answer(chat, "B");
      const from = chat.events().length;

      ending = true;
      const ready = chat.anotherQuestion();
      await writing.promise;
      expect(chat.say(message)).toEqual({ ok: true });
      finishWrite.resolve();
      expect(await ready).toEqual({ ok: true });

      if (outcome === "stopped") {
        await waitFor(chat, "tutor_text", from);
        await chat.interrupt();
      } else {
        await posted.promise;
        if (outcome === "missed") {
          expect(
            await chat.answer({
              kind: "unknown",
              questionId: openQuestionId(chat),
            }),
          ).toEqual({ ok: true });
        }
        finishReply.resolve();
      }
      await chat.settled();

      // No stale request reaches the tutor, even if the newer question
      // has already been missed and its own detour is waiting to open.
      expect(setup.backend.received).toHaveLength(outcome === "missed" ? 5 : 4);
      if (outcome === "missed") {
        expect(setup.backend.received.at(-1)?.text).toContain(
          "The learner answered question 2.",
        );
        expect((await position()).derivative).toMatchObject({
          detour: { questionId: openQuestionId(chat), number: 2 },
        });
      } else if (outcome === "open") {
        expect((await position()).derivative?.openQuestion?.number).toBe(2);
      } else {
        expect((await position()).derivative).toEqual({
          segment: 0,
          phase: "check",
          checkFrom: 0,
        });
        chat.say("Ask the next question now.");
        await chat.settled();
        expect((await position()).derivative?.openQuestion?.number).toBe(2);
      }
    } finally {
      finishWrite.resolve();
      finishReply.resolve();
      await setup.units.close();
    }
  },
);

test("from the second miss on an objective in this check, the detour's first turn asks the tutor to teach it again another way", async () => {
  const setup = setUp([
    TEACH,
    ask(Q_QUOTIENT),
    FEEDBACK,
    ask(Q_QUOTIENT_2),
    FEEDBACK,
  ]);
  await makeCourse(true, SHORT);
  const chat = await open(setup);
  await toCheck(chat);
  const again = "has been missed";

  await answer(chat, "B");

  expect(setup.backend.received[2]?.text).not.toContain(again);

  await anotherQuestion(chat);
  await chat.answer({ kind: "unknown", questionId: openQuestionId(chat) });
  await chat.settled();

  expect(setup.backend.received[4]?.text).toContain(
    'by asking them one question, and work through it with them. "difference-quotient" has been missed 2 times in this check, so after the right answer, teach the objective again another way: a new angle and a new example, not a repeat of your teaching, and not only a fix of this one mistake. You may suggest',
  );
});

test("moving on from a detour ends it, records the override and closes the segment", async () => {
  const setup = setUp([TEACH, ask(Q_QUOTIENT), FEEDBACK, [{ text: "Okay." }]]);
  await makeCourse();
  const chat = await open(setup);
  await toCheck(chat);
  await answer(chat, "B");
  const from = chat.events().length;

  expect(await chat.override()).toEqual({ ok: true });

  expect(chat.events().slice(from)).toEqual([
    {
      type: "overridden",
      segment: 0,
      objectives: ["difference-quotient", "secant-slope"],
    },
    status("in-progress", "overridden", "overridden"),
    { type: "phase", segment: 0, phase: "closed" },
  ]);
  expect((await reload().readEvidence(COURSE)).at(-1)).toEqual({
    kind: "override",
    recordedAt: NOW,
    objectives: ["difference-quotient", "secant-slope"],
  });
  expect(await position()).toEqual({
    derivative: { segment: 0, phase: "closed" },
  });
  expect(nextStep(replay(chat))).toBe("next-segment");

  chat.say("Fine.");
  await chat.settled();

  expect(setup.backend.received[3]?.text).toContain(
    'The learner moved on without finishing the check of the segment just closed, which is recorded as an override of "difference-quotient" and "secant-slope".',
  );
});

test("a restart reopens a detour: the thread shows it once, nothing is sent, and the learner ends it as before", async () => {
  const before = setUp([TEACH, ask(Q_QUOTIENT), FEEDBACK]);
  await makeCourse();
  const first = await open(before);
  await toCheck(first);
  await answer(first, "B");
  const id = openQuestionId(first);
  await before.units.close();

  const after = setUp([ask(Q_SECANT)]);
  const chat = await open(after);

  expect(since(chat, "session")).toEqual([
    SESSION,
    { type: "unit_plan", plan: PLAN },
    status("in-progress", "attempted"),
    { type: "phase", segment: 0, phase: "check" },
    { type: "detour", questionId: id, number: 1 },
  ]);
  expect(after.backend.received).toEqual([]);
  const thread = replay(chat);
  expect(thread.items.filter((i) => i.kind === "detour")).toHaveLength(1);
  expect(nextStep(thread)).toBe("detour");

  await anotherQuestion(chat);

  expect(after.backend.received[0]?.text).toContain(
    "the detour after question 1 is over, and the check goes on.",
  );
  expect((await position()).derivative?.openQuestion?.number).toBe(2);
  expect(nextStep(replay(chat))).toBe("move-on");
});

test("a miss recorded before a restart that left its question open opens its detour when the unit reopens", async () => {
  const before = setUp([TEACH, ask(Q_QUOTIENT)]);
  await makeCourse();
  const first = await open(before);
  await toCheck(first);
  const id = openQuestionId(first);
  await before.units.close();
  // The answer reached the evidence; the restart came before the question closed.
  await reload().appendEvidence(COURSE, {
    kind: "answer",
    recordedAt: NOW,
    objective: "difference-quotient",
    question: stored(Q_QUOTIENT),
    answer: { kind: "unknown", questionId: id },
    assisted: false,
    verdict: "unknown",
  });

  const after = setUp([[{ text: "Let me explain." }]]);
  const chat = await open(after);

  expect((await position()).derivative).toEqual({
    segment: 0,
    phase: "check",
    checkFrom: 0,
    detour: { questionId: id, number: 1, objective: "difference-quotient" },
  });
  expect(after.backend.received[0]?.text).toContain("The miss opens a detour");
  expect(after.backend.received).toHaveLength(1);
  expect(chat.events().filter((e) => e.type === "detour")).toHaveLength(1);
});

test("the segment closes when the feedback on the answer that leaves every objective done in this check ends, and not before, even with an objective passed before the check", async () => {
  const setup = setUp([
    TEACH,
    ask(Q_QUOTIENT),
    [{ text: "Right." }],
    ask(Q_SECANT),
    FEEDBACK,
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

  // Not closed: the next question is asked for, on the objective passed
  // before the check.
  expect(await position()).toMatchObject({
    derivative: { phase: "check", openQuestion: { number: 2 } },
  });
  expect(setup.backend.received[3]?.text).toContain(
    'In this check, "difference-quotient": passed; "secant-slope": not asked yet. Allowed now: a lead-in of one sentence, then a question on "secant-slope" with ask_question',
  );

  await answer(chat, "B");

  expect(since(chat, "turn_start")).toEqual([
    { type: "turn_start" },
    { type: "tutor_text", text: "Well done." },
    { type: "turn_end", outcome: "done" },
    { type: "phase", segment: 0, phase: "closed" },
  ]);
  expect(await position()).toEqual({
    derivative: { segment: 0, phase: "closed" },
  });
  // Nothing more is sent to the tutor.
  expect(setup.backend.received).toHaveLength(5);
});

test.each([
  {
    phase: "teach",
    script: [
      [{ call: "ask_question", input: Q_QUOTIENT }, { text: "Teaching on." }],
    ] satisfies FakeTurn[],
    act: async (_chat: UnitChat) => {},
    last: "Teaching on.",
    refusal:
      'The check has not started: the segment is in its teach phase. Teach now; the learner moves to the check by pressing "ready" after the discussion.',
  },
  {
    phase: "discuss",
    script: [
      TEACH,
      [
        { call: "ask_question", input: Q_QUOTIENT },
        { text: "Ask me anything." },
      ],
    ] satisfies FakeTurn[],
    act: async (chat: UnitChat) => {
      chat.say("Can you quiz me?");
    },
    last: "Ask me anything.",
    refusal:
      'The check has not started: the learner has not pressed "ready". Answer their questions; you may suggest they press "ready" when they seem ready.',
  },
  {
    phase: "closed",
    script: [
      TEACH,
      [
        { call: "ask_question", input: Q_QUOTIENT },
        { text: "Start the next segment when you like." },
      ],
    ] satisfies FakeTurn[],
    act: async (chat: UnitChat) => {
      await chat.override();
      chat.say("One more question, please?");
    },
    last: "Start the next segment when you like.",
    refusal:
      "The segment is closed, so its check is over. The learner starts the next segment.",
  },
])(
  "in $phase, ask_question is refused with a reason that reaches the tutor",
  async ({ script, act, last, refusal }) => {
    const setup = setUp(script);
    await makeCourse();
    const chat = await open(setup);

    await act(chat);
    await chat.settled();

    expect(setup.backend.calls.map((c) => c.result)).toEqual([
      { status: "refused", text: refusal },
    ]);
    expect(chat.events().some((e) => e.type === "question")).toBe(false);
    // The turn went on after the refusal.
    expect(chat.events().findLast((e) => e.type === "tutor_text")).toEqual({
      type: "tutor_text",
      text: last,
    });
  },
);

test("in the check, a second question while one is open and a question on another segment's objective are refused", async () => {
  const setup = setUp(
    [
      TEACH,
      [
        { call: "ask_question", input: Q_LIMIT },
        { call: "ask_question", input: Q_QUOTIENT },
      ],
      [
        { text: "Think about the slope." },
        { call: "ask_question", input: Q_SECANT },
      ],
    ],
    { judgments: [HELP] },
  );
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
      text: expect.stringMatching(/^Posted as question 1\. The app shuffled/),
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
    FEEDBACK,
    ask(Q_SECANT),
    FEEDBACK,
    [{ text: "Now the limit." }],
    ask(Q_LIMIT),
    FEEDBACK,
    [{ text: "You're welcome." }],
  ]);
  await makeCourse();
  const chat = await open(setup);
  await toCheck(chat);
  await answer(chat, "A");
  await answer(chat, "B");

  expect(await chat.nextSegment()).toEqual({ ok: true });
  await chat.settled();

  expect(setup.backend.received[5]?.text).toMatch(
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

  expect(setup.backend.received[8]?.text).toBe(
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

test('"ready", another question, moving on and the next segment wait until the tutor has finished', async () => {
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
  expect(await chat.anotherQuestion()).toEqual(wait);
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
  const before = setUp([
    TEACH,
    ask(Q_QUOTIENT),
    FEEDBACK,
    ask(Q_QUOTIENT_AGAIN),
  ]);
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
  const after = setUp([FEEDBACK, ask(Q_SECANT)]);
  const chat = await open(after);

  // After the earlier session's thread, the new session's.
  expect(since(chat, "session")).toEqual([
    SESSION,
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
    `The learner answered question 2. In this check, "difference-quotient": passed; "secant-slope": not asked yet.`,
  );
  expect(turn).toContain(
    `Question 2, on "difference-quotient":\n${Q_QUOTIENT_AGAIN.prompt}`,
  );
  // The next question is on the objective not asked in this check, though
  // it passed before it.
  expect(after.backend.received[1]?.text).toContain(
    'Allowed now: a lead-in of one sentence, then a question on "secant-slope" with ask_question',
  );
  expect(after.backend.calls.map((c) => c.result)).toEqual([
    // Numbered after both answers of this check, the one before the restart too.
    {
      status: "done",
      text: expect.stringMatching(/^Posted as question 3\. The app shuffled/),
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
    SESSION,
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
  // No conversation with the tutor failed to resume, so there is none to give up.
  expect(await chat.startFresh()).toEqual(notOpen);
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
    background: CURRICULUM.background,
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
const Q_QUOTIENT_3: ChoiceInput = {
  ...Q_QUOTIENT,
  prompt: "Which is the difference quotient of $k$ at $-1$?",
  choices: ["$\\frac{k(-1+h)-k(-1)}{h}$", "$\\frac{k(h)-k(-1)}{h}$"],
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

/** The segments closed, in order. */
function closedSegments(chat: UnitChat): number[] {
  return chat
    .events()
    .flatMap((e) =>
      e.type === "phase" && e.phase === "closed" ? [e.segment] : [],
    );
}

test("after a miss an objective needs two more correct answers, to different questions, before the segment closes", async () => {
  const setup = setUp([
    TEACH,
    ask(Q_QUOTIENT),
    FEEDBACK,
    ask(Q_SECANT),
    FEEDBACK,
    ask(Q_QUOTIENT_2),
    FEEDBACK,
    ask(Q_QUOTIENT_3),
    FEEDBACK,
  ]);
  await makeCourse(true, SHORT);
  const chat = await open(setup);
  await toCheck(chat);

  await answer(chat, "B"); // a confident miss
  await anotherQuestion(chat);
  await answer(chat, "B");

  expect(closedSegments(chat)).toEqual([]);
  expect(setup.backend.received[5]?.text).toContain(
    'In this check, "difference-quotient": missed, so another question is needed (1 asked); "secant-slope": passed. Allowed now: a lead-in of one sentence, then a question on "difference-quotient" with ask_question',
  );

  await answer(chat, "A"); // confident and correct, but one is not enough after a miss

  expect(closedSegments(chat)).toEqual([]);
  expect(setup.backend.received[7]?.text).toContain(
    '"difference-quotient": answered correctly, which does not pass alone, so a second correct answer, to a different question, is needed (2 asked)',
  );

  await answer(chat, "A");

  expect(closedSegments(chat)).toEqual([0]);
  expect(setup.backend.received).toHaveLength(9);
});

test("there is no limit: an objective not passed is asked again until it passes or the learner moves on", async () => {
  const setup = setUp([
    TEACH,
    ask(Q_QUOTIENT),
    FEEDBACK,
    ask(Q_QUOTIENT_2),
    FEEDBACK,
    ask(Q_QUOTIENT_3),
    FEEDBACK,
    ask(Q_QUOTIENT),
  ]);
  await makeCourse(true, SHORT);
  const chat = await open(setup);
  await toCheck(chat);

  await answer(chat, "B");
  await anotherQuestion(chat);
  await answer(chat, "A", "50"); // correct but unsure: not passed yet
  await answer(chat, "B");
  await anotherQuestion(chat);

  // A fourth question on it is posted, not refused, and the segment stays open.
  expect(setup.backend.received[7]?.text).toContain(
    '"difference-quotient": missed, so another question is needed (3 asked)',
  );
  expect((await position()).derivative?.openQuestion?.question.prompt).toBe(
    Q_QUOTIENT.prompt,
  );
  expect(closedSegments(chat)).toEqual([]);

  // Moving on withdraws it, and closes the unit's only segment.
  expect(await chat.override()).toEqual({ ok: true });
  await chat.settled();

  expect(closedSegments(chat)).toEqual([0]);
  expect(since(chat, "unit_end")[0]).toEqual({
    type: "unit_end",
    passed: false,
    objectives: {
      "difference-quotient": "overridden",
      "secant-slope": "overridden",
    },
  });
  // The unit stays in progress while its closing card waits.
  expect(await position()).toEqual({
    derivative: { segment: 0, phase: "closed" },
  });
});

test("a confident correct answer ends an objective's check at one question; an unsure one asks for a second, and two pass", async () => {
  const setup = setUp([
    TEACH,
    ask(Q_QUOTIENT),
    FEEDBACK,
    ask(Q_SECANT),
    FEEDBACK,
    ask(Q_SECANT_2),
    FEEDBACK,
  ]);
  await makeCourse(true, SHORT);
  const chat = await open(setup);
  await toCheck(chat);

  await answer(chat, "A", "90");

  expect(since(chat, "graded")[1]).toEqual(
    shortStatus("in-progress", "passed", "not-started"),
  );

  await answer(chat, "B", "75");

  expect(setup.backend.received[5]?.text).toContain(
    '"secant-slope": answered correctly, which does not pass alone, so a second correct answer, to a different question, is needed (1 asked). Allowed now: a lead-in of one sentence, then a question on "secant-slope"',
  );
  expect(closedSegments(chat)).toEqual([]);

  await answer(chat, "B", "50");

  // Two unsure correct answers, to different questions, pass it.
  expect(closedSegments(chat)).toEqual([0]);
  expect(since(chat, "graded")[1]).toEqual(
    shortStatus("in-progress", "passed", "passed"),
  );
  // Three questions in all: one for the confident answer, two for the
  // secant.
  expect(
    (await reload().readEvidence(COURSE)).map((e) =>
      e.kind === "answer" ? e.objective : e.kind,
    ),
  ).toEqual(["difference-quotient", "secant-slope", "secant-slope"]);
});

// --- Task 2.21: clarification or help, judged after the reply ----------------

/** The help judge's calls. */
const CLARIFICATION: FakeReply = {
  output: { reason: "It said what $h$ stands for.", verdict: "clarification" },
};
const HELP: FakeReply = {
  output: { reason: "It pointed at the method.", verdict: "help" },
};

/** The id of the learner's last message, as the page has it. */
function lastLearnerId(chat: UnitChat): string {
  const said = chat.events().findLast((e) => e.type === "learner");
  if (said?.type !== "learner" || said.id === undefined) {
    throw new Error("no message");
  }
  return said.id;
}

/** A confident, correct answer to Q_QUOTIENT, as the learner sends it. */
function rightQuotient(chat: UnitChat) {
  return {
    kind: "choice" as const,
    questionId: openQuestionId(chat),
    choice: "A" as const,
    confidence: "100" as const,
  };
}

test("the tutor's reply to a message sent while a question is open is judged once it ends, from the question with its correct choice, the message and the whole reply; judged clarification, the answer still counts", async () => {
  const setup = setUp(
    [
      TEACH,
      ask(Q_QUOTIENT),
      [{ text: "$h$ is the step " }, { text: "away from $a$." }],
      [{ text: "Right." }],
      [{ text: "Now the secant." }],
    ],
    { judgments: [CLARIFICATION] },
  );
  await makeCourse(true, SHORT);
  const chat = await open(setup);
  await toCheck(chat);

  chat.say("What does $h$ stand for?");
  await chat.settled();
  const learnerId = lastLearnerId(chat);

  // The tutor is told what it may clarify, and that its reply is judged.
  expect(setup.backend.received[2]?.text).toContain(
    'Message from the learner. Question 1, on "difference-quotient", is open. Allowed now: reply without giving its answer away. You may clarify what the question asks: its wording, its notation, the form of answer wanted. A separate judge reads each reply you write while it is open',
  );
  expect(setup.judgeBackend.oneShots).toHaveLength(1);
  const request = setup.judgeBackend.oneShots[0];
  expect(request?.systemPrompt).toBe(JUDGE);
  expect(request?.prompt).toContain(
    "<question>\nWhich is the difference quotient of $f$ at $a$?\n</question>",
  );
  expect(request?.prompt).toContain(
    "<correct_choice>\nA. $\\frac{f(a+h)-f(a)}{h}$\n</correct_choice>",
  );
  expect(request?.prompt).toContain(
    "<message>\nWhat does $h$ stand for?\n</message>",
  );
  expect(request?.prompt).toContain(
    "<reply>\n$h$ is the step away from $a$.\n</reply>",
  );
  // The call follows the reply on the page.
  expect(since(chat, "turn_end")).toEqual([
    { type: "turn_end", outcome: "done" },
    { type: "judging", learnerId, number: 1 },
    { type: "judged", learnerId, number: 1, verdict: "clarification" },
  ]);
  const open1 = (await position()).derivative?.openQuestion;
  expect(open1).not.toHaveProperty("judging");
  expect(open1).not.toHaveProperty("assisted");

  await answer(chat, "A");

  expect(since(chat, "graded").slice(0, 2)).toEqual([
    expect.objectContaining({ verdict: "correct", assisted: false }),
    shortStatus("in-progress", "passed", "not-started"),
  ]);
  expect((await reload().readEvidence(COURSE))[0]).toMatchObject({
    assisted: false,
  });
});

test("one reply judged help, among replies judged clarification, makes the answer given with help, which the tutor is told and which does not count; a message between questions is not judged", async () => {
  const setup = setUp(
    [
      TEACH,
      ask(Q_QUOTIENT),
      [{ text: "$h$ is the step away from $a$." }],
      [{ text: "Think of rise over run." }],
      [{ text: "You are welcome." }],
      [{ text: "Right, with a nudge." }],
      // Asked for the next question, the tutor posts none.
      [{ text: "Any questions before the next one?" }],
      // Between questions a message is not judged: no question is open.
      [
        { text: "Here is another." },
        { call: "ask_question", input: Q_QUOTIENT_2 },
      ],
      [{ text: "Good." }],
      [{ text: "Now the secant." }],
    ],
    { judgments: [CLARIFICATION, HELP, CLARIFICATION] },
  );
  await makeCourse(true, SHORT);
  const chat = await open(setup);
  await toCheck(chat);

  chat.say("What does $h$ stand for?");
  chat.say("Is it the change in f over h?");
  await chat.settled();

  expect(
    chat.events().flatMap((e) => (e.type === "judged" ? [e.verdict] : [])),
  ).toEqual(["clarification", "help"]);
  expect((await position()).derivative?.openQuestion).toMatchObject({
    assisted: true,
  });
  // The tutor is told, in later headers, that the answer will not count.
  chat.say("Thanks.");
  await chat.settled();
  expect(setup.backend.received[4]?.text).toContain(
    "A reply of yours to the learner while it was open was judged help, so the answer will be recorded as given with help.",
  );

  await answer(chat, "A");

  expect(since(chat, "graded").slice(0, 2)).toEqual([
    expect.objectContaining({ verdict: "correct", assisted: true }),
    shortStatus("in-progress", "attempted", "not-started"),
  ]);
  expect(setup.backend.received[5]?.text).toContain(
    '"difference-quotient": answered correctly with help, which does not count, so another question is needed (1 asked)',
  );
  expect(setup.backend.received[5]?.text).toContain(
    "They had help: a reply of yours to a message of theirs while the question was open was judged help, or could not be judged, so this answer does not count toward passing.",
  );

  chat.say("Got it, thanks.");
  await chat.settled();
  await answer(chat, "A");

  // Three replies during question 1 were judged; none after it.
  expect(setup.judgeBackend.oneShots).toHaveLength(3);
  expect(
    (await reload().readEvidence(COURSE)).map((e) =>
      e.kind === "answer" ? e.assisted : e.kind,
    ),
  ).toEqual([true, false]);
  expect(since(chat, "unit_status")[0]).toEqual(
    shortStatus("in-progress", "passed", "not-started"),
  );
});

test("a judging call that fails counts as help, and the page hears that the reply could not be judged", async () => {
  const setup = setUp(
    [
      TEACH,
      ask(Q_QUOTIENT),
      [{ text: "$h$ is the step away from $a$." }],
      [{ text: "Right." }],
      [{ text: "Now the secant." }],
    ],
    { judgments: [{ fail: "Usage limit reached." }] },
  );
  await makeCourse(true, SHORT);
  const chat = await open(setup);
  await toCheck(chat);
  const quiet = vi.spyOn(console, "error").mockImplementation(() => {});

  chat.say("What does $h$ stand for?");
  await chat.settled();
  quiet.mockRestore();

  expect(chat.events().at(-1)).toEqual({
    type: "judged",
    learnerId: lastLearnerId(chat),
    number: 1,
    verdict: "help",
    unjudged: "failed",
  });

  await answer(chat, "A");

  expect((await reload().readEvidence(COURSE))[0]).toMatchObject({
    verdict: "correct",
    assisted: true,
  });
});

test("a reply with no text gave the learner nothing: it is not judged, and the answer still counts", async () => {
  const setup = setUp(
    [TEACH, ask(Q_QUOTIENT), [], [{ text: "Right." }], [{ text: "Next." }]],
    { judgments: [HELP] },
  );
  await makeCourse(true, SHORT);
  const chat = await open(setup);
  await toCheck(chat);

  chat.say("Is it the change in f over h?");
  await chat.settled();

  expect(setup.judgeBackend.oneShots).toEqual([]);
  expect(chat.events().some((e) => e.type === "judging")).toBe(false);
  expect((await position()).derivative?.openQuestion).not.toHaveProperty(
    "judging",
  );

  await answer(chat, "A");

  expect((await reload().readEvidence(COURSE))[0]).toMatchObject({
    assisted: false,
  });
});

test("an answer sent before the judge's call returns waits for it, kept in state.json, and is graded once the call is in", async () => {
  const call = Promise.withResolvers<FakeReply>();
  const setup = setUp(
    [
      TEACH,
      ask(Q_QUOTIENT),
      [{ text: "$h$ is the step away from $a$." }],
      [{ text: "Right." }],
      [{ text: "Now the secant." }],
    ],
    { judgments: [{ later: call.promise }] },
  );
  await makeCourse(true, SHORT);
  const chat = await open(setup);
  await toCheck(chat);
  chat.say("What does $h$ stand for?");
  await waitFor(chat, "judging");
  const learnerId = lastLearnerId(chat);
  const sent = rightQuotient(chat);

  expect(await chat.answer(sent)).toEqual({ ok: true });

  // Kept, not graded: nothing is recorded, and the tutor is sent nothing.
  expect(chat.events().at(-1)).toEqual({
    type: "answer_waiting",
    questionId: sent.questionId,
    answer: sent,
  });
  expect(await reload().readEvidence(COURSE)).toEqual([]);
  expect((await position()).derivative?.openQuestion).toMatchObject({
    judging: [learnerId],
    answer: sent,
  });
  expect(setup.backend.received).toHaveLength(3);
  // Another answer, and moving on, wait for it too.
  expect(await chat.answer({ ...sent, choice: "B" })).toEqual({
    ok: false,
    status: 409,
    error:
      "Your answer to this question is kept, and is graded once the tutor's replies while it was open have been judged.",
  });
  expect(await chat.override()).toEqual({
    ok: false,
    status: 409,
    error: "An answer is being graded. Wait for its grade, then move on.",
  });

  call.resolve(CLARIFICATION);
  await chat.settled();

  expect(since(chat, "judged").slice(0, 3)).toEqual([
    { type: "judged", learnerId, number: 1, verdict: "clarification" },
    expect.objectContaining({
      type: "graded",
      verdict: "correct",
      answer: sent,
      assisted: false,
    }),
    shortStatus("in-progress", "passed", "not-started"),
  ]);
  expect(await reload().readEvidence(COURSE)).toEqual([
    expect.objectContaining({ answer: sent, assisted: false }),
  ]);
  expect(setup.backend.received[3]?.text).toContain(
    "The learner answered question 1.",
  );
});

test("an answer sent while the tutor is still replying to a message sent during the question waits for that reply and its judging; judged help, it is given with help", async () => {
  const setup = setUp(
    [
      TEACH,
      ask(Q_QUOTIENT),
      [{ text: "Use the formula for the slope." }, { hold: true }],
      [{ text: "Right." }],
    ],
    { judgments: [HELP] },
  );
  await makeCourse(true, SHORT);
  const chat = await open(setup);
  await toCheck(chat);
  const from = chat.events().length;

  chat.say("How do I start?");
  await waitFor(chat, "tutor_text", from);
  expect(await chat.answer(rightQuotient(chat))).toEqual({ ok: true });

  expect(chat.events().at(-1)).toMatchObject({ type: "answer_waiting" });
  expect(await reload().readEvidence(COURSE)).toEqual([]);

  // The learner stops the reply; what it wrote is judged.
  await chat.interrupt();
  await chat.settled();

  expect(
    since(chat, "answer_waiting")
      .filter((e) =>
        ["answer_waiting", "turn_end", "judged", "graded"].includes(e.type),
      )
      .map((e) => e.type)
      .slice(0, 4),
  ).toEqual(["answer_waiting", "turn_end", "judged", "graded"]);
  expect(setup.judgeBackend.oneShots[0]?.prompt).toContain(
    "<reply>\nUse the formula for the slope.\n</reply>",
  );
  expect((await reload().readEvidence(COURSE))[0]).toMatchObject({
    verdict: "correct",
    assisted: true,
  });
});

test.each(["Use rise over run.", ""])(
  "closing during a reply (%j) keeps its waiting answer for reopening without judging or grading it",
  async (reply) => {
    const setup = setUp(
      [TEACH, ask(Q_QUOTIENT), [{ text: reply }, { hold: true }]],
      { judgments: [CLARIFICATION] },
    );
    try {
      await makeCourse(true, SHORT);
      const chat = await open(setup);
      await toCheck(chat);
      const from = chat.events().length;
      chat.say("What does this question mean?");
      await waitFor(chat, "tutor_text", from);
      const sent = rightQuotient(chat);
      expect(await chat.answer(sent)).toEqual({ ok: true });
      const kept = await positionWritten();

      await setup.units.close();
      await chat.settled();

      expect(setup.judgeBackend.oneShots).toEqual([]);
      expect(await reload().readEvidence(COURSE)).toEqual([]);
      expect(await positionWritten()).toEqual(kept);
      expect(kept?.openQuestion).toMatchObject({
        answer: sent,
        judging: [lastLearnerId(chat)],
      });
      expect(
        chat
          .events()
          .slice(from)
          .some((e) => e.type === "graded"),
      ).toBe(false);
    } finally {
      await setup.units.close();
    }
  },
);

test("replies a restart kept from the judge count as help when the unit reopens, and an answer kept for them is graded then", async () => {
  const before = setUp(
    [TEACH, ask(Q_QUOTIENT), [{ text: "$h$ is the step away from $a$." }]],
    { judgments: [{ hold: true }] },
  );
  await makeCourse(true, SHORT);
  const first = await open(before);
  await toCheck(first);
  first.say("What does $h$ stand for?");
  await waitFor(first, "judging");
  const learnerId = lastLearnerId(first);
  const sent = rightQuotient(first);
  expect(await first.answer(sent)).toEqual({ ok: true });
  // The server stops while the judge is working.
  await before.units.close();
  expect(await reload().readEvidence(COURSE)).toEqual([]);

  const after = setUp([[{ text: "Right." }], [{ text: "Now the secant." }]]);
  const chat = await open(after);

  expect(since(chat, "session").slice(3, 8)).toEqual([
    { type: "phase", segment: 0, phase: "check" },
    expect.objectContaining({ type: "question" }),
    {
      type: "judged",
      learnerId,
      number: 1,
      verdict: "help",
      unjudged: "restart",
    },
    expect.objectContaining({
      type: "graded",
      answer: sent,
      assisted: true,
    }),
    shortStatus("in-progress", "attempted", "not-started"),
  ]);
  expect(after.judgeBackend.oneShots).toEqual([]);
  expect(await reload().readEvidence(COURSE)).toEqual([
    expect.objectContaining({ answer: sent, assisted: true }),
  ]);
});

test("a unit not passed waits on its closing card; going over again teaches one more segment on what did not pass, and passing it closes the unit", async () => {
  const setup = setUp([
    TEACH,
    ask(Q_QUOTIENT),
    [{ text: "Right." }],
    [{ text: "Any questions before the next one?" }],
    [{ text: "Let us go over it." }],
    [{ call: "ask_question", input: Q_QUOTIENT_2 }, ...ask(Q_SECANT)],
    FEEDBACK,
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
  expect(setup.backend.received[4]?.text).toBe(
    '[Unit 1 of 2, "The derivative"; a segment after the plan\'s 1, going over "secant-slope" again. Phase: teach. Start of a segment that goes over objectives the learner has not passed. The learner moved on without finishing the check of the segment just closed, which is recorded as an override of "difference-quotient" and "secant-slope". Allowed now: teach the segment\'s objectives in this turn, within the length the style sets, then stop; the learner can ask anything next. No questions yet: ask_question is refused until the learner presses "ready".]\n' +
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

  expect(closedSegments(chat)).toEqual([0, 1]);
  expect(since(chat, "unit_end")).toEqual([
    {
      type: "unit_end",
      passed: true,
      objectives: { "difference-quotient": "passed", "secant-slope": "passed" },
    },
    shortStatus("passed", "passed", "passed"),
    { type: "unit_closed", status: "passed" },
  ]);
  expect(await position()).toEqual({});
});

test("moving on without the objectives not passed records them as overridden and closes the unit", async () => {
  const setup = setUp([
    TEACH,
    ask(Q_QUOTIENT),
    FEEDBACK,
    ask(Q_SECANT),
    FEEDBACK,
    ask(Q_QUOTIENT_2),
  ]);
  await makeCourse(true, SHORT);
  const chat = await open(setup);
  await toCheck(chat);
  await answer(chat, "B"); // missed
  await anotherQuestion(chat);
  await answer(chat, "B"); // passed
  // Moving on from the check reaches the unit's closing card.
  expect(await chat.override()).toEqual({ ok: true });
  await chat.settled();
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
    const setup = setUp([
      TEACH,
      ask(Q_QUOTIENT),
      FEEDBACK,
      ask(Q_SECANT),
      FEEDBACK,
    ]);
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
  const before = setUp([
    TEACH,
    ask(Q_QUOTIENT),
    FEEDBACK,
    ask(Q_SECANT),
    FEEDBACK,
  ]);
  await makeCourse(true, SHORT);
  const first = await open(before);
  await toCheck(first);
  await answer(first, "A");
  await answer(first, "B");
  await before.units.close();

  const after = setUp([]);
  const chat = await open(after);

  expect(since(chat, "session")).toEqual([
    SESSION,
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

  expect(since(chat, "session")).toEqual([
    SESSION,
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
  const setup = setUp(
    [
      TEACH,
      ask(Q_PROOF),
      [{ text: "Well argued." }],
      [{ text: "Any questions before the next one?" }],
    ],
    { replies: [CORRECT] },
  );
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
  expect(since(chat, "grading").slice(0, 6)).toEqual([
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
    '[Unit 1 of 2, "The derivative"; segment 1 of 2, "Difference quotients", on "difference-quotient" and "secant-slope". Phase: check. The learner answered question 1. In this check, "difference-quotient": passed; "secant-slope": not asked yet. Allowed now: your feedback on this answer, written as text, and nothing else. No tool may be called in this reply: once it ends, the app asks you for the next question in a message of its own.]\n' +
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
    '"difference-quotient": missed, so another question is needed (1 asked)',
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
  expect(setup.backend.received[3]?.text).toContain("graded it correct");
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
    /^\[.*Question 1, on "difference-quotient", is answered, and the answer is being graded\. Allowed now: reply to the learner\. ask_question is refused until the grade arrives, in a message of its own\.\]\nHow long does grading take\?$/,
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

test("a reply judged help before a written answer was sent makes it given with help", async () => {
  const setup = setUp(
    [
      TEACH,
      ask(Q_PROOF),
      [{ text: "Think of the square." }],
      [{ text: "Right." }],
    ],
    { replies: [CORRECT], judgments: [HELP] },
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

  expect(since(chat, "session").slice(0, 7)).toEqual([
    SESSION,
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
  const kept = await positionWritten();
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
  expect(since(chat, "session").slice(4, 7)).toEqual([
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
    "Phase: check. The learner answered question 1. In this check,",
  );
});

test("a choice answer recorded before a restart that left its question open closes the question on reopening, so it cannot be answered twice", async () => {
  const before = setUp([TEACH, ask(Q_QUOTIENT), [{ text: "Right." }]]);
  await makeCourse();
  const first = await open(before);
  await toCheck(first);
  const kept = await positionWritten();
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
    "Phase: check. The learner answered question 1. In this check,",
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

// --- Task 2.13: transcripts -------------------------------------------------

const SESSIONS = () => join(dir, "courses", COURSE, "sessions");

/** The course's transcript files by name, each as the events its whole lines hold. */
async function transcriptFiles(): Promise<Record<string, PageEvent[]>> {
  const names = (await readdir(SESSIONS())).sort();
  const files = await Promise.all(
    names.map(async (name) => {
      const text = await readFile(join(SESSIONS(), name), "utf8");
      const events = text
        .split("\n")
        .slice(0, -1)
        .map((line) => JSON.parse(line) as PageEvent);
      return [name, events] as const;
    }),
  );
  return Object.fromEntries(files);
}

/**
 * The events with each run of the tutor's text joined, which the page shows
 * the same way: a transcript may join pieces the backend streamed apart.
 */
function asShown(events: readonly PageEvent[]): PageEvent[] {
  const shown: PageEvent[] = [];
  for (const event of events) {
    const last = shown.at(-1);
    if (event.type === "tutor_text" && last?.type === "tutor_text") {
      shown[shown.length - 1] = { ...last, text: last.text + event.text };
    } else {
      shown.push(event);
    }
  }
  return shown;
}

/** The events before the chat's own session began: the earlier sessions'. */
function earlier(chat: UnitChat): PageEvent[] {
  const events = chat.events();
  return events.slice(
    0,
    events.findLastIndex((e) => e.type === "session"),
  );
}

test("a unit reopened after a restart shows the thread of its earlier session from the transcript, then a session of its own", async () => {
  const before = setUp([
    // Streamed in two pieces, which the transcript may join.
    [{ text: "A difference quotient " }, { text: "is a slope." }],
    [{ text: "Because $h$ is the step." }],
    ask(Q_QUOTIENT),
  ]);
  await makeCourse();
  const first = await open(before);
  expect(first.say("Why divide by h?")).toEqual({ ok: true });
  await first.settled();
  await toCheck(first);
  // What the page was shown before the restart.
  const shown = [...first.events()];
  await before.units.close();

  const after = setUp([]);
  const chat = await open(after);

  expect(asShown(earlier(chat))).toEqual(asShown(shown));
  expect(earlier(chat)).toContainEqual(
    expect.objectContaining({ type: "learner", text: "Why divide by h?" }),
  );
  expect(since(chat, "session")).toEqual([
    SESSION,
    { type: "unit_plan", plan: PLAN },
    status("in-progress"),
    { type: "phase", segment: 0, phase: "check" },
    {
      type: "question",
      question: {
        kind: "choice",
        id: openQuestionId(first),
        number: 1,
        prompt: Q_QUOTIENT.prompt,
        choices: Q_QUOTIENT.choices,
      },
    },
  ]);
  // One transcript per session, each starting with its session.
  const files = await transcriptFiles();
  expect(Object.keys(files)).toEqual([
    "derivative.1.jsonl",
    "derivative.2.jsonl",
  ]);
  expect(asShown(files["derivative.1.jsonl"] ?? [])).toEqual(asShown(shown));
  expect(files["derivative.2.jsonl"]).toEqual(since(chat, "session"));
});

test("a transcript whose last line a crash cut short shows its whole lines, and the next session is written to a transcript of its own", async () => {
  const setup = setUp([TEACH]);
  await makeCourse();
  // The server stopped while it taught segment 1, partway through a line.
  const cutOff: PageEvent[] = [
    { type: "session", startedAt: "2026-11-15T13:00:00.000Z" },
    { type: "unit_plan", plan: PLAN },
    status("in-progress"),
    { type: "phase", segment: 0, phase: "teach" },
    { type: "turn_start" },
    { type: "tutor_text", text: "A difference quotient is" },
  ];
  const cutText =
    cutOff.map((e) => `${JSON.stringify(e)}\n`).join("") +
    JSON.stringify({ type: "tutor_text", text: " the slope of" }).slice(0, 25);
  await mkdir(SESSIONS());
  await writeFile(join(SESSIONS(), "derivative.1.jsonl"), cutText);
  await reload().writePosition(COURSE, "derivative", {
    segment: 0,
    phase: "teach",
  });

  const chat = await open(setup);

  expect(chat.events()).toEqual([
    ...cutOff,
    SESSION,
    { type: "unit_plan", plan: PLAN },
    // The position on disk keeps no session of the tutor's to resume.
    { type: "fresh_start", reason: "not-resumed" },
    status("in-progress"),
    { type: "phase", segment: 0, phase: "teach" },
    { type: "turn_start" },
    { type: "tutor_text", text: "A secant joins two points." },
    { type: "turn_end", outcome: "done" },
    { type: "phase", segment: 0, phase: "discuss" },
  ]);
  // The cut transcript is left as it was; the new session has its own.
  expect(await readFile(join(SESSIONS(), "derivative.1.jsonl"), "utf8")).toBe(
    cutText,
  );
  expect((await transcriptFiles())["derivative.2.jsonl"]).toEqual(
    since(chat, "session"),
  );
});

test("two sessions of a unit are shown in order, each from its own transcript, before the third", async () => {
  const at = (hour: number) => `2026-11-1${hour}T09:00:00.000Z`;
  const one = setUp([TEACH], { now: () => new Date(at(5)) });
  await makeCourse();
  await open(one);
  await one.units.close();
  const two = setUp([[{ text: "Welcome back." }]], {
    now: () => new Date(at(6)),
  });
  const second = await open(two);
  expect(second.say("I am back.")).toEqual({ ok: true });
  await second.settled();
  await two.units.close();

  const three = setUp([], { now: () => new Date(at(7)) });
  const chat = await open(three);

  expect(
    asShown(
      chat
        .events()
        .filter((e) => ["session", "learner", "tutor_text"].includes(e.type)),
    ),
  ).toMatchObject([
    { type: "session", startedAt: at(5) },
    { type: "tutor_text", text: "A secant joins two points." },
    { type: "session", startedAt: at(6) },
    { type: "learner", text: "I am back." },
    { type: "tutor_text", text: "Welcome back." },
    { type: "session", startedAt: at(7) },
  ]);
  expect(Object.keys(await transcriptFiles())).toEqual([
    "derivative.1.jsonl",
    "derivative.2.jsonl",
    "derivative.3.jsonl",
  ]);
});

test("something that happens after the unit has been quiet for an hour starts a new session, in a transcript of its own", async () => {
  let time = Date.parse(NOW);
  const setup = setUp(
    [
      TEACH,
      [{ text: "Yes." }],
      [{ text: "Still yes." }],
      [{ text: "Welcome back." }],
    ],
    { now: () => new Date(time) },
  );
  await makeCourse();
  const chat = await open(setup);
  const minutes = (n: number) => n * 60_000;
  const say = async (text: string) => {
    expect(chat.say(text)).toEqual({ ok: true });
    await chat.settled();
  };

  // Two hours after the session began, but never an hour quiet.
  time += SESSION_GAP_MS - minutes(1);
  await say("Are you there?");
  time += SESSION_GAP_MS - minutes(1);
  await say("Still there?");
  expect(since(chat, "session")[0]).toEqual(SESSION);

  time += SESSION_GAP_MS;
  await say("I am back.");

  const back = new Date(time).toISOString();
  expect(chat.events().filter((e) => e.type === "session")).toEqual([
    SESSION,
    { type: "session", startedAt: back },
  ]);
  expect(since(chat, "session")).toMatchObject([
    { type: "session", startedAt: back },
    { type: "learner", text: "I am back." },
    { type: "turn_start" },
    { type: "tutor_text", text: "Welcome back." },
    { type: "turn_end", outcome: "done" },
  ]);
  const files = await transcriptFiles();
  expect(Object.keys(files)).toEqual([
    "derivative.1.jsonl",
    "derivative.2.jsonl",
  ]);
  expect(files["derivative.2.jsonl"]).toEqual(since(chat, "session"));
});

// --- Task 2.13, review fixes ------------------------------------------------

test("an earlier session's reply, a line for each piece the backend streamed, is replayed as one event a reply", async () => {
  const setup = setUp([]);
  await makeCourse();
  // As a real backend leaves it: its pieces come too far apart to be joined
  // when they are written.
  const lines: PageEvent[] = [
    { type: "session", startedAt: "2026-11-15T13:00:00.000Z" },
    { type: "phase", segment: 0, phase: "teach" },
    { type: "turn_start" },
    { type: "tutor_text", text: "A difference " },
    { type: "tutor_text", text: "quotient " },
    { type: "tutor_text", text: "is a slope." },
    { type: "turn_end", outcome: "done" },
    { type: "phase", segment: 0, phase: "discuss" },
    { type: "learner", text: "Of what?" },
    { type: "turn_start" },
    { type: "tutor_text", text: "Of a " },
    { type: "tutor_text", text: "secant." },
    { type: "turn_end", outcome: "done" },
  ];
  await mkdir(SESSIONS());
  await writeFile(
    join(SESSIONS(), "derivative.1.jsonl"),
    lines.map((e) => `${JSON.stringify(e)}\n`).join(""),
  );
  await reload().writePosition(COURSE, "derivative", {
    segment: 0,
    phase: "discuss",
  });

  const chat = await open(setup);

  expect(earlier(chat)).toEqual([
    { type: "session", startedAt: "2026-11-15T13:00:00.000Z" },
    { type: "phase", segment: 0, phase: "teach" },
    { type: "turn_start" },
    { type: "tutor_text", text: "A difference quotient is a slope." },
    { type: "turn_end", outcome: "done" },
    { type: "phase", segment: 0, phase: "discuss" },
    { type: "learner", text: "Of what?" },
    { type: "turn_start" },
    { type: "tutor_text", text: "Of a secant." },
    { type: "turn_end", outcome: "done" },
  ]);
});

test("a reply the machine slept through stays in its session, and the next thing that happens starts the new one", async () => {
  let time = Date.parse(NOW);
  const setup = setUp(
    [
      TEACH,
      [{ text: "Because " }, { text: "of the step." }],
      [{ text: "Hello." }],
    ],
    { now: () => new Date(time) },
  );
  await makeCourse();
  const chat = await open(setup);
  // The clock jumps two hours between the reply's two pieces.
  const stop = chat.subscribe((event) => {
    if (event.type === "tutor_text" && event.text === "Because ") {
      time += 2 * SESSION_GAP_MS;
    }
  });

  expect(chat.say("Why divide by h?")).toEqual({ ok: true });
  await chat.settled();
  stop();

  expect(chat.events().filter((e) => e.type === "session")).toEqual([SESSION]);
  expect(since(chat, "learner")).toMatchObject([
    { type: "learner", text: "Why divide by h?" },
    { type: "turn_start" },
    { type: "tutor_text", text: "Because " },
    { type: "tutor_text", text: "of the step." },
    { type: "turn_end", outcome: "done" },
  ]);

  expect(chat.say("I am back.")).toEqual({ ok: true });
  await chat.settled();

  expect(since(chat, "session")).toMatchObject([
    { type: "session", startedAt: new Date(time).toISOString() },
    { type: "learner", text: "I am back." },
    { type: "turn_start" },
    { type: "tutor_text", text: "Hello." },
    { type: "turn_end", outcome: "done" },
  ]);
  expect(Object.keys(await transcriptFiles())).toEqual([
    "derivative.1.jsonl",
    "derivative.2.jsonl",
  ]);
});

test("a question whose grade the transcript lost shows the grade the evidence has when the unit reopens, once", async () => {
  const before = setUp([TEACH, ask(Q_QUOTIENT), [{ text: "Not quite." }]]);
  await makeCourse();
  const first = await open(before);
  await toCheck(first);
  await answer(first, "B");
  const graded = first.events().filter((e) => e.type === "graded");
  expect(graded).toHaveLength(1);
  await before.units.close();
  // The machine stopped after the answer was recorded and before the lines
  // from its grade on reached the disk.
  const path = join(SESSIONS(), "derivative.1.jsonl");
  const kept = (await readFile(path, "utf8"))
    .split("\n")
    .slice(0, -1)
    .filter((line) => line !== "");
  const at = kept.findIndex((line) => JSON.parse(line).type === "graded");
  expect(at).toBeGreaterThan(0);
  await writeFile(
    path,
    kept
      .slice(0, at)
      .map((l) => `${l}\n`)
      .join(""),
  );

  const second = await open(setUp([]));

  expect(earlier(second).filter((e) => e.type === "graded")).toEqual([]);
  expect(since(second, "session").filter((e) => e.type === "graded")).toEqual(
    graded,
  );
  await second.settled();

  // The grade is in the second session's transcript, so it is not restored again.
  const third = await open(setUp([]));
  expect(third.events().filter((e) => e.type === "graded")).toEqual(graded);
});

// --- Task 2.14: resume and start fresh ----------------------------------------

/** The course's folder, where the tutor's sessions run and are kept. */
const FOLDER = () => join(dir, "courses", COURSE, "workspace");

test("the tutor's session runs in the course's workspace and its id is kept in the position; after a restart the first turn resumes it by that id, opening the unit starts no session, and the tutor is not told it is new", async () => {
  const before = setUp([
    TEACH,
    [{ text: "A quotient of differences." }],
    [{ text: "Now the limit." }],
  ]);
  await makeCourse();
  const first = await open(before);
  first.say("What is a difference quotient?");
  await first.settled();
  // Moving on and starting segment 2 write positions made anew.
  expect(await first.override()).toEqual({ ok: true });
  expect(await first.nextSegment()).toEqual({ ok: true });
  await first.settled();

  const [id] = before.backend.ids;
  expect(before.backend.sessions).toEqual([
    expect.objectContaining({
      cwd: FOLDER(),
      title: "Gauss: Derivatives from scratch, The derivative",
    }),
  ]);
  expect(before.backend.sessions[0]?.resumeId).toBeUndefined();
  expect(await sessionKept()).toBe(id);
  await before.units.close();
  expect(before.backend.closed).toEqual([id]);

  // The server restarts; the backend still has the session.
  const asked: [string, string][] = [];
  const after = setUp([[{ text: "As I said, the limit of the quotients." }]], {
    wrap: (backend) => ({
      ...backend,
      hasSession: (id, cwd) => {
        asked.push([id, cwd]);
        return backend.hasSession(id, cwd);
      },
    }),
  });
  const chat = await open(after);

  // Opening only asked the backend whether it has the session, in the workspace.
  expect(asked).toEqual([[id, FOLDER()]]);
  expect(after.backend.sessions).toEqual([]);
  expect(chat.events().filter((e) => e.type === "fresh_start")).toEqual([]);
  expect(after.backend.received).toEqual([]);

  chat.say("Remind me?");
  await chat.settled();

  expect(after.backend.sessions).toEqual([
    expect.objectContaining({ cwd: FOLDER(), resumeId: id }),
  ]);
  // Resumed with the system prompt a new session would get.
  expect(after.backend.sessions[0]?.systemPrompt).toBe(
    before.backend.sessions[0]?.systemPrompt,
  );
  expect(after.backend.received.map((t) => t.text)).toEqual([
    expect.not.stringContaining(JOINED_NOTE),
  ]);
  expect(since(chat, "learner")).toMatchObject([
    { type: "learner", text: "Remind me?" },
    { type: "turn_start" },
    { type: "tutor_text", text: "As I said, the limit of the quotients." },
    { type: "turn_end", outcome: "done" },
  ]);
  expect(await sessionKept()).toBe(id);
});

test("with the sandbox, the tutor's sessions, new and resumed, get the file and shell tools in the course's workspace, which opening the unit makes; the unit's planning gets none, nor does a tutor without the sandbox", async () => {
  const before = setUp([[{ call: "plan_unit", input: PLAN }], TEACH], {
    workspaceTools: true,
  });
  await makeCourse(false);
  await expect(stat(FOLDER())).rejects.toThrow();
  await open(before);

  const [planning, tutor] = before.backend.sessions;
  expect(planning?.cwd).toBeUndefined();
  expect(planning?.workspace).toBeUndefined();
  expect(tutor?.cwd).toBe(FOLDER());
  expect(tutor?.workspace).toBeDefined();
  expect((await stat(FOLDER())).isDirectory()).toBe(true);
  await before.units.close();

  const resumed = setUp([[{ text: "As I said." }]], { workspaceTools: true });
  const chat = await open(resumed);
  chat.say("Remind me?");
  await chat.settled();
  expect(resumed.backend.sessions).toEqual([
    expect.objectContaining({ cwd: FOLDER(), resumeId: before.backend.ids[1] }),
  ]);
  expect(resumed.backend.sessions[0]?.workspace).toBeDefined();
  await resumed.units.close();

  const without = setUp([[{ text: "Without tools." }]]);
  const other = await open(without);
  other.say("And now?");
  await other.settled();
  expect(without.backend.sessions[0]?.cwd).toBe(FOLDER());
  expect(without.backend.sessions[0]?.workspace).toBeUndefined();
});

test("the tutor's writes and commands are refused while a question is open, with the reason, and allowed before and after; reads always; the thread has a line for each file written, once a reply", async () => {
  const setup = setUp(
    [
      [
        { text: "Here is a starter file." },
        { builtIn: "Write", path: "starter.py" },
        { builtIn: "Edit", path: "starter.py" },
        { builtIn: "Bash" },
      ],
      ask(Q_QUOTIENT),
      // A reply with no text is not judged.
      [
        { builtIn: "Write", path: "hint.py" },
        { builtIn: "Edit", path: "starter.py" },
        { builtIn: "Bash" },
        { builtIn: "Read" },
      ],
      FEEDBACK,
      [{ builtIn: "Write", path: "secant.py" }, ...ask(Q_SECANT)],
    ],
    { workspaceTools: true },
  );
  await makeCourse();
  const chat = await open(setup);
  await toCheck(chat);
  chat.say("Can you show me in the file?");
  await chat.settled();
  await answer(chat, "A");

  const refused =
    "Question 1 is open: no file may be written and no command run until " +
    "its answer is graded, since a change could help with the answer. You " +
    "may still read files.";
  expect(
    setup.backend.calls
      .filter((call) => call.name !== "ask_question")
      .map(({ name, result }) => [
        name,
        result.status === "refused" ? result.text : result.status,
      ]),
  ).toEqual([
    ["Write", "done"],
    ["Edit", "done"],
    ["Bash", "done"],
    ["Write", refused],
    ["Edit", refused],
    ["Bash", refused],
    ["Read", "done"],
    ["Write", "done"],
  ]);
  expect(chat.events().filter((e) => e.type === "file_written")).toEqual([
    { type: "file_written", path: "starter.py" },
    { type: "file_written", path: "secant.py" },
  ]);
  expect(chat.events().slice(-5)).toEqual([
    { type: "turn_start" },
    { type: "file_written", path: "secant.py" },
    { type: "tutor_text", text: "Here is a question." },
    { type: "question", question: expect.anything() },
    { type: "turn_end", outcome: "done" },
  ]);
});

async function planRules(root: DataRoot) {
  await root.storePlan(COURSE, "rules", {
    objectives: [{ id: "sum-rule", statement: "Differentiate a sum." }],
    segments: [{ title: "Sums", objectives: ["sum-rule"] }],
  });
}

test("an unopened persisted question locks every tutor in the course after restart, including fresh sessions", async () => {
  await makeCourse();
  const before = setUp([TEACH, ask(Q_QUOTIENT)], { workspaceTools: true });
  await planRules(before.dataRoot);
  const first = await open(before);
  await toCheck(first);
  await before.units.close();

  const changes: FakeStep[] = [
    { builtIn: "Write", path: "hint.py" },
    { builtIn: "Edit", path: "starter.py" },
    { builtIn: "Bash" },
    { builtIn: "Read" },
  ];
  const after = setUp([changes, changes], { workspaceTools: true });
  try {
    const other = await open(after, "rules");
    expect(after.units.get(COURSE, "derivative")).toBeUndefined();
    expect(await other.startFresh()).toEqual({ ok: true });
    await other.settled();
    expect(after.backend.calls.map(({ result }) => result.status)).toEqual([
      "refused",
      "refused",
      "refused",
      "done",
      "refused",
      "refused",
      "refused",
      "done",
    ]);
    expect(other.events().some((event) => event.type === "file_written")).toBe(
      false,
    );
    expect((await positionWritten())?.openQuestion).toBeDefined();
  } finally {
    await after.units.close();
  }
});

test("a running command in another unit prevents posting a question until it finishes; the question then blocks late mutations", async () => {
  const command = Promise.withResolvers<void>();
  const setup = setUp(
    [
      TEACH,
      TEACH,
      [{ builtIn: "Bash", until: command.promise }],
      ask(Q_QUOTIENT),
      ask(Q_QUOTIENT),
      [{ builtIn: "Write", path: "late.py" }],
    ],
    { workspaceTools: true },
  );
  await makeCourse();
  await planRules(setup.dataRoot);
  try {
    const first = await open(setup);
    const other = await open(setup, "rules");
    other.say("Run the calculation.");
    await vi.waitFor(() =>
      expect(setup.backend.calls.at(-1)?.name).toBe("Bash"),
    );
    await toCheck(first);
    expect(setup.backend.calls.at(-1)?.result).toMatchObject({
      status: "refused",
      text: expect.stringContaining("not been confirmed finished"),
    });
    expect((await positionWritten())?.openQuestion).toBeUndefined();
    command.resolve();
    await other.settled();
    first.say("Ask now.");
    await first.settled();
    expect((await positionWritten())?.openQuestion).toBeDefined();
    other.say("Write the result.");
    await other.settled();
    expect(setup.backend.calls.at(-1)?.result).toMatchObject({
      status: "refused",
      text: expect.stringContaining("Question 1 is open"),
    });
  } finally {
    command.resolve();
    await setup.units.close();
  }
});

test.each([false, true])(
  "question persistence serializes concurrent command starts and releases its reservation after failure=%s",
  async (fails) => {
    const saving = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const starting = Promise.withResolvers<void>();
    const setup = setUp(
      [TEACH, TEACH, ask(Q_QUOTIENT), [{ builtIn: "Bash" }]],
      {
        workspaceTools: true,
        wrap: (backend) => ({
          ...backend,
          async startSession(options) {
            const workspace = options.workspace;
            return backend.startSession({
              ...options,
              ...(workspace === undefined
                ? {}
                : {
                    workspace: {
                      acquire() {
                        const reservation = workspace.acquire();
                        starting.resolve();
                        return reservation;
                      },
                    },
                  }),
            });
          },
        }),
        record: (root) => ({
          ...root,
          async writePosition(id, unit, position) {
            if (position?.openQuestion !== undefined) {
              saving.resolve();
              await release.promise;
              if (fails) throw new Error("Question could not be stored.");
            }
            return root.writePosition(id, unit, position);
          },
        }),
      },
    );
    await makeCourse();
    await planRules(setup.dataRoot);
    try {
      const first = await open(setup);
      const other = await open(setup, "rules");
      expect(await first.ready()).toEqual({ ok: true });
      await saving.promise;
      other.say("Run a concurrent command.");
      await starting.promise;
      release.resolve();
      await Promise.all([first.settled(), other.settled()]);
      expect(
        setup.backend.calls.find(({ name }) => name === "Bash")?.result.status,
      ).toBe(fails ? "done" : "refused");
      expect((await positionWritten())?.openQuestion !== undefined).toBe(
        !fails,
      );
    } finally {
      release.resolve();
      await setup.units.close();
    }
  },
);

test("without workspace tools even fake built-ins are refused, while feedback may mutate once the question closes", async () => {
  await makeCourse();
  const without = setUp([
    [{ builtIn: "Write", path: "forbidden.py" }, { builtIn: "Bash" }],
  ]);
  await open(without);
  expect(without.backend.calls.map(({ result }) => result.status)).toEqual([
    "refused",
    "refused",
  ]);
  await without.units.close();

  const setup = setUp(
    [
      ask(Q_QUOTIENT),
      [{ builtIn: "Write", path: "feedback.py" }, { builtIn: "Bash" }],
      [{ text: "Next question later." }],
    ],
    { workspaceTools: true },
  );
  try {
    const chat = await open(setup);
    await toCheck(chat);
    await answer(chat, "A");
    expect(
      setup.backend.calls
        .filter(({ name }) => name !== "ask_question")
        .map(({ result }) => result.status),
    ).toEqual(["done", "done"]);
  } finally {
    await setup.units.close();
  }
});

test("a session the backend cannot find, as after Claude Code's 30-day cleanup, gives way to a new one, seeded from the record and told it is new, and the thread says so", async () => {
  const before = setUp([TEACH]);
  await makeCourse();
  await open(before);
  const [lost] = before.backend.ids;
  await before.units.close();

  // The backend no longer has the session.
  const after = setUp([[{ text: "Let us look at it together." }]], {
    kept: new Set(),
  });
  const chat = await open(after);

  expect(since(chat, "session")).toEqual([
    SESSION,
    { type: "unit_plan", plan: PLAN },
    { type: "fresh_start", reason: "not-resumed" },
    status("in-progress"),
    { type: "phase", segment: 0, phase: "discuss" },
  ]);
  // Nothing is sent until the learner acts, as for a unit reopened before,
  // and nothing is started.
  expect(after.backend.received).toEqual([]);
  expect(after.backend.sessions).toEqual([]);

  chat.say("Where were we?");
  await chat.settled();

  // No resume is tried: the backend said it does not have the session.
  expect(after.backend.sessions).toHaveLength(1);
  const fresh = after.backend.sessions[0];
  expect(fresh?.resumeId).toBeUndefined();
  expect(fresh?.cwd).toBe(FOLDER());
  // The seed: tutor.md, the course, the unit's plan and the notes.
  expect(fresh?.systemPrompt).toContain(TUTOR);
  expect(fresh?.systemPrompt).toContain(
    '- "secant-slope": Read a difference quotient as the slope of a secant line.',
  );
  expect(fresh?.systemPrompt).toContain(CURRICULUM.background);
  expect(fresh?.systemPrompt).toContain(CURRICULUM.style);
  expect(after.backend.received[0]?.text).toMatch(
    new RegExp(`Phase: discuss\\. Message from the learner\\. ${JOINED_NOTE}`),
  );
  const [made] = after.backend.ids;
  expect(made).not.toBe(lost);
  expect(await sessionKept()).toBe(made);
});

test("resuming that fails another way is not taken for a lost session: the unit opens, the message's turn says why, and the next message tries again and resumes it", async () => {
  const before = setUp([TEACH]);
  await makeCourse();
  await open(before);
  const [id] = before.backend.ids;
  await before.units.close();

  let starting = false;
  const after = setUp([[{ text: "Still here." }]], {
    wrap: (backend) => ({
      ...backend,
      startSession: async (options) => {
        if (!starting) throw new Error("Claude Code could not start.");
        return backend.startSession(options);
      },
    }),
  });
  const chat = await open(after);
  expect(chat.events().at(-1)).toEqual({
    type: "phase",
    segment: 0,
    phase: "discuss",
  });

  chat.say("Hello?");
  await chat.settled();

  expect(since(chat, "learner")).toMatchObject([
    { type: "learner", text: "Hello?" },
    { type: "turn_start" },
    {
      type: "turn_end",
      outcome: "error",
      error:
        'The conversation with the tutor could not be resumed: Claude Code could not start. Sending again tries again, and "Start fresh" starts a new one.',
    },
  ]);
  expect(await sessionKept()).toBe(id);

  starting = true;
  chat.say("Hello again?");
  await chat.settled();

  expect(after.backend.sessions).toEqual([
    expect.objectContaining({ resumeId: id }),
  ]);
  expect(after.backend.received.map((t) => t.text)).toEqual([
    expect.stringMatching(/\]\nHello again\?$/),
  ]);
  expect(after.backend.received[0]?.text).not.toContain(JOINED_NOTE);
  expect(chat.events().filter((e) => e.type === "fresh_start")).toEqual([]);
  expect(await sessionKept()).toBe(id);
});

test("when resuming keeps failing, the learner's Start fresh gives the conversation up: a new session, told it is new, picks up, and a later opening resumes the new one", async () => {
  const before = setUp([TEACH]);
  await makeCourse();
  await open(before);
  const [id] = before.backend.ids;
  await before.units.close();

  // Resuming fails however often it is tried; a new session starts.
  const resumes: string[] = [];
  const failing = (backend: FakeBackend): TutorBackend => ({
    ...backend,
    startSession: async (options) => {
      if (options.resumeId !== undefined) {
        resumes.push(options.resumeId);
        throw new Error("Claude Code could not start.");
      }
      return backend.startSession(options);
    },
  });
  const after = setUp([[{ text: "We are in the discussion of segment 1." }]], {
    wrap: failing,
  });
  const chat = await open(after);
  chat.say("Hello?");
  await chat.settled();
  expect(chat.events().at(-1)).toMatchObject({
    type: "turn_end",
    outcome: "error",
  });

  expect(await chat.startFresh()).toEqual({ ok: true });
  await chat.settled();

  expect(resumes).toEqual([id]);
  expect(since(chat, "fresh_start")).toEqual([
    { type: "fresh_start", reason: "learner" },
    { type: "turn_start" },
    { type: "tutor_text", text: "We are in the discussion of segment 1." },
    { type: "turn_end", outcome: "done" },
  ]);
  expect(after.backend.received[0]?.text).toContain(JOINED_NOTE);
  const [made] = after.backend.ids;
  expect(made).not.toBe(id);
  expect(await sessionKept()).toBe(made);
  await after.units.close();

  const later = await open(setUp([], { wrap: failing }));
  later.say("Hello?");
  await later.settled();
  expect(resumes).toEqual([id, made]);
});

test("the learner's Start fresh closes the tutor's session and starts one told it is new, which picks up where the unit stands; a restart then resumes the new one", async () => {
  const setup = setUp([
    TEACH,
    [{ text: "The gears turn the gears." }, { hold: true }],
    [{ text: "We are in the discussion of segment 1." }],
    [{ text: "A quotient of differences." }],
  ]);
  await makeCourse();
  const chat = await open(setup);
  const [old] = setup.backend.ids;

  // Not while the tutor is writing.
  chat.say("Explain it with gears.");
  await waitFor(chat, "tutor_text", chat.events().length);
  expect(await chat.startFresh()).toEqual({
    ok: false,
    status: 409,
    error: "Wait until the tutor has finished, or stop it.",
  });
  await chat.interrupt();
  await chat.settled();

  expect(await chat.startFresh()).toEqual({ ok: true });
  await chat.settled();

  expect(setup.backend.closed).toEqual([old]);
  expect(since(chat, "fresh_start")).toEqual([
    { type: "fresh_start", reason: "learner" },
    { type: "turn_start" },
    { type: "tutor_text", text: "We are in the discussion of segment 1." },
    { type: "turn_end", outcome: "done" },
  ]);
  const [, made] = setup.backend.ids;
  expect(setup.backend.sessions[1]).toMatchObject({ cwd: FOLDER() });
  expect(setup.backend.sessions[1]?.resumeId).toBeUndefined();
  expect(setup.backend.received.at(-1)?.text).toMatch(
    new RegExp(
      `Phase: discuss\\. The learner started a fresh conversation with you, from their progress\\. ${JOINED_NOTE} Allowed now: answer the learner`,
    ),
  );
  expect(await sessionKept()).toBe(made);

  // The note is said once.
  chat.say("What is a difference quotient?");
  await chat.settled();
  expect(setup.backend.received.at(-1)?.text).not.toContain(JOINED_NOTE);
  expect(setup.backend.sessions).toHaveLength(2);
  await setup.units.close();

  const after = setUp([[{ text: "Hello again." }]]);
  const reopened = await open(after);
  reopened.say("Hello?");
  await reopened.settled();
  expect(after.backend.sessions).toEqual([
    expect.objectContaining({ resumeId: made }),
  ]);
});

test("Start fresh takes the old session's id out of the position before the new session starts, so a restart in between does not resume the old one", async () => {
  const setup = setUp([TEACH]);
  await makeCourse();
  const chat = await open(setup);
  expect(await sessionKept()).toBeDefined();
  const written: unknown[] = [];
  chat.subscribe((event) => {
    if (event.type === "fresh_start") {
      written.push(
        JSON.parse(
          readFileSync(join(dir, "courses", COURSE, "state.json"), "utf8"),
        ).units.derivative,
      );
    }
  });

  expect(await chat.startFresh()).toEqual({ ok: true });
  await chat.settled();

  expect(written).toEqual([{ segment: 0, phase: "discuss" }]);
});

// --- Task 2.15: idle tutor sessions ------------------------------------------

/** Lets the closing of a session, which the timer starts, run. */
const closing = () => new Promise((resolve) => setImmediate(resolve));

test("a unit's tutor session is closed once it has been idle for IDLE_MS, and the next message resumes it, not told it is new", async () => {
  const timer = createFakeTimer();
  const setup = setUp([TEACH, [{ text: "A quotient of differences." }]], {
    timer,
  });
  await makeCourse();
  const chat = await open(setup);
  const [id] = setup.backend.ids;

  timer.advance(IDLE_MS - 1);
  await closing();
  expect(setup.backend.closed).toEqual([]);
  timer.advance(1);
  await closing();
  expect(setup.backend.closed).toEqual([id]);

  chat.say("What is a difference quotient?");
  await chat.settled();

  expect(setup.backend.sessions).toEqual([
    expect.objectContaining({ cwd: FOLDER() }),
    expect.objectContaining({ cwd: FOLDER(), resumeId: id }),
  ]);
  expect(setup.backend.received.at(-1)?.text).not.toContain(JOINED_NOTE);
  expect(since(chat, "learner")).toMatchObject([
    { type: "learner", text: "What is a difference quotient?" },
    { type: "turn_start" },
    { type: "tutor_text", text: "A quotient of differences." },
    { type: "turn_end", outcome: "done" },
  ]);
  expect(await sessionKept()).toBe(id);
});

test("a tutor session is not closed while a written answer is graded, since the grade is sent to it, and is closed once idle after that", async () => {
  const timer = createFakeTimer();
  const grade = Promise.withResolvers<FakeReply>();
  const setup = setUp([TEACH, ask(Q_PROOF), [{ text: "Well argued." }]], {
    replies: [{ later: grade.promise }],
    timer,
  });
  await makeCourse();
  const chat = await open(setup);
  await toCheck(chat);
  expect(await chat.answer(written(chat))).toEqual({ ok: true });

  timer.advance(3 * IDLE_MS);
  await closing();
  expect(setup.backend.closed).toEqual([]);

  grade.resolve(CORRECT);
  await chat.settled();
  expect(setup.backend.sessions).toHaveLength(1);
  expect(setup.backend.received[2]?.text).toContain("graded it correct");

  timer.advance(IDLE_MS);
  await closing();
  expect(setup.backend.closed).toEqual(setup.backend.ids);
});

test("a session found lost when the next message resumes it, after an idle close, gives way to a new one: the marker after the message, the note in the new session's header, and its id kept", async () => {
  const timer = createFakeTimer();
  const setup = setUp([TEACH, [{ text: "Let us look at it together." }]], {
    timer,
  });
  await makeCourse();
  const chat = await open(setup);
  const [lost] = setup.backend.ids;
  timer.advance(IDLE_MS);
  await closing();
  // Gone meanwhile, as Claude Code's cleanup can make it.
  keptSessions.delete(lost ?? "");

  chat.say("Where were we?");
  await chat.settled();

  expect(since(chat, "learner")).toMatchObject([
    { type: "learner", text: "Where were we?" },
    { type: "turn_start" },
    { type: "fresh_start", reason: "not-resumed" },
    { type: "tutor_text", text: "Let us look at it together." },
    { type: "turn_end", outcome: "done" },
  ]);
  expect(setup.backend.sessions.map((s) => s.resumeId)).toEqual([
    undefined,
    lost,
    undefined,
  ]);
  expect(setup.backend.received.at(-1)?.text).toMatch(
    new RegExp(`Phase: discuss\\. Message from the learner\\. ${JOINED_NOTE}`),
  );
  const made = setup.backend.ids.at(-1);
  expect(made).not.toBe(lost);
  expect(await sessionKept()).toBe(made);
});

test("a lost resume associates the first queued message with the new conversation, including after transcript replay", async () => {
  const timer = createFakeTimer();
  const resuming = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const setup = setUp(
    [
      TEACH,
      [{ text: "Reply A, " }, { text: "continued." }],
      [{ text: "Reply B." }],
    ],
    {
      timer,
      wrap: (backend) => ({
        ...backend,
        async startSession(options) {
          if (options.resumeId !== undefined) {
            resuming.resolve();
            await release.promise;
          }
          return backend.startSession(options);
        },
      }),
    },
  );
  await makeCourse();
  const chat = await open(setup);
  const messages = ["Explain it with gears.", "And with pulleys."] as const;
  const learnersByConversation = (events: readonly PageEvent[]) => {
    const timeline = events.reduce(
      (state, event, index) => reduce(state, { type: "event", event, index }),
      emptyTimeline,
    );
    return conversations(timeline.items).map((part) =>
      part.items.flatMap((item) =>
        item.kind === "learner" ? [item.text] : [],
      ),
    );
  };
  try {
    timer.advance(IDLE_MS);
    await closing();
    keptSessions.clear();
    chat.say(messages[0]);
    await resuming.promise;
    chat.say(messages[1]);
    release.resolve();
    await chat.settled();

    expect(
      setup.backend.received
        .slice(1)
        .map((turn) => turn.text.split("\n").at(-1)),
    ).toEqual(messages);
    expect(learnersByConversation(chat.events())).toEqual([[], messages]);
    const shown = asShown(chat.events());
    await setup.units.close();

    const restarted = setUp([]);
    try {
      const reopened = await open(restarted);
      expect(asShown(earlier(reopened))).toEqual(shown);
      expect(learnersByConversation(earlier(reopened))).toEqual([[], messages]);
    } finally {
      await restarted.units.close();
    }
  } finally {
    release.resolve();
    await setup.units.close();
  }
});

// --- Task 2.16a: the feedback turn after an answer ---------------------------

/** Why ask_question is refused in the feedback on question `number`. */
const FEEDBACK_ONLY = (number: number) =>
  `This reply is for your feedback on question ${number} only, and no ` +
  "tool may be called in it. The learner sees only the text you write, " +
  "never your thinking: write your feedback as text if you have not, " +
  "then end your reply. The app then asks you for the next question in " +
  "a message of its own, or closes the segment if the check is done.";

/** The thread from the event, with each tutor text as its text and each question as "?". */
function thread(chat: UnitChat, from: PageEvent["type"]): string[] {
  return since(chat, from).map((e) =>
    e.type === "tutor_text" ? e.text : e.type === "question" ? "?" : e.type,
  );
}

test("after an answer, the tutor's turn is for feedback alone, with ask_question refused; once it ends the next question is asked for in a turn of its own, and after the check's last answer the segment closes", async () => {
  const setup = setUp([
    TEACH,
    ask(Q_QUOTIENT),
    [
      { call: "ask_question", input: Q_SECANT },
      { text: "Right: that is the difference quotient." },
    ],
    [{ text: "Now the secant." }, { call: "ask_question", input: Q_SECANT }],
    [
      { text: "Right again." },
      { call: "ask_question", input: Q_SECANT },
      { text: "That was the check." },
    ],
  ]);
  await makeCourse();
  const chat = await open(setup);
  await toCheck(chat);

  await answer(chat, "A");

  expect(thread(chat, "graded")).toEqual([
    "graded",
    "unit_status",
    "turn_start",
    "Right: that is the difference quotient.",
    "turn_end",
    "turn_start",
    "Now the secant.",
    "?",
    "turn_end",
  ]);
  expect(setup.backend.received[3]?.text).toBe(
    '[Unit 1 of 2, "The derivative"; segment 1 of 2, "Difference quotients", on "difference-quotient" and "secant-slope". Phase: check. The check goes on after your feedback on question 1. In this check, "difference-quotient": passed; "secant-slope": not asked yet. Allowed now: a lead-in of one sentence, then a question on "secant-slope" with ask_question, unlike the ones asked before. Do not repeat your feedback. Posting ends your turn.]',
  );

  await answer(chat, "B");

  expect(setup.backend.received[4]?.text).toMatch(
    /^\[.*The learner answered question 2\. In this check, "difference-quotient": passed; "secant-slope": passed\. Allowed now: your feedback on this answer, written as text, and nothing else\. No tool may be called in this reply: every objective is done, so the check is over, and the segment closes once it ends\.\]\n/,
  );
  // Refused in both feedback turns; the refusal did not end the turn.
  expect(
    setup.backend.calls.map(({ result }) =>
      result.status === "refused" ? result.text : result.status,
    ),
  ).toEqual(["done", FEEDBACK_ONLY(1), "done", FEEDBACK_ONLY(2)]);
  expect(thread(chat, "graded")).toEqual([
    "graded",
    "unit_status",
    "turn_start",
    "Right again.",
    "That was the check.",
    "turn_end",
    "phase",
  ]);
  expect(await position()).toEqual({
    derivative: { segment: 0, phase: "closed" },
  });
  expect(setup.backend.received).toHaveLength(5);
});

test("feedback queued behind learner messages blocks their questions until that feedback ends", async () => {
  const paused = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const setup = setUp(
    [
      TEACH,
      ask(Q_QUOTIENT),
      [
        { text: "Clarifying the question." },
        { call: "ask_question", input: Q_SECANT },
        { text: "Waiting for the feedback." },
      ],
      [
        { call: "ask_question", input: Q_SECANT },
        { text: "That reply comes before the feedback too." },
      ],
      [{ text: "Feedback on the answer." }],
      ask(Q_SECANT),
    ],
    {
      judgments: [CLARIFICATION],
      wrap: (backend) => ({
        ...backend,
        async startSession(options) {
          const session = await backend.startSession(options);
          return {
            ...session,
            async *send(turn) {
              for await (const event of session.send(turn)) {
                yield event;
                if (
                  event.type === "text" &&
                  event.text === "Clarifying the question."
                ) {
                  paused.resolve();
                  await release.promise;
                }
              }
            },
          };
        },
      }),
    },
  );
  try {
    await makeCourse();
    const chat = await open(setup);
    await toCheck(chat);
    chat.say("What does the question mean?");
    await paused.promise;
    chat.say("Next question, please.");
    expect(
      await chat.answer({
        kind: "choice",
        questionId: openQuestionId(chat),
        choice: "A",
        confidence: "100",
      }),
    ).toEqual({ ok: true });
    release.resolve();
    await chat.settled();

    // The running reply cannot post, as the answer waits for its judging
    // (task 2.21); the earlier queued message must wait for the feedback.
    expect(setup.backend.calls.slice(1, 3).map((c) => c.result.status)).toEqual(
      ["refused", "refused"],
    );
    expect(setup.backend.received[3]?.text).toContain(
      "ask_question is refused until that feedback ends",
    );
    expect(
      since(chat, "answer_waiting")
        .filter(
          (e) =>
            e.type === "tutor_text" ||
            e.type === "question" ||
            e.type === "graded",
        )
        .map((e) => (e.type === "tutor_text" ? e.text : e.type)),
    ).toEqual([
      "Waiting for the feedback.",
      "graded",
      "That reply comes before the feedback too.",
      "Feedback on the answer.",
      "Here is a question.",
      "question",
    ]);
    expect(await position()).toMatchObject({
      derivative: { openQuestion: { number: 2, objective: "secant-slope" } },
    });
  } finally {
    release.resolve();
    await setup.units.close();
  }
});

test("Stop during the feedback sends no next question; the learner's next message can post one", async () => {
  const setup = setUp([
    TEACH,
    ask(Q_QUOTIENT),
    [{ text: "Right, because" }, { hold: true }],
    [{ text: "Here it is." }, { call: "ask_question", input: Q_SECANT }],
  ]);
  await makeCourse();
  const chat = await open(setup);
  await toCheck(chat);
  const from = chat.events().length;
  expect(
    await chat.answer({
      kind: "choice",
      questionId: openQuestionId(chat),
      choice: "A",
      confidence: "100",
    }),
  ).toEqual({ ok: true });
  // The feedback can start before the answer's call returns.
  await waitFor(chat, "tutor_text", from);

  await chat.interrupt();
  await chat.settled();

  expect(thread(chat, "graded").slice(-3)).toEqual([
    "turn_start",
    "Right, because",
    "turn_end",
  ]);
  expect(setup.backend.received).toHaveLength(3);
  expect(await position()).toEqual({
    derivative: { segment: 0, phase: "check", checkFrom: 0 },
  });

  chat.say("Next question, please.");
  await chat.settled();

  expect(setup.backend.received[3]?.text).toContain(
    'Message from the learner. In this check, "difference-quotient": passed; "secant-slope": not asked yet. Allowed now: post a question on "secant-slope" with ask_question',
  );
  expect(await position()).toMatchObject({
    derivative: { openQuestion: { number: 2, objective: "secant-slope" } },
  });
});

test.each(["before", "after"] as const)(
  "Stop in a learner reply %s feedback cancels the automatic next question, and a later message can post one",
  async (when) => {
    const replying = Promise.withResolvers<void>();
    const reply: FakeTurn = () => {
      replying.resolve();
      return [{ text: "An interrupted learner reply." }, { hold: true }];
    };
    let chat: UnitChat | undefined;
    const setup = setUp(
      [
        TEACH,
        ask(Q_QUOTIENT),
        ...(when === "before"
          ? [reply, FEEDBACK]
          : [
              () => {
                chat?.say("Why is that right?");
                return [{ text: "Feedback on the answer." }];
              },
              reply,
            ]),
        ask(Q_SECANT),
      ],
      { judgments: [CLARIFICATION] },
    );
    try {
      await makeCourse();
      chat = await open(setup);
      await toCheck(chat);
      if (when === "before") {
        chat.say("What does the question mean?");
        await replying.promise;
      }
      expect(
        await chat.answer({
          kind: "choice",
          questionId: openQuestionId(chat),
          choice: "A",
          confidence: "100",
        }),
      ).toEqual({ ok: true });
      await replying.promise;

      await chat.interrupt();
      await chat.settled();

      expect(chat.events().filter((e) => e.type === "question")).toHaveLength(
        1,
      );
      expect(setup.backend.received).toHaveLength(4);
      expect(await position()).toEqual({
        derivative: { segment: 0, phase: "check", checkFrom: 0 },
      });

      chat.say("Next question, please.");
      await chat.settled();

      expect(await position()).toMatchObject({
        derivative: { openQuestion: { number: 2, objective: "secant-slope" } },
      });
    } finally {
      await setup.units.close();
    }
  },
);

test("Stop during the feedback on the check's last answer still closes the segment", async () => {
  const setup = setUp([
    TEACH,
    ask(Q_QUOTIENT),
    FEEDBACK,
    ask(Q_SECANT),
    [{ text: "Right, because" }, { hold: true }],
  ]);
  await makeCourse();
  const chat = await open(setup);
  await toCheck(chat);
  await answer(chat, "A");
  const from = chat.events().length;
  expect(
    await chat.answer({
      kind: "choice",
      questionId: openQuestionId(chat),
      choice: "B",
      confidence: "100",
    }),
  ).toEqual({ ok: true });
  // The feedback can start before the answer's call returns.
  await waitFor(chat, "tutor_text", from);

  await chat.interrupt();
  await chat.settled();

  expect(since(chat, "turn_end")).toEqual([
    { type: "turn_end", outcome: "interrupted" },
    { type: "phase", segment: 0, phase: "closed" },
  ]);
  expect(setup.backend.received).toHaveLength(5);
});

test.each([
  {
    name: "posted a question, the next question is not asked for",
    reply: [
      { text: "Because the others do not divide by $h$. Now the secant." },
      { call: "ask_question", input: Q_SECANT },
    ] satisfies FakeStep[],
    after: [] satisfies FakeTurn[],
    turns: 4,
  },
  {
    name: "posted none, the next question is asked for after it",
    reply: [
      { text: "Because the others do not divide by $h$." },
    ] satisfies FakeStep[],
    after: [ask(Q_SECANT)] satisfies FakeTurn[],
    turns: 5,
  },
])(
  "when the reply to a message sent during the feedback $name",
  async ({ reply, after, turns }) => {
    let chat: UnitChat | undefined;
    const setup = setUp([
      TEACH,
      ask(Q_QUOTIENT),
      () => {
        chat?.say("Why is A right?");
        return [{ text: "Right." }];
      },
      reply,
      ...after,
    ]);
    await makeCourse();
    chat = await open(setup);
    await toCheck(chat);

    await answer(chat, "A");

    // The message is answered after the feedback, and before any next
    // question is asked for.
    expect(setup.backend.received[3]?.text).toMatch(
      /Message from the learner\. .*\]\nWhy is A right\?$/,
    );
    expect(setup.backend.received).toHaveLength(turns);
    expect(chat.events().filter((e) => e.type === "question")).toHaveLength(2);
    expect(await position()).toMatchObject({
      derivative: { openQuestion: { number: 2, objective: "secant-slope" } },
    });
    expect(chat.events().at(-1)).toEqual({ type: "turn_end", outcome: "done" });
  },
);

test("a unit reopened after its check's last answer was recorded, before the feedback on it ended, closes the segment as it opens", async () => {
  await makeCourse();
  for (const [objective, question, choice] of [
    ["difference-quotient", Q_QUOTIENT, "A"],
    ["secant-slope", Q_SECANT, "B"],
  ] as const) {
    await reload().appendEvidence(COURSE, {
      kind: "answer",
      recordedAt: NOW,
      objective,
      question: stored(question),
      answer: {
        kind: "choice",
        questionId: `${objective}-question`,
        choice,
        confidence: "100",
      },
      assisted: false,
      verdict: "correct",
    });
  }
  await reload().writePosition(COURSE, "derivative", {
    segment: 0,
    phase: "check",
    checkFrom: 0,
  });
  const setup = setUp([]);

  const chat = await open(setup);

  expect(since(chat, "phase")).toEqual([
    { type: "phase", segment: 0, phase: "closed" },
  ]);
  expect(await position()).toEqual({
    derivative: { segment: 0, phase: "closed" },
  });
  expect(setup.backend.received).toEqual([]);
});

// --- Task 2.17: the choices in the engine's order ----------------------------

test("a choice question is shown, stored, graded and sent back to the tutor in the engine's order, its answer letter moved with the correct choice", async () => {
  const setup = setUp(
    [
      TEACH,
      ask(Q_QUOTIENT),
      FEEDBACK,
      [{ text: "Any questions before the next one?" }],
    ],
    { order: (count) => givenOrder(count).reverse() },
  );
  await makeCourse();
  const chat = await open(setup);
  await toCheck(chat);

  // The tutor's A, the difference quotient, is shown last, as C.
  const shown = [
    "$\\frac{f(a)}{h}$",
    "$f(a+h)-f(a)$",
    "$\\frac{f(a+h)-f(a)}{h}$",
  ];
  expect(since(chat, "question")[0]).toMatchObject({
    question: { kind: "choice", choices: shown },
  });
  expect((await position()).derivative?.openQuestion?.question).toEqual({
    kind: "choice",
    prompt: Q_QUOTIENT.prompt,
    choices: shown,
    answer: "C",
  });
  const posted = setup.backend.calls[0]?.result;
  expect(posted?.status === "done" && posted.text).toContain(
    "A. $\\frac{f(a)}{h}$\n" +
      "B. $f(a+h)-f(a)$\n" +
      "C. $\\frac{f(a+h)-f(a)}{h}$\n" +
      "The correct one is C.",
  );

  await answer(chat, "C");

  expect(since(chat, "graded")[0]).toMatchObject({
    verdict: "correct",
    correctChoice: "C",
  });
  expect(setup.backend.received[2]?.text).toContain(
    "A. $\\frac{f(a)}{h}$\n" +
      "B. $f(a+h)-f(a)$\n" +
      "C. $\\frac{f(a+h)-f(a)}{h}$\n" +
      "\n" +
      "The learner chose C, at 100% confidence.\n" +
      "They gave no reasoning.\n" +
      "Graded: correct.",
  );
  expect((await reload().readEvidence(COURSE))[0]).toMatchObject({
    question: { choices: shown, answer: "C" },
    verdict: "correct",
  });
});

// --- Task 2.25: the backup -----------------------------------------------------

/** A backup that keeps each commit's message and the unit's position on disk then. */
function recordingBackup() {
  const commits: { message: string; position: UnitPosition | undefined }[] = [];
  const backup: Backup = {
    commit(message) {
      const path = join(dir, "courses", COURSE, "state.json");
      const state = JSON.parse(readFileSync(path, "utf8"));
      commits.push({ message, position: state.units.derivative });
    },
    settled: () => Promise.resolve(),
  };
  return { commits, backup };
}

/** Runs git in the test's data root. */
function gitLog(...args: string[]): string {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")),
  );
  return execFileSync("git", args, { cwd: dir, env, encoding: "utf8" }).trim();
}

test("the backup commits once a segment's close is written, and once the unit's end is", async () => {
  const { commits, backup } = recordingBackup();
  const setup = setUp(
    [TEACH, ask(Q_QUOTIENT), FEEDBACK, ask(Q_SECANT), FEEDBACK],
    { backup },
  );
  await makeCourse(true, SHORT);
  const chat = await open(setup);
  await toCheck(chat);
  await answer(chat, "A");

  expect(commits).toEqual([]);

  await answer(chat, "B");

  expect(closedSegments(chat)).toEqual([0]);
  expect(commits).toEqual([
    {
      message: `${COURSE}: segment 1 of derivative closed`,
      position: expect.objectContaining({ segment: 0, phase: "closed" }),
    },
    {
      message: `${COURSE}: unit derivative finished, passed`,
      position: undefined,
    },
  ]);
});

test("moving on commits the segment's close, and moving on from the closing card the unit's end; going over again names its segment", async () => {
  const { commits, backup } = recordingBackup();
  const setup = setUp(
    [
      TEACH,
      ask(Q_QUOTIENT),
      [{ text: "Right." }],
      [{ text: "Any questions before the next one?" }],
      [{ text: "Let us go over it." }],
    ],
    { backup },
  );
  await makeCourse(true, SHORT);
  const chat = await open(setup);
  await toCheck(chat);
  await answer(chat, "A");
  expect(await chat.override()).toEqual({ ok: true });
  expect(await chat.goOverAgain()).toEqual({ ok: true });
  await chat.settled();
  expect(await chat.override()).toEqual({ ok: true });
  await chat.settled();
  expect(await chat.finishUnit()).toEqual({ ok: true });

  expect(commits.map((c) => c.message)).toEqual([
    `${COURSE}: segment 1 of derivative closed`,
    `${COURSE}: the segment going over derivative's objectives again closed`,
    `${COURSE}: unit derivative finished, overridden`,
  ]);
});

test("with the backup on a real repository, the commits hold the record's files and no temporary ones", async () => {
  await makeCourse(true, SHORT);
  const said: string[] = [];
  const backup = await startBackup({ path: dir, log: (l) => said.push(l) });
  const setup = setUp(
    [TEACH, ask(Q_QUOTIENT), FEEDBACK, ask(Q_SECANT), FEEDBACK],
    { backup },
  );
  const chat = await open(setup);
  await toCheck(chat);
  await answer(chat, "A");
  await answer(chat, "B");
  await backup.settled();

  expect(gitLog("log", "--format=%s").split("\n")).toEqual([
    `${COURSE}: unit derivative finished, passed`,
    `${COURSE}: segment 1 of derivative closed`,
    "Backup started",
  ]);
  expect(
    gitLog("show", "--name-only", "--format=", "HEAD~1").split("\n"),
  ).toEqual(
    expect.arrayContaining([
      `courses/${COURSE}/evidence.jsonl`,
      `courses/${COURSE}/state.json`,
    ]),
  );
  expect(
    gitLog("ls-files")
      .split("\n")
      .filter((f) => f.endsWith(".tmp")),
  ).toEqual([]);
  expect(said).toEqual([`The record is backed up with git in ${dir}.`]);
});

test("when the backup's commits fail, the unit goes on and closes as it would without them", async () => {
  await makeCourse(true, SHORT);
  const said: string[] = [];
  const backup = await startBackup({ path: dir, log: (l) => said.push(l) });
  // Another git process holds the index, so every commit fails.
  await writeFile(join(dir, ".git", "index.lock"), "");
  const setup = setUp(
    [TEACH, ask(Q_QUOTIENT), FEEDBACK, ask(Q_SECANT), FEEDBACK],
    { backup },
  );
  const chat = await open(setup);
  await toCheck(chat);
  await answer(chat, "A");
  await answer(chat, "B");
  await backup.settled();

  expect(chat.events().at(-1)).toEqual({
    type: "unit_closed",
    status: "passed",
  });
  expect(await position()).toEqual({});
  expect(said.slice(1)).toEqual([
    expect.stringMatching(
      /^The backup could not commit "derivatives-from-scratch: segment 1 of derivative closed"/,
    ),
    expect.stringMatching(
      /^The backup could not commit "derivatives-from-scratch: unit derivative finished, passed"/,
    ),
  ]);
});
