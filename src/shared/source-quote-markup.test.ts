import { expect, test } from "vitest";
import { markdownQuoteMarkup } from "./source-quote-markup.ts";

function visible(text: string, hidden: Uint8Array): string {
  let result = "";
  for (let i = 0; i < text.length; i++) {
    if (hidden[i] === 0) result += text.charAt(i);
  }
  return result;
}

test("parsed formatting masks link labels' delimiters, list and quote markers but not code or lazy literal markers", () => {
  const text = [
    "# A [visible title](https://example.com)",
    "",
    "> - **😀 formatted",
    ">   continuation** `\\* [^inline]`",
    ">   next\\",
    ">   line",
    "",
    "> ```lang info",
    "> > literal code \\* [^fenced]",
    "> ```",
    "",
    "> A lazy paragraph",
    "    > this marker is printed",
  ].join("\n");
  const hidden = new Uint8Array(text.length);
  const { breaks, headings } = markdownQuoteMarkup(
    text,
    "markdown",
    hidden,
    true,
  );
  expect(
    visible(text, hidden)
      .split("\n")
      .map((line) => line.trim()),
  ).toEqual([
    "A visible title",
    "",
    "😀 formatted",
    "continuation \\* [^inline]",
    "next",
    "line",
    "",
    "",
    "> literal code \\* [^fenced]",
    "",
    "",
    "A lazy paragraph",
    "> this marker is printed",
  ]);
  expect([...breaks]).toEqual([text.indexOf("\\\n") + 1]);
  expect(headings).toEqual([
    { start: 0, end: text.indexOf("\n"), title: "A visible title" },
  ]);
});

test("EPUB masks emitted note marks and escapement, not the book's literal punctuation", () => {
  const text = [
    "One a*b at \\*star\\* and \\[^x].",
    'After[^orphan] the verse, read \\<!-- page 8 label "printed" -->.',
    "",
    "[^note]: The note's words.",
  ].join("\n");
  const hidden = new Uint8Array(text.length);
  markdownQuoteMarkup(text, "epub", hidden);
  expect(visible(text, hidden)).toBe(
    "One a*b at *star* and [^x].\n" +
      'After the verse, read <!-- page 8 label "printed" -->.\n\n' +
      " The note's words.",
  );
});

test("a copied passage can mix formatting with printed tags and apostrophes", () => {
  const text = "Here's [quoted prose](reference) with a printed <tag>.";
  const hidden = new Uint8Array(text.length);
  markdownQuoteMarkup(text, "quote", hidden);
  expect(visible(text, hidden)).toBe(
    "Here's quoted prose with a printed <tag>.",
  );
});
