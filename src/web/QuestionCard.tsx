// The check question card, as settled in docs/prototype/02-check-question.html:
// answered inside the card, with how sure and an optional reasoning, and
// shrunk to a record once graded. Multiple choice only so far: the card for
// written answers comes with the session view (task 2.11). The prompt and the
// choices are the tutor's Markdown, math included.

import { useState } from "react";
import {
  type AnswerSubmission,
  CHOICE_LETTERS,
  type ChoiceLetter,
  type Confidence,
  confidenceLabel,
  type QuestionView,
} from "../shared/question.ts";
import { InlineProse, Prose } from "./prose.tsx";
import type { Graded } from "./timeline.ts";

export type ChoiceView = Extract<QuestionView, { kind: "choice" }>;

const CONFIDENCE: { value: Confidence; label: string }[] = [
  { value: "under-50", label: "Under 50%" },
  { value: "50", label: "50%" },
  { value: "75", label: "75%" },
  { value: "90", label: "90%" },
  { value: "100", label: "100%" },
];

export function QuestionCard(props: {
  question: ChoiceView;
  graded: Graded | undefined;
  onAnswer(submission: AnswerSubmission): Promise<string | undefined>;
}) {
  return props.graded === undefined ? (
    <OpenCard question={props.question} onAnswer={props.onAnswer} />
  ) : (
    <DoneCard question={props.question} graded={props.graded} />
  );
}

function OpenCard(props: {
  question: ChoiceView;
  onAnswer(submission: AnswerSubmission): Promise<string | undefined>;
}) {
  const { question } = props;
  const [choice, setChoice] = useState<ChoiceLetter>();
  const [confidence, setConfidence] = useState<Confidence>();
  const [reasoning, setReasoning] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();

  async function send(submission: AnswerSubmission) {
    setSending(true);
    setError(undefined);
    const refused = await props.onAnswer(submission);
    // On success the card is replaced by its graded record.
    if (refused !== undefined) {
      setError(refused);
      setSending(false);
    }
  }

  return (
    <div className="qa-card">
      <div className="q-count">Question {question.number}</div>
      <div className="qa-prompt prose">
        <Prose text={question.prompt} />
      </div>
      <div className="qa-opts">
        {question.choices.map((text, i) => {
          const letter = CHOICE_LETTERS[i];
          if (letter === undefined) return null;
          return (
            <button
              type="button"
              className="opt"
              key={letter}
              aria-pressed={choice === letter}
              onClick={() => setChoice(letter)}
            >
              <kbd>{letter}</kbd>
              <span>
                <InlineProse text={text} />
              </span>
            </button>
          );
        })}
      </div>
      <fieldset className="qa-conf">
        <legend>How sure are you?</legend>
        <div className="chips">
          {CONFIDENCE.map((c) => (
            <button
              type="button"
              className="chip"
              key={c.value}
              aria-pressed={confidence === c.value}
              onClick={() => setConfidence(c.value)}
            >
              {c.label}
            </button>
          ))}
        </div>
      </fieldset>
      <details className="why">
        <summary>Add your reasoning</summary>
        <textarea
          className="field reason"
          aria-label="Your reasoning"
          value={reasoning}
          onChange={(e) => setReasoning(e.target.value)}
        />
      </details>
      {error === undefined ? null : <p className="qa-error">{error}</p>}
      <div className="qa-foot">
        <button
          type="button"
          className="textbtn"
          disabled={sending}
          onClick={() => send({ kind: "unknown", questionId: question.id })}
        >
          I don't know
        </button>
        <button
          type="button"
          className="btn"
          disabled={sending || choice === undefined || confidence === undefined}
          onClick={() => {
            if (choice === undefined || confidence === undefined) return;
            const said = reasoning.trim();
            send({
              kind: "choice",
              questionId: question.id,
              choice,
              confidence,
              ...(said === "" ? {} : { reasoning: said }),
            });
          }}
        >
          Submit answer
        </button>
      </div>
    </div>
  );
}

function DoneCard(props: { question: ChoiceView; graded: Graded }) {
  const { question, graded } = props;
  const { answer } = graded;
  const choiceText = (letter: ChoiceLetter) => (
    <span>
      {letter}.{" "}
      <InlineProse
        text={question.choices[CHOICE_LETTERS.indexOf(letter)] ?? ""}
      />
    </span>
  );
  const verdict =
    graded.verdict === "correct" ? (
      <span className="ok">Correct</span>
    ) : graded.verdict === "incorrect" ? (
      <span className="no">Not quite</span>
    ) : (
      <span className="dk">Did not know</span>
    );
  return (
    <div className="qa-card done">
      <div className="q-count">
        Question {question.number} {verdict}
      </div>
      <div className="qa-prompt prose">
        <Prose text={question.prompt} />
      </div>
      <div className="qa-line">
        <span className="k">Your answer</span>
        {answer.kind === "choice" ? (
          <>
            {choiceText(answer.choice)}
            <span className="c">{confidenceLabel(answer.confidence)} sure</span>
          </>
        ) : (
          <span>I don't know</span>
        )}
      </div>
      {graded.verdict === "correct" ||
      graded.correctChoice === undefined ? null : (
        <div className="qa-line">
          <span className="k">Correct answer</span>
          {choiceText(graded.correctChoice)}
        </div>
      )}
    </div>
  );
}
