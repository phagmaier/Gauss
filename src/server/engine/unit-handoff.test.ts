// Handoff notes and the misconception record in unit chats (task 5.7):
// the handoff writer called when a
// segment closes and when the unit finishes, on the stretch since the call
// before; its note replacing the one before and its misconceptions
// appended; a failed call; and what reads them: a fresh session's first
// turn, a later unit's planning and tutor, a review's question turns and
// "What I know". The fake backend's tutor does what each header allows.

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import type { CurriculumProposal } from "../../shared/curriculum.ts";
import type { PageEvent } from "../../shared/events.ts";
import type { AnswerEvidence } from "../../shared/evidence.ts";
import type { HandoffReply } from "../../shared/handoff.ts";
import type { Misconception } from "../../shared/misconception.ts";
import type { Plan } from "../../shared/plan.ts";
import type { ChoiceQuestion, Confidence } from "../../shared/question.ts";
import type { EngineTurn } from "../backends/backend.ts";
import {
  createFakeBackend,
  type FakeBackend,
  type FakeReply,
  type FakeStep,
} from "../backends/fake.ts";
import { type DataRoot, openDataRoot } from "../record/data-root.ts";
import { whatIKnow } from "../record/what-i-know.ts";
import { givenOrder } from "./choice-order.ts";
import { createFakeTimer } from "./fake-timer.ts";
import { createGrader } from "./grading.ts";
import { createHandoffs, createHandoffWriter } from "./handoff.ts";
import { createHelpJudge } from "./help-judge.ts";
import { createUnitChats, type UnitChat } from "./unit-chat.ts";
import { createUnitPlanner } from "./unit-planning.ts";
import { disputedEvent, gradedEvent } from "./unit-record.ts";
import { JOINED_NOTE } from "./unit-turns.ts";

// Each test gets its own data root; none touches ~/gauss (AGENTS.md).
let dir: string;
let clock: Date;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "gauss-unit-handoff-"));
  clock = new Date(NOW);
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const NOW = "2026-11-18T12:00:00.000Z";
const YESTERDAY = "2026-11-17T12:00:00.000Z";
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
      prerequisites: [],
    },
  ],
  style: "Short.",
  background: "Knows algebra.",
};

const PLANS: Record<string, Plan> = {
  limits: {
    objectives: [
      { id: "limit-value", statement: "Find a limit's value from a table." },
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
    ],
    segments: [{ title: "Slopes", objectives: ["slope"] }],
  },
  integral: {
    objectives: [{ id: "area", statement: "Read an integral as an area." }],
    segments: [{ title: "Areas", objectives: ["area"] }],
  },
};

/** The course, approved, with the plans of the units named. */
async function makeCourse(planned = Object.keys(PLANS)): Promise<DataRoot> {
  const root = openDataRoot({ path: dir, now: () => new Date(YESTERDAY) });
  const { id } = await root.createCourse({ title: CURRICULUM.title });
  await root.saveProposal(id, CURRICULUM);
  await root.approveCurriculum(id, CURRICULUM);
  for (const unit of planned) {
    const plan = PLANS[unit];
    if (plan !== undefined) await root.storePlan(id, unit, plan);
  }
  return root;
}

/** An answer at that confidence, recorded at `at`. */
function answered(
  objective: string,
  verdict: "correct" | "incorrect",
  at = YESTERDAY,
  confidence: Confidence = "90",
): AnswerEvidence {
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
      questionId: `seeded-${objective}-${verdict}`,
      choice: verdict === "correct" ? "A" : "B",
      confidence,
    },
    assisted: false,
    verdict,
  };
}

function misconception(
  objective: string,
  believed: string,
  unit = "limits",
): Misconception {
  return {
    recordedAt: YESTERDAY,
    unit,
    objective,
    believed,
    actually: `What is so about ${objective}.`,
    where: { in: "discussion" },
  };
}

/**
 * A tutor that does what each header allows: teaches, naming the segment;
 * opens a detour; gives feedback; posts a choice question, numbered on,
 * whose right choice is A, on the objective a header asks about; or
 * replies. A planning session plans the unit.
 */
function tutor() {
  let asked = 0;
  return (turn: EngineTurn): FakeStep[] => {
    const { text } = turn;
    const planning = /^\[Plan unit .*\(id "([^"]+)"\)/.exec(text)?.[1];
    if (planning !== undefined) {
      return [{ call: "plan_unit", input: PLANS[planning] }];
    }
    const objective = /a question on "([^"]+)" with ask_question/.exec(
      text,
    )?.[1];
    if (text.includes("The miss opens a detour")) {
      return [{ text: "Detour: the limit is where values head." }];
    }
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
    const segment = /segment \d+ of \d+, "([^"]+)"/.exec(text)?.[1];
    if (text.includes("Allowed now: teach")) {
      return [{ text: `Teaching "${segment}".` }];
    }
    return [{ text: "Reply." }];
  };
}

/** A note numbered by the call, and the misconceptions given for that call. */
function writer(found: Record<number, HandoffReply["misconceptions"]> = {}) {
  let calls = 0;
  return (): FakeReply => {
    calls += 1;
    return {
      output: { note: `Note ${calls}.`, misconceptions: found[calls] ?? [] },
    };
  };
}

function setUp(
  handoffReplies: FakeReply[] | (() => FakeReply) = writer(),
  script: (turn: EngineTurn) => FakeStep[] = tutor(),
) {
  const backend = createFakeBackend((turn) => script(turn), []);
  const handoffBackend = createFakeBackend([], handoffReplies);
  const dataRoot = openDataRoot({ path: dir, now: () => clock });
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
    handoff: createHandoffWriter({
      backend: handoffBackend,
      systemPrompt: "Handoff.",
    }),
    now: () => clock,
    timer: createFakeTimer(),
    order: givenOrder,
  });
  return { backend, handoffBackend, dataRoot, units };
}

async function open(
  setup: ReturnType<typeof setUp>,
  unit = "limits",
): Promise<UnitChat> {
  const opened = await setup.units.open(COURSE, unit);
  if (!opened.ok) throw new Error(opened.error);
  await opened.chat.settled();
  return opened.chat;
}

/** The record as a restarted server reads it. */
const reload = () => openDataRoot({ path: dir });

/** What each handoff call was asked, in order. */
const asked = (backend: FakeBackend) => backend.oneShots.map((r) => r.prompt);

/** The stretch a request gives the writer. */
function stretchOf(prompt: string | undefined): string {
  return /<stretch>\n([\s\S]*)\n<\/stretch>$/.exec(prompt ?? "")?.[1] ?? "";
}

function ofType<T extends PageEvent["type"]>(
  chat: UnitChat,
  type: T,
): Extract<PageEvent, { type: T }>[] {
  return chat
    .events()
    .filter((e): e is Extract<PageEvent, { type: T }> => e.type === type);
}

async function answer(
  chat: UnitChat,
  choice: "A" | "B",
  confidence: Confidence = "90",
) {
  const posted = ofType(chat, "question").at(-1);
  if (posted === undefined) throw new Error("No question was posted.");
  expect(
    await chat.answer({
      kind: "choice",
      questionId: posted.question.id,
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

test("the writer is called as each segment closes and as the unit finishes, each time on the stretch since the call before, and its note replaces the one before", async () => {
  await makeCourse();
  const setup = setUp(
    writer({
      1: [
        {
          objective: "limit-value",
          believed: "A limit is the value at the point.",
          actually: "It is where the values head.",
          words: "I thought it was $f(2)$",
          detour: 1,
        },
        // The tutor's words, not the learner's: left out.
        {
          objective: "limit-value",
          believed: "A limit is a value.",
          actually: "It is where the values head.",
          words: "Detour: the limit is where values head.",
          detour: 1,
        },
      ],
    }),
  );
  const chat = await open(setup);
  expect(setup.handoffBackend.oneShots).toHaveLength(0);

  // Segment 1: a message, a confident miss and its detour, then two correct answers.
  await step(Promise.resolve(chat.say("Is it the value at the point?")), chat);
  await step(chat.ready(), chat);
  await answer(chat, "B", "90");
  const missed = ofType(chat, "question").at(-1)?.question;
  await step(Promise.resolve(chat.say("I thought it was f(2).")), chat);
  await step(chat.anotherQuestion(), chat);
  await answer(chat, "A", "75");
  expect(setup.handoffBackend.oneShots).toHaveLength(0);
  await answer(chat, "A", "75");
  expect(ofType(chat, "phase").at(-1)).toMatchObject({ phase: "closed" });

  const [first] = asked(setup.handoffBackend);
  expect(setup.handoffBackend.oneShots).toHaveLength(1);
  expect(setup.handoffBackend.oneShots[0]?.systemPrompt).toBe("Handoff.");
  expect(first).toContain("The unit has no note yet: this is its first.");
  const one = stretchOf(first);
  expect(one).toContain('Tutor:\nTeaching "Values".');
  expect(one).toContain("Learner:\nIs it the value at the point?");
  expect(one).toContain(
    "[The learner's answer to question 1:]\nB. Wrong\nGraded wrong, at 90% sure: a confident wrong answer.\nThe right choice: A. Right",
  );
  expect(one).toContain(
    '[Detour 1 opens, after the miss on question 1, on "limit-value".]',
  );
  expect(one).toContain("Learner:\nI thought it was f(2).");
  expect(one.endsWith('[Segment 1, "Values": closed.]')).toBe(true);
  expect(await reload().readHandoff(COURSE, "limits")).toMatchObject({
    note: "Note 1.",
  });
  expect(await reload().readMisconceptions(COURSE)).toEqual([
    {
      recordedAt: NOW,
      unit: "limits",
      objective: "limit-value",
      believed: "A limit is the value at the point.",
      actually: "It is where the values head.",
      words: "I thought it was $f(2)$",
      where: { in: "detour", questionId: missed?.id, number: 1 },
    },
  ]);

  // Segment 2, passed at once; the gate is offered, and the second call
  // reads only segment 2, with the first note before it.
  await step(chat.nextSegment(), chat);
  await step(chat.ready(), chat);
  await answer(chat, "A", "90");
  expect(ofType(chat, "assessment").at(-1)).toMatchObject({
    mode: "gate",
    stage: "offered",
  });
  const second = asked(setup.handoffBackend)[1];
  expect(setup.handoffBackend.oneShots).toHaveLength(2);
  expect(second).toContain("<note_before>\nNote 1.\n</note_before>");
  // What the first call found is given, so it is not recorded twice.
  expect(second).toContain(
    '<recorded_misconceptions>\n- On "limit-value": believed "A limit is the value at the point."; what is so: "It is where the values head."\n</recorded_misconceptions>',
  );
  const two = stretchOf(second);
  expect(two).toContain('Tutor:\nTeaching "Sides".');
  expect(two).not.toContain('Teaching "Values"');
  expect(two).not.toContain("Is it the value at the point?");

  // The gate, answered; the unit finishes, and the third call reads the gate.
  await step(chat.startAssessment(), chat);
  await answer(chat, "A", "90");
  await answer(chat, "A", "90");
  expect(ofType(chat, "unit_closed")).toEqual([
    { type: "unit_closed", status: "passed" },
  ]);
  const third = asked(setup.handoffBackend)[2];
  expect(setup.handoffBackend.oneShots).toHaveLength(3);
  expect(third).toContain("<note_before>\nNote 2.\n</note_before>");
  const three = stretchOf(third);
  expect(three).toContain(
    "[The unit's gate begins: questions without teaching, 2 objectives.]",
  );
  expect(three).toContain("[The unit is finished.]");
  expect(three).not.toContain('Teaching "Sides"');

  const folder = join(dir, "courses", COURSE, "units", "limits");
  expect(await readFile(join(folder, "handoff.md"), "utf8")).toBe("Note 3.\n");
  const mark = await reload().readHandoff(COURSE, "limits");
  expect(mark?.mark?.writtenAt).toBe(NOW);
  // Nothing more was found, so the first misconception is still the only one.
  expect(await reload().readMisconceptions(COURSE)).toHaveLength(1);
  await chat.close();
});

test("malformed quotes do not prevent the handoff note or another misconception from being saved", async () => {
  const dataRoot = await makeCourse();
  const belief = {
    objective: "limit-value",
    believed: "A limit is the value at the point.",
    actually: "It is where the values head.",
  };
  const words = "The limit is the value at the point.";
  const longQuote = "The limit is the value. ".repeat(100).trimEnd();
  const chat = await open(
    setUp([
      {
        output: {
          note: "The learner confused limits and values.",
          misconceptions: [
            { ...belief, words: "   " },
            { ...belief, words },
            belief,
            { ...belief, words: 2 },
            { ...belief, words: longQuote },
          ],
        },
      },
    ]),
  );
  await step(Promise.resolve(chat.say(`${words}\n${longQuote}`)), chat);
  await step(chat.override(), chat);

  expect((await dataRoot.readHandoff(COURSE, "limits"))?.note).toBe(
    "The learner confused limits and values.",
  );
  expect(await dataRoot.readMisconceptions(COURSE)).toEqual([
    {
      ...belief,
      words,
      recordedAt: NOW,
      unit: "limits",
      where: { in: "discussion" },
    },
  ]);
  await chat.close();
});

test("a choice correction after the handoff mark reaches the writer with the earlier question and the corrected choice", async () => {
  const dataRoot = await makeCourse();
  const units = (await dataRoot.readCourse(COURSE))?.curriculum?.units ?? [];
  const unit = units.find((u) => u.id === "limits");
  if (unit?.plan === undefined) throw new Error("No plan for limits.");
  const { id, plan } = unit;
  const question: ChoiceQuestion = {
    kind: "choice",
    prompt: "What is the limit of $x^2$ as $x$ approaches 2?",
    choices: ["2", "4"],
    answer: "A",
  };
  const entry: AnswerEvidence = {
    kind: "answer",
    recordedAt: YESTERDAY,
    objective: "limit-value",
    question,
    answer: { kind: "unknown", questionId: "q-1" },
    assisted: false,
    verdict: "unknown",
  };
  await dataRoot.appendEvidence(COURSE, entry);
  await dataRoot.appendTranscript(COURSE, id, 1, [
    {
      type: "question",
      question: {
        kind: "choice",
        id: "q-1",
        number: 1,
        prompt: question.prompt,
        choices: question.choices,
      },
    },
    gradedEvent(entry),
  ]);
  await dataRoot.writeHandoff(COURSE, id, "Earlier note.", {
    writtenAt: YESTERDAY,
    through: { session: 1, events: 2 },
  });
  const dispute = {
    kind: "dispute",
    recordedAt: NOW,
    questionId: "q-1",
    reason: "The limit is four.",
    outcome: { verdict: "unknown", reason: "Squaring 2 gives 4.", key: "B" },
  } as const;
  await dataRoot.appendDispute(COURSE, dispute);
  await dataRoot.appendTranscript(COURSE, id, 1, [disputedEvent(dispute)]);
  const backend = createFakeBackend([], writer());
  const handoffs = createHandoffs({
    writer: createHandoffWriter({ backend, systemPrompt: "Handoff." }),
    dataRoot,
    courseId: COURSE,
    unitId: id,
    context: () => ({
      courseTitle: CURRICULUM.title,
      units,
      unitId: id,
      plan,
      sources: [],
    }),
    flushed: () => Promise.resolve(),
    now: () => clock,
  });
  handoffs.request();
  await handoffs.settled();
  const stretch = stretchOf(asked(backend)[0]);
  expect(stretch).toContain("What is the limit of $x^2$ as $x$ approaches 2?");
  expect(stretch).toContain("the right choice is B. 4");
});

test("moving on closes a segment and calls the writer; a failed call records nothing, and the next reads both stretches", async () => {
  await makeCourse();
  const setup = setUp([
    { fail: "The writer failed." },
    { output: { note: "Both segments.", misconceptions: [] } },
  ]);
  const chat = await open(setup);
  await step(Promise.resolve(chat.say("A first question.")), chat);
  await step(chat.override(), chat);
  expect(setup.handoffBackend.oneShots).toHaveLength(1);
  expect(await reload().readHandoff(COURSE, "limits")).toBeUndefined();
  expect(await reload().readMisconceptions(COURSE)).toEqual([]);

  await step(chat.nextSegment(), chat);
  await step(chat.ready(), chat);
  await answer(chat, "A", "90");
  expect(setup.handoffBackend.oneShots).toHaveLength(2);
  const second = asked(setup.handoffBackend)[1];
  expect(second).toContain("The unit has no note yet: this is its first.");
  const both = stretchOf(second);
  expect(both).toContain('Teaching "Values"');
  expect(both).toContain("Learner:\nA first question.");
  expect(both).toContain(
    '[The learner moved on without the check, leaving "limit-value" not passed.]',
  );
  expect(both).toContain('Teaching "Sides"');
  expect(await reload().readHandoff(COURSE, "limits")).toMatchObject({
    note: "Both segments.",
  });
  await chat.close();
});

test("a fresh session's first turn carries the unit's handoff note and its open misconceptions, and 'What I know' shows each under its objective", async () => {
  const root = await makeCourse();
  const setup = setUp(
    writer({
      1: [
        {
          objective: "limit-value",
          believed: "Values at the point decide the limit.",
          actually: "Nearby values do.",
          words: "Right",
        },
        {
          objective: "one-sided",
          believed: "A limit has one side only.",
          actually: "It has two.",
          words: "A. Right",
        },
      ],
    }),
  );
  const chat = await open(setup);
  await step(chat.ready(), chat);
  await answer(chat, "A", "90");
  expect(setup.handoffBackend.oneShots).toHaveLength(1);

  await step(chat.startFresh(), chat);
  const first = setup.backend.received.at(-1)?.text ?? "";
  expect(first).toContain(JOINED_NOTE);
  expect(first).toContain(
    "\nThis unit's handoff note, written from the earlier conversation as its segments closed:\n<handoff_note>\nNote 1.\n</handoff_note>\n\n" +
      "Misconceptions found on this unit's objectives and not yet cleared:\n" +
      '- On "one-sided": the learner believed "A limit has one side only."; what is so: "It has two.".',
  );
  // "limit-value" passed, so its misconception is cleared and not named.
  expect(first).not.toContain("Values at the point decide the limit.");
  // Said once: the turn after it carries no note.
  await step(Promise.resolve(chat.say("Hello again.")), chat);
  expect(setup.backend.received.at(-1)?.text).not.toContain("<handoff_note>");

  const stored = await root.readCourse(COURSE);
  const view = whatIKnow(
    CURRICULUM.title,
    stored?.curriculum ?? { approval: { status: "draft" }, units: [] },
    await root.readState(COURSE),
    await root.readEvidence(COURSE),
    await root.readMisconceptions(COURSE),
  );
  const objectives = view.units[0]?.objectives ?? [];
  expect(
    objectives.map((o) => ({
      id: o.id,
      status: o.status,
      misconceptions: o.misconceptions.map((m) => [m.believed, m.words]),
    })),
  ).toEqual([
    {
      id: "limit-value",
      status: "passed",
      misconceptions: [["Values at the point decide the limit.", "Right"]],
    },
    {
      id: "one-sided",
      status: "not-started",
      misconceptions: [["A limit has one side only.", "A. Right"]],
    },
  ]);
  await chat.close();
});

test("a later unit's planning turn and its tutor's system prompt read its prerequisites' last notes and the open misconceptions on other units' objectives", async () => {
  // Unit 1's "limit-value" passed and "one-sided" missed; unit 3 is no prerequisite.
  const root = await makeCourse(["limits", "integral"]);
  await root.appendEvidence(COURSE, answered("limit-value", "correct"));
  await root.appendEvidence(COURSE, answered("one-sided", "incorrect"));
  const mark = {
    writtenAt: YESTERDAY,
    through: { session: 1, events: 0 },
  };
  await root.writeHandoff(
    COURSE,
    "limits",
    "Limits were taught with tables.",
    mark,
  );
  await root.writeHandoff(COURSE, "integral", "Areas were taught.", mark);
  await root.appendMisconceptions(COURSE, [
    misconception("limit-value", "A cleared belief."),
    misconception("one-sided", "Sides never differ."),
  ]);
  const setup = setUp();
  const chat = await open(setup, "derivative");

  const earlier =
    "The handoff notes of this unit's prerequisites, as their tutors' conversations left them:\n\n" +
    '## Unit 1, "Limits"\n\nLimits were taught with tables.\n\n' +
    "Misconceptions found in other units and not yet cleared, each on an objective the learner has not passed:\n\n" +
    '- On "one-sided", an objective of unit 1, "Limits": the learner believed "Sides never differ."; what is so: "What is so about one-sided.".';
  const planning = setup.backend.received[0]?.text ?? "";
  expect(planning).toMatch(/^\[Plan unit 2 of 3/);
  // "limit-value" passed yesterday, so review is offered first, and holds
  // the teaching until it is skipped.
  await step(chat.skipAssessment(), chat);
  expect(
    planning.endsWith(`\n\n# What earlier units showed\n\n${earlier}`),
  ).toBe(true);
  const tutorPrompt =
    setup.backend.sessions.find((s) => s.systemPrompt.startsWith("Tutor."))
      ?.systemPrompt ?? "";
  expect(tutorPrompt).toContain(
    `\n\n# Earlier units\n\n${earlier}\n\n# This course's style\n`,
  );
  for (const text of [planning, tutorPrompt]) {
    expect(text).not.toContain("A cleared belief.");
    expect(text).not.toContain("Areas were taught.");
  }
  await chat.close();
});

test("a unit with no earlier notes or open misconceptions gets no such section", async () => {
  await makeCourse();
  const setup = setUp();
  const chat = await open(setup, "derivative");
  const tutorPrompt = setup.backend.sessions[0]?.systemPrompt ?? "";
  expect(tutorPrompt).not.toContain("# Earlier units");
  await chat.close();
});

test("a review's question turn names the misconceptions recorded on its objective, open or not, and one with none names nothing", async () => {
  // Unit 1's objectives passed yesterday, so review is due on both.
  const root = await makeCourse();
  await root.appendEvidence(COURSE, answered("limit-value", "correct"));
  await root.appendEvidence(COURSE, answered("one-sided", "correct"));
  await root.appendMisconceptions(COURSE, [
    misconception("limit-value", "The value at the point decides."),
  ]);
  const setup = setUp();
  const chat = await open(setup, "derivative");
  expect(ofType(chat, "assessment").at(-1)).toMatchObject({
    mode: "review",
    stage: "offered",
  });
  await step(chat.startAssessment(), chat);
  const firstAsk = setup.backend.received.at(-1)?.text ?? "";
  expect(firstAsk).toContain('a question on "limit-value" with ask_question');
  expect(firstAsk).toContain(
    '\nMisconceptions recorded on "limit-value", the oldest first; ask so that the answer shows whether each still holds, without naming it:\n' +
      '- On "limit-value": the learner believed "The value at the point decides."; what is so: "What is so about limit-value.". Cleared since.]',
  );
  await answer(chat, "A", "90");
  const secondAsk = setup.backend.received.at(-1)?.text ?? "";
  expect(secondAsk).toContain('a question on "one-sided" with ask_question');
  expect(secondAsk).not.toContain("Misconceptions recorded");
  await chat.close();
});
