// Source tools for a course with sources: read a section or passage, look
// at a PDF page, show a verified standalone quote, or publish a source
// lecture. The engine supplies the source and the chat's phase rules.

import type { PageEvent } from "../../shared/events.ts";
import {
  PresentLectureInput,
  QuoteSourceInput,
  ReadSectionInput,
  SearchSourceInput,
  ViewPageInput,
} from "../../shared/source.ts";
import { quoteTextProblem } from "../../shared/source-quote.ts";
import { defineTool, type TeachingTool, type ToolImage } from "./tool.ts";

export type SourceQuoted = Extract<PageEvent, { type: "source_quoted" }>;
type LectureEvent = SourceQuoted | Extract<PageEvent, { type: "tutor_text" }>;

/** The chat checks when a lecture is allowed, then publishes it in order. */
export interface LectureDesk {
  closed(): Promise<string | undefined>;
  show(
    events: readonly LectureEvent[],
    signal?: AbortSignal,
  ): Promise<string | undefined>;
}

/** Where the course's sources are read. The engine provides it. */
export interface SourceShelf {
  /** The text after a line naming its place, or why it cannot be read. */
  read(
    input: ReadSectionInput,
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
  /** Verifies a passage starting in the named section, without showing it. */
  verifyQuote(
    input: Required<QuoteSourceInput>,
    signal?: AbortSignal,
  ): Promise<{ quote: SourceQuoted } | { refused: string }>;
  /** A short list of candidate passages, for the tutor only. */
  search(
    input: SearchSourceInput,
    signal?: AbortSignal,
  ): Promise<{ text: string } | { refused: string }>;
}

export function readSectionTool(shelf: SourceShelf): TeachingTool {
  return defineTool({
    name: "read_section",
    description:
      "Read a section or a passage from the course's sources. Name the " +
      'section as "<source id>/<section id>". Before teaching, read each ' +
      "section the segment header names; when a range is planned, omit " +
      "the range to read just that passage. Give an explicit wider range " +
      "when you need adjacent context. In a PDF's " +
      'text, a comment such as `<!-- page 31 label "5" math images -->` ' +
      "starts each page: its number from 1, its printed label, `math` where " +
      "its text lost math and `images` where images cover some of it; look " +
      "at such a page with view_page. Allowed at any time; your turn goes " +
      "on after it.",
    input: ReadSectionInput,
    async run(input, signal) {
      const read = await shelf.read(input, signal);
      if ("refused" in read) return { status: "refused", text: read.refused };
      return { status: "done", text: read.text };
    },
  });
}

export function viewPageTool(shelf: Pick<SourceShelf, "view">): TeachingTool {
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

export function searchSourceTool(
  shelf: Pick<SourceShelf, "search">,
  closed: () => string | undefined,
): TeachingTool {
  return defineTool({
    name: "search_source",
    description:
      "Find a passage in the course's attached sources when discussion or " +
      "a detour needs text beyond what you have read. Searches locally for " +
      "the phrase or all keywords in one passage. Results are previews, " +
      "not verified quotes. Use the returned read_section input for context " +
      "before citing or quoting a new passage. Not for planned lectures or " +
      "while a graded question is open.",
    input: SearchSourceInput,
    async run(input, signal) {
      const refused = closed();
      if (refused !== undefined) return { status: "refused", text: refused };
      const found = await shelf.search(input, signal);
      return "refused" in found
        ? { status: "refused", text: found.refused }
        : { status: "done", text: found.text };
    },
  });
}

export function quoteSourceTool(shelf: SourceShelf): TeachingTool {
  return defineTool({
    name: "quote_source",
    description:
      "Outside a source lecture, quote a passage of the course's sources to the learner. It is looked " +
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

export function presentLectureTool(
  shelf: SourceShelf,
  desk: LectureDesk,
): TeachingTool {
  return defineTool({
    name: "present_lecture",
    description:
      "Publish the complete lecture for a segment taught from sources. Read the " +
      "passages and show any aid first. Supply your prose and verified-quote " +
      "selectors in the order the learner should see them. A quote must copy " +
      "the words from the named section's passage, with no locator comments " +
      "or surrounding quotation marks, at least three words and at most " +
      "1,200 characters, no ellipsis. No lecture block is shown if any quote fails. " +
      "Correct the block named in the refusal, or replace it with a paraphrase, " +
      "then send the whole lecture again. Success ends the turn.",
    input: PresentLectureInput,
    async run({ blocks }, signal) {
      const closed = await desk.closed();
      if (closed !== undefined) return { status: "refused", text: closed };
      const events: LectureEvent[] = [];
      for (const [i, block] of blocks.entries()) {
        if (block.kind === "prose") {
          const last = events.at(-1);
          if (last?.type === "tutor_text") last.text += `\n\n${block.text}`;
          else events.push({ type: "tutor_text", text: block.text });
          continue;
        }
        const problem = quoteTextProblem(block.text);
        if (problem !== undefined)
          return { status: "refused", text: `Block ${i + 1}: ${problem}` };
        const found = await shelf.verifyQuote(block, signal);
        if ("refused" in found)
          return {
            status: "refused",
            text: `Block ${i + 1}: ${found.refused}`,
          };
        events.push(found.quote);
      }
      const refused = await desk.show(events, signal);
      return refused === undefined
        ? {
            status: "done",
            text: "The lecture is shown. End your turn.",
            endTurn: true,
          }
        : { status: "refused", text: refused };
    },
  });
}
