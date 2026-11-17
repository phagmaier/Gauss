import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { EvidenceEntry } from "../../shared/evidence.ts";
import type { ChoiceQuestion, WrittenQuestion } from "../../shared/question.ts";
import {
  createFakeBackend,
  type FakeReply,
  type FakeTurn,
} from "../backends/fake.ts";
import { givenOrder } from "../engine/choice-order.ts";
import { createGrader } from "../engine/grading.ts";
import { createHelpJudge } from "../engine/help-judge.ts";
import { createIntakes } from "../engine/intake.ts";
import { createUnitChats } from "../engine/unit-chat.ts";
import { createUnitPlanner } from "../engine/unit-planning.ts";
import { openDataRoot } from "../record/data-root.ts";
import { createApp } from "./app.ts";

// Each test gets its own data root; none touches ~/gauss (AGENTS.md).
let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "gauss-routes-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const ORIGIN = "http://localhost";
const NOW = "2026-11-15T12:00:00.000Z";

const ASK = "Linear algebra, enough to understand PCA.";
const FIRST = {
  title: "Linear algebra for PCA",
  units: [
    {
      id: "vectors",
      title: "Vectors and linear maps",
      goal: "Describe a linear map by what it does to a basis.",
      prerequisites: [],
    },
    {
      id: "eigen",
      title: "Eigenvalues and eigenvectors",
      goal: "Find the directions a map only stretches, and by how much.",
      prerequisites: ["vectors"],
    },
  ],
  style: "Short explanations, a picture before the algebra.",
  background: "The learner can multiply matrices, and wants to follow PCA.",
};
const REVISED = { ...FIRST, units: FIRST.units.slice(0, 1) };

/** The tutor's reply to the learner's first message, where it cannot propose (task 2.22). */
const OPENING: FakeTurn = [
  { text: "What do you know already? Shall I propose?" },
];

function setUp(script: FakeTurn[], replies: FakeReply[] = []) {
  const backend = createFakeBackend(script, replies);
  const dataRoot = openDataRoot({ path: dir, now: () => new Date(NOW) });
  const intakes = createIntakes({
    backend,
    systemPrompt: "You are a test planner.",
    dataRoot,
  });
  const units = createUnitChats({
    backend,
    systemPrompt: "You are a test tutor.",
    dataRoot,
    planner: createUnitPlanner({ backend, systemPrompt: "Plan.", dataRoot }),
    grader: createGrader({ backend, systemPrompt: "Grade." }),
    judge: createHelpJudge({
      backend: createFakeBackend([]),
      systemPrompt: "Judge.",
    }),
    now: () => new Date(NOW),
    order: givenOrder,
  });
  const app = createApp({ dataRoot, intakes, units });
  return { backend, dataRoot, intakes, units, app };
}

type App = ReturnType<typeof createApp>;

function post(app: App, path: string, body?: unknown) {
  return app.request(path, {
    method: "POST",
    headers: { Origin: ORIGIN, "Content-Type": "application/json" },
    ...(body === undefined
      ? {}
      : { body: typeof body === "string" ? body : JSON.stringify(body) }),
  });
}

async function startIntake(app: App): Promise<string> {
  const response = await post(app, "/api/intakes");
  expect(response.status).toBe(201);
  const { intakeId } = (await response.json()) as { intakeId: string };
  return intakeId;
}

/** Sends the learner's message and waits for the tutor's reply to finish. */
async function say(
  setup: ReturnType<typeof setUp>,
  intakeId: string,
  text: string,
) {
  const response = await post(setup.app, `/api/intakes/${intakeId}/messages`, {
    text,
  });
  expect(response.status).toBe(202);
  await setup.intakes.get(intakeId)?.settled();
}

/** The learner's first message, then their answer to the tutor's question. */
async function opened(setup: ReturnType<typeof setUp>, intakeId: string) {
  await say(setup, intakeId, ASK);
  await say(setup, intakeId, "Matrices. Go ahead.");
}

type Frame = { event?: string; id?: string; data?: unknown };

/** Reads server-sent events until `count` frames have arrived. */
async function readFrames(response: Response, count: number) {
  const body = response.body;
  if (body === null) throw new Error("no body");
  const reader = body.pipeThrough(new TextDecoderStream()).getReader();
  const frames: Frame[] = [];
  let buffer = "";
  async function more(n: number): Promise<Frame[]> {
    const start = frames.length;
    while (frames.length < start + n) {
      const { value, done } = await reader.read();
      if (done) throw new Error("the stream ended");
      buffer += value;
      let end = buffer.indexOf("\n\n");
      while (end !== -1) {
        const frame: Frame = {};
        for (const line of buffer.slice(0, end).split("\n")) {
          const [field, ...rest] = line.split(": ");
          const text = rest.join(": ");
          if (field === "event") frame.event = text;
          if (field === "id") frame.id = text;
          if (field === "data") frame.data = JSON.parse(text);
        }
        if (Object.keys(frame).length > 0) frames.push(frame);
        buffer = buffer.slice(end + 2);
        end = buffer.indexOf("\n\n");
      }
    }
    return frames.slice(start, start + n);
  }
  return { first: await more(count), more, close: () => reader.cancel() };
}

test("a new course starts as an intake, and its first proposal puts it in the library as a draft", async () => {
  const setup = setUp([
    OPENING,
    [{ call: "propose_curriculum", input: FIRST }],
  ]);
  const { app } = setup;

  const empty = await app.request("/api/courses");
  expect(empty.status).toBe(200);
  expect(await empty.json()).toEqual({ courses: [] });

  const intakeId = await startIntake(app);
  expect(await (await app.request("/api/courses")).json()).toEqual({
    courses: [],
  });
  await say(setup, intakeId, ASK);
  expect(await (await app.request("/api/courses")).json()).toEqual({
    courses: [],
  });
  await say(setup, intakeId, "Matrices. Go ahead.");

  const draft = {
    id: "linear-algebra-for-pca",
    course: { title: "Linear algebra for PCA", lastOpenedAt: NOW },
    curriculum: { approval: { status: "draft" }, units: FIRST.units },
    progress: {},
  };
  expect(await (await app.request("/api/courses")).json()).toMatchObject({
    courses: [draft],
  });
  const one = await app.request("/api/courses/linear-algebra-for-pca");
  expect(one.status).toBe(200);
  expect(await one.json()).toMatchObject(draft);

  const missing = await app.request("/api/courses/linear-algebra");
  expect(missing.status).toBe(404);
  expect(await missing.json()).toHaveProperty("error");
});

test("an intake's event stream says hello, replays its log with ids, then sends live events", async () => {
  const setup = setUp([
    [{ text: "What do you know already?" }],
    [{ call: "propose_curriculum", input: FIRST }],
  ]);
  const intakeId = await startIntake(setup.app);
  await say(setup, intakeId, ASK);

  const response = await setup.app.request(`/api/intakes/${intakeId}/events`);
  expect(response.headers.get("Content-Type")).toContain("text/event-stream");
  const stream = await readFrames(response, 5);

  expect(stream.first).toMatchObject([
    { event: "hello", data: { chatId: intakeId } },
    { id: `${intakeId}.0`, data: { type: "learner", text: ASK } },
    { id: `${intakeId}.1`, data: { type: "turn_start" } },
    {
      id: `${intakeId}.2`,
      data: { type: "tutor_text", text: "What do you know already?" },
    },
    { id: `${intakeId}.3`, data: { type: "turn_end", outcome: "done" } },
  ]);

  await post(setup.app, `/api/intakes/${intakeId}/messages`, {
    text: "Matrices.",
  });
  expect(await stream.more(4)).toMatchObject([
    { id: `${intakeId}.4`, data: { type: "learner", text: "Matrices." } },
    { id: `${intakeId}.5`, data: { type: "turn_start" } },
    {
      id: `${intakeId}.6`,
      data: {
        type: "curriculum_proposed",
        courseId: "linear-algebra-for-pca",
        revision: 1,
        ...FIRST,
      },
    },
    { id: `${intakeId}.7`, data: { type: "turn_end", outcome: "done" } },
  ]);
  await stream.close();
});

test("a reconnecting page gets only what it missed, unless the log is another one", async () => {
  const setup = setUp([[{ text: "Hello." }]]);
  const intakeId = await startIntake(setup.app);
  await say(setup, intakeId, ASK);
  const events = `/api/intakes/${intakeId}/events`;

  const resumed = await readFrames(
    await setup.app.request(events, {
      headers: { "Last-Event-ID": `${intakeId}.2` },
    }),
    2,
  );
  expect(resumed.first[1]).toEqual({
    id: `${intakeId}.3`,
    data: { type: "turn_end", outcome: "done" },
  });
  await resumed.close();

  const other = await readFrames(
    await setup.app.request(events, {
      headers: { "Last-Event-ID": "another-intake.7" },
    }),
    2,
  );
  expect(other.first[1]?.id).toBe(`${intakeId}.0`);
  await other.close();
});

test("approval names the revision shown; a replaced or unknown one is refused, and approval ends the intake", async () => {
  const setup = setUp([
    OPENING,
    [{ call: "propose_curriculum", input: FIRST }],
    [{ call: "propose_curriculum", input: REVISED }],
  ]);
  const { app } = setup;
  const intakeId = await startIntake(app);
  await opened(setup, intakeId);
  await say(setup, intakeId, "One unit is enough.");
  const approval = `/api/intakes/${intakeId}/approval`;

  const replaced = await post(app, approval, { revision: 1 });
  expect(replaced.status).toBe(409);
  expect(await replaced.json()).toEqual({
    error: "Proposal 1 was replaced by proposal 2.",
  });
  expect((await post(app, approval, { revision: 3 })).status).toBe(404);
  expect((await post(app, approval, { revision: "2" })).status).toBe(400);

  const approved = await post(app, approval, { revision: 2 });
  expect(approved.status).toBe(200);
  expect(await approved.json()).toEqual({ ok: true });

  expect(
    await (await app.request("/api/courses/linear-algebra-for-pca")).json(),
  ).toMatchObject({
    curriculum: {
      approval: { status: "approved", approvedAt: NOW },
      units: REVISED.units,
    },
  });
  expect(
    (await post(app, `/api/intakes/${intakeId}/messages`, { text: "More?" }))
      .status,
  ).toBe(409);
  expect((await post(app, approval, { revision: 2 })).status).toBe(409);
});

test("approval is refused while the tutor is writing, and stopping the tutor's turn allows it", async () => {
  const setup = setUp([
    OPENING,
    [{ call: "propose_curriculum", input: FIRST }],
    [{ text: "Let me reconsider" }, { hold: true }],
  ]);
  const { app } = setup;
  const intakeId = await startIntake(app);
  await opened(setup, intakeId);

  const intake = setup.intakes.get(intakeId);
  const writing = new Promise<void>((resolve) => {
    const stop = intake?.subscribe((event) => {
      if (event.type === "tutor_text") {
        stop?.();
        resolve();
      }
    });
  });
  await post(app, `/api/intakes/${intakeId}/messages`, { text: "Hmm." });
  await writing;
  const approval = `/api/intakes/${intakeId}/approval`;
  expect((await post(app, approval, { revision: 1 })).status).toBe(409);

  const stopped = await post(app, `/api/intakes/${intakeId}/interrupt`);
  expect(stopped.status).toBe(200);
  await intake?.settled();
  expect(intake?.events().at(-1)).toEqual({
    type: "turn_end",
    outcome: "interrupted",
  });
  expect((await post(app, approval, { revision: 1 })).status).toBe(200);
});

test("an unknown intake is 404 on every intake route", async () => {
  const { app } = setUp([]);
  const base = "/api/intakes/no-such-intake";

  const responses = await Promise.all([
    app.request(`${base}/events`),
    post(app, `${base}/messages`, { text: ASK }),
    post(app, `${base}/approval`, { revision: 1 }),
    post(app, `${base}/interrupt`),
  ]);

  expect(responses.map((r) => r.status)).toEqual([404, 404, 404, 404]);
  expect(await responses[0]?.json()).toEqual({ error: "No such intake." });
});

test("malformed bodies are refused with a reason, and nothing reaches the tutor", async () => {
  const setup = setUp([]);
  const intakeId = await startIntake(setup.app);
  const messages = `/api/intakes/${intakeId}/messages`;

  const blank = await post(setup.app, messages, { text: "   " });
  expect(blank.status).toBe(400);
  expect(await blank.json()).toHaveProperty("error");
  const notJson = await post(setup.app, messages, "text=hello");
  expect(notJson.status).toBe(400);
  expect(await notJson.json()).toEqual({ error: "The body must be JSON." });

  expect(setup.backend.received).toEqual([]);
  expect(setup.intakes.get(intakeId)?.events()).toEqual([]);
});

test("a course outlives the server, and an intake in progress does not", async () => {
  const before = setUp([
    OPENING,
    [{ call: "propose_curriculum", input: FIRST }],
  ]);
  const intakeId = await startIntake(before.app);
  await opened(before, intakeId);
  expect(
    (
      await post(before.app, `/api/intakes/${intakeId}/approval`, {
        revision: 1,
      })
    ).status,
  ).toBe(200);
  const unfinished = await startIntake(before.app);
  await before.intakes.close();

  const after = setUp([]);

  expect(await (await after.app.request("/api/courses")).json()).toMatchObject({
    courses: [
      {
        id: "linear-algebra-for-pca",
        curriculum: { approval: { status: "approved" } },
      },
    ],
  });
  const gone = await after.app.request(`/api/intakes/${unfinished}/events`);
  expect(gone.status).toBe(404);
});

test("a draft opens for review in its running intake, or after a restart in a new one that starts from it with its notes", async () => {
  const before = setUp([
    OPENING,
    [{ call: "propose_curriculum", input: FIRST }],
  ]);
  const intakeId = await startIntake(before.app);
  await opened(before, intakeId);
  const review = "/api/courses/linear-algebra-for-pca/review";

  const running = await post(before.app, review);
  expect(running.status).toBe(200);
  expect(await running.json()).toEqual({ intakeId });
  await before.intakes.close();

  const after = setUp([]);
  const reopened = await post(after.app, review);
  expect(reopened.status).toBe(200);
  const { intakeId: newId } = (await reopened.json()) as { intakeId: string };
  expect(newId).not.toBe(intakeId);
  const stream = await readFrames(
    await after.app.request(`/api/intakes/${newId}/events`),
    3,
  );
  expect(stream.first.slice(1).map((f) => f.data)).toEqual([
    { type: "draft_reopened" },
    {
      type: "curriculum_proposed",
      courseId: "linear-algebra-for-pca",
      revision: 1,
      ...FIRST,
    },
  ]);
  await stream.close();

  expect(
    (await post(after.app, `/api/intakes/${newId}/approval`, { revision: 1 }))
      .status,
  ).toBe(200);
  const approved = await post(after.app, review);
  expect(approved.status).toBe(409);
  expect(await approved.json()).toEqual({
    error: "The curriculum is approved; there is nothing to review.",
  });
  expect((await post(after.app, "/api/courses/no-course/review")).status).toBe(
    404,
  );
});

test("a draft stored before style and background notes existed reopens without them, and can be approved", async () => {
  const before = setUp([
    OPENING,
    [{ call: "propose_curriculum", input: FIRST }],
  ]);
  await opened(before, await startIntake(before.app));
  await before.intakes.close();
  const course = join(dir, "courses", "linear-algebra-for-pca");
  await rm(join(course, "style.md"));
  await rm(join(course, "background.md"));

  const after = setUp([]);
  const reopened = await post(
    after.app,
    "/api/courses/linear-algebra-for-pca/review",
  );
  const { intakeId } = (await reopened.json()) as { intakeId: string };
  const stream = await readFrames(
    await after.app.request(`/api/intakes/${intakeId}/events`),
    3,
  );
  const { style: _, background: __, ...withoutNotes } = FIRST;
  expect(stream.first[2]?.data).toEqual({
    type: "curriculum_proposed",
    courseId: "linear-algebra-for-pca",
    revision: 1,
    ...withoutNotes,
  });
  await stream.close();
  const approval = await post(after.app, `/api/intakes/${intakeId}/approval`, {
    revision: 1,
  });
  expect(approval.status).toBe(200);
});

test("review keeps the same intake during approval and when its record read is stale", async () => {
  const setup = setUp([
    OPENING,
    [{ call: "propose_curriculum", input: FIRST }],
  ]);
  const { app, dataRoot, intakes } = setup;
  const intakeId = await startIntake(app);
  await opened(setup, intakeId);
  const courseId = "linear-algebra-for-pca";
  const draft = await dataRoot.readCourse(courseId);
  const writing = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const approve = dataRoot.approveCurriculum;
  vi.spyOn(dataRoot, "approveCurriculum").mockImplementationOnce(
    async (id, shown) => {
      writing.resolve();
      await release.promise;
      return approve(id, shown);
    },
  );
  const approval = post(app, `/api/intakes/${intakeId}/approval`, {
    revision: 1,
  });
  try {
    await writing.promise;
    const review = await post(app, `/api/courses/${courseId}/review`);
    expect(review.status).toBe(200);
    expect(await review.json()).toEqual({ intakeId });
  } finally {
    release.resolve();
    await approval;
    await intakes.close();
  }
  expect((await approval).status).toBe(200);

  // Another request may have read the draft before approval finished, then
  // reached the registry after it finished. It must not create a new owner.
  vi.spyOn(dataRoot, "readCourse").mockResolvedValueOnce(draft);
  const stale = await post(app, `/api/courses/${courseId}/review`);
  expect(await stale.json()).toEqual({ intakeId });
  expect(intakes.get(intakeId)?.events().at(-1)).toEqual({
    type: "curriculum_approved",
    courseId,
    revision: 1,
  });
  expect(
    (await post(app, `/api/intakes/${intakeId}/approval`, { revision: 1 }))
      .status,
  ).toBe(409);
  expect((await post(app, `/api/courses/${courseId}/review`)).status).toBe(409);
});

test("a record the server cannot read is reported with the reason", async () => {
  const { app } = setUp([]);
  await mkdir(join(dir, "courses", "broken"), { recursive: true });
  await writeFile(join(dir, "courses", "broken", "course.json"), "{");
  const quiet = vi.spyOn(console, "error").mockImplementation(() => {});

  const response = await app.request("/api/courses");
  quiet.mockRestore();

  expect(response.status).toBe(500);
  expect(((await response.json()) as { error: string }).error).toContain(
    "course.json is not valid JSON.",
  );
});

test("requests from other sites and other host names are refused", async () => {
  const setup = setUp([[{ text: "Hello." }]]);
  const intakeId = await startIntake(setup.app);
  const messages = `/api/intakes/${intakeId}/messages`;

  const crossSite = await setup.app.request(messages, {
    method: "POST",
    headers: { Origin: "https://example.com" },
    body: JSON.stringify({ text: ASK }),
  });
  const noOrigin = await setup.app.request(messages, {
    method: "POST",
    body: JSON.stringify({ text: ASK }),
  });
  const newIntake = await setup.app.request("/api/intakes", {
    method: "POST",
    headers: { Origin: "https://example.com" },
  });
  const rebound = await setup.app.request(
    "http://gauss.example.com/api/courses",
  );

  expect(
    [crossSite, noOrigin, newIntake, rebound].map((r) => r.status),
  ).toEqual([403, 403, 403, 403]);
  expect(setup.backend.received).toEqual([]);
  expect(setup.intakes.get(intakeId)?.events()).toEqual([]);
});

// --- Unit chats ----------------------------------------------------------------

const CREATED = "2026-11-14T09:00:00.000Z";
const COURSE = "linear-algebra-for-pca";
const UNIT = `/api/courses/${COURSE}/units/vectors`;
const VECTORS_PLAN = {
  objectives: [
    {
      id: "basis-image",
      statement: "Describe a linear map by the images of a basis.",
    },
    {
      id: "matrix-columns",
      statement: "Read the columns of a matrix as the images of a basis.",
    },
  ],
  segments: [
    { title: "Bases", objectives: ["basis-image"] },
    { title: "Matrices", objectives: ["matrix-columns"] },
  ],
};
const QUESTION = {
  objective: "basis-image",
  kind: "choice",
  prompt: "Which vectors fix a linear map on $\\mathbb{R}^2$?",
  choices: ["The images of a basis", "The image of one vector"],
  answer: "A",
};

/** An approved course, made the day before, with its first unit planned. */
async function approvedCourse(draft = false) {
  const root = openDataRoot({ path: dir, now: () => new Date(CREATED) });
  const { id } = await root.createCourse({ title: FIRST.title });
  await root.saveProposal(id, FIRST);
  if (draft) return;
  await root.approveCurriculum(id, FIRST);
  await root.storePlan(id, "vectors", VECTORS_PLAN);
}

async function openUnit(setup: ReturnType<typeof setUp>) {
  const response = await post(setup.app, `${UNIT}/open`);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true });
  await setup.units.get(COURSE, "vectors")?.settled();
}

async function settle(setup: ReturnType<typeof setUp>) {
  await setup.units.get(COURSE, "vectors")?.settled();
}

/** The unit's position on disk, without the tutor's session id (unit-chat.test.ts checks it). */
async function unitState() {
  const position = (await openDataRoot({ path: dir }).readState(COURSE)).units
    .vectors;
  if (position === undefined) return undefined;
  const { tutorSessionId: _, ...rest } = position;
  return rest;
}

test("opening a unit marks its course opened, and the unit's event stream replays its thread with ids", async () => {
  const setup = setUp([[{ text: "A map is fixed by a basis." }]]);
  await approvedCourse();

  await openUnit(setup);

  const course = await (
    await setup.app.request(`/api/courses/${COURSE}`)
  ).json();
  expect(course).toMatchObject({
    course: { lastOpenedAt: NOW, unitsOpenedAt: { vectors: NOW } },
    progress: {
      vectors: { status: "in-progress", segment: 0 },
      eigen: { status: "not-started" },
    },
  });
  const chatId = setup.units.get(COURSE, "vectors")?.id;
  const response = await setup.app.request(`${UNIT}/events`);
  expect(response.headers.get("Content-Type")).toContain("text/event-stream");
  const stream = await readFrames(response, 9);
  expect(stream.first).toEqual([
    { event: "hello", data: { chatId } },
    { id: `${chatId}.0`, data: { type: "session", startedAt: NOW } },
    { id: `${chatId}.1`, data: { type: "unit_plan", plan: VECTORS_PLAN } },
    {
      id: `${chatId}.2`,
      data: {
        type: "unit_status",
        unit: "in-progress",
        objectives: {
          "basis-image": "not-started",
          "matrix-columns": "not-started",
        },
      },
    },
    {
      id: `${chatId}.3`,
      data: { type: "phase", segment: 0, phase: "teach" },
    },
    { id: `${chatId}.4`, data: { type: "turn_start" } },
    {
      id: `${chatId}.5`,
      data: { type: "tutor_text", text: "A map is fixed by a basis." },
    },
    { id: `${chatId}.6`, data: { type: "turn_end", outcome: "done" } },
    {
      id: `${chatId}.7`,
      data: { type: "phase", segment: 0, phase: "discuss" },
    },
  ]);
  await stream.close();
});

test("a segment runs through the unit routes: a message, ready, an answer, another question refused, moving on and the next segment", async () => {
  const setup = setUp([
    [{ text: "A map is fixed by a basis." }],
    [{ text: "Because every vector is a combination of the basis." }],
    [{ call: "ask_question", input: QUESTION }],
    [{ text: "Right." }],
    // Asked for the next question, which an unsure answer needs.
    [{ text: "Any questions before the next one?" }],
    [{ text: "Now matrices." }],
  ]);
  await approvedCourse();
  await openUnit(setup);
  const chat = setup.units.get(COURSE, "vectors");

  const message = await post(setup.app, `${UNIT}/messages`, {
    text: "Why a basis?",
  });
  expect(message.status).toBe(202);
  await settle(setup);
  expect((await post(setup.app, `${UNIT}/next-segment`)).status).toBe(409);

  expect((await post(setup.app, `${UNIT}/ready`)).status).toBe(202);
  await settle(setup);
  const posted = chat?.events().findLast((e) => e.type === "question");
  const questionId = posted?.type === "question" ? posted.question.id : "";
  expect(await unitState()).toMatchObject({
    phase: "check",
    openQuestion: { id: questionId },
  });

  const answered = await post(setup.app, `${UNIT}/answers`, {
    kind: "choice",
    questionId,
    choice: "A",
    confidence: "50",
  });
  expect(answered.status).toBe(202);
  await settle(setup);
  const again = await post(setup.app, `${UNIT}/answers`, {
    kind: "unknown",
    questionId,
  });
  expect(again.status).toBe(409);
  expect(await again.json()).toEqual({ error: "No question is open." });
  // A correct answer opens no detour, so there is none to end (task 2.20).
  const another = await post(setup.app, `${UNIT}/another-question`);
  expect(another.status).toBe(409);
  expect(await another.json()).toEqual({
    error: "No detour is open, so there is nothing to end.",
  });

  const moved = await post(setup.app, `${UNIT}/override`);
  expect(moved.status).toBe(200);
  expect(await moved.json()).toEqual({ ok: true });
  expect((await post(setup.app, `${UNIT}/override`)).status).toBe(409);

  expect((await post(setup.app, `${UNIT}/next-segment`)).status).toBe(202);
  await settle(setup);

  expect(await unitState()).toEqual({ segment: 1, phase: "discuss" });
  expect(
    (await openDataRoot({ path: dir }).readEvidence(COURSE)).map((e) => e.kind),
  ).toEqual(["answer", "override"]);
  expect(setup.backend.received).toHaveLength(6);
});

test("a written answer is taken by its route, and one whose grading failed is graded again through its own", async () => {
  const setup = setUp(
    [
      [{ text: "A map is fixed by a basis." }],
      [
        {
          call: "ask_question",
          input: {
            objective: "basis-image",
            kind: "written",
            prompt: "Why do the images of a basis fix a linear map?",
            rubric: "Every vector is a combination of the basis; linearity.",
          },
        },
      ],
      [{ text: "Right." }],
    ],
    [{ fail: "Usage limit reached." }, { output: { verdict: "correct" } }],
  );
  await approvedCourse();
  await openUnit(setup);
  const chat = setup.units.get(COURSE, "vectors");
  expect((await post(setup.app, `${UNIT}/ready`)).status).toBe(202);
  await settle(setup);
  const posted = chat?.events().findLast((e) => e.type === "question");
  const questionId = posted?.type === "question" ? posted.question.id : "";

  expect((await post(setup.app, `${UNIT}/grade-again`)).status).toBe(409);
  const sent = await post(setup.app, `${UNIT}/answers`, {
    kind: "written",
    questionId,
    text: "  Every vector is a combination of the basis, and the map is linear.  ",
    confidence: "90",
  });
  expect(sent.status).toBe(202);
  await settle(setup);

  expect(chat?.events().at(-1)).toEqual({
    type: "grading_failed",
    questionId,
    error: "Usage limit reached.",
  });
  // The answer is kept trimmed, as the schema reads it.
  expect((await unitState())?.openQuestion?.answer).toMatchObject({
    text: "Every vector is a combination of the basis, and the map is linear.",
  });

  const again = await post(setup.app, `${UNIT}/grade-again`);
  expect(again.status).toBe(202);
  expect(await again.json()).toEqual({ ok: true });
  await settle(setup);

  expect(
    (await openDataRoot({ path: dir }).readEvidence(COURSE)).map(
      (e) => e.kind === "answer" && e.verdict,
    ),
  ).toEqual(["correct"]);
});

test("stopping the tutor through its route ends the teaching turn and opens the discussion", async () => {
  const setup = setUp([[{ text: "A long lecture" }, { hold: true }]]);
  await approvedCourse();
  expect((await post(setup.app, `${UNIT}/open`)).status).toBe(200);
  const chat = setup.units.get(COURSE, "vectors");
  while (!chat?.events().some((e) => e.type === "tutor_text")) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  const stopped = await post(setup.app, `${UNIT}/interrupt`);
  expect(stopped.status).toBe(200);
  await settle(setup);

  expect(await unitState()).toEqual({ segment: 0, phase: "discuss" });
});

test("starting fresh through its route gives the tutor a new session, which picks up the unit", async () => {
  const setup = setUp([
    [{ text: "A map is fixed by a basis." }],
    [{ text: "We are in the discussion of bases." }],
  ]);
  await approvedCourse();
  await openUnit(setup);

  const response = await post(setup.app, `${UNIT}/start-fresh`);
  expect(response.status).toBe(202);
  await settle(setup);

  expect(setup.backend.sessions).toHaveLength(2);
  expect(setup.units.get(COURSE, "vectors")?.events().slice(-4)).toEqual([
    { type: "fresh_start", reason: "learner" },
    { type: "turn_start" },
    { type: "tutor_text", text: "We are in the discussion of bases." },
    { type: "turn_end", outcome: "done" },
  ]);
});

test("a unit that is not there, of a draft, or not open is refused on every unit route", async () => {
  const setup = setUp([]);
  await approvedCourse(true);

  const draft = await post(setup.app, `${UNIT}/open`);
  expect(draft.status).toBe(409);
  expect(await draft.json()).toEqual({
    error: "The curriculum is not approved yet, so its units cannot start.",
  });
  const missing = await Promise.all([
    post(setup.app, "/api/courses/no-such-course/units/vectors/open"),
    post(setup.app, `/api/courses/${COURSE}/units/no-such-unit/open`),
  ]);
  expect(missing.map((r) => r.status)).toEqual([404, 404]);

  const notOpen = await Promise.all([
    setup.app.request(`${UNIT}/events`),
    post(setup.app, `${UNIT}/messages`, { text: "Hello." }),
    post(setup.app, `${UNIT}/ready`),
    post(setup.app, `${UNIT}/answers`, { kind: "unknown", questionId: "q" }),
    post(setup.app, `${UNIT}/grade-again`),
    post(setup.app, `${UNIT}/override`),
    post(setup.app, `${UNIT}/next-segment`),
    post(setup.app, `${UNIT}/go-over-again`),
    post(setup.app, `${UNIT}/finish`),
    post(setup.app, `${UNIT}/start-fresh`),
    post(setup.app, `${UNIT}/interrupt`),
  ]);
  expect(notOpen.map((r) => r.status)).toEqual([
    404, 404, 404, 404, 404, 404, 404, 404, 404, 404, 404,
  ]);
  expect(await notOpen[0]?.json()).toEqual({
    error: "This unit is not open. Open it first.",
  });
  expect(setup.backend.sessions).toEqual([]);
});

test("malformed bodies on the unit routes are refused with a reason, and nothing reaches the tutor", async () => {
  const setup = setUp([[{ text: "A map is fixed by a basis." }]]);
  await approvedCourse();
  await openUnit(setup);
  const events = setup.units.get(COURSE, "vectors")?.events().length;

  const responses = await Promise.all([
    post(setup.app, `${UNIT}/messages`, { text: "" }),
    post(setup.app, `${UNIT}/answers`, { kind: "choice", questionId: "q" }),
    post(setup.app, `${UNIT}/answers`, "choice=A"),
  ]);

  expect(responses.map((r) => r.status)).toEqual([400, 400, 400]);
  expect(await responses[2]?.json()).toEqual({
    error: "The body must be JSON.",
  });
  expect(setup.backend.received).toHaveLength(1);
  expect(setup.units.get(COURSE, "vectors")?.events()).toHaveLength(
    events ?? -1,
  );
});

test("at the unit's end, going over again and finishing without the rest go through their routes", async () => {
  const setup = setUp([
    [{ text: "A map is fixed by a basis." }],
    [{ text: "Now matrices." }],
    [{ text: "Matrices again." }],
  ]);
  await approvedCourse();
  await openUnit(setup);

  // Both segments are moved on from, so neither objective passes.
  expect((await post(setup.app, `${UNIT}/finish`)).status).toBe(409);
  expect((await post(setup.app, `${UNIT}/override`)).status).toBe(200);
  expect((await post(setup.app, `${UNIT}/next-segment`)).status).toBe(202);
  await settle(setup);
  expect((await post(setup.app, `${UNIT}/override`)).status).toBe(200);

  expect((await post(setup.app, `${UNIT}/go-over-again`)).status).toBe(202);
  await settle(setup);
  expect(await unitState()).toEqual({
    segment: 2,
    phase: "discuss",
    again: ["basis-image", "matrix-columns"],
  });
  const progress = async () =>
    (await (await setup.app.request("/api/courses")).json()).courses[0]
      .progress;
  expect(await progress()).toEqual({
    vectors: { status: "in-progress", segment: 2 },
    eigen: { status: "not-started" },
  });

  expect((await post(setup.app, `${UNIT}/override`)).status).toBe(200);
  const finished = await post(setup.app, `${UNIT}/finish`);
  expect(finished.status).toBe(200);
  expect(await finished.json()).toEqual({ ok: true });
  expect(await unitState()).toBeUndefined();
  expect(await progress()).toEqual({
    vectors: { status: "overridden" },
    eigen: { status: "not-started" },
  });
  const again = await post(setup.app, `${UNIT}/go-over-again`);
  expect(again.status).toBe(409);
  expect(await again.json()).toEqual({ error: "The unit is finished." });
});

test("a course whose progress cannot be read is still listed, with the reason, beside the others", async () => {
  await approvedCourse();
  const root = openDataRoot({ path: dir, now: () => new Date(CREATED) });
  const calculus = { ...FIRST, title: "Calculus I" };
  const { id } = await root.createCourse({ title: calculus.title });
  await root.saveProposal(id, calculus);
  await root.approveCurriculum(id, calculus);
  // A line no append can leave: the log was edited, or the disk failed.
  await writeFile(join(dir, "courses", id, "evidence.jsonl"), "not json\n");
  const { app } = setUp([]);
  const quiet = vi.spyOn(console, "error").mockImplementation(() => {});

  const listed = await app.request("/api/courses");
  const opened = await app.request(`/api/courses/${id}`);
  quiet.mockRestore();

  expect(listed.status).toBe(200);
  const { courses } = (await listed.json()) as {
    courses: { id: string; progress: unknown; problem?: string }[];
  };
  const unreadable = courses.find((c) => c.id === id);
  expect(unreadable?.progress).toEqual({});
  expect(unreadable?.problem).toContain(
    "evidence.jsonl, line 1 is not valid JSON.",
  );
  const readable = courses.find((c) => c.id === COURSE);
  expect(readable?.progress).toEqual({
    vectors: { status: "not-started" },
    eigen: { status: "not-started" },
  });
  expect(readable).not.toHaveProperty("problem");
  // Opening the course says why.
  expect(opened.status).toBe(500);
  expect(((await opened.json()) as { error: string }).error).toContain(
    "evidence.jsonl, line 1 is not valid JSON.",
  );
});

// --- What I know ---------------------------------------------------------------

/** Unit 1's plan: its segments teach the objectives in another order than the list. */
const KNOWN_PLAN = {
  objectives: [
    { id: "basis-image", statement: "Describe a linear map by a basis." },
    { id: "span", statement: "Say what the span of two vectors is." },
    { id: "matrix-columns", statement: "Read a matrix's columns." },
    { id: "rank", statement: "Find the rank of a matrix." },
  ],
  segments: [
    { title: "Maps", objectives: ["basis-image", "matrix-columns"] },
    { title: "Span", objectives: ["span"] },
    { title: "Rank", objectives: ["rank"] },
  ],
};
const LINE: ChoiceQuestion = {
  kind: "choice",
  prompt: "Which vectors fix a linear map on $\\mathbb{R}^2$?",
  choices: ["The image of one vector", "The images of a basis"],
  answer: "B",
};
const ZERO: ChoiceQuestion = {
  kind: "choice",
  prompt: "Where does a linear map send $0$?",
  choices: ["To $0$", "Anywhere"],
  answer: "A",
};
const BASIS_WRITTEN: WrittenQuestion = {
  kind: "written",
  prompt: "Why do the images of a basis fix a linear map?",
  rubric:
    "Every vector is a combination of the basis; linearity does the rest.",
};
const COLUMNS_WRITTEN: WrittenQuestion = {
  kind: "written",
  prompt: "What is the second column of the matrix of $T$?",
  rubric: "The image of the second basis vector.",
};
const SPAN_CHOICE: ChoiceQuestion = {
  kind: "choice",
  prompt: "What is the span of $(1,0)$ and $(2,0)$?",
  choices: ["A line", "The plane"],
  answer: "A",
};

/**
 * An approved course, unit 1 planned and unit 2 not, with each kind of
 * evidence entry, written to the log in this order.
 */
async function courseWithEvidence() {
  const root = openDataRoot({ path: dir, now: () => new Date(CREATED) });
  const { id } = await root.createCourse({ title: FIRST.title });
  await root.saveProposal(id, FIRST);
  await root.approveCurriculum(id, FIRST);
  await root.storePlan(id, "vectors", KNOWN_PLAN);
  const at = (time: string) => `2026-11-14T${time}:00.000Z`;
  const entries: EvidenceEntry[] = [
    {
      kind: "answer",
      recordedAt: at("10:00"),
      objective: "basis-image",
      question: LINE,
      answer: {
        kind: "choice",
        questionId: "q1",
        choice: "A",
        confidence: "50",
        reasoning: "One vector is enough on a line.",
      },
      assisted: false,
      verdict: "incorrect",
    },
    {
      kind: "answer",
      recordedAt: at("10:05"),
      objective: "matrix-columns",
      question: COLUMNS_WRITTEN,
      answer: {
        kind: "written",
        questionId: "q2",
        text: "The second row.",
        confidence: "75",
      },
      assisted: false,
      verdict: "incorrect",
      flaw: "It reads the second row, not the second column.",
    },
    {
      kind: "answer",
      recordedAt: at("10:10"),
      objective: "basis-image",
      question: BASIS_WRITTEN,
      answer: {
        kind: "written",
        questionId: "q3",
        text: "By linearity.",
        confidence: "90",
      },
      assisted: true,
      verdict: "correct",
    },
    {
      kind: "answer",
      recordedAt: at("10:15"),
      objective: "span",
      question: SPAN_CHOICE,
      answer: { kind: "unknown", questionId: "q4", stuck: "What a span is." },
      assisted: false,
      verdict: "unknown",
    },
    {
      kind: "answer",
      recordedAt: at("10:20"),
      objective: "basis-image",
      question: BASIS_WRITTEN,
      answer: {
        kind: "written",
        questionId: "q5",
        text: "Each vector is a combination of the basis, and $T$ is linear.",
        confidence: "75",
      },
      assisted: false,
      verdict: "correct",
    },
    // Names an objective of no plan as well, which is not shown.
    {
      kind: "override",
      recordedAt: at("10:30"),
      objectives: ["matrix-columns", "dropped"],
    },
    {
      kind: "answer",
      recordedAt: at("10:35"),
      objective: "dropped",
      question: ZERO,
      answer: {
        kind: "choice",
        questionId: "q6",
        choice: "A",
        confidence: "100",
      },
      assisted: false,
      verdict: "correct",
    },
    // Recorded last, though its timestamp is the earliest.
    {
      kind: "answer",
      recordedAt: at("09:00"),
      objective: "basis-image",
      question: ZERO,
      answer: {
        kind: "choice",
        questionId: "q7",
        choice: "A",
        confidence: "50",
      },
      assisted: false,
      verdict: "correct",
    },
    {
      kind: "answer",
      recordedAt: at("10:40"),
      objective: "span",
      question: SPAN_CHOICE,
      answer: { kind: "unknown", questionId: "q8" },
      assisted: false,
      verdict: "unknown",
    },
  ];
  for (const entry of entries) await root.appendEvidence(id, entry);
  return id;
}

test("what I know sends each planned unit's objectives with their status and evidence, in log order, without rubrics", async () => {
  const id = await courseWithEvidence();
  const { app } = setUp([]);

  const response = await app.request(`/api/courses/${id}/what-i-know`);

  expect(response.status).toBe(200);
  const at = (time: string) => `2026-11-14T${time}:00.000Z`;
  const { rubric: _, ...basisWritten } = BASIS_WRITTEN;
  const { rubric: __, ...columnsWritten } = COLUMNS_WRITTEN;
  expect(await response.json()).toEqual({
    title: FIRST.title,
    units: [
      {
        id: "vectors",
        number: 1,
        title: "Vectors and linear maps",
        // Not finished: one objective attempted and one not started.
        status: "in-progress",
        objectives: [
          {
            id: "basis-image",
            statement: "Describe a linear map by a basis.",
            // Since the miss, two different questions answered correctly
            // without help; the answer with help counts for nothing.
            status: "passed",
            evidence: [
              {
                kind: "answer",
                recordedAt: at("10:00"),
                question: LINE,
                answer: {
                  kind: "choice",
                  questionId: "q1",
                  choice: "A",
                  confidence: "50",
                  reasoning: "One vector is enough on a line.",
                },
                assisted: false,
                verdict: "incorrect",
              },
              {
                kind: "answer",
                recordedAt: at("10:10"),
                question: basisWritten,
                answer: {
                  kind: "written",
                  questionId: "q3",
                  text: "By linearity.",
                  confidence: "90",
                },
                assisted: true,
                verdict: "correct",
              },
              {
                kind: "answer",
                recordedAt: at("10:20"),
                question: basisWritten,
                answer: {
                  kind: "written",
                  questionId: "q5",
                  text: "Each vector is a combination of the basis, and $T$ is linear.",
                  confidence: "75",
                },
                assisted: false,
                verdict: "correct",
              },
              {
                kind: "answer",
                recordedAt: at("09:00"),
                question: ZERO,
                answer: {
                  kind: "choice",
                  questionId: "q7",
                  choice: "A",
                  confidence: "50",
                },
                assisted: false,
                verdict: "correct",
              },
            ],
          },
          {
            id: "matrix-columns",
            statement: "Read a matrix's columns.",
            status: "overridden",
            evidence: [
              {
                kind: "answer",
                recordedAt: at("10:05"),
                question: columnsWritten,
                answer: {
                  kind: "written",
                  questionId: "q2",
                  text: "The second row.",
                  confidence: "75",
                },
                assisted: false,
                verdict: "incorrect",
                flaw: "It reads the second row, not the second column.",
              },
              { kind: "override", recordedAt: at("10:30") },
            ],
          },
          {
            id: "span",
            statement: "Say what the span of two vectors is.",
            status: "attempted",
            evidence: [
              {
                kind: "answer",
                recordedAt: at("10:15"),
                question: SPAN_CHOICE,
                answer: {
                  kind: "unknown",
                  questionId: "q4",
                  stuck: "What a span is.",
                },
                assisted: false,
                verdict: "unknown",
              },
              {
                kind: "answer",
                recordedAt: at("10:40"),
                question: SPAN_CHOICE,
                answer: { kind: "unknown", questionId: "q8" },
                assisted: false,
                verdict: "unknown",
              },
            ],
          },
          {
            id: "rank",
            statement: "Find the rank of a matrix.",
            status: "not-started",
            evidence: [],
          },
        ],
      },
      {
        id: "eigen",
        number: 2,
        title: "Eigenvalues and eigenvectors",
        status: "not-started",
        objectives: null,
      },
    ],
  });
});

test("what I know names a unit with a position in progress, and refuses an unknown course, a draft, and a record that cannot be read", async () => {
  await approvedCourse();
  const root = openDataRoot({ path: dir, now: () => new Date(CREATED) });
  await root.writePosition(COURSE, "vectors", { segment: 0, phase: "teach" });
  const draft = await root.createCourse({ title: "Topology" });
  await root.saveProposal(draft.id, { ...FIRST, title: "Topology" });
  const broken = await root.createCourse({ title: "Calculus I" });
  await root.saveProposal(broken.id, { ...FIRST, title: "Calculus I" });
  await root.approveCurriculum(broken.id, { ...FIRST, title: "Calculus I" });
  await writeFile(join(dir, "courses", broken.id, "evidence.jsonl"), "{\n");
  const { app } = setUp([]);
  const quiet = vi.spyOn(console, "error").mockImplementation(() => {});

  const started = await app.request(`/api/courses/${COURSE}/what-i-know`);
  const unknown = await app.request("/api/courses/nowhere/what-i-know");
  const drafted = await app.request(`/api/courses/${draft.id}/what-i-know`);
  const unreadable = await app.request(`/api/courses/${broken.id}/what-i-know`);
  quiet.mockRestore();

  expect(started.status).toBe(200);
  const { units } = (await started.json()) as {
    units: { id: string; status: string; objectives: unknown[] | null }[];
  };
  expect(units.map((u) => [u.id, u.status, u.objectives?.length])).toEqual([
    ["vectors", "in-progress", 2],
    ["eigen", "not-started", undefined],
  ]);
  expect(unknown.status).toBe(404);
  expect(drafted.status).toBe(409);
  expect(((await drafted.json()) as { error: string }).error).toContain(
    "not approved",
  );
  expect(unreadable.status).toBe(500);
  expect(((await unreadable.json()) as { error: string }).error).toContain(
    "evidence.jsonl, line 1",
  );
});

// --- Calibration -----------------------------------------------------------------

test("calibration counts every course's answers by confidence", async () => {
  // The course's answers: at 50%, one wrong and one right; at 75%, one
  // wrong and one right; at 90%, one right with help, left out; at 100%, one
  // right, on an objective of no plan, which counts all the same; two "I
  // don't know"; and an override, which counts for nothing.
  await courseWithEvidence();
  const { app } = setUp([]);

  const response = await app.request("/api/calibration");

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    levels: [
      { confidence: "under-50", correct: 0, answered: 0 },
      { confidence: "50", correct: 1, answered: 2 },
      { confidence: "75", correct: 1, answered: 2 },
      { confidence: "90", correct: 0, answered: 0 },
      { confidence: "100", correct: 1, answered: 1 },
    ],
    unknown: 2,
    skipped: [],
  });
});
