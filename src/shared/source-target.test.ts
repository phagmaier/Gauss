import { expect, test } from "vitest";
import { type Outline, sectionsByRef } from "./source.ts";
import { resolveSourceLink } from "./source-target.ts";

const source: Outline = {
  id: "lectures",
  title: "Lectures",
  name: "lectures.pdf",
  file: "original.pdf",
  format: "pdf",
  sha256: "0".repeat(64),
  converter: 6,
  limit: 20_000,
  pages: { count: 3, labels: ["1", "i", "1"], blank: [] },
  entries: [
    {
      id: "s2",
      title: "Afterword",
      size: 50,
      place: { pages: { first: 2, last: 3 } },
    },
  ],
};
const sections = sectionsByRef([source]);

test("a section link names its section and place, without claiming a quote", () => {
  expect(resolveSourceLink("source:lectures/s2", sections)).toEqual({
    title: "Afterword, pp. i–1",
    target: { kind: "section", source: "lectures", section: "s2", light: true },
  });
});

test("a printed page is resolved inside the named section, not from the start of the PDF", () => {
  expect(resolveSourceLink("source:lectures/s2/p1", sections)).toEqual({
    title: "Afterword, p. 1",
    target: {
      kind: "section",
      source: "lectures",
      section: "s2",
      page: 3,
      light: true,
    },
  });
});

test.each([
  "source:other/s2",
  "source:lectures/s1",
  "source:lectures/s2/p3",
  "source:lectures/s2/p%ff",
])("no destination for %s", (url) => {
  expect(resolveSourceLink(url, sections)).toBeUndefined();
});
