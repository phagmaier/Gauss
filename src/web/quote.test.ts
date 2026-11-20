// @vitest-environment happy-dom

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test } from "vitest";
import { messageParts, withQuote } from "../shared/quote.ts";
import { Prose } from "./prose.tsx";
import { passageSource, quotableRange } from "./quote.ts";

/** The tutor's text as the thread shows it: Markdown set by `Prose`, with KaTeX. */
function tutorText(markdown: string): string {
  return `<div class="th-tutor prose">${renderToStaticMarkup(createElement(Prose, { text: markdown }))}</div>`;
}

/** The text node holding `text`, under `root`. */
function textNode(root: Node, text: string): Text {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (node.nodeValue?.includes(text)) return node as Text;
  }
  throw new Error(`no text node holds ${text}`);
}

/** A point inside the formula's drawn text, where a mouse selection lands. */
function inFormula(formula: Element, drawn: string): [Text, number] {
  const html = formula.querySelector(".katex-html");
  if (html === null) throw new Error("no drawn formula");
  return [textNode(html, drawn), 0];
}

const LESSON = [
  "Let $f(x) = x^2$ on $[0, 1]$. Its integral is",
  "",
  "$$",
  "\\int_0^1 x^2 \\, dx = \\frac{1}{3}",
  "$$",
  "",
  "which is the area under the curve.",
].join("\n");

beforeEach(() => {
  document.body.innerHTML = "";
});

test("a selection across inline and display math gives the math's source", () => {
  document.body.innerHTML = tutorText(LESSON);
  const [inline] = document.querySelectorAll(".katex");
  const display = document.querySelector(".katex-display");
  if (inline === undefined || display === null) throw new Error("no math");

  // From inside "Let" to inside the display formula's drawn text: the
  // formula the selection ends in comes whole.
  const range = document.createRange();
  range.setStart(textNode(document.body, "Let"), 1);
  range.setEnd(...inFormula(display, "∫"));
  expect(passageSource(range)).toBe(
    [
      "et $f(x) = x^2$ on $[0, 1]$. Its integral is",
      "",
      "$$\\int_0^1 x^2 \\, dx = \\frac{1}{3}$$",
    ].join("\n"),
  );

  // From inside the inline formula to the end of the last paragraph.
  range.setStart(...inFormula(inline, "f"));
  const last = textNode(document.body, "which is the area");
  range.setEnd(last, last.length);
  expect(passageSource(range)).toBe(
    [
      "$f(x) = x^2$ on $[0, 1]$. Its integral is",
      "",
      "$$\\int_0^1 x^2 \\, dx = \\frac{1}{3}$$",
      "",
      "which is the area under the curve.",
    ].join("\n"),
  );

  // Ending inside a formula's MathML, before its drawn text, still takes it whole.
  range.setStart(textNode(document.body, "Let"), 0);
  const annotation = inline.querySelector("annotation")?.firstChild;
  if (annotation == null) throw new Error("no annotation");
  range.setEnd(annotation, 3);
  expect(passageSource(range)).toBe("Let $f(x) = x^2$");
});

test("lists, code, a table, a formula on its own line and one that failed keep their shape", () => {
  document.body.innerHTML = tutorText(
    [
      "Two steps:",
      "",
      "- read `tool_use_id`",
      "- set $\\bad{$ aside",
      "",
      "```",
      "x = 1",
      "  y = 2",
      "```",
      "",
      "| x | y |",
      "|---|---|",
      "| 1 | 2 |",
      "",
      "So",
      "$$g(x)$$",
      "holds.",
      "",
      "Done.",
    ].join("\n"),
  );
  const range = document.createRange();
  range.setStart(textNode(document.body, "Two steps"), 0);
  const done = textNode(document.body, "Done.");
  range.setEnd(done, done.length);
  expect(passageSource(range)).toBe(
    [
      "Two steps:",
      "",
      "- read `tool_use_id`",
      "- set $\\bad{$ aside",
      "",
      "```",
      "x = 1",
      "  y = 2",
      "```",
      "",
      "x y",
      "1 2",
      "",
      "So",
      "$$g(x)$$",
      "holds.",
      "",
      "Done.",
    ].join("\n"),
  );
});

test("only a selection within one tutor's text or prompt can be quoted", () => {
  document.body.innerHTML = [
    tutorText("The chain rule."),
    '<div class="th-you">Why?</div>',
    `<div class="qa-prompt prose">${renderToStaticMarkup(createElement(Prose, { text: "Differentiate $\\sin(x^2)$." }))}</div>`,
  ].join("");
  const selection = document.getSelection();
  if (selection === null) throw new Error("no selection");
  const select = (from: [Node, number], to: [Node, number]) => {
    const range = document.createRange();
    range.setStart(...from);
    range.setEnd(...to);
    selection.removeAllRanges();
    selection.addRange(range);
    return quotableRange(selection);
  };
  const chain = textNode(document.body, "The chain rule.");
  const why = textNode(document.body, "Why?");
  const prompt = textNode(document.body, "Differentiate");

  expect(select([chain, 4], [chain, 9])).toBeDefined();
  expect(select([prompt, 0], [prompt, 13])).toBeDefined();
  expect(select([why, 0], [why, 3])).toBeUndefined();
  expect(select([chain, 4], [prompt, 5])).toBeUndefined();
  expect(select([chain, 3], [chain, 4])).toBeUndefined();
});

test("a quote goes after the draft, each line marked, then a blank line", () => {
  const passage = "Its integral is\n\n$$\\frac{1}{3}$$";
  const quoted = "> Its integral is\n>\n> $$\\frac{1}{3}$$\n\n";
  expect(withQuote("", passage)).toBe(quoted);
  expect(withQuote("Two questions.  \n\n", passage)).toBe(
    `Two questions.\n\n${quoted}`,
  );
});

test("a message is split into its quotes and the learner's own text", () => {
  expect(
    messageParts(
      "Two questions.\n\n> Its integral is\n>\n> $$\\frac{1}{3}$$\n\nWhy a third?\n> again",
    ),
  ).toEqual([
    { quote: false, text: "Two questions." },
    { quote: true, text: "Its integral is\n\n$$\\frac{1}{3}$$" },
    { quote: false, text: "Why a third?" },
    { quote: true, text: "again" },
  ]);
  expect(messageParts("  a > b\n\nplain  ")).toEqual([
    { quote: false, text: "  a > b\n\nplain  " },
  ]);
});
