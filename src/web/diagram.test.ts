import { expect, test } from "vitest";
import type { Unit } from "../shared/curriculum.ts";
import { layOut } from "./diagram.ts";

const unit = (id: string, prerequisites: string[] = []): Unit => ({
  id,
  title: id,
  goal: `Learn ${id}.`,
  prerequisites,
});

const place = (units: Unit[]) =>
  Object.fromEntries(layOut(units).nodes.map((n) => [n.unit.id, [n.row, n.x]]));

test("units sit one row below the deepest unit they build on, and a pair is ordered by where its prerequisites are", () => {
  // Prototype 8's first proposal, worked by hand: eigen builds on matrices
  // and subspaces (columns 25 and 75, so 50 on average) and orthogonality on
  // subspaces alone (75), so eigen goes left.
  const units = [
    unit("vectors"),
    unit("matrices", ["vectors"]),
    unit("subspaces", ["vectors"]),
    unit("orthogonality", ["subspaces"]),
    unit("eigen", ["matrices", "subspaces"]),
    unit("spectral", ["orthogonality", "eigen"]),
    unit("pca", ["spectral"]),
  ];

  expect(place(units)).toEqual({
    vectors: [0, 50],
    matrices: [1, 25],
    subspaces: [1, 75],
    eigen: [2, 25],
    orthogonality: [2, 75],
    spectral: [3, 50],
    pca: [4, 50],
  });
  const layout = layOut(units);
  expect(layout.rows).toBe(5);
  expect(layout.edges.map((e) => [e.from.unit.id, e.to.unit.id])).toEqual([
    ["vectors", "matrices"],
    ["vectors", "subspaces"],
    ["subspaces", "orthogonality"],
    ["matrices", "eigen"],
    ["subspaces", "eigen"],
    ["orthogonality", "spectral"],
    ["eigen", "spectral"],
    ["spectral", "pca"],
  ]);
});

test("a row holds two units, so more units at one depth go further down, in list order", () => {
  const units = [
    unit("a"),
    unit("b", ["a"]),
    unit("c", ["a"]),
    unit("d", ["a"]),
    unit("e", ["d"]),
  ];

  expect(place(units)).toEqual({
    a: [0, 50],
    b: [1, 25],
    c: [1, 75],
    d: [2, 50],
    e: [3, 50],
  });
});

test("a unit listed before its prerequisite is still placed below it", () => {
  expect(place([unit("later", ["first"]), unit("first")])).toEqual({
    first: [0, 50],
    later: [1, 50],
  });
});

test("a line that skips a row passes beside the unit in it, not behind it", () => {
  // Prototype 8's revision: eigen builds on vectors (row 0) and subspaces
  // (row 1), so its line from vectors crosses row 1. Subspaces moves left to
  // let it pass on the right, and eigen sits below where it passed.
  const units = [
    unit("vectors"),
    unit("subspaces", ["vectors"]),
    unit("orthogonality", ["subspaces"]),
    unit("eigen", ["vectors", "subspaces"]),
    unit("spectral", ["orthogonality", "eigen"]),
  ];
  const layout = layOut(units);

  expect(place(units)).toEqual({
    vectors: [0, 50],
    subspaces: [1, 25],
    orthogonality: [2, 25],
    eigen: [2, 75],
    spectral: [3, 50],
  });
  const long = layout.edges.find(
    (e) => e.from.unit.id === "vectors" && e.to.unit.id === "eigen",
  );
  expect(long?.via).toEqual([75]);
  expect(layout.edges.filter((e) => e !== long).map((e) => e.via)).toEqual([
    [],
    [],
    [],
    [],
    [],
  ]);
});

test("between two units in a row, a line passes through the gap in the middle", () => {
  const units = [
    unit("a"),
    unit("b", ["a"]),
    unit("c", ["a"]),
    unit("d", ["a", "b"]),
  ];

  expect(
    layOut(units).edges.find(
      (e) => e.to.unit.id === "d" && e.from.unit.id === "a",
    )?.via,
  ).toEqual([50]);
});
