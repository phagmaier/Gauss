// A source as a model reads it (architecture.md section 8): its outline, one
// line per entry, indented by depth. A heading's line is its title; a
// section's has its id, title, place and size. A section as a header or a
// tool's result names it. And why the units a planner proposes cannot name
// the sections they name.

import { type Unit, unitSections } from "../../shared/curriculum.ts";
import {
  type Outline,
  type OutlineEntry,
  type SectionPlace,
  type SourceFormat,
  type SourceSection,
  sectionsByRef,
  UNIT_TEXT_LIMIT,
} from "../../shared/source.ts";

/**
 * A source as a planner is told of it: what it is, then its outline, one
 * line per entry.
 */
export function sourceLines(outline: Outline): string[] {
  return [
    `${JSON.stringify(outline.title)} (source id "${outline.id}"), ` +
      `${formatText(outline)}, from the learner's file ${JSON.stringify(outline.name)}. ` +
      "Its outline, one line per entry, indented by depth: a heading's " +
      "title, or a section's id, title, place and size in characters.",
    ...outlineLines(outline),
  ];
}

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
  const label = (page: number) =>
    labels[page - 1]?.trim().replace(/\s+/g, " ") || String(page);
  const start = label(first);
  const end = first === last ? start : label(last);
  if (start === String(first) && end === String(last)) return pages;
  return `${pages} (printed ${first === last ? start : `${start}–${end}`})`;
}

/**
 * A section as the tutor's header names it: `"phenomenology/s2", "Preface
 * (part 2 of 6)", pages 15–20 (printed 7–12)`.
 */
export function sectionText(found: SourceSection): string {
  return (
    `${JSON.stringify(found.ref)}, ${JSON.stringify(found.section.title)}, ` +
    placeText(found.section.place, found.source)
  );
}

/**
 * Sections as the tutor's header lists them, in the order given, between
 * semicolons, since titles have commas; a name the sources lack, alone.
 */
export function sectionsText(
  refs: readonly string[],
  sources: readonly Outline[],
): string {
  const byRef = sectionsByRef(sources);
  return refs
    .map((ref) => {
      const found = byRef.get(ref);
      return found === undefined ? JSON.stringify(ref) : sectionText(found);
    })
    .join("; ");
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

/**
 * Why the units cannot name the sections they name, for the planner that
 * proposed them: a section the course's sources do not have, and a unit
 * whose sections hold more than UNIT_TEXT_LIMIT characters, with its total
 * so the planner can split it. Nothing when they can.
 */
export function sectionsRefused(
  units: readonly Unit[],
  sources: readonly Outline[],
): string | undefined {
  const named = units.filter((u) => unitSections(u).length > 0);
  if (named.length === 0) return undefined;
  if (sources.length === 0) {
    return (
      "This course has no source, so no unit names sections: leave " +
      '"sections" out of every unit.'
    );
  }
  const byRef = sectionsByRef(sources);
  const problems: string[] = [];
  for (const unit of named) {
    let total = 0;
    for (const ref of unitSections(unit)) {
      const found = byRef.get(ref);
      if (found !== undefined) {
        total += found.section.size;
        continue;
      }
      problems.push(
        `Unit "${unit.id}" names "${ref}", but ${missingSection(ref, sources)}.`,
      );
    }
    if (total > UNIT_TEXT_LIMIT) {
      problems.push(
        `Unit "${unit.id}" reads ${total.toLocaleString("en-US")} characters, ` +
          `more than the ${UNIT_TEXT_LIMIT.toLocaleString("en-US")} a unit can ` +
          "read. Split it into units that each read fewer sections.",
      );
    }
  }
  return problems.length === 0 ? undefined : problems.join("\n");
}

/**
 * Why the sources have no section by this name, for the model that named
 * it: the course has no such source, or the source no such section.
 */
export function missingSection(
  ref: string,
  sources: readonly Outline[],
): string {
  const [sourceId = ""] = ref.split("/");
  const source = sources.find((s) => s.id === sourceId);
  if (source === undefined) {
    return `the course has no source "${sourceId}": its sources are ${sources.map((s) => `"${s.id}"`).join(", ")}`;
  }
  const count = sectionCount(source);
  return count === 1
    ? `"${sourceId}" has no such section: its one section is s1`
    : `"${sourceId}" has no such section: its sections are s1 to s${count}`;
}

function sectionCount(outline: Outline): number {
  const count = (entries: readonly OutlineEntry[]): number =>
    entries.reduce(
      (n, entry) => n + ("id" in entry ? 1 : count(entry.entries)),
      0,
    );
  return count(outline.entries);
}
