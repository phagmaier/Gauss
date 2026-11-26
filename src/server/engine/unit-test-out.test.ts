// Testing out of a unit in a unit chat (task 5.6; docs/brief.md,
// "Assessment modes"): the unit opened for its test, planned
// first; questions with no feedback and no detour, and a second after an
// unsure correct answer; the tutor's word on it and the result card, which
// skips nothing until it is answered; skipping what passed, the whole unit
// taught, "Start learning instead", restarts, a review offered first, the
// gate later leaving out what the test passed, and a misconception an
// answer in it showed. The fake backend's tutor does what each header
// allows.

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import {
  assessmentCard,
  assessmentMarker,
  testResultCard,
} from "../../shared/assessment-view.ts";
import type { CurriculumProposal } from "../../shared/curriculum.ts";
import type { PageEvent } from "../../shared/events.ts";
import type { AnswerEvidence } from "../../shared/evidence.ts";
import type { Plan } from "../../shared/plan.ts";
import type { Confidence } from "../../shared/question.ts";
import {
  emptyTimeline,
  reduce,
  type TestResultItem,
  type Timeline,
} from "../../shared/timeline.ts";
import {
  finishedByTest,
  nextStep,
  outline,
  whereInUnit,
} from "../../web/session.ts";
import { misconceptionHead } from "../../web/what-i-know.ts";
import type { EngineTurn, SessionOptions } from "../backends/backend.ts";
import {
  createFakeBackend,
  type FakeBackend,
  type FakeReply,
  type FakeStep,
  KeptSessions,
} from "../backends/fake.ts";
import { type DataRoot, openDataRoot } from "../record/data-root.ts";
import { objectiveStatus, unitStatus } from "../record/status.ts";
import { whatIKnow } from "../record/what-i-know.ts";
import { givenOrder } from "./choice-order.ts";
import { createFakeTimer } from "./fake-timer.ts";
import { createGrader } from "./grading.ts";
import { createHandoffWriter } from "./handoff.ts";
import { createHelpJudge } from "./help-judge.ts";
import { createUnitChats, type UnitChat } from "./unit-chat.ts";
import { createUnitPlanner } from "./unit-planning.ts";

// Each test gets its own data root; none touches ~/gauss (AGENTS.md).
let dir: string;
let kept: KeptSessions;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "gauss-unit-test-out-"));
  kept = new KeptSessions();
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const NOW = "2026-11-18T12:00:00.000Z";
const YESTERDAY = "2026-11-17T12:00:00.000Z";
/** Two hours on: a new sitting, past the hour since review was offered. */
const LATER = "2026-11-18T14:00:00.000Z";
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

function setUp(
  script = tutor(),
  at = NOW,
  root?: DataRoot,
  /** The handoff writer's replies; without them, the chat has no handoff writer. */
  handoff?: () => FakeReply,
) {
  const backend = createFakeBackend(script, [], { kept });
  const clock = new Date(at);
  const dataRoot = root ?? openDataRoot({ path: dir, now: () => clock });
  const units = createUnitChats({
    backends: { claude: backend },
    systemPrompt: "Tutor.",
    dataRoot,
    planner: createUnitPlanner({
      backends: { claude: backend },
      systemPrompt: "Plan.",
      dataRoot,
    }),
    grader: createGrader({ backend, systemPrompt: "Grade." }),
    judge: createHelpJudge({
      backend: createFakeBackend([]),
      systemPrompt: "Judge.",
    }),
    ...(handoff === undefined
      ? {}
      : {
          handoff: createHandoffWriter({
            backend: createFakeBackend([], handoff),
            systemPrompt: "Handoff.",
          }),
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

/** Resolves once the chat emits an event of this type at or after `from`. */
function waitFor(
  chat: UnitChat,
  type: PageEvent["type"],
  from: number,
): Promise<void> {
  if (chat.events().some((e, i) => i >= from && e.type === type)) {
    return Promise.resolve();
  }
  const { promise, resolve } = Promise.withResolvers<void>();
  const stop = chat.subscribe((event, index) => {
    if (index >= from && event.type === type) {
      stop();
      resolve();
    }
  });
  return promise;
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

test("a unit not started is planned, then tested: a question on each objective, the grade's turn asking for the next with no feedback; every objective passed, the card waits, and finishing the unit takes no teaching and no gate", async () => {
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
          answers: [{ verdict: "correct", confidence: "90", assisted: false }],
        },
        {
          objective: "power-rule",
          passed: true,
          answers: [{ verdict: "correct", confidence: "100", assisted: false }],
        },
        {
          objective: "chain-rule",
          passed: true,
          answers: [{ verdict: "correct", confidence: "90", assisted: false }],
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
  expect(whereInUnit(DERIVATIVE_PLAN, waiting)).toEqual({
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
  await step(chat.skipTested(["slope", "power-rule", "chain-rule"]), chat);

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
  expect(unitStatus(unit, await reload().readEvidence(COURSE), undefined)).toBe(
    "passed",
  );
  const done = replay(chat);
  expect(testResultCard(DERIVATIVE_PLAN, resultOf(done)).answered).toBe(
    "Finished without teaching.",
  );
  expect(finishedByTest(done)).toBe(true);
  expect(nextStep(done)).toBe("leave");
  expect(whereInUnit(DERIVATIVE_PLAN, done)).toEqual({
    label: "Finished",
    ticks: ["skip", "skip"],
  });

  // The record finished the unit, but a crash lost the transcript's last
  // batch. The finished unit still shows what the learner skipped.
  await setup.units.close();
  const [transcript] = await reload().readTranscripts(COURSE, "derivative");
  const events = transcript?.events ?? [];
  const cut = events.findIndex((e) => e.type === "test_answered");
  expect(cut).toBeGreaterThan(0);
  await writeFile(
    join(dir, "courses", COURSE, "sessions", "derivative.1.jsonl"),
    events
      .slice(0, cut)
      .map((e) => `${JSON.stringify(e)}\n`)
      .join(""),
  );
  const restarted = setUp();
  const reopened = replay(await open(restarted));
  expect(testResultCard(DERIVATIVE_PLAN, resultOf(reopened)).answered).toBe(
    "Finished without teaching.",
  );
  expect(finishedByTest(reopened)).toBe(true);
  expect(whereInUnit(DERIVATIVE_PLAN, reopened)).toEqual({
    label: "Finished",
    ticks: ["skip", "skip"],
  });
  expect(sent(restarted.backend)).toEqual([]);
});

test("every objective passed, the learner has the whole unit taught: from its first segment, told what passed, and the check asks a passed objective once", async () => {
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
});

const TESTED_OUT_SAID =
  '[Unit 2 of 2, "The derivative". The unit is finished: every objective passed. ' +
  "The unit was not taught: the learner chose to skip the teaching when the test before it showed every objective passed. " +
  "Message from the learner. Allowed now: reply to the learner. No teaching tools.]\n";

test("a unit finished by skipping what the test passed, every objective, tells its tutor the learner chose to skip the teaching, after a restart too", async () => {
  await makeCourse();
  const first = setUp();
  const chat = await testOut(first);
  for (const confidence of ["90", "100", "90"] as const) {
    await answer(chat, "A", confidence);
  }
  await step(chat.skipTested(["slope", "power-rule", "chain-rule"]), chat);
  expect(ofType(chat, "unit_closed")).toEqual([
    { type: "unit_closed", status: "passed" },
  ]);

  await step(chat.say("Thanks!"), chat);
  expect(sent(first.backend).at(-1)).toBe(`${TESTED_OUT_SAID}Thanks!`);
  await first.units.close();

  const second = setUp();
  const reopened = await open(second);
  await step(reopened.say("Back again."), reopened);
  expect(sent(second.backend)).toEqual([`${TESTED_OUT_SAID}Back again.`]);
});

test.each(["whole", "partial skip"] as const)(
  "reopening after a saved %s choice with no transcript record settles the test and heads the lesson",
  async (choice) => {
    const root = await makeCourse();
    const first = setUp();
    const before = await testOut(first);
    await answer(before, "B");
    await answer(before, "A");
    await answer(before, "B");
    await first.units.close();

    // The choice reached state.json, but not the transcript. Both choices
    // start at segment 1, the same position the chat opened the test in.
    const skipped = choice === "whole" ? [] : ["power-rule"];
    await root.writePosition(COURSE, "derivative", {
      segment: 0,
      phase: "teach",
      ...(skipped.length === 0
        ? {}
        : { testOut: { stage: "skip", passed: skipped } }),
    });

    const restarted = setUp();
    const timeline = replay(await open(restarted));
    expect(timeline.testWaits).toBe(false);
    expect(resultOf(timeline).skipped).toEqual(skipped);
    const lesson = timeline.items.flatMap((item) => {
      if (item.kind === "test_result") return ["result"];
      if (item.kind === "phase" && item.heading !== undefined) {
        return [`${item.heading}:${item.phase}`];
      }
      if (item.kind === "tutor" && item.text === "Teaching.") {
        return [item.text];
      }
      return [];
    });
    expect(lesson).toEqual(["result", "segment-1:teach", "Teaching."]);
  },
);

// --- A partial result --------------------------------------------------------------

test("a partial result skips nothing while its card waits, across a restart too; then a segment is skipped, and one of two objectives teaches and checks the other", async () => {
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
  expect((await reload().readCourse(COURSE))?.course.reviewOfferedAt).toBe(NOW);
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
  await step(chat.say("What now?"), chat);
  expect(sent(second.backend).at(-1)).toContain(
    "The test before the unit is over, and its result card waits for the learner, who chooses to skip what it passed or to be taught the whole unit; " +
      "the teaching waits until they do. Message from the learner. " +
      "Allowed now: reply to the learner, without teaching and without pressing them either way. No teaching tools until they answer the card.",
  );
  expect(await positionOf()).toMatchObject({ testOut: { stage: "result" } });

  await step(chat.skipTested(["slope", "power-rule"]), chat);

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
  expect(outline(DERIVATIVE_PLAN, timeline).segments).toMatchObject([
    {
      title: "Slopes",
      state: "skip",
      says: "Passed in the test",
      objectives: [{ id: "slope", skipped: true }],
    },
    {
      title: "Rules",
      state: "now",
      heading: "segment-2",
      objectives: [
        { id: "power-rule", skipped: true, current: false },
        { id: "chain-rule", skipped: false, current: true },
      ],
    },
  ]);
  expect(whereInUnit(DERIVATIVE_PLAN, timeline)).toEqual({
    label: "Segment 2 of 2",
    title: "Rules",
    ticks: ["skip", "now"],
  });
  expect(testResultCard(DERIVATIVE_PLAN, resultOf(timeline))).toMatchObject({
    answered: "Skipping what you passed.",
    startsAt:
      "Teaching starts at segment 2, which leaves out what you passed in it.",
  });

  // The check asks only the objective taught.
  await step(chat.ready(), chat);
  expect(sent(second.backend).at(-1)).toContain(
    'In this check, "chain-rule": not asked yet. Allowed now: post a question on "chain-rule" with ask_question',
  );
  expect(lastQuestion(chat)).toMatchObject({ number: 1 });
});

test("the unit's gate, after the segments taught, leaves out what the test passed; skipped, the unit finishes taught, and its tutor is not told the teaching was skipped", async () => {
  await makeCourse();
  const setup = setUp();
  const chat = await testOut(setup);
  await answer(chat, "A", "90");
  await answer(chat, "A", "100");
  await answer(chat, "B", "75");
  await step(chat.skipTested(["slope", "power-rule"]), chat);
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

  await step(chat.skipAssessment(), chat);
  expect(ofType(chat, "unit_closed")).toEqual([
    { type: "unit_closed", status: "passed" },
  ]);
  await step(chat.say("Thanks!"), chat);
  expect(sent(setup.backend).at(-1)).toBe(
    '[Unit 2 of 2, "The derivative". The unit is finished: every objective passed. ' +
      "Message from the learner. Allowed now: reply to the learner. No teaching tools.]\nThanks!",
  );
});

test("a later segment's start leaves out what the test passed in it", async () => {
  // "power-rule" passed, "slope" and "chain-rule" not: segment 1 is taught
  // whole, and segment 2 teaches "chain-rule" only.
  await makeCourse();
  const setup = setUp();
  const chat = await testOut(setup);
  await answer(chat, "B", "90");
  await answer(chat, "A", "100");
  await answer(chat, "B", "90");
  await step(chat.skipTested(["power-rule"]), chat);
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
});

test("a skipped last segment: the unit's end comes when the segment before it closes", async () => {
  // "slope" not passed; both of segment 2's passed.
  await makeCourse();
  const setup = setUp();
  const chat = await testOut(setup);
  await answer(chat, "B", "90");
  await answer(chat, "A", "100");
  await answer(chat, "A", "90");
  await step(chat.skipTested(["power-rule", "chain-rule"]), chat);
  expect(await positionOf()).toMatchObject({ segment: 0, phase: "discuss" });
  expect(whereInUnit(DERIVATIVE_PLAN, replay(chat))?.ticks).toEqual([
    "now",
    "skip",
  ]);
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
});

// --- The test's rules --------------------------------------------------------------

test("an unsure correct answer gets a second question at once; a miss opens no detour, and one confident correct answer in the segment's check then passes", async () => {
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
  await step(chat.skipTested(["slope"]), chat);
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
});

test("a misconception the handoff writer quotes from a test answer is found in the test, and one quoted from the discussion after it is found in the discussion", async () => {
  await makeCourse();
  const slope = {
    objective: "slope",
    actually: "It is the limit of the slopes of secants.",
  };
  let calls = 0;
  const setup = setUp(tutor(), NOW, undefined, () => {
    calls += 1;
    return {
      output: {
        note: `Note ${calls}.`,
        misconceptions:
          calls > 1
            ? []
            : [
                {
                  ...slope,
                  believed: "A tangent's slope is an average rate.",
                  words: "the average rate over an interval",
                },
                {
                  ...slope,
                  believed: "A tangent's slope is taken between two points.",
                  words: "rise over the run between two points",
                },
              ],
      },
    };
  });
  const chat = await testOut(setup);

  // The test: "slope" missed, with its reasoning; the others passed.
  await step(
    chat.answer({
      kind: "choice",
      questionId: lastQuestion(chat).id,
      choice: "B",
      confidence: "75",
      reasoning: "A tangent's slope is the average rate over an interval.",
    }),
    chat,
  );
  await answer(chat, "A", "90");
  await answer(chat, "A", "90");
  expect(ofType(chat, "detour")).toEqual([]);

  // Segment 1 taught: a message in its discussion, then its check, which
  // passes and closes it, so the writer reads the test and the segment.
  await step(chat.skipTested(["power-rule", "chain-rule"]), chat);
  await step(
    chat.say("So it is the rise over the run between two points?"),
    chat,
  );
  await step(chat.ready(), chat);
  await answer(chat, "A", "90");
  expect(calls).toBe(1);

  const root = reload();
  expect(
    (await root.readMisconceptions(COURSE)).map((m) => [m.words, m.where]),
  ).toEqual([
    ["the average rate over an interval", { in: "test" }],
    ["rise over the run between two points", { in: "discussion" }],
  ]);
  const view = whatIKnow(
    CURRICULUM.title,
    (await root.readCourse(COURSE))?.curriculum ?? {
      approval: { status: "draft" },
      units: [],
    },
    await root.readState(COURSE),
    await root.readEvidence(COURSE),
    await root.readMisconceptions(COURSE),
  );
  const known = view.units[1]?.objectives?.find((o) => o.id === "slope");
  if (known === undefined) throw new Error('No "slope" in "What I know".');
  expect(
    known.misconceptions.map(
      (m) =>
        misconceptionHead(m, known.status, {
          id: "derivative",
          number: (id) => view.units.find((u) => u.id === id)?.number,
        }).found,
    ),
  ).toEqual([
    "Found 18 November 2026, in the test",
    "Found 18 November 2026, in the discussion",
  ]);
  await setup.units.close();
});

test('"Start learning instead" partway withdraws the open question; the tutor says what the test showed, then the card, which with nothing passed only starts the unit', async () => {
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

  expect(await chat.skipTested([])).toEqual({
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
});

// --- Restarts and what comes first -----------------------------------------------

test("a restart in the test shows its open question again, and one with nothing open asks on", async () => {
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
});

test("a restart after saving the last test answer but before closing its question summarizes once", async () => {
  await makeCourse();
  const first = setUp();
  const before = await testOut(first);
  await answer(before, "A");
  await answer(before, "A");
  await first.units.close();
  const root = reload();
  const pending = (await root.readState(COURSE)).units.derivative?.openQuestion;
  if (pending === undefined) throw new Error("No last question.");
  await root.appendEvidence(COURSE, {
    ...correct("chain-rule", NOW),
    question: pending.question,
    answer: {
      kind: "choice",
      questionId: pending.id,
      choice: "A",
      confidence: "90",
    },
    assessment: { mode: "test-out", unit: "derivative" },
  });

  const restarted = setUp();
  const chat = await open(restarted);
  expect(sent(restarted.backend)).toHaveLength(1);
  expect(ofType(chat, "test_result")).toHaveLength(1);
  expect(ofType(chat, "test_result")[0]?.objectives).toMatchObject([
    { objective: "slope", passed: true },
    { objective: "power-rule", passed: true },
    { objective: "chain-rule", passed: true },
  ]);
});

test('"Start learning instead", then a restart that cuts off the tutor\'s word on the test: reopening asks for it again, saying what the learner pressed and that the card shows already', async () => {
  await makeCourse();
  const script = tutor();
  const first = setUp((turn, session) =>
    turn.text.includes("What it showed: ")
      ? [{ text: "The test showed" }, { hold: true }]
      : script(turn, session),
  );
  const before = await testOut(first);
  await answer(before, "A", "75");
  const from = before.events().length;
  expect(await before.skipAssessment()).toEqual({ ok: true });
  await waitFor(before, "tutor_text", from);
  // The server stops while the tutor is saying it; the card the turn's
  // end shows is in the thread.
  await first.units.close();
  expect(ofType(before, "test_result")).toHaveLength(1);
  expect(await positionOf()).toMatchObject({
    testOut: { stage: "result", stopped: { withdrawn: 2 }, summaryOwed: true },
  });

  const second = setUp();
  const after = await open(second);
  expect(sent(second.backend)).toHaveLength(1);
  expect(sent(second.backend)[0]).toContain(
    'The learner pressed "Start learning instead", which ends the test; question 2 was withdrawn, with nothing recorded. ' +
      "The learner has not heard from you what the test showed: your turn on it did not complete. " +
      'What it showed: "slope" not passed (correct at 75%);',
  );
  expect(after.events().at(-1)?.type).toBe("test_result");
  expect((await positionOf())?.testOut).toEqual({
    stage: "result",
    stopped: { withdrawn: 2 },
  });
});

/**
 * Every objective passed, but the turn with the last answer's grade, which
 * asks what the test showed, fails: the tutor cannot be reached once the
 * server restarted with the last question open.
 */
async function failedSummary() {
  await makeCourse();
  const first = setUp();
  const before = await testOut(first);
  await answer(before, "A", "90");
  await answer(before, "A", "100");
  await first.units.close();

  const setup = setUp();
  const reach = setup.backend.startSession;
  setup.backend.startSession = () =>
    Promise.reject(new Error("The tutor cannot be reached."));
  const chat = await open(setup);
  await answer(chat, "A", "90");
  expect(sent(setup.backend)).toEqual([]);
  expect(ofType(chat, "turn_end").at(-1)).toMatchObject({ outcome: "error" });
  // The card shows at once; the tutor's word on the test is still owed.
  expect(ofType(chat, "test_result")).toHaveLength(1);
  expect(await positionOf()).toEqual({
    segment: 0,
    phase: "teach",
    testOut: { stage: "result", summaryOwed: true },
  });
  setup.backend.startSession = reach;
  return { setup, chat };
}

const SHOWED =
  'What it showed: "slope" passed (correct at 90%); "power-rule" passed (correct at 100%); "chain-rule" passed (correct at 90%).';

test("the tutor's word on the test, when its turn fails, is asked for by the learner's next message, with what the test showed, and not by the one after", async () => {
  const { setup, chat } = await failedSummary();

  await step(chat.say("What now?"), chat);
  await step(chat.say("And then?"), chat);

  const [asked, after] = sent(setup.backend);
  expect(asked).toContain(
    "the teaching waits until they do. Message from the learner. " +
      "The learner has not heard from you what the test showed: your turn on it did not complete. " +
      `${SHOWED} Allowed now, as text, with no tool: first say in a few sentences what the test showed, ` +
      "what the learner has and what it did not show, which is where you would teach; then reply to the learner, if they wrote. " +
      "No teaching yet, and no going over single answers. The learner chooses on the result card, already shown: " +
      "to skip what passed, or to be taught the whole unit. Do not press them either way.]\nWhat now?",
  );
  expect(after).toContain(
    "Message from the learner. Allowed now: reply to the learner, without teaching and without pressing them either way.",
  );
  expect(after).not.toContain("What it showed: ");
  expect(await positionOf()).toEqual({
    segment: 0,
    phase: "teach",
    testOut: { stage: "result" },
  });
  expect(ofType(chat, "test_result")).toHaveLength(1);
});

test("the tutor's word on the test, when its turn fails and a restart comes, is asked for on reopening, told the card is shown already, and only once", async () => {
  const { setup } = await failedSummary();
  await setup.units.close();

  const restarted = setUp();
  const chat = await open(restarted);
  expect(sent(restarted.backend)).toHaveLength(1);
  expect(sent(restarted.backend)[0]).toContain(
    "a restart came before you said what it showed. " +
      "The learner has not heard from you what the test showed: your turn on it did not complete. " +
      `${SHOWED} Allowed now, as text, with no tool: first say in a few sentences what the test showed`,
  );
  expect(sent(restarted.backend)[0]).toContain(
    "The learner chooses on the result card, already shown",
  );
  expect(
    chat
      .events()
      .slice(-4)
      .map((e) => e.type),
  ).toEqual(["turn_start", "tutor_text", "turn_end", "test_result"]);
  expect(await positionOf()).toMatchObject({ testOut: { stage: "result" } });
  expect((await positionOf())?.testOut).not.toHaveProperty("summaryOwed");

  await step(chat.say("What now?"), chat);
  expect(sent(restarted.backend)[1]).not.toContain("What it showed: ");
});

test("the tutor's word on the test, stopped once its turn was sent, is not asked for again", async () => {
  await makeCourse();
  let held = false;
  const script = tutor();
  const setup = setUp((turn, session) => {
    if (!held && turn.text.includes("What it showed: ")) {
      held = true;
      return [{ text: "The test showed" }, { hold: true }];
    }
    return script(turn, session);
  });
  const chat = await testOut(setup);
  await answer(chat, "A", "90");
  await answer(chat, "A", "100");
  const from = chat.events().length;
  const questionId = lastQuestion(chat).id;
  expect(
    await chat.answer({
      kind: "choice",
      questionId,
      choice: "A",
      confidence: "90",
    }),
  ).toEqual({ ok: true });
  await waitFor(chat, "tutor_text", from);
  await chat.interrupt();
  await chat.settled();
  expect(ofType(chat, "turn_end").at(-1)).toMatchObject({
    outcome: "interrupted",
  });
  expect(ofType(chat, "test_result")).toHaveLength(1);
  expect(await positionOf()).toEqual({
    segment: 0,
    phase: "teach",
    testOut: { stage: "result" },
  });

  await step(chat.say("What now?"), chat);
  expect(sent(setup.backend).at(-1)).not.toContain("What it showed: ");
});

test("a message sent with the test's last answer, queued ahead of the turn asking what the test showed, does not ask for it too: the tutor is asked once", async () => {
  await makeCourse();
  const setup = setUp();
  const chat = await testOut(setup);
  await answer(chat, "A", "90");
  await answer(chat, "A", "100");
  const questionId = lastQuestion(chat).id;
  const answering = chat.answer({
    kind: "choice",
    questionId,
    choice: "A",
    confidence: "90",
  });
  expect(await chat.say("Is that all?")).toEqual({ ok: true });
  expect(await answering).toEqual({ ok: true });
  await chat.settled();

  const turns = sent(setup.backend);
  const message = turns.find((t) => t.endsWith("\nIs that all?")) ?? "";
  expect(message).toContain("Message from the learner.");
  expect(message).not.toContain("What it showed: ");
  expect(turns.filter((t) => t.includes("What it showed: "))).toHaveLength(1);
  expect(await positionOf()).toEqual({
    segment: 0,
    phase: "teach",
    testOut: { stage: "result" },
  });
  expect(chat.events().at(-1)?.type).toBe("test_result");
});

test("the learner's answer to the result card, when the turn carrying it failed before it was sent and a restart came, is told in the first header after reopening, once", async () => {
  await makeCourse();
  const first = setUp();
  const before = await testOut(first);
  for (const confidence of ["90", "100", "90"] as const) {
    await answer(before, "A", confidence);
  }
  await first.units.close();

  // The tutor cannot be reached, so the teaching turn fails before it is
  // sent; then the server stops.
  const middle = setUp();
  middle.backend.startSession = () =>
    Promise.reject(new Error("The tutor cannot be reached."));
  const down = await open(middle);
  await step(down.teachWhole(), down);
  expect(sent(middle.backend)).toEqual([]);
  expect(ofType(down, "turn_end").at(-1)).toMatchObject({ outcome: "error" });
  await middle.units.close();

  const last = setUp();
  const after = await open(last);
  expect(sent(last.backend)).toEqual([]);
  await step(after.say("Shall we start?"), after);
  await step(after.say("Go on."), after);
  const told =
    'The learner chose to be taught the whole unit, though the test passed "slope", "power-rule" and "chain-rule"';
  expect(sent(last.backend).map((text) => text.includes(told))).toEqual([
    true,
    false,
  ]);
});

test("a review that is due is offered first; the test waits behind its card, across a restart, and starts once it is skipped; the page puts the test, not the first segment, after the review", async () => {
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
  expect(replay(before).items.some((item) => item.kind === "phase")).toBe(
    false,
  );
  // No segment is reached, and the card names the test as what follows.
  const held = (chat: UnitChat) => {
    const timeline = replay(chat);
    const card = timeline.items.findLast((i) => i.kind === "assessment");
    if (card?.kind !== "assessment") throw new Error("No review card.");
    return { top: whereInUnit(DERIVATIVE_PLAN, timeline), card };
  };
  expect(held(before).top).toEqual({ label: "Testing out", ticks: ["", ""] });
  expect(assessmentCard(held(before).card).says[1]).toBe(
    "The test of this unit follows, before anything is taught.",
  );
  await first.units.close();

  const second = setUp();
  const chat = await open(second);
  expect(sent(second.backend)).toEqual([]);
  expect(replay(chat).items.some((item) => item.kind === "phase")).toBe(false);
  expect(held(chat).top).toEqual({ label: "Testing out", ticks: ["", ""] });
  expect(assessmentCard(held(chat).card).says[1]).toBe(
    "The test of this unit follows, before anything is taught.",
  );
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
  const skipped = replay(chat).items.find(
    (i) => i.kind === "assessment" && i.mode === "review",
  );
  if (skipped?.kind !== "assessment") throw new Error("No review marker.");
  expect(assessmentMarker(skipped)).toEqual({
    name: "Review skipped",
    says: "The test of this unit comes next.",
  });
});

test("a test chosen for a unit whose planning failed is not kept: Start, opened again, teaches the unit", async () => {
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
});

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

test("Test out cannot join a plain Start before its position is written", async () => {
  const root = await makeCourse();
  const writing = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const setup = setUp(tutor(), NOW, {
    ...root,
    async writePosition(...args) {
      writing.resolve();
      await release.promise;
      return root.writePosition(...args);
    },
  });
  const started = await setup.units.open(COURSE, "derivative");
  if (!started.ok) throw new Error(started.error);
  await writing.promise;
  try {
    const conflicting = await setup.units.open(COURSE, "derivative", {
      testOut: true,
    });
    expect(conflicting).toMatchObject({ ok: false, status: 409 });
  } finally {
    release.resolve();
    await started.chat.settled();
    await setup.units.close();
  }
  expect(ofType(started.chat, "assessment")).toEqual([]);
  expect(await positionOf()).toMatchObject({ phase: "discuss" });
});

test("a dispute while the result card waits shows it again with what passed now", async () => {
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
  // A tab still showing the original card must not finish the unit.
  expect(await chat.skipTested(["slope", "power-rule"])).toMatchObject({
    ok: false,
    status: 409,
  });
  expect(await positionOf()).toMatchObject({ testOut: { stage: "result" } });
  await step(chat.skipTested(["slope", "power-rule", "chain-rule"]), chat);
  expect(await positionOf()).toBeUndefined();
});
