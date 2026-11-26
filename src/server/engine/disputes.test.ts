import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { CurriculumProposal } from "../../shared/curriculum.ts";
import type { PageEvent } from "../../shared/events.ts";
import type { EvidenceEntry } from "../../shared/evidence.ts";
import type { Plan } from "../../shared/plan.ts";
import type { ChoiceLetter, Confidence } from "../../shared/question.ts";
import type { UnitPosition } from "../../shared/state.ts";
import { emptyTimeline, reduce, standingCard } from "../../shared/timeline.ts";
import {
  createFakeBackend,
  type FakeReply,
  type FakeTurn,
} from "../backends/fake.ts";
import { openDataRoot } from "../record/data-root.ts";
import { whatIKnow } from "../record/what-i-know.ts";
import { givenOrder } from "./choice-order.ts";
import { createDisputeJudge } from "./dispute-judge.ts";
import { createDisputes, gradedBy } from "./disputes.ts";
import { createFakeTimer } from "./fake-timer.ts";
import { createGrader, mathRubric } from "./grading.ts";
import { createHelpJudge } from "./help-judge.ts";
import { createUnitChats, type UnitChat } from "./unit-chat.ts";
import { createUnitPlanner } from "./unit-planning.ts";

// Disputes through the engine (task 3.8), on hand-made records and the fake
// backend. Each test gets its own data root; none touches ~/gauss
// (AGENTS.md). Every expected status was worked out by hand from the
// passing rule (docs/brief.md, "Mastery and evidence") with each disputed
// answer counted by its outcome's verdict.

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "gauss-disputes-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const NOW = "2026-11-17T10:00:00.000Z";
const COURSE = "derivatives";
const UNIT = "derivative";

const CURRICULUM: CurriculumProposal = {
  title: "Derivatives",
  units: [
    {
      id: UNIT,
      title: "The derivative",
      goal: "Compute a derivative from its definition.",
      prerequisites: [],
    },
  ],
  style: "Short explanations.",
  background: "The learner knows limits.",
};

const PLAN: Plan = {
  objectives: [
    { id: "quotient", statement: "Form a difference quotient." },
    { id: "limit", statement: "Take the limit of difference quotients." },
  ],
  segments: [
    { title: "Quotients", objectives: ["quotient"] },
    { title: "Limits", objectives: ["limit"] },
  ],
};

const QUESTION = {
  kind: "choice" as const,
  prompt: "Which is the difference quotient of $f$ at $a$?",
  choices: ["$f(a+h)-f(a)$", "$\\frac{f(a+h)-f(a)}{h}$", "$\\frac{f(a)}{h}$"],
  // A wrong key: B is the difference quotient.
  answer: "A" as ChoiceLetter,
};

async function makeCourse(): Promise<void> {
  const root = openDataRoot({ path: dir, now: () => new Date(NOW) });
  const { id } = await root.createCourse({ title: CURRICULUM.title });
  await root.saveProposal(id, CURRICULUM);
  await root.approveCurriculum(id, CURRICULUM);
  await root.storePlan(id, UNIT, PLAN);
}

const reload = () => openDataRoot({ path: dir });

/** A choice answer of a hand-made record: B picked, graded against `key`. */
function choiceAnswer(
  questionId: string,
  objective: string,
  key: ChoiceLetter,
  confidence: Confidence = "100",
): EvidenceEntry {
  return {
    kind: "answer",
    recordedAt: NOW,
    objective,
    question: {
      ...QUESTION,
      prompt: `${QUESTION.prompt} (${questionId})`,
      answer: key,
    },
    answer: { kind: "choice", questionId, choice: "B", confidence },
    assisted: false,
    verdict: key === "B" ? "correct" : "incorrect",
  };
}

function setUp(script: FakeTurn[], rulings: FakeReply[] | (() => FakeReply)) {
  const backend = createFakeBackend(script, []);
  const judgeBackend = createFakeBackend([], rulings);
  const dataRoot = openDataRoot({ path: dir, now: () => new Date(NOW) });
  const units = createUnitChats({
    backends: { claude: backend },
    systemPrompt: "You are a test tutor.",
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
    now: () => new Date(NOW),
    timer: createFakeTimer(),
    order: givenOrder,
  });
  const disputes = createDisputes({
    dataRoot,
    units,
    judge: createDisputeJudge({
      backend: judgeBackend,
      systemPrompt: "Decide.",
    }),
    now: () => new Date(NOW),
  });
  return { backend, judgeBackend, units, disputes };
}

async function open(setup: ReturnType<typeof setUp>): Promise<UnitChat> {
  const opened = await setup.units.open(COURSE, UNIT);
  if (!opened.ok) throw new Error(opened.error);
  await opened.chat.settled();
  return opened.chat;
}

function lastQuestionId(chat: UnitChat): string {
  const posted = chat.events().findLast((e) => e.type === "question");
  if (posted?.type !== "question") throw new Error("no question posted");
  return posted.question.id;
}

const statusOf = (chat: UnitChat) =>
  chat.events().findLast((e) => e.type === "unit_status");

const ruling = (
  verdict: "correct" | "incorrect",
  key?: ChoiceLetter,
): FakeReply => ({
  output: {
    reason: `Decided ${verdict}.`,
    verdict,
    ...(key === undefined ? {} : { key }),
  },
});

test("an overturned miss with a corrected key keeps the first grade, passes the objective, is told in the tutor's next header, leaves the detour open, and another question then closes the segment", async () => {
  const setup = setUp(
    [
      [{ text: "A difference quotient divides by $h$." }],
      [
        { text: "A question." },
        { call: "ask_question", input: { objective: "quotient", ...QUESTION } },
      ],
      [{ text: "The answer is A. Where did B come from?" }],
      [{ text: "Noted: the key was wrong." }],
    ],
    [ruling("correct", "B")],
  );
  await makeCourse();
  const chat = await open(setup);
  expect(await chat.ready()).toEqual({ ok: true });
  await chat.settled();
  const questionId = lastQuestionId(chat);
  expect(
    await chat.answer({
      kind: "choice",
      questionId,
      choice: "B",
      confidence: "90",
    }),
  ).toEqual({ ok: true });
  await chat.settled();
  expect(statusOf(chat)).toEqual({
    type: "unit_status",
    unit: "in-progress",
    objectives: { quotient: "attempted", limit: "not-started" },
  });

  const raised = await setup.disputes.raise(
    COURSE,
    questionId,
    "  B divides by h; A does not.  ",
  );

  const dispute = {
    kind: "dispute",
    recordedAt: NOW,
    questionId,
    reason: "B divides by h; A does not.",
    outcome: { verdict: "correct", reason: "Decided correct.", key: "B" },
  };
  expect(raised).toEqual({ ok: true, dispute });
  // The answer keeps its first grade; the dispute follows it.
  const evidence = await reload().readEvidence(COURSE);
  expect(
    evidence.map((e) => [e.kind, "verdict" in e ? e.verdict : undefined]),
  ).toEqual([
    ["answer", "incorrect"],
    ["dispute", undefined],
  ]);
  expect(evidence[1]).toEqual(dispute);
  // Never missed now, at 90%: passed.
  const events = chat.events();
  expect(events.slice(-2)).toEqual([
    {
      type: "disputed",
      questionId,
      dispute: {
        recordedAt: NOW,
        reason: dispute.reason,
        outcome: dispute.outcome,
      },
    },
    {
      type: "unit_status",
      unit: "in-progress",
      objectives: { quotient: "passed", limit: "not-started" },
    },
  ]);
  // An outcome changes no phase: the detour is still open.
  const state = await reload().readState(COURSE);
  expect(state.units[UNIT]?.detour?.questionId).toBe(questionId);
  // The page's card reads the outcome.
  const timeline = events.reduce(
    (t, event, index) => reduce(t, { type: "event", index, event }),
    reduce(emptyTimeline, { type: "hello", chatId: chat.id }),
  );
  const card = timeline.items.find((i) => i.kind === "question");
  expect(card?.kind === "question" ? card.dispute : undefined).toEqual({
    recordedAt: NOW,
    reason: dispute.reason,
    outcome: dispute.outcome,
  });

  // The tutor hears it with its next turn, once.
  expect(await chat.say("Did my dispute go through?")).toEqual({ ok: true });
  await chat.settled();
  const header = setup.backend.received.at(-1)?.text ?? "";
  expect(header).toContain(
    'The learner disputed the grade of their answer to a question on "quotient" ' +
      '("Which is the difference quotient of $f$ at $a$?"), giving this reason: ' +
      '"B divides by h; A does not.". A separate judge, which saw the question, ' +
      "what it was graded by, the answer and that reason, changed the grade from " +
      "incorrect to correct. The key was wrong: the correct choice is B, not A. " +
      "Its reason: Decided correct. The answer now counts as correct, and where " +
      "the check stands follows from that.",
  );
  expect(header).toContain('In this check, "quotient": passed.');

  // Nothing is left to ask, so ending the detour closes the segment.
  const turns = setup.backend.received.length;
  expect(await chat.anotherQuestion()).toEqual({ ok: true });
  await chat.settled();
  expect(setup.backend.received).toHaveLength(turns);
  expect((await reload().readState(COURSE)).units[UNIT]).toMatchObject({
    segment: 0,
    phase: "closed",
  });

  // What I know shows the first grade with the outcome, and the status.
  const stored = await reload().readCourse(COURSE);
  if (stored?.curriculum == null) throw new Error("no curriculum");
  const known = whatIKnow(
    stored.course.title,
    stored.curriculum,
    await reload().readState(COURSE),
    await reload().readEvidence(COURSE),
  );
  const objective = known.units[0]?.objectives?.[0];
  expect(objective?.status).toBe("passed");
  expect(objective?.evidence[0]).toMatchObject({
    verdict: "incorrect",
    question: { answer: "A" },
    dispute: { outcome: { verdict: "correct", key: "B" } },
  });
  // Calibration counts the corrected verdict: 90%, one of one.
  expect(known.calibration.levels[3]).toEqual({
    confidence: "90",
    correct: 1,
    answered: 1,
  });
});

test("a second dispute of one answer is refused, and so is one sent while the first is being decided", async () => {
  await makeCourse();
  await reload().appendEvidence(COURSE, choiceAnswer("q1", "quotient", "A"));
  const asked = Promise.withResolvers<void>();
  const decision = Promise.withResolvers<FakeReply>();
  const reply = vi
    .fn<() => FakeReply>(() => ({
      fail: "Unexpected additional judge request.",
    }))
    .mockImplementationOnce(() => {
      asked.resolve();
      return { later: decision.promise };
    });
  const setup = setUp([], reply);

  const first = setup.disputes.raise(COURSE, "q1", "B is right.");
  let outcome: Awaited<typeof first>;
  try {
    await Promise.race([asked.promise, first]);
    expect(setup.judgeBackend.oneShots).toHaveLength(1);
    expect(await setup.disputes.raise(COURSE, "q1", "Again.")).toEqual({
      ok: false,
      status: 409,
      error: "A dispute of this grade is being decided.",
    });
  } finally {
    decision.resolve(ruling("incorrect"));
    outcome = await first;
  }
  expect(outcome.ok).toBe(true);
  expect(await setup.disputes.raise(COURSE, "q1", "Again.")).toEqual({
    ok: false,
    status: 409,
    error:
      "This grade was disputed once already, and a grade can be disputed only once.",
  });
  // The judge was asked once.
  expect(setup.judgeBackend.oneShots).toHaveLength(1);
  const evidence = await reload().readEvidence(COURSE);
  expect(evidence.filter((e) => e.kind === "dispute")).toHaveLength(1);
});

test('"I don\'t know" to a written question cannot be reported, nor a question with no answer recorded, and neither asks the judge; nothing graded an "I don\'t know"', async () => {
  await makeCourse();
  await reload().appendEvidence(COURSE, {
    kind: "answer",
    recordedAt: NOW,
    objective: "quotient",
    question: { kind: "written", prompt: "Why?", rubric: "Because." },
    answer: { kind: "unknown", questionId: "q-idk" },
    assisted: false,
    verdict: "unknown",
  });
  const setup = setUp([], []);

  expect(await setup.disputes.raise(COURSE, "q-idk", "I guessed.")).toEqual({
    ok: false,
    status: 409,
    error: `"I don't know" to a written question was shown no answer, so there is none to report as wrong.`,
  });
  expect(await setup.disputes.gradedBy(COURSE, "q-idk")).toEqual({
    ok: false,
    status: 409,
    error: `"I don't know" was not graded, so nothing graded it.`,
  });
  expect(await setup.disputes.raise(COURSE, "q-open", "Wrong.")).toEqual({
    ok: false,
    status: 404,
    error: "No answer to that question is recorded in this course.",
  });
  expect(await setup.disputes.raise("no-course", "q-idk", "Wrong.")).toEqual({
    ok: false,
    status: 404,
    error: "No such course.",
  });
  expect(setup.judgeBackend.oneShots).toHaveLength(0);
  expect(
    (await reload().readEvidence(COURSE)).filter((e) => e.kind === "dispute"),
  ).toEqual([]);
});

test("an \"I don't know\" whose answer shown the judge corrects stays a miss for status and calibration, with the corrected key in What I know and in the tutor's next header", async () => {
  const setup = setUp(
    [
      [{ text: "A difference quotient divides by $h$." }],
      [
        { text: "A question." },
        { call: "ask_question", input: { objective: "quotient", ...QUESTION } },
      ],
      [{ text: "The answer is A. What did you try?" }],
      [{ text: "Noted: the answer shown was wrong." }],
    ],
    // The judge gives "incorrect", as its prompt asks for an "I don't know".
    [ruling("incorrect", "B")],
  );
  await makeCourse();
  const chat = await open(setup);
  expect(await chat.ready()).toEqual({ ok: true });
  await chat.settled();
  const questionId = lastQuestionId(chat);
  expect(await chat.answer({ kind: "unknown", questionId })).toEqual({
    ok: true,
  });
  await chat.settled();

  const raised = await setup.disputes.raise(
    COURSE,
    questionId,
    "A does not divide by h, so it cannot be the quotient.",
  );

  const dispute = {
    kind: "dispute",
    recordedAt: NOW,
    questionId,
    reason: "A does not divide by h, so it cannot be the quotient.",
    outcome: { verdict: "unknown", reason: "Decided incorrect.", key: "B" },
  };
  expect(raised).toEqual({ ok: true, dispute });
  expect((await reload().readEvidence(COURSE)).at(-1)).toEqual(dispute);
  // Still a miss: attempted, not passed.
  expect(statusOf(chat)).toEqual({
    type: "unit_status",
    unit: "in-progress",
    objectives: { quotient: "attempted", limit: "not-started" },
  });
  // The card shows the corrected key, and the verdict it had.
  const timeline = chat
    .events()
    .reduce(
      (t, event, index) => reduce(t, { type: "event", index, event }),
      reduce(emptyTimeline, { type: "hello", chatId: chat.id }),
    );
  const card = timeline.items.find((i) => i.kind === "question");
  expect(card?.kind === "question" ? card.dispute?.outcome : undefined).toEqual(
    dispute.outcome,
  );

  expect(await chat.say("Was I right about A?")).toEqual({ ok: true });
  await chat.settled();
  const header = setup.backend.received.at(-1)?.text ?? "";
  expect(header).toContain(
    `The learner answered "I don't know" to a question on "quotient" ` +
      '("Which is the difference quotient of $f$ at $a$?"), then said the ' +
      "answer shown to them was wrong, giving this reason: " +
      '"A does not divide by h, so it cannot be the quotient.". A separate ' +
      "judge, which saw the question, the answer shown and that reason, found " +
      "it wrong: the correct choice is B, not A. Its reason: Decided " +
      `incorrect. The answer still counts as "I don't know", a miss.`,
  );

  const stored = await reload().readCourse(COURSE);
  if (stored?.curriculum == null) throw new Error("no curriculum");
  const known = whatIKnow(
    stored.course.title,
    stored.curriculum,
    await reload().readState(COURSE),
    await reload().readEvidence(COURSE),
  );
  const objective = known.units[0]?.objectives?.[0];
  expect(objective?.status).toBe("attempted");
  expect(objective?.evidence[0]).toMatchObject({
    verdict: "unknown",
    question: { answer: "A" },
    dispute: { outcome: { verdict: "unknown", key: "B" } },
  });
  // Counted as "I don't know", at no confidence.
  expect(known.calibration.unknown).toBe(1);
  expect(known.calibration.levels.every((l) => l.answered === 0)).toBe(true);
  // Reported once, as a dispute is.
  expect(
    await setup.disputes.raise(COURSE, questionId, "Again."),
  ).toMatchObject({ ok: false, status: 409 });
});

test("a judge that fails records nothing, and the dispute can be sent again", async () => {
  await makeCourse();
  await reload().appendEvidence(COURSE, choiceAnswer("q1", "quotient", "A"));
  const setup = setUp(
    [],
    [{ fail: "The model is unavailable." }, ruling("correct", "B")],
  );

  expect(await setup.disputes.raise(COURSE, "q1", "B is right.")).toEqual({
    ok: false,
    status: 502,
    error:
      "The dispute could not be decided, and nothing was recorded: The model is unavailable.",
  });
  expect(
    (await reload().readEvidence(COURSE)).filter((e) => e.kind === "dispute"),
  ).toEqual([]);
  expect((await setup.disputes.raise(COURSE, "q1", "B is right.")).ok).toBe(
    true,
  );
});

test("an overturned pass in a finished unit records its objective as overridden with it, so the unit stays finished and is not taught again", async () => {
  await makeCourse();
  // Both objectives passed at 100%, and the unit closed: no position.
  await reload().appendEvidence(COURSE, choiceAnswer("q1", "quotient", "B"));
  await reload().appendEvidence(COURSE, choiceAnswer("q2", "limit", "B"));
  const setup = setUp([], [ruling("incorrect", "C")]);

  expect((await setup.disputes.raise(COURSE, "q1", "I guessed.")).ok).toBe(
    true,
  );

  const evidence = await reload().readEvidence(COURSE);
  expect(evidence.slice(2)).toEqual([
    {
      kind: "dispute",
      recordedAt: NOW,
      questionId: "q1",
      reason: "I guessed.",
      outcome: { verdict: "incorrect", reason: "Decided incorrect.", key: "C" },
    },
    { kind: "override", recordedAt: NOW, objectives: ["quotient"] },
  ]);
  const chat = await open(setup);
  expect(chat.events()).toContainEqual({
    type: "unit_closed",
    status: "overridden",
  });
  expect(setup.backend.received).toEqual([]);
  expect((await reload().readState(COURSE)).units).toEqual({});
});

test("in a finished unit whose chat is open, an overturned pass is recorded through the chat with its override, and the unit's status follows", async () => {
  await makeCourse();
  await reload().appendEvidence(COURSE, choiceAnswer("q1", "quotient", "B"));
  await reload().appendEvidence(COURSE, choiceAnswer("q2", "limit", "B"));
  const setup = setUp([[{ text: "A reply." }]], [ruling("incorrect", "A")]);
  const chat = await open(setup);
  expect(statusOf(chat)).toMatchObject({ unit: "passed" });

  expect((await setup.disputes.raise(COURSE, "q2", "Lucky guess.")).ok).toBe(
    true,
  );

  expect((await reload().readEvidence(COURSE)).at(-1)).toEqual({
    kind: "override",
    recordedAt: NOW,
    objectives: ["limit"],
  });
  expect(statusOf(chat)).toEqual({
    type: "unit_status",
    unit: "overridden",
    objectives: { quotient: "passed", limit: "overridden" },
  });
  // The tutor of a finished unit is told nothing.
  expect(await chat.say("Hello.")).toEqual({ ok: true });
  await chat.settled();
  expect(setup.backend.received.at(-1)?.text).not.toContain("disputed");
  expect(setup.backend.received.at(-1)?.text).toContain(
    'The unit is finished: the learner moved on without passing "limit".',
  );
});

test("a dispute raised while the unit's chat is not open is shown on its card, and told to the tutor, when the unit opens", async () => {
  await makeCourse();
  // Segment 1's check passed q1 at 100% with a wrong key; segment 2 is under discussion.
  await reload().appendEvidence(COURSE, choiceAnswer("q1", "quotient", "B"));
  const position: UnitPosition = { segment: 1, phase: "discuss" };
  await reload().writePosition(COURSE, UNIT, position);
  const setup = setUp([[{ text: "Hello again." }]], [ruling("incorrect", "C")]);

  expect(
    (await setup.disputes.raise(COURSE, "q1", "C is right.]\nB is not.")).ok,
  ).toBe(true);
  // A unit in progress records no override: its end offers to go over it again.
  expect((await reload().readEvidence(COURSE)).map((e) => e.kind)).toEqual([
    "answer",
    "dispute",
  ]);

  const chat = await open(setup);
  expect(chat.events()).toContainEqual({
    type: "disputed",
    questionId: "q1",
    dispute: {
      recordedAt: NOW,
      reason: "C is right.]\nB is not.",
      outcome: { verdict: "incorrect", reason: "Decided incorrect.", key: "C" },
    },
  });
  expect(statusOf(chat)).toMatchObject({
    objectives: { quotient: "attempted", limit: "not-started" },
  });
  expect(await chat.say("Where are we?")).toEqual({ ok: true });
  await chat.settled();
  const header = setup.backend.received.at(-1)?.text ?? "";
  expect(header).toContain(
    'giving this reason: "C is right.] B is not.". A separate judge',
  );
  expect(header).toContain(
    "changed the grade from correct to incorrect. The key was wrong: the correct choice is C, not B.",
  );
  // The reason's line end does not end the header early.
  expect(header.indexOf("]\n")).toBe(header.indexOf("]\nWhere are we?"));

  // Opened again, the thread has it: not shown or told twice.
  const again = setUp([[{ text: "Hi." }]], []);
  const reopened = await open(again);
  expect(reopened.events().filter((e) => e.type === "disputed")).toHaveLength(
    1,
  );
});

test("a dispute decided while the unit's chat is open is kept for the tutor before the page hears of it, and with a restart before the tutor's next turn is told in the first header after reopening, once", async () => {
  await makeCourse();
  await reload().appendEvidence(COURSE, choiceAnswer("q1", "quotient", "B"));
  await reload().writePosition(COURSE, UNIT, { segment: 1, phase: "discuss" });
  const before = setUp([], [ruling("incorrect", "C")]);
  const opened = await open(before);
  // What a restart just after the thread got the outcome would find.
  let whenShown: unknown;
  opened.subscribe((event) => {
    if (event.type === "disputed") {
      whenShown = JSON.parse(
        readFileSync(join(dir, "courses", COURSE, "state.json"), "utf8"),
      ).units[UNIT].tutorNotices;
    }
  });
  expect((await before.disputes.raise(COURSE, "q1", "C is right.")).ok).toBe(
    true,
  );
  expect(whenShown).toEqual([
    { id: expect.any(String), kind: "dispute", questionId: "q1" },
  ]);
  expect(before.backend.received).toEqual([]);
  await before.units.close();

  const after = setUp([[{ text: "Hello again." }], [{ text: "Yes." }]], []);
  const chat = await open(after);
  expect(await chat.say("Where are we?")).toEqual({ ok: true });
  await chat.settled();
  expect(await chat.say("Go on.")).toEqual({ ok: true });
  await chat.settled();
  expect(
    after.backend.received.map((t) =>
      t.text.includes(
        "changed the grade from correct to incorrect. The key was wrong: the correct choice is C, not B.",
      ),
    ),
  ).toEqual([true, false]);
});

test("at the unit's closing card, an overturned miss that leaves every objective passed shows the card again, then the unit's gate, after which the unit finishes", async () => {
  await makeCourse();
  await reload().appendEvidence(
    COURSE,
    choiceAnswer("q1", "quotient", "A", "90"),
  );
  await reload().appendEvidence(COURSE, choiceAnswer("q2", "limit", "B"));
  await reload().writePosition(COURSE, UNIT, { segment: 1, phase: "closed" });
  const setup = setUp([], [ruling("correct", "B")]);
  const chat = await open(setup);
  expect(chat.events().findLast((e) => e.type === "unit_end")).toEqual({
    type: "unit_end",
    passed: false,
    objectives: { quotient: "attempted", limit: "passed" },
    gateFollows: true,
    finishId: expect.any(String),
  });

  expect((await setup.disputes.raise(COURSE, "q1", "B is right.")).ok).toBe(
    true,
  );

  expect(chat.events().slice(-2)).toEqual<PageEvent[]>([
    {
      type: "unit_end",
      passed: true,
      objectives: { quotient: "passed", limit: "passed" },
    },
    {
      type: "assessment",
      mode: "gate",
      stage: "offered",
      count: 2,
      own: 2,
      from: [],
    },
  ]);
  expect(await chat.skipAssessment()).toEqual({ ok: true });
  await chat.settled();
  expect(chat.events().slice(-2)).toEqual<PageEvent[]>([
    {
      type: "unit_status",
      unit: "passed",
      objectives: { quotient: "passed", limit: "passed" },
    },
    { type: "unit_closed", status: "passed" },
  ]);
  expect((await reload().readState(COURSE)).units).toEqual({});
  // The page shows the card as the dispute left it, no longer live, then
  // the gate's, then the card after the gate.
  const timeline = chat
    .events()
    .reduce(
      (t, event, index) => reduce(t, { type: "event", index, event }),
      reduce(emptyTimeline, { type: "hello", chatId: chat.id }),
    );
  const cards = timeline.items.filter((i) => i.kind === "unit_end");
  expect(cards).toMatchObject([
    { passed: true },
    { passed: true, gate: { goOver: [] } },
  ]);
  expect(standingCard(timeline.items)).toBe(cards[1]);
});

test("what an answer was graded by: the key, the expected expression with the grader's rubric when the check left it, the rubric, or the tests with their command", () => {
  const answer = choiceAnswer("q1", "quotient", "A");
  if (answer.kind !== "answer") throw new Error("not an answer");
  expect(gradedBy(answer)).toEqual({ kind: "choice", key: "A" });
  const math = {
    kind: "math" as const,
    prompt: "Differentiate $x^3$.",
    expected: "3x^2",
  };
  const mathAnswer = {
    ...answer,
    question: math,
    answer: {
      kind: "math" as const,
      questionId: "q-m",
      expression: "3x^2 \\oops",
      confidence: "50" as const,
    },
  };
  expect(gradedBy(mathAnswer)).toEqual({ kind: "math", expected: "3x^2" });
  expect(
    gradedBy({
      ...mathAnswer,
      unsettled: { result: "unparsable", reason: "\\oops" },
    }),
  ).toEqual({ kind: "math", expected: "3x^2", rubric: mathRubric(math) });
  expect(
    gradedBy({
      ...answer,
      answer: { kind: "unknown", questionId: "q-u" },
      verdict: "unknown",
    }),
  ).toBeUndefined();
});
