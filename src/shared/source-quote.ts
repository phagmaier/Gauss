// Verify a single passage within one source, including across section cuts.
// Search the visible text by a folded key, with a map back to the original
// code units for whole-word checks, display, and citation.

import {
  type Outline,
  type OutlineSection,
  type PageMarker,
  pageMarkers,
  type QuoteStart,
  type SectionRef,
  type SourceFormat,
  sectionsByRef,
} from "./source.ts";
import { markdownQuoteMarkup } from "./source-quote-markup.ts";

/** The fewest words a quote has. */
export const QUOTE_MIN_WORDS = 3;
/** The most characters a quote has, as the tutor gives it. */
export const QUOTE_MAX_CHARACTERS = 1_200;

/**
 * Why the tutor's passage cannot be quoted as it is, before it is looked
 * for: too long, holding an ellipsis, or too short. Nothing if it can.
 */
export function quoteTextProblem(text: string): string | undefined {
  const trimmed = text.trim();
  const characters = codePoints(trimmed, 0, trimmed.length);
  if (characters > QUOTE_MAX_CHARACTERS) {
    return (
      `The passage is ${characters.toLocaleString("en-US")} characters, over ` +
      `the limit of ${QUOTE_MAX_CHARACTERS.toLocaleString("en-US")}: quote the ` +
      "sentences that carry the point, and say the rest in your own words."
    );
  }
  if (/…|\.\s*\.\s*\./.test(text)) {
    return (
      "The passage holds an ellipsis, so it is not one passage as the source " +
      "has it: quote each part with a call of its own."
    );
  }
  if (wordCount(text) < QUOTE_MIN_WORDS) {
    return (
      `The passage has fewer than ${QUOTE_MIN_WORDS} words: quote at least ` +
      `${QUOTE_MIN_WORDS}, the phrase with the words around it.`
    );
  }
  return undefined;
}

/** Why a passage looked for was not found, for the tutor. */
export const QUOTE_NOT_FOUND =
  "The passage was not found in the course's sources. Copy it exactly, its " +
  "words in order, from a section you have read with read_section: case, " +
  "spacing, hyphens, curly quotes, emphasis marks, page markers and footnote " +
  "references do not matter, but every word does.";

/** A source's sections in reading order: by their ids' ordinals, not the outline's order. */
export function orderedSections(source: Outline): OutlineSection[] {
  return [...sectionsByRef([source]).values()]
    .map(({ section }) => section)
    .sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
}

export function readingOrder(source: Outline): SectionRef[] {
  return orderedSections(source).map((section) => `${source.id}/${section.id}`);
}

/** A source's whole text, made ready to look for quotes in. */
export interface QuotableSource {
  source: Outline;
  text: string;
  /** Its sections in reading order, each where it starts and ends in `text`. */
  sections: readonly SectionSpan[];
  markup: Markup;
  key: Key;
  pages: readonly PageMarker[];
}

interface SectionSpan {
  ref: SectionRef;
  start: number;
  end: number;
  entry: OutlineSection | undefined;
}

/** Conservative backing-store estimate for the worker's quote cache, excluding the outline. */
export function quotableSourceBytes(quote: QuotableSource): number {
  const { text, key, markup, pages, sections } = quote;
  return (
    2 * (text.length + key.key.length) +
    key.from.buffer.byteLength +
    markup.hidden.byteLength +
    48 * (markup.breaks.size + markup.joins.size) +
    96 * (pages.length + sections.length + markup.headings.length)
  );
}

/** The source with its sections' texts, given in reading order (`readingOrder`). */
export function quotableSource(
  source: Outline,
  sections: readonly { ref: SectionRef; text: string }[],
): QuotableSource {
  let text = "";
  const byRef = sectionsByRef([source]);
  const spans: SectionSpan[] = [];
  for (const { ref, text: part } of sections) {
    spans.push({
      ref,
      start: text.length,
      end: text.length + part.length,
      entry: byRef.get(ref)?.section,
    });
    text += part;
  }
  const pages =
    source.format === "pdf"
      ? pageMarkers(text).filter(
          (marker) => marker.page <= (source.pages?.count ?? Infinity),
        )
      : [];
  const markup = markupOf(text, source.format, pages, source.converter < 7);
  return {
    source,
    text,
    sections: spans,
    markup,
    key: keyOf(text, markup.hidden),
    pages,
  };
}

/** A quote found: where it starts, and the source's words for it. */
export interface FoundQuote {
  section: SectionRef;
  text: string;
  /** Its page, paragraph, or heading, when known. */
  at: QuoteStart | undefined;
}

interface Preference {
  section?: SectionRef;
  segment?: readonly SectionRef[];
}

/**
 * The passage, looked for in each source. Where it is found more than once,
 * the match in the named section comes first, then one in the segment's
 * sections, then the first in reading order, the sources in the order
 * given. A match starts and ends at the ends of words in the source.
 */
export function findQuote(
  passage: string,
  sources: readonly QuotableSource[],
  prefer: Preference = {},
): FoundQuote | undefined {
  const plain = keyOf(passage, markupOf(passage, "text").hidden, false).key;
  const bestPossible = bestRankFor(prefer);
  let chosen = bestMatch(plain, sources, prefer, 5);
  if (chosen?.rank !== bestPossible) {
    // A tutor can copy Markdown out of read_section or copy its rendered words.
    const { hidden } = markupOf(passage, "quote");
    const copied = keyOf(passage, hidden, false).key;
    const tryKey = (key: string, pdfOnly = false) => {
      const match = bestMatch(key, sources, prefer, chosen?.rank ?? 5, pdfOnly);
      if (match !== undefined) chosen = match;
    };
    if (copied !== plain) tryKey(copied);
    if (chosen?.rank !== bestPossible) {
      const markers = pageMarkers(passage);
      for (const marker of markers) hidden.fill(1, marker.start, marker.end);
      const pdf =
        markers.length > 0 ? keyOf(passage, hidden, false).key : copied;
      if (pdf !== copied) tryKey(pdf, true);
      if (chosen === undefined) {
        // A word's leading or trailing apostrophe can be literal; retry pairs only.
        for (const key of new Set([
          withoutQuotePair(plain),
          withoutQuotePair(copied),
        ])) {
          if (key !== undefined) tryKey(key);
        }
        const unquotedPdf = withoutQuotePair(pdf);
        if (pdf !== copied && unquotedPdf !== undefined)
          tryKey(unquotedPdf, true);
      }
    }
  }
  if (chosen === undefined) return undefined;
  const { quotable, start, end } = chosen;
  const section = sectionAt(quotable, start);
  return {
    section: section.ref,
    text: wordsOf(quotable, start, end),
    at: startOf(quotable, section, start),
  };
}

/**
 * Where a stored quote's words, which a search verified, are in the source,
 * as a span of UTF-16 units. Unlike the tutor's search, a citation starts
 * in its section or nowhere. `more`: text after the source's could change
 * the answer, by ending the span inside a word or by holding the words' end.
 */
export function citedSpan(
  passage: string,
  quotable: QuotableSource,
  section: SectionRef,
): { span: { start: number; end: number } | undefined; more: boolean } {
  // The words are the source's already: a number on a line of its own is
  // one of them, where in a passage typed from a page it is a line's number.
  const { key } = keyOf(passage, new Uint8Array(passage.length), false);
  const match = bestMatch(key, [quotable], { section }, 1);
  if (match !== undefined) {
    return {
      span: { start: match.start, end: match.end },
      more: match.end === quotable.text.length,
    };
  }
  // Words that start in the section end within their own length of its end.
  const end = quotable.sections.find((s) => s.ref === section)?.end;
  const { from } = quotable.key;
  let after = from.length;
  while (after > 0 && (from[after - 1] ?? 0) >= (end ?? 0)) after -= 1;
  return { span: undefined, more: from.length - after < key.length };
}

function withoutQuotePair(key: string): string | undefined {
  const first = key[0];
  const last = key.at(-1);
  return key.length > 2 &&
    ((first === last && (first === "'" || first === '"')) ||
      (first === "«" && last === "»") ||
      (first === "»" && last === "«") ||
      (first === "‹" && last === "›") ||
      (first === "›" && last === "‹"))
    ? key.slice(1, -1)
    : undefined;
}

/** The section holding the text at `start`. */
function sectionAt(
  quotable: QuotableSource,
  start: number,
): QuotableSource["sections"][number] {
  const section = quotable.sections[sectionIndexAt(quotable, start)];
  if (section === undefined)
    throw new Error("The match is past the text's end.");
  return section;
}

function sectionIndexAt(quotable: QuotableSource, start: number): number {
  const { sections } = quotable;
  let low = 0;
  let high = sections.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if ((sections[mid]?.end ?? 0) <= start) low = mid + 1;
    else high = mid;
  }
  return low;
}

interface Match {
  quotable: QuotableSource;
  start: number;
  end: number;
  rank: number;
}

function bestRankFor(prefer: Preference): number {
  return prefer.section !== undefined ? 0 : prefer.segment?.length ? 2 : 4;
}

/** Keep only the best match; common phrases need not allocate one entry per occurrence. */
function bestMatch(
  needle: string,
  sources: readonly QuotableSource[],
  prefer: Preference,
  limit: number,
  pdfOnly = false,
): Match | undefined {
  const bestPossible = bestRankFor(prefer);
  if (needle === "" || limit <= bestPossible) return undefined;
  let bestRank = limit;
  let found: Match | undefined;
  for (const quotable of sources) {
    if (pdfOnly && quotable.source.format !== "pdf") continue;
    const { key, from } = quotable.key;
    for (
      let at = key.indexOf(needle);
      at !== -1;
      at = key.indexOf(needle, at + 1)
    ) {
      const last = at + needle.length - 1;
      // Not from the middle of a character the key spells as several.
      const start = from[at];
      const lastUnit = from[last];
      if (
        start === undefined ||
        lastUnit === undefined ||
        from[at - 1] === start ||
        from[last + 1] === lastUnit
      )
        continue;
      const end =
        lastUnit +
        ((quotable.text.codePointAt(lastUnit) ?? 0) > 0xffff ? 2 : 1);
      if (!wholeWords(quotable, start, end)) continue;
      const rank = matchRank(quotable, start, end, prefer);
      if (rank < bestRank) {
        found = { quotable, start, end, rank };
        bestRank = rank;
        if (rank === bestPossible) return found;
      }
    }
  }
  return found;
}

function matchRank(
  quotable: QuotableSource,
  start: number,
  end: number,
  { section, segment = [] }: Preference,
): number {
  if (section === undefined && segment.length === 0) return 4;
  const index = sectionIndexAt(quotable, start);
  const first = quotable.sections[index]?.ref;
  if (first === section) return 0;
  let rank = first !== undefined && segment.includes(first) ? 2 : 4;
  for (let i = index + 1; i < quotable.sections.length; i += 1) {
    const next = quotable.sections[i];
    if (next === undefined || next.start >= end) break;
    if (next.start === next.end) continue;
    if (next.ref === section) return 1;
    if (rank === 4 && segment.includes(next.ref)) rank = 3;
  }
  return rank;
}

/** Cite the actual heading, paragraph or PDF page that contains the start. */
function startOf(
  quotable: QuotableSource,
  section: SectionSpan,
  start: number,
): QuoteStart | undefined {
  const { entry } = section;
  if (entry === undefined) return undefined;
  const { place } = entry;
  if ("pages" in place) {
    const marker = quotable.pages.findLast((m) => m.start <= start);
    return { page: marker?.page ?? place.pages.first };
  }
  // Converter positions count code points, not UTF-16 code units.
  const offset = codePoints(quotable.text, section.start, start);
  const heading = entry.headings?.find(
    (h) => offset >= h.start && offset < h.end,
  );
  if (heading !== undefined) return { heading: heading.title };
  const legacy = quotable.markup.headings.find(
    (h) => start >= h.start && start < h.end,
  );
  if (legacy !== undefined) {
    const headingOffset = codePoints(
      quotable.text,
      section.start,
      legacy.start,
    );
    // Older EPUB outlines do not distinguish all headings from numbered blocks.
    if (
      quotable.source.format === "markdown" ||
      !entry.paragraphStarts?.includes(headingOffset)
    )
      return { heading: legacy.title };
  }
  if (entry.paragraphStarts === undefined) return undefined;
  const before = entry.paragraphStarts.findLastIndex((s) => s <= offset) + 1;
  return { paragraph: place.paragraphs.first + before };
}

function codePoints(text: string, start: number, end: number): number {
  let count = 0;
  for (let i = start; i < end; count += 1)
    i += (text.codePointAt(i) ?? 0) > 0xffff ? 2 : 1;
  return count;
}

// ---- Markup: what in a text is not the source's words

/** Hidden syntax and the positions of hard breaks, joined hyphens and legacy headings. */
interface Markup {
  hidden: Uint8Array;
  breaks: ReadonlySet<number>;
  joins: ReadonlySet<number>;
  headings: readonly { start: number; end: number; title: string }[];
}

/** "quote": the tutor's passage, which may carry what it copied from a section's text. */
type Kind = SourceFormat | "quote";

const NUMBER_LINE = /(?:^|(?<=\n))[ \t]*[0-9]{1,4}[ \t]*(?:\n|$)/g;
const PDF_NOTE = /^\[\^[^\]\s]+\]:[^\n]*(?:\n|$)/gm;
/** The backslashes the PDF conversion writes: before a line's leading mark, and before a printed page marker. */
export const PDF_ESCAPE = /(?:^|(?<=\n))\\(?=[#><])|\\(?=<!-- page )/g;
const REFERENCES = /\[\^[^\]\s]+\]/g;

function markupOf(
  text: string,
  kind: Kind,
  markers: readonly PageMarker[] = [],
  legacyHeadings = false,
): Markup {
  const hidden = new Uint8Array(text.length);
  const hide = (start: number, end: number) => hidden.fill(1, start, end);
  const hideAll = (pattern: RegExp) => {
    for (const m of text.matchAll(pattern))
      hide(m.index, m.index + m[0].length);
  };
  hideAll(NUMBER_LINE);
  for (const marker of markers) hide(marker.start, marker.end);
  let breaks: ReadonlySet<number> = EMPTY_POSITIONS;
  let headings: Markup["headings"] = [];
  if (kind === "pdf") {
    hideAll(PDF_NOTE);
    hideAll(PDF_ESCAPE);
    hideAll(REFERENCES);
  } else if (kind !== "text") {
    ({ breaks, headings } = markdownQuoteMarkup(
      text,
      kind,
      hidden,
      legacyHeadings,
    ));
  }
  const joins = joinSoftWraps(text, hidden, breaks);
  return { hidden, breaks, joins, headings };
}

const EMPTY_POSITIONS: ReadonlySet<number> = new Set();
const HYPHEN = /^[-\u00ad\u2010\u2011]$/u;
const LETTER_OR_MARK = /^[\p{L}\p{M}]$/u;
const INLINE_SPACE = /[^\S\n]/u;

/** A soft LF between a trailing hyphen and the next part of its word is not a gap. */
function joinSoftWraps(
  text: string,
  hidden: Uint8Array,
  breaks: ReadonlySet<number>,
): ReadonlySet<number> {
  let joins: Set<number> | undefined;
  for (
    let lf = text.indexOf("\n");
    lf !== -1;
    lf = text.indexOf("\n", lf + 1)
  ) {
    if (hidden[lf] === 1 || breaks.has(lf)) continue;
    let hyphen = lf - 1;
    while (
      hyphen >= 0 &&
      (hidden[hyphen] === 1 || INLINE_SPACE.test(text[hyphen] ?? ""))
    )
      hyphen -= 1;
    if (!HYPHEN.test(text[hyphen] ?? "")) continue;
    let before = hyphen - 1;
    while (hidden[before] === 1) before -= 1;
    if (before < 0 || !LETTER_OR_MARK.test(charAt(text, before))) continue;
    let after = lf + 1;
    while (
      after < text.length &&
      (hidden[after] === 1 || INLINE_SPACE.test(text[after] ?? ""))
    )
      after += 1;
    if (after === text.length || !LETTER_OR_MARK.test(charAt(text, after)))
      continue;
    hidden.fill(1, hyphen + 1, after);
    joins ??= new Set();
    joins.add(hyphen);
  }
  return joins ?? EMPTY_POSITIONS;
}

const WORD = /^[\p{L}\p{N}\p{M}]$/u;

// ---- The key

/** A text's key, and for each of its code units the text's unit it came from. */
interface Key {
  key: string;
  from: Uint32Array;
}

function keyOf(text: string, hidden: Uint8Array, mapOffsets = true): Key {
  // Chunk the key so a long source does not retain an array entry per character.
  const chunks: string[] = [];
  const chunk: string[] = [];
  let from = new Uint32Array(mapOffsets ? text.length : 0);
  let length = 0;
  for (let i = 0; i < text.length; ) {
    const code = text.codePointAt(i) ?? 0;
    if (hidden[i] !== 1) {
      const folded = fold(code);
      if (folded !== "") {
        if (mapOffsets) {
          const end = length + folded.length;
          if (end > from.length) {
            const larger = new Uint32Array(Math.max(end, from.length * 2));
            larger.set(from);
            from = larger;
          }
          if (folded.length === 1) from[length] = i;
          else from.fill(i, length, end);
          length = end;
        }
        chunk.push(folded);
        if (chunk.length === 4096) {
          chunks.push(chunk.join(""));
          chunk.length = 0;
        }
      }
    }
    i += code > 0xffff ? 2 : 1;
  }
  if (chunk.length > 0) chunks.push(chunk.join(""));
  return { key: chunks.join(""), from: from.subarray(0, length) };
}

/** What the key makes of a character that is not ASCII: nothing, or another. */
const FOLDED: Record<string, string> = {
  // Hyphens: a soft one, the Unicode hyphen and the one that does not break.
  "\u00ad": "",
  "\u2010": "",
  "\u2011": "",
  // Curly quotes as straight ones.
  "\u2018": "'",
  "\u2019": "'",
  "\u201a": "'",
  "\u201b": "'",
  "\u201c": '"',
  "\u201d": '"',
  "\u201e": '"',
  "\u201f": '"',
  // Every dash as one.
  "\u2012": "\u2014",
  "\u2013": "\u2014",
  "\u2015": "\u2014",
};

/** A character as the key has it: folded, or nothing. */
function fold(code: number): string {
  if (code < 0x80) {
    if (code <= 0x20 || code === 0x2d) return "";
    return String.fromCharCode(code >= 0x41 && code <= 0x5a ? code + 32 : code);
  }
  let out = "";
  // Unicode's compatibility forms too: a ligature as its letters, an accent
  // apart from its letter either way it is written.
  for (const c of String.fromCodePoint(code).normalize("NFKD")) {
    out +=
      c < "\x80"
        ? fold(c.charCodeAt(0))
        : /\s/.test(c)
          ? ""
          : (FOLDED[c] ?? foldCase(c));
  }
  return out;
}

function foldCase(c: string): string {
  // After NFKD, compare in the lower-case representative of each
  // Unicode caseless equivalence class. Uppercase bridges e.g. ς and σ.
  // Dotless i does not fold with i; capital sharp S folds as sharp s does.
  if (c === "ı") return c;
  if (c === "ẞ") return "ss";
  return c.toUpperCase().toLowerCase();
}

// ---- The match in the source's words

/** Whether the span starts and ends where words do, markup aside. */
function wholeWords(
  { text, markup }: QuotableSource,
  start: number,
  end: number,
): boolean {
  let before = start - 1;
  while (before >= 0 && markup.hidden[before] === 1) before -= 1;
  let after = end;
  while (after < text.length && markup.hidden[after] === 1) after += 1;
  const word = (at: number) =>
    at >= 0 && at < text.length && WORD.test(charAt(text, at));
  const { joins } = markup;
  return (
    !(word(start) && (word(before) || joins.has(before))) &&
    !(word(end - 1) && (word(after) || joins.has(after)))
  );
}

/**
 * The span's words: markup left out, a paragraph break as a blank line, a
 * line break as a newline, a word hyphenated at a line's end joined with its
 * hyphen, and other whitespace as a space.
 */
function wordsOf(
  { text, markup }: Pick<QuotableSource, "text" | "markup">,
  start: number,
  end: number,
): string {
  let out = "";
  let newlines = 0;
  let lineBreak = false;
  let space = false;
  for (let i = start; i < end; i++) {
    if (markup.hidden[i] === 1) continue;
    const c = text[i] ?? "";
    if (/\s/.test(c)) {
      space = true;
      if (c === "\n") {
        newlines += 1;
        if (markup.breaks.has(i)) lineBreak = true;
      }
      continue;
    }
    if (space) {
      if (out !== "") out += newlines >= 2 ? "\n\n" : lineBreak ? "\n" : " ";
      space = false;
      newlines = 0;
      lineBreak = false;
    }
    out += c;
  }
  return out;
}

/** The whole character at a code unit, a surrogate pair's second half too. */
function charAt(text: string, at: number): string {
  const code = text.charCodeAt(at);
  if (code >= 0xdc00 && code <= 0xdfff && at > 0) {
    return String.fromCodePoint(text.codePointAt(at - 1) ?? code);
  }
  return String.fromCodePoint(text.codePointAt(at) ?? code);
}

/** The passage's words, its markup left out, for the shortest quote. */
function wordCount(text: string): number {
  const markup = markupOf(text, "quote", pageMarkers(text));
  const visible = wordsOf({ text, markup }, 0, text.length);
  return visible.split(/\s+/u).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}
