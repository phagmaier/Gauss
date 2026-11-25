// Planning from the course view (task 5.38; docs/prototype/20-course.html,
// the conversation "Change the curriculum" opens): the course's planning
// conversation in the Thread layout, fed by its event stream, as the intake
// is (Intake.tsx). The page asks the opening question itself: on a finished
// course what comes next, otherwise what to change. Each proposal is the
// curriculum change card a unit's tutor sends (CurriculumCard.tsx), with
// its diagram in the side pane; a revision replaces the card before it.
// A source is attached as in the intake (piece 26): its card says it joins
// the course when a change is applied, and the change card lists the
// sources it adds. Applying goes back to the course view.

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
} from "react";
import { unitSections } from "../shared/curriculum.ts";
import { compareUnits } from "../shared/curriculum-change.ts";
import { Hello, PageEvent, PlanningOpened } from "../shared/events.ts";
import { CourseWithProgress } from "../shared/library.ts";
import { Outline } from "../shared/source.ts";
import type { SourceTarget } from "../shared/source-target.ts";
import {
  type CurriculumItem,
  emptyTimeline,
  type Item,
  reduce,
  type SourceItem,
} from "../shared/timeline.ts";
import { getJson, getJsonUntilAnswered, post, postFor } from "./api.ts";
import {
  AttachmentOutline,
  DropHint,
  useFileDrop,
  useSourceUploads,
} from "./attach.tsx";
import { Composer } from "./Composer.tsx";
import { Diagram } from "./Curriculum.tsx";
import { CurriculumCard } from "./CurriculumCard.tsx";
import { Link, SidePane, TopLine } from "./Frame.tsx";
import { lead } from "./progress.ts";
import { Prose } from "./prose.tsx";
import { navigate, paths } from "./route.ts";
import { SourceCard } from "./SourceCard.tsx";
import { readsSources, useCourseSources } from "./sources.ts";

type OutlineTarget = Extract<SourceTarget, { kind: "outline" }>;

/** Asked by the page itself, so the planner's session starts with the answer. */
const OPENING = {
  finished:
    "Every unit is finished. What would you like to do next: go further, " +
    "or go back over something? The planner sees what you have passed and " +
    "what is slipping. To teach from another book or paper, attach it " +
    "here; it joins the course when you apply a change.",
  change:
    "What would you like to change? The planner can add, drop, reorder or " +
    "reword units. A unit you have started can be renamed or given a new " +
    "prerequisite, but not dropped. To teach from another book or paper, " +
    "attach it here; it joins the course when you apply a change.",
};

/** Said on an attached source's card while the proposal waiting reads it. */
const READ_BY_PROPOSAL = "The proposal waiting reads it";

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
  /** The attached source whose outline is in the side pane. */
  const [outline, setOutline] = useState<
    OutlineTarget & { attachment: string }
  >();
  const closeDiagram = useCallback(() => setDiagram(undefined), []);
  const closeOutline = useCallback(() => setOutline(undefined), []);
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
  const applied = changes.some((c) => c.outcome === "applied");
  const waiting = changes.find(
    (c) => c.outcome === undefined && c.historical !== true,
  );
  const waits = waiting !== undefined;
  const open = !lost && !applied && planningId !== undefined;
  const attached = timeline.items.filter(
    (i): i is SourceItem & { facts: NonNullable<SourceItem["facts"]> } =>
      i.kind === "source" && i.state === "attached" && i.facts !== undefined,
  );
  const sourcesPath =
    planningPath === undefined ? undefined : `${planningPath}/sources`;
  const outlines = useAttachedOutlines(sourcesPath, attached);
  const added = attached.flatMap((i) => outlines.get(i.attachment) ?? []);
  const { sources: courseSources, problem: sourceProblem } = useCourseSources(
    courseId,
    readsSources(changes.flatMap((c) => c.units)),
  );
  // A change reads the course's sources and those attached here.
  const sources =
    courseSources === undefined
      ? undefined
      : [
          ...courseSources,
          ...added.filter((s) => !courseSources.some((c) => c.id === s.id)),
        ];
  /** The sources the proposal waiting reads, which cannot be removed. */
  const readByWaiting = new Set(
    waiting?.units.flatMap((unit) =>
      unitSections(unit).map((ref) => ref.slice(0, ref.indexOf("/"))),
    ),
  );
  const uploads = useSourceUploads(sourcesPath, timeline.items);
  const drop = useFileDrop(open, uploads.attach);
  const shown = changes.find((c) => c.proposalId === diagram);
  const outlined = attached.find((i) => i.attachment === outline?.attachment);
  const finished =
    course?.curriculum?.approval.status === "approved" && lead(course) === null;
  const title = course?.course.title ?? "";
  return (
    <div
      className={
        shown === undefined && outlined === undefined
          ? "th has-top"
          : "th has-top has-pane"
      }
      {...drop.handlers}
    >
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
              onToggleDiagram={(id) => {
                setOutline(undefined);
                setDiagram(diagram === id ? undefined : id);
              }}
              onApply={apply}
              onKeep={(proposalId) => act("keep", { proposalId })}
              sources={sources}
              adds={applied ? [] : added}
              source={{
                applied,
                open,
                readByWaiting,
                outlineOpen: (attachment) => outline?.attachment === attachment,
                onOutline(source, attachment) {
                  setDiagram(undefined);
                  setOutline(
                    outline?.attachment === attachment
                      ? undefined
                      : { kind: "outline", source, attachment },
                  );
                },
                onRemove: (attachment) =>
                  act(`sources/${encodeURIComponent(attachment)}/remove`),
              }}
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
          {uploads.errors.map(({ key, name, error }) => (
            <p key={key} className="ph-note">
              {name}: {error}
            </p>
          ))}
          {sourceProblem === undefined ? null : (
            <p className="ph-note">{sourceProblem}</p>
          )}
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
          holdSend={uploads.converting}
          onAttach={uploads.attach}
          placeholder={
            waits ? "Push back, or ask a question" : "Message the planner"
          }
          onSend={(text) => act("messages", { text })}
          onStop={() => void act("interrupt")}
        />
      </div>
      {drop.dragging ? <DropHint /> : null}
      {shown !== undefined ? (
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
      ) : outline !== undefined &&
        outlined !== undefined &&
        sourcesPath !== undefined ? (
        <AttachmentOutline
          key={`${sourcesPath}/${outline.source}`}
          base={applied ? `${coursePath}/sources` : sourcesPath}
          target={outline}
          title={outlined.facts.title}
          known={outlines.get(outline.attachment)}
          units={waiting?.units ?? course?.curriculum?.units ?? []}
          onClose={closeOutline}
        />
      ) : null}
    </div>
  );
}

function unitCount(n: number): string {
  return n === 1 ? "1 unit" : `${n} units`;
}

/** What a planning conversation's source card needs. */
interface SourceCardContext {
  /** A change was applied, so the sources attached here are the course's. */
  applied: boolean;
  open: boolean;
  readByWaiting: ReadonlySet<string>;
  outlineOpen(attachment: string): boolean;
  onOutline(source: string, attachment: string): void;
  onRemove(attachment: string): Promise<string | undefined>;
}

function ItemView(props: {
  item: Item;
  /** The proposal whose diagram is open. */
  diagramOpen: string | undefined;
  onToggleDiagram(proposalId: string): void;
  onApply(proposalId: string): Promise<string | undefined>;
  onKeep(proposalId: string): Promise<string | undefined>;
  /** The course's sources and those attached here, once loaded, for a change's reads. */
  sources: readonly Outline[] | undefined;
  /** The outlines of the sources that join the course with a change. */
  adds: readonly Outline[];
  source: SourceCardContext;
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
    case "source": {
      const { source } = props;
      const id = item.facts?.id;
      return (
        <SourceCard
          item={item}
          status={
            source.applied ? "Added to the course" : "Joins when you apply"
          }
          canRemove={source.open}
          kept={
            id !== undefined && source.readByWaiting.has(id)
              ? READ_BY_PROPOSAL
              : undefined
          }
          outlineOpen={source.outlineOpen(item.attachment)}
          onOutline={(id) => source.onOutline(id, item.attachment)}
          onRemove={() => source.onRemove(item.attachment)}
        />
      );
    }
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
          adds={props.adds}
        />
      );
    // A unit chat's items: a planning conversation has none of them.
    default:
      return null;
  }
}

/**
 * The outlines of the sources attached in the conversation, read from it,
 * by attachment: a file attached in place of a removed one can take its id.
 * Each is asked for once, and asked again after a failure.
 */
function useAttachedOutlines(
  base: string | undefined,
  attached: readonly { attachment: string; facts: { id: string } }[],
): ReadonlyMap<string, Outline> {
  const [read, setRead] = useState<ReadonlyMap<string, Outline>>(
    () => new Map(),
  );
  const [asked] = useState(() => new Set<string>());
  const stop = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    stop.current = controller;
    // Unmounting stops what was asked, so a page mounted again asks anew.
    return () => {
      controller.abort();
      asked.clear();
    };
  }, [asked]);
  useEffect(() => {
    const signal = stop.current?.signal;
    if (base === undefined || signal === undefined) return;
    for (const { attachment, facts } of attached) {
      if (asked.has(attachment)) continue;
      asked.add(attachment);
      void getJsonUntilAnswered(
        `${base}/${encodeURIComponent(facts.id)}`,
        Outline,
        { signal, onFailure: () => {} },
      ).then((answer) => {
        if (answer?.ok !== true) return;
        setRead((before) => new Map(before).set(attachment, answer.data));
      });
    }
  });
  return read;
}
