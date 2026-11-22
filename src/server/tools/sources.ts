// The read_section, view_page and quote_source teaching tools (tasks 4.8
// and 4.9), given to the tutor of a course with a source: a section's text,
// a PDF page as an image where the text lost math or figures, and a passage
// shown to the learner as a quote once it is found in the sources. Teaching
// tools, not file tools: they work with no sandbox or on another backend,
// and keep the record out of the tutor's reach. Reading is allowed at any
// time; quoting, not while a question is open, which is the engine's rule.
// None ends the tutor's turn.

import {
  QuoteSourceInput,
  ReadSectionInput,
  type SectionRef,
  ViewPageInput,
} from "../../shared/source.ts";
import { quoteTextProblem } from "../../shared/source-quote.ts";
import { defineTool, type TeachingTool, type ToolImage } from "./tool.ts";

/** Where the course's sources are read. The engine provides it. */
export interface SourceShelf {
  /** The section's text after a line naming it, or why it cannot be read. */
  read(
    section: SectionRef,
    signal?: AbortSignal,
  ): Promise<{ text: string } | { refused: string }>;
  /** The page as an image, with a line naming it, or why it cannot be shown. */
  view(
    source: string,
    page: number,
    signal?: AbortSignal,
  ): Promise<{ text: string; image: ToolImage } | { refused: string }>;
  /**
   * Shows the passage to the learner as a verified quote, with a line
   * saying where it was found, or says why it cannot.
   */
  quote(
    input: QuoteSourceInput,
    signal?: AbortSignal,
  ): Promise<{ text: string } | { refused: string }>;
}

export function readSectionTool(shelf: SourceShelf): TeachingTool {
  return defineTool({
    name: "read_section",
    description:
      "Read a section of the course's sources, whole: its text, after a " +
      "line naming it with its title and place. Name it as the outlines " +
      'under "# Sources" give it, "<source id>/<section id>". Read the ' +
      "sections a segment draws on, which its header names, before teaching " +
      "it, and any other section when the conversation needs it. In a PDF's " +
      'text, a comment such as `<!-- page 31 label "5" math images -->` ' +
      "starts each page: its number from 1, its printed label, `math` where " +
      "its text lost math and `images` where images cover some of it; look " +
      "at such a page with view_page. Allowed at any time; your turn goes " +
      "on after it.",
    input: ReadSectionInput,
    async run({ section }, signal) {
      const read = await shelf.read(section, signal);
      if ("refused" in read) return { status: "refused", text: read.refused };
      return { status: "done", text: read.text };
    },
  });
}

export function viewPageTool(shelf: SourceShelf): TeachingTool {
  return defineTool({
    name: "view_page",
    description:
      "Look at a page of a PDF source as an image, to read what its text " +
      "lost: the math of a page whose marker says `math`, the figures of " +
      "one whose marker says `images`. Name the page by its number from 1, " +
      "as its marker in a section's text gives it, not its printed label. " +
      "Allowed at any time; your turn goes on after it.",
    input: ViewPageInput,
    async run({ source, page }, signal) {
      const viewed = await shelf.view(source, page, signal);
      if ("refused" in viewed) {
        return { status: "refused", text: viewed.refused };
      }
      return { status: "done", text: viewed.text, image: viewed.image };
    },
  });
}

export function quoteSourceTool(shelf: SourceShelf): TeachingTool {
  return defineTool({
    name: "quote_source",
    description:
      "Quote a passage of the course's sources to the learner. It is looked " +
      "for in the sources' text and, once found, shown in the conversation " +
      "where you call this, in the source's own words with its citation; " +
      "your text goes on below it. Copy the passage from a section you have " +
      "read with read_section: one passage, its words in order, of at least " +
      "three words and at most 1,200 characters, with no ellipsis (quote two " +
      "passages with two calls) and no quotation marks around it. Case, " +
      "spacing, hyphens, curly quotes, emphasis marks, page markers and " +
      "footnote references do not matter. Refused while a question is open. " +
      "Your turn goes on after it.",
    input: QuoteSourceInput,
    async run(input, signal) {
      const problem = quoteTextProblem(input.text);
      if (problem !== undefined) return { status: "refused", text: problem };
      const quoted = await shelf.quote(input, signal);
      if ("refused" in quoted)
        return { status: "refused", text: quoted.refused };
      return { status: "done", text: quoted.text };
    },
  });
}
