// The outline as `pytools/convert.py` writes it, read by the schema: the
// converter's own rules are tested in `pytools/tests/test_convert.py`.

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
