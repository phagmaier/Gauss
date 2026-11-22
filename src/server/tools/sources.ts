// The read_section and view_page teaching tools (task 4.8; architecture.md
// sections 5 and 8), given to the tutor of a course with a source: a
// section's text, and a PDF page as an image where the text lost math or
// figures. Teaching tools rather than the tutor's file tools (decisions.md,
// "Sources"). Reading changes nothing in the record, so both are allowed at
// any time; the engine finds the text or the page, says why not, and shows
// each read in the thread. Neither ends the tutor's turn.

import {
  ReadSectionInput,
  type SectionRef,
  ViewPageInput,
} from "../../shared/source.ts";
import { defineTool, type TeachingTool, type ToolImage } from "./tool.ts";

/** Where the course's sources are read. The engine provides it. */
export interface SourceShelf {
  /** The section's text after a line naming it, or why it cannot be read. */
  read(section: SectionRef): Promise<{ text: string } | { refused: string }>;
  /** The page as an image, with a line naming it, or why it cannot be shown. */
  view(
    source: string,
    page: number,
  ): Promise<{ text: string; image: ToolImage } | { refused: string }>;
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
    async run({ section }) {
      const read = await shelf.read(section);
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
    async run({ source, page }) {
      const viewed = await shelf.view(source, page);
      if ("refused" in viewed) {
        return { status: "refused", text: viewed.refused };
      }
      return { status: "done", text: viewed.text, image: viewed.image };
    },
  });
}
