// Notes and cheat sheets are opened both in the app and directly from disk.
// Keep author HTML static in its own right; the meta policy is an
// independent browser guard. The writers' failures name "the page", since
// either writer's can be shown.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type {
  Element,
  ElementContent,
  Parent,
  Properties,
  Root,
  Text,
} from "hast";
import rehypeKatex from "rehype-katex";
import rehypeParse from "rehype-parse";
import rehypeStringify from "rehype-stringify";
import { unified } from "unified";

/** Maximum UTF-8 bytes of the writer's document, before the engine adds math. */
export const STANDALONE_HTML_LIMIT_BYTES = 100_000;
export const STANDALONE_HTML_POLICY =
  "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'";

const OUTPUT_LIMIT_BYTES = 2_000_000;
const MAX_DEPTH = 96;
/** How many formulas a page may have, and how much TeX in all. */
export const MAX_FORMULAS = 128;
const MAX_FORMULA_CHARS = 2_000;
export const MAX_MATH_CHARS = 8_000;
const MATH_LIMIT =
  "The page is over the math limit. Use shorter formulas and no custom TeX macros.";

const processor = unified()
  .use(rehypeParse, { fragment: false })
  .use(rehypeKatex, { trust: false, maxExpand: 200, maxSize: 25 })
  .use(rehypeStringify)
  .freeze();

const words = (value: string) => new Set(value.trim().split(/\s+/));
const BODY_TAGS = words(`
  a abbr address article aside b bdi bdo blockquote br caption cite code col
  colgroup data dd del details dfn div dl dt em figcaption figure footer h1 h2
  h3 h4 h5 h6 header hgroup hr i img ins kbd li main mark nav ol p pre q rp rt
  ruby s samp section small span strong style sub summary sup table tbody td
  tfoot th thead time tr u ul var wbr
`);
const SVG_TAGS = words(`
  a circle clipPath defs desc ellipse g line linearGradient marker mask path
  pattern polygon polyline radialGradient rect stop svg symbol text textPath
  title tspan use
`);
const GLOBAL_ATTRIBUTES = words(
  "className dir hidden id lang role style title",
);
const HTML_ATTRIBUTES: Record<string, ReadonlySet<string>> = {
  col: words("span"),
  colgroup: words("span"),
  data: words("value"),
  del: words("dateTime"),
  details: words("open"),
  img: words("alt decoding height width"),
  ins: words("dateTime"),
  li: words("value"),
  meta: words("content name"),
  ol: words("reversed start type"),
  style: words("media"),
  td: words("colSpan headers rowSpan"),
  th: words("abbr colSpan headers rowSpan scope"),
  time: words("dateTime"),
};
const NO_MATH_TAGS = words("br col hr img style wbr");
const SVG_HREF_TAGS = words(
  "a linearGradient pattern radialGradient textPath use",
);
const SVG_ATTRIBUTES = words(`
  clipPathUnits cx cy d dx dy fx fy fr gradientTransform gradientUnits height
  lengthAdjust markerHeight markerUnits markerWidth offset orient pathLength
  patternContentUnits patternTransform patternUnits points preserveAspectRatio
  r refX refY rx ry rotate startOffset textLength transform viewBox width x x1
  x2 y y1 y2
`);
const SVG_PRESENTATION = words(`
  alignmentBaseline clipPath clipRule color display dominantBaseline fill
  fillOpacity fillRule fontFamily fontSize fontStyle fontWeight markerEnd
  markerMid markerStart mask opacity paintOrder shapeRendering stopColor
  stopOpacity stroke strokeDashArray strokeDashOffset strokeLinecap strokeLinejoin
  strokeMiterLimit strokeOpacity strokeWidth textAnchor vectorEffect visibility
`);

const XMLNS = "http://www.w3.org/2000/svg";
const XMLNS_XLINK = "http://www.w3.org/1999/xlink";
const FRAGMENT = /^#[\w.:-]*$/;
const RASTER_IMAGE =
  /^data:image\/(?:avif|gif|jpeg|png|webp);base64,[A-Za-z\d+/]+=*$/i;

type Scope = "document" | "head" | "body" | "svg";
type MathBudget = { formulas: number; chars: number };

/** Turns a writer's HTML into a self-contained document or throws why it cannot. */
export function finishStandaloneHtml(html: string): string {
  if (Buffer.byteLength(html, "utf8") > STANDALONE_HTML_LIMIT_BYTES) {
    throw new Error("The page is over the limit of 100 KB.");
  }
  if (html.trim() === "") throw new Error("The writer returned no HTML.");

  const tree = parseDocument(html);
  inspectDocument(tree, 0);
  const document = requiredElement(tree, "html");
  tree.children = [{ type: "doctype" }, document];
  sanitizeAttributes(document, false);
  const mathBudget = { formulas: 0, chars: 0 };
  checkMath(document, false, mathBudget);
  sanitizeChildren(document, "document", mathBudget);
  drawProseMath(requiredElement(document, "body"), mathBudget);

  const head = requiredElement(document, "head");
  processor.runSync(tree);
  const firstStyle = head.children.findIndex(
    (node) => node.type === "element" && node.tagName === "style",
  );
  head.children.splice(
    firstStyle === -1 ? head.children.length : firstStyle,
    0,
    {
      type: "element",
      tagName: "style",
      properties: {},
      children: [{ type: "text", value: embeddedKatexCss() }],
    },
  );
  head.children.unshift(
    {
      type: "element",
      tagName: "meta",
      properties: { charSet: "utf-8" },
      children: [],
    },
    {
      type: "element",
      tagName: "meta",
      properties: {
        httpEquiv: ["Content-Security-Policy"],
        content: STANDALONE_HTML_POLICY,
      },
      children: [],
    },
  );

  const result = processor.stringify(tree);
  if (Buffer.byteLength(result, "utf8") > OUTPUT_LIMIT_BYTES) {
    throw new Error("The rendered page is over the limit of 2 MB.");
  }
  return result;
}

function parseDocument(html: string): Root {
  try {
    return processor.parse(html);
  } catch (error) {
    // The HTML-to-HAST conversion can hit the stack limit before our own check.
    if (error instanceof RangeError) {
      throw new Error("The page's HTML is too deeply nested.");
    }
    throw error;
  }
}

function requiredElement(parent: Parent, tagName: string): Element {
  const element = parent.children.find(
    (node): node is Element =>
      node.type === "element" && node.tagName === tagName,
  );
  if (element === undefined) {
    throw new Error("The writer did not return an HTML document.");
  }
  return element;
}

/** Refuse web addresses even in elements/attributes that would be stripped. */
function inspectDocument(parent: Parent, depth: number): void {
  if (depth > MAX_DEPTH)
    throw new Error("The page's HTML is too deeply nested.");
  for (const node of parent.children) {
    if (node.type === "element") {
      for (const [key, value] of Object.entries(node.properties)) {
        if (isSvgNamespace(key, value)) continue;
        if (typeof value === "string") rejectWebAddress(value);
        else if (Array.isArray(value)) rejectWebAddress(value.join(" "));
      }
      inspectDocument(node, depth + 1);
      if (node.content !== undefined) inspectDocument(node.content, depth + 1);
    } else if (node.type === "text") {
      rejectWebAddress(node.value);
    }
  }
}

function isSvgNamespace(key: string, value: Properties[string]): boolean {
  return (
    (key === "xmlns" && value === XMLNS) ||
    (key === "xmlnsXLink" && value === XMLNS_XLINK)
  );
}

function rejectWebAddress(value: string): void {
  // HTML parsing has decoded character references; browsers also ignore ASCII
  // tabs and newlines inside URLs. Namespace identifiers are handled above.
  const normalized = value.replace(/[\t\n\r]/g, "");
  if (
    /\b(?:https?|ftp):(?=\S)|(?:^|[\s"'(=,;])\/\/[^\s"'<>/]/i.test(normalized)
  ) {
    throw new Error(
      "The page names a web address. Use only local links and inline resources.",
    );
  }
}

function allowedTag(node: Element, scope: Scope): boolean {
  if (scope === "document") {
    return node.tagName === "head" || node.tagName === "body";
  }
  if (scope === "head") {
    return (
      node.tagName === "title" ||
      node.tagName === "style" ||
      (node.tagName === "meta" && node.properties.name === "viewport")
    );
  }
  if (scope === "svg") return SVG_TAGS.has(node.tagName);
  return node.tagName === "svg" || BODY_TAGS.has(node.tagName);
}

function sanitizeChildren(
  parent: Element,
  scope: Scope,
  budget: MathBudget,
): void {
  let kept = 0;
  for (const node of parent.children) {
    if (node.type === "text") {
      if (parent.tagName === "style") checkCss(node.value);
    } else if (node.type === "element" && allowedTag(node, scope)) {
      let childScope = scope;
      if (node.tagName === "head") childScope = "head";
      else if (node.tagName === "body") childScope = "body";
      else if (node.tagName === "svg") childScope = "svg";
      sanitizeAttributes(node, childScope === "svg");
      sanitizeChildren(node, childScope, budget);
      checkMath(
        node,
        scope === "body" &&
          childScope === "body" &&
          !NO_MATH_TAGS.has(node.tagName),
        budget,
      );
    } else {
      continue;
    }
    parent.children[kept++] = node;
  }
  parent.children.length = kept;
}

function sanitizeAttributes(node: Element, svg: boolean): void {
  for (const [key, value] of Object.entries(node.properties)) {
    if (key === "style" || (svg && SVG_PRESENTATION.has(key))) {
      if (typeof value === "string") checkCss(value);
      else if (Array.isArray(value)) checkCss(value.join(" "));
      continue;
    }
    if (GLOBAL_ATTRIBUTES.has(key) || /^(aria|data)[A-Z]/.test(key)) continue;
    if (key === "href" || (svg && key === "xLinkHref")) {
      if (
        (svg ? SVG_HREF_TAGS.has(node.tagName) : node.tagName === "a") &&
        typeof value === "string" &&
        FRAGMENT.test(value)
      ) {
        continue;
      }
    } else if (node.tagName === "img" && key === "src") {
      if (typeof value === "string" && RASTER_IMAGE.test(value)) continue;
    } else if (svg) {
      if (SVG_ATTRIBUTES.has(key) || isSvgNamespace(key, value)) continue;
    } else if (
      Object.hasOwn(HTML_ATTRIBUTES, node.tagName) &&
      HTML_ATTRIBUTES[node.tagName]?.has(key)
    ) {
      continue;
    }
    delete node.properties[key];
  }
}

function checkCss(css: string): void {
  const problem =
    "The page uses a CSS reference that cannot be kept offline. Use inline CSS and local fragments only.";
  // No escaped tokens, stylesheet imports, or functions with string URL
  // arguments. url() itself can refer only to an element in this document.
  if (
    /\\|@import\b|\b(?:image(?:-set)?|src|expression)\s*\(|(?:\bbehavior|-moz-binding)\s*:/i.test(
      css,
    )
  ) {
    throw new Error(problem);
  }
  for (const [url] of css.matchAll(
    /\burl\s*\((?:\s*(?:#[\w.:-]+|"#[\w.:-]+"|'#[\w.:-]+')\s*\))?/gi,
  )) {
    if (!url.endsWith(")")) throw new Error(problem);
  }
}

function checkMath(
  node: Element,
  canRender: boolean,
  budget: MathBudget,
): void {
  const classes = node.properties.className;
  if (!Array.isArray(classes)) return;
  const hasMath =
    classes.includes("math-inline") || classes.includes("math-display");
  // Disable rehype-katex's Markdown code-fence convention and all math in SVG.
  if (classes.includes("language-math") || (!canRender && hasMath)) {
    const kept = classes.filter(
      (name) =>
        name !== "language-math" &&
        (canRender || (name !== "math-inline" && name !== "math-display")),
    );
    if (kept.length > 0) node.properties.className = kept;
    else delete node.properties.className;
  }
  if (!canRender || !hasMath) return;
  let source = "";
  for (const child of node.children) {
    if (child.type !== "text") {
      throw new Error("The page must give each formula as plain TeX.");
    }
    source += child.value;
  }
  budget.formulas++;
  budget.chars += source.length;
  // Bound user-controlled macro duplication: KaTeX's maxExpand counts
  // expansions rather than overall output size.
  if (
    source.length > MAX_FORMULA_CHARS ||
    budget.formulas > MAX_FORMULAS ||
    budget.chars > MAX_MATH_CHARS ||
    /\\(?:def|gdef|edef|xdef|newcommand|renewcommand|providecommand|let|futurelet)\b/.test(
      source,
    )
  ) {
    throw new Error(MATH_LIMIT);
  }
}

/** The writer sometimes uses the thread's dollar notation inside HTML prose. */
function drawProseMath(parent: Element, budget: MathBudget): void {
  const classes = parent.properties.className;
  if (
    parent.tagName === "svg" ||
    parent.tagName === "pre" ||
    parent.tagName === "code" ||
    NO_MATH_TAGS.has(parent.tagName) ||
    (Array.isArray(classes) &&
      (classes.includes("math-inline") || classes.includes("math-display")))
  ) {
    return;
  }
  for (let i = 0; i < parent.children.length; i++) {
    const child = parent.children[i];
    if (child?.type === "element") {
      drawProseMath(child, budget);
    } else if (child?.type === "text" && child.value.includes("$")) {
      const parts = proseMath(child, budget);
      if (parts === undefined) continue;
      parent.children.splice(i, 1, ...parts);
      i += parts.length - 1;
    }
  }
}

function proseMath(
  text: Text,
  budget: MathBudget,
): ElementContent[] | undefined {
  // Inline dollars need non-space edges; a closing dollar before a digit
  // is not a delimiter (e.g. "$5 and $10"). Literal dollars use \$.
  const delimiters =
    /\\\$|\$\$((?:\\[\s\S]|[^\\$]|\$(?!\$))+)\$\$|(?<!\$)\$(?![\s$])((?:\\[^\n]|[^\\$\n])+)(?<!\s)\$(?![\d$])/g;
  const priceProse =
    /^\d+(?:[.,]\d+)*(?:\s*(?:[.,](?!\d)|[;:!?()[\]–—])|\s+\p{L}{2})/u;
  const parts: ElementContent[] = [];
  let end = 0;
  for (
    let match = delimiters.exec(text.value);
    match !== null;
    match = delimiters.exec(text.value)
  ) {
    // If a price opens a span of prose and its closing dollar also opens
    // a complete formula, leave the price in the text and take the formula.
    if (match[2] !== undefined && priceProse.test(match[2])) {
      const after = delimiters.lastIndex;
      delimiters.lastIndex = after - 1;
      const next = delimiters.exec(text.value);
      if (next?.index === after - 1) match = next;
      else delimiters.lastIndex = after;
    }
    const [found, display, inline] = match;
    if (match.index > end) {
      parts.push({ type: "text", value: text.value.slice(end, match.index) });
    }
    if (display === undefined && inline === undefined) {
      parts.push({ type: "text", value: "$" });
    } else {
      const formula: Element = {
        type: "element",
        tagName: "span",
        properties: {
          className: [display === undefined ? "math-inline" : "math-display"],
        },
        children: [{ type: "text", value: display ?? inline ?? "" }],
      };
      checkMath(formula, true, budget);
      parts.push(formula);
    }
    end = match.index + found.length;
  }
  if (end === 0) return undefined;
  if (end < text.value.length) {
    parts.push({ type: "text", value: text.value.slice(end) });
  }
  return parts;
}

let katexCss: string | undefined;

export function embeddedKatexCss(): string {
  if (katexCss !== undefined) return katexCss;
  const file = createRequire(import.meta.url).resolve(
    "katex/dist/katex.min.css",
  );
  const source = readFileSync(file, "utf8");
  // Drop the older WOFF and TTF fallbacks; all current browsers support WOFF2.
  const embedded = source.replace(
    /src:url\(fonts\/([\w-]+\.woff2)\)[^;}]+/g,
    (_, name: string) => {
      const font = readFileSync(join(dirname(file), "fonts", name), "base64");
      return `src:url(data:font/woff2;base64,${font}) format("woff2")`;
    },
  );
  if (
    !embedded.includes("data:font/woff2;base64,") ||
    /@import\b|\burl\s*\((?!data:font\/woff2;base64,)/i.test(embedded)
  ) {
    throw new Error(
      "Could not package the installed KaTeX fonts for an offline document.",
    );
  }
  katexCss = embedded;
  return embedded;
}
