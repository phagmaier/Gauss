import { expect, test } from "vitest";
import {
  finishStandaloneHtml,
  STANDALONE_HTML_LIMIT_BYTES,
} from "./standalone-html.ts";

test("finishes a whole document with inline and display math, embedded fonts, and the writer's styling and figure", () => {
  const html = finishStandaloneHtml(String.raw`<!doctype html>
<html lang="en" class="notes">
<head>
  <title>Rates of change</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>main { display: grid } @media print { main { display: block } }</style>
</head>
<body>
  <main><nav><a href="#example">Example</a></nav>
    <section id="example">
      <p>The slope is <span class="math-inline">x^2</span>.</p>
      <div class="math-display">\frac{1}{2}</div>
      <figure><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" role="img" aria-label="A slope">
        <defs><marker id="tip" markerWidth="3" markerHeight="3"><path d="M0 0L3 1L0 2Z"/></marker></defs>
        <path d="M0 20L20 0" marker-end="url(#tip)" stroke-width="2"/>
        <text class="math-inline" x="4" y="8">rise</text>
      </svg><figcaption>A line and its slope</figcaption></figure>
    </section>
  </main>
</body>
</html>`);

  expect(html).toMatch(/^<!doctype html><html lang="en" class="notes">/i);
  expect(html).toContain("<title>Rates of change</title>");
  expect(html).toContain('name="viewport"');
  expect(html).toContain('href="#example"');
  expect(html).toContain("@media print { main { display: block } }");
  expect(html).toContain('viewBox="0 0 20 20"');
  expect(html).toContain('marker-end="url(#tip)"');
  expect(html).toContain('stroke-width="2"');
  expect(html).toContain('<text x="4" y="8">rise</text>');
  expect(html).toContain("<figcaption>A line and its slope</figcaption>");
  expect(html).toMatch(/The slope is <span class="katex">.*?<msup>/s);
  expect(html).toMatch(/<span class="katex-display">.*?<mfrac>/s);
  expect(html).not.toContain("math-inline");
  expect(html).not.toContain("math-display");
  expect(html).toContain(".katex .katex-mathml");
  const urls = Array.from(html.matchAll(/\burl\(([^)]+)\)/g), (m) => m[1]);
  expect(urls).toContain("#tip");
  const fonts = urls.filter((url) => url !== "#tip");
  expect(fonts.length).toBeGreaterThan(1);
  for (const font of fonts) {
    // The data begins with the WOFF2 file signature, not just a declared MIME type.
    expect(font).toMatch(/^data:font\/woff2;base64,d09GMg[A-Za-z\d+/]+=*$/);
  }
});

test("draws dollar-delimited math in prose without changing prices, code, or SVG labels", () => {
  const html = finishStandaloneHtml(String.raw`<main>
    <p>That is $\frac{1}{2}$ of the bar.</p>
    <p>$$\frac{1}{2}=\frac{2}{4}$$</p>
    <p>Prices were $5 and $10; the fee was \$1.</p>
    <p>A ticket costs $5; let ($x$) be the number of tickets.</p>
    <p>A discount of $10.50; the total is [$n-10.50$].</p>
    <p>A ticket costs $5 ($x$ tickets).</p>
    <p>Numeric expressions such as $5$, $5 + 2$, and $5x$ are not prices.</p>
    <p>The values are $5.5x$($y$ is separate).</p>
    <pre><code>Example $x$</code></pre>
    <svg viewBox="0 0 20 20"><text x="1" y="9">$x$</text></svg>
  </main>`);
  expect(html).toMatch(/That is <span class="katex">.*?<mfrac>/s);
  expect(html).toMatch(/<span class="katex-display">.*?<mfrac>/s);
  expect(html).toContain("Prices were $5 and $10; the fee was $1.");
  expect(html).toContain('costs $5; let (<span class="katex">');
  expect(html).toContain(
    'discount of $10.50; the total is [<span class="katex">',
  );
  expect(html).toContain('costs $5 (<span class="katex">');
  expect(
    [...html.matchAll(/<annotation[^>]*>(.*?)<\/annotation>/g)].map(
      (m) => m[1],
    ),
  ).toEqual([
    "\\frac{1}{2}",
    "\\frac{1}{2}=\\frac{2}{4}",
    "x",
    "n-10.50",
    "x",
    "5",
    "5 + 2",
    "5x",
    "5.5x",
    "y",
  ]);
  expect(html).toContain("<code>Example $x$</code>");
  expect(html).toContain('<text x="1" y="9">$x$</text>');
});

test("puts a UTF-8 charset and the restrictive policy first, replacing author-supplied policies", () => {
  const html = finishStandaloneHtml(`<!doctype html><html><head>
    <style>body { color: #222 }</style>
    <meta charset="windows-1252">
    <meta http-equiv="Content-Security-Policy" content="default-src *">
  </head><body><h1>Notes</h1></body></html>`);

  expect(html.replaceAll("&#x27;", "'")).toMatch(
    /^<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'">/i,
  );
  expect(html.match(/content-security-policy/gi)).toHaveLength(1);
  expect(html).not.toContain("windows-1252");
  expect(html).toContain("body { color: #222 }");
});

test("keeps only static HTML and SVG, dropping active attributes and non-fragment navigation", () => {
  const html = finishStandaloneHtml(`<html><head>
    <base href="other.html"><link rel="stylesheet" href="other.css">
    <meta http-equiv="refresh" content="0; url=other.html">
    <script>window.surprise = true</script>
  </head><body>
    <p onclick="surprise()">Keep this paragraph</p>
    <a href="#keep" ping="track" target="_blank" download>Go to the heading</a>
    <a href="javascript:void(0)">Not a link</a>
    <a href="other.html">Also not a link</a>
    <img src="other.png" srcset="other-2x.png 2x" onerror="surprise()" alt="An illustration">
    <iframe srcdoc="Another document"></iframe>
    <form action="other.html"><button>Submit</button></form>
    <svg onload="surprise()"><foreignObject>Another document</foreignObject>
      <animate attributeName="href" to="other.html"/><text id="keep" style="fill: #333">Label</text>
    </svg>
  </body></html>`);

  expect(html).toContain("<p>Keep this paragraph</p>");
  expect(html).toContain('<a href="#keep">Go to the heading</a>');
  expect(html).toContain("<a>Not a link</a>");
  expect(html).toContain("<a>Also not a link</a>");
  expect(html).toContain('<img alt="An illustration">');
  expect(html).toContain('<text id="keep" style="fill: #333">Label</text>');
  expect(html).not.toMatch(
    /<(script|base|link|iframe|form|button|foreignObject|animate)\b|surprise|refresh|other\.html|other-2x\.png/i,
  );
});

test.each([
  '<a href="https://example.com">Network link</a>',
  '<img src="&#x2f;&#x2f;example.com/diagram.png">',
  '<script src="https://example.com/script.js"></script>',
  '<svg><use href="https://example.com/figure.svg#curve"/></svg>',
  '<style>@import "//example.com/layout.css";</style>',
  "<style>main { background: url(https://example.com/bg.png) }</style>",
  '<p style="background: url(https&#58;//example.com/bg.png)">Example</p>',
])("refuses a document naming an address on the web: %s", (source) => {
  expect(() => finishStandaloneHtml(source)).toThrow(/web address/i);
});

test.each([
  '<style>@import "local.css";</style>',
  "<p style=\"background: image-set('local.png' 1x)\">Example</p>",
  String.raw`<style>p { background: u\72l(local.png) }</style>`,
  '<svg><path fill="url(local.svg#shape)"/></svg>',
])(
  "refuses CSS that could reference resources outside the document: %s",
  (source) => {
    expect(() => finishStandaloneHtml(source)).toThrow(/CSS reference/i);
  },
);

test("math cannot create navigation or load assets", () => {
  const html = finishStandaloneHtml(
    String.raw`<p><span class="math-inline">\href{#heading}{x}\includegraphics{local.png}</span></p>`,
  );

  expect(html).toContain('<span class="katex">');
  expect(html).not.toMatch(/<a[\s>]|<img[\s>]|\shref=|\ssrc=/i);
});

test("refuses documents over the authored size limit in UTF-8 bytes", () => {
  const source = `<p>${"é".repeat(STANDALONE_HTML_LIMIT_BYTES / 2)}</p>`;

  expect(() => finishStandaloneHtml(source)).toThrow(/over the limit/i);
});

test("limits math expansion before it can grow a short document unreasonably", () => {
  const tooMuchMath = `<span class="math-display">${"\\frac{1}{2}".repeat(400)}</span>`;
  expect(() => finishStandaloneHtml(tooMuchMath)).toThrow(/math limit/i);
  const manyFormulas = '<span class="math-inline">x</span>'.repeat(500);
  expect(() => finishStandaloneHtml(manyFormulas)).toThrow(/math limit/i);
  expect(() =>
    finishStandaloneHtml(
      String.raw`<span class="math-inline">\def\term{x+1}\term</span>`,
    ),
  ).toThrow(/math limit/i);
});
