import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createFakeBackend, type FakeTurn } from "../backends/fake.ts";
import { createIntakes } from "../engine/intake.ts";
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
};
const REVISED = { ...FIRST, units: FIRST.units.slice(0, 1) };

function setUp(script: FakeTurn[]) {
  const backend = createFakeBackend(script);
  const dataRoot = openDataRoot({ path: dir, now: () => new Date(NOW) });
  const intakes = createIntakes({
    backend,
    systemPrompt: "You are a test planner.",
    dataRoot,
  });
  const app = createApp({ dataRoot, intakes });
  return { backend, intakes, app };
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
  const setup = setUp([[{ call: "propose_curriculum", input: FIRST }]]);
  const { app } = setup;

  const empty = await app.request("/api/courses");
  expect(empty.status).toBe(200);
  expect(await empty.json()).toEqual({ courses: [] });

  const intakeId = await startIntake(app);
  expect(await (await app.request("/api/courses")).json()).toEqual({
    courses: [],
  });
  await say(setup, intakeId, ASK);

  const draft = {
    id: "linear-algebra-for-pca",
    course: { title: "Linear algebra for PCA", lastOpenedAt: NOW },
    curriculum: { approval: { status: "draft" }, units: FIRST.units },
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

  expect(stream.first).toEqual([
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
  expect(await stream.more(4)).toEqual([
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
    [{ call: "propose_curriculum", input: FIRST }],
    [{ call: "propose_curriculum", input: REVISED }],
  ]);
  const { app } = setup;
  const intakeId = await startIntake(app);
  await say(setup, intakeId, ASK);
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
    [{ call: "propose_curriculum", input: FIRST }],
    [{ text: "Let me reconsider" }, { hold: true }],
  ]);
  const { app } = setup;
  const intakeId = await startIntake(app);
  await say(setup, intakeId, ASK);

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
  const before = setUp([[{ call: "propose_curriculum", input: FIRST }]]);
  const intakeId = await startIntake(before.app);
  await say(before, intakeId, ASK);
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

test("a draft opens for review in its running intake, or after a restart in a new one that starts from it", async () => {
  const before = setUp([[{ call: "propose_curriculum", input: FIRST }]]);
  const intakeId = await startIntake(before.app);
  await say(before, intakeId, ASK);
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
