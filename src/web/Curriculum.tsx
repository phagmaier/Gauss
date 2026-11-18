// A curriculum shown two ways, as settled in docs/prototype/07-course.html
// and 08-intake.html: the unit list, and the diagram in the side pane. Both
// are drawn from the units as stored, so they cannot disagree with the record.

import type { CSSProperties, ReactNode } from "react";
import type { Unit } from "../shared/curriculum.ts";
import { type DiagramEdge, layOut } from "./diagram.ts";
import { buildsOn } from "./units.ts";

/** A short word at a unit's right, such as "Changed", and any lines under it. */
export interface UnitMark {
  text: string;
  className: string;
  under?: { text: string; className: string }[];
}

export function UnitList<U extends Unit>(props: {
  units: U[];
  mark?: (unit: U) => UnitMark | undefined;
  /** A class for the unit's row, for where it stands (task 2.12). */
  state?: (unit: U) => string;
  /** The unit marked in the diagram, if any. */
  selected?: string | undefined;
  /** What the learner can do with a unit, under its goal. */
  action?: ((unit: U) => ReactNode) | undefined;
  /** Anything under that line, such as a question before starting. */
  after?: (unit: U) => ReactNode;
}) {
  const { units } = props;
  return (
    <ol className="cu">
      {units.map((unit, i) => {
        const needs = buildsOn(unit, units);
        const mark = props.mark?.(unit);
        const action = props.action?.(unit);
        const className = [
          "cu-row",
          props.state?.(unit),
          props.selected === unit.id ? "sel" : undefined,
        ]
          .filter(Boolean)
          .join(" ");
        return (
          <li key={unit.id} id={`unit-${unit.id}`} className={className}>
            <span className="cu-n">{i + 1}</span>
            <div>
              <div className="cu-t">{unit.title}</div>
              <div className="cu-g">{unit.goal}</div>
              {needs === null && action == null ? null : (
                <div className="cu-m">
                  {needs === null ? null : <span>{needs}</span>}
                  {action}
                </div>
              )}
              {props.after?.(unit)}
            </div>
            <span className={`cu-s ${mark?.className ?? ""}`}>
              {mark?.text}
              {mark?.under?.map((line) => (
                <small key={line.text} className={line.className}>
                  {line.text}
                </small>
              ))}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** Row spacing and node height, in pixels, as in the mocks. */
const PITCH = 100;
const NODE = 58;

/**
 * A line from the bottom of one unit to the top of another: a curve across
 * each gap between rows, straight down through each row it crosses.
 */
function linePath(e: DiagramEdge): string {
  const xs = [e.x1, ...e.via, e.x2];
  let d = `M${e.x1} ${e.from.row * PITCH + NODE}`;
  for (let k = 1; k < xs.length; k++) {
    const row = e.from.row + k;
    const [x0, x] = [xs[k - 1] ?? e.x1, xs[k] ?? e.x2];
    const y0 = (row - 1) * PITCH + NODE;
    const y = row * PITCH;
    const ym = (y0 + y) / 2;
    d += ` C${x0} ${ym} ${x} ${ym} ${x} ${y}`;
    if (k < xs.length - 1) d += ` L${x} ${y + NODE}`;
  }
  return d;
}

export function Diagram(props: {
  units: Unit[];
  /** Units whose node says "Changed". */
  changed?: Set<string>;
  /** Where each unit stands, by its id: its node's class, and the word under its title. */
  standing?: (unitId: string) => { state: string; text: string };
  selected?: string | undefined;
  /** Makes the nodes buttons that mark their unit. */
  onSelect?: (id: string) => void;
}) {
  const { nodes, edges, rows } = layOut(props.units);
  const height = Math.max(rows - 1, 0) * PITCH + NODE;
  return (
    <div className="dg" style={{ height }}>
      <svg
        viewBox={`0 0 100 ${height}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        {edges.map((e) => (
          <path
            key={`${e.from.unit.id}>${e.to.unit.id}`}
            vectorEffect="non-scaling-stroke"
            d={linePath(e)}
          />
        ))}
      </svg>
      {nodes.map((n) => {
        const changed = props.changed?.has(n.unit.id) === true;
        const standing = props.standing?.(n.unit.id);
        const className = [
          "dn",
          standing?.state,
          changed ? "chg" : undefined,
          props.selected === n.unit.id ? "sel" : undefined,
        ]
          .filter(Boolean)
          .join(" ");
        const style: CSSProperties = {
          left: `${n.x - 23}%`,
          top: n.row * PITCH,
        };
        const text = changed ? "Changed" : standing?.text;
        const content = (
          <>
            <b>{n.index + 1}</b>
            <span className="t">{n.unit.title}</span>
            {text ? <small>{text}</small> : null}
          </>
        );
        const { onSelect } = props;
        return onSelect === undefined ? (
          <div
            key={n.unit.id}
            className={className}
            style={style}
            title={n.unit.title}
          >
            {content}
          </div>
        ) : (
          <button
            key={n.unit.id}
            type="button"
            className={className}
            style={style}
            title={n.unit.title}
            onClick={() => onSelect(n.unit.id)}
          >
            {content}
          </button>
        );
      })}
    </div>
  );
}
