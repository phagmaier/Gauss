// Where each unit of a course stands, as the library routes send it to the
// page (task 2.12): its status, derived from the evidence and its position,
// the segment of a unit in progress, and counts of retained and slipping
// objectives in a finished unit. Derived when asked, never stored
// (architecture.md section 3).

import type { Curriculum } from "../../shared/curriculum.ts";
import type { EvidenceEntry } from "../../shared/evidence.ts";
import type {
  CourseWithProgress,
  StoredCourse,
  UnitProgress,
} from "../../shared/library.ts";
import type { State } from "../../shared/state.ts";
import type { DataRoot } from "./data-root.ts";
import { objectiveStatus, unitStatusFromObjectives } from "./status.ts";

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
  return Object.fromEntries(
    curriculum.units.map((unit): [string, UnitProgress] => {
      // The unit's own entry only: an id such as "constructor" is also the
      // name of a property every object inherits.
      const position = Object.hasOwn(state.units, unit.id)
        ? state.units[unit.id]
        : undefined;
      if (position !== undefined) {
        return [unit.id, { status: "in-progress", segment: position.segment }];
      }
      const statuses = (unit.plan?.objectives ?? []).map((o) =>
        objectiveStatus(evidence, o.id),
      );
      const status = unitStatusFromObjectives(statuses);
      if (status !== "passed" && status !== "overridden") {
        return [unit.id, { status }];
      }
      let retained = 0;
      let slipping = 0;
      for (const objective of statuses) {
        if (objective === "retained") retained += 1;
        else if (objective === "slipping") slipping += 1;
      }
      return [unit.id, { status, retained, slipping }];
    }),
  );
}

/** The course with its progress, reading state.json and the evidence only when it can have any. */
export async function withProgress(
  dataRoot: DataRoot,
  stored: StoredCourse,
): Promise<CourseWithProgress> {
  if (stored.curriculum?.approval.status !== "approved") {
    return { ...stored, progress: {} };
  }
  const [state, evidence] = await Promise.all([
    dataRoot.readState(stored.id),
    dataRoot.readEvidence(stored.id),
  ]);
  return {
    ...stored,
    progress: courseProgress(stored.curriculum, state, evidence),
  };
}
