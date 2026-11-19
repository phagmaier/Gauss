// Testing out of a unit in a unit chat (task 5.6; docs/decisions.md,
// "Mastery loop", "Testing out"): the unit opened for its test, planned
// first; questions with no feedback and no detour, and a second after an
// unsure correct answer; the tutor's word on it and the result card, which
// skips nothing until it is answered; skipping what passed, the whole unit
// taught, "Start learning instead", restarts, a review offered first, and the
// gate later leaving out what the test passed. The fake backend's tutor does
// what each header allows.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import type { CurriculumProposal } from "../../shared/curriculum.ts";
import type { PageEvent } from "../../shared/events.ts";
import type { AnswerEvidence } from "../../shared/evidence.ts";
import type { Plan } from "../../shared/plan.ts";
import type { Confidence } from "../../shared/question.ts";
import {
  finishedByTest,
  nextStep,
  outline,
  testResultCard,
  whereInUnit,
} from "../../web/session.ts";
import {
  emptyTimeline,
  reduce,
  type TestResultItem,
  type Timeline,
} from "../../web/timeline.ts";
import type { EngineTurn, SessionOptions } from "../backends/backend.ts";
import {
  createFakeBackend,
  type FakeBackend,
  type FakeStep,
} from "../backends/fake.ts";
import { type DataRoot, openDataRoot } from "../record/data-root.ts";
import { objectiveStatus, unitStatus } from "../record/status.ts";
import { givenOrder } from "./choice-order.ts";
import { createFakeTimer } from "./fake-timer.ts";
import { createGrader } from "./grading.ts";
import { createHelpJudge } from "./help-judge.ts";
import { createUnitChats, type UnitChat } from "./unit-chat.ts";
import { createUnitPlanner } from "./unit-planning.ts";

// Each test gets its own data root; none touches ~/gauss (AGENTS.md).
let dir: string;
let kept: Set<string>;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "gauss-unit-test-out-"));
  kept = new Set();
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const NOW = "2026-11-18T12:00:00.000Z";
const YESTERDAY = "2026-11-17T12:00:00.000Z";
/** Two hours on: a new sitting, past the hour since review was offered. */
const LATER = "2026-11-18T14:00:00.000Z";
const COURSE = "calculus";
/** A test with many turns writes and flushes the record at each; see unit-review.test.ts. */
const MANY_TURNS_MS = 20_000;

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
  ],
  style: "Short.",
  background: "Knows algebra.",
};

const LIMITS_PLAN: Plan = {
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
};

/** The unit tested: a segment of one objective, then one of two. */
const DERIVATIVE_PLAN: Plan = {
  objectives: [
    { id: "slope", statement: "Read a derivative as a tangent's slope." },
    { id: "power-rule", statement: "Differentiate a power of x." },
    { id: "chain-rule", statement: "Differentiate a composite function." },
  ],
  segments: [
    { title: "Slopes", objectives: ["slope"] },
    { title: "Rules", objectives: ["power-rule", "chain-rule"] },
  ],
};

/** A correct answer at 90%, which passes its objective alone. */
function correct(objective: string, at: string): AnswerEvidence {
  return {
    kind: "answer",
    recordedAt: at,
    objective,
    question: {
      kind: "choice",
      prompt: `Seeded question on ${objective}.`,
      choices: ["Right", "Wrong"],
      answer: "A",
    },
    answer: {
      kind: "choice",
      questionId: `seeded-${objective}`,
      choice: "A",
      confidence: "90",
    },
    assisted: false,
    verdict: "correct",
  };
}

/**
 * The course, approved: unit 1 finished, passed the day before; unit 2 not
 * started, planned unless `planned` is false. Review was offered just now,
 * so none comes in the way, unless `reviewDue`.
 */
async function makeCourse(
  options: { planned?: boolean; reviewDue?: boolean } = {},
): Promise<DataRoot> {
  const root = openDataRoot({ path: dir, now: () => new Date(YESTERDAY) });
  const { id } = await root.createCourse({ title: CURRICULUM.title });
  await root.saveProposal(id, CURRICULUM);
  await root.approveCurriculum(id, CURRICULUM);
  await root.storePlan(id, "limits", LIMITS_PLAN);
  if (options.planned !== false) {
    await root.storePlan(id, "derivative", DERIVATIVE_PLAN);
  }
  await root.appendEvidence(id, correct("limit-value", YESTERDAY));
  await root.appendEvidence(id, correct("one-sided", YESTERDAY));
  if (options.reviewDue !== true) {
    await root.markReviewOffered(id, new Date(NOW));
  }
  return root;
}

/**
 * A tutor that does what each header allows: plans the unit; posts a choice
 * question, numbered on from those before, on the objective a header asks
 * about (its right choice is A), also in the turn with a test answer's
 * grade; gives feedback; teaches; or replies. `quiet` turns post nothing.
 */
function tutor(quiet: (text: string) => boolean = () => false) {
  let asked = 0;
  return (turn: EngineTurn, session: SessionOptions): FakeStep[] => {
    const { text } = turn;
    if (session.tools.some((t) => t.name === "plan_unit")) {
      return [{ call: "plan_unit", input: DERIVATIVE_PLAN }];
    }
    if (quiet(text)) return [{ text: "Thinking." }];
    if (text.includes("What it showed: ")) return [{ text: "Summary." }];
    // The first of the objectives named, in a check on two.
    const objective =
      /a question on "([^"]+)"(?: and "[^"]+")? with ask_question/.exec(
        text,
      )?.[1];
    if (objective !== undefined) {
      asked += 1;
      return [
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
    if (text.includes("The miss opens a detour")) return [{ text: "Detour." }];
    if (/^\[[^\]]*The learner answered question/.test(text)) {
      return [{ text: "Feedback." }];
    }
    if (text.includes("Allowed now: teach")) return [{ text: "Teaching." }];
    return [{ text: "Reply." }];
  };
}

function setUp(script = tutor(), at = NOW) {
  const backend = createFakeBackend(script, [], { kept });
  const clock = new Date(at);
  const dataRoot = openDataRoot({ path: dir, now: () => clock });
  const units = createUnitChats({
    backend,
    systemPrompt: "Tutor.",
    dataRoot,
    planner: createUnitPlanner({ backend, systemPrompt: "Plan.", dataRoot }),
    grader: createGrader({ backend, systemPrompt: "Grade." }),
    judge: createHelpJudge({
      backend: createFakeBackend([]),
      systemPrompt: "Judge.",
    }),
    now: () => clock,
    timer: createFakeTimer(),
    order: givenOrder,
  });
  return { backend, units };
}

/** Opens unit 2 with its test, as "Start the test" does. */
async function testOut(setup: ReturnType<typeof setUp>): Promise<UnitChat> {
  const opened = await setup.units.open(COURSE, "derivative", {
    testOut: true,
  });
  if (!opened.ok) throw new Error(opened.error);
  await opened.chat.settled();
  return opened.chat;
}

/** Opens unit 2 as its session page does, after a restart. */
async function open(setup: ReturnType<typeof setUp>): Promise<UnitChat> {
  const opened = await setup.units.open(COURSE, "derivative");
  if (!opened.ok) throw new Error(opened.error);
  await opened.chat.settled();
  return opened.chat;
}

/** The record as a restarted server reads it. */
const reload = () => openDataRoot({ path: dir });

async function positionOf(unit = "derivative") {
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
  choice: "A" | "B" | null,
  confidence: Confidence = "90",
) {
  const questionId = lastQuestion(chat).id;
  expect(
    await chat.answer(
      choice === null
        ? { kind: "unknown", questionId }
        : { kind: "choice", questionId, choice, confidence },
    ),
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

function resultOf(timeline: Timeline): TestResultItem {
  const card = timeline.items.findLast((i) => i.kind === "test_result");
  if (card?.kind !== "test_result") throw new Error("No result card.");
  return card;
}

const TEST_RUN = {
  mode: "test-out",
  stage: "on",
  objectives: [
    { unit: "derivative", objective: "slope" },
    { unit: "derivative", objective: "power-rule" },
    { unit: "derivative", objective: "chain-rule" },
  ],
};
const REFUSED_FOR_CARD = {
  ok: false,
  status: 409,
  error: "Answer the test's result card first.",
};

// --- Every objective passed ------------------------------------------------------

test(
  "a unit not started is planned, then tested: a question on each objective, the grade's turn asking for the next with no feedback; every objective passed, the card waits, and finishing the unit takes no teaching and no gate",
  async () => {
    await makeCourse({ planned: false });
    const setup = setUp();
    const chat = await testOut(setup);

    // Planned as any unit is, then the test in place of the teaching turn.
    expect(ofType(chat, "unit_planning")).toHaveLength(1);
    expect(
      (await reload().readCourse(COURSE))?.curriculum?.units[1]?.plan,
    ).toEqual(DERIVATIVE_PLAN);
    expect(await positionOf()).toEqual({
      segment: 0,
      phase: "teach",
      assessment: { ...TEST_RUN, from: 2 },
      openQuestion: expect.objectContaining({ number: 1, objective: "slope" }),
    });
    expect(sent(setup.backend).slice(1)).toEqual([
      '[Unit 2 of 2, "The derivative"; segment 1 of 2, "Slopes", on "slope". Phase: teach. ' +
        "The learner is testing out of the unit before it is taught, and the teaching waits until the test ends. " +
        "The learner chose to test out of this unit before it is taught: a question on each of its 3 objectives, " +
        "and a second at once after a correct answer that does not pass alone (below 90%, or with help). " +
        "Nothing is explained, and nothing is said between questions, until it ends. " +
        'In this test, "slope": not asked yet; "power-rule": not asked yet; "chain-rule": not asked yet. ' +
        'Allowed now: a question on "slope" with ask_question, unlike the ones asked before, and nothing else: ' +
        "no lead-in, no word on any answer, no teaching. " +
        '"slope" is an objective of this unit: Read a derivative as a tangent\'s slope. Posting ends your turn.\n' +
        'Questions asked before:\nNo question has been asked on "slope" before.]',
    ]);
    expect(lastQuestion(chat)).toMatchObject({
      number: 1,
      assessment: { of: 3, objective: 1 },
    });

    await answer(chat, "A", "90");
    const graded = sent(setup.backend).at(-1) ?? "";
    expect(graded).toContain("The learner answered question 1.");
    expect(graded).toContain(
      'In this test, "slope": answered correctly; "power-rule": not asked yet; "chain-rule": not asked yet. ' +
        'Allowed now: a question on "power-rule" with ask_question',
    );
    expect(graded).not.toContain("feedback");
    expect(lastQuestion(chat)).toMatchObject({
      number: 2,
      assessment: { of: 3, objective: 2 },
    });
    await answer(chat, "A", "100");
    await answer(chat, "A", "90");

    // The last grade's turn asks what the test showed; the card follows it.
    expect(sent(setup.backend).at(-1)).toContain(
      "That was the test's last question, and the test is over. " +
        'What it showed: "slope" passed (correct at 90%); "power-rule" passed (correct at 100%); "chain-rule" passed (correct at 90%). ' +
        "Allowed now, as text, with no tool: say in a few sentences what the test showed",
    );
    const end = chat.events().slice(-4);
    expect(end).toEqual([
      { type: "turn_start" },
      { type: "tutor_text", text: "Summary." },
      { type: "turn_end", outcome: "done" },
      {
        type: "test_result",
        objectives: [
          {
            objective: "slope",
            passed: true,
            answers: [
              { verdict: "correct", confidence: "90", assisted: false },
            ],
          },
          {
            objective: "power-rule",
            passed: true,
            answers: [
              { verdict: "correct", confidence: "100", assisted: false },
            ],
          },
          {
            objective: "chain-rule",
            passed: true,
            answers: [
              { verdict: "correct", confidence: "90", assisted: false },
            ],
          },
        ],
      },
    ]);
    // Nothing is skipped while the card waits: nothing is taught either.
    expect(await positionOf()).toEqual({
      segment: 0,
      phase: "teach",
      testOut: { stage: "result" },
    });
    expect(ofType(chat, "detour")).toEqual([]);
    expect(
      sent(setup.backend).some((t) => t.includes("Allowed now: teach")),
    ).toBe(false);
    expect(await chat.ready()).toEqual(REFUSED_FOR_CARD);
    const waiting = replay(chat);
    expect(waiting.testWaits).toBe(true);
    expect(nextStep(waiting)).toBeNull();
    expect(
      whereInUnit(DERIVATIVE_PLAN, waiting.position, null, null, true),
    ).toEqual({
      label: "Testing out",
      ticks: ["", ""],
    });
    expect(testResultCard(DERIVATIVE_PLAN, resultOf(waiting))).toMatchObject({
      says: { text: "All three passed", className: "ok" },
      objectives: [
        {
          text: "Read a derivative as a tangent's slope.",
          word: { text: "Passed" },
          why: "Right, 90% sure",
        },
        {
          text: "Differentiate a power of x.",
          word: { text: "Passed" },
          why: "Right, 100% sure",
        },
        {
          text: "Differentiate a composite function.",
          word: { text: "Passed" },
          why: "Right, 90% sure",
        },
      ],
      segments: [
        { text: "1. Slopes", word: { text: "Skipped" } },
        { text: "2. Rules", word: { text: "Skipped" } },
      ],
      segmentsSay: "If you finish the unit here",
      skip: "Finish the unit",
      whole: "Teach me the unit anyway",
    });

    const turns = sent(setup.backend).length;
    await step(chat.skipTested(), chat);

    expect(chat.events().slice(-3)).toEqual([
      {
        type: "test_answered",
        skipped: ["slope", "power-rule", "chain-rule"],
      },
      {
        type: "unit_status",
        unit: "passed",
        objectives: {
          slope: "passed",
          "power-rule": "passed",
          "chain-rule": "passed",
        },
      },
      { type: "unit_closed", status: "passed" },
    ]);
    expect(await positionOf()).toBeUndefined();
    expect(sent(setup.backend)).toHaveLength(turns);
    expect(ofType(chat, "assessment").map((e) => e.mode)).toEqual(["test-out"]);
    const stored = await reload().readCourse(COURSE);
    const unit = stored?.curriculum?.units[1];
    if (unit === undefined) throw new Error("No unit.");
    expect(
      unitStatus(unit, await reload().readEvidence(COURSE), undefined),
    ).toBe("passed");
    const done = replay(chat);
    expect(testResultCard(DERIVATIVE_PLAN, resultOf(done)).answered).toBe(
      "Finished without teaching.",
    );
    expect(finishedByTest(done)).toBe(true);
    expect(nextStep(done)).toBe("leave");
    expect(whereInUnit(DERIVATIVE_PLAN, done.position, done.finished)).toEqual({
      label: "Finished",
      ticks: ["skip", "skip"],
    });
  },
  MANY_TURNS_MS,
);

test(
  "every objective passed, the learner has the whole unit taught: from its first segment, told what passed, and the check asks a passed objective once",
  async () => {
    await makeCourse();
    const setup = setUp();
    const chat = await testOut(setup);
    for (const confidence of ["90", "100", "90"] as const) {
      await answer(chat, "A", confidence);
    }

    await step(chat.teachWhole(), chat);

    expect(ofType(chat, "test_answered")).toEqual([
      { type: "test_answered", skipped: [] },
    ]);
    expect(await positionOf()).toEqual({ segment: 0, phase: "discuss" });
    expect(sent(setup.backend).at(-1)).toBe(
      '[Unit 2 of 2, "The derivative"; segment 1 of 2, "Slopes", on "slope". Phase: teach. Start of the segment. ' +
        'The learner chose to be taught the whole unit, though the test passed "slope", "power-rule" and "chain-rule": ' +
        "teach every segment as planned. What passed stays passed, and the check asks each objective at least once. " +
        "Allowed now: teach the segment's objectives in this turn, within the length the style sets, then stop; " +
        'the learner can ask anything next. No questions yet: ask_question is refused until the learner presses "ready".]\n' +
        "Teach these objectives:\n" +
        '- "slope": Read a derivative as a tangent\'s slope.',
    );
    const timeline = replay(chat);
    expect(timeline.testWaits).toBe(false);
    expect(testResultCard(DERIVATIVE_PLAN, resultOf(timeline)).answered).toBe(
      "Teaching the whole unit.",
    );
    expect(nextStep(timeline)).toBe("ready");

    // The check asks the objective the test passed, once.
    await step(chat.ready(), chat);
    expect(lastQuestion(chat).assessment).toBeUndefined();
    expect(sent(setup.backend).at(-1)).toContain(
      'a question on "slope" with ask_question',
    );
    await answer(chat, "A", "75");
    expect(await positionOf()).toEqual({ segment: 0, phase: "closed" });
    // Its next segment is taught whole too.
    await step(chat.nextSegment(), chat);
    expect(await positionOf()).toMatchObject({ segment: 1 });
    expect(sent(setup.backend).at(-1)).toContain(
      'segment 2 of 2, "Rules", on "power-rule" and "chain-rule". Phase: teach.',
    );
  },
  MANY_TURNS_MS,
);

// --- A partial result --------------------------------------------------------------

test(
  "a partial result skips nothing while its card waits, across a restart too; then a segment is skipped, and one of two objectives teaches and checks the other",
  async () => {
    await makeCourse();
    const first = setUp();
    const before = await testOut(first);
    await answer(before, "A", "90");
    await answer(before, "A", "100");
    // A miss ends its objective's questions, with no detour.
    await answer(before, "B", "75");
    expect(ofType(before, "detour")).toEqual([]);
    expect(
      objectiveStatus(await reload().readEvidence(COURSE), "chain-rule"),
    ).toBe("attempted");
    const card = testResultCard(DERIVATIVE_PLAN, resultOf(replay(before)));
    expect(card).toMatchObject({
      says: { text: "Two of three passed", className: "dk" },
      objectives: [
        { word: { text: "Passed" }, why: "Right, 90% sure" },
        { word: { text: "Passed" }, why: "Right, 100% sure" },
        { word: { text: "Not passed" }, why: "Missed" },
      ],
      segments: [
        { text: "1. Slopes", word: { text: "Skipped" } },
        {
          text: "2. Rules",
          word: { text: "Taught in part" },
          why: "Only: Differentiate a composite function.",
        },
      ],
      segmentsSay: "If you skip what you passed",
      skip: "Skip what I passed",
      whole: "Teach me the whole unit",
    });
    await first.units.close();

    // A restart while the card waits, in a later sitting: it is shown
    // again, no review comes before it, nothing is sent, and nothing is
    // skipped.
    const second = setUp(tutor(), LATER);
    const chat = await open(second);
    expect(sent(second.backend)).toEqual([]);
    expect(ofType(chat, "assessment").map((e) => e.mode)).toEqual(["test-out"]);
    expect((await reload().readCourse(COURSE))?.course.reviewOfferedAt).toBe(
      NOW,
    );
    expect(await positionOf()).toEqual({
      segment: 0,
      phase: "teach",
      testOut: { stage: "result" },
    });
    const reopened = replay(chat);
    expect(reopened.items.filter((i) => i.kind === "test_result")).toHaveLength(
      1,
    );
    expect(reopened.testWaits).toBe(true);
    expect(nextStep(reopened)).toBeNull();
    // A message on the card is answered, and teaches nothing.
    await step(Promise.resolve(chat.say("What now?")), chat);
    expect(sent(second.backend).at(-1)).toContain(
      "The test before the unit is over, and its result card waits for the learner, who chooses to skip what it passed or to be taught the whole unit; " +
        "the teaching waits until they do. Message from the learner. " +
        "Allowed now: reply to the learner, without teaching and without pressing them either way. No teaching tools until they answer the card.",
    );
    expect(await positionOf()).toMatchObject({ testOut: { stage: "result" } });

    await step(chat.skipTested(), chat);

    expect(await positionOf()).toEqual({
      segment: 1,
      phase: "discuss",
      testOut: { stage: "skip", passed: ["slope", "power-rule"] },
    });
    expect(ofType(chat, "test_answered")).toEqual([
      { type: "test_answered", skipped: ["slope", "power-rule"] },
    ]);
    expect(ofType(chat, "phase").at(-2)).toEqual({
      type: "phase",
      segment: 1,
      phase: "teach",
      skipping: ["slope", "power-rule"],
    });
    expect(sent(second.backend).at(-1)).toBe(
      '[Unit 2 of 2, "The derivative"; segment 2 of 2, "Rules", on "chain-rule" (leaving out "power-rule", passed in the test before the unit). Phase: teach. Start of the segment. ' +
        'The learner chose to skip what the test passed: "slope" and "power-rule". Segment 1 is skipped, and teaching starts at segment 2. ' +
        "A segment that has an objective they passed teaches and checks only the other. " +
        "Allowed now: teach the segment's objectives in this turn, within the length the style sets, then stop; " +
        'the learner can ask anything next. No questions yet: ask_question is refused until the learner presses "ready".]\n' +
        "Teach these objectives:\n" +
        '- "chain-rule": Differentiate a composite function.\n\n' +
        'Leave out "power-rule": the learner passed it in the test before the unit and chose to skip it. ' +
        "Build on it where that helps, but do not teach it; the check does not ask about it.",
    );
    const timeline = replay(chat);
    expect(outline(DERIVATIVE_PLAN, timeline.position, null)).toEqual([
      { title: "Slopes", state: "skip", note: "Skipped: passed in the test" },
      {
        title: "Rules",
        state: "now",
        note: "Only: Differentiate a composite function.",
      },
    ]);
    expect(whereInUnit(DERIVATIVE_PLAN, timeline.position, null)).toEqual({
      label: "Segment 2 of 2",
      ticks: ["skip", "now"],
    });
    expect(testResultCard(DERIVATIVE_PLAN, resultOf(timeline))).toMatchObject({
      answered: "Skipping what you passed.",
      startsAt:
        "Teaching starts at segment 2, which leaves out what you passed in it. The outline, at the top right, shows what is skipped.",
    });

    // The check asks only the objective taught.
    await step(chat.ready(), chat);
    expect(sent(second.backend).at(-1)).toContain(
      'In this check, "chain-rule": not asked yet. Allowed now: post a question on "chain-rule" with ask_question',
    );
    expect(lastQuestion(chat)).toMatchObject({ number: 1 });
  },
  MANY_TURNS_MS,
);

test(
  "the unit's gate, after the segments taught, leaves out what the test passed",
  async () => {
    await makeCourse();
    const setup = setUp();
    const chat = await testOut(setup);
    await answer(chat, "A", "90");
    await answer(chat, "A", "100");
    await answer(chat, "B", "75");
    await step(chat.skipTested(), chat);
    await step(chat.ready(), chat);

    // The last segment taught closes, every objective passed: the gate's card.
    await answer(chat, "A", "90");

    expect(await positionOf()).toEqual({
      segment: 1,
      phase: "closed",
      testOut: { stage: "skip", passed: ["slope", "power-rule"] },
      assessment: {
        mode: "gate",
        stage: "offered",
        objectives: [
          { unit: "derivative", objective: "chain-rule" },
          { unit: "limits", objective: "limit-value" },
          { unit: "limits", objective: "one-sided" },
        ],
      },
      gated: true,
    });
    expect(nextStep(replay(chat))).toBeNull();
  },
  MANY_TURNS_MS,
);

test(
  "a later segment's start leaves out what the test passed in it",
  async () => {
    // "power-rule" passed, "slope" and "chain-rule" not: segment 1 is taught
    // whole, and segment 2 teaches "chain-rule" only.
    await makeCourse();
    const setup = setUp();
    const chat = await testOut(setup);
    await answer(chat, "B", "90");
    await answer(chat, "A", "100");
    await answer(chat, "B", "90");
    await step(chat.skipTested(), chat);
    expect(await positionOf()).toEqual({
      segment: 0,
      phase: "discuss",
      testOut: { stage: "skip", passed: ["power-rule"] },
    });
    expect(ofType(chat, "phase").at(-1)).toEqual({
      type: "phase",
      segment: 0,
      phase: "discuss",
      skipping: ["power-rule"],
    });
    await step(chat.ready(), chat);
    await answer(chat, "A", "90");
    expect(nextStep(replay(chat))).toBe("next-segment");

    await step(chat.nextSegment(), chat);

    expect(await positionOf()).toEqual({
      segment: 1,
      phase: "discuss",
      testOut: { stage: "skip", passed: ["power-rule"] },
    });
    expect(sent(setup.backend).at(-1)).toContain(
      'segment 2 of 2, "Rules", on "chain-rule" (leaving out "power-rule", passed in the test before the unit). Phase: teach.',
    );
  },
  MANY_TURNS_MS,
);

test(
  "a skipped last segment: the unit's end comes when the segment before it closes",
  async () => {
    // "slope" not passed; both of segment 2's passed.
    await makeCourse();
    const setup = setUp();
    const chat = await testOut(setup);
    await answer(chat, "B", "90");
    await answer(chat, "A", "100");
    await answer(chat, "A", "90");
    await step(chat.skipTested(), chat);
    expect(await positionOf()).toMatchObject({ segment: 0, phase: "discuss" });
    expect(
      whereInUnit(DERIVATIVE_PLAN, replay(chat).position, null)?.ticks,
    ).toEqual(["now", "skip"]);
    await step(chat.ready(), chat);
    await answer(chat, "A", "90");

    // Every objective passed: the gate's card, on what the test did not pass.
    expect(await positionOf()).toMatchObject({
      segment: 0,
      phase: "closed",
      assessment: {
        mode: "gate",
        stage: "offered",
        objectives: [
          { unit: "derivative", objective: "slope" },
          { unit: "limits", objective: "limit-value" },
          { unit: "limits", objective: "one-sided" },
        ],
      },
    });
    expect(nextStep(replay(chat))).toBeNull();
    expect(await chat.nextSegment()).toEqual({
      ok: false,
      status: 409,
      error: "Start or skip the gate first.",
    });
  },
  MANY_TURNS_MS,
);

// --- The test's rules --------------------------------------------------------------

test(
  "an unsure correct answer gets a second question at once; a miss opens no detour, and one confident correct answer in the segment's check then passes",
  async () => {
    await makeCourse();
    const setup = setUp();
    const chat = await testOut(setup);

    await answer(chat, "A", "75");
    expect(sent(setup.backend).at(-1)).toContain(
      'In this test, "slope": answered correctly, which does not pass alone, so a second question follows; ' +
        '"power-rule": not asked yet; "chain-rule": not asked yet. Allowed now: a question on "slope" with ask_question, ' +
        "unlike the ones asked before, and unlike the one just answered: the same objective asked another way, and nothing else",
    );
    expect(lastQuestion(chat)).toMatchObject({
      number: 2,
      assessment: { of: 3, objective: 1, second: true },
    });
    // Two correct answers to different questions pass, at any confidence.
    await answer(chat, "A", "50");
    expect(lastQuestion(chat)).toMatchObject({
      number: 3,
      assessment: { of: 3, objective: 2 },
    });
    // "I don't know" is not counted as a miss, and opens no detour.
    await answer(chat, null);
    expect(ofType(chat, "detour")).toEqual([]);
    expect((await positionOf())?.detour).toBeUndefined();
    expect(sent(setup.backend).at(-1)).toContain(
      `The learner answered "I don't know".`,
    );
    await answer(chat, "B", "90");

    const evidence = await reload().readEvidence(COURSE);
    expect(objectiveStatus(evidence, "slope")).toBe("passed");
    expect(objectiveStatus(evidence, "power-rule")).toBe("attempted");
    expect(
      testResultCard(DERIVATIVE_PLAN, resultOf(replay(chat))).objectives.map(
        (r) => r.why,
      ),
    ).toEqual(["Right twice, 75% and 50% sure", "Did not know", "Missed"]);

    // Segment 1 is skipped; segment 2 is taught whole.
    await step(chat.skipTested(), chat);
    expect(await positionOf()).toMatchObject({ segment: 1, phase: "discuss" });
    await step(chat.ready(), chat);
    expect(lastQuestion(chat)).toMatchObject({ number: 1 });
    expect(sent(setup.backend).at(-1)).toContain(
      'a question on "power-rule" and "chain-rule" with ask_question',
    );
    // One confident correct answer passes "power-rule": the test's miss does not count.
    const posted = lastQuestion(chat);
    await answer(chat, "A", "90");
    expect(
      objectiveStatus(await reload().readEvidence(COURSE), "power-rule"),
    ).toBe("passed");
    expect(sent(setup.backend).at(-1)).toContain('"power-rule": passed');
    expect(posted.prompt).toContain("power-rule");
  },
  MANY_TURNS_MS,
);

test(
  '"Start learning instead" partway withdraws the open question; the tutor says what the test showed, then the card, which with nothing passed only starts the unit',
  async () => {
    await makeCourse();
    const setup = setUp();
    const chat = await testOut(setup);
    await answer(chat, "A", "75");
    const withdrawn = lastQuestion(chat);
    expect(replay(chat).assessment?.mode).toBe("test-out");
    expect(nextStep(replay(chat))).toBe("assessment");

    await step(chat.skipAssessment(), chat);

    expect(sent(setup.backend).at(-1)).toBe(
      '[Unit 2 of 2, "The derivative"; segment 1 of 2, "Slopes", on "slope". Phase: teach. ' +
        "The test before the unit is over, and its result card waits for the learner, who chooses to skip what it passed or to be taught the whole unit; the teaching waits until they do. " +
        'The learner pressed "Start learning instead", which ends the test; question 2 was withdrawn, with nothing recorded. ' +
        'What it showed: "slope" not passed (correct at 75%); "power-rule" not passed (not asked); "chain-rule" not passed (not asked). ' +
        "Allowed now, as text, with no tool: say in a few sentences what the test showed, what the learner has and what it did not show, which is where you would teach. " +
        "No teaching yet, and no going over single answers. The learner then sees a card with what passed and what skipping it would skip, and chooses: " +
        "to skip what passed, or to be taught the whole unit. Do not press them either way.]",
    );
    // The tutor's word on the test, then its card.
    expect(
      chat
        .events()
        .slice(-5)
        .map((e) => e.type),
    ).toEqual([
      "assessment_end",
      "turn_start",
      "tutor_text",
      "turn_end",
      "test_result",
    ]);
    expect(ofType(chat, "assessment_end")).toEqual([
      {
        type: "assessment_end",
        mode: "test-out",
        skipped: true,
        statuses: { slope: "attempted" },
        withdrawnQuestionId: withdrawn.id,
      },
    ]);
    const timeline = replay(chat);
    expect(timeline.items.some((i) => i.kind === "assessment_end")).toBe(false);
    expect(
      timeline.items.find(
        (i) => i.kind === "question" && i.question.id === withdrawn.id,
      ),
    ).toMatchObject({ withdrawn: true });
    const card = testResultCard(DERIVATIVE_PLAN, resultOf(timeline));
    expect(card).toMatchObject({
      says: { text: "None passed" },
      segments: null,
      whole: "Start the unit",
    });
    expect(card.objectives[0]?.why).toBe(
      "Right once, 75% sure; its second question was not asked",
    );
    expect(card.objectives[1]?.why).toBe("Not asked");

    expect(await chat.skipTested()).toEqual({
      ok: false,
      status: 409,
      error:
        "The test passed nothing to skip: the unit is taught from its first segment.",
    });
    await step(chat.teachWhole(), chat);
    expect(await positionOf()).toEqual({ segment: 0, phase: "discuss" });
    expect(sent(setup.backend).at(-1)).toContain(
      "The test passed nothing, so the unit is taught as planned, from its first segment.",
    );
  },
  MANY_TURNS_MS,
);

// --- Restarts and what comes first -----------------------------------------------

test(
  "a restart in the test shows its open question again, and one with nothing open asks on",
  async () => {
    await makeCourse();
    // The turn after the second answer posts nothing before the server stops.
    const first = setUp(
      tutor((text) => text.includes("The learner answered question 2.")),
    );
    const before = await testOut(first);
    await answer(before, "A", "90");
    const open2 = lastQuestion(before);
    await first.units.close();

    const second = setUp(
      tutor((text) => text.includes("The learner answered question 2.")),
    );
    const mid = await open(second);
    expect(sent(second.backend)).toEqual([]);
    expect(lastQuestion(mid)).toEqual(open2);
    expect(nextStep(replay(mid))).toBe("assessment");
    await answer(mid, "A", "90");
    expect((await positionOf())?.openQuestion).toBeUndefined();
    await second.units.close();

    const third = setUp();
    const after = await open(third);
    expect(sent(third.backend)[0]).toContain(
      'The test goes on where it was. In this test, "slope": answered correctly; "power-rule": answered correctly; ' +
        '"chain-rule": not asked yet. Allowed now: a question on "chain-rule" with ask_question',
    );
    expect(lastQuestion(after)).toMatchObject({
      number: 3,
      assessment: { of: 3, objective: 3 },
    });
    await answer(after, "A", "90");
    expect(await positionOf()).toMatchObject({ testOut: { stage: "result" } });
  },
  MANY_TURNS_MS,
);

test(
  "a review that is due is offered first; the test waits behind its card, across a restart, and starts once it is skipped",
  async () => {
    await makeCourse({ reviewDue: true });
    const first = setUp();
    const before = await testOut(first);
    expect(await positionOf()).toEqual({
      segment: 0,
      phase: "teach",
      testOut: { stage: "due" },
      assessment: {
        mode: "review",
        stage: "offered",
        objectives: [
          { unit: "limits", objective: "limit-value" },
          { unit: "limits", objective: "one-sided" },
        ],
      },
    });
    expect(sent(first.backend)).toEqual([]);
    expect(ofType(before, "question")).toEqual([]);
    await first.units.close();

    const second = setUp();
    const chat = await open(second);
    expect(sent(second.backend)).toEqual([]);
    await step(chat.skipAssessment(), chat);

    expect(await positionOf()).toEqual({
      segment: 0,
      phase: "teach",
      assessment: { ...TEST_RUN, from: 2 },
      openQuestion: expect.objectContaining({ number: 1, objective: "slope" }),
    });
    expect(sent(second.backend)).toHaveLength(1);
    expect(sent(second.backend)[0]).toContain(
      "The learner chose to test out of this unit before it is taught",
    );
    expect(lastQuestion(chat)).toMatchObject({
      assessment: { of: 3, objective: 1 },
    });
    expect(
      sent(second.backend).some((t) => t.includes("Allowed now: teach")),
    ).toBe(false);
  },
  MANY_TURNS_MS,
);

test(
  "a test chosen for a unit whose planning failed is not kept: Start, opened again, teaches the unit",
  async () => {
    await makeCourse({ planned: false });
    let plans = false;
    const base = tutor();
    const setup = setUp((turn, session) =>
      !plans && session.tools.some((t) => t.name === "plan_unit")
        ? [{ text: "No plan." }]
        : base(turn, session),
    );
    const failed = await testOut(setup);
    expect(ofType(failed, "unit_failed")).toHaveLength(1);
    expect(await positionOf()).toBeUndefined();

    plans = true;
    const chat = await open(setup);

    expect(chat).toBe(failed);
    expect(await positionOf()).toEqual({ segment: 0, phase: "discuss" });
    expect(ofType(chat, "assessment")).toEqual([]);
    expect(sent(setup.backend).at(-1)).toContain("Allowed now: teach");
  },
  MANY_TURNS_MS,
);

test("a unit started or finished is not tested out of", async () => {
  await makeCourse();
  const setup = setUp();
  const started = await setup.units.open(COURSE, "derivative");
  if (!started.ok) throw new Error(started.error);
  await started.chat.settled();
  const refusal = {
    ok: false,
    status: 409,
    error: "This unit has started, so it can no longer be tested out of.",
  };
  expect(
    await setup.units.open(COURSE, "derivative", { testOut: true }),
  ).toEqual(refusal);
  // Unit 1 is finished.
  expect(await setup.units.open(COURSE, "limits", { testOut: true })).toEqual(
    refusal,
  );
  expect(await positionOf()).toEqual({ segment: 0, phase: "discuss" });
});

test(
  "a dispute while the result card waits shows it again with what passed now",
  async () => {
    await makeCourse();
    const setup = setUp();
    const chat = await testOut(setup);
    await answer(chat, "A", "90");
    await answer(chat, "A", "100");
    await answer(chat, "B", "90");
    const missed = lastQuestion(chat);

    expect(
      await chat.recordDispute({
        kind: "dispute",
        recordedAt: NOW,
        questionId: missed.id,
        reason: "B is right too.",
        outcome: { verdict: "correct", reason: "It is.", key: "B" },
      }),
    ).toEqual({ override: undefined });
    await chat.settled();

    const cards = ofType(chat, "test_result");
    expect(cards).toHaveLength(2);
    expect(cards[1]?.objectives[2]).toEqual({
      objective: "chain-rule",
      passed: true,
      answers: [{ verdict: "correct", confidence: "90", assisted: false }],
    });
    const timeline = replay(chat);
    expect(timeline.items.filter((i) => i.kind === "test_result")).toHaveLength(
      1,
    );
    expect(testResultCard(DERIVATIVE_PLAN, resultOf(timeline)).skip).toBe(
      "Finish the unit",
    );
  },
  MANY_TURNS_MS,
);
