import { expect, test } from "vitest";
import { compareUnits } from "./curriculum-change.ts";

const A = { id: "a", title: "A", goal: "Do A.", prerequisites: [] };
const B = { id: "b", title: "B", goal: "Do B.", prerequisites: ["a"] };
const C = { id: "c", title: "C", goal: "Do C.", prerequisites: ["b"] };

test("marks a new unit New and an edited one Changed, leaves a moved one unmarked, and lists the dropped in their old order", () => {
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

  const moved = compareUnits([A, B], [B, A]);
  expect(moved.marks.size).toBe(0);
  expect(moved.dropped).toEqual([]);
});
