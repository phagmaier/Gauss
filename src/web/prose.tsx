// Text written by a model, or typed by the learner, rendered as Markdown with
// KaTeX math: `$...$` inline, `$$...$$` for display. It becomes React
// elements, never HTML: raw HTML in the text is shown as text, a link with an
// unsafe address is shown as its text (react-markdown drops the address), and
// an image shows its description, so text from a model cannot make the page
// fetch an address. KaTeX runs untrusted, so `\href` and the like are refused.
// A formula that fails to parse is shown as its source, in red.

import { createContext, memo, useContext } from "react";
import Markdown, { type Components, defaultUrlTransform } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { displayMathLines } from "../shared/display-math-lines.ts";
import { htmlAsText } from "../shared/html-as-text.ts";
import { CHOICE_LETTERS, type ChoiceLetter } from "../shared/question.ts";
import type { SourceSection } from "../shared/source.ts";
import { resolveSourceLink, type SourceTarget } from "./source-target.ts";

/** Only a tutor's prose in the thread has a reader to open. */
export const SourceLinks = createContext<{
  sections: ReadonlyMap<string, SourceSection>;
  open(target: SourceTarget): void;
} | null>(null);

const remarkPlugins = [remarkGfm, remarkMath, displayMathLines, htmlAsText];
// Frappé's red, as `.no` uses for a miss.
const rehypePlugins: [typeof rehypeKatex, { errorColor: string }][] = [
  [rehypeKatex, { errorColor: "#e78284" }],
];

const components: Components = {
  a: function ProseLink({ node: _, href, children, ...props }) {
    const reader = useContext(SourceLinks);
    if (href?.startsWith("source:")) {
      const link = reader && resolveSourceLink(href, reader.sections);
      return link ? (
        <button
          type="button"
          className="source-link"
          title={link.title}
          onClick={() => reader.open({ ...link.target })}
        >
          {children}
        </button>
      ) : (
        children
      );
    }
    return href === undefined || href === "" ? (
      children
    ) : (
      <a {...props} href={href} target="_blank" rel="noreferrer">
        {children}
      </a>
    );
  },
  img: ({ alt }) => alt ?? null,
};

// Both are memoized: parsing the Markdown and setting the math is the page's
// slow work, and a thread redraws on every event, with every reply of the
// unit's earlier sessions in it (task 2.13). Text that has not changed is
// not rendered again.

/** Block text: paragraphs, lists, display math. */
export const Prose = memo(function Prose(props: { text: string }) {
  return (
    <Markdown
      remarkPlugins={remarkPlugins}
      urlTransform={(url, key, node) =>
        key === "href" && node.tagName === "a" && url.startsWith("source:")
          ? url
          : defaultUrlTransform(url)
      }
      rehypePlugins={rehypePlugins}
      components={components}
    >
      {props.text}
    </Markdown>
  );
});

/** Text inside a line, such as a choice on its button: no paragraphs. */
export const InlineProse = memo(function InlineProse(props: { text: string }) {
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
});

/**
 * An expression as typed in the math field, or a math question's expected
 * answer, set as math. Dollar signs are dropped, as the symbolic check
 * drops them, so the text is one formula. It stands alone, so it is set in
 * display style, which sets fractions full size, within its line.
 */
export function MathText(props: { source: string }) {
  const source = props.source.replaceAll("$", "").replace(/\s+/g, " ").trim();
  return <InlineProse text={`$\\displaystyle ${source}$`} />;
}

/**
 * The math field's expression as it will be read, shown under the field
 * while the learner types (mock 2).
 */
export function MathPreview(props: { source: string }) {
  return (
    <div className="prev math" aria-live="polite">
      {props.source.replaceAll("$", "").trim() === "" ? (
        <span className="faint">What you type appears here as math</span>
      ) : (
        <MathText source={props.source} />
      )}
    </div>
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

/** A choice by its letter and its text, as the learner saw it. */
export function ChoiceLabel(props: {
  choices: readonly string[];
  letter: ChoiceLetter;
}) {
  const { choices, letter } = props;
  return (
    <span>
      {letter}.{" "}
      <InlineProse text={choices[CHOICE_LETTERS.indexOf(letter)] ?? ""} />
    </span>
  );
}
