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
// objective never missed ends its check at one. A disputed answer counts
// with its dispute's verdict (task 3.8).

import type { AnswerEvidence, EvidenceEntry } from "../../shared/evidence.ts";
import { firstTaught, type Plan, skipping } from "../../shared/plan.ts";
import type { UnitPosition } from "../../shared/state.ts";
import { hasPassed } from "../../shared/status.ts";
import { countedAnswers } from "../record/disputes.ts";
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
 * @param evidence the evidence on the unit's objectives, in log order, with
 *   the disputes of their answers
 * @param inCheck the answers given in this check, in order, as recorded
 */
export function objectiveCheck(
  objective: string,
  evidence: readonly EvidenceEntry[],
  inCheck: readonly AnswerEvidence[],
): ObjectiveCheck {
  const answers = countedAnswers(
    inCheck.filter((a) => a.objective === objective),
    evidence,
  );
  const last = answers.at(-1);
  if (last === undefined) return { state: "unasked" };
  const asked = answers.length;
  if (hasPassed(objectiveStatus(evidence, objective))) {
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
  /** What it teaches and checks. */
  objectives: readonly string[];
  /**
   * Its objectives that the test before the unit passed and the learner
   * chose to skip: it neither teaches nor checks them.
   */
  leftOut: readonly string[];
  /** A segment after the plan's last, on objectives that did not pass. */
  again: boolean;
  /**
   * The unit's sections it draws on (task 4.8): its own, or for the
   * segment going over objectives again, those of the plan's segments that
   * taught them; none in a unit that names none.
   */
  sections: readonly string[];
}

export const AGAIN_TITLE = "Going over again";

export function segmentOf(plan: Plan, position: UnitPosition): SegmentView {
  const { again } = position;
  if (again !== undefined) {
    const taught = plan.segments.filter((s) =>
      s.objectives.some((o) => again.includes(o)),
    );
    return {
      title: AGAIN_TITLE,
      objectives: again,
      leftOut: [],
      again: true,
      sections: [...new Set(taught.flatMap((s) => s.sections ?? []))],
    };
  }
  const segment = plan.segments[position.segment];
  if (segment === undefined) {
    throw new Error(
      `The unit has no segment ${position.segment + 1} in its plan.`,
    );
  }
  const left = skipping(plan, skipped(position))[position.segment];
  return {
    title: segment.title,
    objectives: left?.teaches ?? segment.objectives,
    leftOut: left?.leftOut ?? [],
    again: false,
    sections: segment.sections ?? [],
  };
}

/** The objectives the learner chose to skip once the test before the unit passed them. */
export function skipped(position: UnitPosition): readonly string[] {
  return position.testOut?.stage === "skip" ? position.testOut.passed : [];
}

/**
 * The index of the plan's next segment to teach after the position's, the
 * ones skipping leaves nothing to teach passed over; undefined after the
 * last, and in the segment that goes over objectives again.
 */
export function nextSegment(
  plan: Plan,
  position: UnitPosition,
): number | undefined {
  return firstTaught(plan, skipped(position), position.segment + 1);
}

/**
 * Whether the position's segment is the unit's last: the plan's, one after
 * it, or one that only skipped segments follow.
 */
export function isLastSegment(plan: Plan, position: UnitPosition): boolean {
  return nextSegment(plan, position) === undefined;
}

/** The plan's objectives that have not passed (slipping ones too), in the plan's order. */
export function notPassed(
  plan: Plan,
  evidence: readonly EvidenceEntry[],
): string[] {
  return plan.objectives
    .map((o) => o.id)
    .filter((id) => !hasPassed(objectiveStatus(evidence, id)));
}

/** The plan's objectives that are slipping, in the plan's order. */
export function slipping(
  plan: Plan,
  evidence: readonly EvidenceEntry[],
): string[] {
  return plan.objectives
    .map((o) => o.id)
    .filter((id) => objectiveStatus(evidence, id) === "slipping");
}

/**
 * At the unit's end, the objectives the closing card's two steps cover:
 * before the unit's gate, those not passed; after it, those not passed that
 * the learner has not moved on from, which the gate left not passed.
 */
export function toGoOver(
  plan: Plan,
  evidence: readonly EvidenceEntry[],
  afterGate: boolean,
): string[] {
  const rest = notPassed(plan, evidence);
  return afterGate
    ? rest.filter((id) => objectiveStatus(evidence, id) !== "overridden")
    : rest;
}
