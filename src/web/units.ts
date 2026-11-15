// How the page describes units: what each builds on, by its number in the
// list, and what a revision of the curriculum changed.

import type { Unit } from "../shared/curriculum.ts";

/** "Builds on units 1, 2 and 4", or null for a unit that starts the course. */
export function buildsOn(unit: Unit, units: readonly Unit[]): string | null {
  const numbers = unit.prerequisites
    .map((id) => units.findIndex((u) => u.id === id) + 1)
    .filter((n) => n > 0)
    .sort((a, b) => a - b);
  const last = numbers.pop();
  if (last === undefined) return null;
  return numbers.length === 0
    ? `Builds on unit ${last}`
    : `Builds on units ${numbers.join(", ")} and ${last}`;
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
