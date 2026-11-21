import { expect, test } from "vitest";
import { errorMessage, frameReport, withAsk } from "./artifact.ts";

const REPORT = {
  gauss: "artifact",
  type: "error",
  message: "Uncaught TypeError: points is undefined",
  line: 12,
  column: 5,
} as const;
const ASK = {
  gauss: "artifact",
  type: "ask",
  text: "Why is the tangent's slope 2.40 at x = 1.20?",
} as const;

// Windows stand in as distinct objects: the check is which one sent it.
const shown = {} as Window;
const before = {} as Window;
const page = {} as Window;

test("a report or a question is taken only from the frame the pane shows, and only in a report's shape", () => {
  expect(frameReport({ source: shown, data: REPORT }, shown)).toEqual(REPORT);
  expect(frameReport({ source: shown, data: ASK }, shown)).toEqual(ASK);

  // The same from anything else: a frame shown before, the page itself, a
  // message with no window, or with no frame shown.
  for (const data of [REPORT, ASK]) {
    expect(frameReport({ source: before, data }, shown)).toBeUndefined();
    expect(frameReport({ source: page, data }, shown)).toBeUndefined();
    expect(frameReport({ source: null, data }, shown)).toBeUndefined();
    expect(frameReport({ source: null, data }, null)).toBeUndefined();
    expect(frameReport({ source: shown, data }, undefined)).toBeUndefined();
  }

  // From the frame, but not a report: a question with no text, a blank one,
  // or one past its limit, which only an aid posting by itself can send.
  for (const data of [
    "Uncaught TypeError",
    { ...REPORT, gauss: "other" },
    { ...REPORT, line: "12" },
    { ...REPORT, type: "ask" },
    { ...ASK, text: "  " },
    { ...ASK, text: "x".repeat(501) },
    { ...ASK, text: 12 },
  ]) {
    expect(frameReport({ source: shown, data }, shown)).toBeUndefined();
  }
  expect(
    frameReport(
      { source: shown, data: { ...ASK, text: "x".repeat(500) } },
      shown,
    ),
  ).toEqual({ ...ASK, text: "x".repeat(500) });
});

test("an aid's question goes after the learner's draft, once", () => {
  const question = "Why is the tangent's slope 2.40 at x = 1.20?";
  expect(withAsk("", question)).toBe(question);
  expect(withAsk(" \n", question)).toBe(question);
  expect(withAsk("I see the point move.\n", question)).toBe(
    `I see the point move.\n\n${question}`,
  );
  // Pressed again, the box keeps what it has, the learner's spaces too.
  const once = `I see the point move.\n\n${question}`;
  expect(withAsk(`${once} `, question)).toBe(`${once} `);
  // Another question, from the slider moved, goes after the first.
  expect(withAsk(once, "Why is the tangent's slope 0.00 at x = 0.00?")).toBe(
    `${once}\n\nWhy is the tangent's slope 0.00 at x = 0.00?`,
  );
});

test("the message to the tutor names the aid and where it stopped, with the error's text, cut at its limit", () => {
  const artifact = { file: "3-the-tangent.html", title: "The tangent" };

  expect(errorMessage(artifact, REPORT)).toBe(
    'Artifact 3, "The tangent", stopped with an error at line 12, column 5. ' +
      "Please show it again, mended.\n\n" +
      "Uncaught TypeError: points is undefined",
  );

  // A rejected promise has no place; an aid can post any length itself.
  const long = errorMessage(artifact, {
    ...REPORT,
    message: `Uncaught (in promise) ${"x".repeat(5000)}`,
    line: 0,
    column: 0,
  });
  expect(long).toBe(
    'Artifact 3, "The tangent", stopped with an error. ' +
      "Please show it again, mended.\n\n" +
      `Uncaught (in promise) ${"x".repeat(2000 - 22)}`,
  );
});
