// How many questions a check asks (brief.md, "Teaching style" and "Mastery
// and evidence"; tasks 2.7, 2.19 and 2.23), and which segment a unit's
// position is in. Pure: the chat keeps the evidence and passes it in.
//
// Each objective of the segment gets at least one question in the check, and
// is done only once it has passed (src/server/record/status.ts: since its
// last miss, unassisted correct answers to two different questions, or one
// at 90% or 100% if it was never missed). There is no limit: until it
// passes, or the learner moves on, the objective is asked again. So a miss,
// an answer given with help, or a first correct answer that does not pass
// alone asks for another question, and a confident correct answer to an
// objective never missed ends its check at one.

import type { AnswerEvidence, EvidenceEntry } from "../../shared/evidence.ts";
import type { Plan } from "../../shared/plan.ts";
import type { UnitPosition } from "../../shared/state.ts";
import { objectiveStatus } from "../record/status.ts";

/** Where one objective stands in the check under way. */
export type ObjectiveCheck =
  | { state: "unasked" }
  | {
      state: "more";
      /**
       * Why another question is needed, from its last answer: a miss, a
       * correct answer with help, or a correct answer that does not pass
       * alone (under 90%, or after a miss, or to the question answered
       * before), which needs a second, to a different question (`second`).
       */
      reason: "missed" | "assisted" | "second";
      asked: number;
      /**
       * How many of its answers in this check were misses. From the second,
       * the detour after a miss teaches the objective again (task 2.20).
       */
      missed: number;
    }
  /** Passed: it needs no more questions in this check. */
  | { state: "done"; asked: number };

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
    return { state: "done", asked };
  }
  const reason =
    last.verdict !== "correct"
      ? "missed"
      : last.assisted
        ? "assisted"
        : "second";
  const missed = answers.filter((a) => a.verdict !== "correct").length;
  return { state: "more", reason, asked, missed };
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
