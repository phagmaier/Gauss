// Where each unit of a course stands, as the library routes send it to the
// page (task 2.12): its status, derived by unitStatus from the evidence and
// its position, the segment of a unit in progress, and how many of a
// finished unit's objectives are retained and slipping. Derived when asked,
// never stored (architecture.md section 3).

import type { Curriculum } from "../../shared/curriculum.ts";
import type { EvidenceEntry } from "../../shared/evidence.ts";
import type {
  CourseWithProgress,
  StoredCourse,
  UnitProgress,
} from "../../shared/library.ts";
import type { State } from "../../shared/state.ts";
import type { DataRoot } from "./data-root.ts";
import { objectiveStatus, unitStatus } from "./status.ts";

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
    curriculum.units.map((unit) => {
      // The unit's own entry only: an id such as "constructor" is also the
      // name of a property every object inherits.
      const position = Object.hasOwn(state.units, unit.id)
        ? state.units[unit.id]
        : undefined;
      const status = unitStatus(unit, evidence, position);
      const progress: UnitProgress = {
        status,
        ...(position === undefined ? {} : { segment: position.segment }),
        ...(status === "passed" || status === "overridden"
          ? standing(unit.plan?.objectives ?? [], evidence)
          : {}),
      };
      return [unit.id, progress];
    }),
  );
}

/** How many of the objectives are retained, and how many slipping. */
function standing(
  objectives: readonly { id: string }[],
  evidence: readonly EvidenceEntry[],
): { retained: number; slipping: number } {
  const statuses = objectives.map((o) => objectiveStatus(evidence, o.id));
  return {
    retained: statuses.filter((s) => s === "retained").length,
    slipping: statuses.filter((s) => s === "slipping").length,
  };
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
