import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { z } from "zod";
import { getJsonUntilAnswered } from "./api.ts";

// The page's requests go through fetch, stubbed here: no server is involved.
const Body = z.object({ title: z.string() });
const PATH = "/api/courses/calculus";

let fetches: string[];
function answers(...replies: (() => Promise<Response>)[]) {
  fetches = [];
  let next = 0;
  vi.stubGlobal("fetch", (path: string) => {
    fetches.push(path);
    const reply = replies[next] ?? replies.at(-1);
    next += 1;
    if (reply === undefined) throw new Error("No reply scripted.");
    return reply();
  });
}
const unreachable = () => Promise.reject(new TypeError("Failed to fetch"));
const status = (code: number, body: unknown) => () =>
  Promise.resolve(Response.json(body, { status: code }));

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test("a server not reached, then one that fails, is asked again, each time later, until it answers", async () => {
  answers(
    unreachable,
    status(500, { error: "The record could not be read." }),
    status(200, { title: "Calculus I" }),
  );
  const failures: string[] = [];
  const loaded = getJsonUntilAnswered(PATH, Body, {
    signal: new AbortController().signal,
    onFailure: (error) => failures.push(error),
  });

  await vi.advanceTimersByTimeAsync(0);
  expect(fetches).toHaveLength(1);
  expect(failures).toEqual(["The server could not be reached."]);
  // The first retry waits a second, the next two.
  await vi.advanceTimersByTimeAsync(999);
  expect(fetches).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(fetches).toHaveLength(2);
  expect(failures).toEqual([
    "The server could not be reached.",
    "The record could not be read.",
  ]);
  await vi.advanceTimersByTimeAsync(1999);
  expect(fetches).toHaveLength(2);
  await vi.advanceTimersByTimeAsync(1);

  expect(await loaded).toEqual({ ok: true, data: { title: "Calculus I" } });
  expect(fetches).toEqual([PATH, PATH, PATH]);
});

test("a refusal is final: no such course is answered at once, and not asked again", async () => {
  answers(status(404, { error: "No such course." }));
  const failures: string[] = [];

  const answer = await getJsonUntilAnswered(PATH, Body, {
    signal: new AbortController().signal,
    onFailure: (error) => failures.push(error),
  });

  expect(answer).toEqual({ ok: false, status: 404, error: "No such course." });
  expect(failures).toEqual([]);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(fetches).toHaveLength(1);
});

test("the wait between tries stops growing at its limit", async () => {
  answers(unreachable);
  const stop = new AbortController();
  void getJsonUntilAnswered(PATH, Body, {
    signal: stop.signal,
    onFailure: () => {},
  });

  // Tries at 0, then after 1, 2, 4 and 8 seconds, then every 15.
  await vi.advanceTimersByTimeAsync(15_000);
  expect(fetches).toHaveLength(5);
  await vi.advanceTimersByTimeAsync(15_000);
  expect(fetches).toHaveLength(6);
  await vi.advanceTimersByTimeAsync(15_000);
  expect(fetches).toHaveLength(7);
  stop.abort();
});

test("leaving the page stops the tries, and nothing is answered", async () => {
  answers(unreachable);
  const stop = new AbortController();
  const loaded = getJsonUntilAnswered(PATH, Body, {
    signal: stop.signal,
    onFailure: () => {},
  });

  await vi.advanceTimersByTimeAsync(500);
  stop.abort();

  expect(await loaded).toBeUndefined();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(fetches).toHaveLength(1);
});
