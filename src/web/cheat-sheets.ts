// What the cheat sheets' panel and reader say (piece 29, direction A): a
// sheet's units by number and title, which units cannot be picked, and the
// line beside "Write the cheat sheet".

/** A unit of the course, by its number in the course's order. */
export interface NumberedUnit {
  id: string;
  number: number;
  title: string;
}

export function numbered(
  units: readonly { id: string; title: string }[],
): NumberedUnit[] {
  return units.map((unit, at) => ({
    id: unit.id,
    number: at + 1,
    title: unit.title,
  }));
}

/**
 * "Unit 2", "Units 2 and 3", "Units 1 to 4", "Units 1, 3 and 5 to 8", for
 * numbers in order: a run of three or more is spelled with "to".
 */
export function unitRuns(numbers: readonly number[]): string {
  const runs: [number, number][] = [];
  for (const n of numbers) {
    const last = runs.at(-1);
    if (last !== undefined && n === last[1] + 1) last[1] = n;
    else runs.push([n, n]);
  }
  const parts = runs.flatMap(([a, b]) =>
    b - a >= 2 ? [`${a} to ${b}`] : a === b ? [`${a}`] : [`${a}`, `${b}`],
  );
  const words =
    parts.length === 1
      ? parts[0]
      : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
  return `${numbers.length === 1 ? "Unit" : "Units"} ${words}`;
}

/** A sheet's or a write's units, in course order: "Units 2 and 3", and "Limits, Continuity". */
export function sheetUnits(
  ids: readonly string[],
  units: readonly NumberedUnit[],
): { words: string; titles: string } {
  const named = units.filter((unit) => ids.includes(unit.id));
  return {
    words: unitRuns(named.map((unit) => unit.number)),
    titles: named.map((unit) => unit.title).join(", "),
  };
}

/** The line under the boxes, or undefined when every unit can be picked. */
export function notPickable(
  units: readonly NumberedUnit[],
  pickable: readonly string[],
): string | undefined {
  const not = units.filter((unit) => !pickable.includes(unit.id));
  if (not.length === 0) return undefined;
  const one = not.length === 1;
  return `${unitRuns(not.map((unit) => unit.number))} ${one ? "is" : "are"} not finished, so ${one ? "it" : "they"} cannot be picked.`;
}

/**
 * Up to this many units, the line says a sheet is one printed page; beyond,
 * two at most. The prompt leaves "many" to the writer
 * (`prompts/cheat-sheet.md`); the number is the mock's.
 */
const ONE_PAGE_UNITS = 6;

/**
 * The line beside "Write the cheat sheet". While one is written, Write is
 * disabled and the server refuses another, so the line says to wait (the
 * mock's "this one waits" would promise a queue there is not).
 */
export function writeSays(picked: readonly number[], writing: boolean) {
  if (writing) {
    return "One sheet is written at a time: write another once this one is done.";
  }
  if (picked.length === 0) return "Pick at least one unit.";
  const pages =
    picked.length > ONE_PAGE_UNITS
      ? "two printed pages at most"
      : "one printed page";
  return `${unitRuns(picked)}: ${pages}.`;
}
