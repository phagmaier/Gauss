// A course as the record holds it, and as the library routes send it to the
// page with where each unit stands (architecture.md section 10); and what
// deleting one asks (task 5.18).

import { z } from "zod";
import { Course, Slug } from "./course.ts";
import { Curriculum } from "./curriculum.ts";
import { Phase } from "./state.ts";
import { ObjectiveStatus, UnitStatus } from "./status.ts";

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
 * (src/server/record/progress.ts) and never stored.
 */
export const UnitProgress = z.object({
  status: UnitStatus,
  /**
   * For a unit with a position in state.json: its segment, as the position
   * has it (the index in the plan, from 0, or the plan's segment count for
   * the segment that goes over objectives again). The position itself stays
   * on the server, since an open question carries its grading material;
   * these fields are what `currentObjective` (plan.ts) reads of it.
   */
  segment: z.number().int().nonnegative().optional(),
  /** With `segment`: the segment's phase. */
  phase: Phase.optional(),
  /** With `segment`, for the segment that goes over objectives again: those objectives. */
  again: z.array(Slug).optional(),
  /** With `segment`, once the learner chose to skip what the test before the unit passed: those objectives. */
  skipping: z.array(Slug).optional(),
  /** For a started unit with a plan: each of its objectives' status, by id. */
  objectives: z.record(Slug, ObjectiveStatus).optional(),
});
export type UnitProgress = z.infer<typeof UnitProgress>;

/** A course with where each unit of its approved curriculum stands, by unit id. */
export const CourseWithProgress = StoredCourse.extend({
  /**
   * Empty while the curriculum is a draft or not yet proposed, and when
   * `problem` is set.
   */
  progress: z.record(Slug, UnitProgress),
  /** Set when the course has recorded evidence, even outside its current plan. */
  hasEvidence: z.literal(true).optional(),
  /** Why state or evidence could not be read, when progress is unavailable. */
  problem: z.string().optional(),
});
export type CourseWithProgress = z.infer<typeof CourseWithProgress>;

/** Every course, most recently opened first. */
export const Library = z.object({ courses: z.array(CourseWithProgress) });
export type Library = z.infer<typeof Library>;

/**
 * Deleting a course (task 5.18) asks the learner to type its title once it
 * has started, so that progress, transcripts or files would go, or when its
 * record could not be read to tell; a draft, or a course with no unit
 * started, asks a plain confirmation.
 */
export function deletionAsksTitle(course: CourseWithProgress): boolean {
  if (course.curriculum?.approval.status !== "approved") return false;
  return (
    course.problem !== undefined ||
    course.hasEvidence === true ||
    Object.keys(course.course.unitsOpenedAt ?? {}).length > 0 ||
    Object.values(course.progress).some((p) => p.status !== "not-started")
  );
}

/** A confirmation targets the course shown, not a replacement at the same slug. */
export function courseInstance(course: Course): string {
  return course.instance ?? course.createdAt;
}

/** The course instance and the title typed, when asked for. */
export const DeleteCourse = z.object({
  instance: z.string().min(1),
  title: z.string().optional(),
});
export type DeleteCourse = z.infer<typeof DeleteCourse>;
