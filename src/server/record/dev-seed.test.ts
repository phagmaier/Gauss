import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import type { Plan } from "../../shared/plan.ts";
import { openDataRoot } from "./data-root.ts";
import { scratchDataRoot, seedCourses } from "./dev-seed.ts";
import { withProgress } from "./progress.ts";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "gauss-seed-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** Three segments of one objective each, unlike the scripted backend's two. */
const plan = (unitId: string): Plan => ({
  objectives: ["a", "b", "c"].map((part) => ({
    id: `${unitId}-${part}`,
    statement: `Do part ${part} of ${unitId}.`,
  })),
  segments: ["a", "b", "c"].map((part) => ({
    title: `Part ${part}`,
    objectives: [`${unitId}-${part}`],
  })),
});
const TODAY = new Date("2026-11-15T12:00:00.000Z");

// What each course is seeded as is its documented contract (dev-seed.ts);
// the statuses are what the record's own derivation makes of the seed. Every
// write is flushed to disk, so seeding takes seconds: hence the time limit.
test("the seed gives courses in each state, as the routes would send them", {
  timeout: 30_000,
}, async () => {
  const ids = await seedCourses({ path: dir, plan, today: TODAY });

  const root = openDataRoot({ path: dir });
  const courses = await Promise.all(
    (await root.listCourses()).map((stored) =>
      withProgress(root, stored, TODAY),
    ),
  );
  expect(ids?.toSorted()).toEqual(courses.map((c) => c.id).toSorted());
  const byId = Object.fromEntries(
    courses.map((c) => [
      c.id,
      {
        approval: c.curriculum?.approval.status,
        progress: c.progress,
        due: c.due,
      },
    ]),
  );
  expect(byId).toEqual({
    // Due for review, by the seed's own dates: limits' three, retained or
    // slipping, derivative's one passed, and rules' one passed.
    "calculus-i": {
      approval: "approved",
      due: 5,
      progress: {
        limits: {
          status: "passed",
          objectives: {
            "limits-a": "retained",
            "limits-b": "slipping",
            "limits-c": "retained",
          },
        },
        derivative: {
          status: "overridden",
          objectives: {
            "derivative-a": "passed",
            "derivative-b": "overridden",
            "derivative-c": "overridden",
          },
        },
        rules: {
          status: "in-progress",
          segment: 0,
          phase: "closed",
          objectives: {
            "rules-a": "passed",
            "rules-b": "not-started",
            "rules-c": "not-started",
          },
        },
        optimisation: { status: "not-started" },
        integral: {
          status: "in-progress",
          segment: 0,
          phase: "discuss",
          objectives: {
            "integral-a": "not-started",
            "integral-b": "not-started",
            "integral-c": "not-started",
          },
        },
        fundamental: { status: "not-started" },
      },
    },
    "linear-algebra-for-pca": {
      approval: "approved",
      due: undefined,
      progress: {
        vectors: { status: "not-started" },
        eigen: { status: "not-started" },
        pca: { status: "not-started" },
      },
    },
    probability: {
      approval: "approved",
      due: 4,
      progress: {
        events: expect.objectContaining({ status: "passed" }),
        bayes: {
          status: "overridden",
          objectives: {
            "bayes-a": "passed",
            "bayes-b": "overridden",
            "bayes-c": "overridden",
          },
        },
      },
    },
    topology: { approval: "draft", progress: {}, due: undefined },
    "what-is-a-group": {
      approval: "approved",
      due: 1,
      progress: {
        group: expect.objectContaining({
          status: "in-progress",
          segment: 1,
        }),
      },
    },
    "the-pigeonhole-principle": {
      approval: "approved",
      due: 3,
      progress: { pigeonhole: expect.objectContaining({ status: "passed" }) },
    },
    "calculus-1-to-3": {
      approval: "approved",
      due: 12,
      progress: expect.objectContaining({
        functions: expect.objectContaining({ status: "passed" }),
        derivative: expect.objectContaining({ status: "passed" }),
        rules: expect.objectContaining({ status: "in-progress", segment: 0 }),
        "green-stokes": { status: "not-started" },
      }),
    },
  });
  // The large course has thirty units, the first four passed and the
  // fifth in progress.
  const large = Object.values(byId["calculus-1-to-3"]?.progress ?? {});
  expect(large.map((p) => p.status)).toEqual([
    ...Array(4).fill("passed"),
    "in-progress",
    ...Array(25).fill("not-started"),
  ]);
  // Of Calculus I's units in progress, unit 5 was opened last.
  const opened = courses.find((c) => c.id === "calculus-i")?.course
    .unitsOpenedAt;
  expect(opened).toEqual({
    rules: "2026-11-12T12:00:00.000Z",
    integral: "2026-11-14T12:00:00.000Z",
  });
});

test("a data root that has a course already is not seeded", async () => {
  const root = openDataRoot({ path: dir });
  await root.createCourse({ title: "Mine" });

  expect(await seedCourses({ path: dir, plan, today: TODAY })).toBeUndefined();
  expect((await root.listCourses()).map((c) => c.id)).toEqual(["mine"]);
});

test("the dev server's data root is a scratch folder, never the learner's own", () => {
  const home = "/home/learner";
  const at = (chosen?: string) =>
    scratchDataRoot(
      chosen === undefined ? {} : { GAUSS_DATA_ROOT: chosen },
      home,
      "/tmp",
    );

  expect(at()).toBe("/tmp/gauss-fake");
  expect(at("")).toBe("/tmp/gauss-fake");
  expect(at("/tmp/trial")).toBe("/tmp/trial");
  // A folder that only starts like the real one is another folder.
  expect(at("/home/learner/gauss-scratch")).toBe("/home/learner/gauss-scratch");
  expect(() => at("/home/learner/gauss")).toThrow("real data root");
  expect(() => at("/home/learner/gauss/")).toThrow("real data root");
  expect(() => at("/home/learner/gauss/courses")).toThrow("real data root");
});
