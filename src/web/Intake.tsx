// Starting a course (docs/prototype/08-intake.html): a conversation in the
// Thread layout, fed by the intake's event stream. Each proposal is a card
// in the thread with Approve on it; pushing back is replying, and a revision
// arrives as a new card with what changed marked while the one before shrinks
// to a line. The diagram opens in the side pane. The card's last section is
// the learner profile approval would save (18-profile.html), compared
// sentence by sentence with the profile it would replace. A source is
// attached with the clip in the message box or by dropping a file on the
// thread (piece 22); its card shows the conversion, and Send waits for it.
// Under the opening question the learner picks the backend the course runs
// on, until the first proposal makes the course.

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
} from "react";
import { BACKEND_TITLES, type BackendName } from "../shared/course.ts";
import { Hello, PageEvent } from "../shared/events.ts";
import { compareSentences } from "../shared/profile.ts";
import type { Outline } from "../shared/source.ts";
import type { SourceTarget } from "../shared/source-target.ts";
import {
  emptyTimeline,
  type Item,
  reduce,
  type Timeline,
  type TimelineAction,
} from "../shared/timeline.ts";
import { post } from "./api.ts";
import {
  AttachmentOutline,
  DropHint,
  useFileDrop,
  useSourceUploads,
} from "./attach.tsx";
import { ChangedText } from "./ChangedText.tsx";
import { Composer } from "./Composer.tsx";
import { Diagram, SourceShare, UnitList } from "./Curriculum.tsx";
import { Link, SidePane, TopLine } from "./Frame.tsx";
import { Prose } from "./prose.tsx";
import { navigate, paths } from "./route.ts";
import { SourceCard } from "./SourceCard.tsx";
import { readsSources, useCourseSources } from "./sources.ts";

/** Asked by the page itself; the tutor's session starts with the answer. */
const OPENING_QUESTION =
  "What do you want to learn? Tell me what you already know.";

type Proposal = Extract<Item, { kind: "proposal" }>;
type OutlineTarget = Extract<SourceTarget, { kind: "outline" }>;

const intakePath = (id: string, route: string) =>
  `/api/intakes/${encodeURIComponent(id)}/${route}`;

type IntakeState = {
  timeline: Timeline;
  /** Increments only when a converted source is attached. */
  sourceVersion: number;
};

const emptyIntake: IntakeState = {
  timeline: emptyTimeline,
  sourceVersion: 0,
};

function reduceIntake(state: IntakeState, action: TimelineAction): IntakeState {
  const timeline = reduce(state.timeline, action);
  if (timeline === state.timeline) return state;
  const next = { ...state, timeline };
  if (
    action.type === "event" &&
    action.event.type === "source_attached" &&
    state.timeline.approved === null
  ) {
    next.sourceVersion += 1;
  }
  return next;
}

export function Intake(props: { intakeId: string }) {
  const { intakeId } = props;
  const [state, dispatch] = useReducer(reduceIntake, emptyIntake);
  const { timeline, sourceVersion } = state;
  const [connected, setConnected] = useState(false);
  const [lost, setLost] = useState(false);
  const [problem, setProblem] = useState<string>();
  const [pane, setPane] = useState<
    "diagram" | (OutlineTarget & { attachment: string })
  >();
  const diagramOpen = pane === "diagram";
  const closePane = useCallback(() => setPane(undefined), []);
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

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

  const latest = timeline.items.findLast((i) => i.kind === "proposal");
  // Only the latest proposal is drawn in full, so only its units read.
  const { sources, problem: sourceProblem } = useCourseSources(
    latest?.courseId,
    readsSources(latest?.units ?? []),
    sourceVersion,
  );
  const sourceBase =
    latest === undefined
      ? intakePath(intakeId, "sources")
      : `/api/courses/${encodeURIComponent(latest.courseId)}/sources`;
  const card =
    typeof pane === "object"
      ? timeline.items.find(
          (i) =>
            i.kind === "source" &&
            i.state === "attached" &&
            i.attachment === pane.attachment,
        )
      : undefined;
  const sourceTitle = card?.kind === "source" ? card.facts?.title : undefined;
  const { approved } = timeline;
  const open = !lost && approved === null;
  const uploads = useSourceUploads(
    intakePath(intakeId, "sources"),
    timeline.items,
  );
  const { converting } = uploads;
  const drop = useFileDrop(open, uploads.attach);
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
    <div
      className={
        diagramOpen || sourceTitle !== undefined
          ? "th has-top has-pane"
          : "th has-top"
      }
      {...drop.handlers}
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
          {lost && timeline.chatId === null ? null : (
            <BackendChoice
              key={timeline.chatId}
              backend={timeline.backend}
              made={timeline.latestRevision > 0 || timeline.reopened}
              open={open}
              onChoose={(backend) =>
                post(intakePath(intakeId, "backend"), { backend })
              }
            />
          )}
          {timeline.items.map((item) =>
            item.kind === "proposal" ? (
              item.revision === timeline.latestRevision ? (
                <ProposalCard
                  key={item.key}
                  proposal={item}
                  sources={sources}
                  sourceProblem={sourceProblem}
                  approved={approved?.revision === item.revision}
                  canApprove={open && !timeline.busy && !converting}
                  diagramOpen={diagramOpen}
                  onToggleDiagram={() =>
                    setPane(diagramOpen ? undefined : "diagram")
                  }
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
                outlineOpen={
                  typeof pane === "object" &&
                  item.kind === "source" &&
                  pane.attachment === item.attachment
                }
                onOutline={(source, attachment) =>
                  setPane(
                    typeof pane === "object" && pane.attachment === attachment
                      ? undefined
                      : { kind: "outline", source, attachment },
                  )
                }
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
          {uploads.errors.map(({ key, name, error }) => (
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
          onAttach={uploads.attach}
          placeholder={
            latest === undefined
              ? "Message the tutor"
              : "Push back, or ask a question"
          }
          onSend={(text) => act("messages", { text })}
          onStop={() => void act("interrupt")}
        />
      </div>
      {drop.dragging ? <DropHint /> : null}
      {diagramOpen && latest !== undefined ? (
        <SidePane
          title="Curriculum"
          subtitle="How the units build on each other"
          onClose={closePane}
        >
          <Diagram
            units={latest.units}
            marks={new Map([...latest.changed].map((id) => [id, "Changed"]))}
          />
        </SidePane>
      ) : typeof pane === "object" && sourceTitle !== undefined ? (
        <AttachmentOutline
          key={`${sourceBase}/${pane.source}`}
          base={sourceBase}
          target={pane}
          title={sourceTitle}
          known={sources?.find((s) => s.id === pane.source)}
          units={latest?.units ?? []}
          onClose={closePane}
        />
      ) : null}
    </div>
  );
}

/** What each backend means for the course, beside its name. */
const BACKEND_ABOUT: Record<BackendName, string> = {
  claude: "Claude Code, on your Claude plan.",
  codex:
    "Codex, on your ChatGPT plan: gpt-6.1-terra teaches and plans each " +
    "unit, and the rest stays on Claude. No web search.",
};

/**
 * The backend the course runs on, Claude preselected. Codex is checked when
 * picked, and refused with the reason when it cannot run here; the first
 * proposal makes the course, and the choice stays.
 */
function BackendChoice(props: {
  backend: BackendName;
  /** The first proposal has made the course. */
  made: boolean;
  /** The intake has not ended. */
  open: boolean;
  /** Posts the choice; the reason it was refused, if it was. */
  onChoose(backend: BackendName): Promise<string | undefined>;
}) {
  const [asking, setAsking] = useState<BackendName>();
  /** A pick the server took, shown until its event arrives on the stream. */
  const [accepted, setAccepted] = useState<BackendName>();
  const [problem, setProblem] = useState<string>();

  async function choose(backend: BackendName) {
    setAsking(backend);
    setAccepted(undefined);
    setProblem(undefined);
    const refused = await props.onChoose(backend);
    setProblem(refused);
    if (refused === undefined) setAccepted(backend);
    setAsking(undefined);
  }

  // Once the course is made, the record's backend is the one shown.
  const shown = props.made
    ? props.backend
    : (asking ?? accepted ?? props.backend);
  return (
    <fieldset
      className="bk"
      disabled={props.made || !props.open || asking !== undefined}
    >
      <legend className="bk-k">Tutor</legend>
      {(["claude", "codex"] as const).map((name) => (
        <label key={name} className="bk-o">
          <input
            type="radio"
            name="backend"
            value={name}
            checked={shown === name}
            onChange={() => void choose(name)}
          />
          <span className="bk-t">{BACKEND_TITLES[name]}</span>
          <span className="bk-d">{BACKEND_ABOUT[name]}</span>
        </label>
      ))}
      <p className="bk-n" aria-live="polite">
        {asking === "codex"
          ? "Checking that Codex runs here and is signed in…"
          : props.made
            ? "Fixed now that the course is made."
            : "Pick before the tutor first proposes a curriculum, which makes the course; it stays after."}
      </p>
      {problem === undefined ? null : (
        <p className="qa-error" role="alert">
          {problem}
        </p>
      )}
    </fieldset>
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
  sourceProblem: string | undefined;
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
      {props.sourceProblem === undefined ? null : (
        <p className="qa-error">{props.sourceProblem}</p>
      )}
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
  outlineOpen: boolean;
  onOutline(source: string, attachment: string): void;
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
          outlineOpen={props.outlineOpen}
          onOutline={(source) => props.onOutline(source, item.attachment)}
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
    case "read":
    case "page":
    case "quote":
    case "artifact":
    case "question":
    case "phase":
    case "unit_end":
    case "session":
      return null;
  }
}
