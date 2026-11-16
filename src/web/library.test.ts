import { expect, test } from "vitest";
import type { StoredUnit } from "../shared/curriculum.ts";
import type { CourseWithProgress } from "../shared/library.ts";
import { standing, whenOpened } from "./library.ts";

// Local times, so the calendar days do not depend on the time zone.
const NOW = new Date(2026, 10, 15, 9, 30);

test.each([
  { opened: new Date(2026, 10, 15, 0, 5), says: "Today" },
  { opened: new Date(2026, 10, 14, 23, 50), says: "Yesterday" },
  { opened: new Date(2026, 10, 9, 12), says: "6 days ago" },
  { opened: new Date(2026, 10, 8, 12), says: "Last week" },
  { opened: new Date(2026, 10, 2, 12), says: "Last week" },
  { opened: new Date(2026, 10, 1, 12), says: "2 weeks ago" },
  { opened: new Date(2026, 9, 19, 12), says: "3 weeks ago" },
  { opened: new Date(2026, 9, 18, 12), says: "18 October 2026" },
])("opened $opened reads $says", ({ opened, says }) => {
  expect(whenOpened(opened.toISOString(), NOW)).toBe(says);
});

const COURSE = {
  title: "Linear algebra for PCA",
  backend: "claude",
  settings: { webSearch: false },
  createdAt: "2026-11-15T09:00:00.000Z",
  lastOpenedAt: "2026-11-15T09:00:00.000Z",
} as const;
const plan = (...segments: string[]) => ({
  objectives: segments.map((title, i) => ({
    id: `${title.toLowerCase().replace(/\W+/g, "-")}-${i}`,
    statement: `Learn ${title}.`,
  })),
  segments: segments.map((title, i) => ({
    title,
    objectives: [`${title.toLowerCase().replace(/\W+/g, "-")}-${i}`],
  })),
});
const UNITS: StoredUnit[] = [
  {
    id: "vectors",
    title: "Vectors",
    goal: "Use vectors.",
    prerequisites: [],
    plan: plan("Bases", "Maps"),
  },
  {
    id: "eigen",
    title: "Eigenvectors",
    goal: "Find them.",
    prerequisites: ["vectors"],
    plan: plan("Stretching", "The characteristic polynomial", "Diagonals"),
  },
];
const APPROVED = {
  approval: { status: "approved", approvedAt: "2026-11-15T10:00:00.000Z" },
  units: UNITS,
} as const;
const stored = (
  curriculum: CourseWithProgress["curriculum"],
  progress: CourseWithProgress["progress"] = {},
  unitsOpenedAt?: Record<string, string>,
): CourseWithProgress => ({
  id: "linear-algebra-for-pca",
  course: {
    ...COURSE,
    ...(unitsOpenedAt === undefined ? {} : { unitsOpenedAt }),
  },
  curriculum,
  progress,
});
const oneOff = (progress: CourseWithProgress["progress"] = {}) =>
  stored({ ...APPROVED, units: UNITS.slice(0, 1) }, progress);

const PASSED = { status: "passed" } as const;
const OVERRIDDEN = { status: "overridden" } as const;
const at = (segment?: number) =>
  ({
    status: "in-progress",
    ...(segment === undefined ? {} : { segment }),
  }) as const;

const NOT_FINISHED = { review: false, finished: false } as const;

test.each([
  {
    name: "a draft awaits review",
    course: stored({ approval: { status: "draft" }, units: UNITS }),
    says: {
      text: "The curriculum is ready for your review",
      review: true,
      finished: false,
      oneOff: false,
      ticks: [],
    },
  },
  {
    name: "a course whose creation stopped before its first proposal",
    course: stored(null),
    says: {
      text: "No curriculum was proposed",
      ...NOT_FINISHED,
      oneOff: false,
      ticks: [],
    },
  },
  {
    name: "an approved course has not started",
    course: stored(APPROVED),
    says: {
      text: "Unit 1 of 2: Vectors, not started",
      ...NOT_FINISHED,
      oneOff: false,
      ticks: ["", ""],
    },
  },
  {
    name: "a unit in progress, by its segment",
    course: stored(APPROVED, { vectors: PASSED, eigen: at(1) }),
    says: {
      text: "Unit 2 of 2: Eigenvectors, segment 2 of 3",
      ...NOT_FINISHED,
      oneOff: false,
      ticks: ["past", "now"],
      resume: "eigen",
    },
  },
  {
    name: "a unit going over objectives again",
    course: stored(APPROVED, { vectors: at(2) }),
    says: {
      text: "Unit 1 of 2: Vectors, going over again",
      ...NOT_FINISHED,
      oneOff: false,
      ticks: ["now", ""],
      resume: "vectors",
    },
  },
  {
    name: "a unit in progress whose position is gone",
    course: stored(APPROVED, { vectors: at() }),
    says: {
      text: "Unit 1 of 2: Vectors, in progress",
      ...NOT_FINISHED,
      oneOff: false,
      ticks: ["now", ""],
      resume: "vectors",
    },
  },
  {
    name: "several units in progress: the one opened last",
    course: stored(
      APPROVED,
      { vectors: at(1), eigen: at(0) },
      {
        vectors: "2026-11-14T09:00:00.000Z",
        eigen: "2026-11-15T09:00:00.000Z",
      },
    ),
    says: {
      text: "Unit 2 of 2: Eigenvectors, segment 1 of 3",
      ...NOT_FINISHED,
      oneOff: false,
      ticks: ["now", "now"],
      resume: "eigen",
    },
  },
  {
    name: "a unit passed, the next not started",
    course: stored(APPROVED, { vectors: PASSED }),
    says: {
      text: "Unit 2 of 2: Eigenvectors, not started",
      ...NOT_FINISHED,
      oneOff: false,
      ticks: ["past", ""],
    },
  },
  {
    name: "every unit passed",
    course: stored(APPROVED, { vectors: PASSED, eigen: PASSED }),
    says: {
      text: "All 2 units passed",
      review: false,
      finished: true,
      oneOff: false,
      ticks: ["past", "past"],
    },
  },
  {
    name: "every unit finished, one overridden",
    course: stored(APPROVED, { vectors: PASSED, eigen: OVERRIDDEN }),
    says: {
      text: "All 2 units finished, 1 overridden",
      review: false,
      finished: true,
      oneOff: false,
      ticks: ["past", "past"],
    },
  },
  {
    name: "a one-off not started",
    course: oneOff(),
    says: { text: "Not started", ...NOT_FINISHED, oneOff: true, ticks: [] },
  },
  {
    name: "a one-off in progress",
    course: oneOff({ vectors: at(0) }),
    says: {
      text: "Segment 1 of 2",
      ...NOT_FINISHED,
      oneOff: true,
      ticks: [],
      resume: "vectors",
    },
  },
  {
    name: "a one-off passed",
    course: oneOff({ vectors: PASSED }),
    says: {
      text: "Passed",
      review: false,
      finished: true,
      oneOff: true,
      ticks: [],
    },
  },
  {
    name: "a one-off overridden",
    course: oneOff({ vectors: OVERRIDDEN }),
    says: {
      text: "Overridden",
      review: false,
      finished: true,
      oneOff: true,
      ticks: [],
    },
  },
])("$name", ({ course, says }) => {
  expect(standing(course)).toEqual(says);
});
