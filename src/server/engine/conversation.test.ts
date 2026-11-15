import { expect, test, vi } from "vitest";
import type { TutorBackend } from "../backends/backend.ts";
import { createFakeBackend, type FakeTurn } from "../backends/fake.ts";
import {
  createConversation,
  createEventLog,
  type EventLog,
} from "./conversation.ts";

function setUp(script: FakeTurn[]) {
  return setUpWith(createFakeBackend(script));
}

function setUpWith<Backend extends TutorBackend>(backend: Backend) {
  const log = createEventLog();
  const tutor = createConversation({
    backend,
    systemPrompt: "You are a test tutor.",
    tools: [],
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
  expect(tutor.started()).toBe(true);
  await tutor.settled();

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

test("a backend that fails to start is reported to the page as an error", async () => {
  const { log, tutor } = setUpWith({
    startSession: () => Promise.reject(new Error("Not logged in.")),
    oneShot: () => Promise.reject(new Error("Not used here.")),
  });

  tutor.send("first");
  await tutor.settled();

  expect(log.events()).toEqual([
    { type: "turn_start" },
    { type: "turn_end", outcome: "error", error: "Not logged in." },
  ]);
  expect(tutor.busy()).toBe(false);
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

test("end-of-turn work hears how the turn ended, and its failure does not stop the next turn", async () => {
  const { backend, log, tutor } = setUp([
    [{ text: "A long lecture" }, { hold: true }],
    [{ text: "Two." }],
  ]);
  const outcomes: string[] = [];
  const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
  const writing = nextEvent(log, "tutor_text");

  tutor.send({
    text: "first",
    ended(outcome) {
      outcomes.push(outcome);
      throw new Error("the record could not be written");
    },
  });
  tutor.send("second");
  await writing;
  await tutor.interrupt();
  await tutor.settled();
  quiet.mockRestore();

  expect(outcomes).toEqual(["interrupted"]);
  expect(backend.received.map((t) => t.text)).toEqual(["first", "second"]);
  expect(tutor.busy()).toBe(false);
});
