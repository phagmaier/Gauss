// Where each unit of a course stands, as the library routes send it to the
// page (task 2.12): its status, derived from the evidence and its position,
// what of the position of a unit in progress the page reads, each started
// unit's objective statuses and how many objectives are due for review
// (task 5.24); and which courses are finished, which a new course's planner
// is given with the learner profile (task 5.8).
// Derived when asked, never stored (docs/architecture.md, "Data root").

import type { Curriculum } from "../../shared/curriculum.ts";
import type { EvidenceEntry } from "../../shared/evidence.ts";
import type {
  CourseWithProgress,
  StoredCourse,
  UnitProgress,
} from "../../shared/library.ts";
import type { FinishedCourse } from "../../shared/profile.ts";
import type { State } from "../../shared/state.ts";
import { isFinished, type ObjectiveStatus } from "../../shared/status.ts";
import type { DataRoot } from "./data-root.ts";
import { dueCount } from "./review.ts";
import { objectiveStandings, unitStatusFromObjectives } from "./status.ts";

/**
 * Each unit's progress, by id, for an approved curriculum; none for a draft,
 * whose units cannot have started. Positions of units the curriculum does
 * not have are left out.
 */
export function courseProgress(
  curriculum: Curriculum | null,
  state: State,
  evidence: readonly EvidenceEntry[],
): Record<string, UnitProgress> {
  if (curriculum?.approval.status !== "approved") return {};
  const standings = objectiveStandings(
    evidence,
    curriculum.units.flatMap((unit) =>
      (unit.plan?.objectives ?? []).map((o) => o.id),
    ),
  );
  return Object.fromEntries(
    curriculum.units.map((unit): [string, UnitProgress] => {
      const statuses = (unit.plan?.objectives ?? []).map(
        (o): [string, ObjectiveStatus] => [
          o.id,
          standings.get(o.id)?.status ?? "not-started",
        ],
      );
      const objectives =
        unit.plan === undefined
          ? {}
          : { objectives: Object.fromEntries(statuses) };
      // The unit's own entry only: an id such as "constructor" is also the
      // name of a property every object inherits.
      const position = Object.hasOwn(state.units, unit.id)
        ? state.units[unit.id]
        : undefined;
      if (position !== undefined) {
        const { segment, phase, again, testOut } = position;
        return [
          unit.id,
          {
            status: "in-progress",
            segment,
            phase,
            ...(again === undefined ? {} : { again }),
            ...(testOut?.stage === "skip" ? { skipping: testOut.passed } : {}),
            ...objectives,
          },
        ];
      }
      const status = unitStatusFromObjectives(statuses.map(([, s]) => s));
      return [
        unit.id,
        status === "not-started" ? { status } : { status, ...objectives },
      ];
    }),
  );
}

/**
 * The course with its progress and how many objectives are due for review
 * at `at`, or a reason when that part of the record is unreadable.
 */
export async function withProgress(
  dataRoot: DataRoot,
  stored: StoredCourse,
  at: Date = new Date(),
): Promise<CourseWithProgress> {
  if (stored.curriculum?.approval.status !== "approved") {
    return { ...stored, progress: {} };
  }
  // State reads can recover interrupted writes. Wait for them even if the
  // evidence read fails, so deletion cannot run ahead of that recovery.
  const [state, evidence] = await Promise.allSettled([
    dataRoot.readState(stored.id),
    dataRoot.readEvidence(stored.id),
  ]);
  try {
    if (state.status === "rejected") throw state.reason;
    if (evidence.status === "rejected") throw evidence.reason;
    const due = dueCount(stored.curriculum.units, evidence.value, at);
    return {
      ...stored,
      progress: courseProgress(stored.curriculum, state.value, evidence.value),
      ...(evidence.value.length === 0 ? {} : { hasEvidence: true as const }),
      ...(due === 0 ? {} : { due }),
    };
  } catch (error) {
    return {
      ...stored,
      progress: {},
      problem: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * The courses whose approved curriculum has every unit finished, most
 * recently opened first. Unreadable courses are left out: where they stand
 * is not known.
 */
export async function finishedCourses(
  dataRoot: DataRoot,
): Promise<FinishedCourse[]> {
  const courses = await dataRoot.listCourses({ skipUnreadable: true });
  const found = await Promise.all(
    courses.map(async (stored) => {
      const { curriculum } = stored;
      if (curriculum?.approval.status !== "approved") return undefined;
      const { progress, problem } = await withProgress(dataRoot, stored);
      if (problem !== undefined) return undefined;
      const done = curriculum.units.every((unit) => {
        const status = Object.hasOwn(progress, unit.id)
          ? progress[unit.id]?.status
          : undefined;
        return status !== undefined && isFinished(status);
      });
      return done
        ? {
            id: stored.id,
            title: stored.course.title,
            oneOff: curriculum.units.length === 1,
          }
        : undefined;
    }),
  );
  return found.filter((course) => course !== undefined);
}
