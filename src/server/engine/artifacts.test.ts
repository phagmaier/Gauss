// Artifacts through the unit chat (task 3.6): show_artifact stores the
// tutor's document in the course's artifacts/ folder and puts a reference
// in the thread, which transcripts keep; it is refused while a question is
// open, and over the size limit. The tutor is the fake backend.

import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { CurriculumProposal } from "../../shared/curriculum.ts";
import type { PageEvent } from "../../shared/events.ts";
import type { Plan } from "../../shared/plan.ts";
import {
  createFakeBackend,
  type FakeReply,
  type FakeTurn,
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
  dir = await mkdtemp(join(tmpdir(), "gauss-artifacts-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const NOW = "2026-11-17T10:00:00.000Z";
const COURSE = "chain-rule";
const CURRICULUM: CurriculumProposal = {
  title: "Chain rule",
  units: [
    {
      id: "chain",
      title: "The chain rule",
      goal: "Differentiate composite functions.",
      prerequisites: [],
    },
  ],
  style: "Short.",
  background: "The learner knows the power rule.",
};
const PLAN: Plan = {
  objectives: [
    { id: "chain-power", statement: "Differentiate a power of a function." },
  ],
  segments: [{ title: "Powers", objectives: ["chain-power"] }],
};

const GRAPH =
  '<!doctype html><svg viewBox="0 0 9 9"><path d="M0 9L9 0"/></svg>';
const show = (title: string, html = GRAPH) => ({
  call: "show_artifact",
  input: { title, html },
});
const CHOICE = {
  objective: "chain-power",
  kind: "choice",
  prompt: "What is $\\frac{d}{dx}(2x+1)^5$?",
  choices: ["$10(2x+1)^4$", "$5(2x+1)^4$"],
  answer: "A",
};

/** A server's unit chats on the record in `dir`, with the unit opened and its teaching turn over. */
async function start(script: FakeTurn[], replies: FakeReply[] = []) {
  const root = openDataRoot({ path: dir, now: () => new Date(NOW) });
  if ((await root.readCourse(COURSE)) === undefined) {
    const { id } = await root.createCourse({ title: CURRICULUM.title });
    await root.saveProposal(id, CURRICULUM);
    await root.approveCurriculum(id, CURRICULUM);
    await root.storePlan(id, "chain", PLAN);
  }
  const backend = createFakeBackend(script, replies);
  const units = createUnitChats({
    backends: { claude: backend },
    systemPrompt: "Tutor.",
    dataRoot: root,
    planner: createUnitPlanner({
      backends: { claude: backend },
      systemPrompt: "Plan.",
      dataRoot: root,
    }),
    grader: createGrader({ backend, systemPrompt: "Grader." }),
    judge: createHelpJudge({ backend, systemPrompt: "Judge." }),
    now: () => new Date(NOW),
    timer: createFakeTimer(),
    order: givenOrder,
  });
  const opened = await units.open(COURSE, "chain");
  if (!opened.ok) throw new Error(opened.error);
  await opened.chat.settled();
  return { backend, root, units, chat: opened.chat };
}

/** The thread's tutor text and artifacts, in order. */
function said(events: readonly PageEvent[]): unknown[] {
  return events.flatMap((e): unknown[] =>
    e.type === "tutor_text"
      ? [e.text]
      : e.type === "artifact"
        ? [{ file: e.file, title: e.title }]
        : [],
  );
}

test("an artifact shown while teaching is stored, numbered, and referred to in the thread where it was shown; one too large is refused and takes no number", async () => {
  const tooLarge = `<p>${"x".repeat(100_000)}</p>`;
  const { backend, root, chat } = await start([
    [
      { text: "Look at this." },
      show("Too much", tooLarge),
      show("The slope of sin(x²)"),
      { text: "Drag the point." },
    ],
    [show("Another one", "<p>2</p>"), { text: "Here." }],
  ]);

  expect(backend.calls.map((c) => c.result)).toEqual([
    {
      status: "refused",
      text: expect.stringContaining("over the limit of 100 KB"),
    },
    {
      status: "done",
      text: expect.stringContaining(
        'as artifact 1, "The slope of sin(x²)". The learner can close it',
      ),
    },
  ]);
  expect(said(chat.events())).toEqual([
    "Look at this.",
    { file: "1-the-slope-of-sin-x2.html", title: "The slope of sin(x²)" },
    "Drag the point.",
  ]);
  expect(await root.readArtifact(COURSE, "1-the-slope-of-sin-x2.html")).toBe(
    GRAPH,
  );

  // In the discussion, the next one is numbered after it.
  expect(chat.say("Show me another?")).toEqual({ ok: true });
  await chat.settled();
  expect(said(chat.events()).slice(3)).toEqual([
    { file: "2-another-one.html", title: "Another one" },
    "Here.",
  ]);
  expect(await readdir(join(dir, "courses", COURSE, "artifacts"))).toEqual([
    "1-the-slope-of-sin-x2.html",
    "2-another-one.html",
  ]);
});

test("the references are kept in the transcript, so the thread has them after a restart", async () => {
  const first = await start([[{ text: "See." }, show("A line")]]);
  await first.units.close();

  const { chat } = await start([]);

  expect(said(chat.events())).toEqual([
    "See.",
    { file: "1-a-line.html", title: "A line" },
  ]);
  expect(
    (await first.root.readTranscripts(COURSE, "chain"))[0]?.events,
  ).toContainEqual({
    type: "artifact",
    file: "1-a-line.html",
    title: "A line",
  });
});

test("while a question is open nothing is shown, with the reason; once it is graded an aid can be shown again", async () => {
  const { backend, root, chat } = await start(
    [
      [{ text: "Teaching." }],
      [{ text: "One question." }, { call: "ask_question", input: CHOICE }],
      // The reply to a message while question 1 is open.
      [show("A hint"), { text: "I can't show that now." }],
      // The feedback on the answer.
      [{ text: "Right." }, show("Why it is right")],
    ],
    [
      {
        output: {
          reason: "Nothing toward the answer.",
          verdict: "clarification",
        },
      },
    ],
  );
  expect(await chat.ready()).toEqual({ ok: true });
  await chat.settled();

  expect(chat.say("Can you draw it?")).toEqual({ ok: true });
  await chat.settled();
  expect(backend.calls.at(-1)?.result).toEqual({
    status: "refused",
    text:
      "Question 1 is open: nothing can be shown beside the conversation " +
      "until its answer is graded, since an aid could help with the answer.",
  });
  expect(said(chat.events())).not.toContainEqual(
    expect.objectContaining({ title: "A hint" }),
  );
  expect(await root.readArtifact(COURSE, "1-a-hint.html")).toBeUndefined();

  const posted = chat.events().findLast((e) => e.type === "question");
  if (posted?.type !== "question") throw new Error("no question posted");
  expect(
    await chat.answer({
      kind: "choice",
      questionId: posted.question.id,
      choice: "A",
      confidence: "90",
    }),
  ).toEqual({ ok: true });
  await chat.settled();

  expect(said(chat.events()).slice(-2)).toEqual([
    "Right.",
    { file: "1-why-it-is-right.html", title: "Why it is right" },
  ]);
});

test("an aid whose write ends after a Stop is not shown, and the next one is", async () => {
  const { root, chat } = await start([
    [{ text: "Teaching." }],
    [show("Stopped"), { text: "Not reached." }],
    [show("Shown"), { text: "Here." }],
  ]);
  const writing = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const writeArtifact = root.writeArtifact;
  vi.spyOn(root, "writeArtifact").mockImplementationOnce(
    async (id, artifact) => {
      writing.resolve();
      await release.promise;
      return writeArtifact(id, artifact);
    },
  );

  expect(chat.say("Can you draw it?")).toEqual({ ok: true });
  await writing.promise;
  await chat.interrupt();
  release.resolve();
  await chat.settled();
  expect(said(chat.events())).toEqual(["Teaching."]);

  expect(chat.say("Draw it again?")).toEqual({ ok: true });
  await chat.settled();
  const shown = chat.events().filter((event) => event.type === "artifact");
  expect(shown).toMatchObject([{ title: "Shown" }]);
  expect(await root.readArtifact(COURSE, shown[0]?.file ?? "")).toBe(GRAPH);
  expect(said(chat.events()).at(-1)).toBe("Here.");
});

test("a finished unit can still reply but cannot store a new artifact", async () => {
  const { backend, root, chat } = await start([
    [{ text: "Teaching." }],
    [{ call: "ask_question", input: CHOICE }],
    [{ text: "Correct." }],
    [show("A line"), { text: "The unit is finished." }],
  ]);
  expect(await chat.ready()).toEqual({ ok: true });
  await chat.settled();
  const posted = chat.events().findLast((event) => event.type === "question");
  if (posted?.type !== "question") throw new Error("no question posted");
  expect(
    await chat.answer({
      kind: "choice",
      questionId: posted.question.id,
      choice: "A",
      confidence: "90",
    }),
  ).toEqual({ ok: true });
  await chat.settled();
  // The unit's gate, skipped, finishes it.
  expect(await chat.skipAssessment()).toEqual({ ok: true });
  await chat.settled();
  expect(chat.events()).toContainEqual({
    type: "unit_closed",
    status: "passed",
  });

  expect(chat.say("Can you show it once more?")).toEqual({ ok: true });
  await chat.settled();
  expect(backend.calls.at(-1)?.result).toEqual({
    status: "refused",
    text: "The unit is finished.",
  });
  expect(chat.events().some((event) => event.type === "artifact")).toBe(false);
  expect(await root.readArtifact(COURSE, "1-a-line.html")).toBeUndefined();
});
