import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { type Data, unified } from "unified";

type Extension = Exclude<
  NonNullable<Data["fromMarkdownExtensions"]>[number],
  unknown[]
>;
type TokenHandler = NonNullable<Extension["enter"]>[string];
type Token = Parameters<TokenHandler>[0];
type Root = ReturnType<typeof parser.parse>;
type Node = Root["children"][number];
type Kind = "markdown" | "epub" | "quote";

interface HeadingSpan {
  start: number;
  end: number;
  title: string;
}

// mdast positions cover whole constructs, not delimiters or continuation
// prefixes. Save the parser's syntax tokens while it builds each tree, without
// intercepting any of its node handlers or maintaining parse-global state.
const syntaxTokens = new WeakMap<Root, Token[]>();
const markSyntax: TokenHandler = function (token) {
  const root = this.stack[0];
  if (root?.type !== "root") return;
  const tokens = syntaxTokens.get(root);
  if (tokens === undefined) syntaxTokens.set(root, [token]);
  else tokens.push(token);
};

const syntax: Extension = {
  enter: {
    atxHeadingSequence: markSyntax,
    autolinkMarker: markSyntax,
    blockQuotePrefix: markSyntax,
    codeFencedFence: markSyntax,
    codeTextSequence: markSyntax,
    // The colon of a footnote definition. Ordinary link definitions are
    // hidden by their nodes.
    definitionMarker: markSyntax,
    emphasisSequence: markSyntax,
    escapeMarker: markSyntax,
    gfmFootnoteDefinitionLabel: markSyntax,
    labelImageMarker: markSyntax,
    labelMarker: markSyntax,
    listItemPrefix: markSyntax,
    resource: markSyntax,
    setextHeadingLineSequence: markSyntax,
    strikethroughSequence: markSyntax,
    strongSequence: markSyntax,
    taskListCheck: markSyntax,
    thematicBreakSequence: markSyntax,
  },
  exit: { reference: markSyntax },
};
const parser = unified()
  .data("fromMarkdownExtensions", [syntax])
  .use(remarkParse)
  .use(remarkGfm)
  .freeze();

// A copied passage may not include its note's definition. The converter can
// likewise emit a reference whose definition did not survive the conversion.
// GFM leaves those references in text nodes, unlike references it can resolve.
const unresolvedReference = /\[\^(?:\\[^\r\n]|[^\s\\[\]])+\]/y;

function headingText(node: Node): string {
  switch (node.type) {
    case "text":
    case "inlineCode":
    case "html":
      return node.value;
    case "image":
    case "imageReference":
      return node.alt ?? "";
    case "break":
      return " ";
    default:
      return "children" in node ? node.children.map(headingText).join("") : "";
  }
}

/** Mask parsed syntax in place, leaving the source text and UTF-16 offsets intact. */
export function markdownQuoteMarkup(
  text: string,
  kind: Kind,
  hidden: Uint8Array,
  legacyHeadings = false,
): { breaks: ReadonlySet<number>; headings: readonly HeadingSpan[] } {
  const tree = parser.parse(text);
  const tokens = syntaxTokens.get(tree);
  if (tokens !== undefined) {
    syntaxTokens.delete(tree);
    for (const { start, end } of tokens)
      hidden.fill(1, start.offset, end.offset);
  }

  const breaks = new Set<number>();
  const headings: HeadingSpan[] = [];
  const unresolved = kind !== "markdown" && text.includes("[^");
  const visit = (node: Node): void => {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start !== undefined && end !== undefined) {
      switch (node.type) {
        case "break": {
          const lf = end - 1;
          if (text[lf] === "\n") {
            hidden.fill(1, start, lf);
            breaks.add(lf);
          } else {
            hidden.fill(1, start, end);
          }
          break;
        }
        case "footnoteReference":
          hidden.fill(1, start, end);
          break;
        case "definition":
          // A multiline link definition is not visible, but its lines still
          // separate the prose that precedes it from the prose that follows.
          for (let i = start; i < end; i++) if (text[i] !== "\n") hidden[i] = 1;
          break;
        case "text":
          if (!unresolved) break;
          for (let i = start; i + 2 < end; i++) {
            if (text[i] !== "[" || text[i + 1] !== "^") continue;
            // The token map distinguishes an escape from a printed backslash.
            if (text[i - 1] === "\\" && hidden[i - 1] === 1) continue;
            unresolvedReference.lastIndex = i;
            if (
              unresolvedReference.test(text) &&
              unresolvedReference.lastIndex <= end
            ) {
              hidden.fill(1, i, unresolvedReference.lastIndex);
              i = unresolvedReference.lastIndex - 1;
            }
          }
          break;
      }
    }
    if ("children" in node) node.children.forEach(visit);
  };
  for (const node of tree.children) {
    visit(node);
    if (legacyHeadings && node.type === "heading") {
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (start !== undefined && end !== undefined) {
        const title = headingText(node).replace(/\s+/g, " ").trim();
        headings.push({ start, end, title: title || "Untitled" });
      }
    }
  }
  return { breaks, headings };
}
