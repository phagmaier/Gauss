// What the self-test's panel on the course view says (piece 27, direction
// A): the units it can pick, and the line under its choices.

import type { StoredUnit } from "../shared/curriculum.ts";
import type { SelfTestCounts, SelfTestScope } from "../shared/self-test.ts";

/** A unit a segment or unit scope can pick: one with a plan, by its number in the course. */
export interface PickableUnit {
  id: string;
  number: number;
  title: string;
  segments: string[];
}

/** The units with a plan, started or planned, in the course's order. */
export function pickableUnits(units: readonly StoredUnit[]): PickableUnit[] {
  return units.flatMap((unit, at) =>
    unit.plan === undefined
      ? []
      : [
          {
            id: unit.id,
            number: at + 1,
            title: unit.title,
            segments: unit.plan.segments.map((s) => s.title),
          },
        ],
  );
}

/** "unit 2, segment 1", "unit 2", "the course", or "what you have passed". */
function scopeWords(
  scope: SelfTestScope,
  units: readonly PickableUnit[],
): string {
  switch (scope.kind) {
    case "segment":
    case "unit": {
      const number = units.find((u) => u.id === scope.unit)?.number;
      const unit = number === undefined ? "the unit" : `unit ${number}`;
      return scope.kind === "unit"
        ? unit
        : `${unit}, segment ${scope.segment + 1}`;
    }
    case "course":
      return "the course";
    case "mix":
      return "what you have passed";
  }
}

/**
 * The line under the panel's choices, from the counts route: how many
 * objectives the self-test asks of how many the scope can ask now, how many
 * answered within the hour are left out, and what a right answer does.
 */
export function selfTestSays(
  counts: SelfTestCounts,
  scope: SelfTestScope,
  units: readonly PickableUnit[],
): string {
  const where = scopeWords(scope, units);
  const can = counts.holds - counts.withinHour;
  const left =
    counts.withinHour === 0
      ? ""
      : counts.withinHour === 1
        ? " One objective answered within the hour is left out."
        : ` ${counts.withinHour} objectives answered within the hour are left out.`;
  if (counts.asks === 0) {
    return `No objective in ${where} can be asked now.${left}`;
  }
  const asks =
    counts.asks === can
      ? can === 1
        ? `The one objective you can be asked in ${where}, one question and one more after a miss.`
        : `All ${can} objectives you can be asked in ${where}, mixed, one question each and one more after a miss.`
      : `${counts.asks} of the ${can} objectives you can be asked in ${where}, mixed, one question each and one more after a miss.`;
  return `${asks}${left} A right answer marks its objective retained.`;
}
