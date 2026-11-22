import { expect, test } from "vitest";
import type { Outline } from "../../shared/source.ts";
import { quotableSource } from "../../shared/source-quote.ts";
import { findPassages } from "./source-passage-search.ts";

test("a phrase after many keyword matches still ranks first, with a bounded preview and its own paragraph", () => {
  const paragraphs = [
    "📘 Preface. Freedom guides reason.",
    ...Array.from({ length: 5 }, () => "Freedom guides reason."),
    `${"Background. ".repeat(60)}Reason—freedom. ${"Afterward. ".repeat(40)}Conclusion.`,
  ];
  const text = paragraphs.join("\n\n");
  const paragraphStarts = [];
  let offset = 0;
  for (const paragraph of paragraphs.slice(0, -1)) {
    offset += [...paragraph].length + 2;
    paragraphStarts.push(offset);
  }
  const outline: Outline = {
    id: "notes",
    title: "Notes",
    file: "original.txt",
    name: "notes.txt",
    format: "text",
    sha256: "a".repeat(64),
    converter: 8,
    limit: 20_000,
    entries: [
      {
        id: "s1",
        title: "Notes",
        size: [...text].length,
        place: { paragraphs: { first: 1, last: 7 } },
        paragraphStarts,
      },
    ],
  };
  const sources = [quotableSource(outline, [{ ref: "notes/s1", text }])];
  const hits = findPassages({ query: "REASON freedom" }, sources);
  expect(hits.map((hit) => hit.range)).toEqual(
    [7, 1, 2, 3, 4].map((n) => ({ paragraphs: { first: n, last: n } })),
  );
  expect(hits[0]?.preview).toMatch(/^….*Reason—freedom\..*…$/);
  expect(hits[0]?.preview.length).toBeLessThanOrEqual(322);
  expect(hits[2]?.preview).toBe("Freedom guides reason.");
  expect(findPassages({ query: "preface conclusion" }, sources)).toEqual([]);
  expect(findPassages({ query: "free" }, sources)).toEqual([]);
});

/** A text source of one section, its paragraphs as the converter numbers them. */
function textSource(paragraphs: readonly string[]) {
  const text = paragraphs.join("\n\n");
  const paragraphStarts = [];
  let offset = 0;
  for (const paragraph of paragraphs.slice(0, -1)) {
    offset += [...paragraph].length + 2;
    paragraphStarts.push(offset);
  }
  const outline: Outline = {
    id: "notes",
    title: "Notes",
    file: "original.txt",
    name: "notes.txt",
    format: "text",
    sha256: "a".repeat(64),
    converter: 8,
    limit: 20_000,
    entries: [
      {
        id: "s1",
        title: "Notes",
        size: [...text].length,
        place: { paragraphs: { first: 1, last: paragraphs.length } },
        paragraphStarts,
      },
    ],
  };
  return [quotableSource(outline, [{ ref: "notes/s1", text }])];
}

/** A PDF of three pages: s1 on page 1 and the top of page 2, s2 from partway down page 2. */
function pdfSource(s1: string, s2: string) {
  const outline: Outline = {
    id: "book",
    title: "Book",
    file: "original.pdf",
    name: "book.pdf",
    format: "pdf",
    sha256: "a".repeat(64),
    converter: 8,
    limit: 20_000,
    pages: { count: 3, labels: ["1", "2", "3"], blank: [] },
    entries: [
      {
        id: "s1",
        title: "One",
        size: [...s1].length,
        place: { pages: { first: 1, last: 2 } },
      },
      {
        id: "s2",
        title: "Two",
        size: [...s2].length,
        place: { pages: { first: 2, last: 3 } },
      },
    ],
  };
  return [
    quotableSource(outline, [
      { ref: "book/s1", text: s1 },
      { ref: "book/s2", text: s2 },
    ]),
  ];
}

const page = (section: string, n: number) => ({
  section,
  range: { pages: { first: n, last: n } },
});

test("a PDF's note definition is searched on the page it sits on, ligatures match their letters, and a section starting partway down a page is found on that page", () => {
  const sources = pdfSource(
    '<!-- page 1 label "1" -->\nThe spirit is sublated.\n\n' +
      "[^1]: Aufhebung, here rendered as sublation, also means to preserve.\n\n" +
      '<!-- page 2 label "2" -->\nThe ﬁnite and the inﬁnite.\n\n',
    'The universal returns.\n\n<!-- page 3 label "3" -->\nThe end.\n',
  );
  const where = (query: string) =>
    findPassages({ query }, sources).map(({ section, range }) => ({
      section,
      range,
    }));
  expect(where("Aufhebung")).toEqual([page("book/s1", 1)]);
  expect(where("also means to preserve")).toEqual([page("book/s1", 1)]);
  expect(where("infinite finite")).toEqual([page("book/s1", 2)]);
  expect(where("universal")).toEqual([page("book/s2", 2)]);
});

test("a word hyphenated at a line's end in a text source is found whole, as a phrase that ranks above keyword matches", () => {
  const ranges = (paragraphs: string[]) =>
    findPassages(
      { query: "knowledge of the other" },
      textSource(paragraphs),
    ).map((hit) => hit.range);
  expect(ranges(["The know-\nledge of the other.", "Else."])).toEqual([
    { paragraphs: { first: 1, last: 1 } },
  ]);
  // Paragraph 2 holds the words apart without the join, and closer than paragraph 1 does.
  expect(
    ranges([
      "The other knowledge of the self.",
      "Knowledge comes first. Then the know-\nledge of the other.",
    ]),
  ).toEqual([
    { paragraphs: { first: 2, last: 2 } },
    { paragraphs: { first: 1, last: 1 } },
  ]);
});

test("paragraph offsets count astral characters as one, and keyword matches rank by how close their words sit", () => {
  const sources = textSource([
    "📘📘📘📘 alpha",
    "red x x x x x x blue",
    "blue red",
  ]);
  const ranges = (query: string) =>
    findPassages({ query }, sources).map((hit) => hit.range);
  expect(ranges("alpha")).toEqual([{ paragraphs: { first: 1, last: 1 } }]);
  expect(ranges("red blue")).toEqual([
    { paragraphs: { first: 3, last: 3 } },
    { paragraphs: { first: 2, last: 2 } },
  ]);
});

test("a preview does not split an astral character at either edge", () => {
  const tail = " more".repeat(100);
  const [atEnd] = findPassages(
    { query: "target" },
    textSource([`target ${"a".repeat(312)}📘${tail}`]),
  );
  expect(atEnd?.preview).toBe(`target ${"a".repeat(312)}…`);
  const [atStart] = findPassages(
    { query: "target" },
    textSource([`${"b".repeat(99)}📘${"c".repeat(62)} target${tail}`]),
  );
  expect(atStart?.preview).toBe(
    `…${"c".repeat(62)} target${tail.slice(0, 320 - 70)}…`,
  );
});
