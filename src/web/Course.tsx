// The course view (docs/prototype/20-course.html, with 12-unit-order.html's
// card and Start): the title, a line of counts, the card that leads on, and
// the unit list down to objectives. Each unit is a heading that opens and
// folds; a started unit lists its objectives, "Next" on the one to do in the
// card's unit, and a unit not started its goal. "Course map" in the top line
// opens the diagram in the side pane, where picking a unit scrolls the list
// to it; "What I know" beside it opens every objective with the answers
// behind it (task 2.26). Any unit can be started; one whose prerequisites are
// not finished asks once first (task 2.12). "Test out" beside Start, and
// under the card's "Start unit N", asks once, saying what the test is, then
// opens the unit with its test (task 5.6, piece 16). Finished units offer
// notes (task 5.9, piece 17). "Change the curriculum" above the units, and
// a finished course's "Plan what comes next", open the course's planning
// conversation (task 5.38).

import { type ReactNode, useCallback, useEffect, useState } from "react";
import type { StoredUnit } from "../shared/curriculum.ts";
import { IntakeStarted, UnitOpened } from "../shared/events.ts";
import { CourseWithProgress } from "../shared/library.ts";
import { isFinished } from "../shared/status.ts";
import { getJson, postFor } from "./api.ts";
import { Diagram, UnitList } from "./Curriculum.tsx";
import { CourseMapButton, Link, SidePane, TopLine } from "./Frame.tsx";
import { NotesOffer } from "./Notes.tsx";
import {
  type CourseCounts,
  courseCounts,
  type Lead,
  lead,
  type UnitRow,
  unfinishedPrerequisites,
  unitMark,
  unitRows,
} from "./progress.ts";
import { InlineProse } from "./prose.tsx";
import { navigate, paths } from "./route.ts";
import { StatusForm } from "./StatusForm.tsx";
import { buildsOn, unitNumbers } from "./units.ts";
import { objectiveMark, unitWord } from "./what-i-know.ts";

export function Course(props: { courseId: string }) {
  const { courseId } = props;
  // Undefined while loading, null when there is no such course.
  const [stored, setStored] = useState<CourseWithProgress | null>();
  const [problem, setProblem] = useState<string>();
  const [mapOpen, setMapOpen] = useState(false);
  const [selected, setSelected] = useState<string>();
  /**
   * The units the learner opened or folded, by id; the others are open while
   * in progress. Held here, so it outlasts the course map opening and closing.
   */
  const [folding, setFolding] = useState<Record<string, boolean>>({});
  /**
   * The unit that asks before it opens: Start, its prerequisites not
   * finished, or "Test out", from its row or from the card.
   */
  const [asking, setAsking] = useState<Asking>();
  const closeMap = useCallback(() => {
    setMapOpen(false);
    setSelected(undefined);
  }, []);

  useEffect(() => {
    void getJson(
      `/api/courses/${encodeURIComponent(courseId)}`,
      CourseWithProgress,
    ).then((answer) => {
      if (answer.ok) setStored(answer.data);
      else if (answer.status === 404) setStored(null);
      else setProblem(answer.error);
    });
  }, [courseId]);

  async function review() {
    const answer = await postFor(
      `/api/courses/${encodeURIComponent(courseId)}/review`,
      IntakeStarted,
    );
    if (answer.ok) navigate(paths.intake(answer.data.intakeId));
    else setProblem(answer.error);
  }

  const curriculum = stored?.curriculum ?? null;
  const draft = curriculum?.approval.status === "draft";
  const approved = curriculum?.approval.status === "approved";
  const title = stored?.course.title ?? (stored === null ? "Not found" : "");
  const toUnit = (unit: StoredUnit) => navigate(paths.unit(courseId, unit.id));
  const leadsTo = stored == null ? null : lead(stored);
  // An approved course with nothing to lead to has every unit finished.
  const finished = approved && leadsTo === null;

  /** Opens the unit with its test, then follows it to its session. */
  async function testOut(unit: StoredUnit) {
    const answer = await postFor(
      `/api/courses/${encodeURIComponent(courseId)}/units/${encodeURIComponent(unit.id)}/test-out`,
      UnitOpened,
    );
    setAsking(undefined);
    if (answer.ok) toUnit(unit);
    else setProblem(answer.error);
  }

  /** What a unit asks before it opens: Start anyway, or Start the test. */
  function confirm(course: CourseWithProgress, unit: StoredUnit) {
    const waits = unfinishedPrerequisites(course, unit);
    const builds =
      waits.length === 0
        ? ""
        : `This builds on ${unitNumbers(waits)}, not finished yet. `;
    return asking?.kind === "test" ? (
      <span className="confirm">
        <span className="says">
          <span>
            {builds}
            {TEST_IS}
          </span>
        </span>
        <button
          type="button"
          className="textbtn"
          onClick={() => void testOut(unit)}
        >
          Start the test
        </button>
        <button
          type="button"
          className="textbtn"
          onClick={() => setAsking(undefined)}
        >
          Cancel
        </button>
      </span>
    ) : (
      <span className="confirm">
        <span>{builds.trimEnd()}</span>
        <button type="button" className="textbtn" onClick={() => toUnit(unit)}>
          Start anyway
        </button>
        <button
          type="button"
          className="textbtn"
          onClick={() => setAsking(undefined)}
        >
          Cancel
        </button>
      </span>
    );
  }

  /** What the learner can do with a unit of an approved course, under its objectives or goal. */
  function unitAction(course: CourseWithProgress, row: UnitRow) {
    const { unit } = row;
    switch (row.status) {
      case "in-progress":
        return (
          <Link to={paths.unit(courseId, unit.id)} className="textbtn">
            Continue
          </Link>
        );
      case "not-started":
        return asking?.unit === unit.id && asking.card !== true ? null : (
          <>
            <button
              type="button"
              className="textbtn"
              onClick={() =>
                unfinishedPrerequisites(course, unit).length === 0
                  ? toUnit(unit)
                  : setAsking({ unit: unit.id, kind: "start" })
              }
            >
              Start
            </button>
            <button
              type="button"
              className="textbtn"
              onClick={() => setAsking({ unit: unit.id, kind: "test" })}
            >
              Test out
            </button>
          </>
        );
      case "passed":
      case "overridden":
        return (
          <>
            <Link to={paths.unit(courseId, unit.id)} className="textbtn">
              Open
            </Link>
            <NotesOffer
              key={unit.id}
              courseId={courseId}
              unitId={unit.id}
              row
            />
          </>
        );
    }
  }

  return (
    <div className={mapOpen ? "pg has-pane" : "pg"}>
      <TopLine
        trail={[{ label: "Library", to: paths.library }]}
        here={title}
        action={
          <div className="nl-tools">
            {draft ? (
              <button
                type="button"
                className="btn sm"
                onClick={() => void review()}
              >
                Review the curriculum
              </button>
            ) : null}
            <CourseMapButton
              open={mapOpen}
              disabled={curriculum === null}
              onToggle={() => (mapOpen ? closeMap() : setMapOpen(true))}
            />
            {approved ? (
              <Link to={paths.known(courseId)} className="nl-pos">
                What I know
              </Link>
            ) : null}
          </div>
        }
      />
      <div className="pg-scroll">
        <div className="pg-col">
          {problem === undefined ? null : <p className="ph-note">{problem}</p>}
          {stored === null ? (
            <p className="ph-note">
              There is no course here. Back to the{" "}
              <Link to={paths.library}>library</Link>.
            </p>
          ) : stored === undefined ? null : (
            <>
              <h1 className="cv-title">{title}</h1>
              {approved ? (
                <Counts counts={courseCounts(stored)} finished={finished} />
              ) : (
                <p className="cv-at">
                  {draft
                    ? "The curriculum is waiting for your review."
                    : "No curriculum was proposed."}
                </p>
              )}
              {finished ? (
                <FinishedCard
                  onPlan={() => navigate(paths.planning(courseId))}
                />
              ) : leadsTo === null ? null : (
                <LeadCard
                  lead={leadsTo}
                  onGo={toUnit}
                  onTestOut={(unit) =>
                    setAsking({ unit: unit.id, kind: "test", card: true })
                  }
                  asking={
                    leadsTo.kind !== "in-progress" &&
                    asking?.card === true &&
                    asking.unit === leadsTo.unit.id
                      ? confirm(stored, leadsTo.unit)
                      : null
                  }
                  unitPath={(unit) => paths.unit(courseId, unit.id)}
                />
              )}
              {curriculum === null ? null : (
                <>
                  <div className="cv-hrow cv-sec">
                    <h2 className="pg-h">Units</h2>
                    {approved ? (
                      <Link to={paths.planning(courseId)} className="textbtn">
                        Change the curriculum
                      </Link>
                    ) : null}
                  </div>
                  {draft ? (
                    <UnitList units={curriculum.units} selected={selected} />
                  ) : (
                    <ul className="cv-units">
                      {unitRows(stored).map((row) => {
                        const open = folding[row.unit.id] ?? row.open;
                        return (
                          <UnitEntry
                            key={row.unit.id}
                            row={row}
                            open={open}
                            selected={selected === row.unit.id}
                            onToggle={() =>
                              setFolding((was) => ({
                                ...was,
                                [row.unit.id]: !open,
                              }))
                            }
                            buildsOn={buildsOn(row.unit, curriculum.units)}
                            action={unitAction(stored, row)}
                            after={
                              asking?.unit === row.unit.id &&
                              asking.card !== true
                                ? confirm(stored, row.unit)
                                : null
                            }
                          />
                        );
                      })}
                    </ul>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>
      {mapOpen && curriculum !== null ? (
        <SidePane title="Course map" subtitle={title} onClose={closeMap}>
          <Diagram
            units={curriculum.units}
            standing={(id) => {
              const unit = curriculum.units.find((u) => u.id === id);
              return draft || stored == null || unit === undefined
                ? { state: "todo", text: "" }
                : unitMark(stored, unit);
            }}
            selected={selected}
            onSelect={(id) => {
              setSelected(id);
              document
                .getElementById(`unit-${id}`)
                ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
            }}
          />
        </SidePane>
      ) : null}
    </div>
  );
}

/** A unit that asks before it opens, from its row or, for "Test out", from the card. */
interface Asking {
  unit: string;
  kind: "start" | "test";
  card?: boolean;
}

/** What "Test out" says before the test starts (piece 16). */
const TEST_IS =
  "A test on this unit's objectives before anything is taught, with no " +
  "explanations until it ends. It skips nothing by itself: you see what " +
  "you passed, and then you choose.";

/** The line under the title (piece 20). */
function Counts(props: { counts: CourseCounts; finished: boolean }) {
  const { units, finished, passed, objectives } = props.counts;
  return (
    <p className="cv-meta">
      <span>
        <b>{units}</b> {units === 1 ? "unit" : "units"}
      </span>
      <span>
        <b>{finished}</b> finished
      </span>
      {objectives === 0 ? null : (
        <span>
          <b>{passed}</b> of {objectives}{" "}
          {objectives === 1 ? "objective" : "objectives"} passed
          {props.finished ? "" : " in the units started"}
        </span>
      )}
    </p>
  );
}

const CHEVRON = (
  <svg
    className="cv-chev"
    width="11"
    height="11"
    viewBox="0 0 12 12"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    aria-hidden="true"
  >
    <path d="M4.5 3 7.5 6 4.5 9" />
  </svg>
);

/**
 * A unit in the list (piece 20): a heading that opens and folds it, with
 * "Unit N", its title, how many of its objectives passed and its form; open,
 * its objectives, or its goal before it starts, and what can be done with it.
 */
function UnitEntry(props: {
  row: UnitRow;
  open: boolean;
  selected: boolean;
  onToggle(): void;
  buildsOn: string | null;
  action: ReactNode;
  after: ReactNode;
}) {
  const { row, open } = props;
  const { unit, objectives } = row;
  const className = [
    "cv-u",
    open ? undefined : "fold",
    isFinished(row.status) ? "fin" : undefined,
    row.mark.state === "now" ? "here" : undefined,
    props.selected ? "sel" : undefined,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <li id={`unit-${unit.id}`} className={className}>
      <h3 className="cv-uh">
        <button type="button" aria-expanded={open} onClick={props.onToggle}>
          <span className="cv-un">Unit {row.number}</span>
          <span className="cv-ut">{unit.title}</span>
          <span className="cv-uc">
            {objectives === undefined
              ? null
              : `${row.passed} of ${objectives.length} passed`}
            <StatusForm {...row.mark.form} />
            <span className="sr">{unitWord(row.status).text}</span>
            {CHEVRON}
          </span>
        </button>
      </h3>
      {open ? (
        <>
          {objectives === undefined ? (
            <p className="cv-ug">
              {unit.goal}
              {row.status === "not-started"
                ? " Its objectives are set when it starts."
                : ""}
            </p>
          ) : (
            <ul className="cv-obs">
              {objectives.map((o) => {
                const word = o.next
                  ? { text: "Next", className: "next" }
                  : objectiveMark(o.status);
                return (
                  <li
                    key={o.id}
                    className={
                      o.next
                        ? "cv-ob next"
                        : o.status === "not-started"
                          ? "cv-ob todo"
                          : "cv-ob"
                    }
                  >
                    <StatusForm objective={o.status} current={o.next} />
                    <span>
                      <InlineProse text={o.statement} />
                    </span>
                    <span className={`cv-os ${word.className}`}>
                      {word.text}
                      {o.next ? (
                        <span className="sr">
                          , {objectiveMark(o.status).text}
                        </span>
                      ) : null}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="cv-ua">
            {props.buildsOn === null ? null : <span>{props.buildsOn}</span>}
            {props.action}
          </div>
          {props.after}
        </>
      ) : null}
    </li>
  );
}

/** The card on a finished course (piece 20). */
function FinishedCard(props: { onPlan(): void }) {
  return (
    <section className="cn" aria-label="Course finished">
      <div>
        <div className="cn-k">Course finished</div>
        <div className="cn-t">Every unit is finished</div>
        <div className="cn-g">
          To go further, plan more units: the planner sees what you know.
        </div>
      </div>
      <div className="cn-go">
        <button type="button" className="btn" onClick={props.onPlan}>
          Plan what comes next
        </button>
      </div>
    </section>
  );
}

/**
 * The card above the units (piece 12): the unit in progress and where in it
 * the learner is, with the other units in progress one line each, or else
 * the next unit in order and its goal.
 */
function LeadCard(props: {
  lead: Lead;
  onGo(unit: StoredUnit): void;
  /** "Test out", under "Start unit N" of a unit not started. */
  onTestOut(unit: StoredUnit): void;
  /** What "Test out" asks, under the card, while it asks. */
  asking: ReactNode;
  unitPath(unit: StoredUnit): string;
}) {
  const { lead } = props;
  const now = lead.kind === "in-progress";
  const where = now ? lead.where : null;
  return (
    <section className="cn" aria-label={now ? "In progress" : "Up next"}>
      <div>
        <div className="cn-k">{now ? "In progress" : "Up next"}</div>
        <div className="cn-t">
          <span>Unit {lead.number}</span>
          {lead.unit.title}
        </div>
        {where === null ? (
          <div className="cn-g">{lead.unit.goal}</div>
        ) : (
          <div className="cn-at">
            <span className="ticks" aria-hidden="true">
              {where.ticks.map((mark, i) => (
                // One tick per segment of the plan, in order.
                // biome-ignore lint/suspicious/noArrayIndexKey: see above
                <i key={i} className={mark} />
              ))}
            </span>
            <span>
              {where.title === undefined
                ? where.label
                : `${where.label}: ${where.title}`}
            </span>
          </div>
        )}
      </div>
      <div className="cn-go">
        <button
          type="button"
          className="btn"
          onClick={() => props.onGo(lead.unit)}
        >
          {now ? "Continue" : `Start unit ${lead.number}`}
        </button>
        {now || props.asking !== null ? null : (
          <button
            type="button"
            className="textbtn"
            onClick={() => props.onTestOut(lead.unit)}
          >
            Test out
          </button>
        )}
      </div>
      {props.asking === null ? null : (
        <div className="cn-ask">{props.asking}</div>
      )}
      {now
        ? lead.others.map((other) => (
            <div key={other.unit.id} className="cn-also">
              <span>
                Also in progress: unit {other.number}, {other.unit.title}
              </span>
              <Link to={props.unitPath(other.unit)} className="textbtn">
                Continue
              </Link>
            </div>
          ))
        : null}
    </section>
  );
}
