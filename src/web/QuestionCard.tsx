// The check question card, as settled in docs/prototype/02-check-question.html:
// answered inside the card, with how sure and, for a choice, an optional
// reasoning; shrunk to a record once graded. Two answer kinds: multiple
// choice, and a written answer, which is its own reasoning and is graded by
// the grader (task 2.8): the card keeps the answer as sent while it is
// graded, says why a grading failed, and offers to grade it again. The
// prompt, the choices and a written answer are Markdown with math.
//
// Keys, when not typing (mock 2): A to F pick a choice, 1 to 5 how sure, and
// Enter submits.

import { useEffect, useState } from "react";
import {
  type AnswerSubmission,
  CHOICE_LETTERS,
  type ChoiceLetter,
  type Confidence,
  confidenceLabel,
  type QuestionView,
  type WrittenAnswer,
} from "../shared/question.ts";
import { AnswerPreview, InlineProse, Prose } from "./prose.tsx";
import type { Graded, QuestionItem } from "./timeline.ts";

type ChoiceView = Extract<QuestionView, { kind: "choice" }>;

const CONFIDENCE: { value: Confidence; label: string }[] = [
  { value: "under-50", label: "Under 50%" },
  { value: "50", label: "50%" },
  { value: "75", label: "75%" },
  { value: "90", label: "90%" },
  { value: "100", label: "100%" },
];

export function QuestionCard(props: {
  item: QuestionItem;
  onAnswer(submission: AnswerSubmission): Promise<string | undefined>;
  onGradeAgain(): Promise<string | undefined>;
}) {
  const { item } = props;
  if (item.graded !== undefined) {
    return <GradedCard question={item.question} graded={item.graded} />;
  }
  if (item.withdrawn === true) {
    return (
      <div className="qa-card done">
        <div className="q-count">
          Question {item.question.number} <span className="dk">Withdrawn</span>
        </div>
        <div className="qa-prompt prose">
          <Prose text={item.question.prompt} />
        </div>
      </div>
    );
  }
  if (item.grading !== undefined) {
    return (
      <KeptCard
        question={item.question}
        answer={item.grading}
        failed={item.gradingFailed}
        onGradeAgain={props.onGradeAgain}
      />
    );
  }
  return <OpenCard question={item.question} onAnswer={props.onAnswer} />;
}

function OpenCard(props: {
  question: QuestionView;
  onAnswer(submission: AnswerSubmission): Promise<string | undefined>;
}) {
  const { question } = props;
  const [choice, setChoice] = useState<ChoiceLetter>();
  const [text, setText] = useState("");
  const [confidence, setConfidence] = useState<Confidence>();
  const [reasoning, setReasoning] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();

  /** The answer as it would be sent, or undefined while it is incomplete. */
  function answer(): AnswerSubmission | undefined {
    if (confidence === undefined) return undefined;
    if (question.kind === "written") {
      const written = text.trim();
      return written === ""
        ? undefined
        : {
            kind: "written",
            questionId: question.id,
            text: written,
            confidence,
          };
    }
    if (choice === undefined) return undefined;
    const said = reasoning.trim();
    return {
      kind: "choice",
      questionId: question.id,
      choice,
      confidence,
      ...(said === "" ? {} : { reasoning: said }),
    };
  }
  const ready = answer();

  async function send(submission: AnswerSubmission) {
    setSending(true);
    setError(undefined);
    const refused = await props.onAnswer(submission);
    // On success the card changes with the events that follow.
    if (refused !== undefined) {
      setError(refused);
      setSending(false);
    }
  }

  // One keystroke for a choice and for how sure, as mock 2 has it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || sending) return;
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest("input, textarea, select, [contenteditable]")) return;
      const key = e.key.toUpperCase();
      if (question.kind === "choice" && key.length === 1) {
        const at = CHOICE_LETTERS.indexOf(key as ChoiceLetter);
        const letter = CHOICE_LETTERS[at];
        if (letter !== undefined && at < question.choices.length) {
          setChoice(letter);
          return;
        }
      }
      const level = CONFIDENCE[Number(e.key) - 1];
      if (e.key.length === 1 && level !== undefined) {
        setConfidence(level.value);
        return;
      }
      // Enter on a button or link presses it instead.
      if (
        e.key === "Enter" &&
        ready !== undefined &&
        !target?.closest("button, a, summary")
      ) {
        e.preventDefault();
        void send(ready);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="qa-card">
      <div className="q-count">Question {question.number}</div>
      <div className="qa-prompt prose">
        <Prose text={question.prompt} />
      </div>
      {question.kind === "choice" ? (
        <Choices
          question={question}
          choice={choice}
          onChoose={(letter) => setChoice(letter)}
        />
      ) : (
        <>
          <textarea
            className="field written"
            aria-label="Your answer"
            placeholder="Write your answer"
            value={text}
            disabled={sending}
            onChange={(e) => setText(e.target.value)}
          />
          <AnswerPreview text={text} />
        </>
      )}
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
      {question.kind === "choice" ? (
        <details className="why">
          <summary>Add your reasoning</summary>
          <textarea
            className="field reason"
            aria-label="Your reasoning"
            value={reasoning}
            onChange={(e) => setReasoning(e.target.value)}
          />
        </details>
      ) : null}
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
          disabled={sending || ready === undefined}
          onClick={() => {
            if (ready !== undefined) void send(ready);
          }}
        >
          Submit answer
        </button>
      </div>
    </div>
  );
}

function Choices(props: {
  question: ChoiceView;
  choice: ChoiceLetter | undefined;
  onChoose(letter: ChoiceLetter): void;
}) {
  return (
    <div className="qa-opts">
      {props.question.choices.map((text, i) => {
        const letter = CHOICE_LETTERS[i];
        if (letter === undefined) return null;
        return (
          <button
            type="button"
            className="opt"
            key={letter}
            aria-pressed={props.choice === letter}
            onClick={() => props.onChoose(letter)}
          >
            <kbd>{letter}</kbd>
            <span>
              <InlineProse text={text} />
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** A written answer as sent, kept while it is graded, or after its grading failed. */
function KeptCard(props: {
  question: QuestionView;
  answer: WrittenAnswer;
  failed: string | undefined;
  onGradeAgain(): Promise<string | undefined>;
}) {
  const { question, answer, failed } = props;
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();

  async function gradeAgain() {
    setSending(true);
    setError(undefined);
    const refused = await props.onGradeAgain();
    setError(refused);
    setSending(false);
  }

  return (
    <div className="qa-card done">
      <div className="q-count">
        Question {question.number}{" "}
        {failed === undefined ? (
          <span className="dk" role="status">
            Grading <span className="wait" aria-hidden="true" />
          </span>
        ) : (
          <span className="no">Not graded</span>
        )}
      </div>
      <div className="qa-prompt prose">
        <Prose text={question.prompt} />
      </div>
      <WrittenRecord answer={answer} />
      {failed === undefined ? null : (
        <>
          <p className="qa-error">The grading failed: {failed}</p>
          {error === undefined ? null : <p className="qa-error">{error}</p>}
          <div className="qa-foot">
            <span className="qa-aside">
              Your answer is kept as you sent it.
            </span>
            <button
              type="button"
              className="btn sm"
              disabled={sending}
              onClick={() => void gradeAgain()}
            >
              Grade again
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function WrittenRecord(props: { answer: WrittenAnswer }) {
  return (
    <>
      <div className="qa-said prose">
        <Prose text={props.answer.text} />
      </div>
      <div className="qa-line">
        <span className="c">
          {confidenceLabel(props.answer.confidence)} sure
        </span>
      </div>
    </>
  );
}

function GradedCard(props: { question: QuestionView; graded: Graded }) {
  const { question, graded } = props;
  const { answer } = graded;
  const choiceText = (letter: ChoiceLetter) =>
    question.kind === "choice" ? (
      <span>
        {letter}.{" "}
        <InlineProse
          text={question.choices[CHOICE_LETTERS.indexOf(letter)] ?? ""}
        />
      </span>
    ) : null;
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
        {graded.assisted && graded.verdict === "correct" ? (
          <span>With help, so it does not count toward passing</span>
        ) : null}
      </div>
      <div className="qa-prompt prose">
        <Prose text={question.prompt} />
      </div>
      {answer.kind === "written" ? (
        <WrittenRecord answer={answer} />
      ) : (
        <div className="qa-line">
          <span className="k">Your answer</span>
          {answer.kind === "choice" ? (
            <>
              {choiceText(answer.choice)}
              <span className="c">
                {confidenceLabel(answer.confidence)} sure
              </span>
            </>
          ) : (
            <span>I don't know</span>
          )}
        </div>
      )}
      {graded.verdict === "correct" ||
      graded.correctChoice === undefined ? null : (
        <div className="qa-line">
          <span className="k">Correct answer</span>
          {choiceText(graded.correctChoice)}
        </div>
      )}
      {graded.flaw === undefined ? null : (
        <div className="qa-line">
          <span className="k">The first flaw</span>
          <span className="qa-flaw">
            <InlineProse text={graded.flaw} />
          </span>
        </div>
      )}
    </div>
  );
}
