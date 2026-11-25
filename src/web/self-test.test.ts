import { expect, test } from "vitest";
import type { StoredUnit } from "../shared/curriculum.ts";
import { type PickableUnit, pickableUnits, selfTestSays } from "./self-test.ts";

const UNITS: PickableUnit[] = [
  { id: "limits", number: 1, title: "Limits", segments: ["Tables", "Algebra"] },
  { id: "rules", number: 3, title: "Rules", segments: ["Products"] },
];

test("only units with a plan can be picked, by their number in the course", () => {
  const unit = (id: string, planned: boolean) =>
    ({
      id,
      title: id,
      ...(planned
        ? {
            plan: {
              objectives: [{ id: `${id}-a`, statement: "A." }],
              segments: [{ title: "One", objectives: [`${id}-a`] }],
            },
          }
        : {}),
    }) as unknown as StoredUnit;
  expect(
    pickableUnits([unit("a", true), unit("b", false), unit("c", true)]),
  ).toEqual([
    { id: "a", number: 1, title: "a", segments: ["One"] },
    { id: "c", number: 3, title: "c", segments: ["One"] },
  ]);
});

test.each<[string, Parameters<typeof selfTestSays>, string]>([
  [
    "fewer asked than the scope can ask, one left out for the hour",
    [
      { asks: 5, holds: 9, withinHour: 1 },
      { kind: "unit", unit: "rules" },
      UNITS,
    ],
    "5 of the 8 objectives you can be asked in unit 3, mixed, one question each and one more after a miss. One objective answered within the hour is left out. A right answer marks its objective retained.",
  ],
  [
    "all of a segment's, none left out",
    [
      { asks: 2, holds: 2, withinHour: 0 },
      { kind: "segment", unit: "limits", segment: 1 },
      UNITS,
    ],
    "All 2 objectives you can be asked in unit 1, segment 2, mixed, one question each and one more after a miss. A right answer marks its objective retained.",
  ],
  [
    "the only one of a mix",
    [{ asks: 1, holds: 1, withinHour: 0 }, { kind: "mix" }, UNITS],
    "The one objective you can be asked in what you have passed, one question and one more after a miss. A right answer marks its objective retained.",
  ],
  [
    "nothing left: the whole course answered within the hour",
    [{ asks: 0, holds: 3, withinHour: 3 }, { kind: "course" }, UNITS],
    "No objective in the course can be asked now. 3 objectives answered within the hour are left out.",
  ],
])("the panel's line: %s", (_, args, said) => {
  expect(selfTestSays(...args)).toBe(said);
});
