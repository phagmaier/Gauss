import { expect, test, vi } from "vitest";
import { SessionNotFound, type TutorBackend } from "../backends/backend.ts";
import { createFakeBackend, type FakeTurn } from "../backends/fake.ts";
import {
  createConversation,
  createEventLog,
  type EventLog,
  IDLE_MS,
} from "./conversation.ts";
import { createFakeTimer } from "./fake-timer.ts";

function setUp(script: FakeTurn[]) {
  return setUpWith(createFakeBackend(script));
}

function setUpWith<Backend extends TutorBackend>(backend: Backend) {
  const log = createEventLog();
  const tutor = createConversation({
    start: () =>
      backend.startSession({
        systemPrompt: "You are a test tutor.",
        tools: [],
      }),
    log,
  });
  return { backend, log, tutor };
}

function nextEvent(log: EventLog, type: string): Promise<void> {
  return new Promise((resolve) => {
    const stop = log.subscribe((event) => {
      if (event.type === type) {
        stop();
        resolve();
      }
    });
  });
}

test("the session starts with the first turn and serves every turn after it", async () => {
  const { backend, log, tutor } = setUp([
    [{ text: "One." }],
    [{ text: "Two." }],
  ]);
  expect(tutor.started()).toBe(false);

  tutor.send("first");
  tutor.send("second");
  await tutor.settled();
  expect(tutor.started()).toBe(true);

  expect(backend.sessions).toHaveLength(1);
  expect(backend.sessions[0]?.systemPrompt).toBe("You are a test tutor.");
  expect(backend.received.map((t) => t.text)).toEqual(["first", "second"]);
  expect(log.events()).toEqual([
    { type: "turn_start" },
    { type: "tutor_text", text: "One." },
    { type: "turn_end", outcome: "done" },
    { type: "turn_start" },
    { type: "tutor_text", text: "Two." },
    { type: "turn_end", outcome: "done" },
  ]);
});

test("turns go to the tutor one at a time, and stopping one lets the next start", async () => {
  const { backend, log, tutor } = setUp([
    [{ text: "A long lecture" }, { hold: true }, { text: "never written" }],
    [{ text: "Hello." }],
  ]);
  const writing = nextEvent(log, "tutor_text");
  tutor.send("first");
  await writing;

  tutor.send("Stop, please.");
  expect(backend.received).toHaveLength(1);
  expect(tutor.busy()).toBe(true);
  await tutor.interrupt();
  await tutor.settled();

  expect(tutor.busy()).toBe(false);
  expect(log.events()).toEqual([
    { type: "turn_start" },
    { type: "tutor_text", text: "A long lecture" },
    { type: "turn_end", outcome: "interrupted" },
    { type: "turn_start" },
    { type: "tutor_text", text: "Hello." },
    { type: "turn_end", outcome: "done" },
  ]);
  expect(backend.received[1]?.text).toBe("Stop, please.");
});

// Both backends clear their stop flag when a turn is sent, so the queue has to
// hold a Stop that comes before then.
test("Stop while a turn's text is being composed stops that turn: the tutor never receives it, and the next turn is sent as usual", async () => {
  const { backend, log, tutor } = setUp([[{ text: "Hello." }]]);
  const composing = Promise.withResolvers<void>();
  const composed = Promise.withResolvers<string>();

  tutor.send({
    text: () => {
      composing.resolve();
      return composed.promise;
    },
  });
  await composing.promise;
  await tutor.interrupt();
  composed.resolve("first");
  await tutor.settled();
  tutor.send("second");
  await tutor.settled();

  expect(backend.received.map((t) => t.text)).toEqual(["second"]);
  expect(log.events()).toEqual([
    { type: "turn_start" },
    { type: "turn_end", outcome: "interrupted" },
    { type: "turn_start" },
    { type: "tutor_text", text: "Hello." },
    { type: "turn_end", outcome: "done" },
  ]);
});

test("Stop while the session is starting stops the first turn before its text is composed", async () => {
  const fake = createFakeBackend([[{ text: "Hello." }]]);
  const starting = Promise.withResolvers<void>();
  const { log, tutor } = setUpWith({
    ...fake,
    startSession: async (options) => {
      await starting.promise;
      return fake.startSession(options);
    },
  });
  let composed = false;
  const started = nextEvent(log, "turn_start");

  tutor.send({
    text: () => {
      composed = true;
      return "first";
    },
  });
  await started;
  await tutor.interrupt();
  starting.resolve();
  await tutor.settled();

  // Composing can have effects, such as noting help (unit-chat.ts).
  expect(composed).toBe(false);
  expect(fake.received).toEqual([]);
  expect(log.events()).toEqual([
    { type: "turn_start" },
    { type: "turn_end", outcome: "interrupted" },
  ]);
});

test("a backend that fails to start is reported to the page as an error, and the next turn tries again", async () => {
  const fake = createFakeBackend([[{ text: "Hello." }]]);
  let failing = true;
  const { log, tutor } = setUpWith({
    ...fake,
    startSession: (options) =>
      failing
        ? Promise.reject(new Error("Not logged in."))
        : fake.startSession(options),
  });

  tutor.send("first");
  await tutor.settled();

  expect(log.events()).toEqual([
    { type: "turn_start" },
    { type: "turn_end", outcome: "error", error: "Not logged in." },
  ]);
  expect(tutor.busy()).toBe(false);

  failing = false;
  tutor.send("second");
  await tutor.settled();

  expect(fake.received.map((t) => t.text)).toEqual(["second"]);
  expect(log.events().at(-1)).toEqual({ type: "turn_end", outcome: "done" });
});

test("a failing listener does not stop the conversation", async () => {
  const { log, tutor } = setUp([[{ text: "One." }], [{ text: "Two." }]]);
  const stop = log.subscribe(() => {
    throw new Error("a page went away badly");
  });
  const quiet = vi.spyOn(console, "error").mockImplementation(() => {});

  tutor.send("first");
  tutor.send("second");
  await tutor.settled();
  stop();
  quiet.mockRestore();

  expect(log.events().filter((e) => e.type === "turn_end")).toEqual([
    { type: "turn_end", outcome: "done" },
    { type: "turn_end", outcome: "done" },
  ]);
});

test("a turn's text is composed when it is sent, after the end-of-turn work of the turn before", async () => {
  const { backend, tutor } = setUp([[{ text: "One." }], [{ text: "Two." }]]);
  let phase = "teach";
  const order: string[] = [];

  tutor.send({
    text: "first",
    async ended(outcome) {
      order.push(`ended: ${outcome}`);
      await new Promise((resolve) => setTimeout(resolve, 5));
      phase = "discuss";
    },
  });
  // Queued while the first turn runs; its header must see the later phase.
  tutor.send({
    text: () => {
      order.push("composed");
      return `[Phase: ${phase}]`;
    },
  });
  await tutor.settled();

  expect(order).toEqual(["ended: done", "composed"]);
  expect(backend.received.map((t) => t.text)).toEqual([
    "first",
    "[Phase: discuss]",
  ]);
});

test("end-of-turn work hears how the turn ended and the text the tutor wrote in it, and its failure does not stop the next turn", async () => {
  const { backend, log, tutor } = setUp([
    [{ text: "A long " }, { text: "lecture" }, { hold: true }],
    [{ text: "Two." }],
    [],
  ]);
  const ended: string[] = [];
  const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
  const writing = nextEvent(log, "tutor_text");

  tutor.send({
    text: "first",
    ended(outcome, reply) {
      ended.push(`${outcome}: ${reply}`);
      throw new Error("the record could not be written");
    },
  });
  tutor.send({
    text: "second",
    ended: (outcome, reply) => void ended.push(`${outcome}: ${reply}`),
  });
  tutor.send({
    text: "third",
    ended: (outcome, reply) => void ended.push(`${outcome}: ${reply}`),
  });
  await writing;
  await tutor.interrupt();
  await tutor.settled();
  quiet.mockRestore();

  // Each turn's own text, joined; none for a turn that wrote nothing.
  expect(ended).toEqual([
    "interrupted: A long lecture",
    "done: Two.",
    "done: ",
  ]);
  expect(backend.received.map((t) => t.text)).toEqual([
    "first",
    "second",
    "third",
  ]);
  expect(tutor.busy()).toBe(false);
});

test("a turn sent when a turn ends is waited for by settled(); one skipped when its time comes sends nothing, the page hears nothing of it, and its end-of-turn work does not run", async () => {
  const { backend, log, tutor } = setUp([
    [{ text: "One." }],
    [{ text: "Three." }],
  ]);
  let wanted = true;
  const ended: string[] = [];

  tutor.send({
    text: "first",
    ended() {
      tutor.send({
        text: "second",
        skip: () => !wanted,
        ended: () => {
          ended.push("second");
        },
      });
      tutor.send("third");
      // No longer wanted by the time its turn comes.
      wanted = false;
    },
  });
  await tutor.settled();

  expect(backend.received.map((t) => t.text)).toEqual(["first", "third"]);
  expect(ended).toEqual([]);
  expect(log.events()).toEqual([
    { type: "turn_start" },
    { type: "tutor_text", text: "One." },
    { type: "turn_end", outcome: "done" },
    { type: "turn_start" },
    { type: "tutor_text", text: "Three." },
    { type: "turn_end", outcome: "done" },
  ]);
  expect(tutor.busy()).toBe(false);
});

// --- Task 2.15: idle sessions closed, and resumed by the next turn ------------

const FOLDER = "/courses/test";

/** A conversation whose sessions the fake backend keeps, on a fake timer. */
function setUpKept(
  backend: TutorBackend,
  given: { resumeId?: string; waiting?: () => boolean } = {},
) {
  const log = createEventLog();
  const timer = createFakeTimer();
  const options = { systemPrompt: "You are a test tutor.", tools: [] };
  let lost = 0;
  const tutor = createConversation({
    start: () => backend.startSession({ ...options, cwd: FOLDER }),
    kept: {
      resume: (id) =>
        backend.startSession({ ...options, cwd: FOLDER, resumeId: id }),
      ...(given.resumeId === undefined ? {} : { resumeId: given.resumeId }),
      lost: () => {
        lost += 1;
      },
      ...(given.waiting === undefined ? {} : { waiting: given.waiting }),
      timer,
    },
    log,
  });
  return { log, timer, tutor, lost: () => lost };
}

/** Lets the closing of a session, which the timer starts, run. */
const closing = () => new Promise((resolve) => setImmediate(resolve));

test("a kept session is closed once it has been idle for IDLE_MS, and the next turn resumes it by its id, in its folder", async () => {
  const backend = createFakeBackend([[{ text: "One." }], [{ text: "Two." }]]);
  const { log, timer, tutor } = setUpKept(backend);

  tutor.send("first");
  await tutor.settled();
  const [id] = backend.ids;
  timer.advance(IDLE_MS - 1);
  await closing();
  expect(backend.closed).toEqual([]);
  timer.advance(1);
  await closing();
  expect(backend.closed).toEqual([id]);

  tutor.send("second");
  await tutor.settled();

  expect(backend.sessions).toEqual([
    { systemPrompt: "You are a test tutor.", tools: [], cwd: FOLDER },
    {
      systemPrompt: "You are a test tutor.",
      tools: [],
      cwd: FOLDER,
      resumeId: id,
    },
  ]);
  expect(backend.ids).toEqual([id, id]);
  expect(backend.received.map((t) => t.text)).toEqual(["first", "second"]);
  expect(log.events().slice(3)).toEqual([
    { type: "turn_start" },
    { type: "tutor_text", text: "Two." },
    { type: "turn_end", outcome: "done" },
  ]);

  // Closed again once idle again, and for good by close(), after which no
  // turn starts a session.
  timer.advance(IDLE_MS);
  await closing();
  expect(backend.closed).toEqual([id, id]);
  await tutor.close();
  tutor.send("third");
  await tutor.settled();
  expect(backend.sessions).toHaveLength(2);
  expect(log.events().at(-1)).toEqual({
    type: "turn_end",
    outcome: "error",
    error: "The chat is closed.",
  });
});

test("a session is never closed while a turn is queued or running: the idle time counts from the end of the last turn", async () => {
  const backend = createFakeBackend([
    [{ text: "One." }],
    [{ text: "Two." }],
    [{ text: "A long lecture" }, { hold: true }],
  ]);
  const { log, timer, tutor } = setUpKept(backend);

  tutor.send("first");
  await tutor.settled();
  timer.advance(IDLE_MS - 1);
  // Queued behind a turn that runs, then running, for longer than IDLE_MS.
  const lecturing = new Promise<void>((resolve) => {
    const stop = log.subscribe((event) => {
      if (event.type === "tutor_text" && event.text === "A long lecture") {
        stop();
        resolve();
      }
    });
  });
  tutor.send("second");
  tutor.send("third");
  await lecturing;
  timer.advance(3 * IDLE_MS);
  await closing();
  expect(backend.closed).toEqual([]);
  expect(tutor.busy()).toBe(true);

  await tutor.interrupt();
  await tutor.settled();
  timer.advance(IDLE_MS - 1);
  await closing();
  expect(backend.closed).toEqual([]);
  timer.advance(1);
  await closing();
  expect(backend.closed).toEqual(backend.ids);
  expect(backend.ids).toHaveLength(1);
});

test("a session is not closed while something outside the conversation will send it a turn", async () => {
  const backend = createFakeBackend([[{ text: "One." }]]);
  let grading = true;
  const { timer, tutor } = setUpKept(backend, { waiting: () => grading });

  tutor.send("first");
  await tutor.settled();
  timer.advance(5 * IDLE_MS);
  await closing();
  expect(backend.closed).toEqual([]);

  grading = false;
  timer.advance(IDLE_MS);
  await closing();
  expect(backend.closed).toEqual(backend.ids);
});

test("a resume that fails is an error and is tried again by the next turn; a session the backend cannot find gives way to a new one, after lost()", async () => {
  const fake = createFakeBackend([[{ text: "New here." }]]);
  let failures = 1;
  const resumes: string[] = [];
  const { log, tutor, lost } = setUpKept(
    {
      ...fake,
      async startSession(options) {
        if (options.resumeId !== undefined) {
          resumes.push(options.resumeId);
          if (failures > 0) {
            failures -= 1;
            throw new Error("Claude Code could not start.");
          }
          throw new SessionNotFound(options.resumeId);
        }
        return fake.startSession(options);
      },
    },
    { resumeId: "kept-1" },
  );
  expect(tutor.started()).toBe(true);

  tutor.send("first");
  await tutor.settled();
  expect(log.events()).toEqual([
    { type: "turn_start" },
    {
      type: "turn_end",
      outcome: "error",
      error: "Claude Code could not start.",
    },
  ]);
  expect(lost()).toBe(0);

  tutor.send("second");
  await tutor.settled();

  expect(resumes).toEqual(["kept-1", "kept-1"]);
  expect(lost()).toBe(1);
  expect(fake.sessions).toEqual([
    { systemPrompt: "You are a test tutor.", tools: [], cwd: FOLDER },
  ]);
  expect(fake.received.map((t) => t.text)).toEqual(["second"]);
  expect(log.events().at(-1)).toEqual({ type: "turn_end", outcome: "done" });
});
