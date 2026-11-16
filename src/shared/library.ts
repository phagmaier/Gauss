// A course as the record holds it, and as the library routes send it to the
// page with where each unit stands (architecture.md section 10).

import { z } from "zod";
import { Course, Slug } from "./course.ts";
import { Curriculum } from "./curriculum.ts";
import { UnitStatus } from "./status.ts";

export const StoredCourse = z.object({
  /** The name of the course's folder under `courses/`. */
  id: Slug,
  course: Course,
  /** Null until the tutor has proposed one. */
  curriculum: Curriculum.nullable(),
});
export type StoredCourse = z.infer<typeof StoredCourse>;

/**
 * Where a unit stands, derived from the record when a route is answered
 * (src/server/record/progress.ts, task 2.12) and never stored.
 */
export const UnitProgress = z.object({
  status: UnitStatus,
  /**
   * For a unit with a position in state.json: its segment, as the position
   * has it (the index in the plan, from 0, or the plan's segment count for
   * the segment that goes over objectives again). The position itself stays
   * on the server, since an open question carries its grading material.
   */
  segment: z.number().int().nonnegative().optional(),
});
export type UnitProgress = z.infer<typeof UnitProgress>;

/** A course with where each unit of its approved curriculum stands, by unit id. */
export const CourseWithProgress = StoredCourse.extend({
  /**
   * Empty while the curriculum is a draft or not yet proposed, and when
   * `problem` is set.
   */
  progress: z.record(Slug, UnitProgress),
  /**
   * Set only in the list of every course, when the course's state.json or
   * evidence could not be read: the reason. The course is listed all the
   * same, so one record that cannot be read does not hide the others. Asked
   * for alone, such a course is an error with this reason.
   */
  problem: z.string().optional(),
});
export type CourseWithProgress = z.infer<typeof CourseWithProgress>;

/** Every course, most recently opened first. */
export const Library = z.object({ courses: z.array(CourseWithProgress) });
export type Library = z.infer<typeof Library>;
