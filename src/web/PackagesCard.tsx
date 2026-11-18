// The card of the tutor's request to install packages (task 3.11,
// docs/prototype/14-code-question.html): the packages, the commands Install
// runs and where, Install and "Not now"; while the commands run, that they
// do; once answered, a record of the outcome with the end of the output.

import { useState } from "react";
import { requirement } from "../shared/packages.ts";
import type { PackagesItem } from "./timeline.ts";

/** A command as a shell would read it: a word with a space or a quote quoted. */
export function commandLine(words: readonly string[]): string {
  return words
    .map((word) =>
      /^[A-Za-z0-9_./=+,:@%-]+$/.test(word)
        ? word
        : `'${word.replaceAll("'", `'\\''`)}'`,
    )
    .join(" ");
}

export function PackagesCard(props: {
  item: PackagesItem;
  /** The tutor is writing: the learner's steps wait for it. */
  busy: boolean;
  onInstall(): Promise<string | undefined>;
  onNotNow(): Promise<string | undefined>;
  onRetrySaving(): Promise<string | undefined>;
}) {
  const { item } = props;
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<string>();
  const count = item.packages.length;

  const lines = (
    <>
      <div className="qa-line">
        <span className="k">{count === 1 ? "Package" : "Packages"}</span>
        <span className="qa-flaw">
          {item.packages.map((p, i) => (
            <span key={p.name}>
              {i > 0 ? " " : null}
              <code>{requirement(p)}</code>
            </span>
          ))}
        </span>
      </div>
      <div className="qa-line">
        <span className="k">
          {item.commands.length === 1 ? "Command" : "Commands"}
        </span>
        <span className="qa-flaw">
          {item.commands.map((words, i) => (
            <span key={words.join(" ")} className="pk-cmd">
              {i > 0 ? "then " : null}
              <code className="pk-words">{commandLine(words)}</code>
            </span>
          ))}
          in <code>{item.folder}</code>
        </span>
      </div>
    </>
  );

  if (item.outcome !== undefined) {
    const said = {
      installed: <span className="ok">Installed</span>,
      failed: <span className="no">Not installed: the install failed</span>,
      declined: <span className="dk">Not installed</span>,
      withdrawn: (
        <span className="dk">Not installed: the unit ended first</span>
      ),
    }[item.outcome];
    return (
      <div className="qa-card done pk">
        <div className="q-count">
          <b className="pk-title">Install packages</b> {said}
        </div>
        {lines}
        {item.output === undefined || item.output === "" ? null : (
          <div className="qa-out">{item.output}</div>
        )}
      </div>
    );
  }

  async function answer(send: () => Promise<string | undefined>) {
    setSending(true);
    setProblem(await send());
    setSending(false);
  }

  return (
    <div className="qa-card pk">
      <div className="q-count">
        <b className="pk-title">Install packages</b>
      </div>
      <div className="qa-prompt">
        The tutor asks to install{" "}
        {count === 1 ? "a package" : `${count} packages`} into this course's
        workspace.
      </div>
      {lines}
      <div className="qa-foot">
        {item.status === "save-failed" ? (
          <span className="qa-aside" role="status">
            The install finished, but its result couldn't be saved.
          </span>
        ) : (
          <span className="qa-aside">
            {count === 1 ? "It is" : "They are"} downloaded from pypi.org. No
            other command of this course gets network access.
          </span>
        )}
        {item.status === "installing" ? (
          <span className="dk" role="status">
            Installing <span className="wait" aria-hidden="true" />
          </span>
        ) : item.status === "save-failed" ? (
          <span className="pk-btns">
            <button
              type="button"
              className="btn sm"
              disabled={sending}
              onClick={() => answer(props.onRetrySaving)}
            >
              Retry saving
            </button>
          </span>
        ) : item.status === "historical" ? null : (
          <span className="pk-btns">
            <button
              type="button"
              className="textbtn"
              disabled={sending || props.busy}
              onClick={() => answer(props.onNotNow)}
            >
              Not now
            </button>
            <button
              type="button"
              className="btn sm"
              disabled={sending || props.busy}
              onClick={() => answer(props.onInstall)}
            >
              Install
            </button>
          </span>
        )}
      </div>
      {problem === undefined ? null : (
        <p className="qa-error" role="alert">
          {problem}
        </p>
      )}
    </div>
  );
}
