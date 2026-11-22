// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import type { PageEvent } from "../shared/events.ts";
import { Session } from "./Session.tsx";

const CHAT = { chatId: "powers", last: -1 };
const PLAN: PageEvent = {
  type: "unit_plan",
  plan: {
    objectives: [
      { id: "power-rule", statement: "Differentiate a power of x." },
      { id: "product-rule", statement: "Differentiate a product." },
    ],
    segments: [{ title: "Rules", objectives: ["power-rule", "product-rule"] }],
  },
};

class Stream extends EventTarget {
  onmessage: ((event: MessageEvent<string>) => void) | undefined;
  private index = 0;

  async emit(...events: PageEvent[]) {
    await act(async () => {
      for (const event of events) {
        this.onmessage?.(
          new MessageEvent("message", {
            data: JSON.stringify(event),
            lastEventId: `${CHAT.chatId}.${this.index++}`,
          }),
        );
      }
    });
  }

  close() {
    this.onmessage = undefined;
  }
}

vi.hoisted(() => {
  // The session renders Markdown with KaTeX, which requires standards mode.
  if (document.doctype === null) {
    document.insertBefore(
      document.implementation.createDocumentType("html", "", ""),
      document.documentElement,
    );
  }
});

let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => {
  try {
    await cleanup?.();
  } finally {
    cleanup = undefined;
    vi.unstubAllGlobals();
  }
});

async function open(
  phase: "discuss" | "closed",
  finish?: (init: RequestInit | undefined) => Response,
  sources?: () => Promise<Response>,
) {
  let stream: Stream | undefined;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "EventSource",
    class extends Stream {
      constructor() {
        super();
        stream = this;
      }
    },
  );
  vi.stubGlobal("fetch", async (path: string, init?: RequestInit) => {
    if (path === "/api/courses/calculus/units/derivative/open") {
      return Response.json({ ...CHAT, ok: true });
    }
    if (path === "/api/courses/calculus") {
      return Response.json({ error: "No course details." }, { status: 404 });
    }
    if (path === "/api/courses/calculus/sources" && sources !== undefined) {
      return sources();
    }
    if (path.endsWith("/finish") && finish !== undefined) return finish(init);
    throw new Error(`Unexpected request to ${path}`);
  });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  cleanup = async () => {
    await act(async () => root.unmount());
    host.remove();
  };
  await act(async () => {
    root.render(
      createElement(Session, { courseId: "calculus", unitId: "derivative" }),
    );
  });
  if (stream === undefined) throw new Error("Session did not open its stream.");
  const events = stream;
  await act(async () => {
    events.dispatchEvent(
      new MessageEvent("hello", { data: JSON.stringify(CHAT) }),
    );
  });
  await events.emit(PLAN, { type: "phase", segment: 0, phase });

  const button = (name: string) =>
    [...host.querySelectorAll("button")].find((b) => b.textContent === name);
  return {
    stream: events,
    sourceLines: () =>
      [...host.querySelectorAll(".did")].map((line) =>
        [...line.children]
          .filter((el) => el.tagName.toLowerCase() !== "svg")
          .map((el) => el.textContent)
          .join(" "),
      ),
    button,
    /** What a confirmation asks, if one is shown. */
    confirmation: () => host.querySelector(".confirm > span")?.textContent,
    async click(name: string) {
      const control = button(name);
      if (control === undefined || control.disabled) {
        throw new Error(`No enabled button: ${name}`);
      }
      await act(async () => control.click());
    },
  };
}

test("source events in the thread resolve to section titles and printed page labels", async () => {
  const outline = Promise.withResolvers<Response>();
  const { stream, sourceLines } = await open(
    "discuss",
    undefined,
    () => outline.promise,
  );
  await stream.emit(
    { type: "turn_start" },
    { type: "section_read", section: "lectures/s1" },
    { type: "page_viewed", source: "lectures", page: 2, math: true },
    { type: "turn_end", outcome: "done" },
  );
  expect(sourceLines()).toEqual([
    "Read lectures/s1",
    "Looked at page 2 its text lost its math",
  ]);

  await act(async () => {
    outline.resolve(
      Response.json({
        sources: [
          {
            id: "lectures",
            title: "Lectures",
            file: "original.pdf",
            name: "lectures.pdf",
            format: "pdf",
            sha256: "a".repeat(64),
            converter: 5,
            limit: 20_000,
            pages: { count: 2, labels: ["i", "1"], blank: [] },
            entries: [
              {
                id: "s1",
                title: "Rates of change",
                size: 50,
                place: { pages: { first: 1, last: 2 } },
              },
            ],
          },
        ],
      }),
    );
  });
  expect(sourceLines()).toEqual([
    "Read Rates of change pp. i–1",
    "Looked at page 1 its text lost its math",
  ]);
});

const READY = "I'm ready for the check";
const MOVE_ON = "Move on without the check";

test("the discussion restores both actions after Stay or a review in another tab", async () => {
  const { stream, button, click } = await open("discuss");
  expect(button(READY)?.disabled).toBe(false);
  await click(MOVE_ON);
  expect(button(READY)).toBeUndefined();
  await click("Stay");
  expect(button(READY)?.disabled).toBe(false);
  await click(MOVE_ON);

  await stream.emit(
    { type: "assessment", mode: "review", stage: "offered", count: 1 },
    { type: "assessment", mode: "review", stage: "on", count: 1 },
  );
  expect(button("Skip review")?.disabled).toBe(false);
  expect(button("Move on")).toBeUndefined();
  await stream.emit({
    type: "assessment_end",
    mode: "review",
    skipped: true,
    statuses: {},
  });

  expect(button(READY)?.disabled).toBe(false);
  expect(button(MOVE_ON)?.disabled).toBe(false);
  expect(button("Move on")).toBeUndefined();
});

const GATE = {
  type: "assessment",
  mode: "gate",
  stage: "offered",
  count: 1,
  own: 1,
} as const;

test("starting the gate in another tab does not leave Skip the rest already confirmed", async () => {
  const { stream, button, click } = await open("closed");
  await stream.emit(GATE);
  await click("Skip the gate");
  expect(button("Start the gate")).toBeUndefined();
  await stream.emit({ ...GATE, stage: "on" });

  expect(button("Skip the gate")?.disabled).toBe(false);
  expect(button("Skip the rest of the gate")).toBeUndefined();
});

// Two objectives not passed before the gate, as the server shows the card.
const BEFORE_GATE = {
  type: "unit_end",
  passed: false,
  objectives: { "power-rule": "attempted", "product-rule": "overridden" },
  finishId: "before-gate",
} as const;

test("before the gate, a closing card that the gate follows says the gate comes next, and one without keeps its own step", async () => {
  const { stream, button, click, confirmation } = await open("closed");
  await stream.emit({ ...BEFORE_GATE, gateFollows: true });

  expect(button("Go over the two again")?.disabled).toBe(false);
  expect(button("Move on without them")).toBeUndefined();
  await click("Go on to the unit gate");
  expect(confirmation()).toBe(
    "The two objectives not passed are recorded as overridden and stay so; the unit gate comes next.",
  );
  expect(button("Move on")?.disabled).toBe(false);
  expect(button("Stay")?.disabled).toBe(false);

  // The card shown again with nothing left for the gate to ask: the
  // confirmation asked on the gate's step is gone.
  await stream.emit({ ...BEFORE_GATE, finishId: "without-gate" });

  expect(confirmation()).toBeUndefined();
  expect(button("Go on to the unit gate")).toBeUndefined();
  expect(button("Go over the two again")?.disabled).toBe(false);
  await click("Move on without them");
  expect(confirmation()).toBe("The unit will be recorded as overridden.");
  expect(button("Move on")?.disabled).toBe(false);
});

test("a closing-card confirmation survives an unchanged scope but not a changed one, even with the same gate destination", async () => {
  const finish = vi.fn(() => Response.json({ ok: true }));
  const { stream, click, confirmation } = await open("closed", finish);
  const card = { ...BEFORE_GATE, gateFollows: true } as const;
  await stream.emit(card);
  await click("Go on to the unit gate");
  await stream.emit({ ...card });
  expect(confirmation()).toContain("The two objectives not passed");

  await stream.emit({
    ...card,
    objectives: { "power-rule": "passed", "product-rule": "overridden" },
    finishId: "one-objective",
  });
  expect(confirmation()).toBeUndefined();
  await click("Go on to the unit gate");
  expect(confirmation()).toContain("The objective not passed");
  await click("Move on");
  expect(finish).toHaveBeenCalledWith(
    expect.objectContaining({
      body: JSON.stringify({ finishId: "one-objective" }),
    }),
  );
});

test("a closing card after the gate asks for its own Move on confirmation", async () => {
  const { stream, button, click } = await open("closed");
  await stream.emit({
    type: "unit_end",
    passed: false,
    objectives: { "power-rule": "passed", "product-rule": "overridden" },
    gateFollows: true,
    finishId: "before-gate",
  });
  await click("Go on to the unit gate");
  expect(button("Stay")).toBeDefined();
  // Another tab moves on, then misses the gate's question on the passed objective.
  await stream.emit(
    { type: "moved_on", objectives: ["product-rule"] },
    GATE,
    { ...GATE, stage: "on" },
    {
      type: "assessment_end",
      mode: "gate",
      skipped: false,
      statuses: { "power-rule": "slipping" },
    },
    {
      type: "unit_end",
      passed: false,
      objectives: { "power-rule": "slipping", "product-rule": "overridden" },
      gate: { goOver: ["power-rule"], others: [] },
      finishId: "after-gate",
    },
  );

  expect(button("Go over it again")?.disabled).toBe(false);
  expect(button("Move on without them")?.disabled).toBe(false);
  expect(button("Stay")).toBeUndefined();
});
