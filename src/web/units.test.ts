import { expect, test } from "vitest";
import { changedUnits, type Unit } from "../shared/curriculum.ts";
import { buildsOn } from "./units.ts";

const unit = (id: string, prerequisites: string[] = []): Unit => ({
  id,
  title: `The ${id}`,
  goal: `Learn ${id}.`,
  prerequisites,
});

test.each([
  { prerequisites: [], says: null },
  { prerequisites: ["c"], says: "Builds on unit 3" },
  { prerequisites: ["c", "a"], says: "Builds on units 1 and 3" },
  { prerequisites: ["b", "d", "a"], says: "Builds on units 1, 2 and 4" },
])("prerequisites $prerequisites read: $says", ({ prerequisites, says }) => {
  const units = [unit("a"), unit("b"), unit("c"), unit("d")];

  expect(buildsOn(unit("e", prerequisites), units)).toBe(says);
});

test("a revision changes the units that are new or whose title, goal or prerequisites differ, matched by id", () => {
  const before = [unit("a"), unit("b", ["a"]), unit("c", ["b"]), unit("d")];
  const after = [
    { ...unit("a"), title: "A shorter start" },
    unit("c", ["a"]),
    unit("d"),
    unit("e", ["d"]),
    { ...unit("b", ["a"]), goal: "Learn b well." },
  ];

  expect(changedUnits(after, before)).toEqual(new Set(["a", "c", "e", "b"]));
  expect(changedUnits(after, undefined)).toEqual(new Set());
});
