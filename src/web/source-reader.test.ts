import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import type { Outline, OutlineSection } from "../shared/source.ts";
import { orderedSections } from "../shared/source-quote.ts";
import { SourceText } from "./SourceText.tsx";
import { openSection, outlineRows, type ReaderPart } from "./source-reader.ts";

function section(id: string, first = 1): OutlineSection {
  return {
    id,
    title: id,
    size: 100,
    place: { paragraphs: { first, last: first } },
    paragraphStarts: [],
  };
}

function book(
  entries: Outline["entries"],
  format: Outline["format"] = "epub",
): Outline {
  return {
    id: "book",
    title: "Book",
    file: `original.${format}`,
    name: "Book",
    format,
    converter: 8,
    limit: 20000,
    sha256: "0".repeat(64),
    entries,
  };
}

function open(
  source: Outline,
  texts: Record<string, string>,
  section: string,
  quote?: string,
) {
  return openSection(
    source,
    orderedSections(source),
    section,
    quote,
    async (id) => {
      const text = texts[id];
      if (text === undefined) throw new Error(`Unexpected section: ${id}`);
      return text;
    },
  );
}

function render(part: ReaderPart | undefined) {
  if (!part) throw new Error("Expected a section of the passage");
  return renderToStaticMarkup(createElement(SourceText, { part, onPage() {} }));
}

test("a quote starts in the named section and crosses cuts in reading order, not outline order", async () => {
  const source = book([section("s3"), section("s1"), section("s2")]);
  const text = {
    s1: "Before. **One**   two\n\n",
    s2: "three. And more.\n",
    s3: "One two three.",
  };
  const parts = await open(source, text, "s1", "One two three.");
  expect(parts.map((p) => p.id)).toEqual(["s1", "s2"]);
  expect(render(parts[0])).toContain(
    "<strong><mark>One</mark></strong><mark>   two</mark>",
  );
  expect(render(parts[1])).toContain("<mark>three.</mark> And more.");
  const missing = await open(source, text, "s2", "One two three.");
  expect(missing).toHaveLength(1);
  expect(render(missing[0])).not.toContain("<mark>");
});

test("a slice edge inside a word is not a whole-word quote boundary", async () => {
  const source = book([
    { ...section("s1"), part: { number: 1, of: 2 } },
    { ...section("s2"), part: { number: 2, of: 2 } },
  ]);
  const texts = { s1: "Go to the far", s2: "mer first, then come back." };
  expect(
    render((await open(source, texts, "s1", "to the far"))[0]),
  ).not.toContain("<mark>");
  expect(
    render((await open(source, texts, "s2", "mer first, then"))[0]),
  ).not.toContain("<mark>");
});

test("paragraph margins skip headings and convert outline code points to Markdown offsets", async () => {
  const text = "# 🐚 Beach\n\nA shell.\n\nAnother shell.";
  const source = book(
    [
      {
        ...section("s1"),
        headings: [{ start: 0, end: 10, title: "🐚 Beach" }],
        place: { paragraphs: { first: 5, last: 6 } },
        paragraphStarts: [21],
      },
    ],
    "markdown",
  );
  const html = render((await open(source, { s1: text }, "s1"))[0]);
  expect(html).toContain("<h1>🐚 Beach</h1>");
  expect(html).toMatch(/¶ 5<\/span><\/span>A shell\./);
  expect(html).toMatch(/¶ 6<\/span><\/span>Another shell\./);
});

test("notes in a Notes chapter and a local note reusing its label remain distinct in a cross-section passage", async () => {
  const source = book([
    section("s1"),
    { ...section("s2"), noteDefinitions: { "1": "s3" } },
    section("s3"),
  ]);
  const text = {
    s1: "First[^1].\n\n[^1]: Local.\n\nStart here.\n\n",
    s2: "Then continue[^1].",
    s3: "# Notes\n\n[^1]: External.\n\n    Still that note.\n",
  };
  const parts = await open(source, text, "s1", "Start here. Then continue.");
  const [first, second] = parts.map(render);
  expect(first).toContain("Local.");
  expect(first).not.toContain("External.");
  expect(second).toContain("External.");
  expect(second).toContain("Still that note.");
  expect(first?.match(/href="#([^"]+fn-1)"/)?.[1]).not.toEqual(
    second?.match(/href="#([^"]+fn-1)"/)?.[1],
  );
  // The Notes chapter must have text even though no reference is in it.
  expect(render((await open(source, text, "s3"))[0])).toContain("External.");
});

test("legacy unresolved references use the sole external definition but never pick a different note by chance", async () => {
  const source = {
    ...book([section("s1"), section("s2"), section("s3")]),
    converter: 7,
  };
  const texts = { s1: "See this[^a].", s2: "[^a]: Note one.", s3: "Text." };
  expect(render((await open(source, texts, "s1"))[0])).toContain("Note one.");
  texts.s3 = "[^a]: Note two.";
  const ambiguous = render((await open(source, texts, "s1"))[0]);
  expect(ambiguous).not.toContain("Note one.");
  expect(ambiguous).not.toContain("Note two.");
});

test("a mid-page start inherits the marker and its loss flag; inline and escaped markers stay distinct", async () => {
  const pdf = (id: string, first: number, last: number) => ({
    ...section(id),
    place: { pages: { first, last } },
  });
  const source = {
    ...book([pdf("s1", 1, 2), pdf("s2", 2, 3)], "pdf"),
    pages: { count: 3, blank: [], labels: ["i", "ii", "1"] },
  };
  const [part] = await open(
    source,
    {
      s1: "<!-- page 1 -->\nEarly. <!-- page 2 math --> Middle",
      s2: "more. <!-- page 3 images --> End. \\<!-- page 99 -->",
    },
    "s2",
  );
  const html = render(part);
  expect(html).toMatch(/data-page="2"[^>]*>ii<\/button>/);
  expect(html).toContain("lost math");
  expect(html).toContain("lost images");
  expect(html).toContain("&lt;!-- page 99 --&gt;");
  expect(html).not.toContain('data-page="99"');
});

test("the nested outline opens only the branches containing reads and identifies every unit reading a section", () => {
  const source = book([
    { title: "Used", entries: [{ title: "Nested", entries: [section("s1")] }] },
    { title: "Folded", entries: [section("s2")] },
  ]);
  const units = ["a", "b"].map((id) => ({
    id,
    title: id,
    goal: id,
    prerequisites: [],
    sections: ["book/s1"],
  }));
  const rows = outlineRows(source, units, "b");
  expect(rows[0]).toMatchObject({
    open: true,
    children: [{ open: true, children: [{ focused: true, units: [1, 2] }] }],
  });
  expect(rows[1]).toMatchObject({ open: false });
});
