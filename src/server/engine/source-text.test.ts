import { expect, test } from "vitest";
import type { Outline } from "../../shared/source.ts";
import { formatText, outlineLines } from "./source-text.ts";

/** A PDF of twelve pages, four in roman numerals, then 1 to 8. */
const BOOK: Outline = {
  id: "phenomenology",
  title: "The Phenomenology of Spirit",
  file: "original.pdf",
  name: "hegel.pdf",
  format: "pdf",
  sha256: "b".repeat(64),
  converter: 5,
  limit: 20_000,
  pages: {
    count: 12,
    labels: ["i", "ii", "iii", "iv", "1", "2", "3", "4", "5", "6", "7", "8"],
    blank: [],
  },
  entries: [
    {
      title: "Preface",
      entries: [
        {
          id: "s1",
          title: "Preface (part 1 of 2)",
          size: 15_203,
          place: { pages: { first: 1, last: 3 } },
          part: { number: 1, of: 2 },
        },
        {
          id: "s2",
          title: "Preface (part 2 of 2)",
          size: 9_000,
          place: { pages: { first: 3, last: 4 } },
          part: { number: 2, of: 2 },
        },
      ],
    },
    {
      title: "A. Consciousness",
      entries: [
        {
          title: "I. Sense-certainty",
          entries: [
            {
              id: "s3",
              title: "I. Sense-certainty",
              size: 4_100,
              place: { pages: { first: 5, last: 5 } },
            },
          ],
        },
      ],
    },
  ],
};

test("an outline as the planner reads it: a line per entry, indented by depth, a section's with its id, title, pages as numbered and as printed, and size", () => {
  expect(outlineLines(BOOK)).toEqual([
    '- "Preface"',
    '  - s1: "Preface (part 1 of 2)", pages 1–3 (printed i–iii), 15,203 characters',
    '  - s2: "Preface (part 2 of 2)", pages 3–4 (printed iii–iv), 9,000 characters',
    '- "A. Consciousness"',
    '  - "I. Sense-certainty"',
    '    - s3: "I. Sense-certainty", page 5 (printed 1), 4,100 characters',
  ]);
  expect(formatText(BOOK)).toBe("a PDF of 12 pages");
});

test("pages printed as numbered need no printed labels, and a text's sections are placed by paragraph", () => {
  const plain: Outline = {
    ...BOOK,
    pages: {
      count: 3,
      labels: ["1", "2", "3"],
      blank: [],
    },
    entries: [
      {
        id: "s1",
        title: 'The "whole"',
        size: 120,
        place: { pages: { first: 2, last: 3 } },
      },
    ],
  };
  const { pages: _, ...rest } = BOOK;
  const text: Outline = {
    ...rest,
    format: "text",
    entries: [
      {
        id: "s1",
        title: "Notes",
        size: 80,
        place: { paragraphs: { first: 1, last: 1 } },
      },
      {
        id: "s2",
        title: "More notes",
        size: 1_200,
        place: { paragraphs: { first: 2, last: 9 } },
      },
    ],
  };

  expect(outlineLines(plain)).toEqual([
    '- s1: "The \\"whole\\"", pages 2–3, 120 characters',
  ]);
  expect(outlineLines(text)).toEqual([
    '- s1: "Notes", paragraph 1, 80 characters',
    '- s2: "More notes", paragraphs 2–9, 1,200 characters',
  ]);
  expect(formatText(text)).toBe("a plain text file");
});
