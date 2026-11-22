// Verified quotes through the unit chat (task 4.9): quote_source looks for
// the tutor's passage in the course's sources and shows it in the thread,
// in the source's words and where it starts, in the transcript too; a
// match in the section named, then in the segment's, comes first. It is
// refused when the sources lack the passage, and while a question of the
// unit is open, as an aid is. The notes writer gets each quote with its
// citation and the unit's sections, and the exported transcript names a
// section link's section and page. The tutor is the fake backend.

import { mkdtemp, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { CurriculumProposal, Unit } from "../../shared/curriculum.ts";
import type { PageEvent } from "../../shared/events.ts";
import type { Plan } from "../../shared/plan.ts";
import type { Outline } from "../../shared/source.ts";
import { QUOTE_NOT_FOUND } from "../../shared/source-quote.ts";
import type { UnitPosition } from "../../shared/state.ts";
import {
  createFakeBackend,
  type FakeReply,
  type FakeTurn,
} from "../backends/fake.ts";
import { type DataRoot, openDataRoot } from "../record/data-root.ts";
import type { SourceQuoted } from "../tools/sources.ts";
import { givenOrder } from "./choice-order.ts";
import { placeTestSource } from "./fake-converter.ts";
import { createFakeTimer } from "./fake-timer.ts";
import { createGrader } from "./grading.ts";
import { createHelpJudge } from "./help-judge.ts";
import { createNotes } from "./notes.ts";
import { createSourceShelf } from "./source-shelf.ts";
import { renderTranscript } from "./transcript-html.ts";
import { createUnitChats } from "./unit-chat.ts";
import { createUnitPlanner } from "./unit-planning.ts";

// Each test gets its own data root; none touches ~/gauss (AGENTS.md).
let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "gauss-source-quotes-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const NOW = "2026-11-21T10:00:00.000Z";

// The Preface is cut in two between paragraphs; "it is essentially a
// result" is in both parts.
const S1 =
  '<!-- page 1 label "9" -->\n# Preface\n\nThe true is the whole.\n\n' +
  '<!-- page 2 label "10" -->\nOf the Absolute it must be said that it is essentially a result.\n\n';
const S2 =
  "Only at the end is it what it is in truth.\n\n" +
  '<!-- page 3 label "11" -->\nIt is essentially a result, and the true is the whole.\n';
const S3 = '<!-- page 4 label "12" -->\n# Introduction\n\nKnowing is a test.\n';
const BOOK: Outline = {
  id: "phenomenology",
  title: "Phenomenology",
  file: "original.pdf",
  name: "hegel.pdf",
  format: "pdf",
  sha256: "a".repeat(64),
  converter: 6,
  limit: 20_000,
  pages: { count: 4, labels: ["9", "10", "11", "12"], blank: [] },
  entries: [
    {
      title: "Preface",
      entries: [
        {
          id: "s1",
          title: "Preface (part 1 of 2)",
          size: S1.length,
          place: { pages: { first: 1, last: 2 } },
          part: { number: 1, of: 2 },
        },
        {
          id: "s2",
          title: "Preface (part 2 of 2)",
          size: S2.length,
          place: { pages: { first: 2, last: 3 } },
          part: { number: 2, of: 2 },
        },
      ],
    },
    {
      id: "s3",
      title: "Introduction",
      size: S3.length,
      place: { pages: { first: 4, last: 4 } },
    },
  ],
};

const PREFACE: Unit = {
  id: "preface",
  title: "The Preface",
  goal: "Say why the true is the whole.",
  prerequisites: [],
  sections: ["phenomenology/s1", "phenomenology/s2"],
};
const CURRICULUM: CurriculumProposal = {
  title: "Reading Hegel",
  units: [
    PREFACE,
    {
      id: "introduction",
      title: "The Introduction",
      goal: "Say how knowing tests itself.",
      prerequisites: ["preface"],
      sections: ["phenomenology/s3"],
    },
  ],
  style: "Close reading.",
  background: "The learner has read Kant.",
};
const PLAN: Plan = {
  objectives: [
    { id: "whole", statement: "Explain why the true is the whole." },
    { id: "result", statement: "Explain why the Absolute is a result." },
  ],
  segments: [
    {
      title: "The whole",
      objectives: ["whole"],
      sections: ["phenomenology/s1"],
    },
    {
      title: "The result",
      objectives: ["result"],
      sections: ["phenomenology/s2"],
    },
  ],
};

/** The course with its source, the preface planned, at the position given. */
async function makeCourse(root: DataRoot, position?: UnitPosition) {
  const { id } = await root.createCourse({ title: CURRICULUM.title });
  await placeTestSource(root, dir, id, BOOK, { s1: S1, s2: S2, s3: S3 });
  await root.saveProposal(id, CURRICULUM);
  await root.approveCurriculum(id, CURRICULUM);
  await root.storePlan(id, "preface", PLAN, PREFACE.sections);
  if (position !== undefined) await root.writePosition(id, "preface", position);
  return id;
}

/** A server's unit chats on the record, with the preface opened and its first turn over. */
async function open(
  root: DataRoot,
  id: string,
  script: FakeTurn[],
  replies: FakeReply[] = [],
) {
  const backend = createFakeBackend(script, replies);
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
  });
  const opened = await units.open(id, "preface");
  if (!opened.ok) throw new Error(opened.error);
  await opened.chat.settled();
  return { backend, units, chat: opened.chat };
}

const quote = (text: string, section?: string) => ({
  call: "quote_source",
  input: section === undefined ? { text } : { text, section },
});

/** The thread's tutor text and quotes, in order. */
function said(events: readonly PageEvent[]): unknown[] {
  return events.flatMap((e): unknown[] =>
    e.type === "tutor_text" || e.type === "source_quoted" ? [e] : [],
  );
}

async function shelfFor(root: DataRoot, id: string) {
  const shown: SourceQuoted[] = [];
  const shelf = createSourceShelf({
    dataRoot: root,
    courseId: id,
    courseInstance: (await root.readCourse(id))?.course.instance,
    sources: await root.readSources(id),
    converter: undefined,
    emit: () => {},
    quotes: {
      closed: async () => undefined,
      show: async (event) => {
        shown.push(event);
        return undefined;
      },
      segmentSections: () => [],
    },
  });
  return { shelf, shown };
}

test("concurrent shelves share one course index, but a recreated course does not", async () => {
  const root = openDataRoot({ path: dir, now: () => new Date(NOW) });
  const id = await makeCourse(root);
  const [{ shelf: first, shown }, { shelf: second }] = await Promise.all([
    shelfFor(root, id),
    shelfFor(root, id),
  ]);
  const paths = vi.spyOn(root, "sourceSectionFiles");
  const passage = { text: "it is essentially a result" };
  const result = await Promise.all([
    first.quote(passage),
    second.quote({ ...passage, section: "phenomenology/s2" }),
  ]);
  expect(result[0]).toEqual({
    text: expect.stringContaining("starting at page 2 (printed 10)"),
  });
  expect(result[1]).toEqual({
    text: expect.stringContaining("starting at page 3 (printed 11)"),
  });
  expect(await second.quote(passage)).toEqual(result[0]);
  expect(paths).toHaveBeenCalledTimes(1);
  expect(shown).toEqual([
    {
      type: "source_quoted",
      section: "phenomenology/s1",
      text: "it is essentially a result",
      at: { page: 2 },
    },
  ]);

  await root.deleteCourse(id);
  const replacement = await root.createCourse({ title: CURRICULUM.title });
  expect(replacement.id).toBe(id);
  await placeTestSource(root, dir, id, BOOK, { s1: "", s2: "", s3: S3 });
  const { shelf, shown: replacementShown } = await shelfFor(root, id);
  expect(await shelf.quote(passage)).toEqual({ refused: QUOTE_NOT_FOUND });
  expect(replacementShown).toEqual([]);
  expect(paths).toHaveBeenCalledTimes(2);
});

test("a failed course index can be retried; an abandoned queued quote does not read its course", async () => {
  const root = openDataRoot({ path: dir });
  const id = await makeCourse(root);
  const { shelf, shown } = await shelfFor(root, id);
  const { id: otherId } = await root.createCourse({ title: "Other course" });
  await placeTestSource(root, dir, otherId, BOOK, { s1: S1, s2: S2, s3: S3 });
  const other = await shelfFor(root, otherId);
  const ref = "phenomenology/s3";
  const file = (await root.sourceSectionFiles(id, [ref])).get(ref);
  if (file === undefined) throw new Error("The test section has no path.");
  const entered = Promise.withResolvers<void>();
  const proceed = Promise.withResolvers<void>();
  const sourceSectionFiles = root.sourceSectionFiles;
  const paths = vi
    .spyOn(root, "sourceSectionFiles")
    .mockImplementationOnce(async (...args) => {
      entered.resolve();
      await proceed.promise;
      return sourceSectionFiles(...args);
    });
  const passage = { text: "knowing is a test" };

  await rename(file, `${file}.away`);
  const failed = expect(shelf.quote(passage)).rejects.toThrow(
    `The file of the section "${ref}" is missing.`,
  );
  await entered.promise;
  try {
    const stop = new AbortController();
    const reason = new Error("Turn stopped");
    const abandoned = expect(
      other.shelf.quote(passage, stop.signal),
    ).rejects.toBe(reason);
    await Promise.resolve(); // Let the authorized quote enter the queue.
    stop.abort(reason);
    await abandoned;
  } finally {
    proceed.resolve();
    try {
      await failed;
    } finally {
      await rename(`${file}.away`, file);
    }
  }

  expect(await shelf.quote(passage)).toEqual({
    text: expect.stringContaining("starting at page 4 (printed 12)"),
  });
  expect(paths.mock.calls.map(([course]) => course)).toEqual([id, id]);
  expect(shown).toHaveLength(1);
  expect(other.shown).toEqual([]);
});

test("a source lecture publishes only verified blocks, in order through replay and export", async () => {
  const root = openDataRoot({ path: dir, now: () => new Date(NOW) });
  const id = await makeCourse(root);
  const section = "phenomenology/s1";
  const prose = (text: string) => ({ kind: "prose", text });
  const passage = (text: string) => ({ kind: "quote", section, text });
  const blocks = [
    prose("Start with the claim."),
    prose("Consider it in two steps."),
    passage("the true is the whole."),
    prose("The first sentence sets the standard."),
    passage("It is essentially a result."),
    prose("The second says that the standard takes time to reach."),
  ];
  const expected = [
    {
      type: "tutor_text",
      text: "Start with the claim.\n\nConsider it in two steps.",
    },
    {
      type: "source_quoted",
      section,
      text: "The true is the whole.",
      at: { page: 1 },
    },
    { type: "tutor_text", text: "The first sentence sets the standard." },
    {
      type: "source_quoted",
      section,
      text: "it is essentially a result.",
      at: { page: 2 },
    },
    {
      type: "tutor_text",
      text: "The second says that the standard takes time to reach.",
    },
  ];
  const first = await open(root, id, [
    [
      { text: "Draft not meant for the page." },
      quote("The true is the whole.", section),
      {
        call: "present_lecture",
        input: {
          blocks: [
            prose("Rejected draft."),
            passage("The true is the whole."),
            passage("Knowing is a test."),
          ],
        },
      },
      { call: "present_lecture", input: { blocks } },
      { text: "After the lecture." },
    ],
  ]);
  try {
    expect(first.backend.calls.map(({ result }) => result.status)).toEqual([
      "refused",
      "refused",
      "done",
    ]);
    expect(first.backend.calls[1]?.result.text).toContain(section);
    expect(said(first.chat.events())).toEqual(expected);
  } finally {
    await first.units.close();
  }

  const reopened = await open(root, id, []);
  try {
    expect(said(reopened.chat.events())).toEqual(expected);
    const html = renderTranscript(
      CURRICULUM.title,
      { ...PREFACE, plan: PLAN },
      1,
      await root.readTranscripts(id, "preface"),
      [BOOK],
    );
    expect(html).toMatch(
      /Start with the claim\.[\s\S]*<blockquote>The true is the whole\.<\/blockquote>[\s\S]*The first sentence sets the standard\.[\s\S]*<blockquote>it is essentially a result\.<\/blockquote>[\s\S]*The second says that the standard takes time to reach\./,
    );
    expect(html).not.toMatch(/Rejected draft|Knowing is a test/);
  } finally {
    await reopened.units.close();
  }
});

test("a source teaching turn that never submits a lecture reports the failure", async () => {
  const root = openDataRoot({ path: dir, now: () => new Date(NOW) });
  const id = await makeCourse(root);
  const { chat, units } = await open(root, id, [
    [{ text: "Unsubmitted lecture." }],
  ]);
  try {
    expect(said(chat.events())).toEqual([]);
    expect(chat.events()).toContainEqual({
      type: "turn_end",
      outcome: "error",
      error: expect.stringContaining("lecture"),
    });
  } finally {
    await units.close();
  }
});

test("a quote across a cut is shown where the tutor made it, in the source's words, cited where it starts, and kept in the transcript for after a restart", async () => {
  const root = openDataRoot({ path: dir, now: () => new Date(NOW) });
  const id = await makeCourse(root, { segment: 0, phase: "discuss" });
  const first = await open(root, id, [
    [
      { text: "Hegel says:" },
      quote(
        "It is essentially a result. Only at the end is it what it is in truth.",
      ),
      { text: "So the Absolute is a result." },
    ],
  ]);
  expect(first.chat.say("Where is the Absolute a result?")).toEqual({
    ok: true,
  });
  await first.chat.settled();
  const shown = {
    type: "source_quoted",
    section: "phenomenology/s1",
    text: "it is essentially a result.\n\nOnly at the end is it what it is in truth.",
    at: { page: 2 },
  };
  expect(first.backend.calls.map((c) => c.result)).toEqual([
    {
      status: "done",
      text:
        "Shown to the learner in the source's own words, with its citation: " +
        'found in "phenomenology/s1", "Preface (part 1 of 2)", pages 1–2 (printed 9–10), ' +
        "starting at page 2 (printed 10). Go on with your reply.",
    },
  ]);
  expect(said(first.chat.events())).toEqual([
    { type: "tutor_text", text: "Hegel says:" },
    shown,
    { type: "tutor_text", text: "So the Absolute is a result." },
  ]);
  await first.units.close();

  const { chat, units } = await open(root, id, []);
  try {
    expect(said(chat.events())).toContainEqual(shown);
    expect(
      (await root.readTranscripts(id, "preface"))[0]?.events,
    ).toContainEqual(shown);
  } finally {
    await units.close();
  }
});

test("of two matches, the one in the section named comes first, then the one in the segment's sections, before the first in reading order", async () => {
  const root = openDataRoot({ path: dir, now: () => new Date(NOW) });
  // In the second segment, which draws on the Preface's second part.
  const id = await makeCourse(root, { segment: 1, phase: "discuss" });
  const { chat, units } = await open(root, id, [
    [
      quote("it is essentially a result"),
      quote("it is essentially a result", "phenomenology/s1"),
      { text: "Twice." },
    ],
  ]);
  try {
    expect(chat.say("Where does he say it?")).toEqual({ ok: true });
    await chat.settled();
    expect(
      chat.events().flatMap((e) => (e.type === "source_quoted" ? [e] : [])),
    ).toEqual([
      {
        type: "source_quoted",
        section: "phenomenology/s2",
        text: "It is essentially a result",
        at: { page: 3 },
      },
      {
        type: "source_quoted",
        section: "phenomenology/s1",
        text: "it is essentially a result",
        at: { page: 2 },
      },
    ]);
  } finally {
    await units.close();
  }
});

test("a passage the sources lack, a section they lack, and a passage too short are refused, and nothing is shown", async () => {
  const root = openDataRoot({ path: dir, now: () => new Date(NOW) });
  const id = await makeCourse(root, { segment: 0, phase: "discuss" });
  const { backend, chat, units } = await open(root, id, [
    [
      quote("The true is the hole."),
      quote("The true is the whole.", "phenomenology/s9"),
      quote("the whole"),
      { text: "None of those." },
    ],
  ]);
  try {
    expect(chat.say("Can you quote all three?")).toEqual({ ok: true });
    await chat.settled();
    expect(backend.calls.map((c) => c.result)).toEqual([
      { status: "refused", text: QUOTE_NOT_FOUND },
      {
        status: "refused",
        text: 'There is no section "phenomenology/s9" to look in, since "phenomenology" has no such section: its sections are s1 to s3.',
      },
      {
        status: "refused",
        text: "The passage has fewer than 3 words: quote at least 3, the phrase with the words around it.",
      },
    ]);
    expect(said(chat.events())).toEqual([
      { type: "tutor_text", text: "None of those." },
    ]);
  } finally {
    await units.close();
  }
});

test("while a question is open nothing is quoted, with the reason; once it is graded a passage can be quoted again", async () => {
  const root = openDataRoot({ path: dir, now: () => new Date(NOW) });
  const id = await makeCourse(root);
  const { backend, chat, units } = await open(
    root,
    id,
    [
      [
        {
          call: "present_lecture",
          input: { blocks: [{ kind: "prose", text: "Teaching." }] },
        },
      ],
      [
        { text: "One question." },
        {
          call: "ask_question",
          input: {
            objective: "whole",
            kind: "choice",
            prompt: "Is the true the whole?",
            choices: ["Yes", "No"],
            answer: "A",
          },
        },
      ],
      // The reply to a message while question 1 is open.
      [
        { call: "search_source", input: { query: "the true is the whole" } },
        {
          call: "present_lecture",
          input: { blocks: [{ kind: "prose", text: "The answer is yes." }] },
        },
        quote("The true is the whole."),
        { text: "Not now." },
      ],
      // The feedback on the answer.
      [{ text: "Right." }, quote("The true is the whole.")],
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
  try {
    expect(await chat.ready()).toEqual({ ok: true });
    await chat.settled();
    expect(chat.say("Where is this in the text?")).toEqual({ ok: true });
    await chat.settled();
    // In a source course the tutor is told that pointing to the passage
    // is help, as the judge counts it.
    expect(backend.received.at(-1)?.text).toContain(
      "So does a link to the passage the question draws on, or its section, page, paragraph or footnote named",
    );
    expect(backend.calls.at(-3)?.result).toMatchObject({
      status: "refused",
      text: expect.stringContaining("A graded question is open"),
    });
    expect(backend.calls.at(-2)?.result).toMatchObject({
      status: "refused",
      text: expect.stringContaining("Question 1 is open"),
    });
    expect(backend.calls.at(-1)?.result).toEqual({
      status: "refused",
      text:
        "Question 1 is open: nothing can be quoted until its answer is " +
        "graded, since a passage could help with the answer.",
    });
    expect(chat.events().filter((e) => e.type === "source_quoted")).toEqual([]);

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
      { type: "tutor_text", text: "Right." },
      {
        type: "source_quoted",
        section: "phenomenology/s1",
        text: "The true is the whole.",
        at: { page: 1 },
      },
    ]);
  } finally {
    await units.close();
  }
});

/** The preface taught and finished: a passage read, linked and quoted. */
async function taughtPreface(root: DataRoot) {
  const id = await makeCourse(root);
  await root.appendTranscript(id, "preface", 1, [
    { type: "session", startedAt: NOW },
    { type: "phase", segment: 0, phase: "teach" },
    { type: "turn_start" },
    { type: "section_read", section: "phenomenology/s1" },
    {
      type: "tutor_text",
      text: "Hegel starts from [the whole](source:phenomenology/s1/p9). He says:",
    },
    {
      type: "source_quoted",
      section: "phenomenology/s1",
      text: "it is essentially a result.",
      at: { page: 2 },
    },
    {
      type: "tutor_text",
      text: "Compare [the second part](source:phenomenology/s2) and [a lost one](source:phenomenology/s9).",
    },
    { type: "turn_end", outcome: "done" },
    { type: "unit_closed", status: "overridden" },
  ]);
  await root.appendEvidence(id, {
    kind: "override",
    recordedAt: NOW,
    objectives: ["whole", "result"],
  });
  return id;
}

test("the notes writer gets the unit's sections as the source prints them and each verified quote with its citation", async () => {
  const root = openDataRoot({ path: dir, now: () => new Date(NOW) });
  const id = await taughtPreface(root);
  const backend = createFakeBackend([], [{ fail: "Capture the request." }]);
  const notes = createNotes({
    dataRoot: root,
    backend,
    systemPrompt: "Notes.",
    ready: () => undefined,
  });
  try {
    expect((await notes.start(id, "preface", "", undefined)).ok).toBe(true);
    await expect.poll(() => backend.oneShots.length).toBe(1);
    const prompt = backend.oneShots[0]?.prompt ?? "";
    const sections = /<sections>\n([\s\S]*?)\n<\/sections>/.exec(prompt)?.[1];
    // Both parts under the heading the book prints, at their printed pages;
    // the Introduction belongs to the next unit.
    expect(JSON.parse(sections ?? "null")).toEqual([
      {
        section: "phenomenology/s1",
        source: "Phenomenology",
        title: "Preface",
        place: "pp. 9–10",
      },
      {
        section: "phenomenology/s2",
        source: "Phenomenology",
        title: "Preface",
        place: "pp. 10–11",
      },
    ]);
    // Quoted from the PDF's second page, printed 10.
    expect(prompt).toContain(
      '[The tutor quoted the section "phenomenology/s1", verified in the source, cited as "Preface, p. 10":]\nit is essentially a result.',
    );
    expect(prompt).toContain("[the whole](source:phenomenology/s1/p9)");
  } finally {
    await notes.close();
  }
});

test("the exported transcript gives a section link's words with its section and page, and an unknown section's link its words alone", async () => {
  const root = openDataRoot({ path: dir, now: () => new Date(NOW) });
  const id = await taughtPreface(root);
  const html = renderTranscript(
    CURRICULUM.title,
    { ...PREFACE, plan: PLAN },
    1,
    await root.readTranscripts(id, "preface"),
    [BOOK],
  );
  expect(html).toContain(
    '<span>the whole <span class="note">(Preface (part 1 of 2), p. 9)</span></span>',
  );
  expect(html).toContain(
    '<span>the second part <span class="note">(Preface (part 2 of 2), pp. 10–11)</span></span>',
  );
  expect(html).toContain("<span>a lost one</span>.");
  expect(html).toContain(
    '<blockquote>it is essentially a result.</blockquote><figcaption class="note">Verified in the source: Preface, p. 10</figcaption>',
  );
  expect(html).not.toContain("source:phenomenology");
});
