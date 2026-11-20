// A unit's session (plan task 2.11): its chat in the Thread layout, as the
// mocks settled it. The top line has the path out, ending in the unit, and
// the position in the unit, which opens the outline (19-unit-page.html), whose
// segments jump to their headings in the thread. Each
// segment begins with a heading, and each phase begun is a hairline under
// it (19-unit-page.html); the one next-step control sits where the thread
// has reached (03-phases.html). A question is a card in the thread
// (02-check-question.html), its verdict one line once graded (piece 19),
// and the unit ends with a closing card
// (10-unit-end.html). "Start fresh" is in the outline, and the conversations
// before a fresh start stay in the thread, dimmed (11-start-fresh.html). An
// artifact the tutor shows opens in the side pane, and its reference in the
// thread opens and closes it (05-side-pane.html); "Course map" in the top line
// opens the curriculum diagram there instead, this unit marked (piece 19).
// Review is offered on a card
// in the thread, which becomes a marker once started or skipped, and its
// questions carry their place in it (15-review.html). The test before a unit
// is a marker and its questions, then the tutor's word on it and its result
// card, whose steps skip what passed or teach the whole unit; the outline
// and the top line show the segments skipped (16-test-out-and-gate.html).
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
import {
  assessmentCard,
  assessmentEndMarker,
  assessmentMarker,
  type ResultRow,
  testResultCard,
} from "../shared/assessment-view.ts";
import { compareUnits } from "../shared/curriculum-change.ts";
import {
  Hello,
  PageEvent,
  type SkipTestedPost,
  UnitOpened,
} from "../shared/events.ts";
import { CourseWithProgress } from "../shared/library.ts";
import { currentObjective, type Plan } from "../shared/plan.ts";
import type { AnswerPost, OpenFilePost } from "../shared/question.ts";
import { messageParts } from "../shared/quote.ts";
import {
  type ArtifactItem,
  type AssessmentItem,
  type CurriculumItem,
  conversations,
  emptyTimeline,
  type Item,
  reduce,
  standingCard,
  type TestResultItem,
  type Timeline,
  type UnitEndItem,
} from "../shared/timeline.ts";
import { getJsonUntilAnswered, post, postFor } from "./api.ts";
import { Composer, type ComposerHandle } from "./Composer.tsx";
import { Diagram } from "./Curriculum.tsx";
import { CurriculumCard } from "./CurriculumCard.tsx";
import { type DisputeApi, disputeApi } from "./Dispute.tsx";
import { Link, SidePane, TopLine } from "./Frame.tsx";
import { NotesOffer } from "./Notes.tsx";
import { PackagesCard } from "./PackagesCard.tsx";
import { mapMark } from "./progress.ts";
import { InlineProse, Prose } from "./prose.tsx";
import { QuestionCard } from "./QuestionCard.tsx";
import { QuoteOffer } from "./QuoteOffer.tsx";
import { navigate, paths } from "./route.ts";
import { StatusForm } from "./StatusForm.tsx";
import { StyleCard } from "./StyleCard.tsx";
import {
  assessmentDetourStep,
  type ClosingCardRow,
  closingCard,
  detourSays,
  divided,
  finishedByTest,
  helpNotice,
  judgmentSays,
  lastCard,
  nextStep,
  openQuestion,
  outline,
  type Placement,
  phaseMarker,
  placement,
  type SegmentHeading,
  SKIP_GATE_ASKS,
  type SkipGateAsks,
  segmentHeading,
  skipGatePartway,
  skipLabel,
  type UnitOutline,
  whereInUnit,
} from "./session.ts";
import { objectiveMark } from "./what-i-know.ts";

const enc = encodeURIComponent;

/** How long to wait before opening a unit again once its chat is lost. */
const RETRY_MS = 1000;

/** How long a heading the outline jumped to stays lit before it fades. */
const LIT_MS = 900;

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
  /** The heading the outline last jumped to, lit for a moment; a new object each jump. */
  const [lit, setLit] = useState<{ id: string }>();
  const [confirming, setConfirming] = useState<
    "move-on" | "finish" | "skip-gate"
  >();
  /**
   * What the side pane shows, one thing at a time: an artifact, a proposed
   * curriculum's diagram, or the course map.
   */
  const [pane, setPane] = useState<
    ArtifactItem | CurriculumItem | { kind: "map" }
  >();
  /** The unit picked on the course map, whose lines are lit. */
  const [picked, setPicked] = useState<string>();
  /** The open question the learner hid, by its key. */
  const [hiddenKey, setHiddenKey] = useState<number>();
  const hideButton = useRef<HTMLButtonElement>(null);
  const composer = useRef<ComposerHandle>(null);
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
  // biome-ignore lint/correctness/useExhaustiveDependencies: refetch on Apply or after reopening
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
  }, [courseId, attempt, timeline.curriculumChangedAt]);

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

  useEffect(() => {
    if (lit === undefined) return;
    const off = setTimeout(() => setLit(undefined), LIT_MS);
    return () => clearTimeout(off);
  }, [lit]);

  /**
   * Scrolls the thread, and only the thread, to a segment's heading and
   * lights it; with no smooth scroll under reduced motion, where the light
   * goes out with no fade (styles.css).
   */
  const jump = useCallback((id: string) => {
    setOutlineOpen(false);
    const el = scroller.current;
    const target = document.getElementById(id);
    if (el === null || target === null) return;
    pinned.current = false;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({
      top:
        target.getBoundingClientRect().top -
        el.getBoundingClientRect().top +
        el.scrollTop -
        24,
      behavior: still ? "instant" : "smooth",
    });
    target.focus({ preventScroll: true });
    setLit({ id });
  }, []);

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
  const where = plan === null ? null : whereInUnit(plan, timeline);
  const step = nextStep(timeline);
  const open = timeline.position !== null || timeline.finished !== null;
  const parts = conversations(timeline.items);
  // The objective to do now is marked in the heading of the segment the unit
  // is in, the thread's last.
  const current =
    plan === null
      ? undefined
      : currentObjective(plan, timeline.position, timeline.statuses);
  const lastHeading = timeline.items.findLast(
    (i) => i.kind === "phase" && i.heading !== undefined,
  );
  // The closing card whose steps can be taken, if one stands.
  const standing = standingCard(timeline.items);
  // The test's result card whose steps can be taken, if it waits.
  const result = timeline.testWaits
    ? timeline.items.findLast((i) => i.kind === "test_result")
    : undefined;
  // A full test-out ends at the test card, not at a teaching closing card.
  const notesItem =
    timeline.finished === null
      ? undefined
      : finishedByTest(timeline)
        ? timeline.items.findLast((i) => i.kind === "test_result")
        : lastCard(timeline);
  const notes =
    timeline.finished === null ? null : (
      <NotesOffer
        key={paths.notes(courseId, unitId)}
        courseId={courseId}
        unitId={unitId}
      />
    );
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
      confirmingSkip={confirming === "skip-gate"}
      place={place}
      onConfirm={(asking) => setConfirming(asking ? "move-on" : undefined)}
      onConfirmSkip={(asking) =>
        setConfirming(asking ? "skip-gate" : undefined)
      }
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
        hereLabel={place === undefined ? undefined : `Unit ${place.number}`}
        here={place?.title ?? ""}
        action={
          <div className="nl-tools">
            {where === null ? null : (
              <PositionButton
                label={where.label}
                title={where.title}
                ticks={where.ticks}
                open={outlineOpen}
                onToggle={setOutlineOpen}
              >
                {plan === null ? null : (
                  <Outline
                    place={place}
                    count={plan.segments.length}
                    transcriptUrl={path("transcript")}
                    outline={outline(plan, timeline)}
                    // A unit that is open and not finished has a tutor to replace.
                    canStartFresh={
                      timeline.position !== null &&
                      timeline.finished === null &&
                      timeline.failed === null
                    }
                    busy={busy}
                    onJump={jump}
                    onStartFresh={async () => {
                      await act("start-fresh");
                      setOutlineOpen(false);
                    }}
                  />
                )}
              </PositionButton>
            )}
            <button
              type="button"
              className="nl-pos"
              aria-pressed={pane?.kind === "map"}
              disabled={stored?.curriculum == null}
              onClick={() => {
                setPicked(undefined);
                setPane(pane?.kind === "map" ? undefined : { kind: "map" });
              }}
            >
              {MAP_ICON}
              Course map
            </button>
          </div>
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
                      heading={
                        item.kind === "phase" && plan !== null
                          ? segmentHeading(
                              plan,
                              item,
                              timeline.statuses,
                              item === lastHeading ? current : undefined,
                            )
                          : undefined
                      }
                      plan={plan}
                      lit={
                        item.kind === "phase" &&
                        item.heading !== undefined &&
                        item.heading === lit?.id
                      }
                      place={place}
                      busy={busy}
                      current={item === standing}
                      notes={item === notesItem ? notes : null}
                      // By file, which names one artifact of the course
                      // across restarts, where keys are numbered afresh.
                      showing={
                        item.kind === "artifact" &&
                        pane?.kind === "artifact" &&
                        pane.file === item.file
                      }
                      onArtifact={(artifact) =>
                        setPane(
                          pane?.kind === "artifact" &&
                            pane.file === artifact.file
                            ? undefined
                            : artifact,
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
                      onApplyStyle={(proposalId) =>
                        post(path("style/apply"), { proposalId })
                      }
                      onKeepStyle={(proposalId) =>
                        post(path("style/keep"), { proposalId })
                      }
                      diagramOpen={
                        item.kind === "curriculum" &&
                        pane?.kind === "curriculum" &&
                        pane.proposalId === item.proposalId
                      }
                      onDiagram={(change) =>
                        setPane(
                          pane?.kind === "curriculum" &&
                            pane.proposalId === change.proposalId
                            ? undefined
                            : change,
                        )
                      }
                      onApplyCurriculum={(proposalId) =>
                        post(path("curriculum/apply"), { proposalId })
                      }
                      onKeepCurriculum={(proposalId) =>
                        post(path("curriculum/keep"), { proposalId })
                      }
                      onAgain={() => act("go-over-again")}
                      onFinish={() => act("finish")}
                      offered={
                        item.kind === "assessment" &&
                        item.stage === "offered" &&
                        timeline.assessment?.stage === "offered"
                      }
                      onStartAssessment={() => act("assessment/start")}
                      onSkipAssessment={() => act("assessment/skip")}
                      answers={item === result}
                      onSkipTested={(objectives) =>
                        act("test-out/skip", {
                          objectives,
                        } satisfies SkipTestedPost)
                      }
                      onTeachWhole={() => act("test-out/whole")}
                      confirmingSkip={confirming === "skip-gate"}
                      onConfirmSkip={(asking) =>
                        setConfirming(asking ? "skip-gate" : undefined)
                      }
                      onCourse={toCourse}
                      onNext={toNext}
                    />
                  </Fragment>
                );
              })}
            </div>
          ))}
          {notesItem === undefined && notes !== null ? (
            <div className="qa-card ue">{notes}</div>
          ) : null}
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
          ref={composer}
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
        {open && timeline.failed === null ? (
          <QuoteOffer onQuote={(passage) => composer.current?.quote(passage)} />
        ) : null}
      </div>
      {pane === undefined ? null : pane.kind === "map" ? (
        stored?.curriculum == null ? null : (
          <SidePane
            title="Course map"
            subtitle={courseTitle}
            onClose={closePane}
          >
            <Diagram
              units={stored.curriculum.units}
              standing={(id) => {
                const unit = stored.curriculum?.units.find((u) => u.id === id);
                return unit === undefined
                  ? { state: "todo", text: "" }
                  : mapMark(stored, unit, unitId);
              }}
              selected={picked}
              onSelect={setPicked}
              here={unitId}
            />
          </SidePane>
        )
      ) : pane.kind === "artifact" ? (
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
      ) : (
        <SidePane
          title="Curriculum"
          subtitle="As the proposed change would make it"
          onClose={closePane}
        >
          <Diagram
            units={pane.units}
            marks={compareUnits(pane.was, pane.units).marks}
          />
        </SidePane>
      )}
    </div>
  );
}

/** The position in the top line, which opens the unit's outline. */
function PositionButton(props: {
  label: string;
  title: string | undefined;
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
        <span className="nl-k">{props.label}</span>
        {props.title === undefined ? null : (
          <span className="nl-t">
            <InlineProse text={props.title} />
          </span>
        )}
        {CHEVRON}
      </button>
      {open ? (
        <div className="np" role="dialog" aria-label="Unit outline" ref={panel}>
          {props.children}
        </div>
      ) : null}
    </>
  );
}

/** The course map's icon: three units and their lines. */
const MAP_ICON = (
  <svg
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    aria-hidden="true"
  >
    <rect x="1.5" y="1.5" width="5" height="3.5" rx="1" />
    <rect x="9.5" y="6.25" width="5" height="3.5" rx="1" />
    <rect x="1.5" y="11" width="5" height="3.5" rx="1" />
    <path d="M4 5v6M6.5 3.25h3v3" />
  </svg>
);

const CHEVRON = (
  <svg
    width="12"
    height="12"
    viewBox="0 0 12 12"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    aria-hidden="true"
  >
    <path d="M3 4.5 6 7.5 9 4.5" />
  </svg>
);

/**
 * The unit's outline (piece 19): the unit, its segments numbered with their
 * objectives' forms, going over again and the gate where they fall, then
 * "Export transcript" and "Start fresh" (mock 11), which asks once. A past
 * or current segment with a heading in the thread jumps to it.
 */
function Outline(props: {
  /** Unknown until the course's details are loaded. */
  place: Placement | undefined;
  /** How many segments the plan has. */
  count: number;
  transcriptUrl: string;
  outline: UnitOutline;
  canStartFresh: boolean;
  /** The tutor is writing, so starting fresh waits. */
  busy: boolean;
  onJump(id: string): void;
  onStartFresh(): Promise<void>;
}) {
  const { place } = props;
  const [asking, setAsking] = useState(false);
  const { gate } = props.outline;
  const gateRow =
    gate === null ? null : (
      <li
        key="gate"
        className={`uo-seg ${gate.state || "todo"}`}
        aria-current={gate.state === "now" ? "step" : undefined}
      >
        <div className="uo-head">
          <span className="uo-n">
            <i
              className={`sg gate ${gate.state === "now" ? "now" : gate.state === "past" ? "pass" : "not"}`}
              aria-hidden="true"
            />
          </span>
          <span className="uo-t">Unit gate</span>
          <span className="uo-r">{gate.says}</span>
        </div>
        <p className="uo-objs">Questions on this unit, and on other units</p>
      </li>
    );
  const rows = props.outline.segments.map((segment, i) => {
    const head = (
      <>
        <span className="uo-n">{segment.number}</span>
        <span className="uo-t">
          <InlineProse text={segment.title} />
        </span>
        {segment.says === undefined ? null : (
          <span className="uo-r">{segment.says}</span>
        )}
      </>
    );
    const { heading } = segment;
    return (
      <li
        // The plan's segments in order, then the one that goes over again.
        // biome-ignore lint/suspicious/noArrayIndexKey: see above
        key={i}
        className={`uo-seg ${segment.state || "todo"}`}
        aria-current={segment.state === "now" ? "step" : undefined}
      >
        {heading === undefined ? (
          <div className="uo-head">{head}</div>
        ) : (
          <button
            type="button"
            className="uo-head"
            onClick={() => props.onJump(heading)}
          >
            {head}
          </button>
        )}
        <ul className="uo-objs">
          {segment.objectives.map((o) => (
            <li key={o.id} className={o.skipped ? "skip" : undefined}>
              <StatusForm objective={o.status} current={o.current} />
              <span>
                <InlineProse text={o.statement} />
                <span className="sr">
                  , {objectiveMark(o.status).text}
                  {o.skipped ? ", skipped" : ""}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </li>
    );
  });
  // Going over again that followed the gate comes after it.
  const ordered = props.outline.gateBeforeLast
    ? [...rows.slice(0, -1), gateRow, ...rows.slice(-1)]
    : [...rows, gateRow];
  return (
    <div className="uo">
      {place === undefined ? null : (
        <div className="uo-unit">
          <span>
            Unit {place.number} of {place.count} · {props.count}{" "}
            {props.count === 1 ? "segment" : "segments"}
          </span>
          <b>{place.title}</b>
        </div>
      )}
      <ol className="uo-list">{ordered}</ol>
      <div className="uo-foot">
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
            <a className="textbtn" href={props.transcriptUrl}>
              Export transcript
            </a>
            {props.canStartFresh ? (
              <button
                type="button"
                className="textbtn"
                disabled={props.busy}
                onClick={() => setAsking(true)}
              >
                Start fresh
              </button>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

function ThreadItem(props: {
  item: Item;
  /** The heading of the segment this phase begins, if it begins one. */
  heading: SegmentHeading | undefined;
  /** The heading is the one the outline just jumped to. */
  lit: boolean;
  plan: Plan | null;
  place: Placement | undefined;
  busy: boolean;
  /** The closing card standing at the thread's end, the only one whose steps can be taken. */
  current: boolean;
  notes: ReactNode;
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
  onApplyStyle(proposalId: string): Promise<string | undefined>;
  onKeepStyle(proposalId: string): Promise<string | undefined>;
  /** This is the curriculum change whose diagram the side pane shows. */
  diagramOpen: boolean;
  /** Opens the change's diagram in the side pane, or closes it if it is showing. */
  onDiagram(change: CurriculumItem): void;
  onApplyCurriculum(proposalId: string): Promise<string | undefined>;
  onKeepCurriculum(proposalId: string): Promise<string | undefined>;
  onAgain(): void;
  onFinish(): void;
  /** This is the card of the assessment offered now, whose Start and Skip can be pressed. */
  offered: boolean;
  onStartAssessment(): void;
  onSkipAssessment(): void;
  /** "Skip the gate" asks before it skips. */
  confirmingSkip: boolean;
  onConfirmSkip(asking: boolean): void;
  /** This is the test's result card that waits, whose steps can be taken. */
  answers: boolean;
  onSkipTested(objectives: string[]): void;
  onTeachWhole(): void;
  onCourse(): void;
  onNext: (() => void) | undefined;
}) {
  const { item } = props;
  switch (item.kind) {
    case "learner":
      return <LearnerMessage text={item.text} />;
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
    case "style":
      return (
        <StyleCard
          item={item}
          onApply={() => props.onApplyStyle(item.proposalId)}
          onKeep={() => props.onKeepStyle(item.proposalId)}
        />
      );
    case "curriculum":
      return (
        <CurriculumCard
          item={item}
          diagramOpen={props.diagramOpen}
          onToggleDiagram={() => props.onDiagram(item)}
          onApply={() => props.onApplyCurriculum(item.proposalId)}
          onKeep={() => props.onKeepCurriculum(item.proposalId)}
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
    case "assessment": {
      if (item.stage === "offered") {
        return (
          <AssessmentCard
            item={item}
            title={props.place?.title}
            live={props.offered}
            busy={props.busy}
            confirmingSkip={props.confirmingSkip}
            onConfirmSkip={props.onConfirmSkip}
            onStart={props.onStartAssessment}
            onSkip={props.onSkipAssessment}
          />
        );
      }
      const marker = assessmentMarker(item);
      return (
        <div className="pf-mark">
          <span>
            <b>{marker.name}</b> {marker.says}
          </span>
        </div>
      );
    }
    case "test_result":
      return props.plan === null ? null : (
        <TestResult
          item={item}
          plan={props.plan}
          place={props.place}
          notes={props.notes}
          live={props.answers}
          busy={props.busy}
          onSkip={props.onSkipTested}
          onWhole={props.onTeachWhole}
        />
      );
    case "assessment_end": {
      const marker = assessmentEndMarker(item);
      return (
        <div className="pf-mark">
          <span>
            <b>{marker.name}</b> {marker.says}
          </span>
        </div>
      );
    }
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
      const marker = phaseMarker(item);
      return (
        <>
          {props.heading === undefined ? null : (
            <SegmentHead heading={props.heading} lit={props.lit} />
          )}
          <div className="pf-mark">
            <span>
              <b>{marker.name}</b>
              {marker.says === undefined ? null : ` ${marker.says}`}
            </span>
          </div>
        </>
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
          notes={props.notes}
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

/**
 * A learner's message: their own text as typed, and a passage they quoted
 * (piece 19) as a quote, set as the tutor's text was.
 */
function LearnerMessage(props: { text: string }) {
  return (
    <div className="th-you">
      {messageParts(props.text).map((part, i) =>
        part.quote ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: a message's parts never move
          <blockquote key={i} className="th-quote prose">
            <Prose text={part.text} />
          </blockquote>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: a message's parts never move
          <Fragment key={i}>{part.text}</Fragment>
        ),
      )}
    </div>
  );
}

/**
 * Where a segment begins (piece 19): a rule, "Segment N of M", its title,
 * and its objectives with their forms as they stand now.
 */
function SegmentHead(props: { heading: SegmentHeading; lit: boolean }) {
  const { heading } = props;
  return (
    // Focused when the outline jumps here, so the keyboard goes on from it.
    <section
      className={props.lit ? "seg lit" : "seg"}
      id={heading.id}
      tabIndex={-1}
    >
      {heading.label === undefined ? null : (
        <div className="seg-k">{heading.label}</div>
      )}
      <h2 className="seg-t">{heading.title}</h2>
      <ul className="seg-objs">
        {heading.objectives.map((o) => (
          <li
            key={o.id}
            className="seg-o"
            aria-current={o.current ? "step" : undefined}
          >
            <StatusForm objective={o.status} current={o.current} />
            <span>
              <InlineProse text={o.statement} />
              <span className="sr">, {objectiveMark(o.status).text}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
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
  notes: ReactNode;
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
        {props.notes}
      </div>
    );
  }
  let foot: ReactNode;
  if (!view.steps) {
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
      <CardRows rows={view.rows} />
      {view.others.length === 0 ? null : (
        <div className="ue-sec">
          <div className="cs-h">
            <span>Also asked, from other units</span>
          </div>
          <CardRows rows={view.others} />
        </div>
      )}
      {props.notes}
      {foot}
    </div>
  );
}

/**
 * The test's result card (piece 16): a row per objective with why, then
 * what skipping would do to each segment, and the two steps. Once answered,
 * one line, and where teaching starts.
 */
function TestResult(props: {
  item: TestResultItem;
  plan: Plan;
  place: Placement | undefined;
  notes: ReactNode;
  /** It waits, and its steps can be taken. */
  live: boolean;
  busy: boolean;
  onSkip(objectives: string[]): void;
  onWhole(): void;
}) {
  const { place } = props;
  const card = testResultCard(props.plan, props.item);
  const title =
    place === undefined ? "" : `Unit ${place.number}: ${place.title}`;
  const head = (
    <div className="q-count">
      <b>Test finished</b>
      <span className={card.says.className}>{card.says.text}</span>
    </div>
  );
  if (card.answered !== undefined) {
    return (
      <>
        <div className="qa-card done">
          {head}
          <div className="qa-line">
            <span>{title}</span>
            <span className="c">{card.answered}</span>
          </div>
          {props.notes}
        </div>
        {card.startsAt === undefined ? null : (
          <div className="ph-note">
            {card.startsAt} The outline, at the top right, shows what is
            skipped.
          </div>
        )}
      </>
    );
  }
  return (
    <div className={props.live ? "qa-card ue live" : "qa-card ue"}>
      {head}
      <div className="qa-prompt">{title}</div>
      <ResultRows rows={card.objectives} />
      {card.segments === null ? null : (
        <div className="ue-sec">
          <div className="cs-h">
            <span>{card.segmentsSay}</span>
          </div>
          {/* A segment's title is plain text, as in the outline: "1. Values" is no list. */}
          <ResultRows rows={card.segments} plain />
        </div>
      )}
      {card.segments === null ? null : (
        <p className="as-says">What you passed stays passed either way.</p>
      )}
      {props.notes}
      {!props.live ? null : card.segments === null ? (
        <div className="qa-foot">
          <span className="qa-aside">
            Nothing to skip: the unit is taught from its first segment.
          </span>
          <button
            type="button"
            className="btn"
            disabled={props.busy}
            onClick={props.onWhole}
          >
            {card.whole}
          </button>
        </div>
      ) : (
        <div className="qa-foot">
          <button
            type="button"
            className="textbtn"
            disabled={props.busy}
            onClick={props.onWhole}
          >
            {card.whole}
          </button>
          <button
            type="button"
            className="btn"
            disabled={props.busy}
            onClick={() =>
              props.onSkip(
                props.item.objectives
                  .filter((o) => o.passed)
                  .map((o) => o.objective),
              )
            }
          >
            {card.skip}
          </button>
        </div>
      )}
    </div>
  );
}

/** The result card's rows: an objective or a segment, its word, and why. */
function ResultRows(props: { rows: ResultRow[]; plain?: boolean }) {
  return (
    <ol className="ue-rows">
      {props.rows.map((row) => (
        <li key={row.key}>
          <span>
            {props.plain === true ? row.text : <InlineProse text={row.text} />}
          </span>
          <span className={`st ${row.word.className}`}>{row.word.text}</span>
          {row.why === undefined ? null : (
            <small>
              <InlineProse text={row.why} />
            </small>
          )}
        </li>
      ))}
    </ol>
  );
}

/** A closing card's rows: each objective with its status, and why when it did not pass. */
function CardRows(props: { rows: ClosingCardRow[] }) {
  return (
    <ol className="ue-rows">
      {props.rows.map((row) => (
        <li key={row.id}>
          <span>
            <InlineProse text={row.statement} />
          </span>
          <span className={`st ${row.word.className}`}>
            <StatusForm objective={row.status} />
            {row.word.text}
          </span>
          {row.why === undefined ? null : <small>{row.why}</small>}
        </li>
      ))}
    </ol>
  );
}

/**
 * The card that offers an assessment, with Skip and Start (piece 15). Only
 * the card offered now can be answered; one a restart left behind is shown
 * as it was.
 */
function AssessmentCard(props: {
  item: AssessmentItem;
  /** The unit's title, which the gate's card names. */
  title: string | undefined;
  live: boolean;
  busy: boolean;
  confirmingSkip: boolean;
  onConfirmSkip(asking: boolean): void;
  onStart(): void;
  onSkip(): void;
}) {
  const card = assessmentCard(props.item);
  const gate = props.item.mode === "gate";
  return (
    <div className={props.live ? "qa-card as live" : "qa-card as"}>
      <div className="q-count">
        <b>{card.title}</b>
        {card.questions}
      </div>
      {gate && props.title !== undefined ? (
        <div className="qa-prompt">{props.title}</div>
      ) : null}
      {card.says.map((line) => (
        <p key={line} className="as-says">
          {line}
        </p>
      ))}
      {!props.live ? null : gate ? (
        // The gate is offered once, so skipping it asks first.
        <div className="qa-foot">
          <SkipGate
            asks={SKIP_GATE_ASKS}
            busy={props.busy}
            confirming={props.confirmingSkip}
            onConfirm={props.onConfirmSkip}
            onSkip={props.onSkip}
          />
          {props.confirmingSkip ? null : (
            <button
              type="button"
              className="btn"
              disabled={props.busy}
              onClick={props.onStart}
            >
              {card.start}
            </button>
          )}
        </div>
      ) : (
        <div className="qa-foot">
          <button
            type="button"
            className="textbtn"
            disabled={props.busy}
            onClick={props.onSkip}
          >
            {card.skip}
          </button>
          <button
            type="button"
            className="btn"
            disabled={props.busy}
            onClick={props.onStart}
          >
            {card.start}
          </button>
        </div>
      )}
    </div>
  );
}

/** "Skip the gate", which asks once before it skips: on its card, or partway with its own text. */
function SkipGate(props: {
  asks: SkipGateAsks;
  busy: boolean;
  confirming: boolean;
  onConfirm(asking: boolean): void;
  onSkip(): void;
}) {
  return props.confirming ? (
    <span className="confirm">
      <span className="says">
        {props.asks.says.map((line) => (
          <span key={line}>{line}</span>
        ))}
      </span>
      <button
        type="button"
        className="textbtn"
        disabled={props.busy}
        onClick={props.onSkip}
      >
        {props.asks.skip}
      </button>
      <button
        type="button"
        className="textbtn"
        onClick={() => props.onConfirm(false)}
      >
        {props.asks.stay}
      </button>
    </span>
  ) : (
    <button
      type="button"
      className="textbtn"
      disabled={props.busy}
      onClick={() => props.onConfirm(true)}
    >
      Skip the gate
    </button>
  );
}

/** The one control that moves the unit on, where the thread has reached. */
function NextStepControl(props: {
  step: ReturnType<typeof nextStep>;
  timeline: Timeline;
  busy: boolean;
  confirming: boolean;
  /** "Skip the gate" asks before it skips. */
  confirmingSkip: boolean;
  /** Unknown until the course's details are loaded. */
  place: Placement | undefined;
  onConfirm(asking: boolean): void;
  onConfirmSkip(asking: boolean): void;
  onAct(route: string): void;
  onCourse(): void;
  onNext: (() => void) | undefined;
}) {
  const { step, busy } = props;
  const gate = props.timeline.assessment?.mode === "gate";
  const skip = gate ? (
    <SkipGate
      asks={skipGatePartway(props.timeline)}
      busy={busy}
      confirming={props.confirmingSkip}
      onConfirm={props.onConfirmSkip}
      onSkip={() => props.onAct("assessment/skip")}
    />
  ) : (
    <button
      type="button"
      className="textbtn"
      disabled={busy}
      onClick={() => props.onAct("assessment/skip")}
    >
      {skipLabel(props.timeline)}
    </button>
  );
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
    case "assessment":
      return <div className="pf-act">{skip}</div>;
    case "assessment-detour": {
      const step = assessmentDetourStep(props.timeline);
      return (
        <div className="pf-act">
          {props.confirmingSkip ? null : (
            <button
              type="button"
              className="btn sm"
              disabled={busy}
              onClick={() => props.onAct("another-question")}
            >
              {step.label}
            </button>
          )}
          {step.skip ? skip : null}
        </div>
      );
    }
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
            ? finishedByTest(props.timeline)
              ? "This unit is finished: you passed every objective in the test, and nothing was taught. It has no gate."
              : "This unit is finished: every objective passed."
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
