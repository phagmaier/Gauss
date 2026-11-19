// For the dev server on the scripted backend (scripts/dev-fake.ts, task
// 2.12b): which data root it may use, never the learner's own, and courses
// in each state the library and the course view show, written through the
// record's own operations so they are checked against the schemas.

import { homedir, tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import type { CurriculumProposal, Unit } from "../../shared/curriculum.ts";
import type { AssessmentMode, EvidenceEntry } from "../../shared/evidence.ts";
import type { Plan } from "../../shared/plan.ts";
import { openDataRoot, resolveDataRoot } from "./data-root.ts";

/**
 * The dev server's data root: `GAUSS_DATA_ROOT` when it is set and not
 * empty, otherwise `gauss-fake` in the temporary folder. The learner's own
 * data root (`~/gauss`), or a folder inside it, is refused: scripted courses
 * do not belong among real ones.
 */
export function scratchDataRoot(
  env: Readonly<Record<string, string | undefined>> = process.env,
  home: string = homedir(),
  tmp: string = tmpdir(),
): string {
  const chosen = env.GAUSS_DATA_ROOT;
  const path = chosen ? resolve(chosen) : join(tmp, "gauss-fake");
  const real = resolveDataRoot({}, home);
  if (path === real || path.startsWith(real + sep)) {
    throw new Error(
      `${path} is the real data root, or inside it. The dev server on the ` +
        "scripted backend writes scripted courses: point GAUSS_DATA_ROOT at " +
        "a scratch folder, or leave it unset.",
    );
  }
  return path;
}

const DAY = 24 * 60 * 60 * 1000;

/**
 * Seeds an empty data root with six courses and returns their ids; a data
 * root that has a course already is left as it is, and nothing is returned.
 *
 * - "Calculus I", six units: unit 1 passed, its gate answered right on
 *   both its objectives, and the second missed later in unit 3's review,
 *   so one is retained and one slipping; unit 2 overridden, units 3 and 5
 *   in progress (5 opened last, 3 in its second segment), 4 and 6 not
 *   started. Every answer is a day old or more, so opening a unit not
 *   finished offers review (task 5.4), on objectives of other units too.
 *   The scripted plan has two segments, so unit 3's check closes it, and
 *   its gate (task 5.5) asks unit 1's objectives too, unless a review in
 *   the hour before has answered them.
 * - "Linear algebra for PCA", three units, approved and not started.
 * - "Probability", two units, finished: one passed, one overridden.
 * - "Topology", a draft awaiting review.
 * - "What is a group?", a one-off in progress, in its second and last
 *   segment: its gate asks its own objectives alone.
 * - "The pigeonhole principle", a one-off, passed.
 *
 * @param plan the plan of a unit that has started; it must have at least two
 * segments. The dev server passes the scripted backend's, so its tutor can
 * carry the units on.
 */
export async function seedCourses(options: {
  path: string;
  plan: (unitId: string) => Plan;
  /** The seeded dates count back from this; now, unless a test sets it. */
  today?: Date;
}): Promise<string[] | undefined> {
  const today = options.today ?? new Date();
  if ((await openDataRoot({ path: options.path }).listCourses()).length > 0) {
    return undefined;
  }

  const unit = (id: string, title: string, prerequisites: string[]): Unit => ({
    id,
    title,
    goal: `Work with ${title.toLowerCase()} in a small example.`,
    prerequisites,
  });
  const proposed = (title: string, units: Unit[]): CurriculumProposal => ({
    title,
    units,
    style: "Scripted: a short explanation, then one question at a time.",
    background: "Scripted: the learner is trying the app on seeded courses.",
  });

  /**
   * Makes one course, proposed that many days ago, and returns its id. Each
   * course has a clock of its own, so the six are written side by side:
   * every write is flushed to disk, which is slow one after another.
   */
  async function course(
    title: string,
    units: Unit[],
    created: number,
    fill: (c: Seeding) => Promise<void>,
  ): Promise<string> {
    let clock = today;
    const root = openDataRoot({ path: options.path, now: () => clock });
    const daysAgo = (days: number) => {
      clock = new Date(today.getTime() - days * DAY);
    };
    daysAgo(created);
    const { id } = await root.createCourse({ title });
    await root.saveProposal(id, proposed(title, units));

    /** A correct answer at 90%, which passes its objective alone. */
    const correct = (objective: string): EvidenceEntry => ({
      kind: "answer",
      recordedAt: clock.toISOString(),
      objective,
      question: {
        kind: "choice",
        prompt: `A seeded question on "${objective}".`,
        choices: ["The right answer", "A wrong answer"],
        answer: "A",
      },
      answer: {
        kind: "choice",
        questionId: `seeded-${objective}`,
        choice: "A",
        confidence: "90",
      },
      assisted: false,
      verdict: "correct",
    });
    /** An answer at 75% in an assessment held in `held`'s thread. */
    const assessed = (
      objective: string,
      mode: AssessmentMode,
      held: string,
      right: boolean,
    ): EvidenceEntry => ({
      kind: "answer",
      recordedAt: clock.toISOString(),
      objective,
      question: {
        kind: "choice",
        prompt: `A seeded ${mode} question on "${objective}".`,
        choices: ["The right answer", "A wrong answer"],
        answer: "A",
      },
      answer: {
        kind: "choice",
        questionId: `seeded-${mode}-${objective}`,
        choice: right ? "A" : "B",
        confidence: "75",
      },
      assisted: false,
      verdict: right ? "correct" : "incorrect",
      assessment: { mode, unit: held },
    });
    /** Plans the unit and returns its objectives' ids, by segment. */
    async function planned(unitId: string): Promise<string[][]> {
      const plan = options.plan(unitId);
      await root.storePlan(id, unitId, plan);
      return plan.segments.map((s) => s.objectives);
    }
    async function pass(objectives: string[]): Promise<void> {
      for (const objective of objectives) {
        await root.appendEvidence(id, correct(objective));
      }
    }
    await fill({
      daysAgo,
      async approve() {
        await root.approveCurriculum(id, proposed(title, units));
      },
      async passed(unitId) {
        await pass((await planned(unitId)).flat());
      },
      async overridden(unitId) {
        const [first = [], ...rest] = await planned(unitId);
        await pass(first);
        await root.appendEvidence(id, {
          kind: "override",
          recordedAt: clock.toISOString(),
          objectives: rest.flat(),
        });
      },
      async gated(unitId) {
        const objectives = options.plan(unitId).objectives;
        for (const { id: objective } of objectives) {
          await root.appendEvidence(
            id,
            assessed(objective, "gate", unitId, true),
          );
        }
      },
      async reviewMissed(held, unitId, at) {
        const objective = options.plan(unitId).objectives[at]?.id;
        if (objective === undefined) {
          throw new Error(`${unitId}'s plan has no objective ${at + 1}.`);
        }
        await root.appendEvidence(
          id,
          assessed(objective, "review", held, false),
        );
      },
      async inProgress(unitId, segment) {
        const segments = await planned(unitId);
        await pass(segments.slice(0, segment).flat());
        await root.writePosition(id, unitId, { segment, phase: "discuss" });
        await root.markOpened(id, unitId);
      },
    });
    return id;
  }

  return Promise.all([
    course(
      "Calculus I",
      [
        unit("limits", "Limits", []),
        unit("derivative", "The derivative", ["limits"]),
        unit("rules", "Differentiation rules", ["derivative"]),
        unit("optimisation", "Optimisation", ["rules"]),
        unit("integral", "The integral", ["limits"]),
        unit("fundamental", "The fundamental theorem", [
          "derivative",
          "integral",
        ]),
      ],
      6,
      async (c) => {
        await c.approve();
        await c.passed("limits");
        await c.gated("limits");
        c.daysAgo(5);
        await c.overridden("derivative");
        c.daysAgo(3);
        await c.inProgress("rules", 1);
        await c.reviewMissed("rules", "limits", 1);
        c.daysAgo(1);
        await c.inProgress("integral", 0);
      },
    ),
    course(
      "Linear algebra for PCA",
      [
        unit("vectors", "Vectors", []),
        unit("eigen", "Eigenvectors", ["vectors"]),
        unit("pca", "Principal components", ["eigen"]),
      ],
      4,
      (c) => c.approve(),
    ),
    course(
      "Probability",
      [unit("events", "Events", []), unit("bayes", "Bayes' rule", ["events"])],
      10,
      async (c) => {
        await c.approve();
        await c.passed("events");
        c.daysAgo(8);
        await c.overridden("bayes");
      },
    ),
    // Left a draft: its curriculum awaits review.
    course(
      "Topology",
      [
        unit("open-sets", "Open sets", []),
        unit("continuity", "Continuity", ["open-sets"]),
        unit("compactness", "Compactness", ["open-sets"]),
      ],
      0,
      async () => {},
    ),
    course("What is a group?", [unit("group", "Groups", [])], 2, async (c) => {
      await c.approve();
      await c.inProgress("group", 1);
    }),
    course(
      "The pigeonhole principle",
      [unit("pigeonhole", "The pigeonhole principle", [])],
      12,
      async (c) => {
        await c.approve();
        await c.passed("pigeonhole");
      },
    ),
  ]);
}

/** What a course's seeding does, at its own clock. */
interface Seeding {
  /** Moves the course's clock to that many days before today. */
  daysAgo(days: number): void;
  approve(): Promise<void>;
  /** The unit, finished with every objective passed. */
  passed(unitId: string): Promise<void>;
  /** The unit, finished: its first segment passed, the rest moved on from. */
  overridden(unitId: string): Promise<void>;
  /** The unit's gate, answered right on each of its objectives: they are retained. */
  gated(unitId: string): Promise<void>;
  /** A miss in a review held in `held`'s thread, on the objective at `at` of the unit's plan. */
  reviewMissed(held: string, unitId: string, at: number): Promise<void>;
  /** The unit, opened and left in the discussion of that segment, those before it passed. */
  inProgress(unitId: string, segment: number): Promise<void>;
}
