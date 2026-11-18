// A unit's session (plan task 2.11): its chat in the Thread layout, as the
// mocks settled it. The top line has the path out and the position in the
// unit, which opens the outline (docs/prototype/04-session-nav.html). Each
// phase begun is a marker in the thread, and the one next-step control sits
// where the thread has reached (03-phases.html). A question is a card in the
// thread (02-check-question.html), and the unit ends with a closing card
// (10-unit-end.html). "Start fresh" is in the outline, and the conversations
// before a fresh start stay in the thread, dimmed (11-start-fresh.html). An
// artifact the tutor shows opens in the side pane, and its reference in the
// thread opens and closes it (05-side-pane.html).
//
// Opening the view opens the unit on the server, which starts it or picks it
// up, then follows its event stream. A unit chat lives in the server's
// memory: once it is gone its stream answers 404, and the view opens the unit
// again and follows the new chat, whose thread starts where the record has
// the unit. In development a server restart reloads the whole page anyway
// (Vite's client does), which opens the unit the same way.

import {
  Fragment,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import { Hello, PageEvent, UnitOpened } from "../shared/events.ts";
import { CourseWithProgress } from "../shared/library.ts";
import type { Plan } from "../shared/plan.ts";
import type { AnswerPost, OpenFilePost } from "../shared/question.ts";
import { getJsonUntilAnswered, post, postFor } from "./api.ts";
import { Composer } from "./Composer.tsx";
import { type DisputeApi, disputeApi } from "./Dispute.tsx";
import { Link, SidePane, TopLine } from "./Frame.tsx";
import { PackagesCard } from "./PackagesCard.tsx";
import { InlineProse, Prose } from "./prose.tsx";
import { QuestionCard } from "./QuestionCard.tsx";
import { navigate, paths } from "./route.ts";
import {
  closingCard,
  detourSays,
  divided,
  helpNotice,
  judgmentSays,
  lastCard,
  nextStep,
  openQuestion,
  outline,
  type Placement,
  phaseMarker,
  placement,
  whereInUnit,
} from "./session.ts";
import {
  type ArtifactItem,
  conversations,
  emptyTimeline,
  type Item,
  reduce,
  type Timeline,
  type UnitEndItem,
} from "./timeline.ts";

const enc = encodeURIComponent;

/** How long to wait before opening a unit again once its chat is lost. */
const RETRY_MS = 1000;

export function Session(props: { courseId: string; unitId: string }) {
  const { courseId, unitId } = props;
  const [timeline, dispatch] = useReducer(reduce, emptyTimeline);
  // Undefined while loading, null when there is no such course.
  const [stored, setStored] = useState<CourseWithProgress | null>();
  const [connected, setConnected] = useState(false);
  /** Why the server will not open the unit at all. */
  const [refused, setRefused] = useState<string>();
  /** Why the learner's last step was refused. */
  const [problem, setProblem] = useState<string>();
  /** Why the course's details are not loaded, and whether they are asked for again. */
  const [courseProblem, setCourseProblem] = useState<{
    error: string;
    retrying: boolean;
  }>();
  /** Each new value opens the unit again and follows its new chat. */
  const [attempt, setAttempt] = useState(0);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [confirming, setConfirming] = useState<"move-on" | "finish">();
  /** The artifact open in the side pane. */
  const [pane, setPane] = useState<ArtifactItem>();
  /** The open question the learner hid, by its key. */
  const [hiddenKey, setHiddenKey] = useState<number>();
  const hideButton = useRef<HTMLButtonElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  const path = useCallback(
    (route: string) =>
      `/api/courses/${enc(courseId)}/units/${enc(unitId)}/${route}`,
    [courseId, unitId],
  );
  const disputes = useMemo(() => disputeApi(courseId), [courseId]);

  // The course's details name the unit and the one to start next. A failure to
  // load them is asked again until the server answers, so it never leaves
  // the page thinking the course is empty.
  useEffect(() => {
    const stop = new AbortController();
    void getJsonUntilAnswered(
      `/api/courses/${enc(courseId)}`,
      CourseWithProgress,
      {
        signal: stop.signal,
        onFailure: (error) => setCourseProblem({ error, retrying: true }),
      },
    ).then((answer) => {
      if (answer === undefined) return;
      setCourseProblem(undefined);
      if (answer.ok) setStored(answer.data);
      else if (answer.status === 404) setStored(null);
      else setCourseProblem({ error: answer.error, retrying: false });
    });
    return () => stop.abort();
  }, [courseId]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new attempt opens the unit again
  useEffect(() => {
    let source: EventSource | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const again = () => {
      if (!stopped)
        retry = setTimeout(() => setAttempt((n) => n + 1), RETRY_MS);
    };
    void postFor(path("open"), UnitOpened).then((opened) => {
      if (stopped) return;
      if (!opened.ok) {
        // An unreachable server may be restarting; a refusal is final.
        if (opened.status === 0) again();
        else setRefused(opened.error);
        return;
      }
      setRefused(undefined);
      const { chatId, last } = opened.data;
      const events = new EventSource(path("events"));
      source = events;
      events.addEventListener("hello", (e: MessageEvent<string>) => {
        const hello = Hello.parse(JSON.parse(e.data));
        if (hello.chatId !== chatId) {
          // A restart raced the connection. Open the new chat for its cursor.
          events.close();
          setConnected(false);
          again();
          return;
        }
        setConnected(true);
        dispatch({ type: "hello", chatId, last });
      });
      events.onmessage = (e: MessageEvent<string>) => {
        dispatch({
          type: "event",
          index: Number(e.lastEventId.split(".")[1]),
          event: PageEvent.parse(JSON.parse(e.data)),
        });
      };
      // EventSource reconnects by itself and resumes after the last event.
      // It gives up when the server refuses, which means the chat is gone,
      // so the unit is opened again.
      events.onerror = () => {
        setConnected(false);
        if (events.readyState === EventSource.CLOSED) again();
      };
    });
    return () => {
      stopped = true;
      source?.close();
      clearTimeout(retry);
    };
  }, [path, attempt]);

  // Follow the thread as it grows, unless the learner has scrolled up.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el !== null && pinned.current) el.scrollTop = el.scrollHeight;
  });

  // An artifact the tutor shows while the page is open opens at once.
  useEffect(() => {
    if (timeline.shown !== null) setPane(timeline.shown);
  }, [timeline.shown]);
  const closePane = useCallback(() => setPane(undefined), []);

  // A confirmation belongs to the step it was asked for.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset when the unit moves on
  useEffect(() => setConfirming(undefined), [timeline.position]);

  /** Posts the learner's step; a refusal is shown under the thread. */
  async function act(route: string, body?: unknown) {
    const why = await post(path(route), body);
    setProblem(why);
    setConfirming(undefined);
  }

  // Unknown until the course's details are loaded.
  const place = placement(stored, unitId);
  const courseTitle = place?.courseTitle ?? "Course";
  const next = place?.next ?? null;
  const toNext =
    next === null
      ? undefined
      : () => navigate(paths.unit(courseId, next.unit.id));
  const toCourse = () => navigate(paths.course(courseId));

  const { plan, busy } = timeline;
  const where =
    plan === null
      ? null
      : whereInUnit(plan, timeline.position, timeline.finished);
  const step = nextStep(timeline);
  const open = timeline.position !== null || timeline.finished !== null;
  const parts = conversations(timeline.items);
  const asked = openQuestion(timeline);
  // Hidden until shown again, or until another question is posted (task 3.21).
  const hidden = asked !== undefined && asked.key === hiddenKey;
  const notice = helpNotice(timeline);
  // Where the open question was posted, a line says where it went, once
  // something has followed it there.
  const askedAt =
    asked === undefined
      ? undefined
      : timeline.items.at(-1) === asked
        ? "last"
        : "earlier";
  const control = (
    <NextStepControl
      step={step}
      timeline={timeline}
      busy={busy}
      confirming={confirming === "move-on"}
      place={place}
      onConfirm={(asking) => setConfirming(asking ? "move-on" : undefined)}
      onAct={(route) => void act(route)}
      onCourse={toCourse}
      onNext={toNext}
    />
  );

  return (
    <div className={pane === undefined ? "th has-top" : "th has-top has-pane"}>
      <TopLine
        trail={[
          { label: "Library", to: paths.library },
          { label: courseTitle, to: paths.course(courseId) },
        ]}
        here={place?.title ?? ""}
        action={
          where === null ? undefined : (
            <PositionButton
              label={where.label}
              ticks={where.ticks}
              open={outlineOpen}
              onToggle={setOutlineOpen}
            >
              {plan === null ? null : (
                <Outline
                  courseId={courseId}
                  courseTitle={courseTitle}
                  place={place}
                  segments={outline(plan, timeline.position, timeline.finished)}
                  // A unit that is open and not finished has a tutor to replace.
                  canStartFresh={
                    timeline.position !== null &&
                    timeline.finished === null &&
                    timeline.failed === null
                  }
                  busy={busy}
                  onStartFresh={async () => {
                    await act("start-fresh");
                    setOutlineOpen(false);
                  }}
                />
              )}
            </PositionButton>
          )
        }
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
          {parts.map((part, p) => (
            // The conversations before the last fresh start are dimmed.
            <div
              key={part.key}
              className={p < parts.length - 1 ? "stale" : undefined}
            >
              {part.items.map((item, i) => {
                const before =
                  i > 0 ? part.items[i - 1] : parts[p - 1]?.items.at(-1);
                return (
                  <Fragment key={item.key}>
                    {divided(before, item) ? <hr className="th-sep" /> : null}
                    <ThreadItem
                      item={item}
                      // A session's marker sets it apart as the top of the thread does.
                      first={before === undefined || before.kind === "session"}
                      plan={plan}
                      place={place}
                      busy={busy}
                      current={item === lastCard(timeline)}
                      // By file, which names one artifact of the course
                      // across restarts, where keys are numbered afresh.
                      showing={
                        item.kind === "artifact" && pane?.file === item.file
                      }
                      onArtifact={(artifact) =>
                        setPane(
                          pane?.file === artifact.file ? undefined : artifact,
                        )
                      }
                      asked={item.key === asked?.key ? askedAt : undefined}
                      disputes={disputes}
                      confirming={confirming === "finish"}
                      onConfirm={(asking) =>
                        setConfirming(asking ? "finish" : undefined)
                      }
                      onAnswer={(submission) =>
                        post(path("answers"), submission)
                      }
                      onGradeAgain={() => post(path("grade-again"))}
                      onInstall={(requestId) =>
                        post(path("packages/install"), { requestId })
                      }
                      onNotNow={(requestId) =>
                        post(path("packages/not-now"), { requestId })
                      }
                      onRetrySaving={(requestId) =>
                        post(path("packages/retry-saving"), { requestId })
                      }
                      onAgain={() => act("go-over-again")}
                      onFinish={() => act("finish")}
                      onCourse={toCourse}
                      onNext={toNext}
                    />
                  </Fragment>
                );
              })}
            </div>
          ))}
          {timeline.planning ? (
            <p className="ph-note">
              <span className="wait" aria-hidden="true" /> Planning this unit:
              its objectives and segments. This takes a moment.
            </p>
          ) : null}
          {busy && !timeline.tutorOpen ? (
            <div className="th-tutor">
              <span
                className="wait"
                role="status"
                aria-label="The tutor is writing"
              />
            </div>
          ) : null}
          {asked === undefined ? control : null}
          {problem === undefined ? null : <p className="ph-note">{problem}</p>}
          {courseProblem === undefined ? null : (
            <p className="ph-note">
              The course's details could not be loaded: {courseProblem.error}
              {courseProblem.retrying ? " Trying again…" : ""}
            </p>
          )}
          {refused !== undefined ? (
            <p className="ph-note">
              {refused} Back to the{" "}
              <Link to={paths.course(courseId)}>course</Link>.
            </p>
          ) : connected || timeline.chatId === null ? null : (
            <p className="ph-note">
              The connection to the server was lost. Retrying…
            </p>
          )}
        </div>
      </div>
      <div className="th-foot">
        {asked === undefined ? null : (
          // Kept in view while the conversation goes on below it (task 2.18).
          // Hidden, it stays mounted, so a half-written answer survives.
          <div className="th-pin" hidden={hidden}>
            <button
              type="button"
              className="textbtn th-hide"
              ref={hideButton}
              onClick={() => setHiddenKey(asked.key)}
            >
              Hide
            </button>
            <QuestionCard
              key={asked.key}
              item={asked}
              disputes={disputes}
              hidden={hidden}
              onAnswer={(submission) => post(path("answers"), submission)}
              onGradeAgain={() => post(path("grade-again"))}
              onOpenFile={(questionId, file) =>
                post(
                  `/api/courses/${enc(courseId)}/questions/${enc(questionId)}/open`,
                  { file } satisfies OpenFilePost,
                )
              }
            />
          </div>
        )}
        {asked === undefined || !hidden ? null : (
          <div className="th-hidden">
            <span>Question {asked.question.number} is hidden</span>
            <button
              type="button"
              className="textbtn"
              // It appears in place of Hide, which had the focus.
              // biome-ignore lint/a11y/noAutofocus: only after Hide is pressed
              autoFocus
              onClick={() => {
                flushSync(() => setHiddenKey(undefined));
                hideButton.current?.focus();
              }}
            >
              Show
            </button>
          </div>
        )}
        {asked === undefined ? null : (
          <div className="th-pin-act">{control}</div>
        )}
        {notice === undefined ? null : (
          <div className="box-note">
            <p>{notice}</p>
          </div>
        )}
        <Composer
          enabled={open && timeline.failed === null}
          busy={busy}
          placeholder="Message the tutor"
          onSend={async (text) => {
            // A refused message stays in the box, and the reason shows.
            const why = await post(path("messages"), { text });
            setProblem(why);
            return why;
          }}
          onStop={() => void act("interrupt")}
        />
      </div>
      {pane === undefined ? null : (
        <SidePane
          title={pane.title}
          subtitle="From the tutor"
          onClose={closePane}
        >
          <iframe
            key={pane.file}
            src={`/api/courses/${enc(courseId)}/artifacts/${enc(pane.file)}`}
            // Scripts run, with an origin of their own; the artifact's
            // policy keeps it from the network (task 3.6).
            sandbox="allow-scripts"
            referrerPolicy="no-referrer"
            title={pane.title}
          />
        </SidePane>
      )}
    </div>
  );
}

/** The position in the top line, which opens the unit's outline. */
function PositionButton(props: {
  label: string;
  ticks: string[];
  open: boolean;
  onToggle(open: boolean): void;
  children: ReactNode;
}) {
  const { open, onToggle } = props;
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  // Esc, or a click anywhere else, closes the outline.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onToggle(false);
    };
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        !panel.current?.contains(target) &&
        !button.current?.contains(target)
      ) {
        onToggle(false);
      }
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open, onToggle]);

  return (
    <>
      <button
        type="button"
        className="nl-pos"
        ref={button}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => onToggle(!open)}
      >
        <span className="ticks" aria-hidden="true">
          {props.ticks.map((mark, i) => (
            // One tick per segment, in order; they never move.
            // biome-ignore lint/suspicious/noArrayIndexKey: see above
            <i key={i} className={mark} />
          ))}
        </span>
        {props.label}
      </button>
      {open ? (
        <div className="np" role="dialog" aria-label="Unit outline" ref={panel}>
          {props.children}
        </div>
      ) : null}
    </>
  );
}

/**
 * The unit's outline (mock 4): the path out, the unit, and its segments,
 * then "Start fresh" (mock 11), which asks once.
 */
function Outline(props: {
  courseId: string;
  courseTitle: string;
  /** Unknown until the course's details are loaded. */
  place: Placement | undefined;
  segments: { title: string; state: string }[];
  canStartFresh: boolean;
  /** The tutor is writing, so starting fresh waits. */
  busy: boolean;
  onStartFresh(): Promise<void>;
}) {
  const { place } = props;
  const [asking, setAsking] = useState(false);
  return (
    <div className="uo">
      <nav className="crumbs" aria-label="Where this session sits">
        <Link to={paths.library}>Library</Link>
        <span>/</span>
        <Link to={paths.course(props.courseId)}>{props.courseTitle}</Link>
      </nav>
      {place === undefined ? null : (
        <div className="uo-unit">
          <span>
            Unit {place.number} of {place.count}
          </span>
          <b>{place.title}</b>
        </div>
      )}
      <ol className="uo-list">
        {props.segments.map((segment, i) => (
          <li
            // The plan's segments in order, then the one that goes over again.
            // biome-ignore lint/suspicious/noArrayIndexKey: see above
            key={i}
            className={segment.state}
            aria-current={segment.state === "now" ? "step" : undefined}
          >
            <i />
            {segment.title}
          </li>
        ))}
      </ol>
      {props.canStartFresh ? (
        <div className="uo-fresh">
          {asking ? (
            <span className="confirm">
              <span>The tutor will not remember this conversation.</span>
              <button
                type="button"
                className="textbtn"
                disabled={props.busy}
                onClick={() => {
                  setAsking(false);
                  void props.onStartFresh();
                }}
              >
                Start fresh
              </button>
              <button
                type="button"
                className="textbtn"
                onClick={() => setAsking(false)}
              >
                Cancel
              </button>
            </span>
          ) : (
            <>
              <button
                type="button"
                className="textbtn"
                disabled={props.busy}
                onClick={() => setAsking(true)}
              >
                Start fresh
              </button>
              <p>
                A new conversation with the tutor, from your progress. This one
                stays above.
              </p>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

function ThreadItem(props: {
  item: Item;
  first: boolean;
  plan: Plan | null;
  place: Placement | undefined;
  busy: boolean;
  /** The last closing card, the only one whose steps can be taken. */
  current: boolean;
  /** This is the artifact the side pane shows. */
  showing: boolean;
  /** Opens the artifact in the side pane, or closes it if it is showing. */
  onArtifact(artifact: ArtifactItem): void;
  /**
   * The open question, shown above the message box instead: the last item
   * of the thread, or one that more has followed.
   */
  asked: "last" | "earlier" | undefined;
  disputes: DisputeApi;
  confirming: boolean;
  onConfirm(asking: boolean): void;
  onAnswer(submission: AnswerPost): Promise<string | undefined>;
  onGradeAgain(): Promise<string | undefined>;
  onInstall(requestId: string): Promise<string | undefined>;
  onNotNow(requestId: string): Promise<string | undefined>;
  onRetrySaving(requestId: string): Promise<string | undefined>;
  onAgain(): void;
  onFinish(): void;
  onCourse(): void;
  onNext: (() => void) | undefined;
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
    case "file":
      return (
        <p className="fw">
          {FILE_ICON}
          <span>
            The tutor wrote <code>{item.path}</code>
          </span>
        </p>
      );
    case "artifact":
      return (
        <button
          type="button"
          className="ref"
          aria-pressed={props.showing}
          onClick={() => props.onArtifact(item)}
        >
          {AID_ICON}
          <b>{item.title}</b>
          <span className="go">{props.showing ? "Showing" : "Open"}</span>
        </button>
      );
    case "packages":
      return (
        <PackagesCard
          item={item}
          busy={props.busy}
          onInstall={() => props.onInstall(item.requestId)}
          onNotNow={() => props.onNotNow(item.requestId)}
          onRetrySaving={() => props.onRetrySaving(item.requestId)}
        />
      );
    case "judgment": {
      const { text, tone } = judgmentSays(item);
      return (
        <p className={`th-judged ${tone}`} role="status">
          {text}
          {tone === "judging" ? (
            <>
              {" "}
              <span className="wait" aria-hidden="true" />
            </>
          ) : null}
        </p>
      );
    }
    case "answered-below":
      return (
        <p className="q-count th-asked">
          Question {item.number} was answered further down.
        </p>
      );
    case "detour":
      return (
        <div className="pf-mark">
          <span>
            <b>Detour</b> {detourSays(item.number)}
          </span>
        </div>
      );
    case "question":
      if (props.asked === "last") return null;
      return props.asked === "earlier" ? (
        <p className="q-count th-asked">
          Question {item.question.number} is open, above the message box.
        </p>
      ) : (
        <QuestionCard
          item={item}
          disputes={props.disputes}
          onAnswer={props.onAnswer}
          onGradeAgain={props.onGradeAgain}
        />
      );
    case "phase": {
      const marker = phaseMarker(item, props.first);
      if (marker === null) return null;
      if (marker === "new-segment") return <div className="ns-new" />;
      return (
        <div className="pf-mark">
          <span>
            <b>{marker.name}</b>
            {marker.says === undefined ? null : ` ${marker.says}`}
          </span>
        </div>
      );
    }
    case "session":
      return (
        <>
          {item.cutOff ? (
            <p className="ph-note">
              The server stopped before the tutor finished.
            </p>
          ) : null}
          <div className="pf-mark">
            <span>
              <b>New session</b> {sessionDate(item.startedAt)}
            </span>
          </div>
        </>
      );
    case "fresh":
      return (
        <div className="pf-mark">
          <span>
            <b>Fresh start</b>{" "}
            {item.reason === "learner"
              ? "The tutor has your progress, not the conversation above."
              : "The earlier conversation could not be resumed, so the tutor started a new one from your progress."}
          </span>
        </div>
      );
    case "unit_end":
      return props.plan === null ? null : (
        <ClosingCard
          card={item}
          plan={props.plan}
          place={props.place}
          busy={props.busy}
          current={props.current}
          confirming={props.confirming}
          onConfirm={props.onConfirm}
          onAgain={props.onAgain}
          onFinish={props.onFinish}
          onCourse={props.onCourse}
          onNext={props.onNext}
        />
      );
    case "proposal":
      // Only an intake proposes a curriculum.
      return null;
  }
}

/** A file's outline, for the line of each file the tutor writes (piece 14). */
const AID_ICON = (
  <svg
    width="18"
    height="18"
    viewBox="0 0 18 18"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M2.5 15.5h13" />
    <path d="M3 12c2-7 4-9 6-4s4 3 6-4" />
  </svg>
);

const FILE_ICON = (
  <svg
    width="15"
    height="15"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.4"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M4 1.8h5.2L12.5 5v9.2H4z" />
    <path d="M9 1.8V5.2h3.5" />
  </svg>
);

/** The closing card (mock 10), shrunk to one line once a step is taken. */
function ClosingCard(props: {
  card: UnitEndItem;
  plan: Plan;
  /** Unknown until the course's details are loaded. */
  place: Placement | undefined;
  busy: boolean;
  current: boolean;
  confirming: boolean;
  onConfirm(asking: boolean): void;
  onAgain(): void;
  onFinish(): void;
  onCourse(): void;
  onNext: (() => void) | undefined;
}) {
  const { card, place } = props;
  const view = closingCard(props.plan, card);
  const title = place?.title ?? "";
  const head = (
    <div className="q-count">
      <b>{place === undefined ? "Unit" : `Unit ${place.number}`} finished</b>
      <span className={view.verdict.className}>{view.verdict.text}</span>
    </div>
  );
  if (card.stepTaken !== undefined || !props.current) {
    return (
      <div className="qa-card done ue">
        {head}
        <div className="qa-line">
          <span>{title}</span>
          <span className="c">{view.summary}</span>
        </div>
      </div>
    );
  }
  let foot: ReactNode;
  if (card.passed) {
    foot = (
      <div className="qa-foot">
        {place === undefined || place.next === null ? (
          <>
            {/* Said only once the course is known to have no other unit left. */}
            <span className="qa-aside">
              {place?.finishesCourse === true
                ? "That finishes the course."
                : ""}
            </span>
            <button type="button" className="btn" onClick={props.onCourse}>
              Back to the course
            </button>
          </>
        ) : (
          <>
            <button type="button" className="textbtn" onClick={props.onCourse}>
              Back to the course
            </button>
            <button type="button" className="btn" onClick={props.onNext}>
              Start unit {place.next.number}
            </button>
          </>
        )}
      </div>
    );
  } else if (props.confirming) {
    foot = (
      <div className="qa-foot">
        <span className="confirm">
          <span>The unit will be recorded as overridden.</span>
          <button
            type="button"
            className="textbtn"
            disabled={props.busy}
            onClick={props.onFinish}
          >
            Move on
          </button>
          <button
            type="button"
            className="textbtn"
            onClick={() => props.onConfirm(false)}
          >
            Stay
          </button>
        </span>
      </div>
    );
  } else {
    foot = (
      <div className="qa-foot">
        <button
          type="button"
          className="textbtn"
          disabled={props.busy}
          onClick={() => props.onConfirm(true)}
        >
          Move on without them
        </button>
        <button
          type="button"
          className="btn"
          disabled={props.busy}
          onClick={props.onAgain}
        >
          {view.again}
        </button>
      </div>
    );
  }
  return (
    // "live": its steps can still be taken (styles.css, ".stale").
    <div className="qa-card ue live">
      {head}
      <div className="qa-prompt">{title}</div>
      <ol className="ue-rows">
        {view.rows.map((row) => (
          <li key={row.id}>
            <span>
              <InlineProse text={row.statement} />
            </span>
            <span className={row.passed ? "st pass" : "st miss"}>
              {row.passed ? "Passed" : "Not passed"}
            </span>
            {row.why === undefined ? null : <small>{row.why}</small>}
          </li>
        ))}
      </ol>
      {foot}
    </div>
  );
}

/** The one control that moves the unit on, where the thread has reached. */
function NextStepControl(props: {
  step: ReturnType<typeof nextStep>;
  timeline: Timeline;
  busy: boolean;
  confirming: boolean;
  /** Unknown until the course's details are loaded. */
  place: Placement | undefined;
  onConfirm(asking: boolean): void;
  onAct(route: string): void;
  onCourse(): void;
  onNext: (() => void) | undefined;
}) {
  const { step, busy } = props;
  const next = props.place?.next ?? null;
  switch (step) {
    case null:
      return null;
    case "ready":
      return (
        <div className="pf-act">
          <button
            type="button"
            className="btn sm"
            disabled={busy}
            onClick={() => props.onAct("ready")}
          >
            I'm ready for the check
          </button>
        </div>
      );
    case "move-on":
      return (
        <div className="pf-act">
          <MoveOn {...props} />
        </div>
      );
    case "detour":
      // Moving on stays open in a detour (task 2.20).
      return (
        <div className="pf-act">
          {props.confirming ? null : (
            <button
              type="button"
              className="btn sm"
              disabled={busy}
              onClick={() => props.onAct("another-question")}
            >
              Ready for another question
            </button>
          )}
          <MoveOn {...props} />
        </div>
      );
    case "next-segment":
      return (
        <div className="pf-act">
          <button
            type="button"
            className="btn sm"
            disabled={busy}
            onClick={() => props.onAct("next-segment")}
          >
            Start the next segment
          </button>
        </div>
      );
    case "try-again":
      return (
        <div className="pf-act">
          <button
            type="button"
            className="btn sm"
            onClick={() => props.onAct("open")}
          >
            Try again
          </button>
        </div>
      );
    case "leave": {
      const card = lastCard(props.timeline);
      const { plan, finished } = props.timeline;
      const note =
        card?.stepTaken === "moved-on" && plan !== null
          ? closingCard(plan, card).movedOn
          : finished === "passed"
            ? "This unit is finished: every objective passed."
            : "This unit is finished. It is recorded as overridden: you moved on without passing every objective.";
      return (
        <>
          <p className="ph-note">{note}</p>
          <div className="pf-act">
            {next === null ? null : (
              <button type="button" className="btn sm" onClick={props.onNext}>
                Start unit {next.number}: {next.unit.title}
              </button>
            )}
            <button type="button" className="textbtn" onClick={props.onCourse}>
              Back to the course
            </button>
          </div>
        </>
      );
    }
  }
}

/** Moving on without the check, which asks once, as it is recorded as an override. */
function MoveOn(props: {
  busy: boolean;
  confirming: boolean;
  onConfirm(asking: boolean): void;
  onAct(route: string): void;
}) {
  const { busy } = props;
  return props.confirming ? (
    <span className="confirm">
      <span>This will be recorded as an override.</span>
      <button
        type="button"
        className="textbtn"
        disabled={busy}
        onClick={() => props.onAct("override")}
      >
        Move on
      </button>
      <button
        type="button"
        className="textbtn"
        onClick={() => props.onConfirm(false)}
      >
        Stay
      </button>
    </span>
  ) : (
    <button
      type="button"
      className="textbtn"
      disabled={busy}
      onClick={() => props.onConfirm(true)}
    >
      Move on without the check
    </button>
  );
}

/** When a session began, in the learner's own format: the day and the time. */
function sessionDate(startedAt: string): string {
  return new Date(startedAt).toLocaleString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
}
