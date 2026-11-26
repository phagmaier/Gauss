// The self-test in a unit chat (docs/brief.md, "Assessment modes"): started
// from the course view at once, with no card, in the unit its scope names or
// where Review now would run; refused as Review now is, and with nothing to
// ask; a missed objective's fresh question after another objective; ending
// it partway; a finished unit staying finished; a restart; and the header's
// lines. The fake backend's tutor does what each header allows.

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import type { CurriculumProposal } from "../../shared/curriculum.ts";
import type { PageEvent } from "../../shared/events.ts";
import type { AnswerEvidence } from "../../shared/evidence.ts";
import type { Plan } from "../../shared/plan.ts";
import type { Confidence } from "../../shared/question.ts";
import type { SelfTestRequest } from "../../shared/self-test.ts";
import type { UnitPosition } from "../../shared/state.ts";
import { emptyTimeline, reduce, type Timeline } from "../../shared/timeline.ts";
import { openQuestion } from "../../web/session.ts";
import type { EngineTurn } from "../backends/backend.ts";
import {
  createFakeBackend,
  type FakeBackend,
  type FakeReply,
  type FakeStep,
  KeptSessions,
} from "../backends/fake.ts";
import { type DataRoot, openDataRoot } from "../record/data-root.ts";
import { givenOrder } from "./choice-order.ts";
import { createFakeTimer } from "./fake-timer.ts";
import { createGrader } from "./grading.ts";
import { createHelpJudge } from "./help-judge.ts";
import { createUnitChats, type UnitChat } from "./unit-chat.ts";
import { createUnitPlanner } from "./unit-planning.ts";
import { JOINED_NOTE } from "./unit-turns.ts";

// Each test gets its own data root; none touches ~/gauss (AGENTS.md).
let dir: string;
let kept: KeptSessions;
/** The chats' clock, which a test moves on. */
let clock: Date;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "gauss-unit-self-test-"));
  kept = new KeptSessions();
  clock = new Date(NOW);
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const NOW = "2026-11-25T12:00:00.000Z";
const YESTERDAY = "2026-11-24T12:00:00.000Z";
const HOUR = 60 * 60 * 1000;
const COURSE = "calculus";

const CURRICULUM: CurriculumProposal = {
  title: "Calculus",
  units: [
    { id: "limits", title: "Limits", goal: "Find limits.", prerequisites: [] },
    {
      id: "derivative",
      title: "The derivative",
      goal: "Find slopes.",
      prerequisites: ["limits"],
    },
    {
      id: "integral",
      title: "The integral",
      goal: "Find areas.",
      prerequisites: ["limits"],
    },
  ],
  style: "Short.",
  background: "Knows algebra.",
};

const PLANS: Record<string, Plan> = {
  limits: {
    objectives: [
      {
        id: "limit-value",
        statement: "Find a limit's value from a graph or a table.",
      },
      {
        id: "one-sided",
        statement: "Tell a one-sided limit from a two-sided one.",
      },
    ],
    segments: [
      { title: "Values", objectives: ["limit-value"] },
      { title: "Sides", objectives: ["one-sided"] },
    ],
  },
  derivative: {
    objectives: [
      { id: "slope", statement: "Read a derivative as a tangent's slope." },
      { id: "power-rule", statement: "Differentiate a power of x." },
    ],
    segments: [
      { title: "Slopes", objectives: ["slope"] },
      { title: "Powers", objectives: ["power-rule"] },
    ],
  },
  integral: {
    objectives: [
      { id: "area", statement: "Read an integral as a signed area." },
      { id: "riemann", statement: "Approximate an integral by a sum." },
    ],
    segments: [
      { title: "Areas", objectives: ["area"] },
      { title: "Sums", objectives: ["riemann"] },
    ],
  },
};

/** A correct answer at 90%, recorded at `at`. */
function correct(objective: string, at: string, n = 1): AnswerEvidence {
  return {
    kind: "answer",
    recordedAt: at,
    objective,
    question: {
      kind: "choice",
      prompt: `Seeded question ${n} on ${objective}.`,
      choices: ["Right", "Wrong"],
      answer: "A",
    },
    answer: {
      kind: "choice",
      questionId: `seeded-${objective}-${n}`,
      choice: "A",
      confidence: "90",
    },
    assisted: false,
    verdict: "correct",
  };
}

/**
 * The course, approved and planned the day before, with unit 1's two
 * objectives passed then: unit 1 is finished, and nothing else is started.
 * It runs on Claude unless Codex is given.
 */
async function makeCourse(backend?: "codex"): Promise<DataRoot> {
  const root = openDataRoot({ path: dir, now: () => new Date(YESTERDAY) });
  const { id } = await root.createCourse({
    title: CURRICULUM.title,
    ...(backend === undefined ? {} : { backend }),
  });
  await root.saveProposal(id, CURRICULUM);
  await root.approveCurriculum(id, CURRICULUM);
  for (const [unit, plan] of Object.entries(PLANS)) {
    await root.storePlan(id, unit, plan);
  }
  await root.appendEvidence(id, correct("limit-value", YESTERDAY));
  await root.appendEvidence(id, correct("one-sided", YESTERDAY));
  return root;
}

/**
 * A tutor that does what each header allows: posts a choice question,
 * numbered on from those before, on the objective a header asks about (its
 * right choice is A); opens a detour; gives feedback; or replies. Asked
 * about an objective `pass` names, it passes over the objective named
 * there instead; a learner's "/pass id" has it pass over that one; and in
 * a feedback turn it passes over `inFeedback`, if given, instead.
 */
function tutor(
  pass: Readonly<Record<string, string>> = {},
  inFeedback?: string,
) {
  let asked = 0;
  const passOver = (objective: string): FakeStep[] => [
    {
      call: "pass_over_objective",
      input: { objective, reason: `No picked kind fits ${objective}.` },
    },
  ];
  return (turn: EngineTurn): FakeStep[] => {
    const { text } = turn;
    const objective = /a question on "([^"]+)" with ask_question/.exec(
      text,
    )?.[1];
    const said = /\/pass (\S+)/.exec(text)?.[1];
    if (said !== undefined) return passOver(said);
    if (text.includes("The miss opens a detour")) return [{ text: "Detour." }];
    if (
      objective === undefined &&
      /^\[[^\]]*The learner answered question/.test(text)
    ) {
      return inFeedback === undefined
        ? [{ text: "Feedback." }]
        : passOver(inFeedback);
    }
    const instead = objective === undefined ? undefined : pass[objective];
    if (instead !== undefined) return passOver(instead);
    if (objective !== undefined) {
      asked += 1;
      return [
        { text: "Next." },
        {
          call: "ask_question",
          input: {
            objective,
            kind: "choice",
            prompt: `Question ${asked} on ${objective}?`,
            choices: ["Right", "Wrong"],
            answer: "A",
          },
        },
      ];
    }
    if (text.includes("Allowed now: teach")) return [{ text: "Teaching." }];
    return [{ text: "Reply." }];
  };
}

/** The help judge's verdict on a reply that gave a hint. */
const HELP: FakeReply = {
  output: { reason: "It gave a step.", verdict: "help" },
};

/**
 * `random`'s default makes Fisher-Yates swap nothing: the pick's order,
 * weakest first and then the course's, is the order asked.
 */
function setUp(
  judgments: FakeReply[] = [],
  random = () => 0.99,
  script = tutor(),
  /** The backend keeps the tools a session began with, as Codex does. */
  keepsTools = false,
) {
  const backend = createFakeBackend((turn) => script(turn), [], {
    kept,
    keepsTools,
  });
  const dataRoot = openDataRoot({ path: dir, now: () => clock });
  const units = createUnitChats({
    backends: { claude: backend, codex: backend },
    systemPrompt: "Tutor.",
    dataRoot,
    planner: createUnitPlanner({
      backends: { claude: backend, codex: backend },
      systemPrompt: "Plan.",
      dataRoot,
    }),
    grader: createGrader({ backend, systemPrompt: "Grade." }),
    judge: createHelpJudge({
      backend: createFakeBackend([], judgments),
      systemPrompt: "Judge.",
    }),
    now: () => clock,
    timer: createFakeTimer(),
    order: givenOrder,
    random,
  });
  return { backend, dataRoot, units };
}

/** The record as a restarted server reads it. */
const reload = () => openDataRoot({ path: dir });

async function positionOf(unit: string) {
  const position = (await reload().readState(COURSE)).units[unit];
  if (position === undefined) return undefined;
  const { tutorSessionId: _, ...rest } = position;
  return rest;
}

/** The turns the tutor was sent, by their text. */
const sent = (backend: FakeBackend) => backend.received.map((t) => t.text);

function ofType<T extends PageEvent["type"]>(
  chat: UnitChat,
  type: T,
): Extract<PageEvent, { type: T }>[] {
  return chat
    .events()
    .filter((e): e is Extract<PageEvent, { type: T }> => e.type === type);
}

function lastQuestion(chat: UnitChat) {
  const posted = ofType(chat, "question").at(-1);
  if (posted === undefined) throw new Error("No question was posted.");
  return posted.question;
}

async function answer(
  chat: UnitChat,
  choice: "A" | "B",
  confidence: Confidence = "75",
) {
  expect(
    await chat.answer({
      kind: "choice",
      questionId: lastQuestion(chat).id,
      choice,
      confidence,
    }),
  ).toEqual({ ok: true });
  await chat.settled();
}

async function step(action: Promise<unknown>, chat: UnitChat) {
  expect(await action).toEqual({ ok: true });
  await chat.settled();
}

/** The thread the page builds from the chat's events. */
function replay(chat: UnitChat): Timeline {
  return chat
    .events()
    .reduce(
      (state, event, index) => reduce(state, { type: "event", index, event }),
      reduce(emptyTimeline, { type: "hello", chatId: chat.id }),
    );
}

/** Starts the self-test and answers the chat it started in. */
async function started(
  setup: ReturnType<typeof setUp>,
  request: SelfTestRequest,
  unitId: string,
): Promise<UnitChat> {
  expect(await setup.units.selfTest(COURSE, request)).toEqual({
    ok: true,
    unitId,
  });
  const chat = setup.units.get(COURSE, unitId);
  if (chat === undefined) throw new Error("No chat.");
  await chat.settled();
  return chat;
}

const UNIT_1: SelfTestRequest = {
  scope: { kind: "unit", unit: "limits" },
  kinds: ["choice"],
  count: 5,
};
const COURSE_WIDE: SelfTestRequest = {
  scope: { kind: "course" },
  kinds: ["choice"],
  count: 5,
};
const BOTH = [
  { unit: "limits", objective: "limit-value" },
  { unit: "limits", objective: "one-sided" },
];

/** A check of the unit's first segment with question 1 open on the objective. */
function questionOpen(objective: string): UnitPosition {
  return {
    segment: 0,
    phase: "check",
    checkFrom: 2,
    openQuestion: {
      id: "open-1",
      number: 1,
      objective,
      postedAt: NOW,
      question: {
        kind: "choice",
        prompt: "Which?",
        choices: ["Right", "Wrong"],
        answer: "A",
      },
    },
  };
}

// --- Starting ----------------------------------------------------------------

test("a unit's self-test starts at once in that unit's thread with no card, leaves the finished unit finished, and its header says what is under way and the self-test's rules", async () => {
  await makeCourse();
  const setup = setUp([HELP]);
  const chat = await started(
    setup,
    { ...UNIT_1, kinds: ["choice", "written"] },
    "limits",
  );

  expect(ofType(chat, "assessment")).toEqual([
    {
      type: "assessment",
      mode: "self-test",
      stage: "on",
      count: 2,
      kinds: ["choice", "written"],
    },
  ]);
  expect(ofType(chat, "unit_closed")).toEqual([
    { type: "unit_closed", status: "passed" },
  ]);
  const state = await reload().readState(COURSE);
  expect(state.units).toEqual({});
  expect(state.finishedReviews?.limits?.assessment).toMatchObject({
    mode: "self-test",
    stage: "on",
    objectives: BOTH,
    kinds: ["choice", "written"],
  });

  const [first] = sent(setup.backend);
  expect(first).toContain(
    "The unit is finished: every objective passed. The learner set up a " +
      "self-test, under way here: 2 objectives, asked with choice or written " +
      "questions, one question on each; after a miss, a detour, then a fresh " +
      "question on that objective after another objective, when one is still " +
      "to ask. It leaves the unit finished.",
  );
  expect(first).toContain(
    "The learner started the self-test from the course view.",
  );
  expect(first).toContain(
    'In this self-test, question 1, "limit-value": not asked yet; question 2, ' +
      '"one-sided": not asked yet. Allowed now: a lead-in of one short ' +
      "sentence that says only that a question follows, or which unit it " +
      "comes from, never its subject, rule or method; then a question on " +
      '"limit-value" with ask_question, unlike the ones asked before. ' +
      '"limit-value" is an objective of this unit: Find a limit\'s value from ' +
      "a graph or a table. Before posting, work out its model solution, and " +
      "look for a shortcut that would answer it without that objective's " +
      "skill; if there is one, ask another question. Ask only choice or " +
      "written questions, the kinds the learner picked; if none of them " +
      "fits this objective, do not ask it: call pass_over_objective on " +
      '"limit-value" with why. No teaching in a self-test: before the ' +
      "question, no reminder of the idea, rule or method, and no example. " +
      "Posting ends your turn.",
  );
  expect(lastQuestion(chat)).toMatchObject({
    prompt: "Question 1 on limit-value?",
    assessment: { of: 2 },
  });

  // A message while the question is open: the smallest hint, one per request.
  expect(chat.say("Can I have a hint?")).toEqual({ ok: true });
  await chat.settled();
  expect(sent(setup.backend).at(-1)).toContain(
    'Question 1, on "limit-value", is open. Allowed now: reply without ' +
      "giving its answer away. You may clarify what the question asks: its " +
      "wording, its notation, the form of answer wanted. In this self-test, " +
      "when the learner asks for a hint, give the smallest one that unblocks " +
      "them, one hint per request. A separate judge reads each reply",
  );
  await answer(chat, "A");
  const recorded = (await reload().readEvidence(COURSE)).at(-1);
  expect(recorded).toMatchObject({
    objective: "limit-value",
    assisted: true,
    assessment: { mode: "self-test", unit: "limits" },
  });
});

test("a course self-test runs where Review now would: in the finished unit that holds the first objective picked when no unit is in progress, for a mix too", async () => {
  await makeCourse();
  const setup = setUp();
  const chat = await started(setup, COURSE_WIDE, "limits");
  expect(ofType(chat, "assessment").at(-1)).toMatchObject({
    mode: "self-test",
    count: 2,
  });
  await step(chat.skipAssessment(), chat);

  await started(
    setup,
    { ...COURSE_WIDE, scope: { kind: "mix" }, count: 10 },
    "limits",
  );
});

test("a course self-test starts in the unit in progress opened last; a review card its opening offered gives way to it; ending it partway keeps what was answered, leaves the unit where it was, and is told to the tutor", async () => {
  const root = await makeCourse();
  await root.writePosition(COURSE, "derivative", {
    segment: 0,
    phase: "closed",
  });
  const setup = setUp();
  const chat = await started(setup, COURSE_WIDE, "derivative");

  // Opening the unit in a new sitting offered review of unit 1; the
  // self-test takes its place.
  expect(ofType(chat, "assessment")).toEqual([
    { type: "assessment", mode: "review", stage: "offered", count: 2 },
    {
      type: "assessment",
      mode: "self-test",
      stage: "on",
      count: 2,
      kinds: ["choice"],
    },
  ]);
  expect(ofType(chat, "assessment_end")).toEqual([
    { type: "assessment_end", mode: "review", skipped: true, statuses: {} },
  ]);
  expect(sent(setup.backend)[0]).toContain(
    "Phase: closed. The learner set up a self-test, under way here: 2 " +
      "objectives, asked with choice questions, one question on each; after " +
      "a miss, a detour, then a fresh question on that objective after " +
      "another objective, when one is still to ask. The segment waits until " +
      "it ends.",
  );
  expect(lastQuestion(chat)).toMatchObject({
    prompt: "Question 1 on limit-value?",
    assessment: { of: 2, from: { number: 1, title: "Limits" } },
  });
  await answer(chat, "A");
  const withdrawn = lastQuestion(chat);
  expect(withdrawn.prompt).toBe("Question 2 on one-sided?");

  await step(chat.skipAssessment(), chat);
  expect(ofType(chat, "assessment_end").at(-1)).toEqual({
    type: "assessment_end",
    mode: "self-test",
    skipped: true,
    statuses: { "limit-value": "retained" },
    withdrawnQuestionId: withdrawn.id,
  });
  expect(await positionOf("derivative")).toEqual({
    segment: 0,
    phase: "closed",
    tutorNotices: [
      {
        id: expect.any(String),
        kind: "assessment-end",
        mode: "self-test",
        skipped: true,
        withdrawn: 2,
        statuses: { "limit-value": "retained" },
      },
    ],
  });
  const answers = (await reload().readEvidence(COURSE)).filter(
    (e): e is AnswerEvidence =>
      e.kind === "answer" && e.assessment !== undefined,
  );
  expect(answers.map((a) => [a.objective, a.assessment])).toEqual([
    ["limit-value", { mode: "self-test", unit: "derivative" }],
  ]);

  expect(chat.say("Hello.")).toEqual({ ok: true });
  await chat.settled();
  expect(sent(setup.backend).at(-1)).toContain(
    "The learner ended the self-test partway, and question 2 was withdrawn. " +
      "The unit goes on where it stood before the self-test.",
  );
});

// --- Refusals ------------------------------------------------------------------

test("a self-test is refused with a question or a detour open in its thread, with one under way there, and with nothing to ask, which opens no unit", async () => {
  const root = await makeCourse();
  await root.writePosition(COURSE, "integral", questionOpen("area"));
  const setup = setUp();

  expect(await setup.units.selfTest(COURSE, COURSE_WIDE)).toEqual({
    ok: false,
    status: 409,
    error: "In unit 3, The integral: Question 1 is open: answer it first.",
  });
  await setup.units.close();

  const { openQuestion: _, ...check } = questionOpen("area");
  await root.writePosition(COURSE, "integral", {
    ...check,
    detour: { questionId: "open-1", number: 1, objective: "area" },
  });
  const again = setUp();
  expect(await again.units.selfTest(COURSE, COURSE_WIDE)).toEqual({
    ok: false,
    status: 409,
    error:
      "In unit 3, The integral: A detour is open after question 1: end it first.",
  });

  // Unit 1's thread: one self-test under way refuses another.
  await started(again, UNIT_1, "limits");
  expect(await again.units.selfTest(COURSE, UNIT_1)).toEqual({
    ok: false,
    status: 409,
    error: "In unit 1, Limits: Finish or end the self-test first.",
  });

  // Nothing in unit 2 has an answer.
  expect(
    await again.units.selfTest(COURSE, {
      ...UNIT_1,
      scope: { kind: "unit", unit: "derivative" },
    }),
  ).toEqual({
    ok: false,
    status: 409,
    error: "There is nothing to ask in this scope yet.",
  });
  expect(again.units.get(COURSE, "derivative")).toBeUndefined();
  expect(
    await again.units.selfTest(COURSE, {
      ...UNIT_1,
      scope: { kind: "unit", unit: "nowhere" },
    }),
  ).toEqual({
    ok: false,
    status: 404,
    error: 'There is no unit "nowhere" in the course "calculus".',
  });
});

test("the setup's counts leave out what was answered within the hour, and a scope all answered within it has nothing to ask", async () => {
  await makeCourse();
  const setup = setUp();
  expect(await setup.units.selfTestCounts(COURSE, UNIT_1)).toEqual({
    ok: true,
    counts: { asks: 2, holds: 2, withinHour: 0 },
  });
  const halfAnHourAgo = new Date(Date.parse(NOW) - HOUR / 2).toISOString();
  await reload().appendEvidence(
    COURSE,
    correct("limit-value", halfAnHourAgo, 2),
  );
  expect(await setup.units.selfTestCounts(COURSE, UNIT_1)).toEqual({
    ok: true,
    counts: { asks: 1, holds: 2, withinHour: 1 },
  });
  await reload().appendEvidence(COURSE, correct("one-sided", halfAnHourAgo, 2));
  expect(await setup.units.selfTest(COURSE, UNIT_1)).toEqual({
    ok: false,
    status: 409,
    error:
      "There is nothing to ask in this scope now: its objectives were all answered within the hour.",
  });
  expect(setup.units.get(COURSE, "limits")).toBeUndefined();
});

test("a gate card offered in the unit's thread does not give way: the self-test is refused", async () => {
  const root = await makeCourse();
  await root.appendEvidence(COURSE, correct("slope", YESTERDAY));
  await root.writePosition(COURSE, "derivative", {
    segment: 1,
    phase: "closed",
    gated: true,
    assessment: {
      mode: "gate",
      stage: "offered",
      objectives: [{ unit: "derivative", objective: "slope" }],
    },
  });
  const setup = setUp();
  expect(
    await setup.units.selfTest(COURSE, {
      ...UNIT_1,
      scope: { kind: "unit", unit: "derivative" },
    }),
  ).toEqual({
    ok: false,
    status: 409,
    error: "In unit 2, The derivative: Start or skip the gate first.",
  });
  const chat = setup.units.get(COURSE, "derivative");
  if (chat === undefined) throw new Error("No chat.");
  expect(ofType(chat, "assessment").map((e) => e.mode)).toEqual(["gate"]);
});

test.each(["ends", "is ended partway"])(
  "a review card that held the segment's teaching gives way to a course self-test, and the teaching is sent once the self-test %s",
  async (ending) => {
    const root = await makeCourse();
    await root.writePosition(COURSE, "derivative", {
      segment: 0,
      phase: "teach",
    });
    const setup = setUp();
    const chat = await started(setup, COURSE_WIDE, "derivative");
    expect(ofType(chat, "assessment").map((e) => [e.mode, e.stage])).toEqual([
      ["review", "offered"],
      ["self-test", "on"],
    ]);
    const teaching = () =>
      sent(setup.backend).filter((t) => t.includes("Allowed now: teach"));
    expect(teaching()).toEqual([]);

    await answer(chat, "A");
    if (ending === "ends") await answer(chat, "A");
    else await step(chat.skipAssessment(), chat);
    expect(ofType(chat, "assessment_end").at(-1)).toMatchObject({
      mode: "self-test",
      skipped: ending !== "ends",
    });
    expect(teaching()).toHaveLength(1);
    expect(await positionOf("derivative")).toEqual({
      segment: 0,
      phase: "discuss",
    });
  },
);

test("a course self-test goes where Review now would: with a review under way in a unit's thread, it is refused there, named by that unit, and runs nowhere else", async () => {
  await makeCourse();
  const setup = setUp();
  expect(await setup.units.reviewNow(COURSE)).toEqual({
    ok: true,
    unitId: "limits",
  });
  const limits = setup.units.get(COURSE, "limits");
  if (limits === undefined) throw new Error("No chat.");
  await limits.settled();
  // A unit in progress, which the self-test would take without the review.
  await setup.dataRoot.writePosition(COURSE, "derivative", {
    segment: 0,
    phase: "closed",
  });

  expect(await setup.units.selfTest(COURSE, COURSE_WIDE)).toEqual({
    ok: false,
    status: 409,
    error: "In unit 1, Limits: Finish or skip the review first.",
  });
  expect(setup.units.get(COURSE, "derivative")).toBeUndefined();
  expect(ofType(limits, "assessment").map((e) => e.mode)).toEqual([
    "review",
    "review",
  ]);
});

// --- Asking ------------------------------------------------------------------

test("after a miss the next question is on the other objective, and the missed one's fresh question comes after it; a restart mid-run resumes it, and the finished unit stays finished", async () => {
  await makeCourse();
  const first = setUp();
  const chat = await started(first, UNIT_1, "limits");

  await answer(chat, "B");
  expect(sent(first.backend).at(-1)).toContain(
    'In this self-test, question 1, "limit-value": missed, so a fresh ' +
      "question on it comes later, after another objective; question 2, " +
      '"one-sided": not asked yet. The miss opens a detour',
  );
  expect(sent(first.backend).at(-1)).toContain(
    'When they press it, a question on another objective follows; the fresh one on "limit-value" comes later.',
  );
  // A message in the detour hears the same.
  expect(chat.say("Why?")).toEqual({ ok: true });
  await chat.settled();
  expect(sent(first.backend).at(-1)).toContain(
    'you may suggest it once the confusion seems cleared. When they press it, a question on another objective follows; the fresh one on "limit-value" comes later.',
  );

  await step(chat.anotherQuestion(), chat);
  expect(sent(first.backend).at(-1)).toContain(
    'The learner pressed "Ready for another question": the detour after ' +
      "question 1 is over, and the self-test goes on.",
  );
  expect(lastQuestion(chat)).toMatchObject({
    prompt: "Question 2 on one-sided?",
    number: 2,
    assessment: { of: 2 },
  });
  expect(lastQuestion(chat).assessment).not.toHaveProperty("second");

  await answer(chat, "A");
  expect(sent(first.backend).at(-1)).toContain(
    'In this self-test, question 1, "limit-value": missed, so a fresh ' +
      'question on it comes next; question 2, "one-sided": answered ' +
      "correctly. Allowed now: a lead-in of one short sentence that says " +
      "only that a question follows, or which unit it comes from, never its " +
      'subject, rule or method; then a question on "limit-value" with ' +
      "ask_question, unlike the ones asked before, and unlike the one missed " +
      "before: a fresh question on the same idea.",
  );
  const second = lastQuestion(chat);
  expect(second).toMatchObject({
    prompt: "Question 3 on limit-value?",
    number: 1,
    assessment: { of: 2, second: true },
  });
  await first.units.close();

  // A restart shows the open question again; answering it ends the run.
  const restarted = setUp();
  const opened = await restarted.units.open(COURSE, "limits");
  if (!opened.ok) throw new Error(opened.error);
  const reopened = opened.chat;
  await reopened.settled();
  expect(openQuestion(replay(reopened))?.question.id).toBe(second.id);
  await answer(reopened, "A");

  // Passed, then missed cold: slipping until it passes again; one correct
  // answer at 75% does not pass it.
  expect(ofType(reopened, "assessment_end")).toEqual([
    {
      type: "assessment_end",
      mode: "self-test",
      skipped: false,
      statuses: { "limit-value": "slipping", "one-sided": "retained" },
    },
  ]);
  expect(ofType(reopened, "unit_closed").at(-1)).toEqual({
    type: "unit_closed",
    status: "passed",
  });
  const after = await reload().readState(COURSE);
  expect(after.units).toEqual({});
  // The run's entry goes; the closed position keeps the tutor's session,
  // and the notice of the end for its next turn.
  expect(after.finishedReviews).toEqual({
    limits: {
      segment: 1,
      phase: "closed",
      tutorSessionId: expect.any(String),
      tutorNotices: [
        {
          id: expect.any(String),
          kind: "assessment-end",
          mode: "self-test",
          skipped: false,
          statuses: { "limit-value": "slipping", "one-sided": "retained" },
        },
      ],
    },
  });
  const answers = (await reload().readEvidence(COURSE)).filter(
    (e): e is AnswerEvidence =>
      e.kind === "answer" && e.assessment !== undefined,
  );
  expect(answers.map((a) => [a.objective, a.verdict, a.assessment])).toEqual([
    ["limit-value", "incorrect", { mode: "self-test", unit: "limits" }],
    ["one-sided", "correct", { mode: "self-test", unit: "limits" }],
    ["limit-value", "correct", { mode: "self-test", unit: "limits" }],
  ]);
});

test("with one objective left, a miss's fresh question follows its detour at once", async () => {
  await makeCourse();
  const setup = setUp();
  const chat = await started(setup, UNIT_1, "limits");
  await answer(chat, "A");
  expect(lastQuestion(chat).prompt).toBe("Question 2 on one-sided?");

  await answer(chat, "B");
  expect(sent(setup.backend).at(-1)).toContain(
    'question 2, "one-sided": missed, so a fresh question on it comes next. The miss opens a detour',
  );
  expect(sent(setup.backend).at(-1)).toContain(
    'When they press it, the fresh question on "one-sided" follows at once: no other objective is left to ask.',
  );
  await step(chat.anotherQuestion(), chat);
  expect(lastQuestion(chat)).toMatchObject({
    prompt: "Question 3 on one-sided?",
    assessment: { of: 2, second: true },
  });
});

test("the pick is asked in random order, from the injected source", async () => {
  await makeCourse();
  // Fisher-Yates over two swaps them.
  const setup = setUp([], () => 0);
  const chat = await started(setup, UNIT_1, "limits");
  expect(
    (await reload().readState(COURSE)).finishedReviews?.limits?.assessment
      ?.objectives,
  ).toEqual([BOTH[1], BOTH[0]]);
  expect(lastQuestion(chat).prompt).toBe("Question 1 on one-sided?");
});

// --- The kinds picked, and passing over --------------------------------------

test("a question of a kind the learner did not pick is refused, naming the kinds picked and the pass-over tool", async () => {
  await makeCourse();
  const setup = setUp();
  const chat = await started(
    setup,
    { ...UNIT_1, kinds: ["math", "written"] },
    "limits",
  );
  expect(ofType(chat, "question")).toEqual([]);
  expect(setup.backend.calls.at(-1)).toMatchObject({
    name: "ask_question",
    result: {
      status: "refused",
      text:
        "The learner picked only math or written questions for this " +
        'self-test, so a choice question is refused. Ask "limit-value" ' +
        "with one of those kinds; if none fits it, call " +
        "pass_over_objective on it with why.",
    },
  });
});

test.each([
  [
    "lack pass_over_objective",
    (tools: string[]) => tools.filter((name) => name !== "pass_over_objective"),
  ],
  ["were never kept", () => undefined],
])(
  "a Codex thread whose kept tools %s, reopened in a self-test after a restart, gives way to a new conversation that passes over",
  async (_, keep) => {
    await makeCourse("codex");
    const first = setUp([], undefined, tutor(), true);
    await started(first, UNIT_1, "limits");
    await first.units.close();
    // As a thread begun before the self-test had its pass-over tool.
    const file = join(dir, "courses", COURSE, "state.json");
    const state = JSON.parse(await readFile(file, "utf8"));
    const run = state.finishedReviews.limits;
    expect(run.tutorTools).toContain("pass_over_objective");
    const tools = keep(run.tutorTools);
    if (tools === undefined) delete run.tutorTools;
    else run.tutorTools = tools;
    await writeFile(file, JSON.stringify(state));

    const restarted = setUp(
      [],
      undefined,
      tutor({ "one-sided": "one-sided" }),
      true,
    );
    const opened = await restarted.units.open(COURSE, "limits");
    if (!opened.ok) throw new Error(opened.error);
    const chat = opened.chat;
    await chat.settled();
    expect(ofType(chat, "fresh_start")).toEqual([
      { type: "fresh_start", reason: "tools" },
    ]);
    await answer(chat, "A");

    expect(restarted.backend.sessions[0]?.resumeId).toBeUndefined();
    expect(sent(restarted.backend)[0]).toContain(JOINED_NOTE);
    expect(
      restarted.backend.calls.find((c) => c.name === "pass_over_objective")
        ?.result.status,
    ).toBe("done");
  },
);

test("passing over is refused outside a self-test, with a question open, in a detour, while feedback is pending, for an objective not asked next, and for a missed objective's fresh question", async () => {
  await makeCourse();
  const refusal = (setup: ReturnType<typeof setUp>) =>
    setup.backend.calls.findLast((c) => c.name === "pass_over_objective")
      ?.result;

  // In a review the learner asked for, under way with question 1 open.
  const inReview = setUp();
  expect(await inReview.units.reviewNow(COURSE)).toMatchObject({ ok: true });
  const reviewing = inReview.units.get(COURSE, "limits");
  if (reviewing === undefined) throw new Error("No chat.");
  await reviewing.settled();
  expect(lastQuestion(reviewing).number).toBe(1);
  expect(reviewing.say("/pass limit-value")).toEqual({ ok: true });
  await reviewing.settled();
  expect(ofType(reviewing, "assessment_end")).toEqual([]);
  expect(refusal(inReview)).toEqual({
    status: "refused",
    text: "pass_over_objective is only for a self-test under way. Do as the header allows.",
  });
  await step(reviewing.skipAssessment(), reviewing);
  await inReview.units.close();

  // With question 1 open in a self-test.
  clock = new Date(Date.parse(NOW) + 2 * HOUR);
  const open = setUp();
  const chat = await started(open, UNIT_1, "limits");
  expect(chat.say("/pass limit-value")).toEqual({ ok: true });
  await chat.settled();
  expect(refusal(open)).toEqual({
    status: "refused",
    text: "Question 1 is open: nothing is passed over until the learner answers it. End your turn.",
  });
  await step(chat.skipAssessment(), chat);
  await open.units.close();

  // Asked about limit-value, the tutor tries to pass over one-sided.
  clock = new Date(Date.parse(NOW) + 4 * HOUR);
  const wrong = setUp([], () => 0.99, tutor({ "limit-value": "one-sided" }));
  const passing = await started(wrong, UNIT_1, "limits");
  expect(refusal(wrong)).toEqual({
    status: "refused",
    text: 'The self-test asks about "limit-value" now: pass over only that objective, or ask it.',
  });
  expect(ofType(passing, "passed_over")).toEqual([]);
  await step(passing.skipAssessment(), passing);
  await wrong.units.close();

  // In the detour after a miss.
  clock = new Date(Date.parse(NOW) + 6 * HOUR);
  const detoured = setUp();
  const inDetour = await started(detoured, UNIT_1, "limits");
  await answer(inDetour, "B");
  expect(inDetour.say("/pass one-sided")).toEqual({ ok: true });
  await inDetour.settled();
  expect(refusal(detoured)).toEqual({
    status: "refused",
    text: "A detour is open: work through it with the learner. The self-test goes on once they end it.",
  });
  expect(ofType(inDetour, "passed_over")).toEqual([]);
  await step(inDetour.skipAssessment(), inDetour);
  await detoured.units.close();

  // In the feedback turn on question 1.
  clock = new Date(Date.parse(NOW) + 8 * HOUR);
  const feeding = setUp([], () => 0.99, tutor({}, "one-sided"));
  const inFeedback = await started(feeding, UNIT_1, "limits");
  await answer(inFeedback, "A");
  expect(refusal(feeding)).toEqual({
    status: "refused",
    text: "Your feedback on the last answer comes first; the app asks for the next question in a message of its own.",
  });
  expect(ofType(inFeedback, "passed_over")).toEqual([]);
  expect(lastQuestion(inFeedback).prompt).toBe("Question 2 on one-sided?");
  await step(inFeedback.skipAssessment(), inFeedback);
  await feeding.units.close();

  // Missed, then asked again after the other objective: the tutor tries to
  // pass over its fresh question.
  clock = new Date(Date.parse(NOW) + 10 * HOUR);
  const base = tutor();
  const missed = setUp(
    [],
    () => 0.99,
    (turn) =>
      turn.text.includes("a fresh question on the same idea")
        ? [
            {
              call: "pass_over_objective",
              input: { objective: "limit-value", reason: "None fits." },
            },
          ]
        : base(turn),
  );
  const again = await started(missed, UNIT_1, "limits");
  await answer(again, "B");
  await step(again.anotherQuestion(), again);
  expect(lastQuestion(again).prompt).toBe("Question 2 on one-sided?");
  await answer(again, "A");
  expect(sent(missed.backend).at(-1)).toContain(
    "Ask only choice questions, the kinds the learner picked. No teaching",
  );
  expect(refusal(missed)).toEqual({
    status: "refused",
    text: '"limit-value" was asked with a kind picked and missed: ask its fresh question with ask_question.',
  });
  expect(ofType(again, "passed_over")).toEqual([]);
});

test("passing over every objective ends the self-test, and the next header says so", async () => {
  await makeCourse();
  const setup = setUp(
    [],
    () => 0.99,
    tutor({ "limit-value": "limit-value", "one-sided": "one-sided" }),
  );
  const chat = await started(setup, UNIT_1, "limits");
  expect(setup.backend.calls.map((c) => c.result)).toEqual([
    {
      status: "done",
      text: 'Passed over "limit-value". The app asks for the next question in a message of its own. Your turn is over.',
      endTurn: true,
    },
    {
      status: "done",
      text: 'Passed over "one-sided". It was the self-test\'s last objective, and the self-test is over. Your turn is over.',
      endTurn: true,
    },
  ]);
  expect(ofType(chat, "question")).toEqual([]);
  expect(ofType(chat, "assessment_end")).toEqual([
    {
      type: "assessment_end",
      mode: "self-test",
      skipped: false,
      statuses: {},
      passedOver: 2,
    },
  ]);
  expect(chat.say("Hello.")).toEqual({ ok: true });
  await chat.settled();
  expect(sent(setup.backend).at(-1)).toContain(
    "The self-test is over: nothing answered. Passed over, since no kind " +
      'picked fits them: "limit-value" and "one-sided". The unit goes on ' +
      "where it stood before the self-test. Do not go back over the " +
      "self-test unless the learner asks.",
  );
});

test("an objective passed over records nothing, the self-test asks the next, its end counts it, and reopening the unit shows it again", async () => {
  await makeCourse();
  const first = setUp([], () => 0.99, tutor({ "limit-value": "limit-value" }));
  const chat = await started(first, UNIT_1, "limits");

  expect(first.backend.calls[0]).toEqual({
    name: "pass_over_objective",
    input: {
      objective: "limit-value",
      reason: "No picked kind fits limit-value.",
    },
    result: {
      status: "done",
      text: 'Passed over "limit-value". The app asks for the next question in a message of its own. Your turn is over.',
      endTurn: true,
    },
  });
  expect(ofType(chat, "passed_over")).toEqual([
    {
      type: "passed_over",
      objective: "limit-value",
      reason: "No picked kind fits limit-value.",
    },
  ]);
  expect(
    (await reload().readState(COURSE)).finishedReviews?.limits?.assessment
      ?.passedOver,
  ).toEqual([
    { objective: "limit-value", reason: "No picked kind fits limit-value." },
  ]);
  // Only the two seeded answers: passing over records no evidence.
  expect(await reload().readEvidence(COURSE)).toHaveLength(2);
  expect(sent(first.backend)[1]).toContain(
    'You passed over "limit-value": nothing is recorded on it, and the ' +
      'self-test goes on. In this self-test, question 1, "limit-value": ' +
      'passed over: no kind picked fits it; question 2, "one-sided": not ' +
      "asked yet.",
  );
  expect(lastQuestion(chat)).toMatchObject({
    prompt: "Question 1 on one-sided?",
    number: 2,
  });
  await first.units.close();

  // Reopened, the thread shows it again, and the run goes on to its end.
  const second = setUp();
  const opened = await second.units.open(COURSE, "limits");
  if (!opened.ok) throw new Error(opened.error);
  const reopened = opened.chat;
  await reopened.settled();
  expect(ofType(reopened, "passed_over")).toHaveLength(1);
  expect(replay(reopened).items).toContainEqual(
    expect.objectContaining({
      kind: "passed_over",
      objective: "limit-value",
      reason: "No picked kind fits limit-value.",
    }),
  );
  await answer(reopened, "A");
  expect(ofType(reopened, "assessment_end")).toEqual([
    {
      type: "assessment_end",
      mode: "self-test",
      skipped: false,
      statuses: { "one-sided": "retained" },
      passedOver: 1,
    },
  ]);
  expect(reopened.say("Hello.")).toEqual({ ok: true });
  await reopened.settled();
  expect(sent(second.backend).at(-1)).toContain(
    'The self-test is over: "one-sided" retained. Passed over, since no ' +
      'kind picked fits it: "limit-value". The unit goes on where it stood ' +
      "before the self-test.",
  );
});
