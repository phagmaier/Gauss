// How the page describes a unit's prerequisites by their numbers in the list.

import type { Unit } from "../shared/curriculum.ts";

/** "Builds on units 1, 2 and 4", or null for a unit that starts the course. */
export function buildsOn(unit: Unit, units: readonly Unit[]): string | null {
  const numbers = unit.prerequisites
    .map((id) => units.findIndex((u) => u.id === id) + 1)
    .filter((n) => n > 0)
    .sort((a, b) => a - b);
  return numbers.length === 0 ? null : `Builds on ${unitNumbers(numbers)}`;
}

/** "unit 3", "units 1 and 3", or "units 1, 2 and 4", for numbers in order. */
export function unitNumbers(numbers: readonly number[]): string {
  const rest = numbers.slice(0, -1);
  const last = numbers.at(-1);
  return rest.length === 0
    ? `unit ${last}`
    : `units ${rest.join(", ")} and ${last}`;
}
