// A course as the record holds it, which is what the library routes send the
// page (architecture.md section 10).

import { z } from "zod";
import { Course, Slug } from "./course.ts";
import { Curriculum } from "./curriculum.ts";

export const StoredCourse = z.object({
  /** The name of the course's folder under `courses/`. */
  id: Slug,
  course: Course,
  /** Null until the tutor has proposed one. */
  curriculum: Curriculum.nullable(),
});
export type StoredCourse = z.infer<typeof StoredCourse>;

/** Every course, most recently opened first. */
export const Library = z.object({ courses: z.array(StoredCourse) });
export type Library = z.infer<typeof Library>;
