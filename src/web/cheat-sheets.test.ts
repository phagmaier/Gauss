import { expect, test } from "vitest";
import {
  notPickable,
  numbered,
  sheetUnits,
  unitRuns,
  writeSays,
} from "./cheat-sheets.ts";

test.each([
  [[2], "Unit 2"],
  [[2, 3], "Units 2 and 3"],
  [[1, 2, 3, 4], "Units 1 to 4"],
  [[1, 3, 5, 6, 7, 8], "Units 1, 3 and 5 to 8"],
  [[1, 2, 4, 5], "Units 1, 2, 4 and 5"],
  [[2, 4, 9], "Units 2, 4 and 9"],
])("%o reads %s", (numbers, says) => {
  expect(unitRuns(numbers)).toBe(says);
});

const units = numbered(
  [
    "Functions",
    "Limits",
    "Continuity",
    "The derivative",
    "Rules",
    "Chains",
  ].map((title, at) => ({ id: `u${at + 1}`, title })),
);

test("a sheet names its units in course order, whatever order it lists them in", () => {
  expect(sheetUnits(["u3", "u2"], units)).toEqual({
    words: "Units 2 and 3",
    titles: "Limits, Continuity",
  });
});

test("the units not finished are named, or nothing when all are", () => {
  expect(notPickable(units, ["u1", "u2", "u3", "u4"])).toBe(
    "Units 5 and 6 are not finished, so they cannot be picked.",
  );
  expect(notPickable(units, ["u1", "u2", "u3", "u4", "u5"])).toBe(
    "Unit 6 is not finished, so it cannot be picked.",
  );
  expect(notPickable(units, ["u2", "u4", "u5", "u6"])).toBe(
    "Units 1 and 3 are not finished, so they cannot be picked.",
  );
  expect(
    notPickable(
      units,
      units.map((u) => u.id),
    ),
  ).toBeUndefined();
});

test("the line beside Write: a pick, its pages, or why Write waits", () => {
  expect(writeSays([], false)).toBe("Pick at least one unit.");
  expect(writeSays([2, 3], false)).toBe("Units 2 and 3: one printed page.");
  expect(writeSays([1, 2, 3, 4, 5, 6], false)).toBe(
    "Units 1 to 6: one printed page.",
  );
  expect(writeSays([1, 2, 3, 4, 5, 6, 8], false)).toBe(
    "Units 1 to 6 and 8: two printed pages at most.",
  );
  expect(writeSays([2], true)).toBe(
    "One sheet is written at a time: write another once this one is done.",
  );
});
