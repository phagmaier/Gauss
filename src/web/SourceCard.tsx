// A source the learner attached in a conversation with a planner (pieces 22
// and 26): a card on the learner's side of the thread, converting, then what
// was found or why the file was refused. "Remove" deletes an attached source
// until it joins the course; then a line says it was removed.

import { useState } from "react";
import { formatBytes } from "../shared/source.ts";
import type { SourceItem } from "../shared/timeline.ts";
import { FORMAT_NAMES, factLines, refusalCard } from "./source-card.ts";

const DOC = (
  <svg
    width="15"
    height="15"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.4"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M4 1.8h5.2L12.5 5v9.2H4z" />
    <path d="M9 1.8V5.2h3.5" />
  </svg>
);

export function SourceCard(props: {
  item: SourceItem;
  outlineOpen: boolean;
  onOutline(source: string): void;
  /** The source has not joined the course yet. */
  canRemove: boolean;
  onRemove(): Promise<string | undefined>;
  /** Where an attached source stands: "Attached" unless given. */
  status?: string | undefined;
  /** Why it cannot be removed now though it has not joined the course. */
  kept?: string | undefined;
}) {
  const { item } = props;
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string>();

  if (item.state === "removed") {
    return (
      <p className="ph-note">
        You removed <i>{item.facts?.title ?? item.name}</i>. The planner will
        not plan from it.
      </p>
    );
  }
  const file = (
    <div className="srcc-file">
      {DOC}
      <span>
        {item.name}
        {item.size === undefined ? "" : ` · ${formatBytes(item.size)}`}
      </span>
    </div>
  );

  if (item.state === "converting") {
    return (
      <div className="srcc" aria-live="polite">
        <div className="srcc-h">
          <b className="srcc-k">Source</b>
          <span className="r">
            <span className="spin" aria-hidden="true" />
            Converting
          </span>
        </div>
        {file}
        <p className="srcc-note">
          Finding the text, its pages and its sections. You can write meanwhile;
          your message goes once this is done.
        </p>
      </div>
    );
  }

  if (item.state === "refused" || item.facts === undefined) {
    const refusal = item.refusal ?? {
      reason: "failed" as const,
      detail: "The conversion failed.",
    };
    const { title, instead } = refusalCard(refusal);
    return (
      <div className="srcc refused" aria-live="polite">
        <div className="srcc-h">
          <b className="srcc-k">Source</b>
          {refusal.reason === "format" ? <span>Not read</span> : null}
          <span className="r">Not attached</span>
        </div>
        <div className="srcc-t">{title}</div>
        {file}
        <div className="srcc-says">
          <p className="srcc-p">{refusal.detail}</p>
          {instead === undefined ? null : <p className="srcc-p">{instead}</p>}
        </div>
      </div>
    );
  }

  const { facts } = item;
  async function remove() {
    setRemoving(true);
    setError(undefined);
    // On success the removal arrives over the event stream.
    const refused = await props.onRemove();
    setError(refused);
    setRemoving(false);
  }
  return (
    <div className="srcc" aria-live="polite">
      <div className="srcc-h">
        <b className="srcc-k">Source</b>
        <span>{FORMAT_NAMES[facts.format]}</span>
        <span className="r">{props.status ?? "Attached"}</span>
      </div>
      <div className="srcc-t">{facts.title}</div>
      {file}
      <ul className="srcc-facts">
        {factLines(facts).map((fact) => (
          <li key={fact.bold}>
            <b className="srcc-fact">{fact.bold}</b>
            {fact.rest}
          </li>
        ))}
      </ul>
      {error === undefined ? null : <p className="qa-error">{error}</p>}
      <div className="srcc-foot">
        <button
          type="button"
          className="textbtn"
          aria-expanded={props.outlineOpen}
          onClick={() => props.onOutline(facts.id)}
        >
          {props.outlineOpen ? "Hide the outline" : "Outline"}
        </button>
        {!props.canRemove ? null : props.kept === undefined ? (
          <button
            type="button"
            className="textbtn"
            disabled={removing}
            onClick={() => void remove()}
          >
            Remove
          </button>
        ) : (
          <span className="srcc-kept">{props.kept}</span>
        )}
      </div>
    </div>
  );
}
