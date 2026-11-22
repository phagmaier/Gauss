// Lexical search over the quote worker's source text. Search previews are
// not quotes; a hit points back to the range read_section should return.
import type {
  ReadSectionInput,
  SearchSourceInput,
} from "../../shared/source.ts";
import {
  PDF_NOTE,
  type QuotableSource,
  wordsOf,
} from "../../shared/source-quote.ts";

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
  // NFKC, as the quote checker folds: a PDF's "ﬁ" ligature is "fi".
  const words = query.normalize("NFKC").match(new RegExp(`${WORD}+`, "gu"));
  if (words === null) return [];
  const bounded = (body: string) =>
    new RegExp(`(?<!${WORD})${body}(?!${WORD})`, "iu");
  const phrase = bounded(words.join(`[^${WORD_CHARS}]+`));
  const terms = [...new Set(words)].map(bounded);
  const best: { hit: PassageHit; match: Match }[] = [];
  for (const book of sources) {
    if (source !== undefined && book.source.id !== source) continue;
    const joins = [...book.markup.joins].sort((a, b) => a - b);
    let joined: QuotableSource["markup"] | undefined;
    for (const { section, range, start, end } of spans(book)) {
      // A PDF's note definitions are hidden from quotes but are the page's text.
      let notes = "";
      if (book.source.format === "pdf") {
        for (const note of book.text.slice(start, end).matchAll(PDF_NOTE))
          notes += `\n\n${note[0].replace(/^\[\^[^\]\s]+\]:\s*/, "").trim()}`;
      }
      let text = `${wordsOf(book, start, end)}${notes}`.normalize("NFKC");
      let match = locate(text, phrase, terms);
      // A word hyphenated at a line's end, also without its hyphen, as quotes match it.
      if (match?.phrase !== true && holdsJoin(joins, start, end)) {
        joined ??= joinedMarkup(book);
        const whole =
          `${wordsOf({ text: book.text, markup: joined }, start, end)}${notes}`.normalize(
            "NFKC",
          );
        const other = locate(whole, phrase, terms);
        if (
          other !== undefined &&
          (match === undefined || other.phrase || other.width < match.width)
        ) {
          text = whole;
          match = other;
        }
      }
      if (match === undefined) continue;
      const found = match;
      const before = best.findIndex(({ match: other }) =>
        found.phrase !== other.phrase
          ? found.phrase
          : !found.phrase && found.width < other.width,
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

/** Whether a joined hyphen, of the sorted `joins`, lies in [start, end). */
function holdsJoin(joins: readonly number[], start: number, end: number) {
  let low = 0;
  let high = joins.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if ((joins[mid] ?? end) < start) low = mid + 1;
    else high = mid;
  }
  return (joins[low] ?? end) < end;
}

/** The markup with each joined hyphen hidden too. */
function joinedMarkup(book: QuotableSource): QuotableSource["markup"] {
  const { markup } = book;
  const hidden = markup.hidden.slice();
  for (const hyphen of markup.joins) hidden[hyphen] = 1;
  return { ...markup, hidden };
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
