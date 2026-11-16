// The library (docs/prototype/06-library.html): one plain list of courses,
// most recently opened first, with the finished ones grouped at the bottom,
// and "New course" at the right of the top line. A course whose curriculum
// awaits review opens in its intake, to push back or approve; one with a
// unit in progress opens that unit's session, where the learner stopped;
// any other opens its course view.

import { Fragment, useEffect, useState } from "react";
import { IntakeStarted } from "../shared/events.ts";
import {
  type CourseWithProgress,
  Library as LibrarySchema,
} from "../shared/library.ts";
import { getJson, postFor } from "./api.ts";
import { TopLine } from "./Frame.tsx";
import { standing, whenOpened } from "./library.ts";
import { navigate, paths } from "./route.ts";

export function Library() {
  const [courses, setCourses] = useState<CourseWithProgress[]>();
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

  function open(stored: CourseWithProgress) {
    const where = standing(stored);
    if (where.review) {
      void toIntake(`/api/courses/${encodeURIComponent(stored.id)}/review`);
    } else if (where.resume !== undefined) {
      navigate(paths.unit(stored.id, where.resume));
    } else {
      navigate(paths.course(stored.id));
    }
  }

  const groups =
    courses === undefined
      ? []
      : [
          {
            name: "In progress",
            courses: courses.filter((c) => !standing(c).finished),
          },
          {
            name: "Finished",
            courses: courses.filter((c) => standing(c).finished),
          },
        ].filter((group) => group.courses.length > 0);

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
            groups.map((group) => (
              <Fragment key={group.name}>
                <h2 className="pg-h">{group.name}</h2>
                <div className="lib-list">
                  {group.courses.map((stored) => (
                    <Row
                      key={stored.id}
                      stored={stored}
                      disabled={opening}
                      onOpen={() => open(stored)}
                    />
                  ))}
                </div>
              </Fragment>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function Row(props: {
  stored: CourseWithProgress;
  disabled: boolean;
  onOpen(): void;
}) {
  const { course } = props.stored;
  const where = standing(props.stored);
  return (
    <button
      type="button"
      className={where.finished ? "lc done" : "lc"}
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
      {where.ticks.length === 0 ? null : (
        <span className="ticks" aria-hidden="true">
          {where.ticks.map((mark, i) => (
            // One tick per unit, in the list's order.
            // biome-ignore lint/suspicious/noArrayIndexKey: see above
            <i key={i} className={mark} />
          ))}
        </span>
      )}
    </button>
  );
}
