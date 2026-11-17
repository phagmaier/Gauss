import { expect, test } from "vitest";
import type { Calibration } from "../shared/calibration.ts";
import { calibrationRows, hasCalibration } from "./calibration.ts";

// Expected lines written by hand from the task (plans 2.27 and 2.29):
// counts, as "8 of 10", for each level lowest first, then "I don't know"
// apart.

const counted = (
  answered: [number, number, number, number, number],
  correct: [number, number, number, number, number],
  unknown: number,
): Calibration => ({
  levels: (["under-50", "50", "75", "90", "100"] as const).map(
    (confidence, i) => ({
      confidence,
      answered: answered[i] ?? 0,
      correct: correct[i] ?? 0,
    }),
  ),
  unknown,
});

test("each level says how many of its answers were correct, and I don't know how many questions it was", () => {
  expect(
    calibrationRows(counted([4, 0, 1, 10, 3], [1, 0, 1, 8, 3], 3)),
  ).toEqual([
    { label: "Under 50%", text: "1 of 4 correct" },
    { label: "50%", text: "None yet" },
    { label: "75%", text: "1 of 1 correct" },
    { label: "90%", text: "8 of 10 correct" },
    { label: "100%", text: "3 of 3 correct" },
    { label: "I don't know", text: "3 questions" },
  ]);
  expect(
    calibrationRows(counted([0, 0, 0, 2, 0], [0, 0, 0, 0, 0], 1)).at(-1),
  ).toEqual({ label: "I don't know", text: "1 question" });
  expect(
    calibrationRows(counted([0, 0, 0, 2, 0], [0, 0, 0, 0, 0], 0)).at(-1),
  ).toEqual({ label: "I don't know", text: "None yet" });
});

test("the counts are shown once there is an answer, or an I don't know", () => {
  expect(hasCalibration(counted([0, 0, 0, 0, 0], [0, 0, 0, 0, 0], 0))).toBe(
    false,
  );
  expect(hasCalibration(counted([0, 0, 0, 0, 0], [0, 0, 0, 0, 0], 1))).toBe(
    true,
  );
  expect(hasCalibration(counted([0, 1, 0, 0, 0], [0, 0, 0, 0, 0], 0))).toBe(
    true,
  );
});
