// The library (docs/prototype/06-library.html): one plain list of courses,
// most recently opened first, with the finished ones grouped at the bottom,
// and "New course" at the right of the top line. Every row opens its course
// view (task 2.28), whose card continues a unit in progress and whose
// "Review the curriculum" reviews a draft. Below the courses, once anything has
// been answered, calibration: how often the answers at each level of
// confidence were right, across all courses (task 2.27).

import { Fragment, useEffect, useState } from "react";
import { Calibration } from "../shared/calibration.ts";
import { IntakeStarted } from "../shared/events.ts";
import {
  type CourseWithProgress,
  Library as LibrarySchema,
} from "../shared/library.ts";
import { getJson, postFor } from "./api.ts";
import { calibrationRows, hasCalibration, skippedNote } from "./calibration.ts";
import { TopLine } from "./Frame.tsx";
import { standing, whenOpened } from "./library.ts";
import { navigate, paths } from "./route.ts";

export function Library() {
  const [courses, setCourses] = useState<CourseWithProgress[]>();
  const [problem, setProblem] = useState<string>();
  const [opening, setOpening] = useState(false);
  const [calibration, setCalibration] = useState<Calibration>();
  const [calibrationProblem, setCalibrationProblem] = useState<string>();

  useEffect(() => {
    void getJson("/api/courses", LibrarySchema).then((answer) => {
      if (answer.ok) setCourses(answer.data.courses);
      else setProblem(answer.error);
    });
    void getJson("/api/calibration", Calibration).then((answer) => {
      if (answer.ok) setCalibration(answer.data);
      else setCalibrationProblem(answer.error);
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
            onClick={() => void newCourse()}
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
                      onOpen={() => navigate(paths.course(stored.id))}
                    />
                  ))}
                </div>
              </Fragment>
            ))
          )}
          {calibrationProblem === undefined ? null : (
            <p className="ph-note">
              Calibration could not be counted: {calibrationProblem}
            </p>
          )}
          {calibration === undefined || !hasCalibration(calibration) ? null : (
            <CalibrationCounts calibration={calibration} />
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

/** How often the answers at each level of confidence were right. */
function CalibrationCounts(props: { calibration: Calibration }) {
  const rows = calibrationRows(props.calibration);
  const note = skippedNote(props.calibration);
  return (
    <section aria-labelledby="calibration">
      <h2 className="pg-h" id="calibration">
        Calibration
      </h2>
      <p className="cal-lead">
        How often your answers were right at each level of confidence, across
        all courses. Answers given with help are left out.
      </p>
      <table className="cal">
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <th scope="row">{row.label}</th>
              <td>{row.text}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {note === null ? null : <p className="ph-note">{note}</p>}
    </section>
  );
}
