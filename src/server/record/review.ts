// Which objectives review, the unit gate and a self-test ask about
// (docs/brief.md, "Assessment modes"). Pure: the caller reads the record,
// and decides when each is offered.

import type { StoredUnit } from "../../shared/curriculum.ts";
import { SESSION_GAP_MS } from "../../shared/events.ts";
import type { EvidenceEntry } from "../../shared/evidence.ts";
import type { SelfTestScope } from "../../shared/self-test.ts";
import type { ObjectiveStatus } from "../../shared/status.ts";
import { objectiveStandings } from "./status.ts";

/** An objective to ask about, with the unit whose plan holds it. */
export interface ReviewPick {
  unit: string;
  objective: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How long after its last correct answer an objective is due again, by its
 * correct answers in a row in reviews, gates and self-tests: none, one,
 * two, three, four or more.
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
 *   correct answers in a row in reviews, gates and self-tests since its
 *   last miss, has gone by since its last correct answer given without
 *   help. The most overdue for its interval (the time since that answer
 *   over the interval) comes first: the lowest expected recall, not the
 *   most days past due, which would favour safe long intervals.
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
  const lastAnswered = lastAnswers(evidence);
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

/** When each objective was last answered, in ms, by any answer on it. */
function lastAnswers(evidence: readonly EvidenceEntry[]): Map<string, number> {
  const last = new Map<string, number>();
  for (const entry of evidence) {
    if (entry.kind !== "answer") continue;
    const at = Date.parse(entry.recordedAt);
    const before = last.get(entry.objective);
    if (before === undefined || at > before) last.set(entry.objective, at);
  }
  return last;
}

/** What a self-test of a scope asks, and what its setup says of the scope. */
export interface SelfTestPick {
  /** The objectives to ask, in the order asked; at most the count. */
  objectives: ReviewPick[];
  /** How many objectives the scope holds that a self-test can ask, the hour's left out included. */
  holds: number;
  /** How many of those were answered within SESSION_GAP_MS before `at`, and are left out. */
  withinHour: number;
}

/** Weakest first: slipping, then not passed (attempted or overridden), then passed or retained. */
const WEAKNESS: Partial<Record<ObjectiveStatus, number>> = {
  slipping: 0,
  attempted: 1,
  overridden: 1,
  passed: 2,
  retained: 2,
};

/**
 * What a self-test of `scope` asks at `at`, at most `count` objectives.
 *
 * - A segment, a unit or the course holds its objectives with an answer or
 *   an override, never one not reached; a mix holds the course's objectives
 *   passed at least once (passed, retained or slipping).
 * - An objective answered within SESSION_GAP_MS before `at` is left out,
 *   as review leaves it out, so that a correct answer is a cold one.
 * - When more are left than the count, a mix picks at random; any other
 *   scope takes the weakest first: slipping, then not passed, then passed
 *   or retained; within each, the longest since its last answer (a passed
 *   one, since its last correct answer without help) first, and among
 *   equals the course's order.
 * - The picked objectives are asked in random order, so that no unit's or
 *   segment's come together.
 *
 * @param random a number in [0, 1), as Math.random gives
 */
export function pickForSelfTest(
  units: readonly StoredUnit[],
  evidence: readonly EvidenceEntry[],
  options: {
    scope: SelfTestScope;
    count: number;
    at: Date;
    random: () => number;
  },
): SelfTestPick {
  const { scope, random } = options;
  const inScope: ReviewPick[] = [];
  for (const unit of units) {
    const plan = unit.plan;
    if (plan === undefined) continue;
    if (scope.kind === "segment" || scope.kind === "unit") {
      if (unit.id !== scope.unit) continue;
    }
    const ids =
      scope.kind === "segment"
        ? (plan.segments[scope.segment]?.objectives ?? [])
        : plan.objectives.map((o) => o.id);
    for (const objective of ids) inScope.push({ unit: unit.id, objective });
  }

  const standings = objectiveStandings(
    evidence,
    inScope.map((p) => p.objective),
  );
  const lastAnswered = lastAnswers(evidence);
  const quietSince = options.at.getTime() - SESSION_GAP_MS;
  let withinHour = 0;
  const left: { pick: ReviewPick; weakness: number; since: number }[] = [];
  for (const pick of inScope) {
    const standing = standings.get(pick.objective);
    const weakness =
      standing === undefined ? undefined : WEAKNESS[standing.status];
    if (standing === undefined || weakness === undefined) continue;
    // A mix holds only what has passed: not an attempted or overridden one.
    if (scope.kind === "mix" && weakness === WEAKNESS.attempted) continue;
    const last = lastAnswered.get(pick.objective);
    if (last !== undefined && last > quietSince) {
      withinHour += 1;
      continue;
    }
    const since =
      weakness === 2
        ? (standing.lastCorrectAt ?? Number.NEGATIVE_INFINITY)
        : (last ?? Number.NEGATIVE_INFINITY);
    left.push({ pick, weakness, since });
  }
  const holds = left.length + withinHour;

  let chosen: ReviewPick[];
  if (scope.kind === "mix") {
    chosen = shuffled(
      left.map((c) => c.pick),
      random,
    ).slice(0, options.count);
  } else {
    // A stable sort keeps the course's order among equals.
    left.sort((a, b) => a.weakness - b.weakness || a.since - b.since);
    chosen = shuffled(
      left.slice(0, options.count).map((c) => c.pick),
      random,
    );
  }
  return { objectives: chosen, holds, withinHour };
}

/** A copy of `items` in random order (Fisher-Yates). */
function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const a = result[i] as T;
    result[i] = result[j] as T;
    result[j] = a;
  }
  return result;
}
