// Changing a course's style note after approval (task 5.11): the tutor's
// propose_style through the unit chat, on the fake backend, with the card,
// the learner's Apply and "Keep the current one", the refusals and a
// restart with the card waiting.

import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  rmdir,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { CurriculumProposal } from "../../shared/curriculum.ts";
import type { PageEvent } from "../../shared/events.ts";
import type { Plan } from "../../shared/plan.ts";
import {
  createFakeBackend,
  type FakeTurn,
  KeptSessions,
} from "../backends/fake.ts";
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
  dir = await mkdtemp(join(tmpdir(), "gauss-style-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const NOW = "2026-11-19T10:00:00.000Z";
const COURSE = "counting";
const STYLE = "Short explanations. Many small exercises.";
const NOTE = "Short explanations. Two worked examples before each exercise.";
const CURRICULUM: CurriculumProposal = {
  title: "Counting",
  units: [
    {
      id: "loops",
      title: "Loops",
      goal: "Count with loops.",
      prerequisites: [],
    },
    { id: "sets", title: "Sets", goal: "Count with sets.", prerequisites: [] },
  ],
  style: STYLE,
  background: "The learner knows Python.",
};
const PLAN: Plan = {
  objectives: [{ id: "loop-count", statement: "Count with a loop." }],
  segments: [{ title: "Counting", objectives: ["loop-count"] }],
};
const CHOICE = {
  objective: "loop-count",
  kind: "choice",
  prompt: "How many times does `for i in range(3)` run?",
  choices: ["3", "2"],
  answer: "A",
};
const propose = (note = NOTE) => ({
  call: "propose_style",
  input: { note, why: "You asked for worked examples." },
});
const STYLE_SECTION = (note: string) => `# This course's style\n\n${note}\n`;

/** A server's unit chats on the record in `dir`; no unit is opened yet. */
async function server(script: FakeTurn[], kept?: KeptSessions) {
  const root = openDataRoot({ path: dir, now: () => new Date(NOW) });
  if ((await root.readCourse(COURSE)) === undefined) {
    const { id } = await root.createCourse({ title: CURRICULUM.title });
    await root.saveProposal(id, CURRICULUM);
    await root.approveCurriculum(id, CURRICULUM);
    await root.storePlan(id, "loops", PLAN);
    await root.storePlan(id, "sets", {
      objectives: [{ id: "set-count", statement: "Count with a set." }],
      segments: [{ title: "Sets", objectives: ["set-count"] }],
    });
  }
  const backend = createFakeBackend(
    script,
    [],
    kept === undefined ? {} : { kept },
  );
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
  return { backend, root, units, commits, open };
}

function proposalId(events: readonly PageEvent[]): string {
  const card = events.findLast((e) => e.type === "style_proposed");
  if (card?.type !== "style_proposed") throw new Error("no proposal");
  return card.proposalId;
}

function styleFile(): Promise<string> {
  return readFile(join(dir, "courses", COURSE, "style.md"), "utf8");
}

test("a proposal shows its card against the current note, is kept in the position, does not end the turn, and is said in every header until answered", async () => {
  const { backend, root, open } = await server([
    [{ text: "Teaching." }, propose(), { text: "After the card." }],
    [{ text: "A reply." }],
  ]);
  const chat = await open();

  expect(backend.calls.at(-1)?.result).toEqual({
    status: "done",
    text: expect.stringContaining("The learner sees your proposal on a card."),
  });
  const events = chat.events();
  const card = events.findIndex((e) => e.type === "style_proposed");
  expect(events[card]).toEqual({
    type: "style_proposed",
    proposalId: expect.any(String),
    note: NOTE,
    was: STYLE,
    why: "You asked for worked examples.",
  });
  expect(events.slice(card)).toContainEqual({
    type: "tutor_text",
    text: "After the card.",
  });
  expect((await root.readState(COURSE)).units.loops?.styleProposal).toEqual({
    id: proposalId(events),
    note: NOTE,
    was: STYLE,
    why: "You asked for worked examples.",
    proposedAt: NOW,
  });

  expect(chat.say("And?")).toEqual({ ok: true });
  await chat.settled();
  expect(backend.received.at(-1)?.text).toContain(
    "Your proposed style note waits for the learner's answer",
  );
  expect(await styleFile()).toBe(`${STYLE}\n`);
});

test.each([
  {
    stopped: true,
    outcome:
      "released after a Stop shows no card and keeps none, and the next one shows",
  },
  { stopped: false, outcome: "released without a Stop shows its card" },
])("a proposal held while it reads the note, $outcome", async ({ stopped }) => {
  const { root, open } = await server([
    [{ text: "Teaching." }],
    [propose(), { text: "After the card." }],
    [propose(), { text: "After the card." }],
  ]);
  const chat = await open();
  const reading = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const readStyle = root.readStyle;
  vi.spyOn(root, "readStyle").mockImplementationOnce(async (id) => {
    reading.resolve();
    await release.promise;
    return readStyle(id);
  });
  const cards = () => chat.events().filter((e) => e.type === "style_proposed");
  const waiting = async () =>
    (await root.readState(COURSE)).units.loops?.styleProposal;

  expect(chat.say("More examples, please.")).toEqual({ ok: true });
  await reading.promise;
  if (stopped) await chat.interrupt();
  release.resolve();
  await chat.settled();
  if (stopped) {
    expect.soft(cards()).toEqual([]);
    expect.soft(await waiting()).toBeUndefined();
    // Nothing the stopped call held is left blocking the next.
    expect(chat.say("Please.")).toEqual({ ok: true });
    await chat.settled();
  }

  expect(cards()).toMatchObject([{ note: NOTE, was: STYLE }]);
  expect(await waiting()).toMatchObject({ note: NOTE });
});

test("Apply writes style.md and asks for a backup commit; the running session is told the note in its next header, and one started after has it in its system prompt", async () => {
  const { backend, root, commits, open } = await server([
    [{ text: "Teaching." }, propose()],
    [{ text: "A reply." }],
    [{ text: "Fresh." }],
  ]);
  const chat = await open();

  expect(await chat.applyStyle(proposalId(chat.events()))).toEqual({
    ok: true,
  });
  expect(await styleFile()).toBe(`${NOTE}\n`);
  expect(await root.readStyle(COURSE)).toBe(NOTE);
  expect(
    (await root.readState(COURSE)).units.loops?.styleProposal,
  ).toBeUndefined();
  expect(chat.events().at(-1)).toEqual({
    type: "style_answered",
    proposalId: proposalId(chat.events()),
    outcome: "applied",
  });
  expect(commits).toContain(`${COURSE}: style note changed`);

  // The session already running keeps the prompt it was opened with.
  expect(chat.say("Go on.")).toEqual({ ok: true });
  await chat.settled();
  const header = backend.received.at(-1)?.text ?? "";
  expect(header).toContain("The learner applied the style note you proposed");
  expect(header).toContain(`<style_note>\n${NOTE}\n</style_note>`);
  expect(header).not.toContain("waits for the learner's answer");
  expect(backend.sessions[0]?.systemPrompt).toContain(STYLE_SECTION(STYLE));

  expect(await chat.startFresh()).toEqual({ ok: true });
  await chat.settled();
  expect(backend.sessions.at(-1)?.systemPrompt).toContain(STYLE_SECTION(NOTE));
  expect(backend.received.at(-1)?.text).not.toContain(
    "The learner applied the style note",
  );
});

test('"Keep the current one" leaves style.md as it was, and the tutor is told in its next header', async () => {
  const { backend, root, commits, open } = await server([
    [{ text: "Teaching." }, propose()],
    [{ text: "A reply." }],
    [{ text: "Fresh." }],
  ]);
  const chat = await open();

  expect(await chat.keepStyle(proposalId(chat.events()))).toEqual({
    ok: true,
  });
  expect(await styleFile()).toBe(`${STYLE}\n`);
  expect(
    (await root.readState(COURSE)).units.loops?.styleProposal,
  ).toBeUndefined();
  expect(chat.events().at(-1)).toEqual({
    type: "style_answered",
    proposalId: proposalId(chat.events()),
    outcome: "kept",
  });
  expect(commits).not.toContain(`${COURSE}: style note changed`);
  // Answered once: the card no longer waits.
  expect(await chat.applyStyle(proposalId(chat.events()))).toEqual({
    ok: false,
    status: 409,
    error: "That proposed style note is not waiting.",
  });

  expect(chat.say("Go on.")).toEqual({ ok: true });
  await chat.settled();
  expect(backend.received.at(-1)?.text).toContain(
    'The learner chose "Keep the current one"',
  );
  expect(await chat.startFresh()).toEqual({ ok: true });
  await chat.settled();
  expect(backend.sessions.at(-1)?.systemPrompt).toContain(STYLE_SECTION(STYLE));
});

test("if the position cannot be saved, Apply leaves the old note and Keep still means Keep", async () => {
  const { open, commits } = await server([[propose()]]);
  const chat = await open();
  const id = proposalId(chat.events());
  const state = join(dir, "courses", COURSE, "state.json");
  const saved = `${state}.saved`;
  await rename(state, saved);
  await mkdir(state);
  try {
    await expect(chat.applyStyle(id)).rejects.toThrow();
    expect(await styleFile()).toBe(`${STYLE}\n`);
  } finally {
    await rmdir(state);
    await rename(saved, state);
  }
  expect(await chat.keepStyle(id)).toEqual({ ok: true });
  expect(await styleFile()).toBe(`${STYLE}\n`);
  expect(commits).not.toContain(`${COURSE}: style note changed`);
});

test.each([`${STYLE}\n\n`, null])(
  "reopening rolls back an interrupted Apply before teaching or answering the card (old file: %j)",
  async (was) => {
    const first = await server([[propose()]]);
    const course = join(dir, "courses", COURSE);
    const style = join(course, "style.md");
    if (was === null) await rm(style);
    else await writeFile(style, was);
    const before = await first.open();
    const id = proposalId(before.events());
    await first.units.close();

    // A process stopped after replacing style.md but before committing the decision.
    const state = await first.root.readState(COURSE);
    await writeFile(
      join(course, "state.json"),
      JSON.stringify({ ...state, styleRollback: { was } }),
    );
    await writeFile(style, `${NOTE}\n`);
    const second = await server([[{ text: "Replied." }]]);
    const chat = await second.open();
    expect(await second.root.readStyle(COURSE)).toBe(
      was === null ? undefined : STYLE,
    );
    expect(await chat.keepStyle(id)).toEqual({ ok: true });
    expect(chat.say("Go on.")).toEqual({ ok: true });
    await chat.settled();
    expect(second.backend.sessions.at(-1)?.systemPrompt).not.toContain(NOTE);
    if (was === null) {
      await expect(styleFile()).rejects.toMatchObject({ code: "ENOENT" });
    } else {
      expect(await styleFile()).toBe(was);
    }
    await second.units.close();
  },
);

test.each(["applied", "kept"] as const)(
  "a decision that was %s is delivered to the resumed tutor, even if its first reply fails",
  async (outcome) => {
    const kept = new KeptSessions();
    const first = await server([[propose()]], kept);
    const before = await first.open();
    const id = proposalId(before.events());
    const answer = outcome === "applied" ? before.applyStyle : before.keepStyle;
    expect(await answer(id)).toEqual({ ok: true });
    await first.units.close();

    const second = await server([], kept);
    const reopened = await second.open();
    expect(reopened.say("Go on.")).toEqual({ ok: true });
    await reopened.settled();
    expect(second.backend.sessions.at(-1)?.resumeId).toBe(first.backend.ids[0]);
    expect(reopened.events().at(-1)).toMatchObject({
      type: "turn_end",
      outcome: "error",
    });
    await second.units.close();

    const third = await server(
      [[{ text: "Reply." }], [{ text: "Next reply." }]],
      kept,
    );
    const chat = await third.open();
    const decision =
      outcome === "applied"
        ? "The learner applied the style note you proposed"
        : 'The learner chose "Keep the current one"';
    expect(chat.say("Try again.")).toEqual({ ok: true });
    await chat.settled();
    expect(third.backend.received[0]?.text).toContain(decision);
    if (outcome === "applied") {
      expect(third.backend.received[0]?.text).toContain(
        `<style_note>\n${NOTE}\n</style_note>`,
      );
    }
    expect(chat.say("And now?")).toEqual({ ok: true });
    await chat.settled();
    expect(third.backend.received[1]?.text).not.toContain(decision);
    await third.units.close();
  },
);

test("a tutor cannot post a style card in its feedback-only turn", async () => {
  const { backend, open } = await server([
    [{ text: "Teaching." }],
    [{ call: "ask_question", input: CHOICE }],
    [{ text: "Correct." }, propose()],
  ]);
  const chat = await open();
  expect(await chat.ready()).toEqual({ ok: true });
  await chat.settled();
  const event = chat.events().findLast((e) => e.type === "question");
  if (event?.type !== "question") throw new Error("no question");
  expect(
    await chat.answer({
      kind: "choice",
      questionId: event.question.id,
      choice: "A",
      confidence: "90",
    }),
  ).toEqual({ ok: true });
  await chat.settled();
  expect(backend.calls.at(-1)?.result).toMatchObject({ status: "refused" });
  expect(chat.events().some((e) => e.type === "style_proposed")).toBe(false);
});

test("a proposal is refused while a question of the unit is open, and when it is the current note", async () => {
  const { backend, open } = await server([
    [{ text: "Teaching." }, propose(STYLE)],
    [{ text: "A question." }, { call: "ask_question", input: CHOICE }],
    [{ text: "A reply." }, propose()],
  ]);
  const chat = await open();
  expect(backend.calls.at(-1)?.result).toEqual({
    status: "refused",
    text: "That is the current style note: nothing would change.",
  });

  expect(await chat.ready()).toEqual({ ok: true });
  await chat.settled();
  expect(chat.say("Could you explain less?")).toEqual({ ok: true });
  await chat.settled();
  expect(backend.calls.at(-1)?.result).toEqual({
    status: "refused",
    text: "Question 1 is open: propose a change to the style once its answer is graded.",
  });
  expect(chat.events().some((e) => e.type === "style_proposed")).toBe(false);
});

test("a second proposal is refused while one waits, in another unit of the course too", async () => {
  const { backend, open } = await server([
    [{ text: "Teaching." }, propose(), propose("Long explanations.")],
    [{ text: "Teaching sets." }, propose("Long explanations.")],
  ]);
  const waiting = {
    status: "refused",
    text:
      "A proposed style note already waits for the learner's answer. " +
      "Wait for it: a header says how they answered.",
  };
  await open("loops");
  expect(backend.calls.at(-1)?.result).toEqual(waiting);

  const sets = await open("sets");
  expect(backend.calls.at(-1)?.result).toEqual(waiting);
  expect(sets.events().some((e) => e.type === "style_proposed")).toBe(false);
});

test("a card waiting across a restart shows again and can be applied", async () => {
  const first = await server([[{ text: "Teaching." }, propose()]]);
  const before = await first.open();
  const id = proposalId(before.events());
  await first.units.close();

  const second = await server([[{ text: "A reply." }]]);
  const chat = await second.open();
  // Once from the transcript, which cannot be answered, and again as the
  // chat opens, which can.
  expect(chat.events().filter((e) => e.type === "style_proposed")).toEqual([
    expect.objectContaining({ proposalId: id, historical: true }),
    expect.not.objectContaining({ historical: true }),
  ]);
  expect(await chat.applyStyle(id)).toEqual({ ok: true });
  expect(await styleFile()).toBe(`${NOTE}\n`);
});

test("another unit open when the note is applied is told it in its next header, and its next session starts with it", async () => {
  const { backend, open } = await server([
    [{ text: "Teaching loops." }, propose()],
    [{ text: "Teaching sets." }],
    [{ text: "A reply in sets." }],
    [{ text: "Fresh in sets." }],
  ]);
  const loops = await open("loops");
  const sets = await open("sets");

  expect(await loops.applyStyle(proposalId(loops.events()))).toEqual({
    ok: true,
  });
  await sets.settled();
  expect(sets.say("Go on.")).toEqual({ ok: true });
  await sets.settled();
  expect(backend.received.at(-1)?.text).toContain(
    `The learner applied a new style note for this course in another unit.`,
  );
  expect(await sets.startFresh()).toEqual({ ok: true });
  await sets.settled();
  expect(backend.sessions.at(-1)?.systemPrompt).toContain(STYLE_SECTION(NOTE));
});
