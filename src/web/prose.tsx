// Text written by a model, or typed by the learner, rendered as Markdown with
// KaTeX math: `$...$` inline, `$$...$$` for display. It becomes React
// elements, never HTML: raw HTML in the text is shown as text, a link with an
// unsafe address is shown as its text (react-markdown drops the address), and
// an image shows its description, so text from a model cannot make the page
// fetch an address. KaTeX runs untrusted, so `\href` and the like are refused.
// A formula that fails to parse is shown as its source, in red.

import Markdown, { type Components } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

/** The parts of a Markdown syntax tree node that `displayMathLines` reads. */
interface MdNode {
  type: string;
  value?: string;
  children?: MdNode[];
  position?: { start: { offset?: number } };
  data?: { hProperties?: { className?: string[] } };
}

/**
 * `$$...$$` on a line of its own is display math, as writers mean it, though
 * Markdown reads it as inline math unless the dollars are on lines of their
 * own. The newlines around it are dropped, since the formula is a block.
 */
function displayMathLines() {
  return (tree: MdNode, file: { value: unknown }) => {
    const source = String(file.value);
    const startsLine = (node: MdNode | undefined) =>
      node === undefined ||
      node.type === "break" ||
      (node.type === "text" && node.value?.endsWith("\n") === true);
    const endsLine = (node: MdNode | undefined) =>
      node === undefined ||
      node.type === "break" ||
      (node.type === "text" && node.value?.startsWith("\n") === true);

    const visit = (node: MdNode): void => {
      const children = node.children ?? [];
      children.forEach(visit);
      if (node.type !== "paragraph") return;
      // Decide every formula before changing the text between them.
      const lines = children.filter((child, i) => {
        const at = child.position?.start.offset;
        return (
          child.type === "inlineMath" &&
          at !== undefined &&
          source.startsWith("$$", at) &&
          startsLine(children[i - 1]) &&
          endsLine(children[i + 1])
        );
      });
      for (const math of lines) {
        const i = children.indexOf(math);
        const before = children[i - 1];
        const after = children[i + 1];
        if (before?.type === "text" && before.value !== undefined)
          before.value = before.value.slice(0, -1);
        if (after?.type === "text" && after.value !== undefined)
          after.value = after.value.slice(1);
        math.data = {
          ...math.data,
          hProperties: {
            ...math.data?.hProperties,
            className: ["language-math", "math-display"],
          },
        };
      }
    };
    visit(tree);
  };
}

/** Where a block of raw HTML can stand, as opposed to HTML inside a line. */
const BLOCK_PARENTS = new Set(["root", "blockquote", "listItem"]);

/**
 * A block of raw HTML is shown as its text in a paragraph of its own, spaced
 * like the blocks around it. Left alone, it is text between them.
 */
function htmlBlocksAsText() {
  return (tree: MdNode) => {
    const visit = (node: MdNode): void => {
      if (node.children === undefined) return;
      node.children = node.children.map((child) =>
        child.type === "html" && BLOCK_PARENTS.has(node.type)
          ? {
              type: "paragraph",
              children: [{ type: "text", value: child.value ?? "" }],
            }
          : child,
      );
      node.children.forEach(visit);
    };
    visit(tree);
  };
}

const remarkPlugins = [
  remarkGfm,
  remarkMath,
  displayMathLines,
  htmlBlocksAsText,
];
// Frappé's red, as `.no` uses for a miss.
const rehypePlugins: [typeof rehypeKatex, { errorColor: string }][] = [
  [rehypeKatex, { errorColor: "#e78284" }],
];

const components: Components = {
  a: ({ node: _, href, children, ...props }) =>
    href === undefined || href === "" ? (
      children
    ) : (
      <a {...props} href={href} target="_blank" rel="noreferrer">
        {children}
      </a>
    ),
  img: ({ alt }) => alt ?? null,
};

/** Block text: paragraphs, lists, display math. */
export function Prose(props: { text: string }) {
  return (
    <Markdown
      remarkPlugins={remarkPlugins}
      rehypePlugins={rehypePlugins}
      components={components}
    >
      {props.text}
    </Markdown>
  );
}

/** Text inside a line, such as a choice on its button: no paragraphs. */
export function InlineProse(props: { text: string }) {
  return (
    <Markdown
      remarkPlugins={remarkPlugins}
      rehypePlugins={rehypePlugins}
      components={components}
      disallowedElements={["p"]}
      unwrapDisallowed
    >
      {props.text}
    </Markdown>
  );
}

/**
 * The learner's typed answer as it will read, math rendered, shown under
 * the field while they type (mock 2). The written answer field (2.8, 2.11)
 * mounts it.
 */
export function AnswerPreview(props: { text: string }) {
  return (
    <div className="prev prose" aria-live="polite">
      {props.text.trim() === "" ? (
        <span className="faint">
          What you type appears here, with math between $ signs rendered
        </span>
      ) : (
        <Prose text={props.text} />
      )}
    </div>
  );
}
