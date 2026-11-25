// The self-test's panel on the course view (piece 27, direction A): the
// scope, the kinds of question and how many objectives, the line the counts
// route gives for them, Cancel, and "Start the self-test", which starts it
// in a unit's thread and opens that unit, as "Review now" does.

import { type ReactNode, useEffect, useState } from "react";
import { ReviewStarted } from "../shared/events.ts";
import type { QuestionKind } from "../shared/question.ts";
import {
  SELF_TEST_COUNTS,
  SelfTestCounts,
  type SelfTestRequest,
  type SelfTestScope,
} from "../shared/self-test.ts";
import { postFor } from "./api.ts";
import { type PickableUnit, selfTestSays } from "./self-test.ts";

const KINDS: { kind: QuestionKind; label: string }[] = [
  { kind: "choice", label: "Choice" },
  { kind: "math", label: "Math" },
  { kind: "written", label: "Written" },
  { kind: "code", label: "Code" },
];

type ScopeKind = SelfTestScope["kind"];

export function SelfTestPanel(props: {
  courseId: string;
  /** The units a segment or unit scope can pick: those with a plan. */
  units: readonly PickableUnit[];
  onCancel(): void;
  /** Started in this unit's thread. */
  onStarted(unit: string): void;
  /** The server refused to start it. */
  onProblem(error: string): void;
}) {
  const { units } = props;
  const [kind, setKind] = useState<ScopeKind>(
    units.length === 0 ? "course" : "unit",
  );
  const [unit, setUnit] = useState(units[0]?.id ?? "");
  const [segment, setSegment] = useState(0);
  const [kinds, setKinds] = useState<QuestionKind[]>(KINDS.map((k) => k.kind));
  const [count, setCount] = useState<SelfTestRequest["count"]>(10);
  /** The counts route's answer, with the request it answers: shown only while that request is the one set up. */
  const [answer, setAnswer] = useState<
    { key: string } & ({ counts: SelfTestCounts } | { problem: string })
  >();
  const [starting, setStarting] = useState(false);

  const picked = units.find((u) => u.id === unit);
  const scope: SelfTestScope =
    kind === "segment"
      ? { kind, unit, segment }
      : kind === "unit"
        ? { kind, unit }
        : { kind };
  const request: SelfTestRequest = { scope, kinds, count };
  const base = `/api/courses/${encodeURIComponent(props.courseId)}/self-test`;
  // The counts depend on the scope and the count; the route also checks the
  // kinds, so none picked asks nothing.
  const asked = kinds.length === 0 ? null : JSON.stringify(request);

  useEffect(() => {
    if (asked === null) return;
    let current = true;
    void postFor(`${base}/counts`, SelfTestCounts, JSON.parse(asked)).then(
      (got) => {
        if (!current) return;
        setAnswer(
          got.ok
            ? { key: asked, counts: got.data }
            : { key: asked, problem: got.error },
        );
      },
    );
    return () => {
      current = false;
    };
  }, [asked, base]);
  const answered = answer?.key === asked ? answer : undefined;

  async function start() {
    setStarting(true);
    const answer = await postFor(base, ReviewStarted, request);
    setStarting(false);
    if (answer.ok) props.onStarted(answer.data.unit);
    else props.onProblem(answer.error);
  }

  function toggle(k: QuestionKind, on: boolean) {
    setKinds((now) =>
      KINDS.map((x) => x.kind).filter((x) => (x === k ? on : now.includes(x))),
    );
  }

  const unitSelect = (
    <select
      aria-label="Unit"
      value={unit}
      onChange={(e) => {
        setUnit(e.target.value);
        setSegment(0);
      }}
    >
      {units.map((u) => (
        <option key={u.id} value={u.id}>
          Unit {u.number}, {u.title}
        </option>
      ))}
    </select>
  );
  const radio = (value: ScopeKind, label: string, after?: ReactNode) => (
    <label>
      <input
        type="radio"
        name="self-test-scope"
        checked={kind === value}
        disabled={
          (value === "segment" || value === "unit") && units.length === 0
        }
        onChange={() => setKind(value)}
      />
      <span>
        {label}
        {after}
      </span>
    </label>
  );

  return (
    <section className="st-panel" aria-label="Self-test">
      <span className="st-k">Self-test</span>
      <fieldset className="st-q">
        <legend className="st-k">On</legend>
        <div className="st-opts">
          {radio(
            "segment",
            "A segment",
            units.length === 0 ? null : (
              <>
                {" "}
                {unitSelect}{" "}
                <select
                  aria-label="Segment"
                  value={segment}
                  onChange={(e) => setSegment(Number(e.target.value))}
                >
                  {(picked?.segments ?? []).map((title, at) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: a segment is named by its place in the plan, which the request sends
                    <option key={`${at}-${title}`} value={at}>
                      Segment {at + 1}
                    </option>
                  ))}
                </select>
              </>
            ),
          )}
          {radio(
            "unit",
            "A unit",
            units.length === 0 || kind === "segment" ? null : (
              <> {unitSelect}</>
            ),
          )}
          {radio("course", "The whole course")}
          {radio("mix", "A random mix of what you have passed")}
        </div>
      </fieldset>
      <fieldset className="st-q">
        <legend className="st-k">Kinds of question</legend>
        <div className="st-row">
          {KINDS.map((k) => (
            <label key={k.kind}>
              <input
                type="checkbox"
                checked={kinds.includes(k.kind)}
                onChange={(e) => toggle(k.kind, e.target.checked)}
              />
              {k.label}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="st-q">
        <legend className="st-k">How many objectives</legend>
        <div className="chips">
          {SELF_TEST_COUNTS.map((n) => (
            <button
              key={n}
              type="button"
              className="chip"
              aria-pressed={count === n}
              onClick={() => setCount(n)}
            >
              {n}
            </button>
          ))}
        </div>
      </fieldset>
      <p className="st-sum" aria-live="polite">
        {kinds.length === 0 ? (
          <b>Pick at least one kind.</b>
        ) : answered !== undefined && "counts" in answered ? (
          selfTestSays(answered.counts, scope, units)
        ) : null}
      </p>
      {answered !== undefined && "problem" in answered ? (
        <p className="qa-error" role="alert">
          {answered.problem}
        </p>
      ) : null}
      <div className="st-foot">
        <button type="button" className="textbtn" onClick={props.onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="btn"
          disabled={kinds.length === 0 || starting}
          onClick={() => void start()}
        >
          Start the self-test
        </button>
      </div>
    </section>
  );
}
