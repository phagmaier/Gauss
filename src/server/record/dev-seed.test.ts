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
    (await root.listCourses()).map((stored) => withProgress(root, stored)),
  );
  expect(ids?.toSorted()).toEqual(courses.map((c) => c.id).toSorted());
  const byId = Object.fromEntries(
    courses.map((c) => [
      c.id,
      { approval: c.curriculum?.approval.status, progress: c.progress },
    ]),
  );
  expect(byId).toEqual({
    "calculus-i": {
      approval: "approved",
      progress: {
        limits: { status: "passed" },
        derivative: { status: "overridden" },
        rules: { status: "in-progress", segment: 1 },
        optimisation: { status: "not-started" },
        integral: { status: "in-progress", segment: 0 },
        fundamental: { status: "not-started" },
      },
    },
    "linear-algebra-for-pca": {
      approval: "approved",
      progress: {
        vectors: { status: "not-started" },
        eigen: { status: "not-started" },
        pca: { status: "not-started" },
      },
    },
    probability: {
      approval: "approved",
      progress: {
        events: { status: "passed" },
        bayes: { status: "overridden" },
      },
    },
    topology: { approval: "draft", progress: {} },
    "what-is-a-group": {
      approval: "approved",
      progress: { group: { status: "in-progress", segment: 1 } },
    },
    "the-pigeonhole-principle": {
      approval: "approved",
      progress: { pigeonhole: { status: "passed" } },
    },
  });
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
