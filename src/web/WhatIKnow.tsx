// "What I know" (brief.md, "Other features"; task 2.26), reached from the
// course view: each started unit's objectives with their status, and under
// each the evidence behind it in the order it was recorded: the question,
// the answer (or "I don't know" and where the learner got stuck), how sure,
// help, the grade with a written answer's flaw, and the date; an override is
// a line of its own. Its words are in what-i-know.ts. Under the summary, the
// course's calibration (task 2.29), its words in calibration.ts. Stage 3's
// disputes will be raised from the answers here.

import { useEffect, useState } from "react";
import type { Calibration } from "../shared/calibration.ts";
import {
  WhatIKnow as Known,
  type KnownObjective,
  type KnownUnit,
  type ShownEvidence,
} from "../shared/what-i-know.ts";
import { getJson } from "./api.ts";
import { calibrationRows, hasCalibration } from "./calibration.ts";
import { Link, TopLine } from "./Frame.tsx";
import { InlineProse, MathText, Prose } from "./prose.tsx";
import { ChoiceLabel } from "./QuestionCard.tsx";
import { paths } from "./route.ts";
import {
  answerLine,
  knownSummary,
  objectiveMark,
  recordedOn,
  unitWord,
  unstartedLine,
} from "./what-i-know.ts";

export function WhatIKnow(props: { courseId: string }) {
  const { courseId } = props;
  // Undefined while loading, null when there is no such course.
  const [view, setView] = useState<Known | null>();
  const [problem, setProblem] = useState<string>();

  useEffect(() => {
    void getJson(
      `/api/courses/${encodeURIComponent(courseId)}/what-i-know`,
      Known,
    ).then((answer) => {
      if (answer.ok) setView(answer.data);
      else if (answer.status === 404) setView(null);
      else setProblem(answer.error);
    });
  }, [courseId]);

  const unstarted = view == null ? null : unstartedLine(view);
  return (
    <div className="pg">
      <TopLine
        trail={[
          { label: "Library", to: paths.library },
          // The course's own title once it is loaded.
          { label: view?.title ?? "Course", to: paths.course(courseId) },
        ]}
        here="What I know"
      />
      <div className="pg-scroll">
        <div className="pg-col">
          {problem === undefined ? null : <p className="ph-note">{problem}</p>}
          {view === null ? (
            <p className="ph-note">
              There is no course here. Back to the{" "}
              <Link to={paths.library}>library</Link>.
            </p>
          ) : view === undefined ? null : (
            <>
              <h1 className="cv-title">What I know</h1>
              <p className="cv-at">{knownSummary(view)}</p>
              {hasCalibration(view.calibration) ? (
                <CalibrationCounts calibration={view.calibration} />
              ) : null}
              {view.units.map((unit) =>
                unit.objectives === null ? null : (
                  <UnitSection
                    key={unit.id}
                    unit={unit}
                    objectives={unit.objectives}
                  />
                ),
              )}
              {unstarted === null ? null : (
                <p className="ph-note">{unstarted}</p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function UnitSection(props: { unit: KnownUnit; objectives: KnownObjective[] }) {
  const { unit } = props;
  const word = unitWord(unit.status);
  const headingId = `wk-unit-${unit.id}`;
  return (
    <section className="wk-unit" aria-labelledby={headingId}>
      <div className="cv-hrow">
        <h2 className="pg-h" id={headingId}>
          Unit {unit.number}: {unit.title}
        </h2>
        <span className={`wk-s ${word.className}`}>{word.text}</span>
      </div>
      <ol className="wk-objs">
        {props.objectives.map((objective) => (
          <ObjectiveItem key={objective.id} objective={objective} />
        ))}
      </ol>
    </section>
  );
}

function ObjectiveItem(props: { objective: KnownObjective }) {
  const { objective } = props;
  const mark = objectiveMark(objective.status);
  return (
    <li className="wk-obj">
      <div className="wk-ohead">
        <span className="wk-stmt">
          <InlineProse text={objective.statement} />
        </span>
        <span className={`wk-s ${mark.className}`}>{mark.text}</span>
      </div>
      {objective.evidence.length === 0 ? (
        <p className="wk-none">Nothing answered yet.</p>
      ) : (
        <ol className="wk-ev">
          {objective.evidence.map((entry, i) => (
            // The log is appended to and never reordered, so a line keeps its place.
            // biome-ignore lint/suspicious/noArrayIndexKey: see above
            <li key={i} className="wk-entry">
              {entry.kind === "answer" ? (
                <AnswerEntry entry={entry} />
              ) : (
                <div className="q-count">
                  <span>{recordedOn(entry.recordedAt)}</span>
                  <span className="dk">Moved on without passing it</span>
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
    </li>
  );
}

function AnswerEntry(props: {
  entry: Extract<ShownEvidence, { kind: "answer" }>;
}) {
  const { entry } = props;
  const { question, answer } = entry;
  const line = answerLine(entry);
  const choices = question.kind === "choice" ? question.choices : [];
  return (
    <>
      <div className="q-count">
        <span>{recordedOn(entry.recordedAt)}</span>
        <span className={line.verdict.className}>{line.verdict.text}</span>
        {line.sure === undefined ? null : <span>{line.sure}</span>}
        {line.help === undefined ? null : (
          <span className="wk-help">{line.help}</span>
        )}
      </div>
      <div className="qa-prompt prose">
        <Prose text={question.prompt} />
      </div>
      {answer.kind === "written" ? (
        <div className="qa-said prose">
          <Prose text={answer.text} />
        </div>
      ) : (
        <div className="qa-line">
          <span className="k">Your answer</span>
          {answer.kind === "choice" ? (
            <ChoiceLabel choices={choices} letter={answer.choice} />
          ) : answer.kind === "math" ? (
            <span>
              <MathText source={answer.expression} />
            </span>
          ) : (
            <span>I don't know</span>
          )}
        </div>
      )}
      {(answer.kind === "choice" || answer.kind === "math") &&
      answer.reasoning !== undefined ? (
        <div className="qa-line">
          <span className="k">Your reasoning</span>
          <span className="qa-flaw">
            <InlineProse text={answer.reasoning} />
          </span>
        </div>
      ) : null}
      {answer.kind === "unknown" && answer.stuck !== undefined ? (
        <div className="qa-line">
          <span className="k">Stuck on</span>
          <span className="qa-stuck-said">{answer.stuck}</span>
        </div>
      ) : null}
      {line.correctChoice === undefined ? null : (
        <div className="qa-line">
          <span className="k">Correct answer</span>
          <ChoiceLabel choices={choices} letter={line.correctChoice} />
        </div>
      )}
      {line.expected === undefined ? null : (
        <div className="qa-line">
          <span className="k">Correct answer</span>
          <span>
            <MathText source={line.expected} />
          </span>
        </div>
      )}
      {line.gradedBy === undefined ? null : (
        <div className="qa-line">
          <span className="k">Graded by</span>
          <span className="qa-by">{line.gradedBy}</span>
        </div>
      )}
      {entry.flaw === undefined ? null : (
        <div className="qa-line">
          <span className="k">The first flaw</span>
          <span className="qa-flaw">
            <InlineProse text={entry.flaw} />
          </span>
        </div>
      )}
    </>
  );
}

/** How often the course's answers at each level of confidence were right. */
function CalibrationCounts(props: { calibration: Calibration }) {
  return (
    <section className="cal-sec" aria-labelledby="calibration">
      <h2 className="pg-h" id="calibration">
        Calibration
      </h2>
      <p className="cal-lead">
        How often your answers in this course were right at each level of
        confidence. Answers given with help are left out.
      </p>
      <table className="cal">
        <tbody>
          {calibrationRows(props.calibration).map((row) => (
            <tr key={row.label}>
              <th scope="row">{row.label}</th>
              <td>{row.text}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
