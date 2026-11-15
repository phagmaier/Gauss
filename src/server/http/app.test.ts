import { expect, test } from "vitest";
import { createFakeBackend, type FakeTurn } from "../backends/fake.ts";
import { createChat } from "../engine/chat.ts";
import { createApp } from "./app.ts";

const ORIGIN = "http://localhost";
const QUESTION = {
  objective: "Apply the power rule",
  prompt: "What is the derivative of x³?",
  choices: ["3x²", "x²"],
  answer: "A",
};

function setUp(script: FakeTurn[]) {
  const chat = createChat({
    backend: createFakeBackend(script),
    systemPrompt: "",
  });
  return { chat, app: createApp(chat) };
}

function postJson(
  app: ReturnType<typeof createApp>,
  path: string,
  body?: unknown,
) {
  return app.request(path, {
    method: "POST",
    headers: { Origin: ORIGIN, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
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

test("the event stream says hello, replays the chat's log with ids, then sends live events", async () => {
  const { chat, app } = setUp([[{ text: "Hello." }], [{ text: "Hi again." }]]);
  chat.start();
  await chat.settled();

  const response = await app.request("/api/events");
  expect(response.headers.get("Content-Type")).toContain("text/event-stream");
  const stream = await readFrames(response, 4);

  expect(stream.first).toEqual([
    { event: "hello", data: { chatId: chat.id } },
    { id: `${chat.id}.0`, data: { type: "turn_start" } },
    { id: `${chat.id}.1`, data: { type: "tutor_text", text: "Hello." } },
    { id: `${chat.id}.2`, data: { type: "turn_end", outcome: "done" } },
  ]);

  chat.say("Again?");
  expect(await stream.more(2)).toEqual([
    { id: `${chat.id}.3`, data: { type: "learner", text: "Again?" } },
    { id: `${chat.id}.4`, data: { type: "turn_start" } },
  ]);
  await stream.close();
});

test("a reconnecting page gets only what it missed, unless the chat changed", async () => {
  const { chat, app } = setUp([[{ text: "Hello." }]]);
  chat.start();
  await chat.settled();

  const resumed = await readFrames(
    await app.request("/api/events", {
      headers: { "Last-Event-ID": `${chat.id}.1` },
    }),
    2,
  );
  expect(resumed.first[1]).toEqual({
    id: `${chat.id}.2`,
    data: { type: "turn_end", outcome: "done" },
  });
  await resumed.close();

  const restarted = await readFrames(
    await app.request("/api/events", {
      headers: { "Last-Event-ID": "an-earlier-chat.7" },
    }),
    2,
  );
  expect(restarted.first[1]?.id).toBe(`${chat.id}.0`);
  await restarted.close();
});

test("posting an answer grades it", async () => {
  const { chat, app } = setUp([
    [{ call: "ask_question", input: QUESTION }],
    [],
  ]);
  expect((await postJson(app, "/api/start")).status).toBe(202);
  await chat.settled();

  const response = await postJson(app, "/api/answers", {
    kind: "choice",
    questionId: "q1",
    choice: "B",
    confidence: "75",
  });

  expect(response.status).toBe(202);
  expect(chat.events()).toContainEqual(
    expect.objectContaining({ type: "graded", verdict: "incorrect" }),
  );
});

test("malformed bodies are refused with a reason", async () => {
  const { chat, app } = setUp([[{ call: "ask_question", input: QUESTION }]]);
  chat.start();
  await chat.settled();

  const noConfidence = await postJson(app, "/api/answers", {
    kind: "choice",
    questionId: "q1",
    choice: "A",
  });
  expect(noConfidence.status).toBe(400);
  expect(await noConfidence.json()).toHaveProperty("error");

  expect((await postJson(app, "/api/messages", { text: "   " })).status).toBe(
    400,
  );
  expect(chat.events().some((e) => e.type === "graded")).toBe(false);
});

test("requests from other sites and other host names are refused", async () => {
  const { chat, app } = setUp([[{ text: "Hello." }]]);

  const crossSite = await app.request("/api/start", {
    method: "POST",
    headers: { Origin: "https://example.com" },
  });
  const noOrigin = await app.request("/api/start", { method: "POST" });
  const rebound = await app.request("http://gauss.example.com/api/events");

  expect([crossSite.status, noOrigin.status, rebound.status]).toEqual([
    403, 403, 403,
  ]);
  expect(chat.events()).toEqual([]);
});
