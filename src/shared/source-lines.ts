// Where a source's text sits, as the learner reads it (pieces 22 and 23):
// pages by their printed labels, paragraphs as "¶"; and the thread's lines
// for what the tutor read of the sources and the citation of a passage it
// quoted, which the page and the exported transcript both show.

import {
  type Outline,
  type QuoteStart,
  type SectionPlace,
  sectionsByRef,
} from "./source.ts";

/** A source's title up to its first ": ", as a line names the source. */
export function shortTitle(source: Outline): string {
  const colon = source.title.indexOf(": ");
  return colon === -1 ? source.title : source.title.slice(0, colon);
}

/** A page by its printed label where the PDF has labels, else its number. */
export function pageLabel(source: Outline, page: number): string {
  return source.pages?.labels?.[page - 1] || String(page);
}

/** "p. 5", "pp. 5–9": pages by their printed labels. */
export function pagesPlace(
  source: Outline,
  first: number,
  last: number,
): string {
  return first === last
    ? `p. ${pageLabel(source, first)}`
    : `pp. ${pageLabel(source, first)}–${pageLabel(source, last)}`;
}

/** From the start of one place to the end of another, of the same kind. */
export function placeSpan(
  source: Outline,
  from: SectionPlace,
  to: SectionPlace = from,
): string | undefined {
  if ("pages" in from && "pages" in to) {
    return pagesPlace(source, from.pages.first, to.pages.last);
  }
  if ("paragraphs" in from && "paragraphs" in to) {
    const { first } = from.paragraphs;
    const { last } = to.paragraphs;
    return first === last ? `¶ ${first}` : `¶ ${first}–${last}`;
  }
  return undefined;
}

/** A line of the thread on what the tutor read: what, and a quieter word on it. */
export interface DidLine {
  text: string;
  /** A section's place, or what a page's text lost. */
  aside: string | undefined;
}

/**
 * The "Read" line of a section the tutor read (piece 23): its title, after
 * its source's when the course has several, and its place. Its name alone
 * while the outlines are unknown, or when they lack it.
 */
export function readLine(
  ref: string,
  outlines: readonly Outline[] | undefined,
  range?: SectionPlace,
): DidLine {
  const found =
    outlines === undefined ? undefined : sectionsByRef(outlines).get(ref);
  if (outlines === undefined || found === undefined) {
    return { text: ref, aside: undefined };
  }
  const { source, section } = found;
  return {
    text: `${outlines.length > 1 ? `${shortTitle(source)}, ` : ""}${section.title}`,
    aside: placeSpan(source, range ?? section.place),
  };
}

/**
 * The "Looked at" line of a PDF page the tutor looked at (piece 23): the
 * page by its printed label, after its source's title when the course has
 * several, and what its text lost, as its marker says: a page with no text
 * has lost it all.
 */
export function pageLine(
  page: { source: string; page: number; math?: true; images?: true },
  outlines: readonly Outline[] | undefined,
): DidLine {
  const source = outlines?.find((s) => s.id === page.source);
  const prefix =
    source !== undefined && outlines !== undefined && outlines.length > 1
      ? `${shortTitle(source)}, `
      : "";
  const label =
    source === undefined ? String(page.page) : pageLabel(source, page.page);
  const lost = [
    ...(page.math ? ["math"] : []),
    ...(page.images ? ["figures"] : []),
  ];
  return {
    text: `${prefix}page ${label}`,
    aside: source?.pages?.blank.includes(page.page)
      ? "it has no text"
      : lost.length === 0
        ? undefined
        : `its text lost its ${lost.join(" and ")}`,
  };
}

/**
 * A verified quote's citation: the heading or stretch where it starts, never
 * Gauss's part, after its source's short title when the course has several,
 * then its printed page or paragraph, if known. Fall back to the section's
 * reference when the outlines are unknown.
 */
export function quoteCitation(
  quote: { section: string; at?: QuoteStart | undefined },
  outlines: readonly Outline[] | undefined,
): string {
  const { at } = quote;
  const heading = at !== undefined && "heading" in at ? at.heading : undefined;
  const found =
    outlines === undefined
      ? undefined
      : sectionsByRef(outlines).get(quote.section);
  if (outlines === undefined || found === undefined)
    return heading ?? quote.section;
  const { source, stretch } = found;
  return [
    ...(outlines.length > 1 ? [shortTitle(source)] : []),
    heading ?? stretch,
    ...(at === undefined || "heading" in at
      ? []
      : [
          "page" in at
            ? `p. ${pageLabel(source, at.page)}`
            : `¶ ${at.paragraph}`,
        ]),
  ].join(", ");
}
