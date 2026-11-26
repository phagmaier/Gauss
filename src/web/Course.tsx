// The course view (docs/prototype/20-course.html, with 12-unit-order.html's
// card and Start): the title, a line of counts, how many objectives are due
// for review when any are (task 5.24) with "Review now", which starts a
// review in a unit's thread and opens it (task 5.25), "Self-test" beside
// it, which opens its panel in place (piece 27), and "Cheat sheets", which
// opens theirs (piece 29), the card that leads
// on, and the unit list down to objectives. Each unit is a heading that opens and
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
// conversation (task 5.38). At the foot, a course or a draft can be deleted
// (task 5.18).

import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  BACKEND_TITLES,
  CourseSettings,
  NO_WEB_SEARCH_ON_CODEX,
} from "../shared/course.ts";
import {
  type StoredUnit,
  type Unit,
  unitSections,
} from "../shared/curriculum.ts";
import { IntakeStarted, ReviewStarted, UnitOpened } from "../shared/events.ts";
import {
  CourseWithProgress,
  courseInstance,
  deletionAsksTitle,
} from "../shared/library.ts";
import type { Outline } from "../shared/source.ts";
import type { SourceTarget } from "../shared/source-target.ts";
import { isFinished } from "../shared/status.ts";
import { getJson, post, postFor } from "./api.ts";
import {
  CheatSheetsLine,
  CheatSheetsPanel,
  useCheatSheets,
} from "./CheatSheets.tsx";
import { Diagram, UnitList, UnitReadLines } from "./Curriculum.tsx";
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
import { courseSourceLine } from "./reads.ts";
import { navigate, paths } from "./route.ts";
import { SelfTestPanel } from "./SelfTestPanel.tsx";
import { SourcePane } from "./SourcePane.tsx";
import { StatusForm } from "./StatusForm.tsx";
import { pickableUnits } from "./self-test.ts";
import { useCourseSources } from "./sources.ts";
import { buildsOn, unitNumbers } from "./units.ts";
import { objectiveMark, unitWord } from "./what-i-know.ts";
import "./course-sources.css";

export function Course(props: { courseId: string }) {
  const { courseId } = props;
  // Undefined while loading, null when there is no such course.
  const [stored, setStored] = useState<CourseWithProgress | null>();
  const [problem, setProblem] = useState<string>();
  const [pane, setPane] = useState<
    "map" | Extract<SourceTarget, { kind: "outline" }>
  >();
  const mapOpen = pane === "map";
  const { sources, problem: sourceProblem } = useCourseSources(
    courseId,
    stored != null,
  );
  const openSource =
    typeof pane === "object"
      ? sources?.find((s) => s.id === pane.source)
      : undefined;
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
  /** "Review now" is starting a review, so it is not pressed twice. */
  const [starting, setStarting] = useState(false);
  /** The panel open under the due line, the self-test's or the cheat sheets'. */
  const [panel, setPanel] = useState<"self-test" | "cheat-sheets">();
  const closePane = useCallback(() => {
    setPane(undefined);
    setSelected(undefined);
  }, []);

  function openOutline(source: string, unit?: string) {
    setSelected(undefined);
    setPane(
      unit === undefined
        ? { kind: "outline", source }
        : { kind: "outline", source, unit },
    );
  }

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

  /** Starts a review of what is due in a unit's thread, then opens that unit. */
  async function reviewNow() {
    setStarting(true);
    const answer = await postFor(
      `/api/courses/${encodeURIComponent(courseId)}/review-now`,
      ReviewStarted,
    );
    setStarting(false);
    if (answer.ok) navigate(paths.unit(courseId, answer.data.unit));
    else setProblem(answer.error);
  }

  const unreadable = stored?.problem;
  const curriculum =
    unreadable === undefined ? (stored?.curriculum ?? null) : null;
  const draft = curriculum?.approval.status === "draft";
  const approved = curriculum?.approval.status === "approved";
  const title = stored?.course.title ?? (stored === null ? "Not found" : "");
  const toUnit = (unit: StoredUnit) => navigate(paths.unit(courseId, unit.id));
  const leadsTo =
    stored == null || unreadable !== undefined ? null : lead(stored);
  // An approved course with nothing to lead to has every unit finished.
  const finished = approved && leadsTo === null;
  // Asked for as soon as the course reads as approved, so the due line says
  // how many are kept, and a write in progress shows, before the panel opens.
  const sheets = useCheatSheets(courseId, approved && unreadable === undefined);

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
    <div className={mapOpen || openSource !== undefined ? "pg has-pane" : "pg"}>
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
              onToggle={() => (mapOpen ? closePane() : setPane("map"))}
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
              {unreadable !== undefined ? (
                <p className="ph-note">{unreadable}</p>
              ) : approved ? (
                <Counts counts={courseCounts(stored)} finished={finished} />
              ) : (
                <p className="cv-at">
                  {draft
                    ? "The curriculum is waiting for your review."
                    : "No curriculum was proposed."}
                </p>
              )}
              <p className="cv-meta cv-on">
                <span>
                  Runs on <b>{BACKEND_TITLES[stored.course.backend]}</b>
                </span>
              </p>
              {!approved || unreadable !== undefined ? null : (
                <DueCount
                  due={stored.due}
                  starting={starting}
                  onReview={() => void reviewNow()}
                  onSelfTest={() => setPanel("self-test")}
                  kept={sheets.list?.sheets.length}
                  sheetsOpen={panel === "cheat-sheets"}
                  onCheatSheets={() => {
                    if (panel === "cheat-sheets") setPanel(undefined);
                    else {
                      // A unit may have finished since the list was read.
                      sheets.refresh();
                      setPanel("cheat-sheets");
                    }
                  }}
                />
              )}
              {!approved ||
              unreadable !== undefined ||
              curriculum === null ? null : panel === "cheat-sheets" ? (
                <CheatSheetsPanel
                  courseId={courseId}
                  sheets={sheets}
                  units={curriculum.units}
                  onClose={() => setPanel(undefined)}
                />
              ) : (
                <>
                  <CheatSheetsLine sheets={sheets} units={curriculum.units} />
                  {panel === "self-test" ? (
                    <SelfTestPanel
                      courseId={courseId}
                      units={pickableUnits(curriculum.units)}
                      onCancel={() => setPanel(undefined)}
                      onStarted={(unit) => navigate(paths.unit(courseId, unit))}
                      onProblem={setProblem}
                    />
                  ) : null}
                </>
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
                    <UnitList
                      units={curriculum.units}
                      selected={selected}
                      sources={sources}
                      onOutline={openOutline}
                    />
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
                            sources={sources}
                            onOutline={openOutline}
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
              {sourceProblem === undefined ? null : (
                <p className="qa-error" role="alert">
                  {sourceProblem}
                </p>
              )}
              {sources !== undefined && (sources.length > 0 || approved) ? (
                <CourseSources
                  sources={sources}
                  units={curriculum?.units}
                  showing={openSource?.id}
                  onOpen={openOutline}
                  {...(approved ? { planning: paths.planning(courseId) } : {})}
                />
              ) : null}
              {approved ? (
                <WebSetting
                  courseId={courseId}
                  on={stored.course.settings.webSearch}
                  codex={stored.course.backend === "codex"}
                  sources={sources !== undefined && sources.length > 0}
                  onChange={(settings) =>
                    setStored(
                      (was) =>
                        was && { ...was, course: { ...was.course, settings } },
                    )
                  }
                />
              ) : null}
              <DeleteOffer key={stored.id} course={stored} />
            </>
          )}
        </div>
      </div>
      {mapOpen && curriculum !== null ? (
        <SidePane title="Course map" subtitle={title} onClose={closePane}>
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
      ) : typeof pane === "object" && openSource !== undefined ? (
        <SourcePane
          base={`/api/courses/${encodeURIComponent(courseId)}/sources`}
          source={openSource}
          target={pane}
          units={curriculum?.units ?? []}
          onClose={closePane}
        />
      ) : null}
    </div>
  );
}

/**
 * The sources belong to the course even when no unit names one of their
 * sections. An approved course says where another is added (piece 26).
 */
function CourseSources(props: {
  sources: readonly Outline[];
  units: readonly Unit[] | undefined;
  showing: string | undefined;
  onOpen(source: string): void;
  /** The planning conversation's path, where a source is added. */
  planning?: string;
}) {
  const { sources, units } = props;
  const rows = useMemo(() => {
    const named = new Set(units?.flatMap((unit) => unitSections(unit)));
    return sources.map((source) => ({
      source,
      line: courseSourceLine(source, named),
    }));
  }, [sources, units]);
  return (
    <section aria-label="Sources">
      <div className="cv-hrow cv-sec">
        <h2 className="pg-h">Sources</h2>
      </div>
      {sources.length === 0 ? null : (
        <ul className="cv-sources">
          {rows.map(({ source, line }) => (
            <li key={source.id}>
              <button
                type="button"
                aria-pressed={props.showing === source.id}
                onClick={() => props.onOpen(source.id)}
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M2 3.2c2-.9 4-.9 6 .4 2-1.3 4-1.3 6-.4v9.6c-2-.9-4-.9-6 .4-2-1.3-4-1.3-6-.4zM8 3.6v9.6" />
                </svg>
                <span className="cv-src-title">{source.title}</span>
                <span className="cv-src-go">
                  {props.showing === source.id ? "Showing" : "Outline"}
                </span>
                <span className="cv-src-facts">{line}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {props.planning === undefined ? null : (
        <p className="cv-src-add">
          To add a book or paper, attach it in{" "}
          <Link to={props.planning}>Change the curriculum</Link>. It joins the
          course when you apply a change.
        </p>
      )}
    </section>
  );
}

/**
 * "The web" (piece 24): the course's web search setting, a switch off by
 * default, saying what a search sends and when a change applies. A Codex
 * course has none: its switch stays off, with the reason.
 */
function WebSetting(props: {
  courseId: string;
  on: boolean;
  codex: boolean;
  /** The course has sources, which the tutor searches only beyond. */
  sources: boolean;
  onChange(settings: CourseSettings): void;
}) {
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<string>();

  async function toggle() {
    setSending(true);
    setProblem(undefined);
    const answer = await postFor(
      `/api/courses/${encodeURIComponent(props.courseId)}/settings`,
      CourseSettings,
      { webSearch: !props.on } satisfies CourseSettings,
    );
    setSending(false);
    if (answer.ok) props.onChange(answer.data);
    else setProblem(answer.error);
  }

  return (
    <section aria-label="The web">
      <div className="cv-hrow cv-sec">
        <h2 className="pg-h">The web</h2>
      </div>
      <div className="sw">
        <button
          type="button"
          className="tog"
          role="switch"
          aria-checked={props.on && !props.codex}
          aria-labelledby="web-search"
          disabled={sending || props.codex}
          onClick={() => void toggle()}
        />
        <div className="t">
          <span id="web-search">Web search</span>
          <span className="st">{props.on && !props.codex ? "On" : "Off"}</span>
        </div>
        {props.codex ? (
          <p>{NO_WEB_SEARCH_ON_CODEX}</p>
        ) : (
          <>
            <p>
              The tutor may search the web for what{" "}
              {props.sources
                ? "the sources and its own knowledge lack"
                : "its own knowledge lacks"}
              {", and cites what it uses. "}A search sends the words the tutor
              searches for to Anthropic's web search; the tutor never opens a
              page.
            </p>
            <p>
              Turning it on or off applies from your next message in each unit.
            </p>
          </>
        )}
      </div>
      {problem === undefined ? null : (
        <p className="qa-error" role="alert">
          {problem}
        </p>
      )}
    </section>
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

/**
 * How many of the course's objectives are due for review, under the counts,
 * with "Review now" (piece 20); "Self-test", due or not (piece 27); and
 * "Cheat sheets", with how many are kept (piece 29).
 */
export function DueCount(props: {
  due: number | undefined;
  starting: boolean;
  onReview(): void;
  onSelfTest(): void;
  /** How many cheat sheets are kept; undefined until the list is read. */
  kept: number | undefined;
  sheetsOpen: boolean;
  onCheatSheets(): void;
}) {
  const { due } = props;
  return (
    <div className="cv-due">
      {due === undefined ? (
        <span className="k">Nothing is due for review.</span>
      ) : (
        <>
          <span className="due-dot" aria-hidden="true" />
          <span>
            <b>
              {due} {due === 1 ? "objective" : "objectives"}
            </b>{" "}
            <span className="k">{due === 1 ? "is" : "are"} due for review</span>
          </span>
        </>
      )}
      <span className="cv-due-acts">
        {due === undefined ? null : (
          <button
            type="button"
            className="btn sm quiet"
            disabled={props.starting}
            onClick={props.onReview}
          >
            Review now
          </button>
        )}
        <button type="button" className="textbtn" onClick={props.onSelfTest}>
          Self-test
        </button>
        <button
          type="button"
          className="textbtn"
          aria-expanded={props.sheetsOpen}
          onClick={props.onCheatSheets}
        >
          Cheat sheets
        </button>
        {props.kept === undefined || props.kept === 0 ? null : (
          <span className="cv-due-n">{props.kept} kept</span>
        )}
      </span>
    </div>
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
  sources: readonly Outline[] | undefined;
  onOutline(source: string, unit: string): void;
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
          <UnitReadLines
            unit={unit}
            sources={props.sources}
            onOutline={props.onOutline}
          />
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

/**
 * "Delete course" at the foot of the view (task 5.18): a plain confirmation
 * for a draft or a course not started, and the title typed for one that has
 * started, saying what goes. The server refuses while anything of the
 * course is open or runs, and says what.
 */
function DeleteOffer(props: { course: CourseWithProgress }) {
  const { course } = props;
  const [asking, setAsking] = useState(false);
  const [typed, setTyped] = useState("");
  const [problem, setProblem] = useState<string>();
  const [sending, setSending] = useState(false);
  const typing = deletionAsksTitle(course);
  const draft = course.curriculum?.approval.status !== "approved";
  const title = course.course.title;

  async function remove() {
    setSending(true);
    const refused = await post(
      `/api/courses/${encodeURIComponent(course.id)}/delete`,
      {
        instance: courseInstance(course.course),
        ...(typing ? { title: typed } : {}),
      },
    );
    setSending(false);
    if (refused === undefined) navigate(paths.library);
    else setProblem(refused);
  }

  function cancel() {
    setAsking(false);
    setTyped("");
    setProblem(undefined);
  }

  return (
    <section className="cv-del" aria-label="Delete">
      {asking ? (
        <div className="confirm">
          <span className="says">
            {typing ? (
              <>
                <span>
                  Deleting the course removes everything in it: your progress,
                  the unit notes, the cheat sheets, the transcripts, and the
                  files in its workspace. The app cannot bring it back.
                </span>
                <span>
                  To delete it, type its title: <b>{title}</b>
                </span>
              </>
            ) : (
              <span>
                {draft
                  ? "Delete this draft? The app cannot bring it back."
                  : "Delete this course? No unit has started. The app cannot bring it back."}
              </span>
            )}
          </span>
          {typing ? (
            <input
              className="field cv-del-title"
              aria-label="The course's title"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
            />
          ) : null}
          <button
            type="button"
            className="btn quiet"
            disabled={sending || (typing && typed.trim() !== title.trim())}
            onClick={() => void remove()}
          >
            {draft ? "Delete the draft" : "Delete the course"}
          </button>
          <button type="button" className="textbtn" onClick={cancel}>
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="textbtn"
          onClick={() => setAsking(true)}
        >
          {draft ? "Delete this draft" : "Delete this course"}
        </button>
      )}
      {problem === undefined ? null : <p className="qa-error">{problem}</p>}
    </section>
  );
}
