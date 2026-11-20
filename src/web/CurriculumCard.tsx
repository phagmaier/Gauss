// The card of the tutor's proposed curriculum change (task 5.12): why, the
// units as they would be with new, edited and moved units marked and the
// dropped ones listed, the diagram in the side pane, Apply and "Keep the
// current one"; once answered, a record of the answer. Built from the
// intake card's parts and the style card's foot, since no piece draws it
// (docs/decisions.md, "Page design").

import { Fragment, useState } from "react";
import { compareUnits } from "../shared/curriculum-change.ts";
import type { CurriculumItem } from "../shared/timeline.ts";
import { UnitList } from "./Curriculum.tsx";

export function CurriculumCard(props: {
  item: CurriculumItem;
  /** Its diagram is the one in the side pane. */
  diagramOpen: boolean;
  onToggleDiagram(): void;
  onApply(): Promise<string | undefined>;
  onKeep(): Promise<string | undefined>;
}) {
  const { item } = props;
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<string>();
  const { marks, dropped } = compareUnits(item.was, item.units);
  const units = (
    <>
      <UnitList
        units={item.units}
        mark={(unit) => {
          const mark = marks.get(unit.id);
          return mark === undefined
            ? undefined
            : { text: mark, className: "chg" };
        }}
      />
      {dropped.length === 0 ? null : (
        <p className="cs-gone">
          Dropped:{" "}
          {dropped.map((unit, i) => (
            <Fragment key={unit.id}>
              {i === 0 ? null : ", "}
              <s>{unit.title}</s>
            </Fragment>
          ))}
        </p>
      )}
    </>
  );
  const diagram = (
    <button
      type="button"
      className="textbtn"
      aria-expanded={props.diagramOpen}
      onClick={props.onToggleDiagram}
    >
      {props.diagramOpen ? "Hide the diagram" : "Show the diagram"}
    </button>
  );

  if (item.outcome !== undefined || item.historical) {
    const said =
      item.outcome === undefined ? (
        <span className="dk">No longer waiting</span>
      ) : (
        {
          applied: <span className="ok">Applied</span>,
          kept: <span className="dk">Kept the current one</span>,
          withdrawn: (
            <span className="dk">Not applied: the unit ended first</span>
          ),
        }[item.outcome]
      );
    return (
      <div className="qa-card cp done">
        <div className="q-count">
          <b>Change the curriculum</b> {said}
        </div>
        <div className="qa-prompt">{item.why}</div>
        {units}
        <div className="qa-foot">{diagram}</div>
      </div>
    );
  }

  async function answer(send: () => Promise<string | undefined>) {
    setSending(true);
    setProblem(await send());
    setSending(false);
  }

  return (
    <div className="qa-card cp">
      <div className="q-count">
        <b>Change the curriculum</b>
      </div>
      <div className="qa-prompt">{item.why}</div>
      {units}
      <p className="qa-aside">
        Nothing changes until you apply it. Units you have started keep their
        plans and progress.
      </p>
      <div className="qa-foot">
        {diagram}
        <span className="pk-btns">
          <button
            type="button"
            className="textbtn"
            disabled={sending}
            onClick={() => answer(props.onKeep)}
          >
            Keep the current one
          </button>
          <button
            type="button"
            className="btn sm"
            disabled={sending}
            onClick={() => answer(props.onApply)}
          >
            Apply
          </button>
        </span>
      </div>
      {problem === undefined ? null : (
        <p className="qa-error" role="alert">
          {problem}
        </p>
      )}
    </div>
  );
}
