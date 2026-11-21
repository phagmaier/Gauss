// An EPUB's section as `pytools/convert.py` writes it, read by remark-gfm,
// the page's Markdown parser. The converter's own tests read with
// markdown-it, which knows CommonMark but not all that GFM reads as syntax:
// text between single tildes, an address in angle brackets, a table's rule,
// a footnote.

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { expect, test } from "vitest";
import type { MdNode } from "./display-math-lines.ts";

const pytools = fileURLToPath(new URL("../../pytools/", import.meta.url));
const python = join(pytools, ".venv", "bin", "python");

// An EPUB 2 of one document for each body given, each an entry "T" of its NCX.
const WRITE_EPUB = `
import json, sys, zipfile
bodies = json.loads(sys.argv[2])
page = '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>p</title></head><body>{}</body></html>'
with zipfile.ZipFile(sys.argv[1], "w") as book:
    book.writestr("mimetype", "application/epub+zip")
    book.writestr("META-INF/container.xml", '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="content.opf"/></rootfiles></container>')
    for n, body in enumerate(bodies):
        book.writestr(f"d{n}.xhtml", page.format(body))
    points = "".join(f'<navPoint><navLabel><text>T</text></navLabel><content src="d{n}.xhtml"/></navPoint>' for n in range(len(bodies)))
    book.writestr("toc.ncx", '<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"><navMap>' + points + '</navMap></ncx>')
    items = "".join(f'<item id="d{n}" href="d{n}.xhtml" media-type="application/xhtml+xml"/>' for n in range(len(bodies)))
    refs = "".join(f'<itemref idref="d{n}"/>' for n in range(len(bodies)))
    book.writestr("content.opf", '<package xmlns="http://www.idpf.org/2007/opf" version="2.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Book</dc:title></metadata><manifest>' + items + '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/></manifest><spine toc="ncx">' + refs + '</spine></package>')
`;

/** The Markdown the converter writes for each body, without its heading. */
async function written(bodies: string[]): Promise<string[]> {
  const dir = await mkdtemp(join(tmpdir(), "gauss-source-"));
  try {
    const original = join(dir, "book.epub");
    const folder = join(dir, "book");
    const run = promisify(execFile);
    await run(python, [
      "-I",
      "-c",
      WRITE_EPUB,
      original,
      JSON.stringify(bodies),
    ]);
    await run(python, [
      "-I",
      join(pytools, "convert.py"),
      "ingest",
      original,
      folder,
    ]);
    return await Promise.all(
      bodies.map(async (_, n) => {
        const text = await readFile(
          join(folder, "sections", `s${n + 1}.md`),
          "utf8",
        );
        expect(text.startsWith("# T\n\n")).toBe(true);
        return text.slice("# T\n\n".length);
      }),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const parser = unified().use(remarkParse).use(remarkGfm);
const parse = (markdown: string) => parser.parse(markdown) as MdNode;

/** What a node was read as: its text, and the kinds of node that is in. */
function read(tree: MdNode) {
  const kinds = new Set<string>();
  function text(node: MdNode): string {
    if (node.type !== "root") kinds.add(node.type);
    if (node.type === "break") return "\n";
    return node.value ?? (node.children ?? []).map(text).join("");
  }
  return { text: text(tree), kinds: [...kinds].sort() };
}

test("remark-gfm reads an EPUB's own characters as text, not as GFM's syntax", async () => {
  const plain = ["paragraph", "text"];
  const cases = [
    {
      body: "<p>~once~ H~2~O ~~gone~~ ~~~</p>",
      text: "~once~ H~2~O ~~gone~~ ~~~",
      kinds: plain,
    },
    // GFM links a bare address wherever it is; the brackets around it stay.
    {
      body: "<p>&lt;123@example.com&gt; and &lt;b&gt;</p>",
      text: "<123@example.com> and <b>",
      kinds: ["link", ...plain],
    },
    {
      body: "<p>a | b<br/>--- | ---</p>",
      text: "a | b\n--- | ---",
      kinds: ["break", ...plain],
    },
    { body: "<p>[^x] is literal</p>", text: "[^x] is literal", kinds: plain },
    { body: "<p>[^x]: So is this</p>", text: "[^x]: So is this", kinds: plain },
  ];

  const sections = await written(cases.map((c) => c.body));

  expect(sections.map((section) => read(parse(section)))).toEqual(
    cases.map(({ text, kinds }) => ({ text, kinds })),
  );
});

test("remark-gfm reads a note of two paragraphs as one definition, whichever of them a reference points to", async () => {
  const [section] = await written([
    '<p>Once<a epub:type="noteref" href="#n">1</a>; again<a epub:type="noteref" href="#later">1</a>.</p>' +
      '<aside epub:type="footnote" id="n"><p>The note.</p><p id="later">Its second paragraph.</p></aside>',
  ]);

  const blocks = parse(section ?? "").children ?? [];

  expect(blocks.map((block) => block.type)).toEqual([
    "paragraph",
    "footnoteDefinition",
  ]);
  expect(
    blocks[0]?.children?.filter((node) => node.type === "footnoteReference"),
  ).toHaveLength(2);
  expect(blocks[1]?.children?.map((block) => read(block))).toEqual([
    { text: "The note.", kinds: ["paragraph", "text"] },
    { text: "Its second paragraph.", kinds: ["paragraph", "text"] },
  ]);
});
