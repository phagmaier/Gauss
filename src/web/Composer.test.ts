// @vitest-environment happy-dom

import { createElement, createRef } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { expect, test } from "vitest";
import { Composer, type ComposerHandle } from "./Composer.tsx";

test("Enter carried over from an aid does not send the draft until a fresh press", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const ref = createRef<ComposerHandle>();
  const sent: string[] = [];

  try {
    flushSync(() => {
      root.render(
        createElement(Composer, {
          ref,
          enabled: true,
          busy: false,
          placeholder: "Message the tutor",
          onSend: async (text) => {
            sent.push(text);
            return undefined;
          },
          onStop: () => undefined,
        }),
      );
    });
    ref.current?.ask("Why is the slope 2?");
    const box = host.querySelector("textarea");
    if (box === null) throw new Error("Composer did not render a message box.");
    const enter = (repeat: boolean) =>
      box.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "Enter",
          repeat,
        }),
      );

    expect(enter(true)).toBe(false);
    expect(sent).toEqual([]);
    enter(false);
    expect(sent).toEqual(["Why is the slope 2?"]);
  } finally {
    await Promise.resolve();
    root.unmount();
    host.remove();
  }
});
