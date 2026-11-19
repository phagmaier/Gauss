// The card of the tutor's proposed style note (task 5.11): why, the whole
// note with what changed marked against the current one, Apply and "Keep
// the current one"; once answered, a record of the answer. Built from the
// intake card's style section and the package card's foot, since no piece
// draws it (docs/decisions.md, "Page design").

import { useState } from "react";
import { compareSentences } from "../shared/profile.ts";
import type { StyleItem } from "../shared/timeline.ts";
import { ChangedText } from "./ChangedText.tsx";

export function StyleCard(props: {
  item: StyleItem;
  onApply(): Promise<string | undefined>;
  onKeep(): Promise<string | undefined>;
}) {
  const { item } = props;
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<string>();
  const label = "How I would teach it";
  const change =
    item.was === undefined ? undefined : compareSentences(item.was, item.note);
  const note = (
    <section className="cs" aria-label={label}>
      <div className="cs-h">
        <span>{label}</span>
        <span className="for">in this course</span>
        {item.was === undefined ? <span className="chg">New</span> : null}
      </div>
      {change === undefined ? (
        <p className="cs-t">{item.note}</p>
      ) : (
        <ChangedText change={change} />
      )}
    </section>
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
      <div className="qa-card done">
        <div className="q-count">
          <b className="pk-title">Change the teaching style</b> {said}
        </div>
        <div className="qa-prompt">{item.why}</div>
        {note}
      </div>
    );
  }

  async function answer(send: () => Promise<string | undefined>) {
    setSending(true);
    setProblem(await send());
    setSending(false);
  }

  return (
    <div className="qa-card">
      <div className="q-count">
        <b className="pk-title">Change the teaching style</b>
      </div>
      <div className="qa-prompt">{item.why}</div>
      {note}
      <div className="qa-foot">
        <span className="qa-aside">
          Nothing changes until you apply it. It holds in every unit of this
          course.
        </span>
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
