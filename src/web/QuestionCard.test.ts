// @vitest-environment happy-dom

import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { expect, test } from "vitest";
import type { AnswerPost, QuestionView } from "../shared/question.ts";
import { QuestionCard } from "./QuestionCard.tsx";

const MATH: QuestionView = {
  kind: "math",
  id: "q1",
  number: 1,
  prompt: "Differentiate $x^3$.",
};

/** An open card on the page, the answers it sent, and keys to press in it. */
function openCard(question: QuestionView) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const sent: AnswerPost[] = [];
  flushSync(() => {
    root.render(
      createElement(QuestionCard, {
        item: { kind: "question", key: 1, question },
        disputes: {} as never,
        onAnswer: async (submission) => {
          sent.push(submission);
          return undefined;
        },
        onGradeAgain: async () => undefined,
      }),
    );
  });
  const field = (selector: string) => {
    const found = host.querySelector(selector);
    if (!(found instanceof HTMLTextAreaElement)) {
      throw new Error(`The card has no field ${selector}.`);
    }
    return found;
  };
  const button = (label: string) => {
    const found = [...host.querySelectorAll("button")].find(
      (b) => b.textContent === label,
    );
    if (found === undefined) throw new Error(`The card has no "${label}".`);
    return found;
  };
  return {
    sent,
    field,
    button,
    press(label: string) {
      flushSync(() => button(label).click());
    },
    type(into: HTMLTextAreaElement, text: string) {
      // React reads a change through the value setter it does not track.
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set?.call(into, text);
      flushSync(() =>
        into.dispatchEvent(new Event("input", { bubbles: true })),
      );
    },
    /** Enter in a field; true when the page let the key do its default. */
    enter(into: HTMLTextAreaElement, isComposing: boolean) {
      into.focus();
      return flushSync(() =>
        into.dispatchEvent(
          new KeyboardEvent("keydown", {
            bubbles: true,
            cancelable: true,
            key: "Enter",
            isComposing,
          }),
        ),
      );
    },
    async close() {
      await Promise.resolve();
      root.unmount();
      host.remove();
    },
  };
}

test("Enter in the math field moves to how sure and submits, but not while composing", async () => {
  const card = openCard(MATH);
  try {
    const answer = card.field('textarea[aria-label="Your answer"]');
    card.type(answer, "3x^2");

    // Before how sure is picked, Enter moves to its first level. A composing
    // Enter commits the input method's text and is left to it.
    let leftToIt = card.enter(answer, true);
    expect(document.activeElement).toBe(answer);
    expect(leftToIt).toBe(true);
    card.enter(answer, false);
    expect(document.activeElement).toBe(card.button("Under 50%"));

    card.press("75%");
    leftToIt = card.enter(answer, true);
    expect(card.sent).toEqual([]);
    expect(leftToIt).toBe(true);
    card.enter(answer, false);
    expect(card.sent).toEqual([
      { kind: "math", questionId: "q1", confidence: "75", expression: "3x^2" },
    ]);
  } finally {
    await card.close();
  }
});

test('Enter where the learner got stuck sends "I don\'t know", but not while composing', async () => {
  const card = openCard(MATH);
  try {
    card.press("I don't know");
    const stuck = card.field(".qa-stuck textarea");
    card.type(stuck, "the power rule");

    const leftToIt = card.enter(stuck, true);
    expect(card.sent).toEqual([]);
    expect(leftToIt).toBe(true);
    card.enter(stuck, false);
    expect(card.sent).toEqual([
      { kind: "unknown", questionId: "q1", stuck: "the power rule" },
    ]);
  } finally {
    await card.close();
  }
});
