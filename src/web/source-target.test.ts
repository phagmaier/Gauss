import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { type Outline, sectionsByRef } from "../shared/source.ts";
import { Prose, SourceLinks } from "./prose.tsx";
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

test("the thread renders an actionable section link but leaves an unknown section's words alone", () => {
  const text =
    "[the *passage*](source:lectures/s2/pi) or [the **missing** one](source:lectures/s9)";
  const html = renderToStaticMarkup(
    createElement(
      SourceLinks.Provider,
      { value: { sections, open() {} } },
      createElement(Prose, { text }),
    ),
  );
  expect(html).toContain(
    'title="Afterword, p. i">the <em>passage</em></button> or the <strong>missing</strong> one',
  );
  expect(html).not.toContain("source:");
});
