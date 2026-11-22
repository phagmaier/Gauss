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
