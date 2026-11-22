import { expect, test } from "vitest";
import type { SourceFacts } from "../shared/source.ts";
import { factLines, refusalCard } from "./source-card.ts";

const BOOK: SourceFacts = {
  id: "phenomenology",
  title: "The Phenomenology of Spirit",
  name: "hegel.pdf",
  format: "pdf",
  sections: 141,
  pages: {
    count: 543,
    labelled: true,
    blank: {
      count: 6,
      runs: [
        { first: "ii", last: "ii" },
        { first: "iv", last: "iv" },
        { first: "vi", last: "vi" },
        { first: "541", last: "543" },
      ],
    },
  },
  cut: [
    { title: "Preface", parts: 6 },
    { title: "Force and Understanding", parts: 4 },
    { title: "The Unhappy Consciousness", parts: 2 },
  ],
};

test("a book's card says its pages, sections, the stretches cut and the pages with no text, in the learner's words", () => {
  expect(factLines(BOOK)).toEqual([
    { bold: "543 pages", rest: ", with its own page numbers" },
    { bold: "141 sections", rest: "" },
    {
      bold: "3 long stretches cut into parts",
      rest: ", between paragraphs, so that the tutor reads one at a time: Preface into 6, Force and Understanding into 4, and 1 more",
    },
    {
      bold: "6 pages with no text",
      rest: " (ii, iv, vi, 541 to 543): blank, or pictures; the tutor can look at them as images",
    },
  ]);
});

test("a short text's card has one line, and one stretch cut names it alone", () => {
  const notes: SourceFacts = {
    id: "notes",
    title: "Notes",
    name: "notes.md",
    format: "markdown",
    sections: 1,
    cut: [],
  };
  const cut: SourceFacts = {
    ...notes,
    sections: 2,
    cut: [{ title: "Notes", parts: 2 }],
  };

  expect(factLines(notes)).toEqual([{ bold: "1 section", rest: "" }]);
  expect(factLines(cut)[1]).toEqual({
    bold: "1 long stretch cut into parts",
    rest: ", between paragraphs, so that the tutor reads one at a time: Notes into 2",
  });
});

test("more runs of pages with no text than the card names end in 'and more'", () => {
  const runs = ["2", "4", "6", "8", "10"].map((p) => ({ first: p, last: p }));
  const lines = factLines({
    ...BOOK,
    pages: { count: 12, labelled: false, blank: { count: 5, runs } },
    cut: [],
  });

  expect(lines[0]).toEqual({ bold: "12 pages", rest: "" });
  expect(lines.at(-1)).toEqual({
    bold: "5 pages with no text",
    rest: " (2, 4, 6, 8, and more): blank, or pictures; the tutor can look at them as images",
  });
});

test("each refusal has a title of its own, and what would work instead where something would", () => {
  const reasons = [
    "format",
    "empty",
    "scanned",
    "protected",
    "large",
    "failed",
    "timed-out",
    "sandbox",
  ] as const;
  const cards = reasons.map((reason) =>
    refusalCard({ reason, detail: "Why." }),
  );

  expect(new Set(cards.map((c) => c.title)).size).toBe(reasons.length);
  expect(refusalCard({ reason: "scanned", detail: "Why." })).toEqual({
    title: "This PDF is a scan",
    instead:
      "A copy with a text layer works: most publishers' PDFs and e-books have one.",
  });
});
