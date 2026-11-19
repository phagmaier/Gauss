// Changing a course's curriculum after approval (task 5.12): the tutor's
// amend_curriculum through the unit chat, on the fake backend, with the
// card, the learner's Apply and "Keep the current one", the refusals, the
// plans of kept units, and a restart with the card waiting.

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import type { CurriculumProposal, Unit } from "../../shared/curriculum.ts";
import type { PageEvent } from "../../shared/events.ts";
import type { Plan } from "../../shared/plan.ts";
import { createFakeBackend, type FakeTurn } from "../backends/fake.ts";
import { openDataRoot } from "../record/data-root.ts";
import { givenOrder } from "./choice-order.ts";
import { createFakeTimer } from "./fake-timer.ts";
import { createGrader } from "./grading.ts";
import { createHelpJudge } from "./help-judge.ts";
import { createUnitChats } from "./unit-chat.ts";
import { createUnitPlanner } from "./unit-planning.ts";

// Each test gets its own data root; none touches ~/gauss (AGENTS.md).
let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "gauss-curriculum-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const NOW = "2026-11-19T10:00:00.000Z";
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
const UNITS = [LOOPS, SETS, MAPS];
const ADDED: Unit = {
  id: "counting-practice",
  title: "Counting practice",
  goal: "Count without a slip.",
  prerequisites: ["loops"],
};
const CURRICULUM: CurriculumProposal = {
  title: "Counting",
  units: UNITS,
  style: "Short explanations.",
  background: "The learner knows Python.",
};
const LOOP_PLAN: Plan = {
  objectives: [{ id: "loop-count", statement: "Count with a loop." }],
  segments: [{ title: "Counting", objectives: ["loop-count"] }],
};
const SET_PLAN: Plan = {
  objectives: [{ id: "set-count", statement: "Count with a set." }],
  segments: [{ title: "Sets", objectives: ["set-count"] }],
};
const CHOICE = {
  objective: "loop-count",
  kind: "choice",
  prompt: "How many times does `for i in range(3)` run?",
  choices: ["3", "2"],
  answer: "A",
};
/** The practice unit added after loops, and sets renamed: plans must survive both. */
const AMENDED = [LOOPS, ADDED, { ...SETS, title: "Sets and maps" }, MAPS];
const WHY = "You asked for more practice.";
const amend = (units: Unit[] = AMENDED, why = WHY) => ({
  call: "amend_curriculum",
  input: { units, why },
});
const WAITING =
  "Your proposed curriculum change waits for the learner's answer";
const ADDED_LINE =
  '2. Counting practice (id "counting-practice"): Count without a slip. Builds on "loops".';

/** A server's unit chats on the record in `dir`; no unit is opened yet. */
async function server(script: FakeTurn[]) {
  const root = openDataRoot({ path: dir, now: () => new Date(NOW) });
  if ((await root.readCourse(COURSE)) === undefined) {
    const { id } = await root.createCourse({ title: CURRICULUM.title });
    await root.saveProposal(id, CURRICULUM);
    await root.approveCurriculum(id, CURRICULUM);
    await root.storePlan(id, "loops", LOOP_PLAN);
    await root.storePlan(id, "sets", SET_PLAN);
  }
  const backend = createFakeBackend(script, []);
  const commits: string[] = [];
  const units = createUnitChats({
    backend,
    systemPrompt: "Tutor.",
    dataRoot: root,
    planner: createUnitPlanner({
      backend,
      systemPrompt: "Plan.",
      dataRoot: root,
    }),
    grader: createGrader({ backend, systemPrompt: "Grader." }),
    judge: createHelpJudge({ backend, systemPrompt: "Judge." }),
    now: () => new Date(NOW),
    timer: createFakeTimer(),
    order: givenOrder,
    backup: {
      commit: (message) => void commits.push(message),
      settled: () => Promise.resolve(),
    },
  });
  async function open(unitId = "loops") {
    const opened = await units.open(COURSE, unitId);
    if (!opened.ok) throw new Error(opened.error);
    await opened.chat.settled();
    return opened.chat;
  }
  /** The units curriculum.json holds now, with their plans. */
  async function stored() {
    return (await root.readCourse(COURSE))?.curriculum?.units;
  }
  return { backend, root, units, commits, open, stored };
}

function proposalId(events: readonly PageEvent[]): string {
  const card = events.findLast((e) => e.type === "curriculum_change_proposed");
  if (card?.type !== "curriculum_change_proposed") {
    throw new Error("no proposal");
  }
  return card.proposalId;
}

test("a proposal shows its card against the current units, waits in the position without ending the turn, and is said in each header until answered", async () => {
  const { backend, root, open, stored } = await server([
    [{ text: "Teaching." }, amend(), { text: "After the card." }],
    [{ text: "A reply." }],
  ]);
  const chat = await open();

  expect(backend.calls.at(-1)?.result).toEqual({
    status: "done",
    text: expect.stringContaining("The learner sees your proposal on a card."),
  });
  const events = chat.events();
  const card = events.findIndex((e) => e.type === "curriculum_change_proposed");
  expect(events[card]).toEqual({
    type: "curriculum_change_proposed",
    proposalId: expect.any(String),
    units: AMENDED,
    was: UNITS,
    why: WHY,
  });
  expect(events.slice(card)).toContainEqual({
    type: "tutor_text",
    text: "After the card.",
  });
  expect((await root.readState(COURSE)).units.loops?.curriculumChange).toEqual({
    id: proposalId(events),
    units: AMENDED,
    was: UNITS,
    why: WHY,
    proposedAt: NOW,
  });

  expect(chat.say("And?")).toEqual({ ok: true });
  await chat.settled();
  expect(backend.received.at(-1)?.text).toContain(WAITING);
  expect((await stored())?.map((u) => u.id)).toEqual(["loops", "sets", "maps"]);
});

test("Apply writes the new units, each kept unit with its plan, asks for a backup commit, and tells the running tutor the units in its next header; a session started after lists them", async () => {
  const { backend, commits, open, stored } = await server([
    [{ text: "Teaching." }, amend()],
    [{ text: "A reply." }],
    [{ text: "Fresh." }],
  ]);
  const chat = await open();
  const id = proposalId(chat.events());

  expect(await chat.applyCurriculum(id)).toEqual({ ok: true });
  expect(await stored()).toEqual([
    { ...LOOPS, plan: LOOP_PLAN },
    ADDED,
    { ...SETS, title: "Sets and maps", plan: SET_PLAN },
    MAPS,
  ]);
  expect(chat.events().at(-1)).toEqual({
    type: "curriculum_change_answered",
    proposalId: id,
    outcome: "applied",
  });
  expect(commits).toContain(`${COURSE}: curriculum changed`);

  expect(chat.say("Go on.")).toEqual({ ok: true });
  await chat.settled();
  const header = backend.received.at(-1)?.text ?? "";
  expect(header).toContain(
    "The learner applied the curriculum change you proposed.",
  );
  expect(header).toContain(ADDED_LINE);
  expect(header).not.toContain(WAITING);
  // "Unit 1 of 4" once the change is in.
  expect(header).toMatch(/^\[Unit 1 of 4, "Loops"/);
  expect(backend.sessions[0]?.systemPrompt).not.toContain(ADDED_LINE);

  expect(await chat.startFresh()).toEqual({ ok: true });
  await chat.settled();
  expect(backend.sessions.at(-1)?.systemPrompt).toContain(ADDED_LINE);
  expect(backend.received.at(-1)?.text).not.toContain(
    "The learner applied the curriculum change",
  );
});

test('"Keep the current one" leaves curriculum.json as it was and tells the tutor in its next header', async () => {
  const { backend, commits, open, stored } = await server([
    [{ text: "Teaching." }, amend()],
    [{ text: "A reply." }],
  ]);
  const chat = await open();
  const before = await stored();
  const id = proposalId(chat.events());

  expect(await chat.keepCurriculum(id)).toEqual({ ok: true });
  expect(await stored()).toEqual(before);
  expect(chat.events().at(-1)).toEqual({
    type: "curriculum_change_answered",
    proposalId: id,
    outcome: "kept",
  });
  expect(commits).not.toContain(`${COURSE}: curriculum changed`);
  expect(await chat.applyCurriculum(id)).toEqual({
    ok: false,
    status: 409,
    error: "That proposed curriculum change is not waiting.",
  });

  expect(chat.say("Go on.")).toEqual({ ok: true });
  await chat.settled();
  const header = backend.received.at(-1)?.text ?? "";
  expect(header).toContain('The learner chose "Keep the current one"');
  expect(header).not.toContain(WAITING);
});

test("a change that drops or renames a started unit, or breaks the curriculum's rules, or changes nothing, is refused with the reason", async () => {
  const { backend, open } = await server([
    [
      { text: "Teaching." },
      // sets has a plan: it has started.
      amend([LOOPS, { ...MAPS, prerequisites: ["loops"] }]),
      // loops is open: it is in progress.
      amend([
        { ...LOOPS, id: "loop-basics" },
        { ...SETS, prerequisites: ["loop-basics"] },
        MAPS,
      ]),
      amend([...UNITS, { ...ADDED, prerequisites: ["nowhere"] }]),
      amend([...UNITS, { ...ADDED, id: "maps" }]),
      amend([...UNITS, { ...ADDED, prerequisites: ["counting-practice"] }]),
      amend(UNITS),
    ],
  ]);
  await open();
  const results = backend.calls.map((c) => c.result);
  expect(results).toEqual([
    {
      status: "refused",
      text: 'Unit "sets" ("Sets") has been started, so a change must keep it, with the same id.',
    },
    {
      status: "refused",
      text: 'Unit "loops" ("Loops") is in progress, so a change must keep it, with the same id.',
    },
    {
      status: "refused",
      text: expect.stringContaining(
        '"counting-practice" builds on "nowhere", which is not a unit in this curriculum.',
      ),
    },
    {
      status: "refused",
      text: expect.stringContaining('"maps" is the id of more than one unit.'),
    },
    {
      status: "refused",
      text: expect.stringContaining("The prerequisites form a cycle"),
    },
    {
      status: "refused",
      text: "That is the current curriculum: nothing would change.",
    },
  ]);
});

test("a unit not started can be dropped, but not once it starts before Apply; the card then still waits and can be kept", async () => {
  const { root, open, stored } = await server([[amend([LOOPS, SETS])]]);
  const chat = await open();
  const id = proposalId(chat.events());
  await root.storePlan(COURSE, "maps", {
    objectives: [{ id: "map-count", statement: "Count with a map." }],
    segments: [{ title: "Maps", objectives: ["map-count"] }],
  });

  expect(await chat.applyCurriculum(id)).toEqual({
    ok: false,
    status: 409,
    error:
      'This change can no longer be applied. Unit "maps" ("Maps") has been started, so a change must keep it, with the same id.',
  });
  expect((await stored())?.map((u) => u.id)).toEqual(["loops", "sets", "maps"]);
  expect(await chat.keepCurriculum(id)).toEqual({ ok: true });
});

test("a proposal is refused while a question of the unit is open", async () => {
  const { backend, open } = await server([
    [{ text: "Teaching." }],
    [{ text: "A question." }, { call: "ask_question", input: CHOICE }],
    [{ text: "A reply." }, amend()],
  ]);
  const chat = await open();
  expect(await chat.ready()).toEqual({ ok: true });
  await chat.settled();
  expect(chat.say("Could we add a unit?")).toEqual({ ok: true });
  await chat.settled();
  expect(backend.calls.at(-1)?.result).toEqual({
    status: "refused",
    text: "Question 1 is open: propose a change to the curriculum once its answer is graded.",
  });
  expect(
    chat.events().some((e) => e.type === "curriculum_change_proposed"),
  ).toBe(false);
});

test("one proposal waits in a course: a waiting change blocks a style note and another change, in another unit too", async () => {
  const { backend, open } = await server([
    [
      { text: "Teaching." },
      amend(),
      { call: "propose_style", input: { note: "Long.", why: "You asked." } },
      amend([...UNITS, ADDED]),
    ],
    [{ text: "Teaching sets." }, amend([...UNITS, ADDED])],
  ]);
  const waiting = {
    status: "refused",
    text:
      "A proposed curriculum change already waits for the learner's answer. " +
      "Wait for it: a header says how they answered.",
  };
  await open("loops");
  expect(backend.calls.slice(1).map((c) => c.result)).toEqual([
    waiting,
    waiting,
  ]);
  const sets = await open("sets");
  expect(backend.calls.at(-1)?.result).toEqual(waiting);
  expect(
    sets.events().some((e) => e.type === "curriculum_change_proposed"),
  ).toBe(false);
});

test("a waiting style note blocks a change", async () => {
  const { backend, open } = await server([
    [
      { call: "propose_style", input: { note: "Long.", why: "You asked." } },
      amend(),
    ],
  ]);
  await open();
  expect(backend.calls.at(-1)?.result).toEqual({
    status: "refused",
    text:
      "A proposed style note already waits for the learner's answer. " +
      "Wait for it: a header says how they answered.",
  });
});

test("a card waiting across a restart shows again and can be applied, the plans kept", async () => {
  const first = await server([[{ text: "Teaching." }, amend()]]);
  const before = await first.open();
  const id = proposalId(before.events());
  await first.units.close();

  const second = await server([[{ text: "A reply." }]]);
  const chat = await second.open();
  // Once from the transcript, which cannot be answered, and again as the
  // chat opens, which can.
  expect(
    chat.events().filter((e) => e.type === "curriculum_change_proposed"),
  ).toEqual([
    expect.objectContaining({ proposalId: id, historical: true }),
    expect.not.objectContaining({ historical: true }),
  ]);
  expect(await chat.applyCurriculum(id)).toEqual({ ok: true });
  expect((await second.stored())?.map((u) => u.plan)).toEqual([
    LOOP_PLAN,
    undefined,
    SET_PLAN,
    undefined,
  ]);
});

test("an Apply a restart cut short after writing curriculum.json is recorded as applied when the unit reopens, and the tutor is told", async () => {
  const first = await server([[{ text: "Teaching." }, amend()]]);
  const before = await first.open();
  const id = proposalId(before.events());
  await first.units.close();

  // The process stopped between the two writes of an Apply.
  const file = join(dir, "courses", COURSE, "curriculum.json");
  const curriculum = JSON.parse(await readFile(file, "utf8"));
  await writeFile(
    file,
    JSON.stringify({
      ...curriculum,
      units: [
        { ...LOOPS, plan: LOOP_PLAN },
        ADDED,
        { ...SETS, title: "Sets and maps", plan: SET_PLAN },
        MAPS,
      ],
    }),
  );

  const second = await server([[{ text: "A reply." }]]);
  const chat = await second.open();
  expect(
    (await second.root.readState(COURSE)).units.loops?.curriculumChange,
  ).toBeUndefined();
  expect(chat.events()).toContainEqual({
    type: "curriculum_change_answered",
    proposalId: id,
    outcome: "applied",
  });
  expect(await chat.keepCurriculum(id)).toMatchObject({ ok: false });
  expect(chat.say("Go on.")).toEqual({ ok: true });
  await chat.settled();
  expect(second.backend.received.at(-1)?.text).toContain(
    "The learner applied the curriculum change you proposed.",
  );
});

test("another unit open when a change is applied is told the units in its next header, and its next session lists them", async () => {
  const { backend, open } = await server([
    [{ text: "Teaching loops." }, amend()],
    [{ text: "Teaching sets." }],
    [{ text: "A reply in sets." }],
    [{ text: "Fresh in sets." }],
  ]);
  const loops = await open("loops");
  const sets = await open("sets");

  expect(await loops.applyCurriculum(proposalId(loops.events()))).toEqual({
    ok: true,
  });
  await sets.settled();
  expect(sets.say("Go on.")).toEqual({ ok: true });
  await sets.settled();
  const header = backend.received.at(-1)?.text ?? "";
  expect(header).toContain(
    "The learner applied a change to this course's curriculum in another unit.",
  );
  expect(header).toMatch(/^\[Unit 3 of 4, "Sets and maps"/);
  expect(await sets.startFresh()).toEqual({ ok: true });
  await sets.settled();
  expect(backend.sessions.at(-1)?.systemPrompt).toContain(ADDED_LINE);
});
