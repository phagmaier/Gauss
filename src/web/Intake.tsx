// Starting a course (docs/prototype/08-intake.html): a conversation in the
// Thread layout, fed by the intake's event stream. Each proposal is a card
// in the thread with Approve on it; pushing back is replying, and a revision
// arrives as a new card with what changed marked while the one before shrinks
// to a line. The diagram opens in the side pane. The card's last section is
// the learner profile approval would save (18-profile.html), compared
// sentence by sentence with the profile it would replace. A source is
// attached with the clip in the message box or by dropping a file on the
// thread (piece 22); its card shows the conversion, and Send waits for it.

import {
  type DragEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
} from "react";
import { FILE_NAME_HEADER, Hello, PageEvent } from "../shared/events.ts";
import { compareSentences } from "../shared/profile.ts";
import {
  formatBytes,
  type Outline,
  SOURCE_SIZE_LIMIT,
} from "../shared/source.ts";
import {
  emptyTimeline,
  type Item,
  reduce,
  type Timeline,
  type TimelineAction,
} from "../shared/timeline.ts";
import { post, postFile, type UploadAnswer } from "./api.ts";
import { ChangedText } from "./ChangedText.tsx";
import { Composer } from "./Composer.tsx";
import { Diagram, SourceShare, UnitList } from "./Curriculum.tsx";
import { Link, SidePane, TopLine } from "./Frame.tsx";
import { Prose } from "./prose.tsx";
import { navigate, paths } from "./route.ts";
import { SourceCard } from "./SourceCard.tsx";
import { useCourseSources } from "./sources.ts";

/** Asked by the page itself; the tutor's session starts with the answer. */
const OPENING_QUESTION =
  "What do you want to learn? Tell me what you already know.";

type Proposal = Extract<Item, { kind: "proposal" }>;

const intakePath = (id: string, route: string) =>
  `/api/intakes/${encodeURIComponent(id)}/${route}`;

type IntakeState = {
  timeline: Timeline;
  posting: number;
  awaiting: string[];
  uploadErrors: { key: number; name: string; error: string }[];
};

type IntakeAction =
  | TimelineAction
  | { type: "upload_start" }
  | {
      type: "upload_response";
      key: number;
      name: string;
      result: UploadAnswer;
    };

const emptyIntake: IntakeState = {
  timeline: emptyTimeline,
  posting: 0,
  awaiting: [],
  uploadErrors: [],
};

function reduceIntake(state: IntakeState, action: IntakeAction): IntakeState {
  if (action.type === "upload_start") {
    return { ...state, posting: state.posting + 1 };
  }
  if (action.type === "upload_response") {
    const { result, key, name } = action;
    const next = { ...state, posting: state.posting - 1 };
    if (!result.ok) {
      if (!result.shown) {
        next.uploadErrors = [
          ...state.uploadErrors,
          { key, name, error: result.error },
        ];
      }
    } else if (
      // The stream may have finished this conversion before the POST answered.
      !state.timeline.items.some(
        (i) =>
          i.kind === "source" &&
          i.attachment === result.attachment &&
          i.state !== "converting",
      )
    ) {
      next.awaiting = [...state.awaiting, result.attachment];
    }
    return next;
  }
  const timeline = reduce(state.timeline, action);
  if (timeline === state.timeline) return state;
  const next = { ...state, timeline };
  if (action.type === "event") {
    const { event } = action;
    if (
      (event.type === "source_attached" || event.type === "source_refused") &&
      state.awaiting.includes(event.attachment)
    ) {
      next.awaiting = state.awaiting.filter((id) => id !== event.attachment);
    }
  }
  return next;
}

export function Intake(props: { intakeId: string }) {
  const { intakeId } = props;
  const [{ timeline, posting, awaiting, uploadErrors }, dispatch] = useReducer(
    reduceIntake,
    emptyIntake,
  );
  const [connected, setConnected] = useState(false);
  const [lost, setLost] = useState(false);
  const [problem, setProblem] = useState<string>();
  const [diagramOpen, setDiagramOpen] = useState(false);
  const closeDiagram = useCallback(() => setDiagramOpen(false), []);
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const nextUpload = useRef(0);
  const [dragging, setDragging] = useState(false);
  /** How deep in the page's elements a file is held, which enter and leave count. */
  const dragDepth = useRef(0);

  useEffect(() => {
    const source = new EventSource(intakePath(intakeId, "events"));
    source.addEventListener("hello", (e: MessageEvent<string>) => {
      setConnected(true);
      dispatch({
        type: "hello",
        chatId: Hello.parse(JSON.parse(e.data)).chatId,
      });
    });
    source.onmessage = (e: MessageEvent<string>) => {
      dispatch({
        type: "event",
        index: Number(e.lastEventId.split(".")[1]),
        event: PageEvent.parse(JSON.parse(e.data)),
      });
    };
    // EventSource reconnects by itself and resumes after the last event. It
    // gives up when the server refuses, which means the intake is gone: the
    // server restarted.
    source.onerror = () => {
      setConnected(false);
      if (source.readyState === EventSource.CLOSED) setLost(true);
    };
    return () => source.close();
  }, [intakeId]);

  // Follow the thread as it grows, unless the learner has scrolled up.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el !== null && pinned.current) el.scrollTop = el.scrollHeight;
  });

  async function act(
    route: string,
    body?: unknown,
  ): Promise<string | undefined> {
    const refused = await post(intakePath(intakeId, route), body);
    setProblem(refused);
    return refused;
  }

  async function attach(file: File) {
    const key = nextUpload.current++;
    dispatch({ type: "upload_start" });
    const result = await postFile(
      intakePath(intakeId, "sources"),
      file,
      FILE_NAME_HEADER,
    );
    dispatch({ type: "upload_response", key, name: file.name, result });
  }

  const latest = timeline.items.findLast((i) => i.kind === "proposal");
  // Only the latest proposal is drawn in full, so only its units read.
  const sources = useCourseSources(latest?.courseId, latest?.units ?? []);
  const { approved } = timeline;
  const open = !lost && approved === null;
  const converting =
    posting > 0 ||
    awaiting.length > 0 ||
    timeline.items.some((i) => i.kind === "source" && i.state === "converting");
  /** A file held over the page, which can be dropped to attach it. */
  const holdsFiles = (e: DragEvent) =>
    open && e.dataTransfer.types.includes("Files");
  // Mock 8: once approved, the course starts with its first unit.
  const approvedProposal = timeline.items.find(
    (i) => i.kind === "proposal" && i.revision === approved?.revision,
  );
  const firstUnit =
    approvedProposal?.kind === "proposal"
      ? approvedProposal.units[0]
      : undefined;
  const profileSaved =
    approvedProposal?.kind === "proposal" &&
    approvedProposal.profile !== undefined &&
    (approvedProposal.profileWas === null ||
      (approvedProposal.profileWas !== undefined &&
        compareSentences(approvedProposal.profileWas, approvedProposal.profile)
          .changed));
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: dropping a file is a shortcut; the clip in the message box attaches one from the keyboard
    <div
      className={diagramOpen ? "th has-top has-pane" : "th has-top"}
      onDragEnter={(e) => {
        if (!holdsFiles(e)) return;
        e.preventDefault();
        dragDepth.current += 1;
        setDragging(true);
      }}
      onDragOver={(e) => {
        if (!holdsFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDragging(false);
      }}
      onDrop={(e) => {
        dragDepth.current = 0;
        setDragging(false);
        if (!holdsFiles(e)) return;
        e.preventDefault();
        for (const file of e.dataTransfer.files) void attach(file);
      }}
    >
      <TopLine
        trail={[{ label: "Library", to: paths.library }]}
        here={latest?.title ?? "New course"}
      />
      <div
        className="th-scroll"
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          pinned.current =
            el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
      >
        <div className="th-col">
          {timeline.reopened ? (
            <p className="ph-note">
              This curriculum was proposed in a conversation that was not kept.
              Push back on anything, or approve it.
            </p>
          ) : lost && timeline.chatId === null ? null : (
            // Not shown for an intake that was gone before the page saw it.
            <div className="th-tutor prose">
              <p>{OPENING_QUESTION}</p>
            </div>
          )}
          {timeline.items.map((item) =>
            item.kind === "proposal" ? (
              item.revision === timeline.latestRevision ? (
                <ProposalCard
                  key={item.key}
                  proposal={item}
                  sources={sources}
                  approved={approved?.revision === item.revision}
                  canApprove={open && !timeline.busy && !converting}
                  diagramOpen={diagramOpen}
                  onToggleDiagram={() => setDiagramOpen(!diagramOpen)}
                  onApprove={() => act("approval", { revision: item.revision })}
                />
              ) : (
                <div key={item.key} className="cp-old">
                  {item.revision === 1
                    ? "First proposal"
                    : `Proposal ${item.revision}`}
                  , {unitCount(item.units.length)}. Replaced by the one below.
                </div>
              )
            ) : (
              <ItemView
                key={item.key}
                item={item}
                proposed={timeline.latestRevision > 0}
                canRemove={open && timeline.latestRevision === 0}
                onRemove={(attachment) =>
                  act(`sources/${encodeURIComponent(attachment)}/remove`)
                }
              />
            ),
          )}
          {timeline.busy && !timeline.tutorOpen ? (
            <div className="th-tutor">
              <span
                className="wait"
                role="status"
                aria-label="The tutor is writing"
              />
            </div>
          ) : null}
          {approved === null ? null : (
            <>
              <p className="ph-note">
                Approved. The course is in your library
                {profileSaved ? ", and your profile is saved" : ""}.
              </p>
              <div className="pf-act">
                {firstUnit === undefined ? null : (
                  <button
                    type="button"
                    className="btn sm"
                    onClick={() =>
                      navigate(paths.unit(approved.courseId, firstUnit.id))
                    }
                  >
                    Start unit 1
                  </button>
                )}
                <button
                  type="button"
                  className="textbtn"
                  onClick={() => navigate(paths.course(approved.courseId))}
                >
                  Open the course
                </button>
                {profileSaved ? (
                  <button
                    type="button"
                    className="textbtn"
                    onClick={() => navigate(paths.profile)}
                  >
                    Open your profile
                  </button>
                ) : null}
              </div>
            </>
          )}
          {problem === undefined ? null : <p className="ph-note">{problem}</p>}
          {uploadErrors.map(({ key, name, error }) => (
            <p key={key} className="ph-note">
              {name}: {error}
            </p>
          ))}
          {lost ? (
            <p className="ph-note">
              This conversation ended when the server restarted. If it had
              proposed a curriculum, you can go on reviewing it from the{" "}
              <Link to={paths.library}>library</Link>.
            </p>
          ) : connected || timeline.chatId === null ? null : (
            <p className="ph-note">
              The connection to the server was lost. Retrying…
            </p>
          )}
        </div>
      </div>
      <div className="th-foot">
        <Composer
          enabled={open}
          busy={timeline.busy}
          holdSend={converting}
          onAttach={(file) => void attach(file)}
          placeholder={
            latest === undefined
              ? "Message the tutor"
              : "Push back, or ask a question"
          }
          onSend={(text) => act("messages", { text })}
          onStop={() => void act("interrupt")}
        />
      </div>
      {dragging ? (
        <div className="drop">
          <div className="drop-t">Drop the file to attach it</div>
          <p className="drop-p">
            PDF, EPUB, plain text or Markdown, up to{" "}
            {formatBytes(SOURCE_SIZE_LIMIT)}
          </p>
        </div>
      ) : null}
      {diagramOpen && latest !== undefined ? (
        <SidePane
          title="Curriculum"
          subtitle="How the units build on each other"
          onClose={closeDiagram}
        >
          <Diagram
            units={latest.units}
            marks={new Map([...latest.changed].map((id) => [id, "Changed"]))}
          />
        </SidePane>
      ) : null}
    </div>
  );
}

function unitCount(n: number): string {
  return n === 1 ? "1 unit" : `${n} units`;
}

function ProposalCard(props: {
  proposal: Proposal;
  approved: boolean;
  canApprove: boolean;
  diagramOpen: boolean;
  onToggleDiagram(): void;
  onApprove(): Promise<string | undefined>;
  /** The course's sources, once loaded: the units' reads come from them. */
  sources: readonly Outline[] | undefined;
}) {
  const { proposal } = props;
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();

  async function approve() {
    setSending(true);
    setError(undefined);
    // On success the approval arrives over the event stream.
    const refused = await props.onApprove();
    setError(refused);
    setSending(false);
  }

  return (
    <div className="qa-card cp">
      <div className="q-count">
        <b>Proposed curriculum</b>
        {unitCount(proposal.units.length)}
        {proposal.revision > 1 ? ", revised" : ""}
      </div>
      <UnitList
        units={proposal.units}
        mark={(unit) =>
          proposal.changed.has(unit.id)
            ? { text: "Changed", className: "chg" }
            : undefined
        }
        sources={props.sources}
      />
      <SourceShare units={proposal.units} sources={props.sources} />
      <section className="cs" aria-label="How I would teach it">
        <div className="cs-h">
          <span>How I would teach it</span>
          {proposal.styleChanged ? <span className="chg">Changed</span> : null}
        </div>
        {/* Plain text, as the brief has it, like the units' titles and goals. */}
        <p className="cs-t">
          {proposal.style ??
            "No note was proposed, so the tutor's default style applies."}
        </p>
      </section>
      <section className="cs" aria-label="What the tutor will know about you">
        <div className="cs-h">
          <span>What the tutor will know about you</span>
          {proposal.backgroundChanged ? (
            <span className="chg">Changed</span>
          ) : null}
        </div>
        <p className="cs-t">
          {proposal.background ??
            "Nothing was recorded, so the tutor starts from your answers."}
        </p>
      </section>
      <ProfileSection proposal={proposal} />
      {error === undefined ? null : <p className="qa-error">{error}</p>}
      <div className="qa-foot">
        <button
          type="button"
          className="textbtn"
          aria-expanded={props.diagramOpen}
          onClick={props.onToggleDiagram}
        >
          {props.diagramOpen ? "Hide the diagram" : "Show the diagram"}
        </button>
        {props.approved ? (
          <span className="ok">Approved</span>
        ) : (
          <button
            type="button"
            className="btn"
            disabled={!props.canApprove || sending}
            onClick={() => void approve()}
          >
            Approve
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * "What I would remember about you" (piece 18): the whole text approval would
 * save, always shown, since it reaches every later course. A first profile is
 * "New"; a changed one marks each new sentence and lists each dropped one.
 */
function ProfileSection(props: { proposal: Proposal }) {
  const { profile, profileWas } = props.proposal;
  const label = "What I would remember about you";
  const head = (tag: string | undefined, more = "") => (
    <div className="cs-h">
      <span>{label}</span>
      <span className="for">in every course{more}</span>
      {tag === undefined ? null : <span className="chg">{tag}</span>}
    </div>
  );
  if (profile === undefined) {
    // A draft proposed before profiles existed: approving leaves it alone.
    return (
      <section className="cs" aria-label={label}>
        {head(undefined)}
        <p className="cs-t">
          No profile was proposed with this curriculum, so approving it leaves
          your profile as it is.
        </p>
      </section>
    );
  }
  if (profileWas === undefined) {
    return (
      <section className="cs" aria-label={label}>
        {head(undefined)}
        <p className="cs-t">{profile}</p>
        <p className="cs-gone">
          This draft did not keep the profile it was compared with. Ask the
          tutor to propose again before approving.
        </p>
      </section>
    );
  }
  const change =
    profileWas === null ? undefined : compareSentences(profileWas, profile);
  if (!change?.changed) {
    return (
      <section className="cs" aria-label={label}>
        {profileWas === null ? head("New") : head(undefined, ", not changed")}
        <p className="cs-t">{profile}</p>
      </section>
    );
  }
  return (
    <section className="cs" aria-label={label}>
      {head("Changed")}
      <ChangedText change={change} />
    </section>
  );
}

function ItemView(props: {
  item: Exclude<Item, Proposal>;
  /** A curriculum has been proposed. */
  proposed: boolean;
  /** An attached source can still be removed: nothing has been proposed. */
  canRemove: boolean;
  onRemove(attachment: string): Promise<string | undefined>;
}) {
  const { item } = props;
  switch (item.kind) {
    case "learner":
      return <div className="th-you">{item.text}</div>;
    case "tutor":
      return (
        <div className="th-tutor prose">
          <Prose text={item.text} />
        </div>
      );
    case "note":
      return <p className="ph-note">{item.text}</p>;
    case "source":
      return (
        <SourceCard
          item={item}
          canRemove={props.canRemove}
          onRemove={() => props.onRemove(item.attachment)}
        />
      );
    // The intake's session could not be resumed after an idle close (task 2.15).
    case "fresh":
      return (
        <p className="ph-note">
          The earlier conversation could not be resumed, so the tutor started a
          new one.{" "}
          {props.proposed
            ? "It has the latest proposal, but not the conversation above."
            : "It has not seen the conversation above."}
        </p>
      );
    // A unit chat's items: the intake has none of them.
    case "file":
    case "artifact":
    case "question":
    case "phase":
    case "unit_end":
    case "session":
      return null;
  }
}
