// Where the curriculum diagram puts each unit (docs/prototype/07-course.html):
// in rows, each unit one row below the deepest unit it builds on, at most two
// to a row, with a line from each unit to the units that build on it. Lines
// that cross a row sit side by side in it, so a large course's long lines do
// not merge into one. Pure, so the proposal card and the course view draw
// the same diagram.

import type { Unit } from "../shared/curriculum.ts";

export interface DiagramNode {
  unit: Unit;
  /** The unit's place in the curriculum's list, from 0. */
  index: number;
  row: number;
  /** The centre, in percent of the diagram's width. */
  x: number;
}

export interface DiagramEdge {
  /** The unit built on. */
  from: DiagramNode;
  /** The unit that builds on it. */
  to: DiagramNode;
  /**
   * Where the line leaves `from` and arrives at `to`, in percent. Lines that
   * share a unit sit side by side, in left-to-right order, so none merge.
   */
  x1: number;
  x2: number;
  /**
   * Where the line crosses each row between the two, in percent: beside the
   * unit in that row, or through the gap between two. Empty for adjacent rows.
   */
  via: number[];
}

export interface Layout {
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  rows: number;
  /** Pane width in CSS pixels needed for side-by-side lanes to read. */
  minWidth: number;
}

/** Two units side by side fill the width, with a gap between for lines. */
const PER_ROW = 2;
const LEFT = 24;
const MIDDLE = 50;
const RIGHT = 76;
/** A node's width in percent, as `.dn` in styles.css sets it. */
export const NODE_WIDTH = 44;
/** The maximum gap between lines that share a unit, in percent. */
const SPREAD = 8;
/** Keep ports clear of the nodes' rounded corners. */
const PORT_SPAN = NODE_WIDTH - 10;
/** The maximum gap between lines that cross a row side by side, in percent. */
const LANE = 1.5;
/** Leave visible space between the 1.5 px paths (2 px when selected). */
const LANE_PITCH_PX = 3;
/** The width lines crossing a row may spread over: the gap between a pair less a margin, or a node's place beside a lone unit. */
const GAP_ROOM = RIGHT - LEFT - NODE_WIDTH - 2;
const SIDE_ROOM = NODE_WIDTH - 10;

export function layOut(units: readonly Unit[]): Layout {
  const ids = new Set(units.map((u) => u.id));
  const rowOf = new Map<string, number>();
  const perRow: number[] = [];

  // Units in list order, each once everything it builds on is placed. The
  // curriculum schema rules out cycles, so every unit is placed.
  while (rowOf.size < units.length) {
    const next = units.find(
      (u) =>
        !rowOf.has(u.id) &&
        u.prerequisites.every((p) => rowOf.has(p) || !ids.has(p)),
    );
    if (next === undefined) break;
    let row =
      Math.max(-1, ...next.prerequisites.map((p) => rowOf.get(p) ?? -1)) + 1;
    while ((perRow[row] ?? 0) >= PER_ROW) row += 1;
    perRow[row] = (perRow[row] ?? 0) + 1;
    rowOf.set(next.id, row);
  }

  // Every line, with the rows it crosses on its way down.
  const links = units.flatMap((to) =>
    to.prerequisites.flatMap((from) => {
      const top = rowOf.get(from);
      const bottom = rowOf.get(to.id);
      return top === undefined || bottom === undefined
        ? []
        : [{ from, to: to.id, top, bottom, via: [] as number[] }];
    }),
  );

  // Row by row from the top. The x of a line crossing a row is where it was
  // in the row above. A unit alone in a row stays in the middle unless lines
  // cross the row, which then pass on one side and the unit on the other; a
  // pair takes both sides, and crossing lines pass through the gap between.
  // Sides go in the order of where things come from above; a stable sort
  // keeps the list order, and the unit before the lines, on a tie.
  const xOf = new Map<string, number>();
  const above = (link: (typeof links)[number], row: number) =>
    row - 1 === link.top
      ? (xOf.get(link.from) ?? MIDDLE)
      : (link.via.at(-1) ?? MIDDLE);
  const mean = (xs: number[]) =>
    xs.length === 0 ? MIDDLE : xs.reduce((a, b) => a + b, 0) / xs.length;
  let minWidth = 0;
  for (let row = 0; row < perRow.length; row++) {
    const inRow = units.filter((u) => rowOf.get(u.id) === row);
    const crossing = links.filter((l) => l.top < row && row < l.bottom);
    // Where a unit's lines come from: the units above, or where a line
    // that crossed rows passed the row above.
    const pull = (u: Unit) =>
      mean(links.filter((l) => l.to === u.id).map((l) => above(l, row)));
    // The crossing lines side by side around `centre`, in the order of where
    // they were in the row above, so they keep their order and none merge.
    const pass = (centre: number, room: number) => {
      const order = crossing
        .map((l) => ({ l, x: above(l, row) }))
        .sort((a, b) => a.x - b.x);
      const step = Math.min(LANE, room / Math.max(1, order.length - 1));
      if (order.length > 1) {
        minWidth = Math.max(minWidth, (LANE_PITCH_PX * 100) / step);
      }
      order.forEach(({ l }, k) => {
        l.via.push(centre + (k - (order.length - 1) / 2) * step);
      });
    };
    const [only] = inRow;
    if (inRow.length === 1 && only !== undefined && crossing.length === 0) {
      xOf.set(only.id, MIDDLE);
      continue;
    }
    if (inRow.length === 1 && only !== undefined) {
      const linesFrom = mean(crossing.map((l) => above(l, row)));
      const unitLeft = pull(only) <= linesFrom;
      xOf.set(only.id, unitLeft ? LEFT : RIGHT);
      pass(unitLeft ? RIGHT : LEFT, SIDE_ROOM);
      continue;
    }
    [...inRow]
      .map((u) => ({ id: u.id, pull: pull(u) }))
      .sort((a, b) => a.pull - b.pull)
      .forEach((u, k) => {
        xOf.set(u.id, k === 0 ? LEFT : RIGHT);
      });
    pass(MIDDLE, GAP_ROOM);
  }

  const nodes = units.flatMap((unit, index) => {
    const row = rowOf.get(unit.id);
    const x = xOf.get(unit.id);
    return row === undefined || x === undefined
      ? []
      : [{ unit, index, row, x }];
  });
  const byId = new Map(nodes.map((n) => [n.unit.id, n]));
  const offset = (k: number, n: number) =>
    (k - (n - 1) / 2) * Math.min(SPREAD, PORT_SPAN / Math.max(1, n - 1));

  // A line leaves toward its first waypoint and arrives from its last, so
  // that is the order lines sharing a unit take.
  const drawn = links.flatMap((l) => {
    const from = byId.get(l.from);
    const to = byId.get(l.to);
    return from === undefined || to === undefined
      ? []
      : [{ from, to, via: l.via }];
  });
  const leaving = (e: (typeof drawn)[number]) => e.via[0] ?? e.to.x;
  const arriving = (e: (typeof drawn)[number]) => e.via.at(-1) ?? e.from.x;
  const edges = drawn.map((e) => {
    const out = drawn
      .filter((d) => d.from === e.from)
      .sort((a, b) => leaving(a) - leaving(b) || a.to.index - b.to.index);
    const into = drawn
      .filter((d) => d.to === e.to)
      .sort((a, b) => arriving(a) - arriving(b) || a.from.index - b.from.index);
    return {
      ...e,
      x1: e.from.x + offset(out.indexOf(e), out.length),
      x2: e.to.x + offset(into.indexOf(e), into.length),
    };
  });

  return { nodes, edges, rows: perRow.length, minWidth };
}
