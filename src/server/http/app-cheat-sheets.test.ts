// Cheat sheets through the routes (brief.md, "Other features", "Cheat
// sheets"): the writer is a fake backend, and the record is built directly
// so that each unit's standing, slips and quotes are known.

import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { z } from "zod";
import { CheatSheetList } from "../../shared/cheat-sheet.ts";
import type { EvidenceEntry } from "../../shared/evidence.ts";
import { courseInstance } from "../../shared/library.ts";
import type { Plan } from "../../shared/plan.ts";
import { createFakeBackend, type FakeReply } from "../backends/fake.ts";
import { createCheatSheets } from "../engine/cheat-sheets.ts";
import { createCoursePlannings } from "../engine/course-planning.ts";
import { createDisputeJudge } from "../engine/dispute-judge.ts";
import { createDisputes } from "../engine/disputes.ts";
import { createFakeTimer } from "../engine/fake-timer.ts";
import { createGrader } from "../engine/grading.ts";
import { createHelpJudge } from "../engine/help-judge.ts";
import { createIntakes } from "../engine/intake.ts";
import { createNotes } from "../engine/notes.ts";
import { createPhotoTaker } from "../engine/photos.ts";
import { createUnitChats } from "../engine/unit-chat.ts";
import { createUnitPlanner } from "../engine/unit-planning.ts";
import type { FileOpener } from "../open-file.ts";
import { openDataRoot } from "../record/data-root.ts";
import { createApp } from "./app.ts";

// Each test gets its own data root; none touches ~/gauss (AGENTS.md).
let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "gauss-cheat-sheets-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const ORIGIN = "http://localhost";
const NOW = "2026-11-26T10:00:00.000Z";
const COURSE = "linear-algebra";
const SHEETS = `/api/courses/${COURSE}/cheat-sheets`;
const UNITS = [
  ["vectors", "Vectors and linear maps"],
  ["eigen", "Eigenvalues and eigenvectors"],
  ["pca", "Principal components"],
  ["svd", "The singular value decomposition"],
] as const;
const PAGE = String.raw`<!doctype html><html><head><title>Sheet</title></head><body><h1>Maps and eigenvectors</h1><p><span class="math-inline">A v = \lambda v</span></p><script>stop()</script></body></html>`;

function setUp(replies: FakeReply[] = [], now = () => new Date(NOW)) {
  const backend = createFakeBackend([]);
  const writer = createFakeBackend([], replies);
  const timer = createFakeTimer();
  const dataRoot = openDataRoot({ path: dir, now });
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
    judge: createHelpJudge({ backend, systemPrompt: "Judge." }),
  });
  const commits: string[] = [];
  const backup = {
    commit: (message: string) => void commits.push(message),
    settled: async () => {},
  };
  const cheatSheets = createCheatSheets({
    dataRoot,
    backend: writer,
    systemPrompt: "Write a sheet.",
    ready: async () => {},
    backup,
    now,
    timer,
  });
  // Never the system's opener: a test must not open the learner's browser.
  const openFile = vi.fn<FileOpener>(async () => ({ ok: true }));
  const app = createApp({
    dataRoot,
    intakes: createIntakes({ backend, systemPrompt: "Plan.", dataRoot }),
    plannings: createCoursePlannings({
      backend,
      systemPrompt: "Plan the course.",
      dataRoot,
      units,
    }),
    units,
    disputes: createDisputes({
      dataRoot,
      units,
      judge: createDisputeJudge({ backend, systemPrompt: "Decide." }),
    }),
    notes: createNotes({
      dataRoot,
      backend,
      systemPrompt: "Write notes.",
      ready: async () => {},
    }),
    cheatSheets,
    photos: createPhotoTaker({
      sandbox: {
        available: false,
        reason: "no sandbox in this test",
        close: async () => {},
      },
      dataRoot,
    }),
    openFile,
    backup,
  });
  return { app, dataRoot, writer, timer, cheatSheets, commits, openFile };
}

type Setup = ReturnType<typeof setUp>;

function post(setup: Setup, path: string, body?: unknown) {
  return setup.app.request(path, {
    method: "POST",
    headers: { Origin: ORIGIN, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function listed(setup: Setup): Promise<CheatSheetList> {
  const response = await setup.app.request(SHEETS);
  expect(response.status).toBe(200);
  return CheatSheetList.parse(await response.json());
}

function plan(unit: string): Plan {
  return {
    objectives: [1, 2].map((n) => ({
      id: `${unit}-${n}`,
      statement: `Objective ${n} of ${unit}.`,
    })),
    segments: [
      { title: "First", objectives: [`${unit}-1`] },
      { title: "Second", objectives: [`${unit}-2`] },
    ],
  };
}

function answer(
  objective: string,
  questionId: string,
  right: boolean,
  assessment?: { mode: "review"; unit: string },
): EvidenceEntry {
  return {
    kind: "answer",
    recordedAt: NOW,
    objective,
    question: {
      kind: "choice",
      prompt: `Question ${questionId}?`,
      choices: [`Right ${questionId}`, `Wrong ${questionId}`],
      answer: "A",
    },
    answer: {
      kind: "choice",
      questionId,
      choice: right ? "A" : "B",
      // At 90%, a right answer passes its objective alone.
      confidence: "90",
    },
    assisted: false,
    verdict: right ? "correct" : "incorrect",
    ...(assessment === undefined ? {} : { assessment }),
  };
}

/**
 * Units 1 to 3 finished, unit 4 planned and not started. Units 1 and 2
 * have handoff notes and unit 1 a verified quote. Slips: a miss on unit
 * 1's first objective in unit 4's review, a miss on unit 2's that a
 * dispute overturned, a miss on unit 3's, and a misconception each on
 * units 1 and 3.
 */
async function course() {
  const root = openDataRoot({ path: dir, now: () => new Date(NOW) });
  const proposal = {
    title: "Linear algebra",
    units: UNITS.map(([id, title], i) => ({
      id,
      title,
      goal: `The goal of ${id}.`,
      prerequisites: i === 0 ? [] : [UNITS[i - 1]?.[0] ?? ""],
    })),
    style: "Short.",
    background: "Knows matrices.",
  };
  const { id } = await root.createCourse({ title: proposal.title });
  expect(id).toBe(COURSE);
  await root.saveProposal(id, proposal);
  await root.approveCurriculum(id, proposal);
  for (const [unit] of UNITS) await root.storePlan(id, unit, plan(unit));
  for (const [unit] of UNITS.slice(0, 3)) {
    for (const n of [1, 2]) {
      await root.appendEvidence(
        id,
        answer(`${unit}-${n}`, `${unit}${n}`, true),
      );
    }
  }
  await root.appendEvidence(
    id,
    answer("vectors-1", "review-miss", false, { mode: "review", unit: "svd" }),
  );
  await root.appendEvidence(id, answer("eigen-1", "overturned", false));
  await root.appendEvidence(id, {
    kind: "dispute",
    recordedAt: NOW,
    questionId: "overturned",
    reason: "B is right too.",
    outcome: { verdict: "correct", reason: "Both are right." },
  });
  await root.appendEvidence(
    id,
    answer("pca-1", "unpicked-miss", false, { mode: "review", unit: "svd" }),
  );
  for (const [unit] of UNITS.slice(0, 2)) {
    await root.writeHandoff(id, unit, `The handoff note of ${unit}.`, {
      writtenAt: NOW,
      through: { session: 1, events: 1 },
    });
  }
  await root.appendTranscript(id, "vectors", 1, [
    { type: "session", startedAt: NOW },
    {
      type: "source_quoted",
      section: "strang/s2",
      text: "A matrix is a linear map.",
      at: { heading: "Linear maps" },
    },
    // Unit 3's gate question, asked in this thread: not unit 1's teaching.
    { type: "phase", phase: "closed", segment: 1 },
    { type: "assessment", mode: "gate", stage: "on", count: 1 },
    { type: "turn_start" },
    {
      type: "question",
      question: {
        kind: "math",
        id: "foreign",
        number: 3,
        prompt: "How much variance does the first component explain?",
        assessment: {
          of: 1,
          from: { number: 3, title: "Principal components" },
        },
      },
    },
    { type: "turn_end", outcome: "done" },
    { type: "detour", questionId: "foreign", number: 3 },
    {
      type: "source_quoted",
      section: "strang/s9",
      text: "Another unit's quote.",
    },
  ]);
  await root.appendMisconceptions(id, [
    {
      recordedAt: NOW,
      unit: "svd",
      objective: "vectors-2",
      believed: "One image fixes a map.",
      actually: "The images of a basis fix it.",
      where: { in: "discussion" },
    },
    {
      recordedAt: NOW,
      unit: "pca",
      objective: "pca-2",
      believed: "An unpicked unit's slip.",
      actually: "Not on this sheet.",
      where: { in: "discussion" },
    },
  ]);
}

async function sheetFiles() {
  try {
    return (
      await readdir(join(dir, "courses", COURSE, "cheat-sheets"))
    ).toSorted();
  } catch {
    return [];
  }
}

test("a sheet for two finished units is written from their plans, notes, quotes and slips, kept, served and opened", async () => {
  const setup = setUp([{ output: { html: PAGE } }]);
  await course();
  expect(await listed(setup)).toEqual({
    sheets: [],
    pickable: ["vectors", "eigen", "pca"],
  });

  const instructions = "Put the definitions first.";
  const started = await post(setup, SHEETS, {
    units: ["eigen", "vectors"],
    instructions,
  });
  expect(started.status).toBe(202);
  const writing = {
    state: "writing",
    units: ["vectors", "eigen"],
    instructions,
  };
  expect(CheatSheetList.parse(await started.json()).attempt).toEqual(writing);
  await setup.cheatSheets.settled();

  const { sheets, attempt } = await listed(setup);
  expect(attempt).toBeUndefined();
  const path = join(
    dir,
    "courses",
    COURSE,
    "cheat-sheets",
    `${sheets[0]?.id}.html`,
  );
  expect(sheets).toEqual([
    {
      id: expect.any(String),
      units: ["vectors", "eigen"],
      instructions,
      writtenAt: NOW,
      path,
    },
  ]);
  const html = await setup.app.request(`${SHEETS}/${sheets[0]?.id}/html`, {
    headers: { "Sec-Fetch-Dest": "iframe", "Sec-Fetch-Site": "same-origin" },
  });
  expect(html.status).toBe(200);
  expect(html.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
  expect(html.headers.get("Content-Security-Policy")).toContain(
    "script-src 'none'",
  );
  const page = await html.text();
  expect(page).toContain('class="katex"');
  expect(page).not.toContain("<script>");
  expect(
    (await setup.app.request(`${SHEETS}/${sheets[0]?.id}/html`)).headers.get(
      "Content-Type",
    ),
  ).toBe("text/plain; charset=utf-8");
  expect((await post(setup, `${SHEETS}/${sheets[0]?.id}/open`)).status).toBe(
    200,
  );
  expect(setup.openFile).toHaveBeenCalledWith(path);
  expect(setup.commits).toEqual([`${COURSE}: cheat sheet ${sheets[0]?.id}`]);

  const request = setup.writer.oneShots[0];
  expect(request?.systemPrompt).toBe("Write a sheet.");
  const prompt = request?.prompt ?? "";
  for (const sent of [
    "Objective 1 of vectors.",
    "Objective 2 of eigen.",
    "The handoff note of vectors.",
    "The handoff note of eigen.",
    "A matrix is a linear map.",
    '"citation": "Linear maps"',
    "Question review-miss?",
    '"correction": "Right review-miss"',
    '"chosen": "Wrong review-miss"',
    "<course>\nLinear algebra\n</course>",
    "One image fixes a map.",
    `<instructions>\n${instructions}\n</instructions>`,
  ]) {
    expect(prompt).toContain(sent);
  }
  expect(prompt.indexOf("Vectors and linear maps")).toBeLessThan(
    prompt.indexOf("Eigenvalues and eigenvectors"),
  );
  for (const left of [
    "pca-1",
    "pca-2",
    "svd-1",
    "Question overturned?",
    "Question unpicked-miss?",
    "An unpicked unit's slip.",
    "Another unit's quote.",
  ]) {
    expect(prompt).not.toContain(left);
  }
});

test("an unfinished, unknown or empty pick and a second write while one runs are refused, as is deleting the course meanwhile", async () => {
  const reply = Promise.withResolvers<FakeReply>();
  const setup = setUp([{ later: reply.promise }]);
  await course();

  const Refusal = z.object({ error: z.string() });
  const refused = async (units: string[], status: number) => {
    const response = await post(setup, SHEETS, { units });
    expect(response.status).toBe(status);
    return Refusal.parse(await response.json()).error;
  };
  expect(await refused(["vectors", "svd"], 409)).toBe(
    "Unit 4, The singular value decomposition, is not finished. A cheat sheet takes finished units only.",
  );
  expect(await refused(["vectors", "nope"], 404)).toBe(
    'This course has no unit "nope".',
  );
  expect(await refused([], 400)).toBe("Pick at least one finished unit.");
  expect(setup.writer.oneShots).toEqual([]);

  expect((await post(setup, SHEETS, { units: ["pca"] })).status).toBe(202);
  await vi.waitFor(() => expect(setup.writer.oneShots).toHaveLength(1));
  expect(await refused(["vectors"], 409)).toBe(
    "A cheat sheet is being written for this course. Write another once it is done.",
  );
  const stored = await setup.dataRoot.readCourse(COURSE);
  if (stored === undefined) throw new Error("No course.");
  const deleting = await post(setup, `/api/courses/${COURSE}/delete`, {
    instance: courseInstance(stored.course),
    title: stored.course.title,
  });
  expect(deleting.status).toBe(409);
  expect(await deleting.json()).toEqual({
    error:
      "A cheat sheet of this course is being written. Delete the course once it has finished.",
  });
  expect(await sheetFiles()).toEqual([]);

  reply.resolve({ output: { html: PAGE } });
  await setup.cheatSheets.settled();
  expect(setup.writer.oneShots).toHaveLength(1);
  const { sheets } = await listed(setup);
  expect(sheets.map((sheet) => sheet.units)).toEqual([["pca"]]);
});

test("a writer's failure and the time limit each leave a failed attempt with its reason and no file", async () => {
  const setup = setUp([{ fail: "The reply was cut off." }, { hold: true }]);
  await course();

  expect((await post(setup, SHEETS, { units: ["vectors"] })).status).toBe(202);
  await setup.cheatSheets.settled();
  expect((await listed(setup)).attempt).toEqual({
    state: "failed",
    units: ["vectors"],
    instructions: "",
    error: "The reply was cut off.",
  });

  expect(
    (await post(setup, SHEETS, { units: ["eigen"], instructions: "Short." }))
      .status,
  ).toBe(202);
  await vi.waitFor(() => expect(setup.writer.oneShots).toHaveLength(2));
  setup.timer.advance(3 * 60_000);
  await setup.cheatSheets.settled();
  const { attempt, sheets } = await listed(setup);
  expect(attempt).toEqual({
    state: "failed",
    units: ["eigen"],
    instructions: "Short.",
    error: "The cheat sheet writer took longer than three minutes.",
  });
  expect(sheets).toEqual([]);
  expect(await sheetFiles()).toEqual([]);
  expect(setup.commits).toEqual([]);
});

test("delete removes a sheet's files, unknown ids are 404, and a restart keeps the sheets and drops a page left without its source", async () => {
  let clock = new Date(NOW);
  const setup = setUp(
    [{ output: { html: PAGE } }, { output: { html: PAGE } }],
    () => clock,
  );
  await course();
  for (const units of [["vectors"], ["eigen", "pca"]]) {
    expect((await post(setup, SHEETS, { units })).status).toBe(202);
    await setup.cheatSheets.settled();
    clock = new Date(clock.getTime() + 60_000);
  }
  const [newer, older] = (await listed(setup)).sheets;
  if (newer === undefined || older === undefined)
    throw new Error("Two sheets.");
  expect([newer.units, older.units]).toEqual([["eigen", "pca"], ["vectors"]]);
  expect(await sheetFiles()).toHaveLength(4);

  const unknown = "0b7e1f9a-2c3d-4e5f-8a9b-0c1d2e3f4a5b";
  for (const id of [unknown, "%2E%2E%2F%2E%2E%2Fcourse", "..%2Fcourse.json"]) {
    expect((await post(setup, `${SHEETS}/${id}/delete`)).status).toBe(404);
    expect((await setup.app.request(`${SHEETS}/${id}/html`)).status).toBe(404);
    expect((await post(setup, `${SHEETS}/${id}/open`)).status).toBe(404);
  }
  expect(await sheetFiles()).toHaveLength(4);

  expect((await post(setup, `${SHEETS}/${older.id}/delete`)).status).toBe(200);
  expect(await sheetFiles()).toEqual(
    [`${newer.id}.html`, `${newer.id}.json`].toSorted(),
  );
  expect(setup.commits.at(-1)).toBe(
    `${COURSE}: cheat sheet ${older.id} deleted`,
  );
  expect((await post(setup, `${SHEETS}/${older.id}/delete`)).status).toBe(404);

  // A crash between a write's two files leaves the page alone.
  const lone = "6f1c2d3e-4b5a-4c7d-8e9f-a0b1c2d3e4f5";
  await writeFile(
    join(dir, "courses", COURSE, "cheat-sheets", `${lone}.html`),
    "<!doctype html><html></html>",
  );
  const restarted = setUp();
  await restarted.dataRoot.clearInterruptedWrites(() => {});
  expect((await listed(restarted)).sheets).toEqual([newer]);
  expect(await sheetFiles()).toEqual(
    [`${newer.id}.html`, `${newer.id}.json`].toSorted(),
  );
});
