// The course view (docs/prototype/07-course.html, with 12-unit-order.html's
// card and Start): the page is the unit list, each unit with where it
// stands, and "Show the diagram" opens the diagram in the side pane, where
// clicking a unit marks it in the list; "What I know" beside it opens every
// objective with the answers behind it (task 2.26). The card at the top
// leads to the unit in progress, or else to the next one. Any unit can be
// started; one whose prerequisites are not finished asks once first (task
// 2.12). "Test out" beside Start, and under the card's "Start unit N", asks
// once, saying what the test is, then opens the unit with its test (task
// 5.6, piece 16). Notes join in stage 5 and sources in stage 4.

import { type ReactNode, useCallback, useEffect, useState } from "react";
import type { StoredUnit } from "../shared/curriculum.ts";
import { IntakeStarted, UnitOpened } from "../shared/events.ts";
import { CourseWithProgress } from "../shared/library.ts";
import { getJson, postFor } from "./api.ts";
import { Diagram, UnitList } from "./Curriculum.tsx";
import { Link, SidePane, TopLine } from "./Frame.tsx";
import {
  courseSummary,
  type Lead,
  lead,
  progressOf,
  unfinishedPrerequisites,
  unitMark,
} from "./progress.ts";
import { navigate, paths } from "./route.ts";
import { unitNumbers } from "./units.ts";

export function Course(props: { courseId: string }) {
  const { courseId } = props;
  // Undefined while loading, null when there is no such course.
  const [stored, setStored] = useState<CourseWithProgress | null>();
  const [problem, setProblem] = useState<string>();
  const [diagramOpen, setDiagramOpen] = useState(false);
  const [selected, setSelected] = useState<string>();
  /**
   * The unit that asks before it opens: Start, its prerequisites not
   * finished, or "Test out", from its row or from the card.
   */
  const [asking, setAsking] = useState<Asking>();
  const closeDiagram = useCallback(() => {
    setDiagramOpen(false);
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
  const title = stored?.course.title ?? (stored === null ? "Not found" : "");
  const toUnit = (unit: StoredUnit) => navigate(paths.unit(courseId, unit.id));
  const leadsTo = stored == null ? null : lead(stored);

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

  /** What the learner can do with a unit of an approved course, under its goal. */
  function unitAction(course: CourseWithProgress, unit: StoredUnit) {
    switch (progressOf(course.progress, unit.id).status) {
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
      default:
        // A finished unit opens to how it finished; its notes join in stage 5.
        return (
          <Link to={paths.unit(courseId, unit.id)} className="textbtn">
            Open
          </Link>
        );
    }
  }
  return (
    <div className={diagramOpen ? "pg has-pane" : "pg"}>
      <TopLine
        trail={[{ label: "Library", to: paths.library }]}
        here={title}
        action={
          draft ? (
            <button
              type="button"
              className="btn sm"
              onClick={() => void review()}
            >
              Review the curriculum
            </button>
          ) : undefined
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
              <p className="cv-at">{whereItStands(stored)}</p>
              {leadsTo === null ? null : (
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
                  <div className="cv-hrow">
                    <h2 className="pg-h">Units</h2>
                    <span className="cv-acts">
                      {draft ? null : (
                        <Link to={paths.known(courseId)} className="textbtn">
                          What I know
                        </Link>
                      )}
                      <button
                        type="button"
                        className="textbtn"
                        aria-expanded={diagramOpen}
                        onClick={() =>
                          diagramOpen ? closeDiagram() : setDiagramOpen(true)
                        }
                      >
                        {diagramOpen ? "Hide the diagram" : "Show the diagram"}
                      </button>
                    </span>
                  </div>
                  {draft ? (
                    <UnitList units={curriculum.units} selected={selected} />
                  ) : (
                    <UnitList
                      units={curriculum.units}
                      selected={selected}
                      state={(unit) => unitMark(stored, unit).state}
                      mark={(unit) => unitMark(stored, unit)}
                      action={(unit) => unitAction(stored, unit)}
                      after={(unit) =>
                        asking?.unit === unit.id && asking.card !== true
                          ? confirm(stored, unit)
                          : null
                      }
                    />
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>
      {diagramOpen && curriculum !== null ? (
        <SidePane
          title="Curriculum"
          subtitle="How the units build on each other"
          onClose={closeDiagram}
        >
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

function whereItStands(stored: CourseWithProgress): string {
  const { curriculum } = stored;
  if (curriculum === null) return "No curriculum was proposed.";
  if (curriculum.approval.status === "draft") {
    return "The curriculum is waiting for your review.";
  }
  return courseSummary(stored);
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
