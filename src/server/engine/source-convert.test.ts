// Source conversion as the engine runs it: `pytools/convert.py` in the real
// sandbox, so these tests need what the sandbox needs (on Linux `bwrap`,
// `socat` and `rg`) and fail, rather than skip, where it cannot run. The
// original lies inside the data root, which the sandbox closes to reads
// unless the command names its folder. `pytools/tests/` covers the
// converter's own rules.

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { Outline } from "../../shared/source.ts";
import { type Sandbox, startSandbox } from "./sandbox.ts";
import { createSourceConverter } from "./source-convert.ts";

let sandbox: Extract<Sandbox, { available: true }>;
/** The data root the sandbox closes to reads. */
let root: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "gauss-convert-"));
  const started = await startSandbox({ log: () => {}, dataRoot: root });
  if (!started.available) {
    throw new Error(`These tests need the sandbox: ${started.reason}`);
  }
  sandbox = started;
});
afterAll(async () => {
  await sandbox?.close();
  await rm(root, { recursive: true, force: true });
});

/** An original in a folder of its own inside the data root, and an empty folder to convert into. */
async function place(name: string, contents: string) {
  const scratch = await mkdtemp(join(root, "scratch-"));
  await mkdir(join(scratch, "original"));
  const original = join(scratch, "original", name);
  await writeFile(original, contents);
  const folder = join(scratch, "source");
  await mkdir(folder);
  return { original, folder };
}

test("a Markdown title larger than the sandbox output limit is preserved in the source's files", async () => {
  const title = "A".repeat(70 * 1024);
  const { original, folder } = await place(
    "notes.md",
    `# ${title}\n\nOne paragraph.\n\nSecond paragraph.\n\n## Part\n\nAnother.\n`,
  );

  expect(
    await createSourceConverter({ sandbox }).convert(original, folder),
  ).toEqual({ result: "converted" });
  const outline = Outline.parse(
    JSON.parse(await readFile(join(folder, "outline.json"), "utf8")),
  );
  expect(outline).toMatchObject({
    id: "source",
    title,
    name: "notes.md",
    format: "markdown",
  });
  expect(await readFile(join(folder, "sections", "s1.md"), "utf8")).toBe(
    `# ${title}\n\nOne paragraph.\n\n`,
  );
  expect(await readFile(join(folder, "sections", "s2.md"), "utf8")).toBe(
    "Second paragraph.\n\n",
  );
  expect(await readFile(join(folder, "sections", "s3.md"), "utf8")).toBe(
    "## Part\n\nAnother.\n",
  );
});

test("a file that is no source is refused with the converter's reason", async () => {
  const { original, folder } = await place("seminar.rtf", "{\\rtf1 notes}");

  expect(
    await createSourceConverter({ sandbox }).convert(original, folder),
  ).toEqual({
    result: "refused",
    reason: "format",
    detail: "Only PDF, EPUB, .txt, .md and .markdown files are supported.",
  });
});

test("a run the converter cannot carry out fails with its last line", async () => {
  const { original, folder } = await place("notes.md", "# Notes\n\nText.\n");
  await writeFile(join(folder, "left-over"), "");

  const failed = await createSourceConverter({ sandbox }).convert(
    original,
    folder,
  );

  expect(failed).toEqual({
    result: "failed",
    reason: `it stopped with exit status 2: convert.py: the folder ${folder} is not empty`,
  });
});

test("a conversion past its time limit is stopped", async () => {
  const { original, folder } = await place("notes.md", "# Notes\n\nText.\n");

  expect(
    await createSourceConverter({ sandbox, timeLimitMs: 20 }).convert(
      original,
      folder,
    ),
  ).toEqual({ result: "timed-out", limit: "20 ms" });
});

/** A PDF of one blank page an inch square, with its cross-reference table's offsets right. */
function onePagePdf(): string {
  const bodies = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 72 72] >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = bodies.map((body, i) => {
    const at = pdf.length;
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return at;
  });
  const xref = pdf.length;
  return (
    `${pdf}xref\n0 ${bodies.length + 1}\n0000000000 65535 f \n` +
    offsets.map((at) => `${String(at).padStart(10, "0")} 00000 n \n`).join("") +
    `trailer\n<< /Size ${bodies.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  );
}

test("a PDF's page renders as a PNG image into the file given; a page the PDF lacks fails", async () => {
  const source = await mkdtemp(join(root, "source-"));
  const original = join(source, "original.pdf");
  await writeFile(original, onePagePdf());
  const pages = join(source, "pages");
  await mkdir(pages);
  const converter = createSourceConverter({ sandbox });

  expect(await converter.renderPage(original, 1, join(pages, "1.png"))).toEqual(
    { result: "rendered" },
  );
  const png = await readFile(join(pages, "1.png"));
  expect(png.subarray(0, 8)).toEqual(
    Buffer.from("\x89PNG\r\n\x1a\n", "latin1"),
  );
  // 72 points at 150 dpi.
  expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([150, 150]);

  expect(await converter.renderPage(original, 2, join(pages, "2.png"))).toEqual(
    {
      result: "failed",
      reason:
        "it stopped with exit status 2: convert.py: the PDF has 1 pages, not a page 2",
    },
  );
});

test("without the sandbox, the converter says why it cannot convert", () => {
  const converter = createSourceConverter({
    sandbox: {
      available: false,
      reason: "bwrap is missing",
      close: async () => {},
    },
  });

  expect(converter.unavailable).toBe("bwrap is missing");
});
