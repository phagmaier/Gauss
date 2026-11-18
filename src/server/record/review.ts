// Which objectives review asks about (docs/decisions.md, "Mastery loop",
// "Review"). Pure: the caller reads the record, and decides when review is
// offered and what it leaves out; the gate takes its other units'
// objectives from here too.

import type { StoredUnit } from "../../shared/curriculum.ts";
import { SESSION_GAP_MS } from "../../shared/events.ts";
import type { EvidenceEntry } from "../../shared/evidence.ts";
import { CONFIDENCE_LEVELS } from "../../shared/question.ts";
import { objectiveStatus, passingAnswers } from "./status.ts";

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
 *   pass each (`passingAnswers`).
 * - Then retained ones.
 * - Among equals, the one whose last answer is the oldest first; then in
 *   the course's order, by unit and then by the unit's plan.
 */
export function pickForReview(
  units: readonly StoredUnit[],
  evidence: readonly EvidenceEntry[],
  options: { at: Date; count: number; leaveOut: Iterable<string> },
): ReviewPick[] {
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

  const candidates = units.flatMap((unit) =>
    (unit.plan?.objectives ?? []).flatMap(({ id }) => {
      const last = lastAnswered.get(id);
      if (leaveOut.has(id) || last === undefined || last > quietSince) {
        return [];
      }
      const status = objectiveStatus(evidence, id);
      const rank =
        status === "slipping"
          ? 0
          : status === "passed"
            ? 1
            : status === "retained"
              ? 2
              : undefined;
      if (rank === undefined) return [];
      const confidence =
        status === "passed" ? lowestConfidence(evidence, id) : 0;
      return [
        { pick: { unit: unit.id, objective: id }, rank, confidence, last },
      ];
    }),
  );
  // A stable sort keeps the course's order among equals.
  return candidates
    .sort(
      (a, b) =>
        a.rank - b.rank || a.confidence - b.confidence || a.last - b.last,
    )
    .slice(0, Math.max(0, options.count))
    .map((c) => c.pick);
}

/** The lowest confidence among the answers that pass the objective, as an index into CONFIDENCE_LEVELS. */
function lowestConfidence(
  evidence: readonly EvidenceEntry[],
  objective: string,
): number {
  return Math.min(
    ...passingAnswers(evidence, objective).map(({ answer }) =>
      answer.kind === "unknown"
        ? 0
        : CONFIDENCE_LEVELS.indexOf(answer.confidence),
    ),
  );
}
