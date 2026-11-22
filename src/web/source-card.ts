// What a source's card in the intake says (piece 22), in the learner's
// words: what was found in a converted file, with no character counts, or
// why a file was refused and what would work instead.

import type {
  SourceFacts,
  SourceFormat,
  SourceRefusal,
} from "../shared/source.ts";

export const FORMAT_NAMES: Record<SourceFormat, string> = {
  pdf: "PDF",
  epub: "EPUB",
  text: "Text",
  markdown: "Markdown",
};

/** A line of the card's facts: its words in bold, then the rest. */
export interface Fact {
  bold: string;
  rest: string;
}

function count(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "a", "a and b", "a, b, and c". */
function listed(items: readonly string[]): string {
  if (items.length <= 2) return items.join(" and ");
  return `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;
}

/** The stretches cut that the card names; the rest are counted. */
const CUT_NAMED = 2;
/** The runs of pages with no text that the card names. */
const BLANK_NAMED = 4;

export function factLines(facts: SourceFacts): Fact[] {
  const lines: Fact[] = [];
  const { pages, cut } = facts;
  if (pages !== undefined) {
    lines.push({
      bold: count(pages.count, "page"),
      rest: pages.labelled ? ", with its own page numbers" : "",
    });
  }
  lines.push({ bold: count(facts.sections, "section"), rest: "" });
  if (cut.length > 0) {
    const named = cut
      .slice(0, CUT_NAMED)
      .map((stretch) => `${stretch.title} into ${stretch.parts}`);
    const more = cut.length - named.length;
    lines.push({
      bold: `${count(cut.length, "long stretch", "long stretches")} cut into parts`,
      rest:
        ", between paragraphs, so that the tutor reads one at a time: " +
        listed(more > 0 ? [...named, `${more} more`] : named),
    });
  }
  if (pages !== undefined && pages.blank.count > 0) {
    const { runs } = pages.blank;
    const named = runs
      .slice(0, BLANK_NAMED)
      .map((run) =>
        run.first === run.last ? run.first : `${run.first} to ${run.last}`,
      );
    const more = runs.length > named.length ? ", and more" : "";
    lines.push({
      bold: `${count(pages.blank.count, "page")} with no text`,
      rest: ` (${named.join(", ")}${more}): blank, or pictures`,
    });
  }
  return lines;
}

/** A refused file's card: its title, and what would work instead. */
export function refusalCard(refusal: SourceRefusal): {
  title: string;
  instead: string | undefined;
} {
  switch (refusal.reason) {
    case "format":
      return {
        title: "Gauss cannot read this file",
        instead:
          "Gauss reads PDF, EPUB, plain text and Markdown (.txt, .md). Saved " +
          "as one of these from the program that made it, it works.",
      };
    case "empty":
      return {
        title: "This file has no text",
        instead:
          "A copy that holds its text works, such as a PDF saved from the " +
          "program that made it.",
      };
    case "scanned":
      return {
        title: "This PDF is a scan",
        instead:
          "A copy with a text layer works: most publishers' PDFs and e-books " +
          "have one.",
      };
    case "protected":
      return {
        title: "This file is locked",
        instead:
          "A copy without DRM works; so does a PDF that needs no password.",
      };
    case "large":
      return {
        title: "This file is too large",
        instead:
          "A copy with only the part you want to study works, and so does " +
          "one with its pictures compressed.",
      };
    case "failed":
      return {
        title: "The conversion failed",
        instead:
          "The file may be damaged: a fresh download, or a copy saved again " +
          "from a PDF reader, may work.",
      };
    case "timed-out":
      return {
        title: "The conversion took too long",
        instead:
          "Try again; if it stops again, the file is likely unusual in a way " +
          "the converter does not handle.",
      };
    case "sandbox":
      return {
        title: "Sources need the sandbox",
        instead: "The server says what the sandbox needs when it starts.",
      };
  }
}
