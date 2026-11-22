// What a unit reads of the course's sources, as the proposal card and the
// curriculum change card list it under the unit's goal, and how much of
// each source a card's units read (mock 22, `readsLines` and `proposal`).

import { type Unit, unitSections } from "../shared/curriculum.ts";
import {
  type Outline,
  type SourceSection,
  sectionsByRef,
} from "../shared/source.ts";
import {
  pageLabel,
  pagesPlace,
  placeSpan,
  shortTitle,
} from "../shared/source-lines.ts";

/** A line of a unit's reads: what it reads, and where that is, if known. */
export interface ReadsLine {
  text: string;
  place: string | undefined;
}

/**
 * A unit's reads: a line per section, consecutive parts of one stretch
 * merged, and for more than two lines the one line they fold into.
 */
export interface UnitReads {
  lines: ReadsLine[];
  folded: ReadsLine | undefined;
}

/** Cut parts have consecutive section ids in the converter's reading order. */
function continues(run: SourceSection, next: SourceSection): boolean {
  const a = run.section.part;
  const b = next.section.part;
  return (
    a !== undefined &&
    b !== undefined &&
    run.source.id === next.source.id &&
    run.stretch === next.stretch &&
    a.of === b.of &&
    b.number === a.number + 1 &&
    Number(next.section.id.slice(1)) === Number(run.section.id.slice(1)) + 1
  );
}

function runLine(run: SourceSection[], prefix: boolean): ReadsLine {
  const first = run[0];
  const last = run.at(-1);
  if (first === undefined || last === undefined) {
    throw new Error("A run of sections is never empty.");
  }
  const { part } = first.section;
  const lastPart = last.section.part;
  const text =
    part === undefined
      ? first.section.title
      : run.length === 1 || lastPart === undefined
        ? `${first.stretch}, part ${part.number} of ${part.of}`
        : `${first.stretch}, parts ${part.number} to ${lastPart.number}`;
  return {
    text: prefix ? `${shortTitle(first.source)}, ${text}` : text,
    place: placeSpan(first.source, first.section.place, last.section.place),
  };
}

/** What a unit reads of the course's sources (`outlines`). */
export function unitReads(
  unit: Pick<Unit, "sections">,
  outlines: readonly Outline[],
): UnitReads {
  const known = sectionsByRef(outlines);
  const prefix = outlines.length >= 2;
  const refs = unitSections(unit);
  const lines: ReadsLine[] = [];
  let run: SourceSection[] = [];
  const close = () => {
    if (run.length > 0) lines.push(runLine(run, prefix));
    run = [];
  };
  for (const ref of refs) {
    const found = known.get(ref);
    if (found === undefined) {
      close();
      lines.push({ text: ref, place: undefined });
      continue;
    }
    const last = run.at(-1);
    if (last === undefined || !continues(last, found)) close();
    run.push(found);
  }
  close();
  if (lines.length <= 2) return { lines, folded: undefined };
  return {
    lines,
    folded: {
      // More than two lines means at least three sections.
      text: `${refs.length} sections`,
      place: foldedPlace(refs, known),
    },
  };
}

/** The pages a unit's sections span, when all are pages of one PDF. */
function foldedPlace(
  refs: readonly string[],
  known: ReadonlyMap<string, SourceSection>,
): string | undefined {
  let source: Outline | undefined;
  let first = Number.POSITIVE_INFINITY;
  let last = 0;
  for (const ref of refs) {
    const found = known.get(ref);
    if (found === undefined || !("pages" in found.section.place)) {
      return undefined;
    }
    if (source !== undefined && source.id !== found.source.id) return undefined;
    source = found.source;
    first = Math.min(first, found.section.place.pages.first);
    last = Math.max(last, found.section.place.pages.last);
  }
  return source === undefined ? undefined : pagesPlace(source, first, last);
}

/**
 * A sentence of how much of a source a card's units read, in three parts so
 * that the page can set the source's title in italics.
 */
export interface ShareSentence {
  /** The source's id. */
  source: string;
  before: string;
  title: string;
  after: string;
}

/**
 * For each of the course's sources, how much the units read of it; nothing
 * when no unit names a section.
 */
export function sourceShare(
  units: readonly Pick<Unit, "sections">[],
  outlines: readonly Outline[],
): ShareSentence[] {
  const named = new Set(units.flatMap((unit) => unitSections(unit)));
  if (named.size === 0) return [];
  const known = [...sectionsByRef(outlines).values()];
  return outlines.map((source) => {
    const sections = known.filter((s) => s.source.id === source.id);
    const read = sections.filter((s) => named.has(s.ref));
    const total =
      sections.length === 1
        ? "the 1 section"
        : `the ${sections.length} sections`;
    return {
      source: source.id,
      before: `The units read ${read.length === 0 ? "none" : read.length} of ${total} of `,
      title: source.title,
      after: `${pagesRead(source, read)}.`,
    };
  });
}

/** ": pages 1 to 103 of 543" or ": 103 of its 543 pages" for a PDF read. */
function pagesRead(source: Outline, read: readonly SourceSection[]): string {
  if (source.pages === undefined) return "";
  const pages = new Set<number>();
  for (const { section } of read) {
    if (!("pages" in section.place)) continue;
    const { first, last } = section.place.pages;
    for (let page = first; page <= last; page++) pages.add(page);
  }
  if (pages.size === 0) return "";
  const first = Math.min(...pages);
  const last = Math.max(...pages);
  const { count } = source.pages;
  if (last - first + 1 > pages.size)
    return `: ${pages.size} of its ${count} pages`;
  return first === last
    ? `: page ${pageLabel(source, first)} of ${count}`
    : `: pages ${pageLabel(source, first)} to ${pageLabel(source, last)} of ${count}`;
}
