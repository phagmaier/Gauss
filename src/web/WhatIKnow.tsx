// "What I know" (brief.md, "Other features"; task 2.26), reached from the
// course view: each started unit's objectives with their status, and under
// each the evidence behind it in the order it was recorded: the question,
// the answer (or "I don't know" and where the learner got stuck), how sure,
// help, the grade with a written answer's flaw, and the date; an override is
// a line of its own, and an answer given in a review, a gate or a test says
// so (piece 16). Above an objective's answers, the misconceptions found on
// it, each "Open" until the objective passes (piece 18; task 5.7). Its words
// are in what-i-know.ts. Under the summary, the
// course's calibration (task 2.29), its words in calibration.ts. Each
// graded answer can be disputed here (task 3.8, Dispute.tsx); once its
// outcome is in, the view is loaded again, since statuses and calibration
// follow the corrected grade.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Calibration } from "../shared/calibration.ts";
import { AFTER_DISPUTE } from "../shared/dispute-view.ts";
import type { ObjectiveStatus } from "../shared/status.ts";
import {
  WhatIKnow as Known,
  type KnownObjective,
  type KnownUnit,
  type ShownEvidence,
  type ShownMisconception,
} from "../shared/what-i-know.ts";
import { getJson } from "./api.ts";
import { calibrationRows, hasCalibration } from "./calibration.ts";
import { type DisputeApi, DisputePart, disputeApi } from "./Dispute.tsx";
import { Link, TopLine } from "./Frame.tsx";
import { ChoiceLabel, InlineProse, MathText, Prose } from "./prose.tsx";
import { CodeOutput, FileNames, Thinking } from "./QuestionCard.tsx";
import { paths } from "./route.ts";
import {
  answerLine,
  knownSummary,
  misconceptionHead,
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
  const disputes = useMemo(() => disputeApi(courseId), [courseId]);

  const load = useCallback(() => {
    void getJson(
      `/api/courses/${encodeURIComponent(courseId)}/what-i-know`,
      Known,
    ).then((answer) => {
      if (answer.ok) {
        setView(answer.data);
        setProblem(undefined);
      } else if (answer.status === 404) setView(null);
      else setProblem(answer.error);
    });
  }, [courseId]);
  useEffect(load, [load]);

  const unstarted = view == null ? null : unstartedLine(view);
  const unitNumber = (id: string) =>
    view?.units.find((u) => u.id === id)?.number;
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
                    disputes={disputes}
                    onDisputed={load}
                    unitNumber={unitNumber}
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

/** The course's dispute routes, and what to do once one is decided. */
interface Disputing {
  disputes: DisputeApi;
  onDisputed(): void;
  /** A unit's number by its id, to name the unit whose gate an answer was given in. */
  unitNumber(unitId: string): number | undefined;
}

function UnitSection(
  props: { unit: KnownUnit; objectives: KnownObjective[] } & Disputing,
) {
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
          <ObjectiveItem
            key={objective.id}
            unitId={unit.id}
            objective={objective}
            disputes={props.disputes}
            onDisputed={props.onDisputed}
            unitNumber={props.unitNumber}
          />
        ))}
      </ol>
    </section>
  );
}

function ObjectiveItem(
  props: { unitId: string; objective: KnownObjective } & Disputing,
) {
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
      {objective.misconceptions.map((misconception) => (
        <MisconceptionEntry
          key={`${misconception.recordedAt} ${misconception.believed}`}
          misconception={misconception}
          status={objective.status}
          unit={{ id: props.unitId, number: props.unitNumber }}
        />
      ))}
      {objective.evidence.length === 0 ? (
        <p className="wk-none">Nothing answered yet.</p>
      ) : (
        <ol className="wk-ev">
          {objective.evidence.map((entry, i) => (
            // The log is appended to and never reordered, so a line keeps its place.
            // biome-ignore lint/suspicious/noArrayIndexKey: see above
            <li key={i} className="wk-entry">
              {entry.kind === "answer" ? (
                <AnswerEntry
                  entry={entry}
                  disputes={props.disputes}
                  onDisputed={props.onDisputed}
                  unitNumber={props.unitNumber}
                />
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

/** A misconception found on the objective: what the learner believed, and what is so. */
function MisconceptionEntry(props: {
  misconception: ShownMisconception;
  status: ObjectiveStatus;
  unit: { id: string; number: (unitId: string) => number | undefined };
}) {
  const { misconception } = props;
  const head = misconceptionHead(misconception, props.status, props.unit);
  return (
    <div className={head.open ? "mc" : "mc shut"}>
      <div className="q-count">
        <b>Misconception</b>
        <span>{head.state}</span>
        <span>{head.found}</span>
      </div>
      <div className="qa-line">
        <span className="k">You believed</span>
        <span className="qa-flaw">
          <InlineProse text={misconception.believed} />
        </span>
      </div>
      <div className="qa-line">
        <span className="k">What is so</span>
        <span className="qa-flaw">
          <InlineProse text={misconception.actually} />
        </span>
      </div>
    </div>
  );
}

function AnswerEntry(
  props: { entry: Extract<ShownEvidence, { kind: "answer" }> } & Disputing,
) {
  const { entry } = props;
  const { question, answer } = entry;
  const line = answerLine(entry, props.unitNumber);
  const choices = question.kind === "choice" ? question.choices : [];
  return (
    <>
      <div className="q-count">
        <span>{recordedOn(entry.recordedAt)}</span>
        <span className={line.verdict.className}>{line.verdict.text}</span>
        {line.changed ? <span className="chg">{AFTER_DISPUTE}</span> : null}
        {line.sure === undefined ? null : <span>{line.sure}</span>}
        {line.help === undefined ? null : (
          <span className="wk-help">{line.help}</span>
        )}
        {line.givenIn === undefined ? null : (
          <span className="wk-in">{line.givenIn}</span>
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
          ) : answer.kind === "code" ? (
            <span>
              <FileNames files={answer.files} />, as you ran it
            </span>
          ) : (
            <span>I don't know</span>
          )}
        </div>
      )}
      {answer.kind === "unknown" ? null : <Thinking text={answer.reasoning} />}
      {entry.output === undefined ? null : (
        <CodeOutput output={entry.output} verdict={entry.verdict} />
      )}
      {answer.kind === "code" ? (
        <details className="why">
          <summary>
            Your {answer.files.length === 1 ? "file" : "files"} as you ran{" "}
            {answer.files.length === 1 ? "it" : "them"}
          </summary>
          {answer.files.map((file) => (
            <div key={file.path}>
              <p className="wk-file">
                <code>{file.path}</code>
              </p>
              <div className="qa-out">{file.content}</div>
            </div>
          ))}
        </details>
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
      {/* The first flaw stays while the grade it belongs to does. */}
      {entry.flaw === undefined || line.changed ? null : (
        <div className="qa-line">
          <span className="k">The first flaw</span>
          <span className="qa-flaw">
            <InlineProse text={entry.flaw} />
          </span>
        </div>
      )}
      {answer.kind === "unknown" ? null : (
        <DisputePart
          api={props.disputes}
          questionId={answer.questionId}
          first={{
            kind: question.kind,
            verdict: entry.verdict,
            key: question.kind === "choice" ? question.answer : undefined,
            expected: question.kind === "math" ? question.expected : undefined,
            flaw: entry.flaw,
            dispute: entry.dispute,
          }}
          choices={choices}
          onDisputed={props.onDisputed}
        />
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
