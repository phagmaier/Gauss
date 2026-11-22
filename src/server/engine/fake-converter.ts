// A converter for tests, which runs no command (task 4.6): it writes a
// source's folder as `convert.py ingest` would for a Markdown file whose
// first line is `# <title>`, one section holding the whole text, and
// refuses any other file as the converter refuses a format it does not
// read. And an upload of a text, as the route passes one on.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { Outline } from "../../shared/source.ts";
import type { Upload } from "./intake-sources.ts";
import type { Conversion, SourceConverter } from "./source-convert.ts";

/**
 * The converter. `result` stands in for a conversion that does not convert;
 * `hold` keeps it converting until it resolves.
 */
export function fakeConverter(
  options: { result?: Conversion; hold?: Promise<void> } = {},
): SourceConverter {
  return {
    unavailable: undefined,
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
