import { expect, test } from "vitest";
import type { Unit } from "../shared/curriculum.ts";
import { layOut, NODE_WIDTH } from "./diagram.ts";

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
    matrices: [1, 24],
    subspaces: [1, 76],
    eigen: [2, 24],
    orthogonality: [2, 76],
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
    b: [1, 24],
    c: [1, 76],
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
    subspaces: [1, 24],
    orthogonality: [2, 24],
    eigen: [2, 76],
    spectral: [3, 50],
  });
  const long = layout.edges.find(
    (e) => e.from.unit.id === "vectors" && e.to.unit.id === "eigen",
  );
  expect(long?.via).toEqual([76]);
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

test.each([2, 8, 20])(
  "edges stay attached and distinct with %i dependents and prerequisites",
  (count) => {
    const topics = Array.from({ length: count }, (_, i) =>
      unit(`topic-${i + 1}`, ["foundation"]),
    );
    const { edges } = layOut([
      unit("foundation"),
      ...topics,
      unit(
        "capstone",
        topics.map((u) => u.id),
      ),
    ]);

    // Every port must be inside its node, even when many lines leave or
    // arrive at the same unit.
    const half = NODE_WIDTH / 2;
    for (const edge of edges) {
      expect(edge.x1).toBeGreaterThan(edge.from.x - half);
      expect(edge.x1).toBeLessThan(edge.from.x + half);
      expect(edge.x2).toBeGreaterThan(edge.to.x - half);
      expect(edge.x2).toBeLessThan(edge.to.x + half);
    }
    const outgoing = edges.filter((e) => e.from.unit.id === "foundation");
    const incoming = edges.filter((e) => e.to.unit.id === "capstone");
    expect(new Set(outgoing.map((e) => e.x1)).size).toBe(count);
    expect(new Set(incoming.map((e) => e.x2)).size).toBe(count);
  },
);

test("lines crossing the rows of a large course stay apart, in the gap, in one order", () => {
  // Two chains side by side fill rows 1 to 3 in pairs; eight late units
  // build on units at the top, so their lines cross those rows through the
  // gap, more of them than fit at the widest spacing.
  const top = ["a", "x", "b", "y"];
  const units = [
    unit("a"),
    unit("x"),
    unit("b", ["a"]),
    unit("y", ["x"]),
    unit("c", ["b"]),
    unit("z", ["y"]),
    unit("d", ["c"]),
    unit("w", ["z"]),
    ...Array.from({ length: 8 }, (_, k) =>
      unit(`late${k + 1}`, [top[k % 4] ?? "a", "d"]),
    ),
  ];
  const { nodes, edges, rows } = layOut(units);
  const crossing = (row: number) =>
    edges
      .filter((e) => e.from.row < row && row < e.to.row)
      .map((e) => ({ e, x: e.via[row - e.from.row - 1] ?? Number.NaN }));

  let busiest = 0;
  for (let row = 1; row < rows; row++) {
    const lines = crossing(row);
    busiest = Math.max(busiest, lines.length);
    expect(new Set(lines.map((l) => l.x)).size).toBe(lines.length);
    const pair = nodes.filter((n) => n.row === row).map((n) => n.x);
    if (pair.length === 2) {
      for (const { x } of lines) {
        expect(x).toBeGreaterThan(Math.min(...pair) + NODE_WIDTH / 2);
        expect(x).toBeLessThan(Math.max(...pair) - NODE_WIDTH / 2);
      }
    }
    // A line that crosses this row and the one above keeps its place
    // among the others, so none cross each other between the rows.
    const both = crossing(row - 1).filter((l) =>
      lines.some((m) => m.e === l.e),
    );
    const order = (ls: { e: unknown; x: number }[]) =>
      ls.toSorted((p, q) => p.x - q.x).map((l) => l.e);
    expect(order(lines).filter((e) => both.some((l) => l.e === e))).toEqual(
      order(both),
    );
  }
  expect(busiest).toBeGreaterThanOrEqual(8);
});
