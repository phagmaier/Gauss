// Which objectives review and the unit gate ask about (docs/decisions.md,
// "Mastery loop", "Review" and "The gate"). Pure: the caller reads the
// record, and decides when each is offered.

import type { StoredUnit } from "../../shared/curriculum.ts";
import { SESSION_GAP_MS } from "../../shared/events.ts";
import type { EvidenceEntry } from "../../shared/evidence.ts";
import { objectiveStandings } from "./status.ts";

/** An objective to ask about, with the unit whose plan holds it. */
export interface ReviewPick {
  unit: string;
  objective: string;
}

/**
 * Up to `count` objectives of the course's plans to review at `at`, the
 * first to ask first, leaving out those in `leaveOut`. Only an objective
 * that is passed, retained or slipping, and that has no answer recorded
 * within SESSION_GAP_MS before `at`, so none is asked twice in a sitting.
 *
 * - Slipping ones first.
 * - Then passed ones, the lowest confidence first, among the answers that
 *   pass each.
 * - Then retained ones.
 * - Among equals, the one whose last answer is the oldest first; then in
 *   the course's order, by unit and then by the unit's plan.
 */
export function pickForReview(
  units: readonly StoredUnit[],
  evidence: readonly EvidenceEntry[],
  options: { at: Date; count: number; leaveOut: Iterable<string> },
): ReviewPick[] {
  if (options.count <= 0) return [];
  const leaveOut = new Set(options.leaveOut);
  const lastAnswered = new Map<string, number>();
  for (const entry of evidence) {
    if (entry.kind !== "answer") continue;
    const at = Date.parse(entry.recordedAt);
    const before = lastAnswered.get(entry.objective);
    if (before === undefined || at > before) {
      lastAnswered.set(entry.objective, at);
    }
  }
  const quietSince = options.at.getTime() - SESSION_GAP_MS;

  const eligible = new Map<string, { pick: ReviewPick; last: number }>();
  for (const unit of units) {
    for (const { id } of unit.plan?.objectives ?? []) {
      const last = lastAnswered.get(id);
      if (!leaveOut.has(id) && last !== undefined && last <= quietSince) {
        eligible.set(id, { pick: { unit: unit.id, objective: id }, last });
      }
    }
  }
  const standings = objectiveStandings(evidence, eligible.keys());
  const candidates = [];
  for (const [id, { pick, last }] of eligible) {
    const standing = standings.get(id);
    if (standing === undefined) continue;
    const { status, lowestConfidence } = standing;
    const rank =
      status === "slipping"
        ? 0
        : status === "passed"
          ? 1
          : status === "retained"
            ? 2
            : undefined;
    if (rank === undefined) continue;
    candidates.push({
      pick,
      rank,
      confidence: status === "passed" ? lowestConfidence : 0,
      last,
    });
  }
  // A stable sort keeps the course's order among equals.
  return candidates
    .sort(
      (a, b) =>
        a.rank - b.rank || a.confidence - b.confidence || a.last - b.last,
    )
    .slice(0, options.count)
    .map((c) => c.pick);
}

/** How many objectives of the course's other units a unit's gate asks about, at most. */
export const GATE_OTHERS = 3;

/**
 * What the unit's gate asks about at `at`, in its order: each objective of
 * the unit's plan that is passed and not yet retained, leaving out those
 * whose pass rests on an answer given while testing out, in the plan's
 * order; then up to GATE_OTHERS of the course's other units', as review
 * picks them. Empty when there is nothing to ask.
 */
export function pickForGate(
  units: readonly StoredUnit[],
  unitId: string,
  evidence: readonly EvidenceEntry[],
  at: Date,
): ReviewPick[] {
  const own = (units.find((u) => u.id === unitId)?.plan?.objectives ?? []).map(
    (o) => o.id,
  );
  const standings = objectiveStandings(evidence, own);
  const asked = own.filter((id) => {
    const standing = standings.get(id);
    return standing?.status === "passed" && !standing.tested;
  });
  return [
    ...asked.map((objective) => ({ unit: unitId, objective })),
    ...pickForReview(units, evidence, {
      at,
      count: GATE_OTHERS,
      leaveOut: own,
    }),
  ];
}
