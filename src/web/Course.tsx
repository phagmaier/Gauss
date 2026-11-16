// The course view (docs/prototype/07-course.html): the page is the unit
// list, and "Show the diagram" opens the diagram in the side pane, where
// clicking a unit marks it in the list. Each unit of an approved course opens
// its session, which starts it or picks it up (task 2.11). Unit status, the
// card that leads on and Start join in task 2.12; notes in stage 5 and
// sources in stage 4.

import { useCallback, useEffect, useState } from "react";
import { IntakeStarted } from "../shared/events.ts";
import { StoredCourse } from "../shared/library.ts";
import { getJson, postFor } from "./api.ts";
import { Diagram, UnitList } from "./Curriculum.tsx";
import { Link, SidePane, TopLine } from "./Frame.tsx";
import { navigate, paths } from "./route.ts";

export function Course(props: { courseId: string }) {
  const { courseId } = props;
  // Undefined while loading, null when there is no such course.
  const [stored, setStored] = useState<StoredCourse | null>();
  const [problem, setProblem] = useState<string>();
  const [diagramOpen, setDiagramOpen] = useState(false);
  const [selected, setSelected] = useState<string>();
  const closeDiagram = useCallback(() => {
    setDiagramOpen(false);
    setSelected(undefined);
  }, []);

  useEffect(() => {
    void getJson(
      `/api/courses/${encodeURIComponent(courseId)}`,
      StoredCourse,
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

  const curriculum = stored?.curriculum ?? null;
  const draft = curriculum?.approval.status === "draft";
  const title = stored?.course.title ?? (stored === null ? "Not found" : "");
  return (
    <div className={diagramOpen ? "pg has-pane" : "pg"}>
      <TopLine
        trail={[{ label: "Library", to: paths.library }]}
        here={title}
        action={
          draft ? (
            <button
              type="button"
              className="btn sm"
              onClick={() => void review()}
            >
              Review the curriculum
            </button>
          ) : undefined
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
              <p className="cv-at">{whereItStands(curriculum)}</p>
              {curriculum === null ? null : (
                <>
                  <div className="cv-hrow">
                    <h2 className="pg-h">Units</h2>
                    <button
                      type="button"
                      className="textbtn"
                      aria-expanded={diagramOpen}
                      onClick={() =>
                        diagramOpen ? closeDiagram() : setDiagramOpen(true)
                      }
                    >
                      {diagramOpen ? "Hide the diagram" : "Show the diagram"}
                    </button>
                  </div>
                  <UnitList
                    units={curriculum.units}
                    selected={selected}
                    action={
                      draft
                        ? undefined
                        : (unit) => (
                            <Link
                              to={paths.unit(courseId, unit.id)}
                              className="textbtn"
                            >
                              Open
                            </Link>
                          )
                    }
                  />
                </>
              )}
            </>
          )}
        </div>
      </div>
      {diagramOpen && curriculum !== null ? (
        <SidePane
          title="Curriculum"
          subtitle="How the units build on each other"
          onClose={closeDiagram}
        >
          <Diagram
            units={curriculum.units}
            nodeClass="todo"
            selected={selected}
            onSelect={(id) => {
              setSelected(id);
              document
                .getElementById(`unit-${id}`)
                ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
            }}
          />
        </SidePane>
      ) : null}
    </div>
  );
}

function whereItStands(curriculum: StoredCourse["curriculum"]): string {
  if (curriculum === null) return "No curriculum was proposed.";
  if (curriculum.approval.status === "draft") {
    return "The curriculum is waiting for your review.";
  }
  const day = new Date(curriculum.approval.approvedAt).toLocaleDateString(
    "en-GB",
    { day: "numeric", month: "long", year: "numeric" },
  );
  // Where the units stand joins in task 2.12.
  return `Approved on ${day}.`;
}
