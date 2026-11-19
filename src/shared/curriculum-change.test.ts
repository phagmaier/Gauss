import { expect, test } from "vitest";
import { compareUnits } from "./curriculum-change.ts";

const A = { id: "a", title: "A", goal: "Do A.", prerequisites: [] };
const B = { id: "b", title: "B", goal: "Do B.", prerequisites: ["a"] };
const C = { id: "c", title: "C", goal: "Do C.", prerequisites: ["b"] };

test("marks additions and edits and lists dropped units in their old order", () => {
  const added = { id: "d", title: "D", goal: "Do D.", prerequisites: [] };
  const { marks, dropped } = compareUnits(
    [A, B, C],
    [added, { ...A, goal: "Do A well." }],
  );
  expect([...marks]).toEqual([
    ["d", "New"],
    ["a", "Changed"],
  ]);
  expect(dropped).toEqual([B, C]);
});

test("marks reordered units without treating an insertion as a move", () => {
  expect([...compareUnits([A, B], [B, A]).marks]).toEqual([
    ["b", "Moved"],
    ["a", "Moved"],
  ]);
  const added = { id: "d", title: "D", goal: "Do D.", prerequisites: [] };
  expect([...compareUnits([A, B, C], [A, added, B, C]).marks]).toEqual([
    ["d", "New"],
  ]);
});
