// The outline as `pytools/convert.py` writes it, read by the schema: the
// converter's own rules are tested in `pytools/tests/`.

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, test } from "vitest";
import { Outline } from "./source.ts";

const pytools = fileURLToPath(new URL("../../pytools/", import.meta.url));

/** A paragraph of 100 characters, its blank line included. */
const paragraph = (n: number) => `${`Paragraph ${n}`.padEnd(97, " x")}.\n\n`;

const BOOK = `# Phenomenology

Opening words.

## Force and Understanding

${paragraph(1)}${paragraph(2)}${paragraph(3)}### Appearance

Text.
`;

test("the schema reads the outline convert.py writes, every field of it", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gauss-source-"));
  try {
    const original = join(dir, "hegel.md");
    await writeFile(original, BOOK);
    const folder = join(dir, "hegel");
    await promisify(execFile)(join(pytools, ".venv", "bin", "python"), [
      "-I",
      join(pytools, "convert.py"),
      "ingest",
      original,
      folder,
      "--limit",
      "250",
    ]);
    const written = JSON.parse(
      await readFile(join(folder, "outline.json"), "utf8"),
    );

    const outline = Outline.parse(written);

    expect(outline).toEqual(written);
    expect(outline).toMatchObject({
      id: "hegel",
      title: "Phenomenology",
      format: "markdown",
      limit: 250,
    });
    // "Force and Understanding" is 328 characters: two parts, cut at 128.
    expect(outline.entries).toEqual([
      {
        title: "Phenomenology",
        entries: [
          {
            id: "s1",
            title: "Phenomenology",
            size: 33,
            place: { paragraphs: { first: 1, last: 1 } },
          },
          {
            title: "Force and Understanding",
            entries: [
              {
                id: "s2",
                title: "Force and Understanding (part 1 of 2)",
                size: 128,
                place: { paragraphs: { first: 1, last: 1 } },
                part: { number: 1, of: 2 },
              },
              {
                id: "s3",
                title: "Force and Understanding (part 2 of 2)",
                size: 200,
                place: { paragraphs: { first: 2, last: 3 } },
                part: { number: 2, of: 2 },
              },
              {
                id: "s4",
                title: "Appearance",
                size: 22,
                place: { paragraphs: { first: 1, last: 1 } },
              },
            ],
          },
        ],
      },
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// A page with a bookmarked heading and a paragraph, then a page with no text,
// numbered i and ii.
const WRITE_PDF = `
import sys
from reportlab.pdfgen import canvas
c = canvas.Canvas(sys.argv[1], pagesize=(612, 792))
c.setTitle("Paper")
c.bookmarkPage("opening", fit="XYZ", left=0, top=740)
c.addOutlineEntry("Opening", "opening", 0)
c.setFont("Courier-Bold", 14)
c.drawString(72, 720, "Opening")
c.setFont("Courier", 10)
c.drawString(72, 696, "The first page's only paragraph.")
c.showPage()
c.showPage()
c.addPageLabel(0, "ROMAN_LOWER", 1)
c.save()
`;

test("the schema reads a PDF's outline: its pages, and sections placed by page", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gauss-source-"));
  try {
    const python = join(pytools, ".venv", "bin", "python");
    const original = join(dir, "paper.pdf");
    await promisify(execFile)(python, ["-I", "-c", WRITE_PDF, original]);
    const folder = join(dir, "paper");
    await promisify(execFile)(python, [
      "-I",
      join(pytools, "convert.py"),
      "ingest",
      original,
      folder,
    ]);
    const written = JSON.parse(
      await readFile(join(folder, "outline.json"), "utf8"),
    );

    const outline = Outline.parse(written);

    expect(outline).toEqual(written);
    expect(outline).toMatchObject({
      title: "Paper",
      file: "original.pdf",
      format: "pdf",
      pages: { count: 2, labels: ["i", "ii"], blank: [2] },
    });
    // `<!-- page 1 label "i" -->`, the heading, the paragraph, then the
    // second page's marker: 26 + 11 + 34 + 27 characters.
    expect(outline.entries).toEqual([
      {
        id: "s1",
        title: "Opening",
        size: 98,
        place: { pages: { first: 1, last: 2 } },
      },
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// An EPUB 2 with a part holding a chapter, its headings set as bold
// paragraphs, and front matter before the NCX's first entry.
const WRITE_EPUB = `
import sys, zipfile
page = '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>p</title></head><body>{}</body></html>'
with zipfile.ZipFile(sys.argv[1], "w") as book:
    book.writestr("mimetype", "application/epub+zip")
    book.writestr("META-INF/container.xml", '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="content.opf"/></rootfiles></container>')
    book.writestr("front.xhtml", page.format("<p>Front matter.</p>"))
    book.writestr("part.xhtml", page.format("<p><b>Part One</b></p>"))
    book.writestr("ch1.xhtml", page.format("<p><b>Chapter 1</b></p><p>Its text.</p>"))
    book.writestr("toc.ncx", '<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"><navMap><navPoint><navLabel><text>Part One</text></navLabel><content src="part.xhtml"/><navPoint><navLabel><text>Chapter 1</text></navLabel><content src="ch1.xhtml"/></navPoint></navPoint></navMap></ncx>')
    items = "".join(f'<item id="{n}" href="{n}.xhtml" media-type="application/xhtml+xml"/>' for n in ("front", "part", "ch1"))
    book.writestr("content.opf", '<package xmlns="http://www.idpf.org/2007/opf" version="2.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Book</dc:title></metadata><manifest>' + items + '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/></manifest><spine toc="ncx"><itemref idref="front"/><itemref idref="part"/><itemref idref="ch1"/></spine></package>')
`;

test("the schema reads an EPUB's outline: its contents' entries, and sections placed by paragraph", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gauss-source-"));
  try {
    const python = join(pytools, ".venv", "bin", "python");
    const original = join(dir, "book.epub");
    await promisify(execFile)(python, ["-I", "-c", WRITE_EPUB, original]);
    const folder = join(dir, "book");
    await promisify(execFile)(python, [
      "-I",
      join(pytools, "convert.py"),
      "ingest",
      original,
      folder,
    ]);
    const written = JSON.parse(
      await readFile(join(folder, "outline.json"), "utf8"),
    );

    const outline = Outline.parse(written);

    expect(outline).toEqual(written);
    expect(outline).toMatchObject({
      title: "Book",
      file: "original.epub",
      format: "epub",
    });
    expect(outline.pages).toBeUndefined();
    // "Front matter.\n\n", then "# Part One\n\n## Chapter 1\n\nIts text.\n":
    // the part has no text of its own, so its heading is in the chapter's file.
    expect(outline.entries).toEqual([
      {
        id: "s1",
        title: "Book",
        size: 15,
        place: { paragraphs: { first: 1, last: 1 } },
      },
      {
        title: "Part One",
        entries: [
          {
            id: "s2",
            title: "Chapter 1",
            size: 36,
            place: { paragraphs: { first: 1, last: 1 } },
          },
        ],
      },
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the outline rejects ambiguous entries and places instead of stripping fields", () => {
  const section = {
    id: "s1",
    title: "Opening",
    size: 10,
    place: { paragraphs: { first: 1, last: 1 } },
  };
  const source = {
    id: "notes",
    title: "Notes",
    file: "original.md",
    name: "notes.md",
    format: "markdown",
    sha256: "0".repeat(64),
    converter: 1,
    limit: 20000,
  };
  for (const hybrid of [
    { ...section, entries: [] },
    { ...section, size: 0, entries: [] },
    {
      ...section,
      place: { ...section.place, pages: { first: 1, last: 1 } },
    },
  ]) {
    expect(Outline.safeParse({ ...source, entries: [hybrid] }).success).toBe(
      false,
    );
  }
});
