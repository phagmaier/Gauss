// Unit notes (prototype 17) are written on request, outside the tutor's chat.
import { useEffect, useId, useRef, useState } from "react";
import { NOTES_INSTRUCTIONS_LIMIT, NotesView } from "../shared/notes.ts";
import { getJsonUntilAnswered, post, postFor } from "./api.ts";
import { CopyPath, Link, TopLine } from "./Frame.tsx";
import { paths } from "./route.ts";

interface UnitAddress {
  courseId: string;
  unitId: string;
}

interface NotesControl {
  api: string;
  to: string;
  view: NotesView | undefined;
  starting: boolean;
  write(instructions: string): Promise<boolean>;
  problem: string | undefined;
}

/** Each consumer is mounted for one unit, so an old response cannot replace another unit's notes. */
function useNotes({ courseId, unitId }: UnitAddress): NotesControl {
  const to = paths.notes(courseId, unitId);
  const api = `/api${to}`;
  const [view, setView] = useState<NotesView>();
  const [readProblem, setReadProblem] = useState<string>();
  const [writeProblem, setWriteProblem] = useState<string>();
  const [starting, setStarting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    const writing = view?.attempt?.state === "writing";
    if (view !== undefined && !writing && !refreshing) return;
    const controller = new AbortController();
    const { signal } = controller;
    async function read() {
      const answer = await getJsonUntilAnswered(api, NotesView, {
        signal,
        onFailure: setReadProblem,
      });
      if (answer === undefined || signal.aborted) return;
      setRefreshing(false);
      if (answer.ok) {
        setReadProblem(undefined);
        setView(answer.data);
      } else {
        setReadProblem(answer.error);
      }
    }
    // Follow the background job one request at a time, even if the chat is idle.
    const timer = window.setTimeout(() => void read(), writing ? 1000 : 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [api, view, refreshing]);

  async function write(instructions: string): Promise<boolean> {
    if (starting || refreshing || view?.attempt?.state === "writing")
      return false;
    setStarting(true);
    setWriteProblem(undefined);
    const answer = await postFor(api, NotesView, {
      instructions,
      expectedRevision: view?.saved?.revision,
    });
    setStarting(false);
    if (!answer.ok) {
      setWriteProblem(answer.error);
      if (answer.status === 409) setRefreshing(true);
      return false;
    }
    setReadProblem(undefined);
    setView(answer.data);
    return true;
  }

  return {
    api,
    to,
    view,
    starting: starting || refreshing,
    write,
    problem: writeProblem ?? readProblem,
  };
}

/** "26 November 2026", in the reader's locale: when notes or a cheat sheet were written. */
export function longDate(writtenAt: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "long" }).format(
    new Date(writtenAt),
  );
}

function Writing(props: { again?: boolean }) {
  return (
    <span className="dk" role="status">
      Writing the notes{props.again ? " again" : ""}{" "}
      <span className="wait" aria-hidden="true" />
    </span>
  );
}

function Failed({ notes }: { notes: NotesControl }) {
  const attempt = notes.view?.attempt;
  return attempt?.state === "failed" ? (
    <div className="nt-state">
      <span className="no" role="alert">
        The notes could not be written. {attempt.error}
      </span>
      <button
        type="button"
        className="textbtn"
        disabled={notes.starting}
        onClick={() => void notes.write(attempt.instructions)}
      >
        Try again
      </button>
    </div>
  ) : null;
}

function InstructionsForm(props: {
  onWrite(instructions: string): Promise<boolean>;
  onCancel: (() => void) | undefined;
  starting: boolean;
  again?: boolean;
}) {
  const [instructions, setInstructions] = useState("");
  const field = useId();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const opened = props.onCancel !== undefined;
  useEffect(() => {
    if (opened) inputRef.current?.focus();
  }, [opened]);
  const submit = (
    <button
      type="submit"
      className={props.again ? "btn sm" : "btn sm quiet"}
      disabled={props.starting}
    >
      {props.again ? "Write again" : "Write notes"}
    </button>
  );
  const cancel =
    props.onCancel === undefined ? null : (
      <button
        type="button"
        className="textbtn"
        disabled={props.starting}
        onClick={props.onCancel}
      >
        Cancel
      </button>
    );
  const input = (
    <textarea
      id={field}
      ref={inputRef}
      className={props.again ? "field reason" : "field"}
      rows={props.again ? 3 : 1}
      value={instructions}
      maxLength={NOTES_INSTRUCTIONS_LIMIT}
      disabled={props.starting}
      onChange={(event) => setInstructions(event.target.value)}
      placeholder={
        props.again
          ? undefined
          : "What to focus on, or how to lay them out (optional)"
      }
      aria-label={props.again ? undefined : "Your instructions for the notes"}
    />
  );
  return (
    <form
      className={props.again ? "nr-again" : "nt-form"}
      onSubmit={(event) => {
        event.preventDefault();
        void props.onWrite(instructions).then((ok) => {
          if (ok) setInstructions("");
        });
      }}
    >
      {props.again ? (
        <>
          <label htmlFor={field}>
            What should change? These instructions take the place of the earlier
            ones.
          </label>
          {input}
          <div className="qa-foot">
            <span className="qa-aside">
              The notes are written anew and replace these. The backup keeps the
              earlier ones.
            </span>
            <span className="dp-btns">
              {cancel}
              {submit}
            </span>
          </div>
        </>
      ) : (
        <>
          <div className="nt-row">
            {input}
            {submit}
          </div>
          {cancel}
        </>
      )}
    </form>
  );
}

/** The same offer appears inside the closing card and under a course row. */
export function NotesOffer(props: UnitAddress & { row?: boolean }) {
  const notes = useNotes(props);
  const { view } = notes;
  const [asking, setAsking] = useState(false);
  const writing = view?.attempt?.state === "writing";
  const canWrite =
    view !== undefined &&
    view.attempt === undefined &&
    view.saved === undefined;
  const saved = view?.saved;
  const status = writing ? (
    <>
      <Writing again={saved !== undefined} />
      {props.row ? null : (
        <span className="nt-aside">
          This takes a minute. You can go on meanwhile.
        </span>
      )}
    </>
  ) : null;
  const form = (
    <InstructionsForm
      starting={notes.starting}
      onWrite={async (instructions) => {
        const ok = await notes.write(instructions);
        if (ok) setAsking(false);
        return ok;
      }}
      onCancel={props.row ? () => setAsking(false) : undefined}
    />
  );
  const problem =
    notes.problem === undefined ? null : (
      <span className="no" role="alert">
        {notes.problem}
      </span>
    );

  if (props.row) {
    return (
      <>
        {saved === undefined ? null : (
          <Link to={notes.to} className="textbtn">
            Notes
          </Link>
        )}
        {status}
        <Failed notes={notes} />
        {!canWrite ? null : asking ? (
          form
        ) : (
          <button
            type="button"
            className="textbtn"
            onClick={() => setAsking(true)}
          >
            Write notes
          </button>
        )}
        {problem}
      </>
    );
  }

  return (
    <section className="ue-sec" aria-label="Notes on this unit">
      <div className="cs-h">
        <span>Notes on this unit</span>
      </div>
      {view === undefined ? (
        problem === null ? (
          <span role="status">Loading notes…</span>
        ) : null
      ) : (
        <>
          {status === null ? null : <div className="nt-state">{status}</div>}
          <Failed notes={notes} />
          {saved === undefined ? null : (
            <div className="nt-state">
              <span>
                Written{" "}
                <time dateTime={saved.writtenAt}>
                  {longDate(saved.writtenAt)}
                </time>
                {saved.instructions === "" ? "" : ", with your instructions"}.
              </span>
              <Link to={notes.to} className="textbtn">
                Open the notes
              </Link>
            </div>
          )}
          {canWrite ? (
            <>
              <p className="as-says">
                A page of its own on what this unit taught, with figures where a
                picture helps, more room for what you found hard, and what made
                it click. Written from your sessions when you ask, and kept as a
                file you can open without Gauss.
              </p>
              {form}
            </>
          ) : null}
        </>
      )}
      {problem}
    </section>
  );
}

export function NotesReader(props: UnitAddress) {
  const { courseId, unitId } = props;
  const notes = useNotes(props);
  const { api, view } = notes;
  const [editingRevision, setEditingRevision] = useState<string>();
  const [opening, setOpening] = useState(false);
  const [openProblem, setOpenProblem] = useState<string>();
  const saved = view?.saved;
  const again = saved !== undefined && editingRevision === saved.revision;
  const writing = view?.attempt?.state === "writing";
  const trail = [
    { label: "Library", to: paths.library },
    { label: view?.courseTitle ?? "Course", to: paths.course(courseId) },
    { label: view?.unitTitle ?? "Unit", to: paths.unit(courseId, unitId) },
  ];

  async function open() {
    setOpening(true);
    setOpenProblem(await post(`${api}/open`, {}));
    setOpening(false);
  }

  return (
    <div className="pg nr">
      <TopLine
        trail={trail}
        here="Notes"
        action={
          saved === undefined ? undefined : (
            <span className="nl-acts">
              <button
                type="button"
                className="textbtn"
                disabled={opening}
                onClick={() => void open()}
              >
                {opening ? "Opening…" : "Open in browser"}
              </button>
              {writing || again || notes.starting ? null : (
                <button
                  type="button"
                  className="btn sm"
                  onClick={() => setEditingRevision(saved.revision)}
                >
                  Write again
                </button>
              )}
            </span>
          )
        }
      />
      <div className="nr-top">
        {saved === undefined ? null : (
          <>
            <span>
              Written{" "}
              <time dateTime={saved.writtenAt}>
                {longDate(saved.writtenAt)}
              </time>{" "}
              from this unit’s sessions
              {saved.instructions === ""
                ? ", with no instructions of yours."
                : "."}
            </span>
            {saved.instructions === "" ? null : (
              <span className="nr-instructions">
                Your instructions: {saved.instructions}
              </span>
            )}
            <div className="qa-path">
              <code className="qa-path-name">{saved.path}</code>
              <CopyPath path={saved.path} />
            </div>
          </>
        )}
        {writing ? <Writing again={saved !== undefined} /> : null}
        {again ? null : <Failed notes={notes} />}
        {notes.problem === undefined ? null : (
          <span className="no" role="alert">
            {notes.problem}
          </span>
        )}
        {openProblem === undefined ? null : (
          <span className="no" role="alert">
            {openProblem}
          </span>
        )}
        {again ? (
          <InstructionsForm
            again
            starting={notes.starting}
            onCancel={() => setEditingRevision(undefined)}
            onWrite={async (instructions) => {
              const ok = await notes.write(instructions);
              if (ok) setEditingRevision(undefined);
              return ok;
            }}
          />
        ) : null}
        {view === undefined && notes.problem === undefined ? (
          <span role="status">Loading notes…</span>
        ) : null}
        {view !== undefined &&
        saved === undefined &&
        view.attempt === undefined ? (
          <span>
            No notes have been written.{" "}
            <Link to={paths.unit(courseId, unitId)}>Back to the unit</Link>.
          </span>
        ) : null}
      </div>
      {saved === undefined ? null : (
        <iframe
          className={writing ? "nr-frame nr-writing" : "nr-frame"}
          src={`${api}/html?revision=${encodeURIComponent(saved.revision)}`}
          sandbox=""
          title={`Notes on ${view?.unitTitle ?? "this unit"}`}
        />
      )}
    </div>
  );
}
