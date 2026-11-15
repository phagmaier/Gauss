import { expect, test } from "vitest";
import type { StoredCourse } from "../shared/library.ts";
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
const UNITS = [
  { id: "vectors", title: "Vectors", goal: "Use vectors.", prerequisites: [] },
  {
    id: "eigen",
    title: "Eigenvectors",
    goal: "Find them.",
    prerequisites: ["vectors"],
  },
];
const stored = (
  curriculum: StoredCourse["curriculum"],
  units = UNITS,
): StoredCourse => ({
  id: "linear-algebra-for-pca",
  course: COURSE,
  curriculum: curriculum && { ...curriculum, units },
});
const APPROVED = {
  approval: { status: "approved", approvedAt: "2026-11-15T10:00:00.000Z" },
  units: UNITS,
} as const;

test.each([
  {
    name: "a draft awaits review",
    course: stored({ approval: { status: "draft" }, units: UNITS }),
    says: {
      text: "The curriculum is ready for your review",
      review: true,
      oneOff: false,
      units: 0,
    },
  },
  {
    name: "an approved course has not started",
    course: stored(APPROVED),
    says: {
      text: "Unit 1 of 2: Vectors, not started",
      review: false,
      oneOff: false,
      units: 2,
    },
  },
  {
    name: "a course of one unit is a one-off",
    course: stored(APPROVED, UNITS.slice(0, 1)),
    says: { text: "Not started", review: false, oneOff: true, units: 1 },
  },
  {
    name: "a course whose creation stopped before its first proposal",
    course: stored(null),
    says: {
      text: "No curriculum was proposed",
      review: false,
      oneOff: false,
      units: 0,
    },
  },
])("$name", ({ course, says }) => {
  expect(standing(course)).toEqual(says);
});
