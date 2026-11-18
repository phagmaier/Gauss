// A dispute of an answer's grade (task 3.8), as settled in
// docs/prototype/13-disputes.html: "Dispute this grade" opens the card in
// place, with what the answer was graded by and a field for the reason,
// which is required; once sent, the card keeps the first grade (when the
// dispute changed something), the reason and the outcome. The same part is
// on the session's graded card and on each answer in "What I know". A call
// that fails records nothing: it is shown, with the reason kept, and sent
// again on request. Its words are in dispute.ts.

import { useState } from "react";
import {
  GradedBy,
  type GradedBy as GradedByShape,
  ShownDispute,
} from "../shared/dispute.ts";
import { type Answer, getJson, postFor } from "./api.ts";
import {
  AFTER_DISPUTE,
  DECIDED_BY,
  type Disputed,
  gradedByHeading,
  outcomeHead,
  standing,
  verdictWord,
} from "./dispute.ts";
import { ChoiceLabel, InlineProse, MathText, Prose } from "./prose.tsx";

/** The course's dispute routes. */
export interface DisputeApi {
  gradedBy(questionId: string): Promise<Answer<GradedByShape>>;
  raise(questionId: string, reason: string): Promise<Answer<ShownDispute>>;
}

export function disputeApi(courseId: string): DisputeApi {
  const answer = (questionId: string) =>
    `/api/courses/${encodeURIComponent(courseId)}/answers/${encodeURIComponent(questionId)}`;
  return {
    gradedBy: (questionId) =>
      getJson(`${answer(questionId)}/graded-by`, GradedBy),
    raise: (questionId, reason) =>
      postFor(`${answer(questionId)}/dispute`, ShownDispute, { reason }),
  };
}

/** The first grade, as the record beside the outcome names it. */
export interface FirstGrade extends Disputed {
  kind: "choice" | "math" | "written" | "code";
  /** The grader's flaw, if it named one. */
  flaw?: string | undefined;
}

type Form =
  | { step: "closed" }
  | {
      step: "open";
      gradedBy: GradedByShape | undefined;
      /** Why what it was graded by could not be loaded. */
      loadError: string | undefined;
      reason: string;
      /** Sent and waiting for the outcome. */
      sending: boolean;
      /** Why the last send failed. */
      error: string | undefined;
    };

/**
 * The dispute's button, its form, or its record. Nothing for "I don't know",
 * which was not graded.
 */
export function DisputePart(props: {
  api: DisputeApi;
  questionId: string;
  first: FirstGrade;
  /** The question's choices, to show a key by its text. */
  choices: readonly string[];
  /** Called with the outcome once it is recorded. */
  onDisputed?(dispute: ShownDispute): void;
}) {
  const { api, questionId, first, choices } = props;
  const [form, setForm] = useState<Form>({ step: "closed" });
  /** The outcome as the route answered it, until the card's own arrives. */
  const [decided, setDecided] = useState<ShownDispute>();
  const dispute = first.dispute ?? decided;

  if (first.verdict === "unknown") return null;
  if (dispute !== undefined) {
    return <DisputeRecord first={{ ...first, dispute }} choices={choices} />;
  }
  if (form.step === "closed") {
    return (
      <button
        type="button"
        className="textbtn dp-open"
        onClick={() => {
          setForm({
            step: "open",
            gradedBy: undefined,
            loadError: undefined,
            reason: "",
            sending: false,
            error: undefined,
          });
          void api
            .gradedBy(questionId)
            .then((answer) =>
              setForm((f) =>
                f.step !== "open"
                  ? f
                  : answer.ok
                    ? { ...f, gradedBy: answer.data }
                    : { ...f, loadError: answer.error },
              ),
            );
        }}
      >
        Dispute this grade
      </button>
    );
  }

  async function send(reason: string) {
    setForm((f) =>
      f.step === "open" ? { ...f, sending: true, error: undefined } : f,
    );
    const answer = await api.raise(questionId, reason);
    if (answer.ok) {
      setDecided(answer.data);
      props.onDisputed?.(answer.data);
      return;
    }
    setForm((f) =>
      f.step === "open" ? { ...f, sending: false, error: answer.error } : f,
    );
  }

  const reason = form.reason.trim();
  if (form.sending) {
    return (
      <div className="dp-rec">
        <Line k="Your dispute">
          <span className="dp-said">{form.reason}</span>
        </Line>
        <Line k="Outcome">
          <span className="dk" role="status">
            Deciding <span className="wait" aria-hidden="true" />
          </span>
        </Line>
      </div>
    );
  }
  const fieldId = `dispute-${questionId}`;
  return (
    <div className="dp">
      {form.gradedBy !== undefined ? (
        <GradedByBlock by={form.gradedBy} choices={choices} />
      ) : form.loadError !== undefined ? (
        <p className="qa-error">
          What it was graded by could not be loaded: {form.loadError}
        </p>
      ) : (
        <p className="dp-k">
          <span className="wait" aria-hidden="true" /> Loading what it was
          graded by
        </p>
      )}
      <label className="dp-k" htmlFor={fieldId}>
        Why is the grade wrong?
      </label>
      <textarea
        id={fieldId}
        className="field reason"
        // biome-ignore lint/a11y/noAutofocus: opened by the learner's own click, to type in at once
        autoFocus
        value={form.reason}
        maxLength={10_000}
        onChange={(e) => {
          const text = e.target.value;
          setForm((f) => (f.step === "open" ? { ...f, reason: text } : f));
        }}
      />
      {form.error === undefined ? null : (
        <p className="qa-error">{form.error}</p>
      )}
      <div className="qa-foot">
        <span className="qa-aside">{DECIDED_BY}</span>
        <span className="dp-btns">
          <button
            type="button"
            className="textbtn"
            onClick={() => setForm({ step: "closed" })}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn sm"
            disabled={reason === ""}
            onClick={() => void send(reason)}
          >
            {form.error === undefined ? "Send dispute" : "Try again"}
          </button>
        </span>
      </div>
    </div>
  );
}

/** The first grade (when the dispute changed something), the reason and the outcome. */
function DisputeRecord(props: {
  first: FirstGrade & { dispute: ShownDispute };
  choices: readonly string[];
}) {
  const { first, choices } = props;
  const { dispute } = first;
  return (
    <div className="dp-rec">
      {standing(first).corrected ? (
        <Line k="First graded">
          <FirstGraded first={first} choices={choices} />
        </Line>
      ) : null}
      <Line k="Your dispute">
        <span className="dp-said">{dispute.reason}</span>
      </Line>
      <Line k="Outcome">
        <span className="qa-flaw">
          <b>{outcomeHead(first)}</b>{" "}
          <InlineProse text={dispute.outcome.reason} />
        </span>
      </Line>
    </div>
  );
}

/** "Not quite: the flaw", "Not quite, by the key C. …", "Correct, by the tests". */
function FirstGraded(props: { first: FirstGrade; choices: readonly string[] }) {
  const { first, choices } = props;
  const word = verdictWord(first.verdict).text;
  if (first.flaw !== undefined) {
    return (
      <span className="qa-flaw">
        {word}: <InlineProse text={first.flaw} />
      </span>
    );
  }
  if (first.kind === "choice" && first.key !== undefined) {
    return (
      <span className="qa-flaw">
        {word}, by the key <ChoiceLabel choices={choices} letter={first.key} />
      </span>
    );
  }
  if (first.kind === "math" && first.expected !== undefined) {
    return (
      <span className="qa-flaw">
        {word}, by the expected answer <MathText source={first.expected} />
      </span>
    );
  }
  return (
    <span className="qa-flaw">
      {first.kind === "code" ? `${word}, by the tests` : word}
    </span>
  );
}

/** What the answer was graded by, shown only while it is disputed. */
function GradedByBlock(props: {
  by: GradedByShape;
  choices: readonly string[];
}) {
  const { by, choices } = props;
  return (
    <>
      <span className="dp-k">{gradedByHeading(by)}</span>
      <div className="dp-by">
        {by.kind === "choice" ? (
          <ChoiceLabel choices={choices} letter={by.key} />
        ) : by.kind === "math" ? (
          by.rubric === undefined ? (
            <MathText source={by.expected} />
          ) : (
            <div className="prose">
              <Prose text={by.rubric} />
            </div>
          )
        ) : by.kind === "written" ? (
          <div className="prose">
            <Prose text={by.rubric} />
          </div>
        ) : (
          <>
            {by.tests.map((file) => (
              <div key={file.path}>
                <p className="wk-file">
                  <code>{file.path}</code>
                </p>
                <pre>{file.content}</pre>
              </div>
            ))}
            <p className="wk-file">
              Run with <code>{by.command.join(" ")}</code>
            </p>
          </>
        )}
      </div>
    </>
  );
}

function Line(props: { k: string; children: React.ReactNode }) {
  return (
    <div className="qa-line">
      <span className="k">{props.k}</span>
      {props.children}
    </div>
  );
}

/** The verdict a graded answer shows, marked when a dispute changed it. */
export function VerdictNow(props: { first: Disputed }) {
  const now = standing(props.first);
  const word = verdictWord(now.verdict);
  return (
    <>
      <span className={word.className}>{word.text}</span>
      {now.changed ? <span className="chg">{AFTER_DISPUTE}</span> : null}
    </>
  );
}
