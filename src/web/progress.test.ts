import { expect, test } from "vitest";
import type { StoredUnit } from "../shared/curriculum.ts";
import type { CourseWithProgress, UnitProgress } from "../shared/library.ts";
import {
  courseCounts,
  lead,
  mapMark,
  nextInOrder,
  unfinishedPrerequisites,
  unitMark,
  unitRows,
} from "./progress.ts";

// Every expected result was worked out by hand from the picks in
// docs/brief.md, "How a course runs" (piece 12): the card leads to the
// unit in progress most recently opened, or else to the first unit in the
// list not started whose prerequisites are finished (passed or overridden).

const unit = (
  id: string,
  prerequisites: string[],
  segments: string[] = [],
): StoredUnit => ({
  id,
  title: `The ${id}`,
  goal: `Learn ${id}.`,
  prerequisites,
  ...(segments.length === 0
    ? {}
    : {
        plan: {
          objectives: segments.map((_, i) => ({
            id: `${id}-${i}`,
            statement: `Do part ${i + 1} of ${id}.`,
          })),
          segments: segments.map((title, i) => ({
            title,
            objectives: [`${id}-${i}`],
          })),
        },
      }),
});

// Mock 12's course, cut to six units. The list is not in prerequisite order
// past unit 4: unit 5 builds only on unit 1.
const UNITS = [
  unit("limits", [], ["Limit laws"]),
  unit("derivative", ["limits"], ["The definition"]),
  unit("rules", ["derivative"], ["Powers", "Products", "The chain rule"]),
  unit("optimisation", ["rules"]),
  unit("integral", ["limits"], ["Riemann sums", "Estimates"]),
  unit("fundamental", ["derivative", "integral"]),
];

const course = (
  progress: Record<string, UnitProgress>,
  unitsOpenedAt?: Record<string, string>,
): CourseWithProgress => ({
  id: "calculus-i",
  course: {
    title: "Calculus I",
    backend: "claude",
    settings: { webSearch: false },
    createdAt: "2026-11-10T09:00:00.000Z",
    lastOpenedAt: "2026-11-15T09:00:00.000Z",
    ...(unitsOpenedAt === undefined ? {} : { unitsOpenedAt }),
  },
  curriculum: {
    approval: { status: "approved", approvedAt: "2026-11-10T10:00:00.000Z" },
    units: UNITS,
  },
  progress,
});

const PASSED = { status: "passed" } as const;
const OVERRIDDEN = { status: "overridden" } as const;
const at = (segment?: number): UnitProgress => ({
  status: "in-progress",
  ...(segment === undefined ? {} : { segment }),
});

/** Units 3 and 5 in progress, 5 opened last; 1 passed and 2 overridden. */
const TWO = course(
  {
    limits: PASSED,
    derivative: OVERRIDDEN,
    rules: at(2),
    integral: at(0),
  },
  { rules: "2026-11-14T09:00:00.000Z", integral: "2026-11-15T08:00:00.000Z" },
);

test("each status: how the unit's row and node read, the card's unit current", () => {
  const form = (unit: UnitProgress["status"], current = false) => ({
    unit,
    current,
  });
  expect(UNITS.map((u) => unitMark(TWO, u))).toEqual([
    { state: "pass", form: form("passed"), text: "Passed", className: "pass" },
    {
      state: "over",
      form: form("overridden"),
      text: "Overridden",
      className: "",
    },
    // Unit 3 is in progress, but the card leads to unit 5, opened last.
    {
      state: "att",
      form: form("in-progress"),
      text: "Segment 3 of 3",
      className: "",
    },
    { state: "todo", form: form("not-started"), text: "", className: "" },
    {
      state: "now",
      form: form("in-progress", true),
      text: "Segment 1 of 2",
      className: "",
    },
    { state: "todo", form: form("not-started"), text: "", className: "" },
  ]);
  // Going over again, and a unit in progress whose position is gone.
  const odd = course({ rules: at(3), integral: at() });
  expect(unitMark(odd, UNITS[2] as StoredUnit)).toMatchObject({
    state: "now",
    text: "Going over again",
  });
  expect(unitMark(odd, UNITS[4] as StoredUnit)).toMatchObject({
    state: "att",
    text: "In progress",
  });
});

test("each started unit lists its objectives, and Next marks the card's unit's current one, in its active segment after an earlier override", () => {
  const rows = (c: CourseWithProgress) =>
    unitRows(c).map((row) => ({
      open: row.open,
      passed: row.passed,
      objectives: row.objectives?.map((o) => [o.id, o.status, o.next]),
    }));
  // Segment 1 moved on from, segment 2 being taught: Next is in segment 2,
  // not the overridden objective before it.
  const rules: UnitProgress = {
    status: "in-progress",
    segment: 1,
    phase: "teach",
    objectives: {
      "rules-0": "overridden",
      "rules-1": "not-started",
      "rules-2": "not-started",
    },
  };
  const progress: Record<string, UnitProgress> = {
    limits: { status: "passed", objectives: { "limits-0": "retained" } },
    rules,
    // In progress, but not the card's unit: no Next.
    integral: {
      status: "in-progress",
      segment: 0,
      phase: "discuss",
      objectives: { "integral-0": "attempted", "integral-1": "not-started" },
    },
    // Just opened, with no plan yet.
    fundamental: { status: "in-progress", segment: 0, phase: "teach" },
  };
  const opened = {
    integral: "2026-11-14T09:00:00.000Z",
    rules: "2026-11-15T08:00:00.000Z",
  };

  expect(rows(course(progress, opened))).toEqual([
    { open: false, passed: 1, objectives: [["limits-0", "retained", false]] },
    // Not started: no objectives listed, though its plan is written.
    { open: false, passed: 0, objectives: undefined },
    {
      open: true,
      passed: 0,
      objectives: [
        ["rules-0", "overridden", false],
        ["rules-1", "not-started", true],
        ["rules-2", "not-started", false],
      ],
    },
    { open: false, passed: 0, objectives: undefined },
    {
      open: true,
      passed: 0,
      objectives: [
        ["integral-0", "attempted", false],
        ["integral-1", "not-started", false],
      ],
    },
    { open: true, passed: 0, objectives: undefined },
  ]);

  // Once the segment has closed, nothing is next until the learner starts
  // the next one.
  const closed = course(
    { ...progress, rules: { ...rules, phase: "closed" } },
    opened,
  );
  expect(
    unitRows(closed)
      .flatMap((r) => r.objectives ?? [])
      .filter((o) => o.next),
  ).toEqual([]);
  // Going over again: the extra segment's own objectives, past a passed one.
  const again = course(
    {
      ...progress,
      rules: {
        status: "in-progress",
        segment: 3,
        phase: "check",
        again: ["rules-0", "rules-2"],
        objectives: {
          "rules-0": "passed",
          "rules-1": "attempted",
          "rules-2": "attempted",
        },
      },
    },
    opened,
  );
  expect(
    unitRows(again)
      .flatMap((r) => r.objectives ?? [])
      .filter((o) => o.next),
  ).toMatchObject([{ id: "rules-2", statement: "Do part 3 of rules." }]);
  // After the test: the first segment teaches two objectives, the test
  // passed the first and the learner skipped it. Missed in a review since,
  // it is slipping, but this segment still leaves it out.
  const tested: CourseWithProgress = {
    ...course({
      limits: {
        status: "in-progress",
        segment: 0,
        phase: "teach",
        skipping: ["limit-law"],
        objectives: { "limit-law": "slipping", squeeze: "not-started" },
      },
    }),
    curriculum: {
      approval: { status: "approved", approvedAt: "2026-11-10T10:00:00.000Z" },
      units: [
        {
          ...unit("limits", []),
          plan: {
            objectives: [
              { id: "limit-law", statement: "Use the limit laws." },
              { id: "squeeze", statement: "Use the squeeze theorem." },
            ],
            segments: [
              { title: "Limits", objectives: ["limit-law", "squeeze"] },
            ],
          },
        },
      ],
    },
  };
  expect(unitRows(tested)[0]?.objectives?.map((o) => [o.id, o.next])).toEqual([
    ["limit-law", false],
    ["squeeze", true],
  ]);
});

test("with no unit in progress, the next one in order is marked up next, and current", () => {
  // A course just approved sends no progress for its units.
  expect(UNITS.map((u) => unitMark(course({}), u).text)).toEqual([
    "Up next",
    "",
    "",
    "",
    "",
    "",
  ]);
  expect(unitMark(course({}), UNITS[0] as StoredUnit)).toEqual({
    state: "now",
    form: { unit: "not-started", current: true },
    text: "Up next",
    className: "",
  });
  // With unit 3 in progress, unit 5 could start, but the card leads to unit
  // 3, so nothing is marked up next.
  const busy = course({ limits: PASSED, derivative: PASSED, rules: at(0) });
  expect(UNITS.map((u) => unitMark(busy, u).text)).toEqual([
    "Passed",
    "Passed",
    "Segment 1 of 3",
    "",
    "",
    "",
  ]);
});

test("on a unit's course map, that unit alone is here and current, whatever its status", () => {
  const marks = (c: CourseWithProgress, here: string) =>
    UNITS.map((u) => {
      const { state, form, text } = mapMark(c, u, here);
      return [state, form.current, text];
    });
  // From unit 3, though the card leads to unit 5: unit 5 is another unit in
  // progress.
  expect(marks(TWO, "rules")).toEqual([
    ["pass", false, "Passed"],
    ["over", false, "Overridden"],
    ["now", true, "You are here"],
    ["todo", false, ""],
    ["att", false, "Segment 1 of 2"],
    ["todo", false, ""],
  ]);
  // From a finished unit, with none in progress: unit 2 is next in order,
  // but not "Up next" here.
  expect(marks(course({ limits: PASSED }), "limits")).toEqual([
    ["now", true, "You are here"],
    ["todo", false, ""],
    ["todo", false, ""],
    ["todo", false, ""],
    ["todo", false, ""],
    ["todo", false, ""],
  ]);
  expect(mapMark(TWO, UNITS[0] as StoredUnit, "limits").form).toEqual({
    unit: "passed",
    current: true,
  });
});

test("the card leads to the unit in progress", () => {
  const one = course({ limits: PASSED, rules: at(1) });

  expect(lead(one)).toEqual({
    kind: "in-progress",
    number: 3,
    unit: UNITS[2],
    where: {
      label: "Segment 2 of 3",
      title: "Products",
      ticks: ["past", "now", ""],
    },
    others: [],
  });
});

test("with several in progress, the card leads to the one opened last and lists the others, most recent first", () => {
  const three = course(
    { rules: at(2), integral: at(0), fundamental: at() },
    {
      rules: "2026-11-14T09:00:00.000Z",
      integral: "2026-11-15T08:00:00.000Z",
      fundamental: "2026-11-13T09:00:00.000Z",
    },
  );

  expect(lead(three)).toEqual({
    kind: "in-progress",
    number: 5,
    unit: UNITS[4],
    where: {
      label: "Segment 1 of 2",
      title: "Riemann sums",
      ticks: ["now", ""],
    },
    others: [
      { number: 3, unit: UNITS[2] },
      { number: 6, unit: UNITS[5] },
    ],
  });
  // Units never marked opened (positions from before task 2.12) come after
  // those that were, in the list's order.
  const unmarked = course(
    { optimisation: at(), rules: at(0), integral: at(1) },
    { integral: "2026-11-15T08:00:00.000Z" },
  );
  expect(lead(unmarked)).toMatchObject({
    number: 5,
    others: [
      { number: 3, unit: UNITS[2] },
      { number: 4, unit: UNITS[3] },
    ],
  });
});

test("going over again, and a unit in progress whose position is gone, say so on the card", () => {
  expect(lead(course({ rules: at(3) }))).toMatchObject({
    where: { label: "Going over again", ticks: ["past", "past", "now"] },
  });
  expect(lead(course({ rules: at(3) }))).not.toHaveProperty("where.title");
  expect(lead(course({ rules: at() }))).toMatchObject({ where: null });
});

test("a segment the test let the learner skip is hollow on the card, not ticked done; a unit whose test is not answered yet is testing out, no segment reached", () => {
  // Unit 3's test passed its first and last objectives, which the learner
  // skipped: the first segment was not done, and the last will not be.
  const skipped = course({
    rules: {
      status: "in-progress",
      segment: 1,
      phase: "teach",
      skipping: ["rules-0", "rules-2"],
    },
  });
  expect(lead(skipped)).toMatchObject({
    where: {
      label: "Segment 2 of 3",
      title: "Products",
      ticks: ["skip", "now", "skip"],
    },
  });
  const testing = course({
    rules: {
      status: "in-progress",
      segment: 0,
      phase: "teach",
      beforeTest: true,
    },
  });
  expect(lead(testing)).toMatchObject({
    where: { label: "Testing out", ticks: ["", "", ""] },
  });
  expect(lead(testing)).not.toHaveProperty("where.title");
  expect(unitMark(testing, UNITS[2] as StoredUnit).text).toBe("Testing out");
});

test("with none in progress, the card leads to the first unit not started whose prerequisites are finished", () => {
  expect(lead(course({}))).toEqual({
    kind: "up-next",
    number: 1,
    unit: UNITS[0],
  });
  // Unit 2 passed and unit 3 overridden: unit 4 builds on 3, so it is next.
  expect(
    lead(course({ limits: PASSED, derivative: PASSED, rules: OVERRIDDEN })),
  ).toEqual({ kind: "up-next", number: 4, unit: UNITS[3] });
});

test("the next unit in order passes over units whose prerequisites are not finished, and those already started", () => {
  // Unit 2 is in progress, so 3 and 4, which build on it, wait; 5 builds on 1 only.
  const progress = { limits: PASSED, derivative: at(0) };
  expect(nextInOrder(UNITS, progress)).toEqual({ number: 5, unit: UNITS[4] });
  // A unit in progress whose position is gone is not finished either, and
  // every other unit builds on it, directly or not.
  expect(nextInOrder(UNITS, { limits: at() })).toBeNull();
  const done = Object.fromEntries(UNITS.map((u) => [u.id, PASSED]));
  expect(nextInOrder(UNITS, done)).toBeNull();
});

test("a finished course, a draft and a course with no curriculum have no card", () => {
  const done = Object.fromEntries(UNITS.map((u) => [u.id, OVERRIDDEN]));
  expect(lead(course(done))).toBeNull();
  const draft = course({});
  expect(
    lead({
      ...draft,
      curriculum: { approval: { status: "draft" }, units: UNITS },
    }),
  ).toBeNull();
  expect(lead({ ...draft, curriculum: null })).toBeNull();
});

test("Start asks first about the prerequisites not finished, by number", () => {
  const byId = (id: string) => UNITS.find((u) => u.id === id) as StoredUnit;

  // Overridden counts as finished; in progress does not.
  expect(unfinishedPrerequisites(TWO, byId("optimisation"))).toEqual([3]);
  expect(unfinishedPrerequisites(TWO, byId("fundamental"))).toEqual([5]);
  expect(unfinishedPrerequisites(course({}), byId("fundamental"))).toEqual([
    2, 5,
  ]);
  expect(unfinishedPrerequisites(TWO, byId("integral"))).toEqual([]);
});

test("a finished course with slipping and overridden objectives counts only passed and retained ones, in the course as in each unit", () => {
  // Unit 1 passed, its objective slipping since; unit 2 overridden; unit 3
  // passed, one objective retained, one passed and one slipping; unit 5
  // overridden, one passed and one overridden. Units 4 and 6 have no plan
  // here, so only four units are in this course.
  const units = [UNITS[0], UNITS[1], UNITS[2], UNITS[4]] as StoredUnit[];
  const finished: CourseWithProgress = {
    ...course({
      limits: { status: "passed", objectives: { "limits-0": "slipping" } },
      derivative: {
        status: "overridden",
        objectives: { "derivative-0": "overridden" },
      },
      rules: {
        status: "passed",
        objectives: {
          "rules-0": "retained",
          "rules-1": "passed",
          "rules-2": "slipping",
        },
      },
      integral: {
        status: "overridden",
        objectives: { "integral-0": "passed", "integral-1": "overridden" },
      },
    }),
    curriculum: {
      approval: { status: "approved", approvedAt: "2026-11-10T10:00:00.000Z" },
      units,
    },
  };

  expect(
    unitRows(finished).map((r) => [r.passed, r.objectives?.length]),
  ).toEqual([
    [0, 1],
    [0, 1],
    [2, 3],
    [1, 2],
  ]);
  expect(courseCounts(finished)).toEqual({
    units: 4,
    finished: 4,
    passed: 3,
    objectives: 7,
  });
  // Finished units fold by default.
  expect(unitRows(finished).some((r) => r.open)).toBe(false);
});

test("the course's counts take objectives only from the units started", () => {
  expect(courseCounts(course({}))).toEqual({
    units: 6,
    finished: 0,
    passed: 0,
    objectives: 0,
  });
  expect(
    courseCounts(
      course({
        limits: { status: "passed", objectives: { "limits-0": "passed" } },
        derivative: {
          status: "overridden",
          objectives: { "derivative-0": "overridden" },
        },
        rules: {
          status: "in-progress",
          segment: 0,
          phase: "check",
          objectives: {
            "rules-0": "retained",
            "rules-1": "attempted",
            "rules-2": "not-started",
          },
        },
      }),
    ),
  ).toEqual({ units: 6, finished: 2, passed: 2, objectives: 5 });
});
