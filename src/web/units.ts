// How the page describes units: what each builds on, by its number in the
// list, and what a revision of the curriculum changed.

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

/**
 * The ids of the units a revision changed: new ones, and those whose title,
 * goal or prerequisites differ from the unit with the same id before. Units
 * are matched by id, which the tutor is asked to keep.
 */
export function changedUnits(
  units: readonly Unit[],
  previous: readonly Unit[] | undefined,
): Set<string> {
  if (previous === undefined) return new Set();
  const before = new Map(previous.map((u) => [u.id, u]));
  const same = (a: readonly string[], b: readonly string[]) =>
    a.length === b.length &&
    [...a].sort().join("\n") === [...b].sort().join("\n");
  return new Set(
    units
      .filter((u) => {
        const was = before.get(u.id);
        return (
          was === undefined ||
          was.title !== u.title ||
          was.goal !== u.goal ||
          !same(was.prerequisites, u.prerequisites)
        );
      })
      .map((u) => u.id),
  );
}
