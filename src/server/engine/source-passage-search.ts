// Lexical search over the quote worker's source text. Search previews are
// not quotes; a hit points back to the range read_section should return.
import type {
  ReadSectionInput,
  SearchSourceInput,
} from "../../shared/source.ts";
import { type QuotableSource, wordsOf } from "../../shared/source-quote.ts";

const RESULT_LIMIT = 5;
const PREVIEW_LIMIT = 320;
const WORD_CHARS = "\\p{L}\\p{M}\\p{N}";
const WORD = `[${WORD_CHARS}]`;

export interface PassageHit extends ReadSectionInput {
  preview: string;
}

interface Span extends ReadSectionInput {
  start: number;
  end: number;
}

interface Match {
  start: number;
  width: number;
  phrase: boolean;
}

/** Phrase matches first, then keyword matches by the span of their first hits. */
export function findPassages(
  { query, source }: SearchSourceInput,
  sources: readonly QuotableSource[],
): PassageHit[] {
  const words = query.normalize("NFC").match(new RegExp(`${WORD}+`, "gu"));
  if (words === null) return [];
  const bounded = (body: string) =>
    new RegExp(`(?<!${WORD})${body}(?!${WORD})`, "iu");
  const phrase = bounded(words.join(`[^${WORD_CHARS}]+`));
  const terms = [...new Set(words)].map(bounded);
  const best: { hit: PassageHit; match: Match }[] = [];
  for (const book of sources) {
    if (source !== undefined && book.source.id !== source) continue;
    for (const { section, range, start, end } of spans(book)) {
      const text = wordsOf(book, start, end).normalize("NFC");
      const match = locate(text, phrase, terms);
      if (match === undefined) continue;
      const before = best.findIndex(({ match: other }) =>
        match.phrase !== other.phrase
          ? match.phrase
          : !match.phrase && match.width < other.width,
      );
      const index = before === -1 ? best.length : before;
      if (index >= RESULT_LIMIT) continue;
      const hit: PassageHit = {
        section,
        ...(range === undefined ? {} : { range }),
        preview: preview(text, match.start),
      };
      best.splice(index, 0, { hit, match });
      if (best.length > RESULT_LIMIT) best.pop();
    }
  }
  return best.map(({ hit }) => hit);
}

function locate(
  text: string,
  phrase: RegExp,
  terms: readonly RegExp[],
): Match | undefined {
  const exact = phrase.exec(text);
  if (exact !== null) return { start: exact.index, width: 0, phrase: true };
  let start = text.length;
  let end = 0;
  for (const term of terms) {
    const hit = term.exec(text);
    if (hit === null) return;
    start = Math.min(start, hit.index);
    end = Math.max(end, hit.index + hit[0].length);
  }
  return { start, width: end - start, phrase: false };
}

function preview(text: string, hit: number): string {
  if (text.length <= PREVIEW_LIMIT) return text;
  let start = Math.min(Math.max(0, hit - 64), text.length - PREVIEW_LIMIT);
  let end = start + PREVIEW_LIMIT;
  // Don't split a Unicode character at either edge of the excerpt.
  if (text.charCodeAt(start) >= 0xdc00 && text.charCodeAt(start) <= 0xdfff)
    start++;
  if (text.charCodeAt(end) >= 0xdc00 && text.charCodeAt(end) <= 0xdfff) end--;
  return `${start === 0 ? "" : "…"}${text.slice(start, end).trim()}${end === text.length ? "" : "…"}`;
}

/** Use converter coordinates, including the first page of a mid-page section. */
function* spans(book: QuotableSource): Generator<Span> {
  let marker = 0;
  for (const { ref: section, start, end, entry } of book.sections) {
    if (entry === undefined) continue;
    const { place, paragraphStarts } = entry;
    if ("pages" in place) {
      let page = place.pages.first;
      let from = start;
      while (true) {
        const next = book.pages[marker];
        if (next === undefined || next.start >= end) break;
        marker++;
        if (next.start < start) continue;
        if (from < next.start) {
          yield {
            section,
            range: { pages: { first: page, last: page } },
            start: from,
            end: next.start,
          };
        }
        page = next.page;
        from = next.end;
      }
      if (from < end)
        yield {
          section,
          range: { pages: { first: page, last: page } },
          start: from,
          end,
        };
    } else {
      const { first, last } = place.paragraphs;
      if (last !== first && paragraphStarts?.length !== last - first) {
        // Older conversions have section locations, but no paragraph offsets.
        yield { section, start, end };
        continue;
      }
      let from = start;
      let at = start;
      let point = 0;
      for (let n = first; n <= last; n++) {
        const offset = paragraphStarts?.[n - first];
        if (offset === undefined) at = end;
        else {
          while (point < offset && at < end) {
            at += (book.text.codePointAt(at) ?? 0) > 0xffff ? 2 : 1;
            point++;
          }
        }
        yield {
          section,
          range: { paragraphs: { first: n, last: n } },
          start: from,
          end: at,
        };
        from = at;
      }
    }
  }
}
