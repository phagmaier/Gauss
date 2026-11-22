// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import type { PageEvent } from "../shared/events.ts";
import { Intake } from "./Intake.tsx";

vi.hoisted(() => {
  // KaTeX requires standards mode, even when the thread has no math.
  if (document.doctype === null) {
    document.insertBefore(
      document.implementation.createDocumentType("html", "", ""),
      document.documentElement,
    );
  }
});

test("uploads hold Send until their own conversion finishes, regardless of reply order or reconnect", async () => {
  const early = Promise.withResolvers<Response>();
  const late = Promise.withResolvers<Response>();
  let stream: Stream | undefined;
  let index = 0;
  class Stream extends EventTarget {
    onmessage?: (event: MessageEvent<string>) => void;
    onerror?: () => void;
    readyState = 0;
    static CLOSED = 2;

    constructor() {
      super();
      stream = this;
    }

    close() {
      this.readyState = Stream.CLOSED;
    }
  }

  const earlyFile = new File(["Early"], "early.md");
  const lateFile = new File(["Late"], "late.md");
  const failedFile = new File(["Failed"], "failed.md");
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("EventSource", Stream);
  vi.stubGlobal("fetch", async (path: string, init?: RequestInit) => {
    if (path !== "/api/intakes/intake/sources") {
      throw new Error(`Unexpected request to ${path}`);
    }
    if (init?.body === earlyFile) return early.promise;
    if (init?.body === lateFile) return late.promise;
    return Response.json({ error: "The upload was refused." }, { status: 400 });
  });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const sendLabel = () =>
    host.querySelector('button[type="submit"]')?.getAttribute("aria-label");
  const held = "Send, once the conversion is done";
  const failed = "failed.md: The upload was refused.";
  const hello = () =>
    stream?.dispatchEvent(
      new MessageEvent("hello", {
        data: JSON.stringify({ chatId: "intake", last: index - 1 }),
      }),
    );
  const emit = (event: PageEvent) =>
    stream?.onmessage?.(
      new MessageEvent("message", {
        data: JSON.stringify(event),
        lastEventId: `intake.${index++}`,
      }),
    );

  try {
    await act(async () => {
      root.render(createElement(Intake, { intakeId: "intake" }));
    });
    const thread = host.firstElementChild;
    if (thread === null || stream === undefined) {
      throw new Error("Intake did not open its thread and event stream.");
    }
    await act(async () => {
      hello();
      const drop = new Event("drop", { bubbles: true, cancelable: true });
      Object.defineProperty(drop, "dataTransfer", {
        value: { types: ["Files"], files: [earlyFile, lateFile, failedFile] },
      });
      thread.dispatchEvent(drop);
    });
    expect(sendLabel()).toBe(held);
    expect(host.textContent).toContain(failed);

    await act(async () => {
      early.resolve(Response.json({ attachment: "early" }, { status: 202 }));
      emit({ type: "source_converting", attachment: "late", name: "late.md" });
      emit({
        type: "source_refused",
        attachment: "late",
        name: "late.md",
        refusal: { reason: "failed", detail: "No text was found." },
      });
    });
    await act(async () => {
      late.resolve(Response.json({ attachment: "late" }, { status: 202 }));
    });
    expect(sendLabel()).toBe(held);

    await act(async () => stream?.onerror?.());
    expect(host.textContent).toContain("Retrying");
    await act(async () => {
      hello();
    });
    expect(sendLabel()).toBe(held);
    await act(async () => {
      emit({
        type: "source_converting",
        attachment: "early",
        name: "early.md",
      });
    });
    expect(sendLabel()).toBe(held);
    await act(async () => {
      emit({
        type: "source_attached",
        attachment: "early",
        size: 5,
        source: {
          id: "early",
          title: "Early",
          name: "early.md",
          format: "markdown",
          sections: 1,
          cut: [],
        },
      });
    });
    expect(sendLabel()).toBe("Send");
    expect(host.textContent).toContain(failed);
  } finally {
    try {
      await act(async () => root.unmount());
    } finally {
      host.remove();
      vi.unstubAllGlobals();
    }
  }
});
