// Verified quotes (task 4.9): a passage is found in a source's sections
// joined in reading order, by a key that ignores case, spacing, hyphens,
// emphasis, curly quotes and the markup the conversion writes, and shown in
// the source's own words, cited at the page or paragraph where it starts.
// The fixtures are written as `convert.py` writes each format.

import { expect, test } from "vitest";
import type { Outline, SectionRef } from "./source.ts";
import {
  findQuote,
  type QuotableSource,
  quotableSource,
  quoteTextProblem,
  readingOrder,
} from "./source-quote.ts";

const outline = (
  given: Partial<Outline> & Pick<Outline, "id" | "format" | "entries">,
): Outline => ({
  title: given.id,
  file: "original",
  name: given.id,
  sha256: "a".repeat(64),
  converter: 6,
  limit: 20_000,
  ...given,
});

const quotable = (
  source: Outline,
  texts: Record<string, string>,
): QuotableSource =>
  quotableSource(
    source,
    readingOrder(source).map((ref) => ({ ref, text: texts[ref] ?? "" })),
  );

// A PDF: a paragraph is a line, a note's definition follows its paragraph,
// and a page that starts inside a paragraph has its marker inline. The
// Preface is cut in two between paragraphs; its bookmarks list the
// Introduction first.
const PREFACE_1 =
  '<!-- page 1 label "9" -->\n# Preface\n\n' +
  "It is customary to preface a work with an explanation of the author’s aim.[^1]\n\n" +
  "[^1]: Hegel’s note on prefaces.\n\n" +
  'The bud disappears when the blossom breaks through, <!-- page 2 label "10" --> and we might say that the former is refuted by the latter.\n\n';
const PREFACE_2 =
  "In the same way when the fruit comes, the blossom may be explained to be a false form.\n\n" +
  '<!-- page 3 label "11" -->\nThe true is the whole.\n\n';
const INTRODUCTION =
  '<!-- page 4 label "12" -->\n# Introduction\n\nKnowing is a ﬁrst test. The true is the whole.\n';
const BOOK = outline({
  id: "phenomenology",
  format: "pdf",
  pages: { count: 4, labels: ["9", "10", "11", "12"], blank: [] },
  entries: [
    {
      id: "s3",
      title: "Introduction",
      size: 70,
      place: { pages: { first: 4, last: 4 } },
    },
    {
      title: "Preface",
      entries: [
        {
          id: "s1",
          title: "Preface (part 1 of 2)",
          size: 300,
          place: { pages: { first: 1, last: 2 } },
          part: { number: 1, of: 2 },
        },
        {
          id: "s2",
          title: "Preface (part 2 of 2)",
          size: 120,
          place: { pages: { first: 2, last: 3 } },
          part: { number: 2, of: 2 },
        },
      ],
    },
  ],
});
const PDF = quotable(BOOK, {
  "phenomenology/s1": PREFACE_1,
  "phenomenology/s2": PREFACE_2,
  "phenomenology/s3": INTRODUCTION,
});

// Plain text: lines wrapped as typed, a word hyphenated at a line's end,
// and a line holding a margin's line number.
const LIBERTY_TEXT =
  "The object of this Essay is to assert one very simple principle, as en-\n" +
  "titled to govern absolutely the dealings of society with the individual.\n" +
  "12\n" +
  "That principle is, that the sole end for which mankind are warranted is “self-protection.”\n\n" +
  "His own good is not a sufficient warrant.\n";
const LIBERTY = outline({
  id: "on-liberty",
  format: "text",
  entries: [
    {
      id: "s1",
      title: "On Liberty",
      size: LIBERTY_TEXT.length,
      place: { paragraphs: { first: 1, last: 2 } },
      paragraphStarts: [LIBERTY_TEXT.indexOf("His own")],
    },
  ],
});
const TEXT = quotable(LIBERTY, { "on-liberty/s1": LIBERTY_TEXT });

// An EPUB: emphasis, escaped characters of its own, a block quote of lines
// broken by `<br>`, a note's reference and its definition. The chapter's
// stretch starts at its 7th paragraph.
const CHAPTER =
  "She said *nothing* at all\\: the \\*star\\* stayed.\n\n" +
  "> Who has seen the wind?\\\n> Neither I nor you.\n\n" +
  "After[^1] the verse.\n\n" +
  "[^1]: The note’s text.\n";
const POEMS = outline({
  id: "poems",
  format: "epub",
  entries: [
    {
      title: "Chapter One",
      entries: [
        {
          id: "s1",
          title: "Chapter One (part 2 of 2)",
          size: CHAPTER.length,
          place: { paragraphs: { first: 7, last: 10 } },
          paragraphStarts: ["> Who", "After", "[^1]:"].map((w) =>
            CHAPTER.indexOf(w),
          ),
          part: { number: 2, of: 2 },
        },
      ],
    },
  ],
});
const EPUB = quotable(POEMS, { "poems/s1": CHAPTER });

test("a source's sections are read in the order of their ids, not the outline's", () => {
  expect(readingOrder(BOOK)).toEqual([
    "phenomenology/s1",
    "phenomenology/s2",
    "phenomenology/s3",
  ]);
});

test("a quote across a cut is found, shown without the markup, and cited at the page where its first part starts", () => {
  expect(
    findQuote(
      "The bud disappears when the blossom breaks through, and we might say that the former is refuted by the latter. In the same way when the fruit comes",
      [PDF],
    ),
  ).toEqual({
    section: "phenomenology/s1",
    text:
      "The bud disappears when the blossom breaks through, and we might say that the former is refuted by the latter.\n\n" +
      "In the same way when the fruit comes",
    at: { page: 1 },
  });
  // Started after the inline marker, it is on the next page.
  expect(
    findQuote("we might say that the former is refuted", [PDF])?.at,
  ).toEqual({ page: 2 });
});

test("a footnote reference and the note after its paragraph, a first letter's case and a curly apostrophe typed straight do not stop a match", () => {
  expect(
    findQuote(
      "it is customary to preface a work with an explanation of the author's aim. The bud disappears",
      [PDF],
    ),
  ).toEqual({
    section: "phenomenology/s1",
    text: "It is customary to preface a work with an explanation of the author’s aim.\n\nThe bud disappears",
    at: { page: 1 },
  });
});

test("a ligature matches its letters", () => {
  expect(findQuote("Knowing is a first test", [PDF])).toEqual({
    section: "phenomenology/s3",
    text: "Knowing is a ﬁrst test",
    at: { page: 4 },
  });
});

test("a word hyphenated at a line's end and a margin's line number inside a quote do not stop a match; curly quotes match straight ones", () => {
  expect(
    findQuote(
      'one very simple principle, as entitled to govern absolutely the dealings of society with the individual. That principle is, that the sole end for which mankind are warranted is "self-protection."',
      [TEXT],
    ),
  ).toEqual({
    section: "on-liberty/s1",
    text:
      "one very simple principle, as en-titled to govern absolutely the dealings of society with the individual. " +
      "That principle is, that the sole end for which mankind are warranted is “self-protection.”",
    at: { paragraph: 1 },
  });
});

test("quotation marks around a passage that the source does not have are left out; a later paragraph is cited by its number", () => {
  expect(
    findQuote("“His own good is not a sufficient warrant.”", [TEXT]),
  ).toEqual({
    section: "on-liberty/s1",
    text: "His own good is not a sufficient warrant.",
    at: { paragraph: 2 },
  });
});

test("in an EPUB, emphasis marks, escapes, block quote marks and note references are left out of the words, and a line break stays", () => {
  const found = (passage: string) => findQuote(passage, [EPUB]);
  expect(found("She said nothing at all: the *star* stayed.")).toEqual({
    section: "poems/s1",
    text: "She said nothing at all: the *star* stayed.",
    at: { paragraph: 7 },
  });
  expect(found("Who has seen the wind? Neither I nor you.")).toEqual({
    section: "poems/s1",
    text: "Who has seen the wind?\nNeither I nor you.",
    at: { paragraph: 8 },
  });
  expect(found("After the verse.")?.text).toBe("After the verse.");
  // A note is quotable, its definition's mark left out.
  expect(found("The note’s text.")).toEqual({
    section: "poems/s1",
    text: "The note’s text.",
    at: { paragraph: 10 },
  });
});

test("a passage the sources lack is not found: a changed word, one starting inside a word, and one across two sources", () => {
  expect(findQuote("The true is the hole.", [PDF])).toBeUndefined();
  expect(findQuote("he said nothing at all", [EPUB])).toBeUndefined();
  // The end of one source and the start of the next.
  expect(
    findQuote(
      "Neither I nor you. After the verse. The note's text. The object of this Essay",
      [EPUB, TEXT],
    ),
  ).toBeUndefined();
});

test("of two matches, the one in the named section comes first, then one in the segment's, then the first in reading order", () => {
  const where = (prefer: { section?: SectionRef; segment?: SectionRef[] }) =>
    findQuote("The true is the whole.", [PDF], prefer)?.section;
  expect(where({})).toBe("phenomenology/s2");
  expect(where({ segment: ["phenomenology/s3"] })).toBe("phenomenology/s3");
  expect(
    where({ section: "phenomenology/s2", segment: ["phenomenology/s3"] }),
  ).toBe("phenomenology/s2");
  expect(where({ section: "phenomenology/s3" })).toBe("phenomenology/s3");
  // A named section without the passage gives way to the reading order.
  expect(where({ section: "phenomenology/s1" })).toBe("phenomenology/s2");
});

test("in a named section, a match that starts there comes before one that runs into it from the section before", () => {
  const first = "One two three four.\n\n";
  const second = "Five six.\n\nThree four. Five six.\n";
  const cut = outline({
    id: "notes",
    format: "text",
    entries: [
      {
        id: "s1",
        title: "notes (part 1 of 2)",
        size: first.length,
        place: { paragraphs: { first: 1, last: 1 } },
        paragraphStarts: [],
      },
      {
        id: "s2",
        title: "notes (part 2 of 2)",
        size: second.length,
        place: { paragraphs: { first: 2, last: 3 } },
        paragraphStarts: [second.indexOf("Three")],
      },
    ],
  });
  const notes = [quotable(cut, { "notes/s1": first, "notes/s2": second })];
  expect(
    findQuote("three four. Five six.", notes, { section: "notes/s2" }),
  ).toEqual({
    section: "notes/s2",
    text: "Three four. Five six.",
    at: { paragraph: 3 },
  });
  expect(findQuote("three four. Five six.", notes)).toEqual({
    section: "notes/s1",
    text: "three four.\n\nFive six.",
    at: { paragraph: 1 },
  });
});

test("a paragraph is not cited from an outline converted before paragraphs' starts were kept", () => {
  const old = outline({
    ...LIBERTY,
    converter: 5,
    entries: [
      {
        id: "s1",
        title: "On Liberty",
        size: LIBERTY_TEXT.length,
        place: { paragraphs: { first: 1, last: 2 } },
      },
    ],
  });
  expect(
    findQuote("His own good is not a sufficient warrant.", [
      quotable(old, { "on-liberty/s1": LIBERTY_TEXT }),
    ]),
  ).toEqual({
    section: "on-liberty/s1",
    text: "His own good is not a sufficient warrant.",
    at: undefined,
  });
});

function oneSection(format: Outline["format"], text: string): QuotableSource {
  const source = outline({
    id: "words",
    format,
    converter: 7,
    ...(format === "pdf" ? { pages: { count: 2, blank: [] } } : {}),
    entries: [
      {
        id: "s1",
        title: "Words",
        size: [...text].length,
        ...(format === "pdf"
          ? { place: { pages: { first: 1, last: 2 } } }
          : {
              place: { paragraphs: { first: 1, last: 1 } },
              paragraphStarts: [],
            }),
      },
    ],
  });
  return quotable(source, { "words/s1": text });
}

test("printed page comments remain visible; only real PDF markers change the page", () => {
  const literal = "Start here <!-- page 2 --> then finish this line.";
  const pdf = oneSection(
    "pdf",
    `<!-- page 1 -->\n${literal.replace("<", "\\<")}\n\n<!-- page 2 -->\nContinue until the end.\n`,
  );
  const epub = oneSection("epub", `${literal.replace("<", "\\<")}\n`);
  for (const book of [pdf, epub]) {
    expect(findQuote(literal, [book])?.text).toBe(literal);
    expect(
      findQuote("Start here then finish this line.", [book]),
    ).toBeUndefined();
  }
  expect(findQuote("then finish this line.", [pdf])?.at).toEqual({ page: 1 });
  expect(findQuote("Continue until the end.", [pdf])?.at).toEqual({ page: 2 });
  expect(
    findQuote(
      "then finish this line. <!-- page 2 --> Continue until the end.",
      [pdf],
    )?.text,
  ).toBe("then finish this line.\n\nContinue until the end.");
});

test("a soft hyphenated line wrap does not create a word boundary or extra words", () => {
  const book = oneSection(
    "text",
    "Come see the trans-\nformation changes everything.\n",
  );
  expect(findQuote("formation changes everything.", [book])).toBeUndefined();
  expect(findQuote("Come see the trans", [book])).toBeUndefined();
  expect(
    findQuote("The transformation changes everything.", [book])?.text,
  ).toBe("the trans-formation changes everything.");
  expect(quoteTextProblem("pre-\npro-\ncessing.")).toContain(
    "fewer than 3 words",
  );
});

test("links and list marks are not words, but printed stars and code punctuation are", () => {
  const markdown = oneSection(
    "markdown",
    "Take [the long way](https://example.org) home.\n\nWrite a*b to multiply and `a_b` to index.\n",
  );
  expect(findQuote("Take the long way home.", [markdown])?.text).toBe(
    "Take the long way home.",
  );
  expect(
    findQuote("Write a*b to multiply and a_b to index.", [markdown])?.text,
  ).toBe("Write a*b to multiply and a_b to index.");
  const epub = oneSection(
    "epub",
    "- Choose the first option.\n\n- Choose the second option.\n",
  );
  expect(
    findQuote("Choose the first option. Choose the second option.", [epub])
      ?.text,
  ).toBe("Choose the first option.\n\nChoose the second option.");
});

test("a carried heading is cited as a heading, not the child section's first paragraph", () => {
  const text =
    "# 😀 Parent Chapter Title\n\n## Child Chapter Title\n\nTake the long way home.\n";
  const source = outline({
    id: "words",
    format: "markdown",
    converter: 7,
    entries: [
      {
        id: "s1",
        title: "Child Chapter Title",
        size: [...text].length,
        place: { paragraphs: { first: 1, last: 1 } },
        paragraphStarts: [],
        headings: [
          { start: 0, end: 25, title: "😀 Parent Chapter Title" },
          { start: 26, end: 49, title: "Child Chapter Title" },
        ],
      },
    ],
  });
  const book = quotable(source, { "words/s1": text });
  expect(findQuote("Parent Chapter Title", [book])?.at).toEqual({
    heading: "😀 Parent Chapter Title",
  });
  expect(findQuote("Take the long way home.", [book])?.at).toEqual({
    paragraph: 1,
  });
});

test("paired single quotes can wrap a quote and Unicode final sigma folds with other sigma", () => {
  const book = oneSection(
    "text",
    "The true is the whole. ΟΔΥΣΣΕΎΣ comes home.\n",
  );
  expect(findQuote("‘The true is the whole.’", [book])?.text).toBe(
    "The true is the whole.",
  );
  expect(findQuote("οδυσσεύς comes home.", [book])?.text).toBe(
    "ΟΔΥΣΣΕΎΣ comes home.",
  );
});

test("a passage is refused before it is looked for when it is too long, holds an ellipsis, or has fewer than three words", () => {
  expect(quoteTextProblem("The true is the whole.")).toBeUndefined();
  expect(quoteTextProblem(`${"word ".repeat(240)}word`)).toBe(
    "The passage is 1,204 characters, over the limit of 1,200: quote the sentences that carry the point, and say the rest in your own words.",
  );
  for (const passage of [
    "The true … the whole",
    "The true ... the whole",
    "The true. . . is",
  ]) {
    expect(quoteTextProblem(passage)).toBe(
      "The passage holds an ellipsis, so it is not one passage as the source has it: quote each part with a call of its own.",
    );
  }
  // A page marker or a reference is no word.
  for (const passage of [
    "the whole",
    '<!-- page 3 label "11" --> the whole[^1]',
  ]) {
    expect(quoteTextProblem(passage)).toBe(
      "The passage has fewer than 3 words: quote at least 3, the phrase with the words around it.",
    );
  }
});
