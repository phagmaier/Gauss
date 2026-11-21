// A dispute of an answer's grade (task 3.8), as settled in
// docs/prototype/13-disputes.html: "Dispute this grade" opens the card in
// place, with what the answer was graded by and a field for the reason,
// which is required; once sent, the card keeps the first grade (when the
// dispute changed something), the reason and the outcome. The same part is
// on the session's graded card and on each answer in "What I know". After
// an "I don't know" to a choice or math question it is "The answer shown is
// wrong", whose form has the reason alone: the answer shown is on the card
// already, and nothing graded it. A call that fails records nothing: it is
// shown, with the reason kept, and sent again on request. Its words are in
// dispute-view.ts.

import { useState } from "react";
import {
  GradedBy,
  type GradedBy as GradedByShape,
  ShownDispute,
} from "../shared/dispute.ts";
import {
  AFTER_DISPUTE,
  type Disputed,
  disputeWords,
  type FirstGrade,
  firstGradeFeedback,
  gradedByHeading,
  outcomeHead,
  standing,
  verdictWord,
} from "../shared/dispute-view.ts";
import { type Answer, getJson, postFor } from "./api.ts";
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
 * The dispute's button, its form, or its record; for an "I don't know", the
 * report of the answer shown. Nothing for an "I don't know" to a written or
 * code question, which shows no answer.
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
  const words = disputeWords(first);
  /** An "I don't know", which nothing graded. */
  const shown = first.verdict === "unknown";

  if (words === undefined) return null;
  if (dispute !== undefined) {
    return (
      <DisputeRecord
        first={{ ...first, dispute }}
        choices={choices}
        said={words.said}
        firstLine={words.first}
      />
    );
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
          if (shown) return;
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
        {words.open}
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
        <Line k={words.said}>
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
      {shown ? null : form.gradedBy !== undefined ? (
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
        {words.ask}
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
        <span className="qa-aside">{words.decidedBy}</span>
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
            {form.error === undefined ? words.send : "Try again"}
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
  /** Beside the reason. */
  said: string;
  /** Beside the first grade, or the answer first shown. */
  firstLine: string;
}) {
  const { first, choices } = props;
  const { dispute } = first;
  return (
    <div className="dp-rec">
      {standing(first).corrected ? (
        <Line k={props.firstLine}>
          <FirstGraded first={first} choices={choices} />
        </Line>
      ) : null}
      <Line k={props.said}>
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

function FirstGraded(props: { first: FirstGrade; choices: readonly string[] }) {
  const feedback = firstGradeFeedback(props.first);
  const detail =
    "flaw" in feedback ? (
      <InlineProse text={feedback.flaw} />
    ) : "key" in feedback ? (
      <ChoiceLabel choices={props.choices} letter={feedback.key} />
    ) : "expected" in feedback ? (
      <MathText source={feedback.expected} />
    ) : null;
  return (
    <span className="qa-flaw">
      {feedback.label}
      {detail === null ? null : <> {detail}</>}
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
            {by.inputs === undefined ? (
              <p className="wk-file">
                No saved dependency list for this answer.
              </p>
            ) : by.inputs.length > 0 ? (
              <>
                <p className="dp-k">Saved grading inputs</p>
                {by.inputs.map((file) => (
                  <div key={file.path}>
                    <p className="wk-file">
                      <code>{file.path}</code>
                      {file.executable ? " — executable" : " — not executable"}
                    </p>
                    <pre>{file.content}</pre>
                  </div>
                ))}
              </>
            ) : null}
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
