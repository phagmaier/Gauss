// "What I know" (task 2.26): each unit of an approved curriculum, and for a
// planned one each objective with its status and the evidence behind it, as
// `GET /api/courses/<id>/what-i-know` sends it. Derived from the record when
// asked, never stored (architecture.md section 3): statuses by
// objectiveStatus and unitStatus, as the course view's progress has them;
// with the course's calibration (task 2.29).

import type { Curriculum } from "../../shared/curriculum.ts";
import type { EvidenceEntry } from "../../shared/evidence.ts";
import type { Question } from "../../shared/question.ts";
import type { State } from "../../shared/state.ts";
import type {
  KnownObjective,
  KnownUnit,
  ShownEvidence,
  ShownQuestion,
  WhatIKnow,
} from "../../shared/what-i-know.ts";
import { countCalibration } from "./calibration.ts";
import { objectiveStatus, unitStatus } from "./status.ts";

/**
 * The units of an approved curriculum, in order. A planned unit's objectives
 * come in the order its segments teach them, each with its answers and the
 * overrides that name it, in log order. Evidence on an objective of no plan
 * is left out.
 */
export function whatIKnow(
  title: string,
  curriculum: Curriculum,
  state: State,
  evidence: readonly EvidenceEntry[],
): WhatIKnow {
  const units = curriculum.units.map((unit, i): KnownUnit => {
    // The unit's own entry only, as in progress.ts.
    const position = Object.hasOwn(state.units, unit.id)
      ? state.units[unit.id]
      : undefined;
    const { plan } = unit;
    const objectives =
      plan === undefined
        ? null
        : plan.segments
            .flatMap((segment) => segment.objectives)
            .flatMap((id) => plan.objectives.filter((o) => o.id === id))
            .map(
              (objective): KnownObjective => ({
                ...objective,
                status: objectiveStatus(evidence, objective.id),
                evidence: evidenceOn(evidence, objective.id),
              }),
            );
    return {
      id: unit.id,
      number: i + 1,
      title: unit.title,
      status: unitStatus(unit, evidence, position),
      objectives,
    };
  });
  return { title, units, calibration: countCalibration(evidence) };
}

function evidenceOn(
  evidence: readonly EvidenceEntry[],
  objective: string,
): ShownEvidence[] {
  return evidence.flatMap((entry): ShownEvidence[] => {
    if (entry.kind === "override") {
      return entry.objectives.includes(objective)
        ? [{ kind: "override", recordedAt: entry.recordedAt }]
        : [];
    }
    if (entry.objective !== objective) return [];
    const { objective: _, question, ...answer } = entry;
    return [{ ...answer, question: shown(question) }];
  });
}

/** What the learner saw, and a choice's right letter; never the rubric. */
function shown(question: Question): ShownQuestion {
  if (question.kind === "choice") return question;
  const { rubric: _, ...rest } = question;
  return rest;
}
