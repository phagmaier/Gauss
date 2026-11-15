// The library (docs/prototype/06-library.html): one plain list of courses,
// most recently opened first, and "New course" at the right of the top line.
// A course whose curriculum awaits review opens in its intake, to push back
// or approve; any other opens its course view.

import { useEffect, useState } from "react";
import { IntakeStarted } from "../shared/events.ts";
import {
  Library as LibrarySchema,
  type StoredCourse,
} from "../shared/library.ts";
import { getJson, postFor } from "./api.ts";
import { TopLine } from "./Frame.tsx";
import { standing, whenOpened } from "./library.ts";
import { navigate, paths } from "./route.ts";

export function Library() {
  const [courses, setCourses] = useState<StoredCourse[]>();
  const [problem, setProblem] = useState<string>();
  const [opening, setOpening] = useState(false);

  useEffect(() => {
    void getJson("/api/courses", LibrarySchema).then((answer) => {
      if (answer.ok) setCourses(answer.data.courses);
      else setProblem(answer.error);
    });
  }, []);

  /** Starts an intake, or reopens a draft's, then shows it. */
  async function toIntake(path: string) {
    setOpening(true);
    const answer = await postFor(path, IntakeStarted);
    setOpening(false);
    if (answer.ok) navigate(paths.intake(answer.data.intakeId));
    else setProblem(answer.error);
  }

  function open(stored: StoredCourse) {
    if (standing(stored).review) {
      void toIntake(`/api/courses/${encodeURIComponent(stored.id)}/review`);
    } else {
      navigate(paths.course(stored.id));
    }
  }

  return (
    <div className="pg">
      <TopLine
        trail={[]}
        here="Library"
        action={
          <button
            type="button"
            className="btn sm"
            disabled={opening}
            onClick={() => void toIntake("/api/intakes")}
          >
            New course
          </button>
        }
      />
      <div className="pg-scroll">
        <div className="pg-col">
          {problem === undefined ? null : <p className="ph-note">{problem}</p>}
          {courses === undefined ? null : courses.length === 0 ? (
            <p className="ph-note">
              No courses yet. Start one with New course.
            </p>
          ) : (
            // Nothing can be finished before units are taught (stage 2), so
            // the "Finished" group of the mock has nothing to hold yet.
            <>
              <h2 className="pg-h">In progress</h2>
              <div className="lib-list">
                {courses.map((stored) => (
                  <Row
                    key={stored.id}
                    stored={stored}
                    disabled={opening}
                    onOpen={() => open(stored)}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Row(props: {
  stored: StoredCourse;
  disabled: boolean;
  onOpen(): void;
}) {
  const { course } = props.stored;
  const where = standing(props.stored);
  return (
    <button
      type="button"
      className="lc"
      disabled={props.disabled}
      onClick={props.onOpen}
    >
      <span className="lc-title">
        {course.title}
        {where.oneOff ? <small>One-off</small> : null}
      </span>
      <span className="lc-when">{whenOpened(course.lastOpenedAt)}</span>
      <span className={where.review ? "lc-where todo" : "lc-where"}>
        {where.text}
      </span>
      {where.units === 0 ? null : (
        <span className="ticks" aria-hidden="true">
          {Array.from({ length: where.units }, (_, i) => (
            // One tick per unit, all alike until units are taught.
            // biome-ignore lint/suspicious/noArrayIndexKey: see above
            <i key={i} />
          ))}
        </span>
      )}
    </button>
  );
}
