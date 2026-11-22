// A source as a model reads it (architecture.md section 8): its outline, one
// line per entry, indented by depth. A heading's line is its title; a
// section's has its id, title, place and size.

import type {
  Outline,
  OutlineEntry,
  SectionPlace,
  SourceFormat,
} from "../../shared/source.ts";

/** The outline's lines: `- "Preface"`, then `  - s1: "Preface (part 1 of 6)", pages 9–14 (printed 1–6), 15,203 characters`. */
export function outlineLines(outline: Outline): string[] {
  const lines: string[] = [];
  const walk = (entries: readonly OutlineEntry[], depth: number) => {
    const indent = "  ".repeat(depth);
    for (const entry of entries) {
      if ("id" in entry) {
        lines.push(
          `${indent}- ${entry.id}: ${JSON.stringify(entry.title)}, ` +
            `${placeText(entry.place, outline)}, ` +
            `${entry.size.toLocaleString("en-US")} characters`,
        );
      } else {
        lines.push(`${indent}- ${JSON.stringify(entry.title)}`);
        walk(entry.entries, depth + 1);
      }
    }
  };
  walk(outline.entries, 0);
  return lines;
}

/**
 * Where a section sits: its pages, counted from 1, with the printed labels
 * where the PDF has labels that differ; else its paragraphs, numbered
 * within its heading's stretch.
 */
export function placeText(place: SectionPlace, outline: Outline): string {
  if ("paragraphs" in place) {
    const { first, last } = place.paragraphs;
    return first === last
      ? `paragraph ${first}`
      : `paragraphs ${first}–${last}`;
  }
  const { first, last } = place.pages;
  const pages = first === last ? `page ${first}` : `pages ${first}–${last}`;
  const labels = outline.pages?.labels;
  if (labels === undefined) return pages;
  const label = (page: number) => labels[page - 1] || String(page);
  if (label(first) === String(first) && label(last) === String(last)) {
    return pages;
  }
  const printed =
    first === last ? label(first) : `${label(first)}–${label(last)}`;
  return `${pages} (printed ${printed})`;
}

/** "a PDF of 543 pages", "an EPUB", "a plain text file", "a Markdown file". */
export function formatText(outline: Outline): string {
  const names: Record<SourceFormat, string> = {
    pdf: "a PDF",
    epub: "an EPUB",
    text: "a plain text file",
    markdown: "a Markdown file",
  };
  const name = names[outline.format];
  const pages = outline.pages?.count;
  return pages === undefined
    ? name
    : `${name} of ${pages} page${pages === 1 ? "" : "s"}`;
}
