// The check question card, as settled in docs/prototype/02-check-question.html:
// answered inside the card, with how sure and, for a choice or a math
// answer, an optional reasoning; shrunk to a record once graded. Three
// answer kinds: multiple choice; math, an expression typed in a field that
// shows it as math as it is typed, compared with the expected answer by the
// symbolic check (task 3.5); and a written answer, which is its own
// reasoning and is graded by the grader (task 2.8). The card keeps a math or
// written answer as sent while it is graded, says why a grading failed, and
// offers to grade it again. The prompt, the choices and a written answer are
// Markdown with math.
//
// Keys, when not typing (mock 2): A to F pick a choice, 1 to 5 how sure, and
// Enter submits. Enter in the math field submits too, or, before how sure is
// picked, moves to the first level.
//
// "I don't know" asks, before it is sent, where the learner got stuck, which
// they may leave blank (task 2.20); the tutor is given it in the detour the
// miss opens.
//
// An answer sent while the tutor's replies during the question are still
// being judged for help is kept as sent until they are (task 2.21).

import { useEffect, useRef, useState } from "react";
import {
  type AnswerSubmission,
  CHOICE_LETTERS,
  type ChoiceLetter,
  type Confidence,
  confidenceLabel,
  type GradedAnswer,
  type QuestionView,
  type WrittenAnswer,
} from "../shared/question.ts";
import {
  AnswerPreview,
  InlineProse,
  MathPreview,
  MathText,
  Prose,
} from "./prose.tsx";
import type { Graded, QuestionItem } from "./timeline.ts";
import { unsettledLine } from "./what-i-know.ts";

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
  if (item.waiting !== undefined) {
    return <WaitingCard question={item.question} answer={item.waiting} />;
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
  /** "I don't know" was pressed: the card asks where the learner got stuck. */
  const [unknown, setUnknown] = useState(false);
  const [stuck, setStuck] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();
  /** The first level of how sure, which Enter in the math field moves to. */
  const firstLevel = useRef<HTMLButtonElement>(null);

  /** The answer as it would be sent, or undefined while it is incomplete. */
  function answer(): AnswerSubmission | undefined {
    if (confidence === undefined) return undefined;
    if (question.kind === "math") {
      const expression = text.trim();
      const said = reasoning.trim();
      return expression === ""
        ? undefined
        : {
            kind: "math",
            questionId: question.id,
            expression,
            confidence,
            ...(said === "" ? {} : { reasoning: said }),
          };
    }
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

  function sendUnknown() {
    const said = stuck.trim();
    void send({
      kind: "unknown",
      questionId: question.id,
      ...(said === "" ? {} : { stuck: said }),
    });
  }

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
      if (e.metaKey || e.ctrlKey || e.altKey || sending || unknown) return;
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
    // "live": not dimmed with an earlier conversation (styles.css, ".stale").
    <div className="qa-card live">
      <div className="q-count">Question {question.number}</div>
      <div className="qa-prompt prose">
        <Prose text={question.prompt} />
      </div>
      {/* "I don't know" asks for no choice and no confidence: they are hidden,
      and kept, while it asks where the learner got stuck. */}
      {unknown ? null : (
        <>
          {question.kind === "choice" ? (
            <Choices
              question={question}
              choice={choice}
              onChoose={(letter) => setChoice(letter)}
            />
          ) : question.kind === "math" ? (
            <>
              <textarea
                className="field mathin"
                aria-label="Your answer"
                placeholder="Type your answer, for example 3x^2"
                rows={1}
                // The longest expression the check reads (`MathAnswer`).
                maxLength={1000}
                spellCheck={false}
                value={text}
                disabled={sending}
                onChange={(e) => {
                  setText(e.target.value);
                  // One line that grows with what is typed (mock 2).
                  e.target.style.height = "auto";
                  e.target.style.height = `${e.target.scrollHeight + 2}px`;
                }}
                onKeyDown={(e) => {
                  // Enter submits, as in the message box; Shift+Enter is a new line.
                  if (e.key !== "Enter" || e.shiftKey || sending) return;
                  e.preventDefault();
                  if (ready !== undefined) void send(ready);
                  else if (confidence === undefined)
                    firstLevel.current?.focus();
                }}
              />
              <MathPreview source={text} />
            </>
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
              {CONFIDENCE.map((c, i) => (
                <button
                  type="button"
                  className="chip"
                  key={c.value}
                  ref={i === 0 ? firstLevel : undefined}
                  aria-pressed={confidence === c.value}
                  onClick={() => setConfidence(c.value)}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </fieldset>
          {question.kind !== "written" ? (
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
        </>
      )}
      {error === undefined ? null : <p className="qa-error">{error}</p>}
      {unknown ? (
        <div className="qa-stuck">
          <label htmlFor={`stuck-${question.id}`}>
            Where did you get stuck?{" "}
            <span className="qa-optional">Optional</span>
          </label>
          <textarea
            id={`stuck-${question.id}`}
            className="field reason"
            // biome-ignore lint/a11y/noAutofocus: opened by the learner's own click, to type in at once
            autoFocus
            value={stuck}
            disabled={sending}
            placeholder="The step or idea where you lost the thread"
            onChange={(e) => setStuck(e.target.value)}
            onKeyDown={(e) => {
              // Enter sends, as in the message box; Shift+Enter is a new line.
              if (e.key === "Enter" && !e.shiftKey && !sending) {
                e.preventDefault();
                sendUnknown();
              }
            }}
          />
          <div className="qa-foot">
            <button
              type="button"
              className="textbtn"
              disabled={sending}
              onClick={() => setUnknown(false)}
            >
              Back to the question
            </button>
            <button
              type="button"
              className="btn"
              disabled={sending}
              onClick={sendUnknown}
            >
              Send "I don't know"
            </button>
          </div>
        </div>
      ) : (
        <div className="qa-foot">
          <button
            type="button"
            className="textbtn"
            disabled={sending}
            onClick={() => setUnknown(true)}
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
      )}
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

/** A written or math answer as sent, kept while it is graded, or after its grading failed. */
function KeptCard(props: {
  question: QuestionView;
  answer: GradedAnswer;
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
    // "live": it waits on its grade, or to be graded again.
    <div className="qa-card done live">
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
      <AnswerRecord question={question} answer={answer} />
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

/** An answer kept until the tutor's replies during its question are judged. */
function WaitingCard(props: {
  question: QuestionView;
  answer: AnswerSubmission;
}) {
  const { question, answer } = props;
  return (
    // "live": it waits on its grade.
    <div className="qa-card done live">
      <div className="q-count">
        Question {question.number}{" "}
        <span className="dk" role="status">
          Waiting <span className="wait" aria-hidden="true" />
        </span>
      </div>
      <div className="qa-prompt prose">
        <Prose text={question.prompt} />
      </div>
      <AnswerRecord question={question} answer={answer} />
      <div className="qa-foot">
        <span className="qa-aside">
          Your answer is kept as you sent it, and graded once the tutor's reply
          to your message is judged.
        </span>
      </div>
    </div>
  );
}

/** The answer as sent: the written text, the choice, the expression, or "I don't know". */
function AnswerRecord(props: {
  question: QuestionView;
  answer: AnswerSubmission;
}) {
  const { question, answer } = props;
  if (answer.kind === "written") return <WrittenRecord answer={answer} />;
  return (
    <>
      <div className="qa-line">
        <span className="k">Your answer</span>
        {answer.kind === "choice" ? (
          <>
            <ChoiceText question={question} letter={answer.choice} />
            <span className="c">{confidenceLabel(answer.confidence)} sure</span>
          </>
        ) : answer.kind === "math" ? (
          <>
            <span>
              <MathText source={answer.expression} />
            </span>
            <span className="c">{confidenceLabel(answer.confidence)} sure</span>
          </>
        ) : (
          <span>I don't know</span>
        )}
      </div>
      {answer.kind === "unknown" && answer.stuck !== undefined ? (
        <div className="qa-line">
          <span className="k">Stuck on</span>
          <span className="qa-stuck-said">{answer.stuck}</span>
        </div>
      ) : null}
    </>
  );
}

function ChoiceText(props: { question: QuestionView; letter: ChoiceLetter }) {
  const { question, letter } = props;
  return question.kind === "choice" ? (
    <ChoiceLabel choices={question.choices} letter={letter} />
  ) : null;
}

/** A choice by its letter and its text, as the learner saw it ("What I know" too). */
export function ChoiceLabel(props: {
  choices: readonly string[];
  letter: ChoiceLetter;
}) {
  const { choices, letter } = props;
  return (
    <span>
      {letter}.{" "}
      <InlineProse text={choices[CHOICE_LETTERS.indexOf(letter)] ?? ""} />
    </span>
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
      <AnswerRecord question={question} answer={answer} />
      {graded.verdict === "correct" ||
      graded.correctChoice === undefined ? null : (
        <div className="qa-line">
          <span className="k">Correct answer</span>
          <ChoiceText question={question} letter={graded.correctChoice} />
        </div>
      )}
      {graded.verdict === "correct" || graded.expected === undefined ? null : (
        <div className="qa-line">
          <span className="k">Correct answer</span>
          <span>
            <MathText source={graded.expected} />
          </span>
        </div>
      )}
      {graded.unsettled === undefined ? null : (
        <div className="qa-line">
          <span className="k">Graded by</span>
          <span className="qa-by">{unsettledLine(graded.unsettled)}</span>
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
