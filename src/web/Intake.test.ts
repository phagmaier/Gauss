// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import type { PageEvent } from "../shared/events.ts";
import type { Outline } from "../shared/source.ts";
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

function intake(
  fetch: (path: string, init?: RequestInit) => Promise<Response>,
) {
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

  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("EventSource", Stream);
  vi.stubGlobal("fetch", fetch);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const render = async () => {
    await act(async () => {
      root.render(createElement(Intake, { intakeId: "intake" }));
    });
    if (stream === undefined) {
      throw new Error("Intake did not open its event stream.");
    }
  };
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

  const drop = (...files: File[]) => {
    const thread = host.firstElementChild;
    if (thread === null) throw new Error("Intake did not open its thread.");
    const event = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", {
      value: { types: ["Files"], files },
    });
    thread.dispatchEvent(event);
  };
  const close = async () => {
    try {
      await act(async () => root.unmount());
    } finally {
      host.remove();
      vi.unstubAllGlobals();
    }
  };
  return {
    host,
    render,
    hello,
    emit,
    drop,
    disconnect: () => stream?.onerror?.(),
    close,
  };
}

test("uploads hold Send until their own conversion finishes, regardless of reply order or reconnect", async () => {
  const early = Promise.withResolvers<Response>();
  const late = Promise.withResolvers<Response>();
  const earlyFile = new File(["Early"], "early.md");
  const lateFile = new File(["Late"], "late.md");
  const failedFile = new File(["Failed"], "failed.md");
  const { host, render, hello, emit, drop, disconnect, close } = intake(
    async (path, init) => {
      if (path !== "/api/intakes/intake/sources") {
        throw new Error(`Unexpected request to ${path}`);
      }
      if (init?.body === earlyFile) return early.promise;
      if (init?.body === lateFile) return late.promise;
      return Response.json(
        { error: "The upload was refused." },
        { status: 400 },
      );
    },
  );
  const sendLabel = () =>
    host.querySelector('button[type="submit"]')?.getAttribute("aria-label");
  const held = "Send, once the conversion is done";
  const failed = "failed.md: The upload was refused.";

  try {
    await render();
    await act(async () => {
      hello();
      drop(earlyFile, lateFile, failedFile);
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

    await act(async () => disconnect());
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
    await close();
  }
});

const book: Outline = {
  id: "book",
  title: "Linear Maps",
  file: "original.md",
  name: "book.md",
  format: "markdown",
  sha256: "0".repeat(64),
  converter: 1,
  limit: 30000,
  entries: [
    {
      id: "s1",
      title: "Bases",
      size: 1000,
      place: { paragraphs: { first: 1, last: 2 } },
    },
  ],
};
const appendix = {
  ...book,
  id: "appendix",
  title: "Appendix",
  name: "appendix.md",
};

function attached(outline: Outline): PageEvent {
  return {
    type: "source_attached",
    attachment: outline.id,
    size: 1000,
    source: {
      id: outline.id,
      title: outline.title,
      name: outline.name,
      format: outline.format,
      sections: 1,
      cut: [],
    },
  };
}

test("an attached source refreshes the proposal's coverage, with recoverable and final failures shown", async () => {
  vi.useFakeTimers();
  const outlines = vi
    .fn<() => Promise<Response>>()
    .mockResolvedValueOnce(Response.json({ sources: [book] }))
    .mockResolvedValueOnce(
      Response.json({ error: "The record was busy." }, { status: 503 }),
    )
    .mockResolvedValueOnce(Response.json({ sources: [book, appendix] }))
    .mockResolvedValueOnce(
      Response.json({ error: "No such course." }, { status: 404 }),
    );
  const { host, render, hello, emit, drop, close } = intake(async (path) => {
    if (path === "/api/courses/linear-algebra/sources") return outlines();
    if (path === "/api/intakes/intake/sources") {
      return Response.json({ attachment: "appendix" }, { status: 202 });
    }
    throw new Error(`Unexpected request to ${path}`);
  });
  const card = () => host.querySelector(".cp")?.textContent;
  const bookShare = "The units read 1 of the 1 section of Linear Maps.";
  const appendixShare = "The units read none of the 1 section of Appendix.";

  try {
    await render();
    await act(async () => {
      hello();
      emit(attached(book));
      emit({
        type: "curriculum_proposed",
        courseId: "linear-algebra",
        revision: 1,
        title: "Linear algebra",
        units: [
          {
            id: "vectors",
            title: "Vectors",
            goal: "Describe a map by what it does to a basis.",
            prerequisites: [],
            sections: ["book/s1"],
          },
        ],
      });
    });
    expect(card()).toContain(bookShare);
    expect(outlines).toHaveBeenCalledTimes(1);

    await act(async () => {
      drop(new File(["Appendix"], appendix.name));
      emit({
        type: "source_converting",
        attachment: appendix.id,
        name: appendix.name,
      });
    });
    expect(outlines).toHaveBeenCalledTimes(1);

    await act(async () => emit(attached(appendix)));
    expect(card()).toContain(bookShare);
    expect(card()).not.toContain(appendixShare);
    expect(host.textContent).toContain("The record was busy. Trying again…");
    expect(outlines).toHaveBeenCalledTimes(2);

    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(card()).toContain(bookShare);
    expect(card()).toContain(appendixShare);
    expect(host.textContent).not.toContain("The record was busy.");
    expect(outlines).toHaveBeenCalledTimes(3);

    await act(async () =>
      emit(
        attached({ ...book, id: "notes", title: "Notes", name: "notes.md" }),
      ),
    );
    expect(host.textContent).toContain(
      "The course's source outlines could not be loaded: No such course.",
    );
    expect(host.textContent).not.toContain("Trying again…");
    await act(async () => vi.advanceTimersByTimeAsync(15_000));
    expect(outlines).toHaveBeenCalledTimes(4);
  } finally {
    try {
      await close();
    } finally {
      vi.useRealTimers();
    }
  }
});
