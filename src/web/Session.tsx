// A unit's session (plan task 2.11): its chat in the Thread layout, as the
// mocks settled it. The top line has the path out and the position in the
// unit, which opens the outline (docs/prototype/04-session-nav.html). Each
// phase begun is a marker in the thread, and the one next-step control sits
// where the thread has reached (03-phases.html). A question is a card in the
// thread (02-check-question.html), and the unit ends with a closing card
// (10-unit-end.html).
//
// Opening the view opens the unit on the server, which starts it or picks it
// up, then follows its event stream. A unit chat lives in the server's
// memory: once it is gone its stream answers 404, and the view opens the unit
// again and follows the new chat, whose thread starts where the record has
// the unit. In development a server restart reloads the whole page anyway
// (Vite's client does), which opens the unit the same way.

import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
} from "react";
import { Hello, PageEvent } from "../shared/events.ts";
import { CourseWithProgress } from "../shared/library.ts";
import type { Plan } from "../shared/plan.ts";
import type { AnswerSubmission } from "../shared/question.ts";
import { getJsonUntilAnswered, post, postStatus } from "./api.ts";
import { Composer } from "./Composer.tsx";
import { Link, TopLine } from "./Frame.tsx";
import { InlineProse, Prose } from "./prose.tsx";
import { QuestionCard } from "./QuestionCard.tsx";
import { navigate, paths } from "./route.ts";
import {
  closingCard,
  lastCard,
  nextStep,
  outline,
  type Placement,
  phaseMarker,
  placement,
  whereInUnit,
} from "./session.ts";
import {
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
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  const path = useCallback(
    (route: string) =>
      `/api/courses/${enc(courseId)}/units/${enc(unitId)}/${route}`,
    [courseId, unitId],
  );

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
    void postStatus(path("open")).then((opened) => {
      if (stopped) return;
      if (!opened.ok) {
        // An unreachable server may be restarting; a refusal is final.
        if (opened.status === 0) again();
        else setRefused(opened.error);
        return;
      }
      setRefused(undefined);
      const events = new EventSource(path("events"));
      source = events;
      events.addEventListener("hello", (e: MessageEvent<string>) => {
        const hello = Hello.parse(JSON.parse(e.data));
        setConnected(true);
        dispatch({ type: "hello", chatId: hello.chatId });
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

  return (
    <div className="th has-top">
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
          {timeline.items.map((item, i) => (
            <ThreadItem
              key={item.key}
              item={item}
              // A session's marker sets it apart as the top of the thread does.
              first={i === 0 || timeline.items[i - 1]?.kind === "session"}
              plan={plan}
              place={place}
              busy={busy}
              current={item === lastCard(timeline)}
              confirming={confirming === "finish"}
              onConfirm={(asking) =>
                setConfirming(asking ? "finish" : undefined)
              }
              onAnswer={(submission) => post(path("answers"), submission)}
              onGradeAgain={() => post(path("grade-again"))}
              onAgain={() => act("go-over-again")}
              onFinish={() => act("finish")}
              onCourse={toCourse}
              onNext={toNext}
            />
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
          <NextStepControl
            step={step}
            timeline={timeline}
            busy={busy}
            confirming={confirming === "move-on"}
            place={place}
            onConfirm={(asking) =>
              setConfirming(asking ? "move-on" : undefined)
            }
            onAct={(route) => void act(route)}
            onCourse={toCourse}
            onNext={toNext}
          />
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

/** The unit's outline (mock 4): the path out, the unit, and its segments. */
function Outline(props: {
  courseId: string;
  courseTitle: string;
  /** Unknown until the course's details are loaded. */
  place: Placement | undefined;
  segments: { title: string; state: string }[];
}) {
  const { place } = props;
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
  confirming: boolean;
  onConfirm(asking: boolean): void;
  onAnswer(submission: AnswerSubmission): Promise<string | undefined>;
  onGradeAgain(): Promise<string | undefined>;
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
    case "question":
      return (
        <QuestionCard
          item={item}
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
    <div className="qa-card ue">
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
          {props.confirming ? (
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
          )}
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
