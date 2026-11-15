// How many questions a check asks (brief.md, "Teaching style"; task 2.7),
// and which segment a unit's position is in. Pure: the chat keeps the
// evidence and passes it in.
//
// Each objective of the segment gets at least one question in the check. It
// is done once it has passed (src/server/record/status.ts: two unassisted
// correct answers to different questions since the last miss, or one given
// at 90% or 100%), or once QUESTION_LIMIT of its questions have been
// answered in this check. So a miss, an unconfident correct answer or an
// answer given with help asks for another question, and a confident correct
// answer ends the objective's check at one.

import type { AnswerEvidence, EvidenceEntry } from "../../shared/evidence.ts";
import type { Plan } from "../../shared/plan.ts";
import type { UnitPosition } from "../../shared/state.ts";
import { objectiveStatus } from "../record/status.ts";

/** The most questions one objective is asked in one check. */
export const QUESTION_LIMIT = 3;

/** Where one objective stands in the check under way. */
export type ObjectiveCheck =
  | { state: "unasked" }
  | {
      state: "more";
      /** Why another question is needed, from its last answer. */
      reason: "missed" | "assisted" | "unconfident";
      asked: number;
    }
  | { state: "done"; reason: "passed" | "limit"; asked: number };

/**
 * @param evidence the evidence on the unit's objectives, in log order
 * @param inCheck the answers given in this check, in order
 */
export function objectiveCheck(
  objective: string,
  evidence: readonly EvidenceEntry[],
  inCheck: readonly AnswerEvidence[],
): ObjectiveCheck {
  const answers = inCheck.filter((a) => a.objective === objective);
  const last = answers.at(-1);
  if (last === undefined) return { state: "unasked" };
  const asked = answers.length;
  if (objectiveStatus(evidence, objective) === "passed") {
    return { state: "done", reason: "passed", asked };
  }
  if (asked >= QUESTION_LIMIT) return { state: "done", reason: "limit", asked };
  const reason =
    last.verdict !== "correct"
      ? "missed"
      : last.assisted
        ? "assisted"
        : "unconfident";
  return { state: "more", reason, asked };
}

/** The segment a position is in: one of the plan's, or the one going over the rest again. */
export interface SegmentView {
  title: string;
  objectives: readonly string[];
  /** A segment after the plan's last, on objectives that did not pass. */
  again: boolean;
}

export const AGAIN_TITLE = "Going over again";

export function segmentOf(plan: Plan, position: UnitPosition): SegmentView {
  if (position.again !== undefined) {
    return { title: AGAIN_TITLE, objectives: position.again, again: true };
  }
  const segment = plan.segments[position.segment];
  if (segment === undefined) {
    throw new Error(
      `The unit has no segment ${position.segment + 1} in its plan.`,
    );
  }
  return { ...segment, again: false };
}

/** Whether the position's segment is the unit's last: the plan's, or one after it. */
export function isLastSegment(plan: Plan, position: UnitPosition): boolean {
  return position.segment >= plan.segments.length - 1;
}

/** The plan's objectives that have not passed, in the plan's order. */
export function notPassed(
  plan: Plan,
  evidence: readonly EvidenceEntry[],
): string[] {
  return plan.objectives
    .map((o) => o.id)
    .filter((id) => objectiveStatus(evidence, id) !== "passed");
}
