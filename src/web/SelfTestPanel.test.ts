// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import { DueCount } from "./Course.tsx";
import { SelfTestPanel } from "./SelfTestPanel.tsx";

let cleanup: (() => void) | undefined;
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  vi.unstubAllGlobals();
});

test("Start is disabled with no kind picked, and posts the scope, kinds and count it shows", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const posts: { path: string; body: unknown }[] = [];
  vi.stubGlobal("fetch", async (path: string, init?: RequestInit) => {
    posts.push({ path, body: JSON.parse(String(init?.body)) });
    return new Response(
      JSON.stringify(
        path.endsWith("/counts")
          ? { asks: 2, holds: 3, withinHour: 1 }
          : { ok: true, unit: "rules" },
      ),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  });
  const started: string[] = [];
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  cleanup = () => {
    act(() => root.unmount());
    host.remove();
  };
  await act(async () => {
    root.render(
      createElement(SelfTestPanel, {
        courseId: "calc",
        units: [
          { id: "limits", number: 1, title: "Limits", segments: ["Tables"] },
          { id: "rules", number: 2, title: "Rules", segments: ["A", "B"] },
        ],
        onCancel: () => {},
        onStarted: (unit) => started.push(unit),
        onProblem: () => {},
      }),
    );
  });
  const start = [...host.querySelectorAll("button")].find(
    (b) => b.textContent === "Start the self-test",
  );
  if (start === undefined) throw new Error("No Start.");
  const boxes = [
    ...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
  ];
  expect(boxes.map((b) => b.checked)).toEqual([true, true, true, true]);
  expect(host.querySelector(".st-sum")?.textContent).toBe(
    "All 2 objectives you can be asked in unit 1, mixed, one question each and one more after a miss. One objective answered within the hour is left out. A right answer marks its objective retained.",
  );

  // No kind: Start is disabled, and the line asks for one.
  for (const box of boxes) await act(async () => box.click());
  expect(start.disabled).toBe(true);
  expect(host.querySelector(".st-sum")?.textContent).toBe(
    "Pick at least one kind.",
  );

  // Choice and code, a segment of unit 2, 20 objectives.
  await act(async () => boxes[0]?.click());
  await act(async () => boxes[3]?.click());
  const radios = host.querySelectorAll<HTMLInputElement>('input[type="radio"]');
  await act(async () => radios[0]?.click());
  const [unit, segment] = host.querySelectorAll("select");
  await act(async () => {
    if (unit === undefined || segment === undefined)
      throw new Error("No lists.");
    unit.value = "rules";
    unit.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await act(async () => {
    const list = host.querySelectorAll("select")[1];
    if (list === undefined) throw new Error("No segment list.");
    list.value = "1";
    list.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const twenty = [...host.querySelectorAll("button")].find(
    (b) => b.textContent === "20",
  );
  await act(async () => twenty?.click());
  expect(start.disabled).toBe(false);
  const request = {
    scope: { kind: "segment", unit: "rules", segment: 1 },
    kinds: ["choice", "code"],
    count: 20,
  };
  // The counts are asked again for what the panel now shows.
  expect(posts.at(-1)).toEqual({
    path: "/api/courses/calc/self-test/counts",
    body: request,
  });
  await act(async () => start.click());
  expect(posts.at(-1)).toEqual({
    path: "/api/courses/calc/self-test",
    body: request,
  });
  expect(started).toEqual(["rules"]);
});

test("a late answer for the scope left behind is not shown under the new one", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const waiting: {
    scope: string;
    answer: (counts: object) => void;
  }[] = [];
  vi.stubGlobal(
    "fetch",
    (_path: string, init?: RequestInit) =>
      new Promise<Response>((resolve) => {
        const body = JSON.parse(String(init?.body));
        waiting.push({
          scope: body.scope.kind,
          answer: (counts) => resolve(Response.json(counts)),
        });
      }),
  );
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  cleanup = () => {
    act(() => root.unmount());
    host.remove();
  };
  await act(async () => {
    root.render(
      createElement(SelfTestPanel, {
        courseId: "calc",
        units: [{ id: "limits", number: 1, title: "Limits", segments: ["A"] }],
        onCancel: () => {},
        onStarted: () => {},
        onProblem: () => {},
      }),
    );
  });
  const said = () => host.querySelector(".st-sum")?.textContent;
  const unitAnswer = waiting[0];
  if (unitAnswer?.scope !== "unit") throw new Error("No counts asked.");
  await act(async () =>
    unitAnswer.answer({ asks: 2, holds: 2, withinHour: 0 }),
  );
  expect(said()).toContain("in unit 1");

  // The course is picked: the unit's line goes until the course's comes.
  const radios = () =>
    host.querySelectorAll<HTMLInputElement>('input[type="radio"]');
  await act(async () => radios()[2]?.click());
  expect(said()).toBe("");
  const courseAnswer = waiting[1];
  if (courseAnswer?.scope !== "course") throw new Error("Counts not asked.");
  await act(async () =>
    courseAnswer.answer({ asks: 3, holds: 4, withinHour: 1 }),
  );
  expect(said()).toBe(
    "All 3 objectives you can be asked in the course, mixed, one question each and one more after a miss. One objective answered within the hour is left out. A right answer marks its objective retained.",
  );
  // Back to the unit: the course's line is not said of it.
  await act(async () => radios()[1]?.click());
  expect(said()).toBe("");
  // The course again, and the unit's answer comes late: the course keeps its
  // own line, the one it was answered with.
  await act(async () => radios()[2]?.click());
  const lateUnit = waiting[2];
  if (lateUnit?.scope !== "unit") throw new Error("Counts not asked.");
  await act(async () => lateUnit.answer({ asks: 1, holds: 1, withinHour: 0 }));
  expect(said()).toContain("in the course");
});

test("the due line says nothing is due, and offers only Self-test, when nothing is", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  cleanup = () => {
    act(() => root.unmount());
    host.remove();
  };
  const opened: string[] = [];
  const render = (due: number | undefined) =>
    act(async () =>
      root.render(
        createElement(DueCount, {
          due,
          starting: false,
          onReview: () => opened.push("review"),
          onSelfTest: () => opened.push("self-test"),
        }),
      ),
    );
  const buttons = () =>
    [...host.querySelectorAll("button")].map((b) => b.textContent);
  await render(undefined);
  expect(host.querySelector(".cv-due")?.textContent).toBe(
    "Nothing is due for review.Self-test",
  );
  expect(buttons()).toEqual(["Self-test"]);
  await render(3);
  expect(buttons()).toEqual(["Review now", "Self-test"]);
  await act(async () => host.querySelectorAll("button")[1]?.click());
  expect(opened).toEqual(["self-test"]);
});
