import { expect, test } from "vitest";
import type { PageEvent } from "../shared/events.ts";
import { emptyTimeline, reduce, type Timeline } from "./timeline.ts";

const QUESTION = {
  id: "q1",
  number: 1,
  prompt: "What is the derivative of x³?",
  choices: ["3x²", "x²"],
};

function play(events: PageEvent[], from: Timeline = emptyTimeline): Timeline {
  return events.reduce(
    (state, event, index) => reduce(state, { type: "event", index, event }),
    reduce(from, { type: "hello", chatId: "chat-1" }),
  );
}

const LOG: PageEvent[] = [
  { type: "turn_start" },
  { type: "tutor_text", text: "The power rule " },
  { type: "tutor_text", text: "brings the exponent down." },
  { type: "question", question: QUESTION },
  { type: "turn_end", outcome: "done" },
  {
    type: "graded",
    questionId: "q1",
    verdict: "correct",
    choice: "A",
    confidence: "90",
    correctChoice: "A",
  },
  { type: "turn_start" },
  { type: "tutor_text", text: "Right." },
];

test("the log becomes the thread: text pieces join, a question card sits between replies, and a grade attaches to its card", () => {
  const state = play(LOG);

  expect(state.items).toEqual([
    { kind: "tutor", key: 1, text: "The power rule brings the exponent down." },
    { kind: "question", key: 3, question: QUESTION, graded: LOG[5] },
    { kind: "tutor", key: 7, text: "Right." },
  ]);
  expect(state.busy).toBe(true);
});

test("events the page already has are ignored, so a replay after reconnecting changes nothing", () => {
  const state = play(LOG);
  const replayed = LOG.reduce(
    (s, event, index) => reduce(s, { type: "event", index, event }),
    reduce(state, { type: "hello", chatId: "chat-1" }),
  );

  expect(replayed).toEqual(state);
});

test("a hello from another chat starts the thread over", () => {
  const state = reduce(play(LOG), { type: "hello", chatId: "chat-2" });

  expect(state).toEqual({ ...emptyTimeline, chatId: "chat-2" });
});

test("a turn that ends in an error or is stopped leaves a note, and the tutor is no longer writing", () => {
  const state = play([
    { type: "turn_start" },
    { type: "tutor_text", text: "Partial" },
    { type: "turn_end", outcome: "interrupted" },
    { type: "learner", text: "Go on." },
    { type: "turn_start" },
    { type: "turn_end", outcome: "error", error: "Rate limited." },
  ]);

  expect(
    state.items.map((item) => [item.kind, "text" in item && item.text]),
  ).toEqual([
    ["tutor", "Partial"],
    ["note", "Stopped."],
    ["learner", "Go on."],
    ["note", "The tutor stopped because of an error: Rate limited."],
  ]);
  expect(state.busy).toBe(false);
});
