// A curriculum shown two ways, as settled in docs/prototype/07-course.html
// and 08-intake.html: the unit list, and the diagram in the side pane. Both
// are drawn from the units as stored, so they cannot disagree with the record.

import {
  type CSSProperties,
  type ReactNode,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { type Unit, unitSections } from "../shared/curriculum.ts";
import type { Outline } from "../shared/source.ts";
import {
  type DiagramEdge,
  type Layout,
  layOut,
  linesShown,
  NODE_WIDTH,
} from "./diagram.ts";
import { type ReadsLine, sourceShare, unitReads } from "./reads.ts";
import { type FormOf, StatusForm } from "./StatusForm.tsx";
import { buildsOn } from "./units.ts";

/** A short word at a unit's right, such as "Changed". */
export interface UnitMark {
  text: string;
  className: string;
}

export function UnitList<U extends Unit>(props: {
  units: U[];
  mark?: (unit: U) => UnitMark | undefined;
  /** The unit marked in the diagram, if any. */
  selected?: string | undefined;
  /** The course's sources: with them, each unit lists what it reads. */
  sources?: readonly Outline[] | undefined;
  onOutline?(source: string, unit: string): void;
}) {
  const { units, sources } = props;
  return (
    <ol className="cu">
      {units.map((unit, i) => {
        const needs = buildsOn(unit, units);
        const mark = props.mark?.(unit);
        return (
          <li
            key={unit.id}
            id={`unit-${unit.id}`}
            className={props.selected === unit.id ? "cu-row sel" : "cu-row"}
          >
            <span className="cu-n">{i + 1}</span>
            <div>
              <div className="cu-t">{unit.title}</div>
              <div className="cu-g">{unit.goal}</div>
              <UnitReadLines
                unit={unit}
                sources={sources}
                onOutline={props.onOutline}
              />
              {needs === null ? null : (
                <div className="cu-m">
                  <span>{needs}</span>
                </div>
              )}
            </div>
            <span className={`cu-s ${mark?.className ?? ""}`}>
              {mark?.text}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** Cards fold longer lists; the course shows every line as an outline link. */
export function UnitReadLines(props: {
  unit: Unit;
  sources: readonly Outline[] | undefined;
  onOutline?: ((source: string, unit: string) => void) | undefined;
}) {
  const { unit, sources, onOutline } = props;
  const [unfolded, setUnfolded] = useState(false);
  const reads = useMemo(
    () =>
      sources === undefined || unitSections(unit).length === 0
        ? undefined
        : unitReads(unit, sources),
    [unit, sources],
  );
  if (reads === undefined) return null;
  const folded = onOutline === undefined ? reads.folded : undefined;
  return (
    <div className="reads">
      <span className="reads-k">Reads</span>
      <ul>
        {folded !== undefined && !unfolded ? (
          <ReadsItem line={folded}>
            <button
              type="button"
              className="textbtn"
              onClick={() => setUnfolded(true)}
            >
              Show them
            </button>
          </ReadsItem>
        ) : (
          reads.lines.map((line, i) => {
            const { source } = line;
            return (
              <ReadsItem
                // biome-ignore lint/suspicious/noArrayIndexKey: a unit can name a section twice
                key={i}
                line={line}
                onOpen={
                  source !== undefined && onOutline !== undefined
                    ? () => onOutline(source, unit.id)
                    : undefined
                }
              >
                {folded !== undefined && i === reads.lines.length - 1 ? (
                  <button
                    type="button"
                    className="textbtn"
                    onClick={() => setUnfolded(false)}
                  >
                    Fold
                  </button>
                ) : null}
              </ReadsItem>
            );
          })
        )}
      </ul>
    </div>
  );
}

function ReadsItem(props: {
  line: ReadsLine;
  children?: ReactNode;
  onOpen?: (() => void) | undefined;
}) {
  const { line } = props;
  return (
    <li>
      {props.onOpen === undefined ? (
        line.text
      ) : (
        <button type="button" className="reads-outline" onClick={props.onOpen}>
          {line.text}
        </button>
      )}
      {line.place === undefined ? null : (
        <span className="reads-pl">{line.place}</span>
      )}
      {props.children}
    </li>
  );
}

/**
 * A card's section saying how much of each source its units read, when the
 * sources are loaded and a unit names a section.
 */
export function SourceShare(props: {
  units: readonly Unit[];
  sources: readonly Outline[] | undefined;
}) {
  const { sources } = props;
  const sentences =
    sources === undefined ? [] : sourceShare(props.units, sources);
  if (sources === undefined || sentences.length === 0) return null;
  const label = sources.length === 1 ? "From the source" : "From the sources";
  return (
    <section className="cs" aria-label={label}>
      <div className="cs-h">
        <span>{label}</span>
      </div>
      {sentences.map((sentence) => (
        <p key={sentence.source} className="cs-t">
          {sentence.before}
          <i>{sentence.title}</i>
          {sentence.after}
        </p>
      ))}
    </section>
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

interface DiagramProps {
  units: Unit[];
  /** Units whose node carries a word, such as "Changed", by id. */
  marks?: ReadonlyMap<string, string>;
  /**
   * Where each unit stands, by its id: its node's class, its status form,
   * and the word under its title.
   */
  standing?: (unitId: string) => {
    state: string;
    text: string;
    form?: FormOf;
  };
  selected?: string | undefined;
  /** Makes the nodes buttons that mark their unit. */
  onSelect?: (id: string) => void;
  /**
   * The unit the learner is in: scrolled into view when the diagram or the
   * list first shows, its lines shown and lit while no other is picked.
   */
  here?: string;
}

export function Diagram(props: DiagramProps) {
  const { units } = props;
  const layout = useMemo(() => layOut(units), [units]);
  const pane = useRef<HTMLDivElement>(null);
  const [list, setList] = useState(false);
  const { minWidth } = layout;
  useLayoutEffect(() => {
    const element = pane.current;
    if (element === null) return;
    setList(element.getBoundingClientRect().width < minWidth);
    if (minWidth === 0) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry !== undefined) setList(entry.contentRect.width < minWidth);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [minWidth]);
  const { here } = props;
  // biome-ignore lint/correctness/useExhaustiveDependencies: again once the diagram turns into the list
  useLayoutEffect(() => {
    if (here === undefined) return;
    pane.current
      ?.querySelector(`[data-unit="${CSS.escape(here)}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [here, list]);
  // A crowded diagram shows long lines only for the unit picked, so one whose
  // parent does no picking (a proposal's) picks for itself.
  const [ownPick, setOwnPick] = useState<string>();
  const picking =
    props.onSelect === undefined && layout.longLines !== undefined
      ? { selected: ownPick, onSelect: setOwnPick }
      : {};

  return (
    <div className="diagram" ref={pane}>
      {list ? (
        <PrerequisiteList {...props} />
      ) : (
        drawDiagram({ ...props, ...picking }, layout)
      )}
    </div>
  );
}

function PrerequisiteList({
  units,
  marks,
  standing,
  selected,
  onSelect,
}: DiagramProps) {
  return (
    <>
      <p className="qa-aside">
        The lines are too close together in this pane. Prerequisites are listed
        by unit number instead.
      </p>
      <ol className="diagram-units">
        {units.map((unit) => {
          const needs = buildsOn(unit, units);
          const mark = marks?.get(unit.id);
          const status = standing?.(unit.id);
          const label = mark ?? status?.text;
          const form =
            mark === undefined && status?.form !== undefined ? (
              <StatusForm {...status.form} />
            ) : null;
          return (
            <li
              key={unit.id}
              data-unit={unit.id}
              className={
                unit.id === selected ? "diagram-unit sel" : "diagram-unit"
              }
            >
              {form}
              {onSelect === undefined ? (
                <span>{unit.title}</span>
              ) : (
                <button
                  className="textbtn"
                  type="button"
                  onClick={() => onSelect(unit.id)}
                >
                  {unit.title}
                </button>
              )}
              {label ? (
                <span
                  className={`diagram-status cu-s ${mark ? "chg" : (status?.state ?? "")}`}
                >
                  {label}
                </span>
              ) : null}
              {needs === null ? null : <div className="cu-m">{needs}</div>}
            </li>
          );
        })}
      </ol>
    </>
  );
}

function drawDiagram(props: DiagramProps, layout: Layout) {
  const { nodes, rows } = layout;
  const picked = props.selected ?? props.here;
  const edges = linesShown(layout, picked);
  // The picked unit's lines are drawn last, over the others, and lit.
  const touches = (e: DiagramEdge) =>
    e.from.unit.id === picked || e.to.unit.id === picked;
  const height = Math.max(rows - 1, 0) * PITCH + NODE;
  return (
    <>
      {layout.longLines === undefined ? null : (
        <p className="qa-aside">
          Lines that skip rows show only for the unit you pick.
        </p>
      )}
      <div className="dg" style={{ height }}>
        <svg
          viewBox={`0 0 100 ${height}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {[...edges.filter((e) => !touches(e)), ...edges.filter(touches)].map(
            (e) => (
              <path
                key={`${e.from.unit.id}>${e.to.unit.id}`}
                className={touches(e) ? "on" : undefined}
                vectorEffect="non-scaling-stroke"
                d={linePath(e)}
              />
            ),
          )}
        </svg>
        {nodes.map((n) => {
          const mark = props.marks?.get(n.unit.id);
          const standing = props.standing?.(n.unit.id);
          const className = [
            "dn",
            standing?.state,
            mark === undefined ? undefined : "chg",
            props.selected === n.unit.id ? "sel" : undefined,
          ]
            .filter(Boolean)
            .join(" ");
          const style: CSSProperties = {
            left: `${n.x - NODE_WIDTH / 2}%`,
            top: n.row * PITCH,
          };
          const text = mark ?? standing?.text;
          const form = mark === undefined ? standing?.form : undefined;
          const content = (
            <>
              <b>{n.index + 1}</b>
              <span className="t">{n.unit.title}</span>
              {text || form !== undefined ? (
                <small>
                  {form === undefined ? null : <StatusForm {...form} />}
                  {text}
                </small>
              ) : null}
            </>
          );
          const { onSelect } = props;
          return onSelect === undefined ? (
            <div
              key={n.unit.id}
              data-unit={n.unit.id}
              className={className}
              style={style}
              title={n.unit.title}
            >
              {content}
            </div>
          ) : (
            <button
              key={n.unit.id}
              data-unit={n.unit.id}
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
    </>
  );
}
