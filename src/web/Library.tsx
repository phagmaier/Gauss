// The library (docs/prototype/21-library.html): the courses grouped as in
// progress, drafts and finished, each group with its count, and "Profile"
// (18-profile.html) and "New course" at the right of the top line. Every
// row opens its course view (task 2.28), whose card continues a unit in
// progress and whose "Review the curriculum" reviews a draft. Calibration
// is per course, on its "What I know" (task 2.29).

import { useEffect, useState } from "react";
import { IntakeStarted } from "../shared/events.ts";
import {
  type CourseWithProgress,
  Library as LibrarySchema,
} from "../shared/library.ts";
import { getJson, postFor } from "./api.ts";
import { TopLine } from "./Frame.tsx";
import { libraryGroups, standing, whenOpened } from "./library.ts";
import { navigate, paths } from "./route.ts";
import { StatusForm } from "./StatusForm.tsx";

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

  /** Starts an intake, then shows it. */
  async function newCourse() {
    setOpening(true);
    const answer = await postFor("/api/intakes", IntakeStarted);
    setOpening(false);
    if (answer.ok) navigate(paths.intake(answer.data.intakeId));
    else setProblem(answer.error);
  }

  return (
    <div className="pg">
      <TopLine
        trail={[]}
        here="Gauss"
        action={
          <span className="nl-acts">
            <button
              type="button"
              className="textbtn"
              onClick={() => navigate(paths.profile)}
            >
              Profile
            </button>
            <button
              type="button"
              className="btn sm"
              disabled={opening}
              onClick={() => void newCourse()}
            >
              New course
            </button>
          </span>
        }
      />
      <div className="pg-scroll">
        <div className="pg-col">
          <h1 className="cv-title">Library</h1>
          {problem === undefined ? null : <p className="ph-note">{problem}</p>}
          {courses === undefined ? null : courses.length === 0 ? (
            <p className="ph-note">
              No courses yet. Start one with New course.
            </p>
          ) : (
            libraryGroups(courses).map((group) => (
              <section key={group.group}>
                <div className="cv-hrow cv-sec">
                  <h2 className="pg-h">{group.heading}</h2>
                  <span className="pg-h">{group.courses.length}</span>
                </div>
                <div className="lib-list">
                  {group.courses.map((stored) => (
                    <Row
                      key={stored.id}
                      stored={stored}
                      disabled={opening}
                      onOpen={() => navigate(paths.course(stored.id))}
                    />
                  ))}
                </div>
              </section>
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
      className={where.group === "finished" ? "lc done" : "lc"}
      disabled={props.disabled}
      onClick={props.onOpen}
    >
      <span className="lc-title">
        {course.title}
        {where.oneOff ? <small>One-off</small> : null}
      </span>
      <span className="lc-when">{whenOpened(course.lastOpenedAt)}</span>
      <span className="lc-where">{where.text}</span>
      {where.units.length === 0 ? null : (
        <span className="lc-units" aria-hidden="true">
          {where.units.map((form, i) => (
            // One form per unit, in the curriculum's order.
            // biome-ignore lint/suspicious/noArrayIndexKey: see above
            <StatusForm key={i} {...form} />
          ))}
        </span>
      )}
    </button>
  );
}
