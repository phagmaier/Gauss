// A converter for tests, which runs no command (task 4.6): it writes a
// source's folder as `convert.py ingest` would for a Markdown file whose
// first line is `# <title>`, one section holding the whole text, and
// refuses any other file as the converter refuses a format it does not
// read; and renders a page (task 4.8) as a small PNG of its own. And an
// upload of a text, as the route passes one on; and a source put straight in
// a course, from an outline and its sections' texts.

import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { Outline } from "../../shared/source.ts";
import type { DataRoot } from "../record/data-root.ts";
import type { Upload } from "./intake-sources.ts";
import type {
  Conversion,
  Rendering,
  SourceConverter,
} from "./source-convert.ts";

/**
 * Puts a source in the course, as conversion and placement would: this
 * outline, under the id the record gives it, a slug of its title, and each
 * section's text by its id. `root` is the data root's folder, where the
 * source is written first, as a scratch folder would be.
 */
export async function placeTestSource(
  dataRoot: DataRoot,
  root: string,
  courseId: string,
  outline: Outline,
  texts: Readonly<Record<string, string>>,
): Promise<Outline> {
  const folder = await mkdtemp(join(root, ".test-source-"));
  await mkdir(join(folder, "sections"));
  for (const [id, text] of Object.entries(texts)) {
    await writeFile(join(folder, "sections", `${id}.md`), text);
  }
  await writeFile(join(folder, "outline.json"), JSON.stringify(outline));
  return dataRoot.placeSource(folder, { course: courseId });
}

/**
 * The converter. `result` stands in for a conversion that does not convert;
 * `hold` keeps it converting until it resolves; `rendering` stands in for a
 * page render that does not render. `renders` lists the pages rendered, in
 * order.
 */
export function fakeConverter(
  options: {
    result?: Conversion;
    hold?: Promise<void>;
    rendering?: Rendering;
  } = {},
): SourceConverter & { renders: number[] } {
  const renders: number[] = [];
  return {
    unavailable: undefined,
    renders,
    async renderPage(_original, page, png) {
      if (options.rendering !== undefined) {
        await writeFile(png, "partial output");
        return options.rendering;
      }
      renders.push(page);
      await writeFile(png, fakePage(page));
      return { result: "rendered" };
    },
    async convert(original, folder) {
      await options.hold;
      if (options.result !== undefined) return options.result;
      if (!original.endsWith(".md")) {
        return {
          result: "refused",
          reason: "format",
          detail:
            "Only PDF, EPUB, .txt, .md and .markdown files are supported.",
        };
      }
      const text = await readFile(original, "utf8");
      const title = text.split("\n")[0]?.replace(/^# /, "") ?? "Untitled";
      const outline: Outline = {
        id: basename(folder),
        title,
        file: "original.md",
        name: basename(original),
        format: "markdown",
        sha256: "0".repeat(64),
        converter: 5,
        limit: 20_000,
        entries: [
          {
            title,
            entries: [
              {
                id: "s1",
                title,
                size: [...text].length,
                place: { paragraphs: { first: 1, last: 2 } },
              },
            ],
          },
        ],
      };
      await mkdir(join(folder, "sections"));
      await writeFile(join(folder, "sections", "s1.md"), text);
      await writeFile(join(folder, "original.md"), text);
      await writeFile(join(folder, "outline.json"), JSON.stringify(outline));
      return { result: "converted" };
    },
  };
}

/** The image the fake converter renders of a page. */
export function fakePage(page: number): Buffer {
  const base64 =
    page % 3 === 1
      ? "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC"
      : "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYGAAAAAEAAH2FzhVAAAAAElFTkSuQmCC";
  return Buffer.from(base64, "base64");
}

/** The text as a file the learner attached, its size stated unless given. */
export function upload(name: string, text: string, size?: number): Upload {
  const bytes = Buffer.from(text);
  return {
    name,
    size: size ?? bytes.byteLength,
    body: (async function* () {
      yield bytes;
    })(),
  };
}
