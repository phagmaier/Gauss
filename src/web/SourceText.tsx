import type { Element, ElementContent, Root, Text } from "hast";
import { memo } from "react";
import Markdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import { type PluggableList, unified } from "unified";
import { displayMathLines } from "../shared/display-math-lines.ts";
import { PDF_ESCAPE } from "../shared/source-quote.ts";
import { type Margin, pdfSyntax, type ReaderPart } from "./source-reader.ts";

const parser = unified().use(remarkParse).freeze();
type MarkdownTree = ReturnType<typeof parser.parse>;

/** GFM moves used definitions to the foot and omits unused ones. A reader
 * opening the Notes chapter itself must still see its paragraphs. */
function keepNotes() {
  return (tree: MarkdownTree) => {
    const used = new Set<string>();
    function visit(node: MarkdownTree["children"][number]) {
      if (node.type === "footnoteReference") used.add(node.identifier);
      if ("children" in node) node.children.forEach(visit);
    }
    tree.children.forEach(visit);
    tree.children = tree.children.map((node) =>
      node.type === "footnoteDefinition" && !used.has(node.identifier)
        ? {
            type: "blockquote",
            position: node.position,
            children: [
              {
                type: "paragraph",
                children: [
                  {
                    type: "strong",
                    children: [
                      { type: "text", value: node.label ?? node.identifier },
                    ],
                  },
                ],
              },
              ...node.children,
            ],
          }
        : node,
    );
  };
}

function element(
  tagName: string,
  properties: Element["properties"],
  children: ElementContent[],
): Element {
  return { type: "element", tagName, properties, children };
}
const literal = (value: string): Text => ({ type: "text", value });

function rail(margins: Margin[]) {
  return element(
    "span",
    { className: ["reader-rail"] },
    margins.map(({ label, page, loss }) => {
      if (page === undefined) return element("span", {}, [literal(label)]);
      const title = `Show page ${label} as an image${loss ? `: its text lost ${loss}` : ""}`;
      return element(
        "button",
        {
          type: "button",
          className: loss ? ["reader-pg", "lost"] : ["reader-pg"],
          title,
          ariaLabel: title,
          dataPage: page,
        },
        [literal(label)],
      );
    }),
  );
}

/** A boundary in a positioned Markdown text node, after the parser has
 * removed escapes, decoded entities, and stripped continuation prefixes. */
function displayedOffset(raw: string, value: string, boundary: number): number {
  if (boundary <= 0) return 0;
  if (boundary >= raw.length) return value.length;
  if (value === raw) return boundary;
  const embedded = raw.indexOf(value);
  if (embedded >= 0)
    return Math.max(0, Math.min(value.length, boundary - embedded));
  let visible = 0;
  for (let i = 0; i < boundary && visible < value.length; i++) {
    if (
      raw[i] === "\\" &&
      raw[i + 1] === value[visible] &&
      /[!-/:-@[-`{-~]/.test(value[visible] ?? "")
    )
      i++;
    if (raw[i] === "&") {
      const entity = /^&(?:#\d+|#x[\da-f]+|[a-z][\da-z]+);/i.exec(
        raw.slice(i),
      )?.[0];
      // In a PDF's text an entity is its own characters, shown as written.
      if (entity && !value.startsWith(entity, visible)) {
        const paragraph = parser.parse(`x${entity}`).children[0];
        const node = paragraph?.type === "paragraph" && paragraph.children[0];
        const decoded = node && node.type === "text" && node.value.slice(1);
        if (decoded && value.startsWith(decoded, visible)) {
          visible += decoded.length;
          i += entity.length - 1;
          continue;
        }
      }
    }
    if (
      raw[i] === value[visible] ||
      (raw[i] === "\n" && value[visible] === " ")
    )
      visible++;
  }
  return visible;
}

interface Site {
  node: ElementContent;
  start: number;
  end: number;
  margins: Margin[];
}

/**
 * What each format's conversion writes, and no more: a dollar sign is math
 * only in a Markdown source, and a PDF's text is its characters.
 */
const SYNTAX: Record<ReaderPart["format"], PluggableList> = {
  markdown: [remarkGfm, remarkMath, displayMathLines, keepNotes],
  epub: [remarkGfm, keepNotes],
  pdf: [remarkGfm, pdfSyntax, keepNotes],
  text: [],
};

function isMath(node: ElementContent): boolean {
  return (
    node.type === "element" &&
    node.tagName === "code" &&
    String(node.properties.className).includes("math")
  );
}

/** Insert only trusted elements after parsing. An annotation never changes
 * how the original emphasis, links, code, math, or notes are parsed. */
function annotations(part: ReaderPart) {
  return (tree: Root) => {
    const sites: Site[] = [];
    const remember = (node: ElementContent, start: number, end: number) =>
      sites.push({ node, start, end, margins: [] });
    // The conversion's own backslashes are not the page's characters. Last
    // first, so that taking one out moves none still to be found.
    const escapes =
      part.format === "pdf"
        ? [...part.text.matchAll(PDF_ESCAPE)].map((m) => m.index).reverse()
        : [];
    if (part.format === "text") {
      tree.children = [];
      for (const paragraph of part.text.matchAll(
        /^[ \t]*\S[^\n]*(?:\n(?![ \t]*(?:\n|$))[^\n]+)*/gm,
      )) {
        const node = literal(paragraph[0]);
        tree.children.push(element("p", {}, [node]));
        remember(node, paragraph.index, paragraph.index + paragraph[0].length);
      }
    } else {
      const visit = (node: ElementContent, parent?: Element) => {
        const pos = node.position ?? parent?.position;
        const start = pos?.start.offset;
        const end = pos?.end.offset;
        if (node.type === "element") {
          if (node.properties.id === "footnote-label")
            node.properties.id = `${part.prefix}footnotes`;
          if (node.properties.dataFootnoteRef)
            node.properties.ariaDescribedBy = [`${part.prefix}footnotes`];
          // A display equation is its whole block, whose text KaTeX reads
          // as TeX: a margin's label goes before the block, not into it.
          const atom =
            node.tagName === "img" ||
            isMath(node) ||
            (node.tagName === "pre" && node.children.some(isMath));
          if (atom && start !== undefined && end !== undefined) {
            remember(node, start, end);
          } else {
            for (const child of node.children) visit(child, node);
          }
        } else if (
          (node.type === "text" || node.type === "raw") &&
          start !== undefined &&
          end !== undefined &&
          (node.position || parent?.tagName === "code")
        ) {
          if (node.type === "text") {
            const raw = part.text.slice(start, end);
            for (const slash of escapes) {
              if (slash < start || slash >= end) continue;
              const at = displayedOffset(raw, node.value, slash - start);
              if (node.value[at] === "\\")
                node.value = node.value.slice(0, at) + node.value.slice(at + 1);
            }
          }
          remember(node, start, end);
        }
      };
      for (const node of tree.children)
        if (node.type !== "doctype") visit(node);
    }
    // GFM moved footnotes; assign margin labels in source, not DOM, order.
    sites.sort((a, b) => a.start - b.start);
    const tail: Margin[] = [];
    let i = 0;
    for (const margin of part.margins) {
      while ((sites[i]?.end ?? Infinity) <= margin.at) i++;
      (sites[i]?.margins ?? tail).push(margin);
    }
    const replacements = new Map<ElementContent, ElementContent[]>();
    for (const { node, start, end, margins } of sites) {
      const mark =
        part.mark && start < part.mark.end && end > part.mark.start
          ? part.mark
          : undefined;
      if (!margins.length && !mark) continue;
      if (node.type !== "text" && node.type !== "raw") {
        replacements.set(node, [
          ...(margins.length ? [rail(margins)] : []),
          mark ? element("mark", {}, [node]) : node,
        ]);
        continue;
      }
      const raw = part.text.slice(start, end);
      const offset = (at: number) =>
        displayedOffset(raw, node.value, at - start);
      const lo = mark ? offset(mark.start) : -1;
      const hi = mark ? offset(mark.end) : -1;
      const boundaries = new Map<number, Margin[]>([
        [0, []],
        [node.value.length, []],
      ]);
      if (lo !== -1) {
        boundaries.set(lo, []);
        boundaries.set(hi, []);
      }
      for (const margin of margins) {
        const at = offset(margin.at);
        const group = boundaries.get(at);
        if (group) group.push(margin);
        else boundaries.set(at, [margin]);
      }
      const children: ElementContent[] = [];
      let before = 0;
      for (const [at, group] of [...boundaries].sort((a, b) => a[0] - b[0])) {
        if (at > before) {
          const text = literal(node.value.slice(before, at));
          children.push(
            lo <= before && before < hi ? element("mark", {}, [text]) : text,
          );
        }
        if (group.length) children.push(rail(group));
        before = at;
      }
      replacements.set(node, children);
    }
    function replace(parent: Root | Element): void {
      for (let n = parent.children.length - 1; n >= 0; n--) {
        const child = parent.children[n];
        if (!child || child.type === "doctype") continue;
        const replacement = replacements.get(child);
        if (replacement) parent.children.splice(n, 1, ...replacement);
        else if (child.type === "element") replace(child);
      }
    }
    replace(tree);
    if (tail.length) tree.children.push(element("p", {}, [rail(tail)]));
  };
}

export const SourceText = memo(function SourceText({
  part,
  onPage,
}: {
  part: ReaderPart;
  onPage(page: number): void;
}) {
  return (
    <div
      className={
        part.format === "text"
          ? "reader-text reader-plain prose"
          : "reader-text prose"
      }
    >
      <Markdown
        remarkPlugins={SYNTAX[part.format]}
        remarkRehypeOptions={{ clobberPrefix: part.prefix }}
        rehypePlugins={[
          [annotations, part],
          [rehypeKatex, { errorColor: "#e78284" }],
        ]}
        components={{
          a: ({ node: _, href, children, ...props }) =>
            href?.startsWith(`#${part.prefix}`) ? (
              <a
                {...props}
                href={href}
                onClick={(event) => {
                  // A note's link should not write the app's URL or scroll the thread.
                  event.preventDefault();
                  const to = document.getElementById(href.slice(1));
                  if (
                    to &&
                    event.currentTarget.closest(".reader-text")?.contains(to)
                  ) {
                    to.scrollIntoView({ block: "nearest" });
                    to.tabIndex = -1;
                    to.focus({ preventScroll: true });
                  }
                }}
              >
                {children}
              </a>
            ) : href !== undefined && /^(?:https?|mailto):/i.test(href) ? (
              <a {...props} href={href} target="_blank" rel="noreferrer">
                {children}
              </a>
            ) : (
              // A link into the source's own file or folder leads nowhere here.
              children
            ),
          img: ({ alt }) => alt ?? null,
          button: ({ node, ...props }) => (
            <button
              {...props}
              type="button"
              onClick={() => onPage(Number(node?.properties.dataPage))}
            />
          ),
        }}
      >
        {part.format === "text" ? "" : part.text}
      </Markdown>
    </div>
  );
});
