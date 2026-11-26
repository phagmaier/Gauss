// Cheat sheets (piece 29, direction A): the panel "Cheat sheets" opens in
// place under the course view's due line, with the kept sheets, newest
// first, above the picking of finished units; the write in progress or
// failed, under the line while the panel is closed; and a sheet's reader,
// at its own address, as the notes have. A write runs on the server and
// outlives the page that started it, as a notes write does.

import { useEffect, useId, useState } from "react";
import {
  type CheatSheet,
  type CheatSheetAttempt,
  CheatSheetList,
  type CheatSheetPost,
} from "../shared/cheat-sheet.ts";
import { CourseWithProgress } from "../shared/library.ts";
import { NOTES_INSTRUCTIONS_LIMIT } from "../shared/notes.ts";
import { getJsonUntilAnswered, post, postFor } from "./api.ts";
import {
  type NumberedUnit,
  notPickable,
  numbered,
  sheetUnits,
  writeSays,
} from "./cheat-sheets.ts";
import { CopyPath, Link, TopLine } from "./Frame.tsx";
import { longDate } from "./Notes.tsx";
import { navigate, paths } from "./route.ts";

export interface CheatSheetsControl {
  api: string;
  /** Undefined until the server answers. */
  list: CheatSheetList | undefined;
  /** A write is being asked for, or the list read again. */
  starting: boolean;
  write(units: readonly string[], instructions: string): Promise<boolean>;
  remove(sheetId: string): Promise<boolean>;
  /** Reads the list again, as when the panel opens: a unit may have finished since. */
  refresh(): void;
  problem: string | undefined;
}

/**
 * A course's cheat sheets, read again each second while one is written.
 * Each consumer is mounted for one course, so an old answer cannot replace
 * another course's list. Off, it asks nothing: only an approved course has
 * cheat sheets.
 */
export function useCheatSheets(
  courseId: string,
  on = true,
): CheatSheetsControl {
  const api = `/api/courses/${encodeURIComponent(courseId)}/cheat-sheets`;
  const [list, setList] = useState<CheatSheetList>();
  const [readProblem, setReadProblem] = useState<string>();
  const [actProblem, setActProblem] = useState<string>();
  const [starting, setStarting] = useState(false);
  // Reads asked for and the last answered. Each ask restarts the effect,
  // which drops a read already in flight: a read that began before a
  // deletion could otherwise list the deleted sheet again.
  const [asked, setAsked] = useState(0);
  const [answered, setAnswered] = useState(0);
  const refreshing = answered < asked;

  useEffect(() => {
    if (!on) return;
    const writing = list?.attempt?.state === "writing";
    if (list !== undefined && !writing && answered >= asked) return;
    const controller = new AbortController();
    const { signal } = controller;
    async function read() {
      const answer = await getJsonUntilAnswered(api, CheatSheetList, {
        signal,
        onFailure: setReadProblem,
      });
      if (answer === undefined || signal.aborted) return;
      setAnswered(asked);
      if (answer.ok) {
        setReadProblem(undefined);
        setList(answer.data);
      } else {
        setReadProblem(answer.error);
      }
    }
    // Follow the background job one request at a time.
    const timer = window.setTimeout(() => void read(), writing ? 1000 : 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [api, on, list, asked, answered]);

  const refresh = () => setAsked((n) => n + 1);

  async function write(units: readonly string[], instructions: string) {
    if (starting || refreshing || list?.attempt?.state === "writing") {
      return false;
    }
    setStarting(true);
    setActProblem(undefined);
    const answer = await postFor(api, CheatSheetList, {
      units: [...units],
      instructions,
    } satisfies CheatSheetPost);
    setStarting(false);
    if (!answer.ok) {
      setActProblem(answer.error);
      // Another write may have started meanwhile, from another page.
      if (answer.status === 409) refresh();
      return false;
    }
    setReadProblem(undefined);
    setList(answer.data);
    return true;
  }

  async function remove(sheetId: string) {
    setActProblem(undefined);
    const refused = await post(`${api}/${encodeURIComponent(sheetId)}/delete`);
    if (refused !== undefined) setActProblem(refused);
    else
      setList(
        (was) =>
          was && {
            ...was,
            sheets: was.sheets.filter((sheet) => sheet.id !== sheetId),
          },
      );
    // A refusal may mean another page deleted it: show what is kept.
    refresh();
    return refused === undefined;
  }

  return {
    api,
    list,
    starting: starting || refreshing,
    write,
    remove,
    refresh,
    problem: actProblem ?? readProblem,
  };
}

const WRITING =
  "Writing the cheat sheet. This takes a minute; you can go on meanwhile.";
const WHAT =
  "One printed page on what the units you pick taught (definitions, formulas and procedures, each with a small example) and what to watch for, from your own misses.";
const NONE =
  "A cheat sheet is written from finished units. None of this course's units is finished yet.";
const DELETE_SAYS = "Delete this cheat sheet? The app cannot bring it back.";

function Problem(props: { text: string | undefined }) {
  return props.text === undefined ? null : (
    <p className="qa-error" role="alert">
      {props.text}
    </p>
  );
}

/** The write running or failed: a row at the top of the list, with the failure's reason and "Try again". */
function AttemptRow(props: {
  attempt: CheatSheetAttempt;
  units: readonly NumberedUnit[];
  sheets: CheatSheetsControl;
}) {
  const { attempt, sheets } = props;
  const named = sheetUnits(attempt.units, props.units);
  return (
    <li className="ch-row">
      <div className="ch-u">
        <b className="ch-w">{named.words}</b>{" "}
        <span className="ch-t">{named.titles}</span>
      </div>
      <div className="ch-state">
        {attempt.state === "writing" ? (
          <>
            <span className="spin" aria-hidden="true" />
            <span role="status">{WRITING}</span>
          </>
        ) : (
          <>
            <span className="no" role="alert">
              The cheat sheet could not be written. {attempt.error}
            </span>
            <button
              type="button"
              className="textbtn"
              disabled={sheets.starting}
              onClick={() =>
                void sheets.write(attempt.units, attempt.instructions)
              }
            >
              Try again
            </button>
          </>
        )}
      </div>
    </li>
  );
}

/** "Open in browser": the system's default app for the sheet's file, one at a time. */
function useOpenInBrowser(api: string) {
  const [opening, setOpening] = useState<string>();
  const [problem, setProblem] = useState<{ sheet: string; error: string }>();
  async function open(sheet: string) {
    setOpening(sheet);
    setProblem(undefined);
    const refused = await post(`${api}/${encodeURIComponent(sheet)}/open`);
    setOpening(undefined);
    if (refused !== undefined) setProblem({ sheet, error: refused });
  }
  return { opening, problem, open };
}

/** The confirmation Delete asks, in a sheet's row and in its reader. */
function ConfirmDelete(props: { onDelete(): void; onKeep(): void }) {
  const [sending, setSending] = useState(false);
  return (
    <div className="confirm">
      <span className="says">
        <span>{DELETE_SAYS}</span>
      </span>
      <button
        type="button"
        className="btn sm quiet"
        disabled={sending}
        onClick={() => {
          setSending(true);
          props.onDelete();
        }}
      >
        Delete the sheet
      </button>
      {/* Once sent, the deletion cannot be called back. */}
      <button
        type="button"
        className="textbtn"
        disabled={sending}
        onClick={props.onKeep}
      >
        Cancel
      </button>
    </div>
  );
}

function SheetRow(props: {
  courseId: string;
  sheet: CheatSheet;
  units: readonly NumberedUnit[];
  sheets: CheatSheetsControl;
  opener: ReturnType<typeof useOpenInBrowser>;
  asking: boolean;
  onAsk(asking: boolean): void;
}) {
  const { sheet, opener } = props;
  const named = sheetUnits(sheet.units, props.units);
  return (
    <li className="ch-row">
      <div className="ch-u">
        <b className="ch-w">{named.words}</b>{" "}
        <span className="ch-t">{named.titles}</span>
      </div>
      <div className="ch-m">
        Written{" "}
        <time dateTime={sheet.writtenAt}>{longDate(sheet.writtenAt)}</time>
        {sheet.instructions === "" ? "" : ", with your instructions"}
      </div>
      <div className="ch-acts">
        <Link
          to={paths.cheatSheet(props.courseId, sheet.id)}
          className="textbtn"
        >
          Open
        </Link>
        <button
          type="button"
          className="textbtn"
          disabled={opener.opening !== undefined}
          onClick={() => void opener.open(sheet.id)}
        >
          {opener.opening === sheet.id ? "Opening…" : "Open in browser"}
        </button>
        {props.asking ? null : (
          <button
            type="button"
            className="textbtn"
            onClick={() => props.onAsk(true)}
          >
            Delete
          </button>
        )}
      </div>
      {props.asking ? (
        <ConfirmDelete
          onDelete={() =>
            void props.sheets.remove(sheet.id).then(() => props.onAsk(false))
          }
          onKeep={() => props.onAsk(false)}
        />
      ) : null}
      {opener.problem?.sheet === sheet.id ? (
        <p className="no ch-wide" role="alert">
          {opener.problem.error}
        </p>
      ) : null}
    </li>
  );
}

/**
 * Under the due line while the panel is closed: the write in progress or
 * failed, if any, and a refusal that came after the panel closed.
 */
export function CheatSheetsLine(props: {
  sheets: CheatSheetsControl;
  units: readonly { id: string; title: string }[];
}) {
  const { sheets } = props;
  const attempt = sheets.list?.attempt;
  return (
    <>
      {attempt === undefined ? null : (
        <ul className="ch-list ch-alone">
          <AttemptRow
            attempt={attempt}
            units={numbered(props.units)}
            sheets={sheets}
          />
        </ul>
      )}
      <Problem text={sheets.problem} />
    </>
  );
}

export function CheatSheetsPanel(props: {
  courseId: string;
  sheets: CheatSheetsControl;
  /** The course's units, in its order. */
  units: readonly { id: string; title: string }[];
  onClose(): void;
}) {
  const { sheets } = props;
  const { list } = sheets;
  const units = numbered(props.units);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [instructions, setInstructions] = useState("");
  const [asking, setAsking] = useState<string>();
  const opener = useOpenInBrowser(sheets.api);
  const field = useId();

  const pickable = units.filter((unit) => list?.pickable.includes(unit.id));
  const chosen = pickable.filter((unit) => picked.has(unit.id));
  const all = pickable.length > 0 && chosen.length === pickable.length;
  const writing = list?.attempt?.state === "writing";
  const cannot =
    list === undefined ? undefined : notPickable(units, list.pickable);

  function pick(unit: string, on: boolean) {
    setPicked((was) => {
      const next = new Set(was);
      if (on) next.add(unit);
      else next.delete(unit);
      return next;
    });
  }

  async function write() {
    const ok = await sheets.write(
      chosen.map((unit) => unit.id),
      instructions.trim(),
    );
    if (ok) {
      setPicked(new Set());
      setInstructions("");
    }
  }

  const kept =
    list === undefined ||
    (list.attempt === undefined && list.sheets.length === 0) ? null : (
      <ul className="ch-list">
        {list.attempt === undefined ? null : (
          <AttemptRow attempt={list.attempt} units={units} sheets={sheets} />
        )}
        {list.sheets.map((sheet) => (
          <SheetRow
            key={sheet.id}
            courseId={props.courseId}
            sheet={sheet}
            units={units}
            sheets={sheets}
            opener={opener}
            asking={asking === sheet.id}
            onAsk={(on) => setAsking(on ? sheet.id : undefined)}
          />
        ))}
      </ul>
    );

  return (
    <section className="st-panel" aria-label="Cheat sheets">
      <div className="ch-h">
        <span className="st-k">Cheat sheets</span>
        {list !== undefined && pickable.length === 0 ? (
          <button type="button" className="textbtn" onClick={props.onClose}>
            Close
          </button>
        ) : null}
      </div>
      {list === undefined ? (
        sheets.problem === undefined ? (
          <p className="ch-none" role="status">
            Loading the cheat sheets…
          </p>
        ) : null
      ) : (
        <>
          {kept}
          {pickable.length === 0 ? (
            <p className="ch-none">{NONE}</p>
          ) : (
            <>
              <div className="ch-q">
                <span className="st-k">
                  {kept === null ? "Write a cheat sheet" : "A new sheet"}
                </span>
                <p className="ch-what">{WHAT}</p>
              </div>
              <fieldset className="ch-q">
                <legend className="st-k">Units</legend>
                <div className="ch-boxes">
                  <label className="ch-all">
                    <input
                      type="checkbox"
                      checked={all}
                      disabled={sheets.starting}
                      onChange={() =>
                        setPicked(
                          all
                            ? new Set()
                            : new Set(pickable.map((unit) => unit.id)),
                        )
                      }
                    />
                    All finished units ({pickable.length})
                  </label>
                  {pickable.map((unit) => (
                    <label
                      key={unit.id}
                      title={`Unit ${unit.number}, ${unit.title}`}
                    >
                      <input
                        type="checkbox"
                        aria-label={`Unit ${unit.number}, ${unit.title}`}
                        checked={picked.has(unit.id)}
                        disabled={sheets.starting}
                        onChange={(e) => pick(unit.id, e.target.checked)}
                      />
                      <span className="ch-name">
                        <span className="cu-n">{unit.number}</span> {unit.title}
                      </span>
                    </label>
                  ))}
                </div>
                {cannot === undefined ? null : (
                  <p className="ch-not">{cannot}</p>
                )}
              </fieldset>
              <div className="ch-q">
                <label className="st-k" htmlFor={field}>
                  Your instructions
                </label>
                <textarea
                  id={field}
                  className="field"
                  rows={2}
                  value={instructions}
                  maxLength={NOTES_INSTRUCTIONS_LIMIT}
                  // What is sent is cleared once accepted: nothing typed
                  // meanwhile is lost with it.
                  disabled={sheets.starting}
                  onChange={(e) => setInstructions(e.target.value)}
                  placeholder="What to focus on, or how to lay it out (optional)"
                />
              </div>
              <div className="st-foot ch-foot">
                <span className="ch-sum" aria-live="polite">
                  {writeSays(
                    chosen.map((unit) => unit.number),
                    writing,
                  )}
                </span>
                <button
                  type="button"
                  className="textbtn"
                  onClick={props.onClose}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn sm"
                  disabled={chosen.length === 0 || writing || sheets.starting}
                  onClick={() => void write()}
                >
                  Write the cheat sheet
                </button>
              </div>
            </>
          )}
        </>
      )}
      <Problem text={sheets.problem} />
    </section>
  );
}

/** A kept sheet: what it covers and where its file is, above the page in a frame. */
export function CheatSheetReader(props: { courseId: string; sheetId: string }) {
  const { courseId, sheetId } = props;
  const sheets = useCheatSheets(courseId);
  const opener = useOpenInBrowser(sheets.api);
  const [course, setCourse] = useState<CourseWithProgress>();
  const [courseProblem, setCourseProblem] = useState<string>();
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    void getJsonUntilAnswered(
      `/api/courses/${encodeURIComponent(courseId)}`,
      CourseWithProgress,
      { signal, onFailure: setCourseProblem },
    ).then((answer) => {
      if (answer === undefined) return;
      if (answer.ok) {
        setCourseProblem(undefined);
        setCourse(answer.data);
      } else {
        setCourseProblem(answer.error);
      }
    });
    return () => controller.abort();
  }, [courseId]);

  const sheet = sheets.list?.sheets.find((s) => s.id === sheetId);
  const named =
    sheet === undefined || course === undefined
      ? undefined
      : sheetUnits(sheet.units, numbered(course.curriculum?.units ?? []));
  const problem = sheets.problem ?? courseProblem;

  return (
    <div className="pg nr">
      <TopLine
        trail={[
          { label: "Library", to: paths.library },
          {
            label: course?.course.title ?? "Course",
            to: paths.course(courseId),
          },
        ]}
        here="Cheat sheet"
        action={
          sheet === undefined ? undefined : (
            <span className="nl-acts">
              <button
                type="button"
                className="textbtn"
                disabled={opener.opening !== undefined}
                onClick={() => void opener.open(sheet.id)}
              >
                {opener.opening === undefined ? "Open in browser" : "Opening…"}
              </button>
              {asking ? null : (
                <button
                  type="button"
                  className="textbtn"
                  onClick={() => setAsking(true)}
                >
                  Delete
                </button>
              )}
            </span>
          )
        }
      />
      <div className="nr-top">
        {sheet === undefined ? null : (
          <>
            {named === undefined ? null : (
              <span>
                <b className="ch-w">{named.words}</b>: {named.titles}.
              </span>
            )}
            <span>
              Written{" "}
              <time dateTime={sheet.writtenAt}>
                {longDate(sheet.writtenAt)}
              </time>
              {sheet.instructions === ""
                ? ", with no instructions of yours."
                : "."}
            </span>
            {sheet.instructions === "" ? null : (
              <span className="nr-instructions">
                Your instructions: {sheet.instructions}
              </span>
            )}
            <div className="qa-path">
              <code className="qa-path-name">{sheet.path}</code>
              <CopyPath path={sheet.path} />
            </div>
            {asking ? (
              <ConfirmDelete
                onDelete={() =>
                  void sheets.remove(sheet.id).then((ok) => {
                    // Not if the learner has gone elsewhere meanwhile.
                    const here = paths.cheatSheet(courseId, sheet.id);
                    if (ok && window.location.pathname === here) {
                      navigate(paths.course(courseId));
                    } else if (!ok) setAsking(false);
                  })
                }
                onKeep={() => setAsking(false)}
              />
            ) : null}
          </>
        )}
        {problem === undefined ? null : (
          <span className="no" role="alert">
            {problem}
          </span>
        )}
        {opener.problem === undefined ? null : (
          <span className="no" role="alert">
            {opener.problem.error}
          </span>
        )}
        {sheets.list === undefined && problem === undefined ? (
          <span role="status">Loading the cheat sheet…</span>
        ) : null}
        {sheets.list !== undefined && sheet === undefined ? (
          <span>
            This course keeps no such cheat sheet.{" "}
            <Link to={paths.course(courseId)}>Back to the course</Link>.
          </span>
        ) : null}
      </div>
      {sheet === undefined ? null : (
        <iframe
          className="nr-frame"
          src={`${sheets.api}/${encodeURIComponent(sheet.id)}/html`}
          sandbox=""
          title={`Cheat sheet, ${named?.words.toLowerCase() ?? "a kept sheet"}`}
        />
      )}
    </div>
  );
}
