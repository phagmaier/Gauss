import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { AnswerPreview, InlineProse, Prose } from "./prose.tsx";

const render = (text: string) =>
  renderToStaticMarkup(createElement(Prose, { text }));

/** KaTeX keeps each formula's source in its MathML, which shows what it rendered. */
const tex = (source: string) =>
  `<annotation encoding="application/x-tex">${source}</annotation>`;

/** Each display formula in the output, as its source. */
const displayed = (html: string) =>
  [
    ...html.matchAll(
      /<span class="katex-display">.*?<annotation encoding="application\/x-tex">(.*?)<\/annotation>/g,
    ),
  ].map((m) => m[1]);

describe("Markdown", () => {
  test("lists, with emphasis in their items", () => {
    const html = render("- one\n- *two*\n\n1. first\n2. **second**");

    expect(html).toMatch(
      /<ul>\s*<li>one<\/li>\s*<li><em>two<\/em><\/li>\s*<\/ul>/,
    );
    expect(html).toMatch(
      /<ol>\s*<li>first<\/li>\s*<li><strong>second<\/strong><\/li>\s*<\/ol>/,
    );
  });

  test("emphasis and code in a paragraph", () => {
    expect(render("A *rate*, a **key term**, and `f(x)`.")).toBe(
      "<p>A <em>rate</em>, a <strong>key term</strong>, and <code>f(x)</code>.</p>",
    );
  });

  test("a safe link opens in a new tab, and an unsafe one is only its text", () => {
    const html = render(
      "See [the notes](https://example.com/notes) or [this](javascript:alert(1)).",
    );

    expect(html).toContain(
      '<a href="https://example.com/notes" target="_blank" rel="noreferrer">the notes</a>',
    );
    expect(html).toContain(" or this.");
    expect(html.match(/<a /g)).toHaveLength(1);
  });

  test("an image shows its description and is never fetched", () => {
    const html = render("![a sketch of the curve](https://example.com/x.png)");

    expect(html).toBe("<p>a sketch of the curve</p>");
  });
});

describe("math", () => {
  test("inline math between single dollars", () => {
    const html = render("The slope is $2x$ at every point.");

    expect(html).toMatch(/^<p>The slope is <span class="katex">/);
    expect(html).toContain(tex("2x"));
    expect(html).toMatch(/<\/span> at every point\.<\/p>$/);
    expect(html).not.toContain("katex-display");
  });

  test("display math with the dollars on lines of their own", () => {
    const html = render("Then:\n\n$$\n\\frac{d}{dx} x^2 = 2x\n$$\n\nDone.");

    expect(displayed(html)).toEqual(["\\frac{d}{dx} x^2 = 2x"]);
    expect(html).toMatch(/^<p>Then:<\/p>/);
    expect(html).toMatch(/<p>Done\.<\/p>$/);
  });

  test("display math with the dollars and the formula on one line", () => {
    const html = render("Then:\n\n$$x^2 + 1$$\n\nDone.");

    expect(displayed(html)).toEqual(["x^2 + 1"]);
  });

  test("display math on a line of its own inside a paragraph", () => {
    const html = render("The rule is:\n$$(fg)' = f'g + fg'$$\nso it holds.");

    expect(displayed(html)).toEqual(["(fg)&#x27; = f&#x27;g + fg&#x27;"]);
    // The newlines around the formula go, since it is a block.
    expect(html).toMatch(/^<p>The rule is:<span class="katex-display">/);
    expect(html).toMatch(/<\/span>so it holds\.<\/p>$/);
  });

  test("two display formulas on consecutive lines", () => {
    expect(displayed(render("$$a = 1$$\n$$b = 2$$"))).toEqual([
      "a = 1",
      "b = 2",
    ]);
  });

  test("double dollars within a line stay inline", () => {
    const html = render("So $$x = 2$$ holds.");

    expect(html).toContain(tex("x = 2"));
    expect(html).not.toContain("katex-display");
  });

  test("a formula that fails to parse shows its source in red, and the rest renders", () => {
    const html = render("Broken $\\frac{1}{$ here, and $x^2$ fine.");

    expect(html).toMatch(
      /<span class="katex-error" title="ParseError: [^"]*" style="color:#e78284">\\frac\{1\}\{<\/span> here, and /,
    );
    expect(html).toContain(tex("x^2"));
  });

  test("escaped dollars are dollars", () => {
    expect(render("It costs \\$5, or \\$10 for two.")).toBe(
      "<p>It costs $5, or $10 for two.</p>",
    );
  });

  test("dollars in code are code", () => {
    const html = render("Type `$x$`, or:\n\n```\n$$y$$\n```");

    expect(html).toContain("<code>$x$</code>");
    expect(html).toContain("<pre><code>$$y$$\n</code></pre>");
    expect(html).not.toContain("katex");
  });

  test("KaTeX refuses commands that make links", () => {
    const html = render(
      "$\\href{javascript:alert(1)}{x}$ and $\\url{https://example.com}$",
    );

    expect(html).not.toMatch(/<a[\s>]/);
    expect(html).not.toContain("href=");
  });
});

describe("raw HTML is shown as text, never run", () => {
  test.each([
    {
      name: "a script tag",
      text: "Look: <script>alert(1)</script>",
      shown: "Look: &lt;script&gt;alert(1)&lt;/script&gt;",
    },
    {
      name: "inline tags",
      text: "Some <b>bold</b> and <img src=x onerror=alert(1)>",
      shown:
        "Some &lt;b&gt;bold&lt;/b&gt; and &lt;img src=x onerror=alert(1)&gt;",
    },
    {
      name: "a block of HTML",
      text: 'Before.\n\n<div onclick="steal()">Click me</div>\n\nAfter.',
      // In a paragraph of its own, spaced as the blocks around it.
      shown:
        "<p>&lt;div onclick=&quot;steal()&quot;&gt;Click me&lt;/div&gt;</p>",
    },
  ])("$name", ({ text, shown }) => {
    const html = render(text);

    expect(html).toContain(shown);
    expect(html).not.toMatch(/<(script|b|img|div)\b/);
  });
});

describe("inline text, for choices", () => {
  test("has no paragraph, and keeps its math and emphasis", () => {
    const html = renderToStaticMarkup(
      createElement(InlineProse, { text: "$x^2$, *not* $2x$" }),
    );

    expect(html).not.toContain("<p");
    expect(html).toContain(tex("x^2"));
    expect(html).toContain("<em>not</em>");
    expect(html).toContain(tex("2x"));
  });
});

describe("the answer preview", () => {
  const preview = (text: string) =>
    renderToStaticMarkup(createElement(AnswerPreview, { text }));

  test.each(["", "  \n "])(
    "says what it is for while the field is blank (%j)",
    (text) => {
      expect(preview(text)).toContain(
        '<span class="faint">What you type appears here, with math between $ signs rendered</span>',
      );
    },
  );

  test("renders what is typed, math included", () => {
    const html = preview("Since $x > 0$, the square is positive.");

    expect(html).toMatch(
      /^<div class="prev prose" aria-live="polite"><p>Since /,
    );
    expect(html).toContain(tex("x &gt; 0"));
    expect(html).not.toContain("faint");
  });
});
