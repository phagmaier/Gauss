// Teaching from the sections (task 4.8): the tutor of a course with a
// source has its outlines in its instructions, each segment's header names
// the sections it draws on, and the tutor reads any section with
// read_section and looks at a PDF's page with view_page, rendered once and
// then read from the source's pages/. Each read and page shows in the
// thread. The tutor is the fake backend; pages render on the fake converter.

import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import type { CurriculumProposal, Unit } from "../../shared/curriculum.ts";
import type { PageEvent } from "../../shared/events.ts";
import type { Plan } from "../../shared/plan.ts";
import type { Outline } from "../../shared/source.ts";
import type { UnitPosition } from "../../shared/state.ts";
import { createFakeBackend, type FakeTurn } from "../backends/fake.ts";
import { openDataRoot } from "../record/data-root.ts";
import { fakeConverter, fakePage, placeTestSource } from "./fake-converter.ts";
import { createFakeTimer } from "./fake-timer.ts";
import { createGrader } from "./grading.ts";
import { createHelpJudge } from "./help-judge.ts";
import type { Rendering, SourceConverter } from "./source-convert.ts";
import { createUnitChats } from "./unit-chat.ts";
import { createUnitPlanner } from "./unit-planning.ts";
import { JOINED_NOTE, runTurn, type Where } from "./unit-turns.ts";

// Each test gets its own data root; none touches ~/gauss (AGENTS.md).
let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "gauss-source-reading-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const NOW = "2026-11-21T10:00:00.000Z";

const BOOK: Outline = {
  id: "phenomenology",
  title: "Phenomenology",
  file: "original.pdf",
  name: "hegel.pdf",
  format: "pdf",
  sha256: "a".repeat(64),
  converter: 5,
  limit: 20_000,
  pages: {
    count: 8,
    labels: ["i", "ii", "iii", "1", "2", "3", "4", "5"],
    blank: [4],
  },
  entries: [
    {
      title: "Preface",
      entries: [
        {
          id: "s1",
          title: "Preface (part 1 of 2)",
          size: 50,
          place: { pages: { first: 1, last: 3 } },
          part: { number: 1, of: 2 },
        },
        {
          id: "s2",
          title: "Preface (part 2 of 2)",
          size: 22,
          place: { pages: { first: 3, last: 4 } },
          part: { number: 2, of: 2 },
        },
      ],
    },
    {
      id: "s3",
      title: "Introduction",
      size: 19,
      place: { pages: { first: 5, last: 8 } },
    },
  ],
};
const S1 =
  '<!-- page 1 label "i" -->\nThe true is the whole.\n\n' +
  '<!-- page 2 label "ii" math images -->\nIt is a result.\n\n' +
  '<!-- page 3 label "iii" images -->\nThe beginning\n';
const S2 = 'is the universal.\n\n<!-- page 4 label "1" -->\n';
const S3 = '<!-- page 5 label "2" -->\nKnowing is a test.\n';

const NOTES: Outline = {
  id: "notes",
  title: "Notes",
  file: "original.md",
  name: "notes.md",
  format: "markdown",
  sha256: "b".repeat(64),
  converter: 5,
  limit: 20_000,
  entries: [
    {
      id: "s1",
      title: "Notes",
      size: 53,
      place: { paragraphs: { first: 1, last: 3 } },
      paragraphStarts: [16, 33],
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
const INTRODUCTION: Unit = {
  id: "introduction",
  title: "The Introduction",
  goal: "Say how knowing tests itself.",
  prerequisites: ["preface"],
  sections: ["phenomenology/s3"],
};
const CURRICULUM: CurriculumProposal = {
  title: "Reading Hegel",
  units: [PREFACE, INTRODUCTION],
  style: "Close reading.",
  background: "The learner has read Kant.",
};
const PLAN: Plan = {
  objectives: [
    { id: "whole", statement: "Explain why the true is the whole." },
    { id: "subject", statement: "Explain how substance is subject." },
  ],
  segments: [
    {
      title: "The whole",
      objectives: ["whole"],
      sections: ["phenomenology/s1"],
    },
    {
      title: "Substance",
      objectives: ["subject"],
      sections: ["phenomenology/s2"],
    },
  ],
};

/**
 * The course, made once in `dir`, and a server's unit chats on it, with the
 * preface opened: at segment 1's teaching unless a position is given.
 */
async function start(
  script: FakeTurn[],
  given: {
    position?: UnitPosition;
    rendering?: Rendering;
    renderPage?: SourceConverter["renderPage"];
    planThroughModel?: boolean;
    plan?: Plan;
  } = {},
) {
  const root = openDataRoot({ path: dir, now: () => new Date(NOW) });
  const { id } = await root.createCourse({ title: CURRICULUM.title });
  await placeTestSource(root, dir, id, BOOK, { s1: S1, s2: S2, s3: S3 });
  await placeTestSource(root, dir, id, NOTES, {
    s1: "Read slowly 📖.\n\nRead the claim.\n\nRead the objection.\n",
  });
  const proposal = given.planThroughModel
    ? {
        ...CURRICULUM,
        units: [
          { ...PREFACE, sections: [...(PREFACE.sections ?? []), "notes/s1"] },
          INTRODUCTION,
        ],
      }
    : CURRICULUM;
  await root.saveProposal(id, proposal);
  await root.approveCurriculum(id, proposal);
  if (!given.planThroughModel) {
    await root.storePlan(id, "preface", given.plan ?? PLAN, PREFACE.sections);
  }
  if (given.position !== undefined) {
    await root.writePosition(id, "preface", given.position);
  }
  const backend = createFakeBackend(script);
  const converter = fakeConverter(
    given.rendering === undefined ? {} : { rendering: given.rendering },
  );
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
    converter: {
      ...converter,
      renderPage: given.renderPage ?? converter.renderPage,
    },
  });
  const opened = await units.open(id, "preface");
  if (!opened.ok) throw new Error(opened.error);
  await opened.chat.settled();
  return { backend, converter, units, chat: opened.chat, id };
}

/** The thread's tutor text, reads and pages, in order. */
function thread(events: readonly PageEvent[]): unknown[] {
  return events.flatMap((e): unknown[] =>
    e.type === "tutor_text" ||
    e.type === "section_read" ||
    e.type === "page_viewed"
      ? [e]
      : [],
  );
}

const read = (section: string) => ({
  call: "read_section",
  input: { section },
});
const view = (source: string, page: number) => ({
  call: "view_page",
  input: { source, page },
});

test("the tutor's instructions outline each source, and a segment's teaching turn names its sections and asks for them read first", async () => {
  const { backend, units } = await start([[{ text: "The whole." }]]);
  try {
    const session = backend.sessions[0];
    expect(session?.tools.map((t) => t.name)).toEqual(
      expect.arrayContaining(["read_section", "view_page"]),
    );
    const prompt = session?.systemPrompt ?? "";
    expect(prompt).toContain(
      "# Sources\n\nThe course is taught from these sources. Read a section with read_section",
    );
    expect(prompt).toContain(
      '"Phenomenology" (source id "phenomenology"), a PDF of 8 pages, from the learner\'s file "hegel.pdf". ' +
        "Its outline, one line per entry, indented by depth: a heading's title, or a section's id, title, place and size in characters.\n" +
        '- "Preface"\n' +
        '  - s1: "Preface (part 1 of 2)", pages 1–3 (printed i–iii), 50 characters\n' +
        '  - s2: "Preface (part 2 of 2)", pages 3–4 (printed iii–1), 22 characters\n' +
        '- s3: "Introduction", pages 5–8 (printed 2–5), 19 characters\n',
    );
    expect(prompt).toContain('"Notes" (source id "notes"), a Markdown file');
    expect(prompt.indexOf("# Sources")).toBeLessThan(
      prompt.indexOf("# The learner"),
    );

    expect(backend.received[0]?.text).toMatch(
      /^\[Unit 1 of 2, "The Preface"; segment 1 of 2, "The whole", on "whole"\.\nSegment section refs: phenomenology\/s1\.\nThe segment draws on "phenomenology\/s1", "Preface \(part 1 of 2\)", pages 1–3 \(printed i–iii\)\. Phase: teach\. Start of the segment\. Allowed now: teach the segment's objectives in this turn, from its sections: first read each whole with read_section, unless this conversation has read it already; teach within the length the style sets/,
    );
  } finally {
    await units.close();
  }
});

test("the tutor reads its segment's section, another segment's that starts partway down a page (opening with that page's marker), and another unit's, each shown in the thread; a section the sources lack is refused with what they have", async () => {
  const { backend, chat, units } = await start(
    [
      [
        read("phenomenology/s1"),
        { text: "The whole." },
        read("phenomenology/s2"),
        read("phenomenology/s3"),
        read("phenomenology/s9"),
        read("critique/s1"),
        { text: "Next." },
      ],
    ],
    { position: { segment: 0, phase: "discuss" } },
  );
  try {
    expect(chat.say("Check the other sections?")).toEqual({ ok: true });
    await chat.settled();
    expect(backend.calls.map((c) => c.result)).toEqual([
      // s1 and s3 start at a page's top, with its marker.
      {
        status: "done",
        text: `Section "phenomenology/s1" of "Phenomenology": "Preface (part 1 of 2)", pages 1–3 (printed i–iii).\n\n${S1}`,
      },
      // s2 starts partway down page 3, whose marker, with its flags, is in
      // s1: the read opens with it.
      {
        status: "done",
        text: `Section "phenomenology/s2" of "Phenomenology": "Preface (part 2 of 2)", pages 3–4 (printed iii–1).\n\n<!-- page 3 label "iii" images -->\n${S2}`,
      },
      {
        status: "done",
        text: `Section "phenomenology/s3" of "Phenomenology": "Introduction", pages 5–8 (printed 2–5).\n\n${S3}`,
      },
      {
        status: "refused",
        text: '"phenomenology/s9" cannot be read, since "phenomenology" has no such section: its sections are s1 to s3.',
      },
      {
        status: "refused",
        text: '"critique/s1" cannot be read, since the course has no source "critique": its sources are "notes", "phenomenology".',
      },
    ]);
    expect(thread(chat.events())).toEqual([
      { type: "section_read", section: "phenomenology/s1" },
      { type: "tutor_text", text: "The whole." },
      { type: "section_read", section: "phenomenology/s2" },
      { type: "section_read", section: "phenomenology/s3" },
      { type: "tutor_text", text: "Next." },
    ]);
  } finally {
    await units.close();
  }
});

test("discussion can find an off-segment passage, read its page, then quote it", async () => {
  const hit = {
    section: "phenomenology/s3",
    range: { pages: { first: 5, last: 5 } },
  };
  const { backend, chat, units } = await start(
    [
      [
        { call: "search_source", input: { query: "KNOWING test" } },
        {
          call: "search_source",
          input: { source: "notes", query: "knowing test" },
        },
        { call: "read_section", input: hit },
        {
          call: "quote_source",
          input: { section: hit.section, text: "Knowing is a test." },
        },
      ],
    ],
    { position: { segment: 0, phase: "discuss" } },
  );
  try {
    expect(chat.say("Where does he discuss knowing as a test?")).toEqual({
      ok: true,
    });
    await chat.settled();
    expect(backend.calls[0]?.result).toMatchObject({
      status: "done",
      text: expect.stringContaining(JSON.stringify(hit)),
    });
    expect(backend.calls[0]?.result.text).toContain("Knowing is a test.");
    expect(backend.calls[1]?.result).toMatchObject({
      status: "done",
      text: expect.stringContaining("No passage matched"),
    });
    expect(backend.calls[2]?.result).toMatchObject({
      status: "done",
      text: expect.stringContaining(S3),
    });
    expect(chat.events().filter((e) => e.type === "source_quoted")).toEqual([
      {
        type: "source_quoted",
        section: hit.section,
        at: { page: 5 },
        text: "Knowing is a test.",
      },
    ]);
  } finally {
    await units.close();
  }
});

test("the stored plan narrows teaching reads, with wider context and verified quotes still available", async () => {
  const part = {
    section: "phenomenology/s1",
    range: { pages: { first: 2, last: 2 } },
  };
  const paragraph = {
    section: "notes/s1",
    range: { paragraphs: { first: 2, last: 2 } },
  };
  const proposed = (passage: typeof part) => ({
    ...PLAN,
    segments: [
      {
        ...PLAN.segments[0],
        sections: [part.section, paragraph.section],
        passages: [passage, paragraph],
      },
      PLAN.segments[1],
    ],
  });
  const { backend, chat, units } = await start(
    [
      [
        {
          call: "plan_unit",
          input: proposed({ ...part, range: { pages: { first: 2, last: 4 } } }),
        },
        { call: "plan_unit", input: proposed(part) },
      ],
      [
        read(part.section),
        {
          call: "read_section",
          input: { ...part, range: { pages: { first: 1, last: 2 } } },
        },
        {
          call: "read_section",
          input: {
            section: "phenomenology/s2",
            range: { pages: { first: 3, last: 3 } },
          },
        },
        read(paragraph.section),
        {
          call: "read_section",
          input: { ...part, range: { paragraphs: { first: 1, last: 1 } } },
        },
        {
          call: "present_lecture",
          input: {
            blocks: [
              { kind: "quote", section: part.section, text: "It is a result." },
              {
                kind: "prose",
                text: "The passage distinguishes the starting point from the result.",
              },
            ],
          },
        },
      ],
    ],
    { planThroughModel: true },
  );
  try {
    const results = backend.calls.map((call) => call.result);
    expect(results[0]).toMatchObject({
      status: "refused",
      text: expect.stringContaining("phenomenology/s1"),
    });
    expect(results[1]?.status).toBe("done");
    expect(backend.received[0]?.text).toContain(
      "<!-- paragraph 2 -->\nRead the claim.",
    );
    expect(backend.received[1]?.text).toContain("page 2 (printed ii)");
    expect(results[2]).toMatchObject({
      status: "done",
      text: expect.stringMatching(
        /page 2 \(printed ii\)\.\n\n<!-- page 2 label "ii" math images -->\nIt is a result\.\s*$/,
      ),
    });
    expect(results[3]?.text).toMatch(
      /The true is the whole\.[\s\S]*It is a result\.\s*$/,
    );
    expect(results[4]?.text).toMatch(
      /<!-- page 3 label "iii" images -->\nis the universal\.\s*$/,
    );
    expect(results[5]?.text).toMatch(
      /paragraph 2\.\n\n<!-- paragraph 2 -->\nRead the claim\.\s*$/,
    );
    expect(results[6]?.status).toBe("refused");
    expect(chat.events()).toContainEqual({ type: "section_read", ...part });
    expect(chat.events()).toContainEqual({
      type: "section_read",
      ...paragraph,
    });
    expect(chat.events()).toContainEqual({
      type: "source_quoted",
      section: part.section,
      at: { page: 2 },
      text: "It is a result.",
    });
  } finally {
    await units.close();
  }
});

test("a page is rendered once and then read from the source's pages/, shown in the thread with what its text lost; a page out of range and a source with no pages are refused", async () => {
  const { backend, chat, converter, units, id } = await start([
    [
      view("phenomenology", 2),
      view("phenomenology", 2),
      view("phenomenology", 4),
      view("phenomenology", 9),
      view("notes", 1),
    ],
  ]);
  try {
    const pages = join(dir, "courses", id, "sources", "phenomenology", "pages");
    expect(backend.calls.map((c) => c.result)).toEqual([
      {
        status: "done",
        text: 'The image of page 2 (printed ii) of "Phenomenology".',
        image: { data: fakePage(2), mimeType: "image/png" },
      },
      {
        status: "done",
        text: 'The image of page 2 (printed ii) of "Phenomenology".',
        image: { data: fakePage(2), mimeType: "image/png" },
      },
      {
        status: "done",
        text: 'The image of page 4 (printed 1) of "Phenomenology".',
        image: { data: fakePage(4), mimeType: "image/png" },
      },
      {
        status: "refused",
        text: '"phenomenology" has 8 pages, so it has no page 9. Name a page by its number from 1, as its marker gives it.',
      },
      {
        status: "refused",
        text: '"notes" is a Markdown file, not a PDF, so it has no pages to look at. Read its sections with read_section.',
      },
    ]);
    expect(converter.renders).toEqual([2, 4]);
    expect((await readdir(pages)).sort()).toEqual(["2.png", "4.png"]);
    expect(await readFile(join(pages, "2.png"))).toEqual(fakePage(2));
    expect(thread(chat.events())).toEqual([
      {
        type: "page_viewed",
        source: "phenomenology",
        page: 2,
        math: true,
        images: true,
      },
      {
        type: "page_viewed",
        source: "phenomenology",
        page: 2,
        math: true,
        images: true,
      },
      { type: "page_viewed", source: "phenomenology", page: 4 },
    ]);
  } finally {
    await units.close();
  }
});

test("a page that cannot be rendered is refused with why, and nothing is kept or shown", async () => {
  const { backend, chat, units, id } = await start(
    [[view("phenomenology", 2)]],
    {
      rendering: { result: "failed", reason: "it stopped with exit status 1" },
    },
  );
  try {
    expect(backend.calls.map((c) => c.result)).toEqual([
      {
        status: "refused",
        text: "The page could not be rendered: it stopped with exit status 1.",
      },
    ]);
    expect(
      await readdir(
        join(dir, "courses", id, "sources", "phenomenology", "pages"),
      ),
    ).toEqual([]);
    expect(thread(chat.events())).toEqual([]);
  } finally {
    await units.close();
  }
});

test("stopping a turn aborts its page render and shows no page view", async () => {
  const rendering = Promise.withResolvers<AbortSignal | undefined>();
  const finish = Promise.withResolvers<void>();
  const { chat, units, id } = await start(
    [[view("phenomenology", 2), { text: "I looked at it." }]],
    {
      position: { segment: 0, phase: "discuss" },
      async renderPage(_original, _page, png, signal) {
        rendering.resolve(signal);
        await finish.promise;
        // Simulate a renderer completing its output just as Stop arrives.
        await writeFile(png, fakePage(2));
        return { result: "rendered" };
      },
    },
  );
  try {
    expect(chat.say("Look at the page.")).toEqual({ ok: true });
    const signal = await rendering.promise;
    await chat.interrupt();
    const aborted = signal?.aborted;
    finish.resolve();
    await chat.settled();
    expect(aborted).toBe(true);
    expect(chat.events().at(-1)).toEqual({
      type: "turn_end",
      outcome: "interrupted",
    });
    expect(thread(chat.events())).toEqual([]);
    expect(
      await readdir(
        join(dir, "courses", id, "sources", "phenomenology", "pages"),
      ),
    ).toEqual([]);
  } finally {
    finish.resolve();
    await chat.settled();
    await units.close();
  }
});

test("a new session's first turn names the segment's sections", async () => {
  // The position keeps no session of the tutor's to resume.
  const { backend, chat, units } = await start([[{ text: "It is." }]], {
    position: { segment: 1, phase: "discuss" },
  });
  try {
    expect(chat.say("Is substance subject?")).toEqual({ ok: true });
    await chat.settled();
    const text = backend.received[0]?.text ?? "";
    expect(text).toMatch(
      /^\[Unit 1 of 2, "The Preface"; segment 2 of 2, "Substance", on "subject"\.\nSegment section refs: phenomenology\/s2\.\nThe segment draws on "phenomenology\/s2", "Preface \(part 2 of 2\)", pages 3–4 \(printed iii–1\)\. Phase: discuss\. Message from the learner\./,
    );
    expect(text).toContain(JOINED_NOTE);
  } finally {
    await units.close();
  }
});

test("a review's question on another unit's objective names that unit's sections", () => {
  const testing: Plan = {
    objectives: [{ id: "test", statement: "Say how knowing tests itself." }],
    segments: [
      {
        title: "Testing",
        objectives: ["test"],
        sections: ["phenomenology/s3"],
      },
    ],
  };
  const where: Where = {
    context: {
      courseTitle: CURRICULUM.title,
      units: [
        { ...PREFACE, plan: PLAN },
        { ...INTRODUCTION, plan: testing },
      ],
      unitId: "introduction",
      plan: testing,
      sources: [NOTES, BOOK],
    },
    position: { segment: 0, phase: "discuss" },
    checks: new Map(),
    notPassed: ["test"],
    slipping: [],
    goOver: ["test"],
    notes: [],
    evidence: [],
    assessment: {
      run: {
        mode: "review",
        stage: "on",
        objectives: [{ unit: "preface", objective: "whole" }],
        from: 0,
      },
      standing: [{ state: "unasked" }],
      next: { index: 0, unit: "preface", objective: "whole", second: false },
    },
  };

  expect(runTurn(where, { after: "start" })).toContain(
    '"whole" is an objective of unit 1, "The Preface", which this conversation may not have taught: Explain why the true is the whole. ' +
      'That unit reads "phenomenology/s1", "Preface (part 1 of 2)", pages 1–3 (printed i–iii); ' +
      '"phenomenology/s2", "Preface (part 2 of 2)", pages 3–4 (printed iii–1). No teaching',
  );
});

test("outside the segment's teaching, as in its discussion or going over it again, a read with no range is the whole section", async () => {
  const part = {
    section: "phenomenology/s1",
    range: { pages: { first: 2, last: 2 } },
  };
  const plan: Plan = {
    ...PLAN,
    segments: PLAN.segments.map((segment, i) =>
      i === 0 ? { ...segment, passages: [part] } : segment,
    ),
  };
  const whole = `Section "phenomenology/s1" of "Phenomenology": "Preface (part 1 of 2)", pages 1–3 (printed i–iii).\n\n${S1}`;
  const positions = [
    { segment: 0, phase: "discuss" },
    // Going over "whole" again, after the last segment.
    { segment: 2, phase: "teach", again: ["whole"] },
  ] satisfies UnitPosition[];
  for (const position of positions) {
    const section = part.section;
    const { backend, chat, units } = await start(
      [[read(section), { text: "The whole." }]],
      { plan, position },
    );
    try {
      if (position.phase === "discuss") {
        expect(chat.say("Read it again?")).toEqual({ ok: true });
      }
      await chat.settled();
      expect(backend.calls[0]?.result, JSON.stringify(position)).toEqual({
        status: "done",
        text: whole,
      });
      expect(chat.events()).toContainEqual({ type: "section_read", section });
    } finally {
      await units.close();
    }
    await rm(dir, { recursive: true, force: true });
    dir = await mkdtemp(join(tmpdir(), "gauss-source-reading-"));
  }
});

test("a detour in the check finds a section that starts partway down a page and reads that page; an unknown source is refused with the course's sources", async () => {
  const hit = {
    section: "phenomenology/s2",
    range: { pages: { first: 3, last: 3 } },
  };
  const { backend, chat, units } = await start(
    [
      [
        { call: "search_source", input: { query: "universal" } },
        { call: "read_section", input: hit },
        { call: "search_source", input: { source: "nope", query: "true" } },
      ],
    ],
    {
      position: {
        segment: 0,
        phase: "check",
        checkFrom: 0,
        detour: { questionId: "q1", number: 1, objective: "whole" },
      },
    },
  );
  try {
    if (backend.calls.length === 0) {
      expect(chat.say("Where is the universal?")).toEqual({ ok: true });
    }
    await chat.settled();
    expect(backend.calls[0]?.result).toMatchObject({
      status: "done",
      text: expect.stringContaining(JSON.stringify(hit)),
    });
    // The page's marker, inherited from s1, then s2's text up to page 4.
    expect(backend.calls[1]?.result.text).toContain(
      '<!-- page 3 label "iii" images -->\nis the universal.\n',
    );
    expect(backend.calls[1]?.result.text).not.toContain("page 4");
    expect(backend.calls[2]?.result).toEqual({
      status: "refused",
      text: 'There is no source "nope" to search. This course has "notes", "phenomenology".',
    });
  } finally {
    await units.close();
  }
});

test("search is refused in teaching for the planned passages, and elsewhere outside discussion or a detour with where it works", async () => {
  const lecture =
    "Search is for discussion or a detour. For a planned lecture, read the passages named in the turn header.";
  const elsewhere =
    "search_source works only in discussion or a detour. Read a section with read_section.";
  const cases: { position: UnitPosition; refused: string }[] = [
    { position: { segment: 0, phase: "teach" }, refused: lecture },
    {
      // An assessment under way, between its questions.
      position: {
        segment: 0,
        phase: "discuss",
        assessment: {
          mode: "review",
          stage: "on",
          objectives: [{ unit: "preface", objective: "whole" }],
          from: 0,
        },
      },
      refused: elsewhere,
    },
    { position: { segment: 0, phase: "closed" }, refused: elsewhere },
    // The test's result card waits; nothing is taught until it is answered.
    {
      position: { segment: 0, phase: "teach", testOut: { stage: "result" } },
      refused: elsewhere,
    },
  ];
  for (const { position, refused } of cases) {
    const { backend, chat, units } = await start(
      [[{ call: "search_source", input: { query: "universal" } }]],
      { position },
    );
    try {
      if (backend.calls.length === 0) {
        expect(chat.say("Where is the universal?")).toEqual({ ok: true });
        await chat.settled();
      }
      expect(backend.calls[0]?.result, position.phase).toEqual({
        status: "refused",
        text: refused,
      });
    } finally {
      await units.close();
    }
    await rm(dir, { recursive: true, force: true });
    dir = await mkdtemp(join(tmpdir(), "gauss-source-reading-"));
  }
});
