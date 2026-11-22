// Which objectives review and the unit gate ask about (docs/brief.md,
// "Assessment modes"). Pure: the caller reads the record, and decides when
// each is offered.

import type { StoredUnit } from "../../shared/curriculum.ts";
import { SESSION_GAP_MS } from "../../shared/events.ts";
import type { EvidenceEntry } from "../../shared/evidence.ts";
import { objectiveStandings } from "./status.ts";

/** An objective to ask about, with the unit whose plan holds it. */
export interface ReviewPick {
  unit: string;
  objective: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How long after its last correct answer an objective is due again, by its
 * correct answers in a row in reviews and gates: none, one, two, three,
 * four or more.
 */
const INTERVALS_MS = [1, 3, 7, 21, 60].map((days) => days * DAY_MS);

/**
 * Up to `count` objectives of the course's plans to review at `at`, the
 * first to ask first, leaving out those in `leaveOut`. Only an objective
 * that is due, and that has no answer recorded within SESSION_GAP_MS
 * before `at`, so none is asked twice in a sitting.
 *
 * - A slipping objective is due, and comes first, the longest unanswered
 *   first.
 * - A passed or retained one is due once INTERVALS_MS, picked by its
 *   correct answers in a row in reviews and gates since its last miss, has
 *   gone by since its last correct answer given without help. The most
 *   overdue for its interval (the time since that answer over the
 *   interval) comes first: the lowest expected recall, not the most days
 *   past due, which would favour safe long intervals.
 * - Among equals, in the course's order, by unit and then by the unit's
 *   plan.
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
  const now = options.at.getTime();
  const quietSince = now - SESSION_GAP_MS;

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
  const slipping: { pick: ReviewPick; last: number }[] = [];
  const due: { pick: ReviewPick; overdue: number }[] = [];
  for (const [id, candidate] of eligible) {
    const standing = standings.get(id);
    if (standing?.status === "slipping") {
      slipping.push(candidate);
    } else if (
      (standing?.status === "passed" || standing?.status === "retained") &&
      standing.lastCorrectAt !== undefined
    ) {
      const interval =
        INTERVALS_MS[Math.min(standing.row, INTERVALS_MS.length - 1)] ?? DAY_MS;
      const overdue = (now - standing.lastCorrectAt) / interval;
      if (overdue >= 1) due.push({ pick: candidate.pick, overdue });
    }
  }
  // A stable sort keeps the course's order among equals.
  slipping.sort((a, b) => a.last - b.last);
  due.sort((a, b) => b.overdue - a.overdue);
  return [...slipping, ...due].slice(0, options.count).map((c) => c.pick);
}

/**
 * How many objectives are due for review at `at`: as many as review could
 * ask now with no limit on the count, so slipping ones too, and none
 * answered within SESSION_GAP_MS. Shown before a unit is opened (task 5.24).
 */
export function dueCount(
  units: readonly StoredUnit[],
  evidence: readonly EvidenceEntry[],
  at: Date,
): number {
  return pickForReview(units, evidence, {
    at,
    count: Number.POSITIVE_INFINITY,
    leaveOut: [],
  }).length;
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
