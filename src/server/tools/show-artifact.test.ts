import { expect, test } from "vitest";
import type { ArtifactInput } from "../../shared/artifact.ts";
import { showArtifactTool } from "./show-artifact.ts";

/** A shelf that shows everything, numbering from 1, or refuses everything with this reason. */
function setUp(refusal?: string) {
  const shown: ArtifactInput[] = [];
  const tool = showArtifactTool({
    async show(artifact) {
      if (refusal !== undefined) return { refused: refusal };
      shown.push(artifact);
      return { number: shown.length, file: `${shown.length}-x.html` };
    },
  });
  return { shown, tool };
}

const GRAPH = `<!doctype html>
<svg viewBox="0 0 10 10"><path d="M0 10L10 0"/></svg>
<script>
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
</script>`;

test("an artifact is shown, and the tutor's turn goes on", async () => {
  const { shown, tool } = setUp();

  expect(await tool.run({ title: " A line ", html: GRAPH })).toEqual({
    status: "done",
    text:
      'Shown beside the conversation as artifact 1, "A line". The learner ' +
      "can close it and open it again from its place in the conversation. " +
      "Go on with your reply.",
  });
  expect(shown).toEqual([{ title: "A line", html: GRAPH }]);
});

test("the shelf's refusal reaches the tutor", async () => {
  const { tool } = setUp("Question 2 is open.");

  expect(await tool.run({ title: "A line", html: GRAPH })).toEqual({
    status: "refused",
    text: "Question 2 is open.",
  });
});

test("a document over 100 KB of UTF-8 is refused with its size, and one of 100 KB is shown", async () => {
  const { shown, tool } = setUp();
  // "²" takes two bytes: 50,000 of them are 100,000 bytes.
  const atLimit = "²".repeat(50_000);

  expect((await tool.run({ title: "Full", html: atLimit })).status).toBe(
    "done",
  );
  expect(await tool.run({ title: "Over", html: `${atLimit}x` })).toEqual({
    status: "refused",
    text:
      "The document is 101 KB, over the limit of 100 KB. Make it smaller: " +
      "fewer points drawn, and nothing the aid does not need.",
  });
  expect(shown.map((a) => a.title)).toEqual(["Full"]);
});

test.each([
  {
    name: "a script from a CDN",
    html: '<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>',
    named: "https://cdn.jsdelivr.net/npm/chart.js",
  },
  {
    name: "a stylesheet with no scheme",
    html: "<link rel=stylesheet href=//fonts.googleapis.com/css2?family=X>",
    named: "//fonts.googleapis.com/css2?family=X",
  },
  {
    name: "a font in a style",
    html: "<style>@font-face { src: url('https://example.com/f.woff2'); }</style>",
    named: "https://example.com/f.woff2",
  },
  {
    name: "an imported stylesheet",
    html: '<style>@import "http://example.com/a.css";</style>',
    named: "http://example.com/a.css",
  },
  {
    name: "an image set by a script",
    html: '<script>img.src = "https://example.com/p.png";</script>',
    named: "https://example.com/p.png",
  },
  {
    name: "a link",
    html: '<a href="https://en.wikipedia.org/wiki/Chain_rule">more</a>',
    named: "https://en.wikipedia.org/wiki/Chain_rule",
  },
])("$name is refused, naming it", async ({ html, named }) => {
  const { shown, tool } = setUp();

  expect(await tool.run({ title: "Aid", html })).toEqual({
    status: "refused",
    text:
      `The document names ${named} on the network, and the pane loads ` +
      "nothing and opens no link. Write its scripts and styles inline, draw " +
      "with SVG or a canvas, and write math in MathML or plain text.",
  });
  expect(shown).toEqual([]);
});

test("a document naming many addresses is refused naming three", async () => {
  const { tool } = setUp();
  const html = [1, 2, 3, 4, 3]
    .map((n) => `<img src="https://example.com/${n}.png">`)
    .join("");

  const result = await tool.run({ title: "Aid", html });
  expect(result.text).toContain(
    "names https://example.com/1.png, https://example.com/2.png, https://example.com/3.png and more on the network",
  );
});

test("what a document holds itself is no address: a data URL, a fragment, a namespace", async () => {
  const { tool } = setUp();
  const html = `<html xmlns="http://www.w3.org/1999/xhtml">
<math xmlns="http://www.w3.org/1998/Math/MathML"><mi>x</mi></math>
<img src="data:image/png;base64,iVBORw0KGgo=">
<a href="#part-2">below</a>
<svg><use href="#dot"/></svg></html>`;

  expect((await tool.run({ title: "Aid", html })).status).toBe("done");
});

test("an empty title or document is refused", async () => {
  const { tool } = setUp();

  expect((await tool.run({ title: "  ", html: GRAPH })).status).toBe("refused");
  expect((await tool.run({ title: "A line", html: "" })).status).toBe(
    "refused",
  );
});
