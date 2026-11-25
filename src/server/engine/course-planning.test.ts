// Planning from the course view (task 5.38): the course's planning
// conversation on the fake backend, with what the planner is given, its
// card, Apply and "Keep the current one", the rules a unit tutor's change
// keeps, and the open unit chats told of an applied change.

import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { CurriculumProposal, Unit } from "../../shared/curriculum.ts";
import type { PageEvent } from "../../shared/events.ts";
import type { EvidenceEntry } from "../../shared/evidence.ts";
import type { Plan } from "../../shared/plan.ts";
import type { Outline } from "../../shared/source.ts";
import {
  createFakeBackend,
  type FakeBackend,
  type FakeTurn,
  KeptSessions,
} from "../backends/fake.ts";
import { createScriptedBackend } from "../backends/scripted.ts";
import type * as AtomicWrite from "../record/atomic-write.ts";
import { type DataRoot, openDataRoot } from "../record/data-root.ts";
import { createAttachedSources } from "./attached-sources.ts";
import { givenOrder } from "./choice-order.ts";
import { IDLE_MS } from "./conversation.ts";
import { createCoursePlannings } from "./course-planning.ts";
import { fakeConverter, placeTestSource, upload } from "./fake-converter.ts";
import { createFakeTimer } from "./fake-timer.ts";
import { createGrader } from "./grading.ts";
import { createHelpJudge } from "./help-judge.ts";
import type { SourceConverter } from "./source-convert.ts";
import { createUnitChats } from "./unit-chat.ts";
import { createUnitPlanner } from "./unit-planning.ts";

// Fail a curriculum write on either side of publication, leaving the real
// record I/O in place. A directory sync error can occur after the rename.
const disk = vi.hoisted(() => ({
  failure: undefined as "before rename" | "after rename" | undefined,
}));
vi.mock("../record/atomic-write.ts", async (importOriginal) => {
  const real = await importOriginal<typeof AtomicWrite>();
  return {
    ...real,
    async writeFileAtomic(path: string, contents: string) {
      const failure = path.endsWith("/curriculum.json")
        ? disk.failure
        : undefined;
      if (failure !== undefined) disk.failure = undefined;
      if (failure === "before rename") throw new Error("Injected write error");
      await real.writeFileAtomic(path, contents);
      if (failure === "after rename")
        throw new Error("Injected directory sync error");
    },
  };
});

// Each test gets its own data root; none touches ~/gauss (AGENTS.md).
let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "gauss-planning-"));
});
afterEach(async () => {
  disk.failure = undefined;
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
const plan = (objective: string, sections?: string[]): Plan => ({
  objectives: [{ id: objective, statement: `Do ${objective}.` }],
  segments: [
    {
      title: "It",
      objectives: [objective],
      ...(sections === undefined ? {} : { sections }),
    },
  ],
});
/** A Markdown source titled "Counting", so the record names it "counting". */
const NOTES: Outline = {
  id: "counting",
  title: "Counting",
  file: "original.md",
  name: "counting.md",
  format: "markdown",
  sha256: "c".repeat(64),
  converter: 5,
  limit: 20_000,
  entries: [
    {
      title: "Counting",
      entries: [
        {
          id: "s1",
          title: "Loops",
          size: 1_000,
          place: { paragraphs: { first: 1, last: 4 } },
        },
        {
          id: "s2",
          title: "Sets",
          size: 2_500,
          place: { paragraphs: { first: 1, last: 7 } },
        },
        {
          id: "s3",
          title: "Maps",
          size: 800,
          place: { paragraphs: { first: 1, last: 3 } },
        },
      ],
    },
  ],
};
/** "Counting" with its units reading the source's first two sections. */
const READING: CurriculumProposal = {
  ...CURRICULUM,
  units: [
    { ...LOOPS, sections: ["counting/s1"] },
    { ...SETS, sections: ["counting/s2"] },
  ],
};
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
  tutor?: FakeTurn[] | FakeBackend;
  finished?: boolean;
  /** The course has NOTES as its source, and its units read it (READING). */
  source?: boolean;
  /** Converts the files attached in the conversation; the fake's own if not given. */
  converter?: SourceConverter;
}) {
  const root = openDataRoot({ path: dir, now: () => new Date(NOW) });
  const { id } = await root.createCourse({ title: CURRICULUM.title });
  const curriculum = options.source === true ? READING : CURRICULUM;
  if (options.source === true) {
    await placeTestSource(root, dir, id, NOTES, {
      s1: "Loops.\n",
      s2: "Sets.\n",
      s3: "Maps.\n",
    });
  }
  await root.saveProposal(id, curriculum);
  await root.approveCurriculum(id, curriculum);
  await root.storePlan(
    id,
    "loops",
    plan("loop-count", curriculum.units[0]?.sections),
    curriculum.units[0]?.sections,
  );
  await root.storePlan(
    id,
    "sets",
    plan("set-count", curriculum.units[1]?.sections),
    curriculum.units[1]?.sections,
  );
  if (options.finished === true) {
    await root.appendEvidence(id, passed("loop-count"));
    await root.appendEvidence(id, passed("set-count"));
  }
  const commits: string[] = [];
  const backup = {
    commit: (message: string) => void commits.push(message),
    settled: () => Promise.resolve(),
  };
  const tutorBackend =
    Array.isArray(options.tutor) || options.tutor === undefined
      ? createFakeBackend(options.tutor ?? [], [])
      : options.tutor;
  const tutorTimer = createFakeTimer();
  const units = createUnitChats({
    backends: { claude: tutorBackend },
    systemPrompt: "Tutor.",
    dataRoot: root,
    planner: createUnitPlanner({
      backends: { claude: tutorBackend },
      systemPrompt: "Plan.",
      dataRoot: root,
    }),
    grader: createGrader({ backend: tutorBackend, systemPrompt: "Grader." }),
    judge: createHelpJudge({ backend: tutorBackend, systemPrompt: "Judge." }),
    now: () => new Date(NOW),
    timer: tutorTimer,
    order: givenOrder,
    backup,
  });
  const keptSessions = new KeptSessions();
  const backend = createFakeBackend(options.planner, [], {
    kept: keptSessions,
  });
  const timer = createFakeTimer();
  const plannings = createCoursePlannings({
    backend,
    systemPrompt: "Plan the course.",
    dataRoot: root,
    units,
    backup,
    timer,
    now: () => new Date(NOW),
    converter: options.converter ?? fakeConverter(),
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
    keptSessions,
    timer,
    tutorBackend,
    tutorTimer,
    root,
    plannings,
    units,
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

// Task 4.7: in a course with a source, units name their sections.
test("in a course with a source, the planner is given each unit's sections and the source's outline once; a section the source lacks is refused, and Apply keeps each unit's sections and plan", async () => {
  const maps = (section: string): Unit => ({ ...MAPS, sections: [section] });
  const units = READING.units;
  const { backend, planning, stored } = await setUp({
    source: true,
    planner: [
      ASK,
      [
        amend([...units, maps("counting/s9")]),
        amend([...units, maps("counting/s3")]),
      ],
    ],
  });
  const chat = await planning();
  chat.say("Add maps.");
  await chat.settled();
  chat.say("Yes.");
  await chat.settled();

  const first = backend.received[0]?.text ?? "";
  expect(first).toContain(
    "After them come the course's sources, each with its outline, in <sources>.]",
  );
  expect(first).toContain(
    "each with its status and the sections of the sources it teaches,",
  );
  expect(first).toContain(
    '{"id":"loops","title":"Loops","goal":"Count with loops.","prerequisites":[],"sections":["counting/s1"],"status":"not-started"',
  );
  expect(first).toContain(
    [
      "</about_the_learner>",
      "<sources>",
      'The course\'s sources. A unit names a section it teaches as "<source id>/<section id>".',
      "",
      '"Counting" (source id "counting"), a Markdown file, from the learner\'s file "counting.md". Its outline, one line per entry, indented by depth: a heading\'s title, or a section\'s id, title, place and size in characters.',
      '- "Counting"',
      '  - s1: "Loops", paragraphs 1–4, 1,000 characters',
      '  - s2: "Sets", paragraphs 1–7, 2,500 characters',
      '  - s3: "Maps", paragraphs 1–3, 800 characters',
      "</sources>",
      "",
      "Add maps.",
    ].join("\n"),
  );
  // The sources do not change, so a later turn does not give them again.
  expect(backend.received[1]?.text).not.toContain("<sources>");
  expect(refusals(backend)).toEqual([
    'Unit "maps" names "counting/s9", but "counting" has no such section: its sections are s1 to s3.',
  ]);

  const card = lastCard(chat.events());
  expect(card.units).toEqual([...units, maps("counting/s3")]);
  expect(card.was).toEqual(units);
  expect(await chat.apply(card.proposalId)).toEqual({ ok: true });
  expect(await stored()).toEqual([
    { ...units[0], plan: plan("loop-count", ["counting/s1"]) },
    { ...units[1], plan: plan("set-count", ["counting/s2"]) },
    maps("counting/s3"),
  ]);
});

// Task 6.20: a source attached in the planning conversation (piece 26).
const PINKARD = "# Counting\n\nArrangements and choices.\n";
/** The id the record gives PINKARD in a course whose source is NOTES. */
const ADDED = "counting-2";
const mapsReading = (ref: string): Unit => ({ ...MAPS, sections: [ref] });

/** The ids of the course's sources, and the conversation's uploads left. */
async function sourcesAndUploads(root: DataRoot, planningId: string) {
  const sources = (await root.readSources(COURSE)).map((s) => s.id);
  const folder = join(dir, "uploads", planningId);
  const uploads = existsSync(folder)
    ? (await readdir(folder)).filter((name) => !name.startsWith("."))
    : undefined;
  return { sources, uploads };
}

test("a source attached in the planning conversation waits under an id the course's sources lack, the planner is told of it once, a proposal can read it, and Apply moves it into the course with the change", async () => {
  const { backend, planning, root, stored, commits } = await setUp({
    source: true,
    planner: [
      [amend([...READING.units, mapsReading(`${ADDED}/s1`)])],
      [{ text: "It reads the new notes." }],
    ],
  });
  const chat = await planning();
  const attached = await chat.attach(upload("arrangements.md", PINKARD));
  expect(attached).toMatchObject({ ok: true });
  chat.say("Add a unit on these notes.");
  await chat.settled();

  const first = backend.received[0]?.text ?? "";
  expect(first).toContain(
    "in <sources>. <attached_sources> says what changed in the files the learner attached in this conversation since you were last told: each attached, with its outline; each they removed; and each that could not be attached. An attached source joins the course's sources when the learner applies a change, whether or not a unit reads it;",
  );
  expect(first).toContain(
    [
      "</sources>",
      "<attached_sources>",
      `Attached: "Counting" (source id "${ADDED}"), a Markdown file, from the learner's file "arrangements.md". Its outline, one line per entry, indented by depth: a heading's title, or a section's id, title, place and size in characters.`,
      '- "Counting"',
      '  - s1: "Counting", paragraphs 1–2, 38 characters',
      "</attached_sources>",
      "",
      "Add a unit on these notes.",
    ].join("\n"),
  );
  expect(refusals(backend)).toEqual([]);
  const card = lastCard(chat.events());
  expect(card.units.at(-1)).toEqual(mapsReading(`${ADDED}/s1`));
  expect(await sourcesAndUploads(root, chat.id)).toEqual({
    sources: ["counting"],
    uploads: [ADDED],
  });

  chat.say("Why that one?");
  await chat.settled();
  // Told once: the next turn carries no news of the files.
  expect(backend.received[1]?.text).not.toContain("<attached_sources>");

  expect(await chat.apply(card.proposalId)).toEqual({ ok: true });
  expect(await sourcesAndUploads(root, chat.id)).toEqual({
    sources: ["counting", ADDED],
    uploads: undefined,
  });
  expect((await stored())?.at(-1)).toEqual(mapsReading(`${ADDED}/s1`));
  expect(await root.readSection({ course: COURSE }, `${ADDED}/s1`)).toBe(
    PINKARD,
  );
  expect(commits).toEqual(["counting: curriculum changed"]);
});

test("Remove is refused while the proposal waiting reads the source and allowed once it is kept; the planner is told, and a proposal reading the removed source is refused", async () => {
  const { backend, planning, root } = await setUp({
    source: true,
    planner: [
      [amend([...READING.units, mapsReading(`${ADDED}/s1`)])],
      [amend([...READING.units, mapsReading(`${ADDED}/s1`)])],
    ],
  });
  const chat = await planning();
  const attached = await chat.attach(upload("arrangements.md", PINKARD));
  if (!attached.ok) throw new Error(attached.error);
  chat.say("Add a unit on these notes.");
  await chat.settled();
  const card = lastCard(chat.events());

  expect(await chat.removeSource(attached.attachment)).toMatchObject({
    ok: false,
    status: 409,
    error: expect.stringMatching(/^The proposal waiting reads this source\./),
  });
  expect(await chat.keep(card.proposalId)).toEqual({ ok: true });
  expect(await chat.removeSource(attached.attachment)).toEqual({ ok: true });
  expect(chat.events().at(-1)).toEqual({
    type: "source_removed",
    attachment: attached.attachment,
  });
  expect(await sourcesAndUploads(root, chat.id)).toEqual({
    sources: ["counting"],
    uploads: [],
  });

  chat.say("Use it anyway.");
  await chat.settled();
  expect(backend.received[1]?.text).toContain(
    `<attached_sources>\nRemoved by the learner: "Counting" (source id "${ADDED}"). It is not one of the course's sources.\n</attached_sources>`,
  );
  expect(refusals(backend)).toEqual([
    `Unit "maps" names "${ADDED}/s1", but the course has no source "${ADDED}": its sources are "counting".`,
  ]);
});

test("Apply waits for a file converting, then adds every source attached, read by a unit or not; a conversation closed without Apply adds none and leaves no uploads", async () => {
  const gate = Promise.withResolvers<void>();
  const fake = fakeConverter();
  let conversions = 0;
  const converter: SourceConverter = {
    ...fake,
    async convert(original, folder, signal) {
      if (++conversions === 2) await gate.promise;
      return fake.convert(original, folder, signal);
    },
  };
  const { planning, plannings, root } = await setUp({
    source: true,
    converter,
    planner: [[amend([...READING.units, mapsReading(`${ADDED}/s1`)])]],
  });
  const chat = await planning();
  await chat.attach(upload("arrangements.md", PINKARD));
  chat.say("Add a unit on these notes.");
  await chat.settled();
  const card = lastCard(chat.events());
  await chat.attach(upload("aside.md", "# Aside\n\nNot read by any unit.\n"));

  expect(await chat.apply(card.proposalId)).toEqual({
    ok: false,
    status: 409,
    error:
      "Wait until the file is converted: it joins the course with the change.",
  });
  expect(chat.inUse()).toBe("planning");
  gate.resolve();
  await chat.settled();
  expect(await chat.apply(card.proposalId)).toEqual({ ok: true });
  expect((await sourcesAndUploads(root, chat.id)).sources).toEqual([
    "aside",
    "counting",
    ADDED,
  ]);

  // A new conversation's file, closed with the server before any Apply.
  const next = await planning();
  await next.attach(upload("more.md", "# More\n\nSomething else.\n"));
  await next.settled();
  expect(await sourcesAndUploads(root, next.id)).toEqual({
    sources: ["aside", "counting", ADDED],
    uploads: ["more"],
  });
  await plannings.close();
  expect(await sourcesAndUploads(root, next.id)).toEqual({
    sources: ["aside", "counting", ADDED],
    uploads: undefined,
  });
});

test("a proposal reading a source attached since the planner was last told is refused until a turn has told it", async () => {
  const { root } = await setUp({ source: true, planner: [] });
  const sources = createAttachedSources({
    uploadsId: randomUUID(),
    dataRoot: root,
    converter: fakeConverter(),
    destination: { planning: COURSE, reads: () => false },
    emit: () => {},
  });
  await sources.attach(upload("arrangements.md", PINKARD));
  await sources.settled();
  const units = [...READING.units, mapsReading(`${ADDED}/s1`)];

  expect(await sources.checkProposal(units)).toBe(
    `The proposal names a source you have not seen in its current form: "${ADDED}". Wait for the updated outline on the next learner turn before proposing units that read it.`,
  );
  (await sources.forTurn(false)).sent();
  expect(await sources.checkProposal(units)).toBeUndefined();
  await sources.close();
});

test("an Apply refused because a unit has since started adds no source: it still waits, and can be removed once the proposal is kept", async () => {
  const { planning, root } = await setUp({
    source: true,
    planner: [[amend(READING.units)]],
  });
  // A third unit, not started, that the planner's change drops.
  await root.changeCurriculum(COURSE, [...READING.units, MAPS]);
  const chat = await planning();
  const attached = await chat.attach(upload("arrangements.md", PINKARD));
  if (!attached.ok) throw new Error(attached.error);
  chat.say("Drop maps, and keep these notes.");
  await chat.settled();
  const card = lastCard(chat.events());

  await root.storePlan(COURSE, "maps", plan("map-count"));
  expect(await chat.apply(card.proposalId)).toMatchObject({
    ok: false,
    status: 409,
  });
  expect(await sourcesAndUploads(root, chat.id)).toEqual({
    sources: ["counting"],
    uploads: [ADDED],
  });
  expect(await chat.keep(card.proposalId)).toEqual({ ok: true });
  expect(await chat.removeSource(attached.attachment)).toEqual({ ok: true });
});

test("a curriculum write that fails after the sources were moved leaves them the course's: they stay, and the planner is not told they were removed", async () => {
  const { backend, planning, root, stored } = await setUp({
    source: true,
    planner: [
      [amend([...READING.units, mapsReading(`${ADDED}/s1`)])],
      [{ text: "Noted." }],
    ],
  });
  const chat = await planning();
  const attached = await chat.attach(upload("arrangements.md", PINKARD));
  if (!attached.ok) throw new Error(attached.error);
  chat.say("Add a unit on these notes.");
  await chat.settled();
  const card = lastCard(chat.events());

  disk.failure = "before rename";
  await expect(chat.apply(card.proposalId)).rejects.toThrow(
    "Injected write error",
  );
  expect((await stored())?.map((u) => u.id)).toEqual(["loops", "sets"]);
  expect(await sourcesAndUploads(root, chat.id)).toEqual({
    sources: ["counting", ADDED],
    uploads: [],
  });
  expect(await chat.keep(card.proposalId)).toEqual({ ok: true });
  expect(await chat.removeSource(attached.attachment)).toEqual({
    ok: false,
    status: 409,
    error: "The source has joined the course, so it stays with it.",
  });
  chat.say("Fine.");
  await chat.settled();
  expect(backend.received[1]?.text).not.toContain("<attached_sources>");
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
      [{ text: "Teaching goes on." }],
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
  loops.say("Go on.");
  await loops.settled();
  expect(tutorBackend.received.at(-1)?.text).not.toContain(PLANNER_KEPT);
});

const PLANNER_BLOCK = "A curriculum change proposed from the course view waits";
const CAN_PROPOSE =
  "It no longer blocks your proposals. You may propose a style note or curriculum change again if appropriate.";
const PLANNER_KEPT =
  'The learner chose "Keep the current one" on the curriculum change proposed from the course view. ' +
  CAN_PROPOSE;
const PLANNER_APPLIED =
  "The learner applied the curriculum change proposed from the course view. " +
  CAN_PROPOSE;

test("Keep tells the tutor refused before replacement once, even after idle close, and it can propose again", async () => {
  const { tutorBackend, tutorTimer, planning, open } = await setUp({
    planner: [[amend([LOOPS, SETS, MAPS])], [amend([LOOPS, SETS, ...NEXT])]],
    tutor: createScriptedBackend(),
  });
  const loops = await open("loops");
  const sets = await open("sets");
  const chat = await planning();
  chat.say("Add maps.");
  await chat.settled();
  const first = lastCard(chat.events());

  sets.say("/style");
  await sets.settled();
  const refused = expect.stringContaining(PLANNER_BLOCK);
  expect(refusals(tutorBackend)).toEqual([refused]);

  chat.say("Plan the next stretch instead.");
  await chat.settled();
  expect(chat.events()).toContainEqual({
    type: "curriculum_change_answered",
    proposalId: first.proposalId,
    outcome: "replaced",
  });
  sets.say("Go on.");
  await sets.settled();
  const waitingHeader = tutorBackend.received.at(-1)?.text;
  expect(waitingHeader).not.toContain("The learner chose");
  expect(waitingHeader).not.toContain("The learner applied");
  loops.say("/style");
  await loops.settled();
  expect(refusals(tutorBackend)).toEqual([refused, refused]);
  expect(
    loops.events().find((e) => e.type === "style_proposed"),
  ).toBeUndefined();

  tutorTimer.advance(IDLE_MS);
  expect(await chat.keep(lastCard(chat.events()).proposalId)).toEqual({
    ok: true,
  });
  sets.say("/style");
  await sets.settled();
  const header = tutorBackend.received.at(-1)?.text ?? "";
  expect(header.split(PLANNER_KEPT)).toHaveLength(2);
  expect(tutorBackend.sessions.at(-1)?.resumeId).toBeDefined();
  const advice = expect.stringContaining(
    "Look for the learner's decision in a later turn header.",
  );
  expect(refusals(tutorBackend)).toEqual([advice, advice]);
  expect(sets.events()).toContainEqual(
    expect.objectContaining({ type: "style_proposed" }),
  );

  sets.say("Go on.");
  await sets.settled();
  expect(tutorBackend.received.at(-1)?.text).not.toContain(PLANNER_KEPT);
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

/**
 * Holds the next read of the course's sources, which the planner's desk
 * makes before its card, until `release`; `reading` resolves once it starts.
 */
function holdSources(root: DataRoot) {
  const reading = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const readSources = root.readSources;
  vi.spyOn(root, "readSources").mockImplementationOnce(async (id) => {
    reading.resolve();
    await release.promise;
    return readSources(id);
  });
  return { reading: reading.promise, release: () => release.resolve() };
}

test.each([
  {
    stopped: true,
    outcome:
      "released after a Stop shows no card and blocks no unit tutor's proposal",
  },
  { stopped: false, outcome: "released without a Stop shows its card" },
])(
  "a planner proposal with none waiting, held while it reads the sources, $outcome",
  async ({ stopped }) => {
    const { root, tutorBackend, planning, open } = await setUp({
      planner: [ASK, [amend([LOOPS, SETS, MAPS])]],
      tutor: [
        [{ text: "Teaching loops." }],
        [amend([LOOPS, SETS, { ...MAPS, id: "maps-2" }])],
      ],
    });
    const chat = await planning();
    chat.say("Plan more.");
    await chat.settled();
    // The session's first turn read the sources; the desk's read is next.
    const held = holdSources(root);

    expect(chat.say("Add maps.")).toEqual({ ok: true });
    await held.reading;
    if (stopped) await chat.interrupt();
    held.release();
    await chat.settled();

    if (!stopped) {
      expect(cards(chat.events())).toMatchObject([
        { units: [LOOPS, SETS, MAPS] },
      ]);
      return;
    }
    expect.soft(cards(chat.events())).toEqual([]);
    const loops = await open("loops");
    loops.say("Add a unit on maps.");
    await loops.settled();
    expect.soft(refusals(tutorBackend)).toEqual([]);
    expect(cards(loops.events())).toHaveLength(1);
  },
);

test.each([
  {
    stopped: true,
    outcome:
      "released after a Stop keeps the waiting one, which the next proposal replaces",
  },
  {
    stopped: false,
    outcome: "released without a Stop replaces the waiting one",
  },
])(
  "a planner proposal with one waiting, held while it reads the sources, $outcome",
  async ({ stopped }) => {
    const { root, planning } = await setUp({
      planner: [
        [amend([LOOPS, SETS, MAPS])],
        [amend([LOOPS, SETS, ...NEXT])],
        [amend([LOOPS, SETS, NEXT[0] as Unit])],
      ],
    });
    const chat = await planning();
    chat.say("Add maps.");
    await chat.settled();
    const first = lastCard(chat.events());
    const held = holdSources(root);

    expect(chat.say("Plan Counting 2.")).toEqual({ ok: true });
    await held.reading;
    if (stopped) await chat.interrupt();
    held.release();
    await chat.settled();
    const answered = () =>
      chat.events().filter((e) => e.type === "curriculum_change_answered");

    if (!stopped) {
      expect(cards(chat.events())).toMatchObject([
        { proposalId: first.proposalId },
        { units: [LOOPS, SETS, ...NEXT] },
      ]);
      expect(answered()).toEqual([
        {
          type: "curriculum_change_answered",
          proposalId: first.proposalId,
          outcome: "replaced",
        },
      ]);
      return;
    }
    expect.soft(cards(chat.events())).toEqual([first]);
    expect.soft(answered()).toEqual([]);
    // The first proposal is still the one waiting: the next replaces it.
    chat.say("Just the first unit of Counting 2.");
    await chat.settled();
    expect(cards(chat.events())).toMatchObject([
      { proposalId: first.proposalId },
      { units: [LOOPS, SETS, NEXT[0]] },
    ]);
    expect(answered()).toEqual([
      {
        type: "curriculum_change_answered",
        proposalId: first.proposalId,
        outcome: "replaced",
      },
    ]);
  },
);

test("reopening during Apply keeps the original conversation and card when a unit has since started", async () => {
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
  const writing = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const changeCurriculum = root.changeCurriculum;
  vi.spyOn(root, "changeCurriculum").mockImplementationOnce(
    async (id, units) => {
      writing.resolve();
      await release.promise;
      return changeCurriculum(id, units);
    },
  );
  const applying = chat.apply(card.proposalId);
  await writing.promise;
  const reopened = await planning().finally(() => release.resolve());
  const refused = await applying;
  expect(reopened.id).toBe(chat.id);
  expect((await planning()).id).toBe(chat.id);
  expect(refused).toMatchObject({ ok: false, status: 409 });
  expect(refused.ok ? "" : refused.error).toContain(
    'This change can no longer be applied. Unit "maps" ("Maps") has been started',
  );
  expect((await stored())?.map((u) => u.id)).toEqual(["loops", "sets", "maps"]);
  expect(await reopened.keep(card.proposalId)).toEqual({ ok: true });
});

test.each(["before rename", "after rename"] as const)(
  "Apply follows what reached disk when a curriculum write reports an error %s",
  async (failure) => {
    const { planning, stored, commits } = await setUp({
      planner: [[amend([LOOPS, SETS, MAPS])]],
    });
    const chat = await planning();
    chat.say("Add maps.");
    await chat.settled();
    const { proposalId } = lastCard(chat.events());

    disk.failure = failure;
    const applying = chat.apply(proposalId);
    if (failure === "before rename") {
      await expect(applying).rejects.toThrow("Injected write error");
      expect((await stored())?.map((u) => u.id)).toEqual(["loops", "sets"]);
      expect(await chat.keep(proposalId)).toEqual({ ok: true });
      expect(commits).toEqual([]);
    } else {
      await expect(applying).resolves.toEqual({ ok: true });
      expect((await stored())?.map((u) => u.id)).toEqual([
        "loops",
        "sets",
        "maps",
      ]);
      expect(chat.events()).toContainEqual({
        type: "curriculum_change_answered",
        proposalId,
        outcome: "applied",
      });
      expect(await chat.keep(proposalId)).toMatchObject({
        ok: false,
        status: 409,
      });
      expect(commits).toEqual(["counting: curriculum changed"]);
    }
  },
);

test("a replacement planner is told which proposals were replaced, kept, and still waiting", async () => {
  const { backend, keptSessions, timer, planning } = await setUp({
    planner: [
      [amend([LOOPS, SETS, ...NEXT], "Add both units.")],
      [amend([LOOPS, SETS, MAPS], "Cover maps instead.")],
      [amend([LOOPS, SETS, NEXT[0] as Unit], "Add one unit.")],
      [{ text: "Let's compare them." }],
    ],
  });
  const chat = await planning();
  chat.say("Plan Counting 2.");
  await chat.settled();
  chat.say("Focus on maps instead.");
  await chat.settled();
  expect(await chat.keep(lastCard(chat.events()).proposalId)).toEqual({
    ok: true,
  });
  chat.say("What about just the first unit of the original stretch?");
  await chat.settled();

  timer.advance(IDLE_MS);
  keptSessions.clear();
  chat.say("How does this compare with the one I declined?");
  await chat.settled();

  expect(chat.events()).toContainEqual(
    expect.objectContaining({ type: "fresh_start", reason: "not-resumed" }),
  );
  const turn = backend.received.at(-1)?.text ?? "";
  const proposals = [
    {
      units: [LOOPS, SETS, ...NEXT],
      why: "Add both units.",
      outcome: "replaced",
    },
    { units: [LOOPS, SETS, MAPS], why: "Cover maps instead.", outcome: "kept" },
    { units: [LOOPS, SETS, NEXT[0]], why: "Add one unit.", outcome: "waiting" },
  ];
  expect(turn).toContain(JSON.stringify(proposals));
});

test("Apply tells the refused tutor the decision and new units once, and it can propose from that curriculum", async () => {
  const { tutorBackend, planning, open } = await setUp({
    planner: [[amend([LOOPS, SETS, MAPS])]],
    tutor: createScriptedBackend(),
  });
  const loops = await open("loops");
  const sets = await open("sets");
  const chat = await planning();
  chat.say("Add maps.");
  await chat.settled();
  sets.say("/amend");
  await sets.settled();
  expect(refusals(tutorBackend)).toEqual([
    expect.stringContaining(PLANNER_BLOCK),
  ]);
  expect(cards(sets.events())).toEqual([]);
  expect(await chat.apply(lastCard(chat.events()).proposalId)).toEqual({
    ok: true,
  });
  await loops.settled();
  expect(loops.events()).toContainEqual({ type: "curriculum_changed" });

  loops.say("Go on.");
  await loops.settled();
  const header = tutorBackend.received.at(-1)?.text ?? "";
  const asUsual =
    "The learner applied a change to this course's curriculum, in another unit or from the course view.";
  const maps = '3. Maps (id "maps"): Count with maps.';
  expect(header).toContain(asUsual);
  expect(header).not.toContain(CAN_PROPOSE);
  expect(header).toContain(maps);

  sets.say("/amend");
  await sets.settled();
  const unblocked = tutorBackend.received.at(-1)?.text ?? "";
  expect(unblocked.split(PLANNER_APPLIED)).toHaveLength(2);
  expect(unblocked).not.toContain(asUsual);
  expect(unblocked.split(maps)).toHaveLength(2);
  expect(lastCard(sets.events()).units).toEqual([
    LOOPS,
    SETS,
    MAPS,
    {
      id: "practice-4",
      title: "Practice 4",
      goal: "Practise what the course has covered so far.",
      prerequisites: ["sets"],
    },
  ]);
  expect(refusals(tutorBackend)).toHaveLength(1);

  sets.say("Go on.");
  await sets.settled();
  const later = tutorBackend.received.at(-1)?.text;
  expect(later).not.toContain(PLANNER_APPLIED);
  expect(later).not.toContain(asUsual);
  expect(later).not.toContain(maps);
  expect(await sets.startFresh()).toEqual({ ok: true });
  await sets.settled();
  expect(tutorBackend.sessions.at(-1)?.systemPrompt).toContain(
    '3. Maps (id "maps"): Count with maps.',
  );
});

test("a Ready turn still resuming at Apply carries the decision in its header", async () => {
  const { tutorBackend, tutorTimer, root, planning, open } = await setUp({
    planner: [[amend([LOOPS, { ...MAPS, prerequisites: ["loops"] }, SETS])]],
    tutor: createScriptedBackend(),
  });
  const sets = await open("sets");
  const chat = await planning();
  chat.say("Add maps.");
  await chat.settled();
  sets.say("/style");
  await sets.settled();
  expect(refusals(tutorBackend)).toEqual([
    expect.stringContaining(PLANNER_BLOCK),
  ]);
  tutorTimer.advance(IDLE_MS);

  const resuming = Promise.withResolvers<void>();
  const resume = Promise.withResolvers<void>();
  const sent = Promise.withResolvers<string>();
  const startSession = tutorBackend.startSession;
  vi.spyOn(tutorBackend, "startSession").mockImplementationOnce(
    async (options) => {
      resuming.resolve();
      await resume.promise;
      const session = await startSession(options);
      return {
        ...session,
        send(turn, signal) {
          sent.resolve(turn.text);
          return session.send(turn, signal);
        },
      };
    },
  );
  expect(await sets.ready()).toEqual({ ok: true });
  await resuming.promise;

  // A read after Apply must not hold up (or lose) the decision's header.
  const read = Promise.withResolvers<void>();
  const readCourse = root.readCourse;
  const deferred = vi
    .spyOn(root, "readCourse")
    .mockImplementationOnce(async (id) => {
      await read.promise;
      return readCourse(id);
    });
  try {
    expect(await chat.apply(lastCard(chat.events()).proposalId)).toEqual({
      ok: true,
    });
    resume.resolve();
    const header = await sent.promise;
    expect(header).toMatch(/^\[Unit 3 of 3, "Sets"/);
    expect(header).toContain(PLANNER_APPLIED);
    expect(header).toContain('2. Maps (id "maps"): Count with maps.');
  } finally {
    resume.resolve();
    read.resolve();
    deferred.mockRestore();
    await sets.settled();
  }
});

test("an in-flight review cannot restore the unit order from before Apply", async () => {
  const { tutorBackend, root, units, planning, open } = await setUp({
    planner: [[amend([LOOPS, { ...MAPS, prerequisites: ["loops"] }, SETS])]],
    tutor: createScriptedBackend(),
  });
  const sets = await open("sets");
  await root.appendEvidence(COURSE, {
    ...passed("loop-count"),
    recordedAt: "2026-11-01T10:00:00.000Z",
  });
  const chat = await planning();
  chat.say("Add maps.");
  await chat.settled();
  sets.say("/style");
  await sets.settled();

  const read = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const readCourse = root.readCourse;
  vi.spyOn(root, "readCourse")
    .mockImplementationOnce(readCourse) // Choose the review's thread.
    .mockImplementationOnce(readCourse) // Open the selected chat.
    .mockImplementationOnce(async (id) => {
      const old = await readCourse(id);
      read.resolve();
      await release.promise;
      return old;
    });
  const reviewing = units.reviewNow(COURSE);
  try {
    expect(
      await Promise.race([
        read.promise.then(() => "snapshot"),
        reviewing.then(() => "review completed"),
      ]),
    ).toBe("snapshot");
    expect(await chat.apply(lastCard(chat.events()).proposalId)).toEqual({
      ok: true,
    });
  } finally {
    release.resolve();
  }
  expect(await reviewing).toEqual({ ok: true, unitId: "sets" });
  await sets.settled();
  const header = tutorBackend.received.at(-1)?.text;
  expect(header).toMatch(/^\[Unit 3 of 3, "Sets"/);
  expect(header).toContain(PLANNER_APPLIED);

  sets.say("Go on.");
  await sets.settled();
  expect(tutorBackend.received.at(-1)?.text).toMatch(/^\[Unit 3 of 3, "Sets"/);
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
