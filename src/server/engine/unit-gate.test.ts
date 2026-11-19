// The unit gate in a unit chat (task 5.5; docs/decisions.md, "Mastery
// loop", "The gate"): its card once the last segment closes, the gate and
// its detours, the closing card after it, skipping it, restarts, and a unit
// whose gate has nothing to ask. The fake backend's tutor does what each
// header allows.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import type { CurriculumProposal } from "../../shared/curriculum.ts";
import type { PageEvent } from "../../shared/events.ts";
import type { AnswerEvidence } from "../../shared/evidence.ts";
import type { Plan } from "../../shared/plan.ts";
import type { Confidence } from "../../shared/question.ts";
import { emptyTimeline, reduce, type Timeline } from "../../shared/timeline.ts";
import {
  assessmentCard,
  assessmentDetourStep,
  assessmentEndMarker,
  assessmentMarker,
  closingCard,
  lastCard,
  nextStep,
  openQuestion,
  whereInUnit,
} from "../../web/session.ts";
import type { EngineTurn } from "../backends/backend.ts";
import {
  createFakeBackend,
  type FakeBackend,
  type FakeStep,
} from "../backends/fake.ts";
import { type DataRoot, openDataRoot } from "../record/data-root.ts";
import { objectiveStatus } from "../record/status.ts";
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
  dir = await mkdtemp(join(tmpdir(), "gauss-unit-gate-"));
  kept = new Set();
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const NOW = "2026-11-18T12:00:00.000Z";
const YESTERDAY = "2026-11-17T12:00:00.000Z";
/** Within the hour before NOW: review and the gate leave such an answer's objective alone. */
const LATELY = "2026-11-18T11:30:00.000Z";
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
 * The course, approved and planned: unit 1 finished, passed at `limitsAt`;
 * unit 2 in the discussion of its last segment, its first objective passed
 * the day before unless `slope` is false. Review was offered just now, so
 * none comes in the way.
 */
async function makeCourse(
  options: { limitsAt?: string; slope?: boolean } = {},
): Promise<DataRoot> {
  const root = openDataRoot({ path: dir, now: () => new Date(YESTERDAY) });
  const { id } = await root.createCourse({ title: CURRICULUM.title });
  await root.saveProposal(id, CURRICULUM);
  await root.approveCurriculum(id, CURRICULUM);
  for (const [unit, plan] of Object.entries(PLANS)) {
    await root.storePlan(id, unit, plan);
  }
  const limitsAt = options.limitsAt ?? YESTERDAY;
  await root.appendEvidence(id, correct("limit-value", limitsAt));
  await root.appendEvidence(id, correct("one-sided", limitsAt));
  if (options.slope !== false) {
    await root.appendEvidence(id, correct("slope", YESTERDAY));
  }
  await root.writePosition(id, "derivative", { segment: 1, phase: "discuss" });
  await root.markReviewOffered(id, new Date(NOW));
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

function setUp(record: (root: DataRoot) => DataRoot = (root) => root) {
  const script = tutor();
  const backend = createFakeBackend((turn) => script(turn), [], { kept });
  const clock = new Date(NOW);
  const dataRoot = record(openDataRoot({ path: dir, now: () => clock }));
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

/** The events from the last one of the type on, that one included. */
function since(chat: UnitChat, type: PageEvent["type"]): PageEvent[] {
  const events = chat.events();
  return events.slice(events.findLastIndex((e) => e.type === type));
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

/** From the last segment's discussion: its check, passed at once, which closes the unit's last segment. */
async function toGate(chat: UnitChat) {
  await step(chat.ready(), chat);
  await answer(chat, "A", "90");
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

function cardOf(timeline: Timeline) {
  const card = lastCard(timeline);
  if (card === undefined) throw new Error("No closing card.");
  return card;
}

const SLOPE = { unit: "derivative", objective: "slope" };
const POWER = { unit: "derivative", objective: "power-rule" };
const LIMIT_VALUE = { unit: "limits", objective: "limit-value" };
const ONE_SIDED = { unit: "limits", objective: "one-sided" };

const GATE_OFFERED: PageEvent = {
  type: "assessment",
  mode: "gate",
  stage: "offered",
  count: 4,
  own: 2,
  from: [1],
};
const LIMITS = { number: 1, title: "Limits" };

// --- The card ----------------------------------------------------------------

test("the last segment's close, every objective passed, offers the gate on a card, with no closing card before it; it sends the tutor nothing, holds the unit's steps, and a message leaves it waiting", async () => {
  await makeCourse();
  const setup = setUp();
  const chat = await open(setup);

  await toGate(chat);

  expect(since(chat, "phase")).toEqual([
    { type: "phase", segment: 1, phase: "closed" },
    GATE_OFFERED,
  ]);
  expect(ofType(chat, "unit_end")).toEqual([]);
  // "ready", then the feedback on the check's answer.
  expect(sent(setup.backend)).toHaveLength(2);
  expect(await positionOf()).toEqual({
    segment: 1,
    phase: "closed",
    assessment: {
      mode: "gate",
      stage: "offered",
      objectives: [SLOPE, POWER, LIMIT_VALUE, ONE_SIDED],
    },
    gated: true,
  });
  for (const refused of [
    await chat.goOverAgain(),
    await chat.finishUnit(),
    await chat.nextSegment(),
  ]) {
    expect(refused).toEqual({
      ok: false,
      status: 409,
      error: "Start or skip the gate first.",
    });
  }
  const timeline = replay(chat);
  expect(nextStep(timeline)).toBeNull();
  const card = timeline.items.at(-1);
  if (card?.kind !== "assessment") throw new Error("No card.");
  expect(assessmentCard(card)).toEqual({
    title: "Unit gate",
    questions: "4 questions",
    says: [
      "A question on each of the two objectives you passed in this unit that no review has confirmed, and two on objectives of unit 1, with nothing taught first. A right answer marks its objective retained; a miss is worked through, as in a check.",
      "It waits here, if you would rather take it in another sitting, when the answers say more.",
    ],
    start: "Start the gate",
    skip: "Skip the gate",
  });

  await step(Promise.resolve(chat.say("Can I take it tomorrow?")), chat);

  expect(sent(setup.backend)[2]).toBe(
    '[Unit 2 of 2, "The derivative"; segment 2 of 2, "Powers", on "power-rule". Phase: closed. Message from the learner. ' +
      "The unit's gate, 4 questions, 2 on this unit's objectives and 2 on other units', is offered to the learner on a card, " +
      "which they start or skip, now or in a later sitting; the unit ends after it. Allowed now: reply to the learner. No teaching tools.]\n" +
      "Can I take it tomorrow?",
  );
  expect((await positionOf())?.assessment?.stage).toBe("offered");
  expect(ofType(chat, "assessment_end")).toEqual([]);
});

test("moving on from the closing card without the objectives not passed records the override, then offers the gate on what passed", async () => {
  await makeCourse();
  const setup = setUp();
  const chat = await open(setup);
  await step(chat.ready(), chat);
  // The learner moves on before answering: the unit's closing card.
  await step(chat.override(), chat);
  expect(since(chat, "unit_end")).toEqual([
    {
      type: "unit_end",
      passed: false,
      objectives: { slope: "passed", "power-rule": "overridden" },
    },
  ]);

  await step(chat.finishUnit(), chat);

  expect((await reload().readEvidence(COURSE)).at(-1)).toEqual({
    kind: "override",
    recordedAt: NOW,
    objectives: ["power-rule"],
    moveOnId: expect.any(String),
  });
  expect(since(chat, "unit_end").slice(1)).toEqual([
    {
      type: "unit_status",
      unit: "in-progress",
      objectives: { slope: "passed", "power-rule": "overridden" },
    },
    { type: "moved_on", objectives: ["power-rule"] },
    { ...GATE_OFFERED, count: 3, own: 1 },
  ]);
  expect(await positionOf()).toMatchObject({
    assessment: { objectives: [SLOPE, LIMIT_VALUE, ONE_SIDED] },
    gated: true,
  });
  const timeline = replay(chat);
  expect(cardOf(timeline).stepTaken).toBe("moved-on");
  expect(nextStep(timeline)).toBeNull();
});

test.each(["override", "gate"] as const)(
  "restarting after a closing-card move-on interrupted at the %s write offers the gate and records the override once",
  async (at) => {
    await makeCourse();
    let interrupt = false;
    const before = setUp((root) => ({
      ...root,
      appendEvidence(...args) {
        if (interrupt && at === "override" && args[1].kind === "override") {
          return Promise.reject(new Error("Interrupted write."));
        }
        return root.appendEvidence(...args);
      },
      writePosition(...args) {
        if (
          interrupt &&
          at === "gate" &&
          args[2]?.assessment?.mode === "gate"
        ) {
          return Promise.reject(new Error("Interrupted write."));
        }
        return root.writePosition(...args);
      },
    }));
    const first = await open(before);
    await step(first.override(), first);
    const beforeMove = (await reload().readEvidence(COURSE)).length;
    interrupt = true;
    await expect(first.finishUnit()).rejects.toThrow("Interrupted write.");
    await before.units.close();

    const after = setUp();
    const chat = await open(after);
    expect(ofType(chat, "assessment")).toEqual([
      { ...GATE_OFFERED, count: 3, own: 1 },
    ]);
    const timeline = replay(chat);
    expect(timeline.assessment?.stage).toBe("offered");
    expect(cardOf(timeline).stepTaken).toBe("moved-on");
    expect((await reload().readEvidence(COURSE)).slice(beforeMove)).toEqual([
      expect.objectContaining({ kind: "override", objectives: ["power-rule"] }),
    ]);
    await step(chat.skipAssessment(), chat);
    expect(replay(chat).finished).toBe("overridden");
    await after.units.close();
  },
);

test("after moving on before the gate, the closing card after it offers its steps on what the gate left not passed alone, and moving on from them finishes the unit", async () => {
  await makeCourse({ limitsAt: LATELY });
  const setup = setUp();
  const chat = await open(setup);
  await step(chat.ready(), chat);
  await step(chat.override(), chat);
  await step(chat.finishUnit(), chat);
  await step(chat.startAssessment(), chat);
  await answer(chat, "B");
  await step(chat.anotherQuestion(), chat);
  await answer(chat, "A");

  expect(since(chat, "unit_end")).toEqual([
    {
      type: "unit_end",
      passed: false,
      objectives: { slope: "slipping", "power-rule": "overridden" },
      gate: { goOver: ["slope"], others: [] },
    },
  ]);
  expect(
    closingCard(PLANS.derivative as Plan, cardOf(replay(chat))),
  ).toMatchObject({
    verdict: { text: "Two not passed" },
    steps: true,
    again: "Go over it again",
  });
  await step(Promise.resolve(chat.say("What now?")), chat);
  expect(sent(setup.backend).at(-1)).toContain(
    'Message from the learner. The gate is over: "slope" slipping (passed before, now missed, so it must pass again). ' +
      "The learner now sees the unit's closing card, with each objective's status as it stands. Do not go back over the gate unless the learner asks. " +
      "The segment is closed, and it was the unit's last. The unit's gate left \"slope\" not passed. The learner chooses whether to go over them again or to move on without them.",
  );

  await step(chat.finishUnit(), chat);

  expect((await reload().readEvidence(COURSE)).at(-1)).toEqual({
    kind: "override",
    recordedAt: NOW,
    objectives: ["slope"],
    moveOnId: expect.any(String),
  });
  expect(chat.events().slice(-2)).toEqual([
    {
      type: "unit_status",
      unit: "overridden",
      objectives: { slope: "overridden", "power-rule": "overridden" },
    },
    { type: "unit_closed", status: "overridden" },
  ]);
  expect(await positionOf()).toBeUndefined();
  expect(cardOf(replay(chat)).stepTaken).toBe("moved-on");
});

// --- The gate and its end ----------------------------------------------------

test("a gate answered right retains its objectives, and the closing card after it lists the other units' objectives it asked and finishes the unit", async () => {
  await makeCourse();
  const setup = setUp();
  const chat = await open(setup);
  await toGate(chat);

  await step(chat.startAssessment(), chat);

  expect(sent(setup.backend)[2]).toBe(
    '[Unit 2 of 2, "The derivative"; segment 2 of 2, "Powers", on "power-rule". Phase: closed. ' +
      "The unit's gate is under way, and the unit ends after it. " +
      "The learner started the unit's gate: 4 questions, 2 on this unit's objectives and 2 on other units', one on each objective they passed, and one more after a miss. " +
      'In this gate, question 1, "slope": not asked yet; question 2, "power-rule": not asked yet; question 3, "limit-value": not asked yet; question 4, "one-sided": not asked yet. ' +
      'Allowed now: a lead-in of one sentence, then a question on "slope" with ask_question, unlike the ones asked before. ' +
      '"slope" is an objective of this unit: Read a derivative as a tangent\'s slope. ' +
      "No teaching in a gate: before the question, no reminder of the idea, rule or method, and no example. Posting ends your turn.\n" +
      "Questions asked before:\n" +
      'Asked on "slope" before, the oldest first:\n' +
      '- "Seeded question on slope."]',
  );
  expect(lastQuestion(chat)).toMatchObject({
    number: 1,
    assessment: { of: 4 },
  });
  const during = replay(chat);
  expect(
    whereInUnit(
      PLANS.derivative as Plan,
      during.position,
      during.finished,
      during.assessment,
    ),
  ).toEqual({
    label: "Unit gate",
    ticks: ["past", "past"],
  });
  const marker = during.items.findLast((i) => i.kind === "assessment");
  if (marker?.kind !== "assessment") throw new Error("No marker.");
  expect(assessmentMarker(marker)).toEqual({
    name: "Unit gate",
    says: "Four questions: two on this unit and two from unit 1. Nothing is taught first; each answer is recorded.",
  });

  await answer(chat, "A");
  await answer(chat, "A");
  expect(lastQuestion(chat)).toMatchObject({
    number: 3,
    assessment: { of: 4, from: LIMITS },
  });
  await answer(chat, "A");
  await answer(chat, "A");

  expect(since(chat, "assessment_end")).toEqual([
    {
      type: "assessment_end",
      mode: "gate",
      skipped: false,
      statuses: {
        slope: "retained",
        "power-rule": "retained",
        "limit-value": "retained",
        "one-sided": "retained",
      },
    },
    {
      type: "unit_end",
      passed: true,
      objectives: { slope: "retained", "power-rule": "retained" },
      gate: {
        goOver: [],
        others: [
          {
            objective: "limit-value",
            statement: "Find a limit's value from a graph or a table.",
            unit: LIMITS,
            status: "retained",
          },
          {
            objective: "one-sided",
            statement: "Tell a one-sided limit from a two-sided one.",
            unit: LIMITS,
            status: "retained",
          },
        ],
      },
    },
    {
      type: "unit_status",
      unit: "passed",
      objectives: { slope: "retained", "power-rule": "retained" },
    },
    { type: "unit_closed", status: "passed" },
  ]);
  expect(await positionOf()).toBeUndefined();
  const evidence = await reload().readEvidence(COURSE);
  expect(
    evidence
      .slice(4)
      .map((e) => (e.kind === "answer" ? [e.objective, e.assessment] : e)),
  ).toEqual([
    ["slope", { mode: "gate", unit: "derivative" }],
    ["power-rule", { mode: "gate", unit: "derivative" }],
    ["limit-value", { mode: "gate", unit: "derivative" }],
    ["one-sided", { mode: "gate", unit: "derivative" }],
  ]);
  // The last feedback ends the gate, and nothing more is sent.
  expect(sent(setup.backend)).toHaveLength(10);

  const timeline = replay(chat);
  const end = timeline.items.findLast((i) => i.kind === "assessment_end");
  if (end?.kind !== "assessment_end") throw new Error("No end marker.");
  expect(assessmentEndMarker(end)).toEqual({
    name: "Gate over",
    says: "All four retained.",
  });
  const card = closingCard(PLANS.derivative as Plan, cardOf(timeline));
  expect(card).toMatchObject({
    verdict: { text: "Passed" },
    steps: false,
    others: [
      {
        id: "limit-value",
        word: { text: "Retained" },
        why: "Unit 1: Limits",
      },
      { id: "one-sided", word: { text: "Retained" }, why: "Unit 1: Limits" },
    ],
  });
  expect(nextStep(timeline)).toBeNull();
});

test("skipping the gate on its card finishes the unit with what passed passed and nothing retained, and sends the tutor nothing", async () => {
  await makeCourse();
  const setup = setUp();
  const chat = await open(setup);
  await toGate(chat);
  const recorded = (await reload().readEvidence(COURSE)).length;

  await step(chat.skipAssessment(), chat);

  expect(since(chat, "assessment_end")).toEqual([
    { type: "assessment_end", mode: "gate", skipped: true, statuses: {} },
    {
      type: "unit_end",
      passed: true,
      objectives: { slope: "passed", "power-rule": "passed" },
      gate: { goOver: [], others: [] },
    },
    {
      type: "unit_status",
      unit: "passed",
      objectives: { slope: "passed", "power-rule": "passed" },
    },
    { type: "unit_closed", status: "passed" },
  ]);
  expect(await reload().readEvidence(COURSE)).toHaveLength(recorded);
  expect(await positionOf()).toBeUndefined();
  expect(sent(setup.backend)).toHaveLength(2);
  const timeline = replay(chat);
  const card = timeline.items.findLast((i) => i.kind === "assessment");
  if (card?.kind !== "assessment") throw new Error("No card.");
  expect(assessmentMarker(card)).toEqual({
    name: "Gate skipped",
    says: "What you passed stays passed. Nothing more is marked retained.",
  });
  expect(closingCard(PLANS.derivative as Plan, cardOf(timeline))).toMatchObject(
    { verdict: { text: "Passed" }, steps: false, others: [] },
  );
});

test("a gate skipped with another unit's question open lists it at its unchanged status, including on a reopened closing card", async () => {
  const root = await makeCourse();
  // The other unit's objective was already slipping before this gate.
  await root.appendEvidence(COURSE, {
    ...correct("limit-value", YESTERDAY),
    answer: {
      kind: "choice",
      questionId: "old-limit-miss",
      choice: "B",
      confidence: "90",
    },
    verdict: "incorrect",
    assessment: { mode: "review", unit: "derivative" },
  });
  const before = setUp();
  const first = await open(before);
  await toGate(first);
  await step(first.startAssessment(), first);
  await answer(first, "B"); // Miss slope, then get its re-ask right.
  await step(first.anotherQuestion(), first);
  await answer(first, "A");
  await answer(first, "A"); // Power rule.
  expect(lastQuestion(first).assessment?.from).toEqual(LIMITS);
  const evidence = await reload().readEvidence(COURSE);
  const expected = [
    expect.objectContaining({
      objective: "limit-value",
      status: "slipping",
      unanswered: true,
    }),
  ];

  await step(first.skipAssessment(), first);
  expect(cardOf(replay(first)).gate?.others).toEqual(expected);
  expect(
    closingCard(PLANS.derivative as Plan, cardOf(replay(first))).others,
  ).toMatchObject([{ why: "Unit 1: Limits. Not answered in the gate." }]);
  expect(await reload().readEvidence(COURSE)).toEqual(evidence);
  await before.units.close();

  const after = setUp();
  const chat = await open(after);
  expect(ofType(chat, "unit_end").at(-1)?.gate?.others).toEqual(expected);
  await after.units.close();
});

test("a finished unit reopened without the gate's skip in the transcript does not offer the withdrawn question again", async () => {
  await makeCourse();
  let loseTail = false;
  const before = setUp((root) => ({
    ...root,
    async appendTranscript(...args) {
      if (!loseTail) await root.appendTranscript(...args);
    },
  }));
  const first = await open(before);
  await toGate(first);
  await step(first.startAssessment(), first);
  const withdrawn = lastQuestion(first);
  loseTail = true;
  await step(first.skipAssessment(), first);
  await before.units.close();

  const after = setUp();
  const timeline = replay(await open(after));
  expect(timeline.finished).toBe("passed");
  expect(timeline.assessment).toBeNull();
  expect(openQuestion(timeline)).toBeUndefined();
  expect(timeline.items).toContainEqual(
    expect.objectContaining({
      kind: "question",
      question: withdrawn,
      withdrawn: true,
    }),
  );
  await after.units.close();
});

test("a miss on the unit's own objective: its detour and a second question, the closing card listing it with the two steps, kept across a restart, and going over it again closes the unit with no second gate", async () => {
  // Unit 1's objectives were answered within the hour: the gate asks the
  // unit's own two alone.
  await makeCourse({ limitsAt: LATELY });
  const before = setUp();
  const first = await open(before);
  await toGate(first);
  expect(ofType(first, "assessment")).toEqual([
    { ...GATE_OFFERED, count: 2, own: 2, from: [] },
  ]);
  await step(first.startAssessment(), first);

  await answer(first, "B");
  expect(sent(before.backend).at(-1)).toContain(
    'The miss opens a detour, a pause in the gate: no question is posted until the learner presses "Ready for another question"',
  );
  expect(nextStep(replay(first))).toBe("assessment-detour");
  expect(assessmentDetourStep(replay(first))).toEqual({
    label: "Ready for another question",
    skip: true,
  });
  await step(first.anotherQuestion(), first);
  expect(lastQuestion(first)).toMatchObject({
    number: 1,
    assessment: { of: 2, second: true },
  });
  await answer(first, "A");
  await answer(first, "A");

  // Missed, then right once: slipping, which is not passed.
  expect(since(first, "assessment_end")).toEqual([
    {
      type: "assessment_end",
      mode: "gate",
      skipped: false,
      statuses: { slope: "slipping", "power-rule": "retained" },
    },
    {
      type: "unit_end",
      passed: false,
      objectives: { slope: "slipping", "power-rule": "retained" },
      gate: { goOver: ["slope"], others: [] },
    },
  ]);
  expect(await positionOf()).toEqual({
    segment: 1,
    phase: "closed",
    gated: true,
  });
  expect(
    closingCard(PLANS.derivative as Plan, cardOf(replay(first))),
  ).toMatchObject({
    verdict: { text: "One not passed" },
    steps: true,
    again: "Go over it again",
  });
  await before.units.close();

  const after = setUp();
  const chat = await open(after);
  // The card is shown again, and no second gate offered.
  expect(since(chat, "session").slice(3)).toEqual([
    { type: "phase", segment: 1, phase: "closed" },
    {
      type: "unit_end",
      passed: false,
      objectives: { slope: "slipping", "power-rule": "retained" },
      gate: { goOver: ["slope"], others: [] },
    },
  ]);
  expect(sent(after.backend)).toEqual([]);

  await step(chat.goOverAgain(), chat);
  expect(sent(after.backend)[0]).toMatch(
    /^\[Unit 2 of 2, "The derivative"; a segment after the plan's 2, going over "slope" again\. Phase: teach\./,
  );
  expect(await positionOf()).toEqual({
    segment: 2,
    phase: "discuss",
    again: ["slope"],
    gated: true,
  });
  await step(chat.ready(), chat);
  // With the gate's right answer since the miss, one more passes it.
  await answer(chat, "A");

  expect(since(chat, "unit_end")).toEqual([
    {
      type: "unit_end",
      passed: true,
      objectives: { slope: "retained", "power-rule": "retained" },
      gate: { goOver: [], others: [] },
    },
    {
      type: "unit_status",
      unit: "passed",
      objectives: { slope: "retained", "power-rule": "retained" },
    },
    { type: "unit_closed", status: "passed" },
  ]);
  expect(
    ofType(chat, "assessment").filter((e) => e.stage === "offered"),
  ).toHaveLength(1);
  expect(await positionOf()).toBeUndefined();
});

test("a miss on another unit's objective leaves it slipping and that unit finished, and the closing card lists it under the unit's own", async () => {
  await makeCourse();
  const setup = setUp();
  const limits = await open(setup, "limits");
  const chat = await open(setup);
  await toGate(chat);
  await step(chat.startAssessment(), chat);

  await answer(chat, "A");
  await answer(chat, "A");
  await answer(chat, "B"); // limit-value
  await step(chat.anotherQuestion(), chat);
  await answer(chat, "A");
  await answer(chat, "A");

  expect(since(chat, "unit_end")).toEqual([
    {
      type: "unit_end",
      passed: true,
      objectives: { slope: "retained", "power-rule": "retained" },
      gate: {
        goOver: [],
        others: [
          expect.objectContaining({
            objective: "limit-value",
            status: "slipping",
          }),
          expect.objectContaining({
            objective: "one-sided",
            status: "retained",
          }),
        ],
      },
    },
    expect.objectContaining({ type: "unit_status", unit: "passed" }),
    { type: "unit_closed", status: "passed" },
  ]);
  // Unit 1's open chat learned the answers: it stays finished.
  expect(ofType(limits, "unit_status").at(-1)).toEqual({
    type: "unit_status",
    unit: "passed",
    objectives: { "limit-value": "slipping", "one-sided": "retained" },
  });
  expect(
    objectiveStatus(await reload().readEvidence(COURSE), "limit-value"),
  ).toBe("slipping");
  expect(
    closingCard(PLANS.derivative as Plan, cardOf(replay(chat))).others[0],
  ).toMatchObject({
    word: { text: "Slipping" },
    why: "Unit 1: Limits. Missed in the gate: review comes back to it first.",
  });
});

// --- Restarts ----------------------------------------------------------------

test("a restart at the gate's card shows it again and waits; one in the gate reopens its open question, and the gate goes on", async () => {
  await makeCourse();
  const first = setUp();
  await toGate(await open(first));
  await first.units.close();

  const second = setUp();
  const atCard = await open(second);
  expect(since(atCard, "session").slice(3)).toEqual([
    { type: "phase", segment: 1, phase: "closed" },
    GATE_OFFERED,
  ]);
  expect(sent(second.backend)).toEqual([]);
  await step(atCard.startAssessment(), atCard);
  const asked = lastQuestion(atCard);
  await second.units.close();

  const third = setUp();
  const inGate = await open(third);
  expect(since(inGate, "session").slice(3)).toEqual([
    { type: "phase", segment: 1, phase: "closed" },
    { ...GATE_OFFERED, stage: "on" },
    expect.objectContaining({
      type: "question",
      question: expect.objectContaining({
        id: asked.id,
        assessment: { of: 4 },
      }),
    }),
  ]);
  expect(sent(third.backend)).toEqual([]);
  expect(nextStep(replay(inGate))).toBe("assessment");

  await answer(inGate, "A");
  expect(lastQuestion(inGate)).toMatchObject({
    number: 2,
    assessment: { of: 4 },
  });
  expect(await positionOf()).toMatchObject({
    assessment: { mode: "gate", stage: "on" },
    openQuestion: { objective: "power-rule" },
  });
});

// --- Nothing to ask ----------------------------------------------------------

test("a unit whose gate has nothing to ask finishes as before: every objective moved on from, and the other units' answered within the hour", async () => {
  await makeCourse({ limitsAt: LATELY, slope: false });
  const setup = setUp();
  const chat = await open(setup);
  await step(chat.override(), chat);
  expect(since(chat, "unit_end")).toEqual([
    {
      type: "unit_end",
      passed: false,
      objectives: { slope: "not-started", "power-rule": "overridden" },
    },
  ]);

  await step(chat.finishUnit(), chat);

  expect(since(chat, "unit_end").slice(1)).toEqual([
    expect.objectContaining({ type: "unit_status" }),
    { type: "moved_on", objectives: ["slope", "power-rule"] },
    {
      type: "unit_status",
      unit: "overridden",
      objectives: { slope: "overridden", "power-rule": "overridden" },
    },
    { type: "unit_closed", status: "overridden" },
  ]);
  expect(ofType(chat, "assessment")).toEqual([]);
  expect(await positionOf()).toBeUndefined();
  const timeline = replay(chat);
  expect(cardOf(timeline).stepTaken).toBe("moved-on");
  expect(nextStep(timeline)).toBe("leave");
});
