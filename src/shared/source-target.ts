// A section link in a model's text, `source:<source>/<section>`, read once
// for both the page's reader, which opens it, and the exported transcript,
// which names its section and page in words.

import type { SourceSection } from "./source.ts";
import { pageLabel, placeSpan } from "./source-lines.ts";

/** Page numbers inside the reader are physical, counted from one. Only links and labels use print numbering. */
export type SourceTarget =
  | { kind: "outline"; source: string; unit?: string }
  | {
      kind: "section";
      source: string;
      section: string;
      page?: number;
      quote?: string;
      light?: boolean;
    }
  | { kind: "page"; source: string; page: number };

/** `source:book/s2`, optionally `/p<printed label>` within that section. */
export function resolveSourceLink(
  url: string,
  sections: ReadonlyMap<string, SourceSection>,
) {
  const match = /^source:([^/]+\/[^/]+)(?:\/p([^/]+))?$/.exec(url);
  const found = match?.[1] === undefined ? undefined : sections.get(match[1]);
  if (found === undefined) return;
  const { source, section } = found;
  const target: Extract<SourceTarget, { kind: "section" }> = {
    kind: "section",
    source: source.id,
    section: section.id,
    light: true,
  };
  let place = placeSpan(source, section.place);
  if (match?.[2] !== undefined) {
    const { place: where } = section;
    if (!("pages" in where)) return;
    let label: string;
    try {
      label = decodeURIComponent(match[2]);
    } catch {
      return;
    }
    for (let p = where.pages.first; p <= where.pages.last; p++) {
      if (pageLabel(source, p) !== label) continue;
      target.page = p;
      break;
    }
    if (target.page === undefined) return;
    place = `p. ${label}`;
  }
  return {
    target,
    title: place ? `${section.title}, ${place}` : section.title,
  };
}
