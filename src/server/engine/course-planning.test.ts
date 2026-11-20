// Planning from the course view (task 5.38): the course's planning
// conversation on the fake backend, with what the planner is given, its
// card, Apply and "Keep the current one", the rules a unit tutor's change
// keeps, and the open unit chats told of an applied change.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import type { CurriculumProposal, Unit } from "../../shared/curriculum.ts";
import type { PageEvent } from "../../shared/events.ts";
import type { EvidenceEntry } from "../../shared/evidence.ts";
import type { Plan } from "../../shared/plan.ts";
import {
  createFakeBackend,
  type FakeBackend,
  type FakeTurn,
} from "../backends/fake.ts";
import { openDataRoot } from "../record/data-root.ts";
import { givenOrder } from "./choice-order.ts";
import { createCoursePlannings } from "./course-planning.ts";
import { createFakeTimer } from "./fake-timer.ts";
import { createGrader } from "./grading.ts";
import { createHelpJudge } from "./help-judge.ts";
import { createUnitChats } from "./unit-chat.ts";
import { createUnitPlanner } from "./unit-planning.ts";

// Each test gets its own data root; none touches ~/gauss (AGENTS.md).
let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "gauss-planning-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const NOW = "2026-11-20T10:00:00.000Z";
const COURSE = "counting";
const LOOPS: Unit = {
  id: "loops",
  title: "Loops",
  goal: "Count with loops.",
  prerequisites: [],
};
const SETS: Unit = {
  id: "sets",
  title: "Sets",
  goal: "Count with sets.",
  prerequisites: ["loops"],
};
const MAPS: Unit = {
  id: "maps",
  title: "Maps",
  goal: "Count with maps.",
  prerequisites: ["sets"],
};
const STRETCH =
  "Counting 2 follows: the tutor will propose it as this stretch ends.";
const CURRICULUM: CurriculumProposal = {
  title: "Counting",
  units: [LOOPS, SETS],
  style: `Short explanations. ${STRETCH}`,
  background: "The learner knows Python and wants to go as far as Counting 2.",
};
const plan = (objective: string): Plan => ({
  objectives: [{ id: objective, statement: `Do ${objective}.` }],
  segments: [{ title: "It", objectives: [objective] }],
});
/** An unassisted right answer at 100%, which passes the objective. */
const passed = (objective: string): EvidenceEntry => ({
  kind: "answer",
  recordedAt: NOW,
  objective,
  question: {
    kind: "choice",
    prompt: `Which counts? (${objective})`,
    choices: ["This", "That"],
    answer: "A",
  },
  answer: {
    kind: "choice",
    questionId: `q-${objective}`,
    choice: "A",
    confidence: "100",
  },
  assisted: false,
  verdict: "correct",
});
const NEXT: Unit[] = [
  {
    id: "counting-2-intro",
    title: "Counting 2: arrangements",
    goal: "Count arrangements of a set.",
    prerequisites: ["sets"],
  },
  {
    id: "counting-2-choices",
    title: "Counting 2: choices",
    goal: "Count choices from a set.",
    prerequisites: ["counting-2-intro"],
  },
];
const WHY = "The course named Counting 2 as what follows.";
const amend = (units: Unit[], why = WHY) => ({
  call: "amend_curriculum",
  input: { units, why },
});
const ASK: FakeTurn = [{ text: "Shall I plan Counting 2?" }];

/**
 * A server on the record in `dir`, with "Counting" approved and both units
 * planned; finished, both passed. The planner and the tutors have backends
 * of their own.
 */
async function setUp(options: {
  planner: FakeTurn[];
  tutor?: FakeTurn[];
  finished?: boolean;
}) {
  const root = openDataRoot({ path: dir, now: () => new Date(NOW) });
  const { id } = await root.createCourse({ title: CURRICULUM.title });
  await root.saveProposal(id, CURRICULUM);
  await root.approveCurriculum(id, CURRICULUM);
  await root.storePlan(id, "loops", plan("loop-count"));
  await root.storePlan(id, "sets", plan("set-count"));
  if (options.finished === true) {
    await root.appendEvidence(id, passed("loop-count"));
    await root.appendEvidence(id, passed("set-count"));
  }
  const commits: string[] = [];
  const backup = {
    commit: (message: string) => void commits.push(message),
    settled: () => Promise.resolve(),
  };
  const tutorBackend = createFakeBackend(options.tutor ?? [], []);
  const units = createUnitChats({
    backend: tutorBackend,
    systemPrompt: "Tutor.",
    dataRoot: root,
    planner: createUnitPlanner({
      backend: tutorBackend,
      systemPrompt: "Plan.",
      dataRoot: root,
    }),
    grader: createGrader({ backend: tutorBackend, systemPrompt: "Grader." }),
    judge: createHelpJudge({ backend: tutorBackend, systemPrompt: "Judge." }),
    now: () => new Date(NOW),
    timer: createFakeTimer(),
    order: givenOrder,
    backup,
  });
  const backend = createFakeBackend(options.planner, []);
  const plannings = createCoursePlannings({
    backend,
    systemPrompt: "Plan the course.",
    dataRoot: root,
    units,
    backup,
    timer: createFakeTimer(),
    now: () => new Date(NOW),
  });
  async function planning() {
    const opened = await plannings.open(COURSE);
    if (!opened.ok) throw new Error(opened.error);
    return opened.planning;
  }
  async function open(unitId: string) {
    const opened = await units.open(COURSE, unitId);
    if (!opened.ok) throw new Error(opened.error);
    await opened.chat.settled();
    return opened.chat;
  }
  /** The units curriculum.json holds now, with their plans. */
  async function stored() {
    return (await root.readCourse(COURSE))?.curriculum?.units;
  }
  return {
    backend,
    tutorBackend,
    root,
    plannings,
    commits,
    planning,
    open,
    stored,
  };
}

function cards(events: readonly PageEvent[]) {
  return events.filter(
    (e): e is Extract<PageEvent, { type: "curriculum_change_proposed" }> =>
      e.type === "curriculum_change_proposed",
  );
}

function lastCard(events: readonly PageEvent[]) {
  const card = cards(events).at(-1);
  if (card === undefined) throw new Error("no proposal");
  return card;
}

/** Each refusal the planner's tool calls got, in order. */
function refusals(backend: FakeBackend) {
  return backend.calls
    .filter((c) => c.result.status === "refused")
    .map((c) => c.result.text);
}

test("on a finished course the planner is given the course, asks, proposes the next stretch, and Apply adds it, keeping the plans; the conversation then ends", async () => {
  const { backend, commits, planning, plannings, stored } = await setUp({
    finished: true,
    planner: [ASK, [{ text: "Here it is." }, amend([LOOPS, SETS, ...NEXT])]],
  });
  const chat = await planning();
  expect(chat.say("What comes next?")).toEqual({ ok: true });
  await chat.settled();

  const first = backend.received[0]?.text ?? "";
  expect(first).toMatch(
    /^\[Start of a planning conversation of this course\. Every unit is finished/,
  );
  expect(first).toContain('"id":"loops"');
  expect(first).toContain('"status":"passed"');
  expect(first).toContain(
    '"objectives":[{"id":"set-count","statement":"Do set-count.","status":"passed"}]',
  );
  expect(first).toContain(STRETCH);
  expect(first).toContain(CURRICULUM.background);
  expect(first.endsWith("What comes next?")).toBe(true);
  expect(cards(chat.events())).toEqual([]);

  chat.say("Yes, plan it.");
  await chat.settled();
  // Nothing changed since the first turn, so the course is not given again.
  expect(backend.received[1]?.text).not.toContain("<course>");
  const card = lastCard(chat.events());
  expect(card).toMatchObject({
    units: [LOOPS, SETS, ...NEXT],
    was: [LOOPS, SETS],
    why: WHY,
  });
  expect(backend.calls.at(-1)?.result.status).toBe("done");
  // The card is the last thing in the turn.
  expect(chat.events().at(-1)?.type).toBe("turn_end");
  expect(await stored()).toHaveLength(2);

  expect(await chat.apply(card.proposalId)).toEqual({ ok: true });
  const units = await stored();
  expect(units?.map((u) => u.id)).toEqual([
    "loops",
    "sets",
    "counting-2-intro",
    "counting-2-choices",
  ]);
  expect(units?.[1]?.plan).toEqual(plan("set-count"));
  expect(units?.[2]?.plan).toBeUndefined();
  expect(commits).toEqual(["counting: curriculum changed"]);
  expect(chat.events()).toContainEqual({
    type: "curriculum_change_answered",
    proposalId: card.proposalId,
    outcome: "applied",
  });
  expect(backend.closed).toHaveLength(1);

  expect(chat.ended()).toBe(true);
  expect(chat.say("And then?")).toMatchObject({ ok: false, status: 409 });
  const next = await planning();
  expect(next.id).not.toBe(chat.id);
  expect(plannings.get(COURSE, chat.id)).toBe(chat);
});

test("a change that drops a started unit, changes its id or nothing, or breaks the curriculum's rules, is refused with the reason and shows no card", async () => {
  const { backend, planning, stored } = await setUp({
    finished: true,
    planner: [
      [
        amend([SETS, ...NEXT].map((u) => ({ ...u, prerequisites: [] }))),
        amend([
          { ...LOOPS, id: "loops-2" },
          { ...SETS, prerequisites: [] },
        ]),
        amend([LOOPS, SETS]),
        amend([LOOPS, { ...SETS, prerequisites: ["sets"] }]),
      ],
    ],
  });
  const chat = await planning();
  chat.say("Drop loops.");
  await chat.settled();
  const [dropped, renamed, same, cycle] = refusals(backend);
  expect(dropped).toContain('Unit "loops" ("Loops") has been started');
  expect(renamed).toContain('Unit "loops" ("Loops") has been started');
  expect(same).toBe("That is the current curriculum: nothing would change.");
  expect(cycle).toBeDefined();
  expect(cards(chat.events())).toEqual([]);
  expect(await stored()).toHaveLength(2);
});

test("one proposal waits in a course: a unit's waiting change blocks the planner, and the planner's waiting change blocks the unit tutors until it is kept", async () => {
  const { backend, tutorBackend, planning, open } = await setUp({
    planner: [[amend([LOOPS, SETS, MAPS])], [amend([LOOPS, SETS, MAPS])]],
    tutor: [
      [{ text: "Teaching loops." }, amend([LOOPS, { ...SETS, title: "S" }])],
      [{ text: "Teaching sets." }],
      [amend([LOOPS, SETS, { ...MAPS, id: "maps-2" }])],
      [amend([LOOPS, SETS, { ...MAPS, id: "maps-3" }])],
    ],
  });
  const loops = await open("loops");
  const unitCard = lastCard(loops.events());

  const chat = await planning();
  chat.say("Add maps.");
  await chat.settled();
  expect(refusals(backend)[0]).toContain(
    'A proposed curriculum change waits for the learner\'s answer in the chat of unit "loops"',
  );
  expect(cards(chat.events())).toEqual([]);

  expect(await loops.keepCurriculum(unitCard.proposalId)).toEqual({
    ok: true,
  });
  chat.say("Now add maps.");
  await chat.settled();
  const card = lastCard(chat.events());

  const sets = await open("sets");
  sets.say("Add a unit on maps.");
  await sets.settled();
  expect(refusals(tutorBackend)[0]).toContain(
    "A curriculum change proposed from the course view waits",
  );
  expect(cards(sets.events())).toEqual([]);

  expect(await chat.keep(card.proposalId)).toEqual({ ok: true });
  sets.say("Add a unit on maps, then.");
  await sets.settled();
  expect(refusals(tutorBackend)).toHaveLength(1);
  expect(cards(sets.events())).toHaveLength(1);
});

test('"Keep the current one" is said in the planner\'s next header; a new proposal replaces the one waiting; Apply is refused while the planner writes', async () => {
  const { backend, planning, stored } = await setUp({
    finished: true,
    planner: [
      [amend([LOOPS, SETS, ...NEXT])],
      [amend([LOOPS, SETS, NEXT[0] as Unit])],
      [{ text: "One unit it is." }, amend([LOOPS, SETS, MAPS])],
      [{ hold: true }],
    ],
  });
  const chat = await planning();
  chat.say("Plan Counting 2.");
  await chat.settled();
  const kept = lastCard(chat.events());
  expect(await chat.keep(kept.proposalId)).toEqual({ ok: true });
  expect(await chat.apply(kept.proposalId)).toMatchObject({
    ok: false,
    status: 409,
  });

  chat.say("Just one unit.");
  await chat.settled();
  const header = backend.received.at(-1)?.text ?? "";
  expect(header).toContain(
    'They chose "Keep the current one" on your last proposal',
  );
  expect(header).toContain("Allowed now: reply, asking what you need to know");
  const replaced = lastCard(chat.events());

  chat.say("Maps instead.");
  await chat.settled();
  expect(backend.received.at(-1)?.text).not.toContain("Keep the current one");
  expect(backend.received.at(-1)?.text).toContain(
    "Your last proposal waits on its card",
  );
  expect(chat.events()).toContainEqual({
    type: "curriculum_change_answered",
    proposalId: replaced.proposalId,
    outcome: "replaced",
  });
  expect(await chat.apply(replaced.proposalId)).toMatchObject({
    ok: false,
    error: "That proposed change is not waiting.",
  });

  const latest = lastCard(chat.events());
  chat.say("Wait.");
  expect(await chat.apply(latest.proposalId)).toEqual({
    ok: false,
    status: 409,
    error: "Wait until the planner has finished.",
  });
  await chat.interrupt();
  await chat.settled();
  expect(await chat.apply(latest.proposalId)).toEqual({ ok: true });
  expect((await stored())?.map((u) => u.id)).toEqual(["loops", "sets", "maps"]);
});

test("Apply is refused, the card still waiting, once a unit it drops has started since", async () => {
  const { root, planning, stored } = await setUp({
    planner: [[amend([LOOPS, SETS])]],
  });
  // A third unit, not started, that the planner's change drops.
  await root.changeCurriculum(COURSE, [LOOPS, SETS, MAPS]);
  const chat = await planning();
  chat.say("Drop maps.");
  await chat.settled();
  const card = lastCard(chat.events());

  await root.storePlan(COURSE, "maps", plan("map-count"));
  const refused = await chat.apply(card.proposalId);
  expect(refused).toMatchObject({ ok: false, status: 409 });
  expect(refused.ok ? "" : refused.error).toContain(
    'This change can no longer be applied. Unit "maps" ("Maps") has been started',
  );
  expect((await stored())?.map((u) => u.id)).toEqual(["loops", "sets", "maps"]);
  expect(await chat.keep(card.proposalId)).toEqual({ ok: true });
});

test("an open unit chat is told an applied change in its next header, and its next session lists the units", async () => {
  const { tutorBackend, planning, open } = await setUp({
    planner: [[amend([LOOPS, SETS, MAPS])]],
    tutor: [
      [{ text: "Teaching sets." }],
      [{ text: "A reply." }],
      [{ text: "Fresh." }],
    ],
  });
  const sets = await open("sets");
  const chat = await planning();
  chat.say("Add maps.");
  await chat.settled();
  expect(await chat.apply(lastCard(chat.events()).proposalId)).toEqual({
    ok: true,
  });
  await sets.settled();
  expect(sets.events()).toContainEqual({ type: "curriculum_changed" });

  sets.say("Go on.");
  await sets.settled();
  const header = tutorBackend.received.at(-1)?.text ?? "";
  expect(header).toContain(
    "The learner applied a change to this course's curriculum, in another unit or from the course view.",
  );
  expect(header).toContain('3. Maps (id "maps"): Count with maps.');
  expect(await sets.startFresh()).toEqual({ ok: true });
  await sets.settled();
  expect(tutorBackend.sessions.at(-1)?.systemPrompt).toContain(
    '3. Maps (id "maps"): Count with maps.',
  );
});

test("a later turn gives the course again once it has changed, and a draft cannot be planned from the course view", async () => {
  const { backend, root, planning, plannings } = await setUp({
    planner: [ASK, [{ text: "Noted." }]],
  });
  const chat = await planning();
  chat.say("Something.");
  await chat.settled();
  await root.appendEvidence(COURSE, passed("loop-count"));
  chat.say("I passed loops.");
  await chat.settled();
  const header = backend.received.at(-1)?.text ?? "";
  expect(header).toContain(
    "The course or their profile changed since you were given them.",
  );
  expect(header).toContain(
    '{"id":"loop-count","statement":"Do loop-count.","status":"passed"}',
  );

  const draft = await root.createCourse({ title: "Draft" });
  await root.saveProposal(draft.id, { ...CURRICULUM, title: "Draft" });
  expect(await plannings.open(draft.id)).toMatchObject({
    ok: false,
    status: 409,
  });
  expect(await plannings.open("no-such-course")).toMatchObject({
    ok: false,
    status: 404,
  });
});
