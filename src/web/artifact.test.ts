import { expect, test } from "vitest";
import { errorMessage, frameReport } from "./artifact.ts";

const REPORT = {
  gauss: "artifact",
  type: "error",
  message: "Uncaught TypeError: points is undefined",
  line: 12,
  column: 5,
} as const;

// Windows stand in as distinct objects: the check is which one sent it.
const shown = {} as Window;
const before = {} as Window;
const page = {} as Window;

test("a report is taken only from the frame the pane shows, and only in the report's shape", () => {
  expect(frameReport({ source: shown, data: REPORT }, shown)).toEqual(REPORT);

  // The same report from anything else: a frame shown before, the page
  // itself, a message with no window, or with no frame shown.
  expect(frameReport({ source: before, data: REPORT }, shown)).toBeUndefined();
  expect(frameReport({ source: page, data: REPORT }, shown)).toBeUndefined();
  expect(frameReport({ source: null, data: REPORT }, shown)).toBeUndefined();
  expect(frameReport({ source: null, data: REPORT }, null)).toBeUndefined();
  expect(
    frameReport({ source: shown, data: REPORT }, undefined),
  ).toBeUndefined();

  // From the frame, but not a report.
  for (const data of [
    "Uncaught TypeError",
    { ...REPORT, gauss: "other" },
    { ...REPORT, line: "12" },
    { ...REPORT, type: "ask" },
  ]) {
    expect(frameReport({ source: shown, data }, shown)).toBeUndefined();
  }
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
