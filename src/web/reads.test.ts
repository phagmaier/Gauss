import { expect, test } from "vitest";
import type { Outline, OutlineSection } from "../shared/source.ts";
import { sourceShare, unitReads } from "./reads.ts";

/** A part of a stretch cut into `of` parts, on the given pages. */
function part(
  id: string,
  stretch: string,
  number: number,
  of: number,
  pages: [number, number],
): OutlineSection {
  return {
    id,
    title: `${stretch} (part ${number} of ${of})`,
    size: 1000,
    place: { pages: { first: pages[0], last: pages[1] } },
    part: { number, of },
  };
}

function onPages(
  id: string,
  title: string,
  first: number,
  last: number,
): OutlineSection {
  return { id, title, size: 1000, place: { pages: { first, last } } };
}

// 30 pages: i to vi, then 1 to 24, so that page 7 is printed "1".
const BOOK: Outline = {
  id: "phenomenology",
  title: "The Phenomenology of Spirit",
  file: "original.pdf",
  name: "hegel.pdf",
  format: "pdf",
  sha256: "0".repeat(64),
  converter: 1,
  limit: 30000,
  pages: {
    count: 30,
    labels: [
      ...["i", "ii", "iii", "iv", "v", "vi"],
      ...Array.from({ length: 24 }, (_, i) => String(i + 1)),
    ],
    blank: [],
  },
  entries: [
    {
      title: "Preface",
      entries: [
        part("s1", "Preface", 1, 6, [1, 2]),
        part("s2", "Preface", 2, 6, [3, 4]),
        part("s3", "Preface", 3, 6, [5, 8]),
        part("s4", "Preface", 4, 6, [8, 9]),
        part("s5", "Preface", 5, 6, [10, 11]),
        part("s6", "Preface", 6, 6, [12, 12]),
      ],
    },
    onPages("s7", "Introduction", 13, 15),
    {
      title: "Consciousness",
      entries: [
        onPages("s8", "I. Sense-certainty", 16, 18),
        onPages("s9", "II. Perception", 19, 22),
        onPages("s10", "III. Force and Understanding", 23, 30),
      ],
    },
  ],
};

const NOTES: Outline = {
  id: "notes",
  title: "Reading notes: the Preface",
  file: "original.md",
  name: "notes.md",
  format: "markdown",
  sha256: "1".repeat(64),
  converter: 1,
  limit: 30000,
  entries: [
    {
      title: "Sense and force",
      entries: [
        {
          id: "s1",
          title: "Sense and force (part 1 of 2)",
          size: 1000,
          place: { paragraphs: { first: 1, last: 12 } },
          part: { number: 1, of: 2 },
        },
        {
          id: "s2",
          title: "Sense and force (part 2 of 2)",
          size: 1000,
          place: { paragraphs: { first: 13, last: 20 } },
          part: { number: 2, of: 2 },
        },
      ],
    },
    {
      id: "s3",
      title: "Questions",
      size: 200,
      place: { paragraphs: { first: 1, last: 1 } },
    },
  ],
};

const reads = (refs: string[], outlines: Outline[] = [BOOK]) =>
  unitReads({ sections: refs }, outlines);

test("consecutive parts of a stretch read as one line, pages by their printed labels", () => {
  expect(
    reads(["phenomenology/s1", "phenomenology/s2", "phenomenology/s3"]),
  ).toEqual({
    lines: [{ text: "Preface, parts 1 to 3", place: "pp. i–2" }],
    folded: undefined,
  });
  expect(reads(["phenomenology/s7"])).toEqual({
    lines: [{ text: "Introduction", place: "pp. 7–9" }],
    folded: undefined,
  });
});

test("a lone part names its number and count, and parts apart stay apart", () => {
  expect(reads(["phenomenology/s5"]).lines).toEqual([
    { text: "Preface, part 5 of 6", place: "pp. 4–5" },
  ]);
  expect(reads(["phenomenology/s6"]).lines).toEqual([
    { text: "Preface, part 6 of 6", place: "p. 6" },
  ]);
  expect(reads(["phenomenology/s1", "phenomenology/s3"]).lines).toEqual([
    { text: "Preface, part 1 of 6", place: "pp. i–ii" },
    { text: "Preface, part 3 of 6", place: "pp. v–2" },
  ]);
});

test("parts of distinct same-titled stretches under different headings stay apart", () => {
  const book: Outline = {
    ...BOOK,
    entries: [
      {
        title: "First chapter",
        entries: [
          {
            title: "Examples",
            entries: [
              part("s1", "Examples", 1, 2, [1, 2]),
              part("s2", "Examples", 2, 2, [3, 4]),
            ],
          },
        ],
      },
      {
        title: "Second chapter",
        entries: [
          {
            title: "Examples",
            entries: [
              part("s3", "Examples", 1, 2, [5, 6]),
              part("s4", "Examples", 2, 2, [7, 8]),
            ],
          },
        ],
      },
    ],
  };
  expect(reads(["phenomenology/s1", "phenomenology/s4"], [book]).lines).toEqual(
    [
      { text: "Examples, part 1 of 2", place: "pp. i–ii" },
      { text: "Examples, part 2 of 2", place: "pp. 1–2" },
    ],
  );
});

test("more than two lines fold into a count and the pages they span", () => {
  expect(
    reads(["phenomenology/s8", "phenomenology/s9", "phenomenology/s10"]),
  ).toEqual({
    lines: [
      { text: "I. Sense-certainty", place: "pp. 10–12" },
      { text: "II. Perception", place: "pp. 13–16" },
      { text: "III. Force and Understanding", place: "pp. 17–24" },
    ],
    folded: { text: "3 sections", place: "pp. 10–24" },
  });
});

test("with two sources each line starts with its source's short title", () => {
  const both = [BOOK, NOTES];

  expect(reads(["phenomenology/s7", "notes/s3"], both).lines).toEqual([
    { text: "The Phenomenology of Spirit, Introduction", place: "pp. 7–9" },
    { text: "Reading notes, Questions", place: "¶ 1" },
  ]);
  expect(reads(["notes/s1", "notes/s2"], both).lines).toEqual([
    { text: "Reading notes, Sense and force, parts 1 to 2", place: "¶ 1–20" },
  ]);
  // Folded across two sources, the count has no place.
  expect(
    reads(["phenomenology/s7", "phenomenology/s8", "notes/s3"], both).folded,
  ).toEqual({ text: "3 sections", place: undefined });
});

test("a Markdown source's places are paragraphs, merged parts spanning both", () => {
  expect(reads(["notes/s1", "notes/s2", "notes/s3"], [NOTES])).toEqual({
    lines: [
      { text: "Sense and force, parts 1 to 2", place: "¶ 1–20" },
      { text: "Questions", place: "¶ 1" },
    ],
    folded: undefined,
  });
});

test("a section not in the outlines reads as its ref, with no place", () => {
  expect(reads(["phenomenology/s99", "elsewhere/s1"]).lines).toEqual([
    { text: "phenomenology/s99", place: undefined },
    { text: "elsewhere/s1", place: undefined },
  ]);
});

test("units that read one run of pages name its ends by their labels", () => {
  const units = [
    { sections: ["phenomenology/s1", "phenomenology/s2", "phenomenology/s3"] },
    {
      sections: [
        "phenomenology/s4",
        "phenomenology/s5",
        "phenomenology/s6",
        "phenomenology/s7",
      ],
    },
  ];

  expect(sourceShare(units, [BOOK])).toEqual([
    {
      source: "phenomenology",
      before: "The units read 7 of the 10 sections of ",
      title: "The Phenomenology of Spirit",
      after: ": pages i to 9 of 30.",
    },
  ]);
});

test("units that read pages apart count the pages, and a section read twice once", () => {
  const units = [
    { sections: ["phenomenology/s1", "phenomenology/s2", "phenomenology/s3"] },
    { sections: ["phenomenology/s3", "phenomenology/s7"] },
  ];

  // Pages 1 to 8 and 13 to 15.
  expect(sourceShare(units, [BOOK])).toEqual([
    {
      source: "phenomenology",
      before: "The units read 4 of the 10 sections of ",
      title: "The Phenomenology of Spirit",
      after: ": 11 of its 30 pages.",
    },
  ]);
});

test("a source with no pages says only how many sections are read", () => {
  expect(
    sourceShare([{ sections: ["notes/s1", "notes/s2"] }], [NOTES]),
  ).toEqual([
    {
      source: "notes",
      before: "The units read 2 of the 3 sections of ",
      title: "Reading notes: the Preface",
      after: ".",
    },
  ]);
});

test("a source no unit reads says so, and units naming no section say nothing", () => {
  expect(
    sourceShare([{ sections: ["phenomenology/s7"] }], [BOOK, NOTES]),
  ).toEqual([
    {
      source: "phenomenology",
      before: "The units read 1 of the 10 sections of ",
      title: "The Phenomenology of Spirit",
      after: ": pages 7 to 9 of 30.",
    },
    {
      source: "notes",
      before: "The units read none of the 3 sections of ",
      title: "Reading notes: the Preface",
      after: ".",
    },
  ]);
  expect(sourceShare([{}, { sections: [] }], [BOOK, NOTES])).toEqual([]);
});
