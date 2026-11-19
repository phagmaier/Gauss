// Review questions in a unit chat (task 5.4; docs/decisions.md, "Mastery
// loop"): the card offered when a sitting begins, Start and Skip, the
// questions and their detours, the end, restarts, and the unit going on.
// The fake backend's tutor does what each header allows.

import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import type { CurriculumProposal } from "../../shared/curriculum.ts";
import type { PageEvent } from "../../shared/events.ts";
import type { AnswerEvidence } from "../../shared/evidence.ts";
import type { Plan } from "../../shared/plan.ts";
import type { Confidence } from "../../shared/question.ts";
import type { UnitPosition } from "../../shared/state.ts";
import { emptyTimeline, reduce, type Timeline } from "../../shared/timeline.ts";
import {
  assessmentDetourStep,
  assessmentEndMarker,
  nextStep,
  openQuestion,
} from "../../web/session.ts";
import type { EngineTurn } from "../backends/backend.ts";
import {
  createFakeBackend,
  type FakeBackend,
  type FakeReply,
  type FakeStep,
} from "../backends/fake.ts";
import { type DataRoot, openDataRoot } from "../record/data-root.ts";
import { objectiveStatus } from "../record/status.ts";
import { givenOrder } from "./choice-order.ts";
import type { DisputeJudge } from "./dispute-judge.ts";
import { createDisputes } from "./disputes.ts";
import { createFakeTimer } from "./fake-timer.ts";
import { createGrader } from "./grading.ts";
import { createHelpJudge } from "./help-judge.ts";
import { createUnitChats, type UnitChat } from "./unit-chat.ts";
import { createUnitPlanner } from "./unit-planning.ts";

// Each test gets its own data root; none touches ~/gauss (AGENTS.md).
let dir: string;
let kept: Set<string>;
/** The chats' clock, which a test moves on. */
let clock: Date;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "gauss-unit-review-"));
  kept = new Set();
  clock = new Date(NOW);
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const NOW = "2026-11-18T12:00:00.000Z";
const YESTERDAY = "2026-11-17T12:00:00.000Z";
const HOUR = 60 * 60 * 1000;
const COURSE = "calculus";

const CURRICULUM: CurriculumProposal = {
  title: "Calculus",
  units: [
    {
      id: "limits",
      title: "Limits",
      goal: "Find limits.",
      prerequisites: [],
    },
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

/** A correct answer at that confidence, recorded at `at`. */
function correct(
  objective: string,
  at: string,
  confidence: Confidence = "90",
  n = 1,
): AnswerEvidence {
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
      confidence,
    },
    assisted: false,
    verdict: "correct",
  };
}

/**
 * The course, approved and planned the day before, with unit 1's two
 * objectives passed then, so review is due on them.
 */
async function makeCourse(passedAt = YESTERDAY): Promise<DataRoot> {
  const root = openDataRoot({ path: dir, now: () => new Date(YESTERDAY) });
  const { id } = await root.createCourse({ title: CURRICULUM.title });
  await root.saveProposal(id, CURRICULUM);
  await root.approveCurriculum(id, CURRICULUM);
  for (const [unit, plan] of Object.entries(PLANS)) {
    await root.storePlan(id, unit, plan);
  }
  await root.appendEvidence(id, correct("limit-value", passedAt));
  await root.appendEvidence(id, correct("one-sided", passedAt));
  // Unit 1 is finished, passed.
  return root;
}

/**
 * A tutor that does what each header allows: posts a choice question,
 * numbered on from those before, on the objective a header asks about
 * (its right choice is A); opens a detour; gives feedback; teaches; or
 * replies.
 */
function tutor() {
  let asked = 0;
  return (turn: EngineTurn): FakeStep[] => {
    const { text } = turn;
    const objective = /a question on "([^"]+)" with ask_question/.exec(
      text,
    )?.[1];
    if (text.includes("The miss opens a detour")) return [{ text: "Detour." }];
    if (/^\[[^\]]*The learner answered question/.test(text)) {
      return [{ text: "Feedback." }];
    }
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

function setUp(
  script:
    | ReturnType<typeof tutor>
    | ((turn: EngineTurn) => FakeStep[]) = tutor(),
  replies: FakeReply[] = [],
  /** Wraps the chats' data root, to hold one of its calls. */
  wrap: (root: DataRoot) => DataRoot = (root) => root,
) {
  const backend = createFakeBackend((turn) => script(turn), replies, {
    kept,
  });
  const dataRoot = wrap(openDataRoot({ path: dir, now: () => clock }));
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
  return { backend, dataRoot, units };
}

async function open(
  setup: ReturnType<typeof setUp>,
  unit = "derivative",
): Promise<UnitChat> {
  const opened = await setup.units.open(COURSE, unit);
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

/**
 * Loses the unit's transcript from its first line of the type on, as a
 * crash can lose its last lines (engine/transcript.ts).
 */
async function loseTranscriptFrom(
  type: PageEvent["type"],
  unit = "derivative",
) {
  const folder = join(dir, "courses", COURSE, "sessions");
  const files = (await readdir(folder)).filter((f) => f.startsWith(`${unit}.`));
  expect(files).toHaveLength(1);
  const path = join(folder, files[0] ?? "");
  const lines = (await readFile(path, "utf8")).split("\n").filter(Boolean);
  const from = lines.findIndex((line) => line.includes(`"type":"${type}"`));
  expect(from).toBeGreaterThan(0);
  await writeFile(path, `${lines.slice(0, from).join("\n")}\n`);
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

const OFFERED: PageEvent = {
  type: "assessment",
  mode: "review",
  stage: "offered",
  count: 2,
};
const BOTH = [
  { unit: "limits", objective: "limit-value" },
  { unit: "limits", objective: "one-sided" },
];

// --- The card --------------------------------------------------------------

test("a unit opened in a new sitting, with objectives passed over an hour before, offers review on a card that sends the tutor nothing and holds the unit's steps", async () => {
  await makeCourse();
  const setup = setUp();

  const chat = await open(setup);

  expect(ofType(chat, "assessment")).toEqual([OFFERED]);
  // The teaching turn waits for the card; nothing has been sent.
  expect(sent(setup.backend)).toEqual([]);
  expect(await positionOf()).toEqual({
    segment: 0,
    phase: "teach",
    assessment: { mode: "review", stage: "offered", objectives: BOTH },
  });
  expect((await reload().readCourse(COURSE))?.course.reviewOfferedAt).toBe(NOW);
  expect(nextStep(replay(chat))).toBeNull();
  expect(await chat.override()).toMatchObject({
    ok: false,
    error: "Start or skip the review first.",
  });
});

const QUESTION_OPEN: UnitPosition = {
  segment: 0,
  phase: "check",
  checkFrom: 2,
  openQuestion: {
    id: "open-1",
    number: 1,
    objective: "slope",
    postedAt: NOW,
    question: {
      kind: "choice",
      prompt: "Which slope?",
      choices: ["Right", "Wrong"],
      answer: "A",
    },
  },
};

test.each<{
  why: string;
  unit?: string;
  given: (root: DataRoot) => Promise<void>;
  replies?: FakeReply[];
}>([
  {
    why: "every objective was answered within the hour",
    given: async (root) => {
      await root.appendEvidence(
        COURSE,
        correct(
          "limit-value",
          new Date(Date.parse(NOW) - HOUR / 2).toISOString(),
          "90",
          2,
        ),
      );
      await root.appendEvidence(
        COURSE,
        correct(
          "one-sided",
          new Date(Date.parse(NOW) - HOUR / 2).toISOString(),
          "90",
          2,
        ),
      );
    },
  },
  {
    why: "the course was offered review within the hour",
    given: async (root) => {
      await root.markReviewOffered(
        COURSE,
        new Date(Date.parse(NOW) - HOUR + 60_000),
      );
    },
  },
  {
    why: "the unit is finished",
    unit: "limits",
    given: async () => {},
  },
  {
    why: "a question is open",
    given: (root) =>
      root.writePosition(COURSE, "derivative", QUESTION_OPEN).then(() => {}),
  },
  {
    why: "an answer is kept, its grading failed",
    given: (root) =>
      root
        .writePosition(COURSE, "derivative", {
          ...QUESTION_OPEN,
          openQuestion: {
            ...(QUESTION_OPEN.openQuestion as NonNullable<
              UnitPosition["openQuestion"]
            >),
            question: {
              kind: "written",
              prompt: "Why a slope?",
              rubric: "Any reason.",
            },
            answer: {
              kind: "written",
              questionId: "open-1",
              text: "Because.",
              confidence: "75",
            },
          },
        })
        .then(() => {}),
    replies: [{ fail: "The grader is down." }],
  },
  {
    why: "a detour is open",
    given: (root) =>
      root
        .writePosition(COURSE, "derivative", {
          segment: 0,
          phase: "check",
          checkFrom: 2,
          detour: { questionId: "missed-1", number: 1, objective: "slope" },
        })
        .then(() => {}),
  },
  {
    why: "a package request waits",
    given: (root) =>
      root
        .writePosition(COURSE, "derivative", {
          segment: 0,
          phase: "discuss",
          packageRequest: {
            id: "request-1",
            packages: [{ name: "pytest" }],
            requestedAt: NOW,
          },
        })
        .then(() => {}),
  },
  {
    why: "the closing card waits",
    given: async (root) => {
      await root.appendEvidence(COURSE, correct("slope", YESTERDAY));
      await root.writePosition(COURSE, "derivative", {
        segment: 1,
        phase: "closed",
      });
    },
  },
])("no card when $why", async ({ unit, given, replies }) => {
  const root = await makeCourse();
  await given(root);
  const offeredBefore = (await reload().readCourse(COURSE))?.course
    .reviewOfferedAt;
  const setup = setUp(tutor(), replies);

  const chat = await open(setup, unit);

  expect(ofType(chat, "assessment")).toEqual([]);
  expect((await reload().readCourse(COURSE))?.course.reviewOfferedAt).toBe(
    offeredBefore,
  );
});

test("a chat already open offers review only once it has been quiet for an hour, as a new sitting", async () => {
  const root = await makeCourse();
  await root.markReviewOffered(COURSE, new Date(Date.parse(NOW) - 50 * 60_000));
  const setup = setUp();
  const chat = await open(setup);
  expect(ofType(chat, "assessment")).toEqual([]);
  expect(sent(setup.backend)).toHaveLength(1);

  // Twenty minutes on: the course's hour is over, but the sitting is not.
  clock = new Date(Date.parse(NOW) + 20 * 60_000);
  await open(setup);
  expect(ofType(chat, "assessment")).toEqual([]);

  // An hour after the last thing that happened: a new sitting.
  clock = new Date(Date.parse(NOW) + 61 * 60_000);
  await open(setup);
  expect(ofType(chat, "assessment")).toEqual([OFFERED]);
  // Under the new session's marker.
  expect(chat.events().slice(-2)).toEqual([
    { type: "session", startedAt: clock.toISOString() },
    OFFERED,
  ]);
  expect(sent(setup.backend)).toHaveLength(1);
});

test("two units opened within the hour get one card, in the first", async () => {
  await makeCourse();
  const setup = setUp();

  const derivative = await open(setup, "derivative");
  const integral = await open(setup, "integral");

  expect(ofType(derivative, "assessment")).toEqual([OFFERED]);
  expect(ofType(integral, "assessment")).toEqual([]);
  // The second was taught at once.
  expect(sent(setup.backend)).toHaveLength(1);
  expect(sent(setup.backend)[0]).toContain('"The integral"');
});

// --- Start, the questions, the end -------------------------------------------

test("Start marks the thread and asks the tutor for the first question, on another unit's objective, which the card's head names", async () => {
  await makeCourse();
  const setup = setUp();
  const chat = await open(setup);

  await step(chat.startAssessment(), chat);

  expect(ofType(chat, "assessment").at(-1)).toEqual({
    ...OFFERED,
    stage: "on",
  });
  expect(sent(setup.backend)).toEqual([
    '[Unit 2 of 3, "The derivative"; segment 1 of 2, "Slopes", on "slope". Phase: teach. A review is under way, and the segment waits until it ends. ' +
      "The learner started the review: 2 questions on objectives they passed before, one on each, and one more after a miss. " +
      'In this review, question 1, "limit-value": not asked yet; question 2, "one-sided": not asked yet. ' +
      'Allowed now: a lead-in of one sentence, then a question on "limit-value" with ask_question, unlike the ones asked before. ' +
      '"limit-value" is an objective of unit 1, "Limits", which this conversation may not have taught: Find a limit\'s value from a graph or a table. ' +
      "No teaching in a review: before the question, no reminder of the idea, rule or method, and no example. Posting ends your turn.\n" +
      "Questions asked before:\n" +
      'Asked on "limit-value" before, the oldest first:\n' +
      '- "Seeded question 1 on limit-value."]',
  ]);
  expect(lastQuestion(chat)).toMatchObject({
    number: 1,
    prompt: "Question 1 on limit-value?",
    assessment: { of: 2, from: { number: 1, title: "Limits" } },
  });
  expect(await positionOf()).toMatchObject({
    phase: "teach",
    assessment: { stage: "on", from: 2 },
    openQuestion: { number: 1, objective: "limit-value" },
  });
  expect(nextStep(replay(chat))).toBe("assessment");
  expect(await chat.ready()).toMatchObject({
    error: "Finish or skip the review first.",
  });
});

test("the tutor may ask only about the objective the review asks next", async () => {
  await makeCourse();
  const script = tutor();
  let first = true;
  const setup = setUp((turn) => {
    if (first && turn.text.includes("The learner started the review")) {
      first = false;
      return [
        {
          call: "ask_question",
          input: {
            objective: "one-sided",
            kind: "choice",
            prompt: "Out of order?",
            choices: ["Right", "Wrong"],
            answer: "A",
          },
        },
        ...script(turn),
      ];
    }
    return script(turn);
  });
  const chat = await open(setup);

  await step(chat.startAssessment(), chat);

  expect(setup.backend.calls[0]?.result).toMatchObject({
    status: "refused",
    text: 'The review asks about "limit-value" now, and about no other objective: post the question on it.',
  });
  expect(lastQuestion(chat)).toMatchObject({
    prompt: "Question 1 on limit-value?",
  });
});

test("each objective gets one question; a correct answer gets feedback alone, then the next objective's question, and the review ends with what it did before the teaching that waited", async () => {
  await makeCourse();
  const setup = setUp();
  const chat = await open(setup);
  await step(chat.startAssessment(), chat);

  await answer(chat, "A");
  expect(sent(setup.backend)[1]).toContain(
    'In this review, question 1, "limit-value": answered correctly; question 2, "one-sided": not asked yet. Allowed now: feedback on this answer in a sentence or two, written as text, and nothing else: no teaching. No tool may be called in this reply: once it ends, the app asks you for the next question in a message of its own.]',
  );
  expect(sent(setup.backend)[2]).toContain(
    'The review goes on after your feedback on question 1. In this review, question 1, "limit-value": answered correctly; question 2, "one-sided": not asked yet. Allowed now: a lead-in of one sentence, then a question on "one-sided" with ask_question',
  );
  expect(lastQuestion(chat)).toMatchObject({
    number: 2,
    assessment: { of: 2, from: { number: 1, title: "Limits" } },
  });

  await answer(chat, "A");
  expect(sent(setup.backend)[3]).toContain(
    "No tool may be called in this reply: this was the review's last question, and the review ends once your feedback does.]",
  );
  const end = ofType(chat, "assessment_end");
  expect(end).toEqual([
    {
      type: "assessment_end",
      mode: "review",
      skipped: false,
      statuses: { "limit-value": "retained", "one-sided": "retained" },
    },
  ]);
  // The teaching that waited, told what the review did.
  expect(sent(setup.backend)).toHaveLength(5);
  expect(sent(setup.backend)[4]).toMatch(
    /^\[Unit 2 of 3, "The derivative"; segment 1 of 2, "Slopes", on "slope". Phase: teach. Start of the segment. The review is over: "limit-value" retained; "one-sided" retained. The unit goes on where it stood before the review. Do not go back over the review unless the learner asks. Allowed now: teach/,
  );
  expect(await positionOf()).toEqual({ segment: 0, phase: "discuss" });
  // Each answer is on unit 1's objective, given in unit 2's review.
  const evidence = await reload().readEvidence(COURSE);
  expect(evidence.slice(2)).toMatchObject([
    {
      objective: "limit-value",
      assessment: { mode: "review", unit: "derivative" },
    },
    {
      objective: "one-sided",
      assessment: { mode: "review", unit: "derivative" },
    },
  ]);
  expect(objectiveStatus(evidence, "limit-value")).toBe("retained");
  const timeline = replay(chat);
  expect(timeline.assessment).toBeNull();
  const marker = timeline.items.find((i) => i.kind === "assessment_end");
  if (marker?.kind !== "assessment_end") throw new Error("No end marker.");
  expect(assessmentEndMarker(marker)).toEqual({
    name: "Review over",
    says: "All two retained. Segment 1 is taught next.",
  });
  expect(nextStep(timeline)).toBe("ready");
});

test("a miss opens a detour; once the learner ends it the objective is asked once more, and after that the review moves on whatever the answer, which unit 1's open chat learns", async () => {
  await makeCourse();
  const setup = setUp();
  const limits = await open(setup, "limits");
  const chat = await open(setup);
  await step(chat.startAssessment(), chat);

  await answer(chat, "B");
  expect(ofType(chat, "detour")).toHaveLength(1);
  expect(sent(setup.backend)[1]).toContain(
    'The miss opens a detour, a pause in the review: no question is posted until the learner presses "Ready for another question", and nothing said in it is graded.',
  );
  expect(sent(setup.backend)[1]).toContain(
    'When they press it, one more question on "limit-value" follows. You may suggest pressing "Ready for another question" once the confusion seems cleared.]',
  );
  expect(nextStep(replay(chat))).toBe("assessment-detour");
  expect(assessmentDetourStep(replay(chat))).toEqual({
    label: "Ready for another question",
    skip: true,
  });
  // Unit 1's chat, open with its own record, learns the miss.
  expect(ofType(limits, "unit_status").at(-1)).toMatchObject({
    objectives: { "limit-value": "slipping", "one-sided": "passed" },
  });

  await step(chat.anotherQuestion(), chat);
  expect(sent(setup.backend)[2]).toContain(
    'The learner pressed "Ready for another question": the detour after question 1 is over, and the review goes on. ' +
      'In this review, question 1, "limit-value": missed, so one more question follows the detour; question 2, "one-sided": not asked yet. ' +
      'Allowed now: a lead-in of one sentence, then a question on "limit-value" with ask_question, unlike the ones asked before, and unlike the one just missed: ask about the same idea another way.',
  );
  expect(lastQuestion(chat)).toMatchObject({
    number: 1,
    assessment: { of: 2, second: true },
  });

  await answer(chat, "B");
  expect(sent(setup.backend)[3]).toContain(
    'Nothing more is asked on "limit-value": when they press it, the review moves on to its next objective.',
  );
  expect(assessmentDetourStep(replay(chat))).toEqual({
    label: "Go on with the review",
    skip: true,
  });

  await step(chat.anotherQuestion(), chat);
  expect(sent(setup.backend)[4]).toContain(
    'The learner pressed "Go on with the review": the detour after question 1 is over, and the review goes on.',
  );
  expect(lastQuestion(chat)).toMatchObject({ number: 2 });
  expect(lastQuestion(chat).assessment?.second).toBeUndefined();

  // The last objective: a miss, its second question, and a second miss.
  await answer(chat, "B");
  expect(assessmentDetourStep(replay(chat))).toEqual({
    label: "Ready for another question",
    skip: true,
  });
  await step(chat.anotherQuestion(), chat);
  expect(lastQuestion(chat)).toMatchObject({
    number: 2,
    assessment: { of: 2, second: true },
  });
  await answer(chat, "B");
  expect(sent(setup.backend).at(-1)).toContain(
    'Nothing more is asked on "one-sided": when they press it, the review ends.',
  );
  expect(assessmentDetourStep(replay(chat))).toEqual({
    label: "Finish the review",
    skip: false,
  });
  await step(chat.anotherQuestion(), chat);
  expect(ofType(chat, "assessment_end")).toEqual([
    {
      type: "assessment_end",
      mode: "review",
      skipped: false,
      statuses: { "limit-value": "slipping", "one-sided": "slipping" },
    },
  ]);
  // Two questions on each objective, and no third.
  expect(ofType(chat, "question")).toHaveLength(4);
  expect(nextStep(replay(chat))).toBe("ready");
});

test("a dispute that overturns the first miss on another unit's objective counts in the review: no second question follows, and the review's thread and tutor are told", async () => {
  await makeCourse();
  const setup = setUp();
  const overturning: DisputeJudge = {
    decide: async () => ({
      ok: true,
      outcome: { verdict: "correct", reason: "The answer is right." },
    }),
  };
  const disputes = createDisputes({
    dataRoot: setup.dataRoot,
    judge: overturning,
    units: setup.units,
    now: () => clock,
  });
  // Unit 1's chat is open too, so the dispute is recorded through it.
  await open(setup, "limits");
  const chat = await open(setup);
  await step(chat.startAssessment(), chat);
  const missed = lastQuestion(chat);
  await answer(chat, "B");

  expect(
    await disputes.raise(COURSE, missed.id, "B is the same as A."),
  ).toMatchObject({ ok: true });
  await chat.settled();
  expect(ofType(chat, "disputed")).toMatchObject([{ questionId: missed.id }]);

  await step(chat.anotherQuestion(), chat);
  expect(sent(setup.backend).at(-1)).toContain(
    'The learner disputed the grade of their answer to a question on "limit-value"',
  );
  expect(sent(setup.backend).at(-1)).toContain(
    'question 1, "limit-value": answered correctly; question 2, "one-sided": not asked yet. Allowed now: a lead-in of one sentence, then a question on "one-sided"',
  );
  expect(lastQuestion(chat)).toMatchObject({ number: 2 });
  expect(lastQuestion(chat).assessment?.second).toBeUndefined();
});

test("answers other units' chats record on its objectives while its card waits count in the review's end", async () => {
  await makeCourse();
  const setup = setUp();
  const derivative = await open(setup);
  expect(ofType(derivative, "assessment")).toEqual([OFFERED]);
  // Two hours on, unit 3 opens in a new sitting and gets a card on the same
  // objectives, while unit 2's still waits.
  clock = new Date(clock.getTime() + 2 * HOUR);
  const integral = await open(setup, "integral");
  expect(ofType(integral, "assessment")).toEqual([OFFERED]);
  await step(integral.startAssessment(), integral);
  await answer(integral, "B");
  await step(integral.anotherQuestion(), integral);
  await answer(integral, "B");
  await step(integral.anotherQuestion(), integral);
  await answer(integral, "A");
  expect(ofType(integral, "assessment_end")).toHaveLength(1);

  await step(derivative.startAssessment(), derivative);
  await answer(derivative, "A");
  await answer(derivative, "A");

  // "limit-value" was passed, then missed twice in unit 3's review, so it
  // slipped; one correct answer since does not pass it again. "one-sided"
  // was passed, and answered correctly in both reviews.
  expect(ofType(derivative, "assessment_end")).toEqual([
    {
      type: "assessment_end",
      mode: "review",
      skipped: false,
      statuses: { "limit-value": "slipping", "one-sided": "retained" },
    },
  ]);
  const log = await reload().readEvidence(COURSE);
  expect(objectiveStatus(log, "limit-value")).toBe("slipping");
});

test("Skip review with a question open withdraws it with nothing recorded, and the tutor is told in its next header", async () => {
  await makeCourse();
  const setup = setUp();
  const chat = await open(setup);
  await step(chat.startAssessment(), chat);
  const question = lastQuestion(chat);

  await step(chat.skipAssessment(), chat);

  expect(ofType(chat, "assessment_end")).toEqual([
    {
      type: "assessment_end",
      mode: "review",
      skipped: true,
      statuses: {},
      withdrawnQuestionId: question.id,
    },
  ]);
  expect(await reload().readEvidence(COURSE)).toHaveLength(2);
  expect(await positionOf()).toEqual({ segment: 0, phase: "discuss" });
  expect(sent(setup.backend)[1]).toContain(
    "Phase: teach. Start of the segment. The learner skipped the rest of the review, and question 1 was withdrawn. The unit goes on where it stood before the review. Allowed now: teach",
  );
  const timeline = replay(chat);
  expect(
    timeline.items.find(
      (i) => i.kind === "question" && i.question.id === question.id,
    ),
  ).toMatchObject({ withdrawn: true });
  const marker = timeline.items.find((i) => i.kind === "assessment_end");
  if (marker?.kind !== "assessment_end") throw new Error("No end marker.");
  expect(assessmentEndMarker(marker).says).toBe("Segment 1 is taught next.");
});

test("Skip on the card ends the review with nothing told to the tutor, and the teaching that waited is sent", async () => {
  await makeCourse();
  const setup = setUp();
  const chat = await open(setup);

  await step(chat.skipAssessment(), chat);

  expect(ofType(chat, "assessment_end")).toEqual([
    { type: "assessment_end", mode: "review", skipped: true, statuses: {} },
  ]);
  expect(sent(setup.backend)).toHaveLength(1);
  expect(sent(setup.backend)[0]).not.toContain("review");
  expect(replay(chat).items).toContainEqual(
    expect.objectContaining({ kind: "assessment", stage: "skipped" }),
  );
  expect(await chat.startAssessment()).toMatchObject({
    error: "Nothing is offered to start.",
  });
});

test("a message sent while the card waits skips it; the teaching that waited goes first, then the message", async () => {
  await makeCourse();
  const setup = setUp();
  const chat = await open(setup);

  expect(chat.say("Can we just carry on?")).toEqual({ ok: true });
  await chat.settled();

  expect(ofType(chat, "assessment_end")).toEqual([
    { type: "assessment_end", mode: "review", skipped: true, statuses: {} },
  ]);
  expect(sent(setup.backend)).toHaveLength(2);
  expect(sent(setup.backend)[0]).toContain("Allowed now: teach");
  expect(sent(setup.backend)[1]).toMatch(
    /Message from the learner\..*\]\nCan we just carry on\?$/s,
  );
});

test("a message sent while the card is being offered waits for the card and skips it; the teaching that waited goes first, then the message", async () => {
  await makeCourse();
  let reached = () => {};
  const atStamp = new Promise<void>((resolve) => {
    reached = resolve;
  });
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  // The offer is held as it stamps the course, before its card is kept.
  const setup = setUp(tutor(), [], (root) => ({
    ...root,
    async markReviewOffered(courseId, at) {
      reached();
      await held;
      return root.markReviewOffered(courseId, at);
    },
  }));
  const opened = await setup.units.open(COURSE, "derivative");
  if (!opened.ok) throw new Error(opened.error);
  const chat = opened.chat;
  await atStamp;

  expect(chat.say("Can we start learning?")).toEqual({ ok: true });
  release();
  await chat.settled();

  expect(ofType(chat, "assessment_end")).toEqual([
    { type: "assessment_end", mode: "review", skipped: true, statuses: {} },
  ]);
  expect(sent(setup.backend)).toHaveLength(2);
  expect(sent(setup.backend)[0]).toContain("Allowed now: teach");
  expect(sent(setup.backend)[1]).toMatch(
    /Message from the learner\..*\]\nCan we start learning\?$/s,
  );
  expect(nextStep(replay(chat))).toBe("ready");
});

// --- Restarts --------------------------------------------------------------

test("a restart at the card shows it again and sends nothing; one in the middle shows the open question with its head, and one with nothing open asks on", async () => {
  await makeCourse();
  const first = setUp();
  const before = await open(first);
  await first.units.close();

  // At the card.
  const second = setUp();
  const atCard = await open(second);
  expect(ofType(atCard, "assessment").at(-1)).toEqual(OFFERED);
  expect(
    replay(atCard).items.filter((i) => i.kind === "assessment"),
  ).toHaveLength(1);
  expect(sent(second.backend)).toEqual([]);
  expect(before.id).not.toBe(atCard.id);
  await step(atCard.startAssessment(), atCard);
  await answer(atCard, "A");
  const open2 = lastQuestion(atCard);
  await second.units.close();

  // A question open.
  const third = setUp();
  const mid = await open(third);
  expect(lastQuestion(mid)).toEqual(open2);
  expect(open2.assessment).toEqual({
    of: 2,
    from: { number: 1, title: "Limits" },
  });
  expect(sent(third.backend)).toEqual([]);
  expect(nextStep(replay(mid))).toBe("assessment");
  await third.units.close();

  // Nothing open: the question taken out as a restart before posting it
  // would leave it.
  const position = (await reload().readState(COURSE)).units.derivative;
  if (position === undefined) throw new Error("No position.");
  const { openQuestion: _, ...asked } = position;
  await reload().writePosition(COURSE, "derivative", asked);
  const fourth = setUp();
  const reopened = await open(fourth);
  expect(sent(fourth.backend)[0]).toContain(
    'The review goes on where it was. In this review, question 1, "limit-value": answered correctly; question 2, "one-sided": not asked yet. Allowed now: a lead-in of one sentence, then a question on "one-sided" with ask_question',
  );
  await answer(reopened, "A");
  expect(ofType(reopened, "assessment_end")).toHaveLength(1);
});

test("a restart after the thread lost a skipped review's end and the phase after it shows the unit's control, with nothing pinned", async () => {
  await makeCourse();
  const first = setUp();
  const before = await open(first);
  await step(before.startAssessment(), before);
  const withdrawn = lastQuestion(before);
  // The teaching that waited follows, and the discussion opens.
  await step(before.skipAssessment(), before);
  expect(ofType(before, "phase").at(-1)).toMatchObject({ phase: "discuss" });
  await first.units.close();
  await loseTranscriptFrom("assessment_end");

  const second = setUp();
  const timeline = replay(await open(second));

  expect(timeline.assessment).toBeNull();
  expect(openQuestion(timeline)).toBeUndefined();
  expect(timeline.items).toContainEqual(
    expect.objectContaining({ kind: "question", question: withdrawn }),
  );
  expect(nextStep(timeline)).toBe("ready");
});

test("a restart after the thread lost the end of a review skipped in a check does not take its withdrawn question for the check's", async () => {
  await makeCourse();
  await reload().writePosition(COURSE, "derivative", {
    segment: 0,
    phase: "check",
    checkFrom: 2,
  });
  const base = tutor();
  // The check's question does not come before the server stops.
  const first = setUp((turn) =>
    turn.text.includes("The check goes on.")
      ? [{ text: "One moment." }]
      : base(turn),
  );
  const before = await open(first);
  await step(before.startAssessment(), before);
  await step(before.skipAssessment(), before);
  expect((await positionOf())?.openQuestion).toBeUndefined();
  await first.units.close();
  await loseTranscriptFrom("assessment_end");

  const second = setUp();
  const timeline = replay(await open(second));

  expect(timeline.position?.phase).toBe("check");
  expect(timeline.assessment).toBeNull();
  expect(openQuestion(timeline)).toBeUndefined();
});

// --- The unit going on -----------------------------------------------------

test("after a review in the discussion nothing is sent, and the next message's header says what it did", async () => {
  await makeCourse();
  await reload().writePosition(COURSE, "derivative", {
    segment: 0,
    phase: "discuss",
  });
  const setup = setUp();
  const chat = await open(setup);
  await step(chat.startAssessment(), chat);
  await answer(chat, "A");
  await answer(chat, "A");
  const turns = sent(setup.backend).length;

  expect(ofType(chat, "assessment_end")).toHaveLength(1);
  expect(sent(setup.backend)).toHaveLength(turns);
  expect(nextStep(replay(chat))).toBe("ready");
  const timeline = replay(chat);
  const marker = timeline.items.find((i) => i.kind === "assessment_end");
  if (marker?.kind !== "assessment_end") throw new Error("No end marker.");
  expect(assessmentEndMarker(marker).says).toBe(
    "All two retained. Back to segment 1, in its discussion.",
  );

  expect(chat.say("Where were we?")).toEqual({ ok: true });
  await chat.settled();
  expect(sent(setup.backend).at(-1)).toContain(
    'Phase: discuss. Message from the learner. The review is over: "limit-value" retained; "one-sided" retained.',
  );
  expect(await chat.ready()).toEqual({ ok: true });
  await chat.settled();
});

test("after a review in the check, the check goes on: the tutor is asked for its question", async () => {
  await makeCourse();
  await reload().writePosition(COURSE, "derivative", {
    segment: 0,
    phase: "check",
    checkFrom: 2,
  });
  const setup = setUp();
  const chat = await open(setup);
  expect(ofType(chat, "assessment")).toEqual([OFFERED]);

  await step(chat.skipAssessment(), chat);

  expect(sent(setup.backend)).toHaveLength(1);
  // A position written by hand has no session to resume, so the note
  // that the conversation is new comes with it.
  expect(sent(setup.backend)[0]).toContain("Phase: check. The check goes on.");
  expect(sent(setup.backend)[0]).toContain(
    'In this check, "slope": not asked yet. Allowed now: post a question on "slope" with ask_question',
  );
  expect(lastQuestion(chat)).toMatchObject({ number: 1 });
  expect(lastQuestion(chat).assessment).toBeUndefined();
  expect(await positionOf()).toMatchObject({
    phase: "check",
    openQuestion: { objective: "slope" },
  });
});

test("after a review at a closed segment nothing is sent, and the learner starts the next segment", async () => {
  await makeCourse();
  await reload().appendEvidence(COURSE, correct("slope", NOW));
  await reload().writePosition(COURSE, "derivative", {
    segment: 0,
    phase: "closed",
  });
  const setup = setUp();
  const chat = await open(setup);
  expect(ofType(chat, "assessment")).toEqual([OFFERED]);
  expect(await chat.nextSegment()).toMatchObject({
    error: "Start or skip the review first.",
  });

  await step(chat.skipAssessment(), chat);

  expect(sent(setup.backend)).toEqual([]);
  expect(nextStep(replay(chat))).toBe("next-segment");
  await step(chat.nextSegment(), chat);
  expect(sent(setup.backend)[0]).toContain('segment 2 of 2, "Powers"');
});
