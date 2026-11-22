import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import type { Outline, OutlineSection } from "../shared/source.ts";
import { orderedSections } from "../shared/source-quote.ts";
import { SourcePane } from "./SourcePane.tsx";
import { SourceText } from "./SourceText.tsx";
import {
  keptTexts,
  openSection,
  outlineRows,
  type ReaderPart,
} from "./source-reader.ts";

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

test("a display equation keeps its paragraph's number in the margin and its own TeX", async () => {
  const text =
    "# Integrals\n\nThe area is a triangle.\n\n$$\n\\int_0^1 x\\,dx\n$$\n\nSo it is one half.\n";
  const source = book(
    [
      {
        ...section("s1"),
        headings: [{ start: 0, end: 12, title: "Integrals" }],
        place: { paragraphs: { first: 1, last: 3 } },
        paragraphStarts: [text.indexOf("$$"), text.indexOf("So it")],
      },
    ],
    "markdown",
  );
  const html = render((await open(source, { s1: text }, "s1"))[0]);
  expect(
    [...html.matchAll(/class="reader-rail"><span>(¶ \d)</g)].map((m) => m[1]),
  ).toEqual(["¶ 1", "¶ 2", "¶ 3"]);
  expect(html).toContain(
    '<annotation encoding="application/x-tex">\\int_0^1 x\\,dx</annotation>',
  );
});

test("a PDF's text keeps the characters Markdown would read as emphasis, code, math or links", async () => {
  const source = {
    ...book(
      [{ ...section("s1"), place: { pages: { first: 1, last: 1 } } }],
      "pdf",
    ),
    pages: { count: 1, blank: [] },
  };
  // As `convert.py` writes a PDF: a heading, a note after its paragraph, and
  // a backslash only before a paragraph's leading `#` and a printed marker.
  const text =
    "<!-- page 1 -->\n# Costs and Code\n\n" +
    "A ticket costs $5 for children and $10 for adults.[^1] Call __init__ on *starred* `terms`, or write to a@b.example.\n\n" +
    "[^1]: Twice ~~that~~ abroad.\n\n" +
    "\\# is no heading and \\<!-- page 9 --> no page; a\\*b &amp; c stays as printed.\n";
  const html = render((await open(source, { s1: text }, "s1"))[0]);
  expect(html).toContain("Costs and Code</h1>");
  expect(html).toContain("A ticket costs $5 for children and $10 for adults.");
  expect(html).toContain(
    "Call __init__ on *starred* `terms`, or write to a@b.example.",
  );
  expect(html).toContain("data-footnote-ref");
  expect(html).toContain("Twice ~~that~~ abroad.");
  expect(html).toContain(
    "# is no heading and &lt;!-- page 9 --&gt; no page; a\\*b &amp;amp; c stays as printed.",
  );
  expect(html).not.toMatch(/katex|<strong>|<em>|<code>|<del>|mailto:/);
  expect(
    render(
      (await open(source, { s1: text }, "s1", "Call __init__ on *starred*"))[0],
    ),
  ).toContain("<mark>Call __init__ on *starred*</mark>");
});

test("unresolved PDF references show the printed marks without inventing a link", async () => {
  const source = {
    ...book(
      [{ ...section("s1"), place: { pages: { first: 1, last: 1 } } }],
      "pdf",
    ),
    converter: 9,
    pages: { count: 1, blank: [] },
  };
  const text =
    "<!-- page 1 -->\nThe printed marker [\\^1] is literal. First[^1], repeated[^1-2], another[^dagger], and one more[^٢].";
  const html = render((await open(source, { s1: text }, "s1"))[0]);
  expect(html).toContain(
    "The printed marker [^1] is literal. First<sup>1</sup>, repeated<sup>1</sup>, another<sup>†</sup>, and one more<sup>٢</sup>.",
  );
  expect(html).not.toContain("href=");
  const quoted = await open(
    source,
    { s1: text },
    "s1",
    "The printed marker [^1] is literal.",
  );
  expect(render(quoted[0])).toContain(
    "<mark>The printed marker [^1] is literal.</mark>",
  );
});

test("the page reader separates a printed label from the position in the PDF", () => {
  const source: Outline = {
    ...book([], "pdf"),
    pages: { count: 543, blank: [], labels: [...Array(74).fill(""), "57"] },
  };
  const renderPage = (page: number) =>
    renderToStaticMarkup(
      createElement(SourcePane, {
        base: "/sources",
        source,
        target: { kind: "page", source: source.id, page },
        onClose() {},
      }),
    );
  expect(renderPage(75)).toContain("Page 57 · PDF page 75 of 543");
  expect(renderPage(76)).toContain("Page 76 of 543");
});

test("dollar signs are math in a Markdown source and money in an EPUB", async () => {
  const texts = { s1: "It costs $5 here and $10 there.\n" };
  const html = (format: Outline["format"]) =>
    open(book([section("s1")], format), texts, "s1").then(([part]) =>
      render(part),
    );
  expect(await html("markdown")).toContain("katex");
  const epub = await html("epub");
  expect(epub).toContain("It costs $5 here and $10 there.");
  expect(epub).not.toContain("katex");
});

test("a Markdown source's link opens the web; one into its own file or folder is its words", async () => {
  const text =
    "See [the site](https://example.com/a), [a neighbour](other.md) and [the top](#top).\n";
  const html = render(
    (await open(book([section("s1")], "markdown"), { s1: text }, "s1"))[0],
  );
  expect(html).toContain('href="https://example.com/a"');
  expect(html).toContain("the site</a>, a neighbour and the top.");
  expect(html.match(/<a /g)).toHaveLength(1);
});

test("a quoted line that is only a number is marked with the lines around it", async () => {
  const texts = { s1: "In the year\\\n12\\\nthe sum was known.\n" };
  const html = render(
    (
      await open(book([section("s1")]), texts, "s1", "In the year\n12\nthe sum")
    )[0],
  );
  const marked = [...html.matchAll(/<mark>(.*?)<\/mark>/gs)].map((m) => m[1]);
  expect(marked).toEqual(["In the year", "12", "the sum"]);
});

test("a quote that cannot be found reads no further than its words could reach", async () => {
  const source = book(
    ["s1", "s2", "s3", "s4", "s5", "s6"].map((id) => section(id)),
  );
  const read: string[] = [];
  const parts = await openSection(
    source,
    orderedSections(source),
    "s1",
    "words never written",
    async (id) => {
      read.push(id);
      return `Section ${id} holds a sentence of its own.\n\n`;
    },
  );
  expect(read).toEqual(["s1", "s2"]);
  expect(parts.map((part) => [part.id, part.mark])).toEqual([
    ["s1", undefined],
  ]);
});

test("a section's text is fetched once while the pane stays on its source, and again after a failure", async () => {
  const asked: string[] = [];
  let failing = true;
  const load = keptTexts(async (id) => {
    asked.push(id);
    if (id === "s2" && failing) {
      failing = false;
      throw new Error("503 Service Unavailable");
    }
    return `The text of ${id}.`;
  });
  const { signal } = new AbortController();
  expect(await load("s1", signal)).toBe("The text of s1.");
  expect(await load("s1", signal)).toBe("The text of s1.");
  await expect(load("s2", signal)).rejects.toThrow("503");
  expect(await load("s2", signal)).toBe("The text of s2.");
  expect(asked).toEqual(["s1", "s2", "s2"]);
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
