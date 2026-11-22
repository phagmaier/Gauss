import { expect, test } from "vitest";
import type { Outline } from "./source.ts";
import { pageLine, readLine } from "./source-lines.ts";

// The thread's "Read" and "Looked at" lines (piece 23), in the learner's
// terms: printed page labels, paragraphs as ¶, and the source named only
// when the course has more than one.

const BOOK: Outline = {
  id: "phenomenology",
  title: "The Phenomenology of Spirit: A Translation",
  file: "original.pdf",
  name: "hegel.pdf",
  format: "pdf",
  sha256: "a".repeat(64),
  converter: 5,
  limit: 20_000,
  pages: { count: 6, labels: ["i", "ii", "1", "2", "3", "4"], blank: [2] },
  entries: [
    {
      title: "Preface",
      entries: [
        {
          id: "s1",
          title: "Preface (part 1 of 2)",
          size: 50,
          place: { pages: { first: 1, last: 3 } },
          part: { number: 1, of: 2 },
        },
        {
          id: "s2",
          title: "Preface (part 2 of 2)",
          size: 50,
          place: { pages: { first: 3, last: 6 } },
          part: { number: 2, of: 2 },
        },
      ],
    },
  ],
};

const ESSAY: Outline = {
  id: "on-liberty",
  title: "On Liberty",
  file: "original.epub",
  name: "mill.epub",
  format: "epub",
  sha256: "b".repeat(64),
  converter: 5,
  limit: 20_000,
  entries: [
    {
      title: "Chapter I. Introductory",
      entries: [
        {
          id: "s1",
          title: "Chapter I. Introductory",
          size: 40,
          place: { paragraphs: { first: 9, last: 16 } },
        },
      ],
    },
  ],
};

test("a section read is named by its title and its place, pages by their printed labels and paragraphs as ¶", () => {
  expect(readLine("phenomenology/s1", [BOOK])).toEqual({
    text: "Preface (part 1 of 2)",
    aside: "pp. i–1",
  });
  expect(readLine("on-liberty/s1", [ESSAY])).toEqual({
    text: "Chapter I. Introductory",
    aside: "¶ 9–16",
  });
});

test("with several sources, a line names its source by its short title first", () => {
  expect(readLine("phenomenology/s2", [ESSAY, BOOK])).toEqual({
    text: "The Phenomenology of Spirit, Preface (part 2 of 2)",
    aside: "pp. 1–4",
  });
  expect(pageLine({ source: "phenomenology", page: 3 }, [ESSAY, BOOK])).toEqual(
    { text: "The Phenomenology of Spirit, page 1", aside: undefined },
  );
});

test("a page looked at says what its text lost, by its marker, and a page with no text says so", () => {
  const page = (math: boolean, images: boolean) => ({
    source: "phenomenology",
    page: 4,
    ...(math ? { math: true as const } : {}),
    ...(images ? { images: true as const } : {}),
  });

  expect(pageLine(page(true, false), [BOOK]).aside).toBe(
    "its text lost its math",
  );
  expect(pageLine(page(false, true), [BOOK]).aside).toBe(
    "its text lost its figures",
  );
  expect(pageLine(page(true, true), [BOOK])).toEqual({
    text: "page 2",
    aside: "its text lost its math and figures",
  });
  expect(pageLine({ source: "phenomenology", page: 2 }, [BOOK])).toEqual({
    text: "page ii",
    aside: "it has no text",
  });
});

test("until the outlines are known, or when they lack it, a line gives the name the tutor used", () => {
  expect(readLine("phenomenology/s1", undefined)).toEqual({
    text: "phenomenology/s1",
    aside: undefined,
  });
  expect(readLine("phenomenology/s9", [BOOK])).toEqual({
    text: "phenomenology/s9",
    aside: undefined,
  });
  expect(pageLine({ source: "phenomenology", page: 5 }, undefined)).toEqual({
    text: "page 5",
    aside: undefined,
  });
});
