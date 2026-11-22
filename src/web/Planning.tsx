// Planning from the course view (task 5.38; docs/prototype/20-course.html,
// the conversation "Change the curriculum" opens): the course's planning
// conversation in the Thread layout, fed by its event stream, as the intake
// is (Intake.tsx). The page asks the opening question itself: on a finished
// course what comes next, otherwise what to change. Each proposal is the
// curriculum change card a unit's tutor sends (CurriculumCard.tsx), with
// its diagram in the side pane; a revision replaces the card before it.
// Applying goes back to the course view.

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
} from "react";
import { compareUnits } from "../shared/curriculum-change.ts";
import { Hello, PageEvent, PlanningOpened } from "../shared/events.ts";
import { CourseWithProgress } from "../shared/library.ts";
import type { Outline } from "../shared/source.ts";
import {
  type CurriculumItem,
  emptyTimeline,
  type Item,
  reduce,
} from "../shared/timeline.ts";
import { getJson, post, postFor } from "./api.ts";
import { Composer } from "./Composer.tsx";
import { Diagram } from "./Curriculum.tsx";
import { CurriculumCard } from "./CurriculumCard.tsx";
import { Link, SidePane, TopLine } from "./Frame.tsx";
import { lead } from "./progress.ts";
import { Prose } from "./prose.tsx";
import { navigate, paths } from "./route.ts";
import { useCourseSources } from "./sources.ts";

/** Asked by the page itself, so the planner's session starts with the answer. */
const OPENING = {
  finished:
    "Every unit is finished. What would you like to do next: go further, " +
    "or go back over something? The planner sees what you have passed and " +
    "what is slipping.",
  change:
    "What would you like to change? The planner can add, drop, reorder or " +
    "reword units. A unit you have started can be renamed or given a new " +
    "prerequisite, but not dropped.",
};

export function Planning(props: { courseId: string }) {
  const { courseId } = props;
  const coursePath = `/api/courses/${encodeURIComponent(courseId)}`;
  // Undefined while loading, null when there is no such course.
  const [course, setCourse] = useState<CourseWithProgress | null>();
  const [planningId, setPlanningId] = useState<string>();
  const [timeline, dispatch] = useReducer(reduce, emptyTimeline);
  const [connected, setConnected] = useState(false);
  const [lost, setLost] = useState(false);
  const [problem, setProblem] = useState<string>();
  /** The card whose diagram is in the side pane. */
  const [diagram, setDiagram] = useState<string>();
  const closeDiagram = useCallback(() => setDiagram(undefined), []);
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  useEffect(() => {
    void getJson(coursePath, CourseWithProgress).then((answer) => {
      if (answer.ok) setCourse(answer.data);
      else if (answer.status === 404) setCourse(null);
      else setProblem(answer.error);
    });
    // The course's conversation that has not ended, or a new one.
    void postFor(`${coursePath}/planning`, PlanningOpened).then((answer) => {
      if (answer.ok) setPlanningId(answer.data.planningId);
      else setProblem(answer.error);
    });
  }, [coursePath]);

  const planningPath =
    planningId === undefined
      ? undefined
      : `${coursePath}/planning/${encodeURIComponent(planningId)}`;

  useEffect(() => {
    if (planningPath === undefined) return;
    const source = new EventSource(`${planningPath}/events`);
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
    // gives up when the server refuses, which means the conversation is
    // gone: the server restarted.
    source.onerror = () => {
      setConnected(false);
      if (source.readyState === EventSource.CLOSED) setLost(true);
    };
    return () => source.close();
  }, [planningPath]);

  // Follow the thread as it grows, unless the learner has scrolled up.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el !== null && pinned.current) el.scrollTop = el.scrollHeight;
  });

  async function act(
    route: string,
    body?: unknown,
  ): Promise<string | undefined> {
    if (planningPath === undefined) return "The conversation has not opened.";
    const refused = await post(`${planningPath}/${route}`, body);
    setProblem(refused);
    return refused;
  }

  async function apply(proposalId: string) {
    if (planningPath === undefined) return "The conversation has not opened.";
    const refused = await post(`${planningPath}/apply`, { proposalId });
    if (refused === undefined) navigate(paths.course(courseId));
    return refused;
  }

  const changes = timeline.items.filter(
    (i): i is CurriculumItem => i.kind === "curriculum",
  );
  const sources = useCourseSources(
    courseId,
    changes.flatMap((c) => c.units),
  );
  const applied = changes.some((c) => c.outcome === "applied");
  const waits = changes.some(
    (c) => c.outcome === undefined && c.historical !== true,
  );
  const open = !lost && !applied && planningId !== undefined;
  const shown = changes.find((c) => c.proposalId === diagram);
  const finished =
    course?.curriculum?.approval.status === "approved" && lead(course) === null;
  const title = course?.course.title ?? "";
  return (
    <div className={shown === undefined ? "th has-top" : "th has-top has-pane"}>
      <TopLine
        trail={[
          { label: "Library", to: paths.library },
          { label: title, to: paths.course(courseId) },
        ]}
        here="Changing the curriculum"
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
          {course === null ? (
            <p className="ph-note">
              There is no course here. Back to the{" "}
              <Link to={paths.library}>library</Link>.
            </p>
          ) : course?.curriculum == null ? null : (
            <>
              <section className="seg">
                <div className="seg-k">Planning</div>
                <h2 className="seg-t">
                  {finished ? "What comes next" : "Changing the curriculum"}
                </h2>
                <ul className="seg-objs">
                  <li>
                    {unitCount(course.curriculum.units.length)} now. Nothing
                    changes until you apply a proposal.
                  </li>
                </ul>
              </section>
              {lost && timeline.chatId === null ? null : (
                // Not shown for a conversation gone before the page saw it.
                <div className="th-tutor prose">
                  <p>{finished ? OPENING.finished : OPENING.change}</p>
                </div>
              )}
            </>
          )}
          {timeline.items.map((item) => (
            <ItemView
              key={item.key}
              item={item}
              diagramOpen={diagram}
              onToggleDiagram={(id) =>
                setDiagram(diagram === id ? undefined : id)
              }
              onApply={apply}
              onKeep={(proposalId) => act("keep", { proposalId })}
              sources={sources}
            />
          ))}
          {timeline.busy && !timeline.tutorOpen ? (
            <div className="th-tutor">
              <span
                className="wait"
                role="status"
                aria-label="The planner is writing"
              />
            </div>
          ) : null}
          {applied ? (
            <p className="ph-note">
              Applied. Back to the{" "}
              <Link to={paths.course(courseId)}>course</Link>.
            </p>
          ) : null}
          {problem === undefined ? null : <p className="ph-note">{problem}</p>}
          {lost ? (
            <p className="ph-note">
              This conversation ended when the server restarted, and nothing was
              changed. Back to the{" "}
              <Link to={paths.course(courseId)}>course</Link>, where "Change the
              curriculum" starts a new one.
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
          placeholder={
            waits ? "Push back, or ask a question" : "Message the planner"
          }
          onSend={(text) => act("messages", { text })}
          onStop={() => void act("interrupt")}
        />
      </div>
      {shown === undefined ? null : (
        <SidePane
          title="Curriculum"
          subtitle="As the proposed change would make it"
          onClose={closeDiagram}
        >
          <Diagram
            units={shown.units}
            marks={compareUnits(shown.was, shown.units).marks}
          />
        </SidePane>
      )}
    </div>
  );
}

function unitCount(n: number): string {
  return n === 1 ? "1 unit" : `${n} units`;
}

function ItemView(props: {
  item: Item;
  /** The proposal whose diagram is open. */
  diagramOpen: string | undefined;
  onToggleDiagram(proposalId: string): void;
  onApply(proposalId: string): Promise<string | undefined>;
  onKeep(proposalId: string): Promise<string | undefined>;
  /** The course's sources, once loaded, for a change's reads. */
  sources: readonly Outline[] | undefined;
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
    // The session could not be resumed after an idle close (task 2.15).
    case "fresh":
      return (
        <p className="ph-note">
          The earlier conversation could not be resumed, so the planner started
          a new one. It has been told what was said above.
        </p>
      );
    case "curriculum":
      return (
        <CurriculumCard
          item={item}
          diagramOpen={props.diagramOpen === item.proposalId}
          onToggleDiagram={() => props.onToggleDiagram(item.proposalId)}
          onApply={() => props.onApply(item.proposalId)}
          onKeep={() => props.onKeep(item.proposalId)}
          sources={props.sources}
        />
      );
    // A unit chat's items: a planning conversation has none of them.
    default:
      return null;
  }
}
