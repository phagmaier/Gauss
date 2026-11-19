// "What I know" (task 2.26): each unit of an approved curriculum, and for a
// planned one each objective with its status and the evidence behind it, as
// `GET /api/courses/<id>/what-i-know` sends it. Derived from the record when
// asked, never stored (architecture.md section 3): statuses by
// objectiveStatus and unitStatus, as the course view's progress has them;
// with the course's calibration (task 2.29). A disputed answer is shown
// with its dispute, and counts with its verdict (task 3.8). Each objective
// has the misconceptions found on it (task 5.7).

import type { Curriculum } from "../../shared/curriculum.ts";
import type { EvidenceEntry } from "../../shared/evidence.ts";
import type { Misconception } from "../../shared/misconception.ts";
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
import { disputesIn } from "./disputes.ts";
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
  misconceptions: readonly Misconception[] = [],
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
                misconceptions: misconceptions.flatMap(
                  ({ objective: on, ...shown }) =>
                    on === objective.id ? [shown] : [],
                ),
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
  const disputes = disputesIn(evidence);
  return evidence.flatMap((entry): ShownEvidence[] => {
    if (entry.kind === "dispute") return [];
    if (entry.kind === "override") {
      return entry.objectives.includes(objective)
        ? [{ kind: "override", recordedAt: entry.recordedAt }]
        : [];
    }
    if (entry.objective !== objective) return [];
    const { objective: _, question, ...answer } = entry;
    const dispute = disputes.get(answer.answer.questionId);
    return [
      {
        ...answer,
        question: shown(question),
        ...(dispute === undefined
          ? {}
          : {
              dispute: {
                recordedAt: dispute.recordedAt,
                reason: dispute.reason,
                outcome: dispute.outcome,
              },
            }),
      },
    ];
  });
}

/**
 * What the learner saw, with a choice's right letter or a math question's
 * expected answer; never the rubric, nor a code question's tests, solution
 * or command.
 */
function shown(question: Question): ShownQuestion {
  switch (question.kind) {
    case "written": {
      const { rubric: _, ...rest } = question;
      return rest;
    }
    case "code":
      return {
        kind: "code",
        prompt: question.prompt,
        files: question.files,
      };
    default:
      return question;
  }
}
