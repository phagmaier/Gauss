// Verified quotes (task 4.9; architecture.md section 8). The passage the
// tutor gives quote_source is looked for in each of the course's sources,
// its sections joined in reading order, so that a quote across a cut is
// found; never across two sources. Passage and source are compared by a key
// that keeps only what makes the words: it folds case and Unicode's
// compatibility forms, drops whitespace, hyphens, Markdown's emphasis marks
// and backslashes, reads curly quotes as straight and every dash as one. In
// the source it also leaves out what Gauss or the conversion put in the
// text (`Markup`): page markers, footnote references, a PDF paragraph's
// note definitions, the marks of a Markdown or EPUB block quote and of a
// note's definition, escapes, and lines holding only a number of up to four
// digits (margin line numbers). A match is shown in the source's own words,
// without that markup, and cited where it starts: a PDF's page, else its
// paragraph. Also why a passage cannot be quoted before it is looked for.

import {
  type Outline,
  pageMarkers,
  type QuoteStart,
  type SectionRef,
  type SourceFormat,
  sectionsByRef,
} from "./source.ts";

/** The fewest words a quote has. */
export const QUOTE_MIN_WORDS = 3;
/** The most characters a quote has, as the tutor gives it. */
export const QUOTE_MAX_CHARACTERS = 1_200;

/**
 * Why the tutor's passage cannot be quoted as it is, before it is looked
 * for: too long, holding an ellipsis, or too short. Nothing if it can.
 */
export function quoteTextProblem(text: string): string | undefined {
  const characters = [...text.trim()].length;
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
export function readingOrder(source: Outline): SectionRef[] {
  return [...sectionsByRef([source]).values()]
    .sort(
      (a, b) => Number(a.section.id.slice(1)) - Number(b.section.id.slice(1)),
    )
    .map((found) => found.ref);
}

/** A source's whole text, made ready to look for quotes in. */
export interface QuotableSource {
  source: Outline;
  text: string;
  /** Its sections in reading order, each where it starts and ends in `text`. */
  sections: readonly { ref: SectionRef; start: number; end: number }[];
  markup: Markup;
  key: Key;
  /** A PDF's page markers: where each starts in `text`, and its page. */
  pages: readonly { start: number; page: number }[];
}

/** The source with its sections' texts, given in reading order (`readingOrder`). */
export function quotableSource(
  source: Outline,
  sections: readonly { ref: SectionRef; text: string }[],
): QuotableSource {
  let text = "";
  const spans: { ref: SectionRef; start: number; end: number }[] = [];
  for (const { ref, text: part } of sections) {
    spans.push({ ref, start: text.length, end: text.length + part.length });
    text += part;
  }
  const markup = markupOf(text, source.format);
  return {
    source,
    text,
    sections: spans,
    markup,
    key: keyOf(text, markup.hidden),
    pages:
      source.format === "pdf"
        ? pageMarkers(text).map((m) => ({ start: m.start, page: m.page }))
        : [],
  };
}

/** A quote found: where it starts, and the source's words for it. */
export interface FoundQuote {
  section: SectionRef;
  text: string;
  /** Its page or paragraph, when the source's outline can tell. */
  at: QuoteStart | undefined;
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
  prefer: { section?: SectionRef; segment?: readonly SectionRef[] } = {},
): FoundQuote | undefined {
  const key = keyOf(passage, markupOf(passage, "quote").hidden).key;
  // A passage given between quotation marks the source lacks is the words between them.
  const unquoted = key.replace(/^["«»‹›]+|["«»‹›]+$/g, "");
  let found = matches(key, sources);
  if (found.length === 0 && unquoted !== key)
    found = matches(unquoted, sources);
  // In a section: one that starts there, else one that runs into it.
  const inSections = (refs: readonly SectionRef[]) =>
    found.find((f) => refs.includes(sectionAt(f.quotable, f.start).ref)) ??
    found.find((f) =>
      f.quotable.sections.some(
        (s) => refs.includes(s.ref) && f.start < s.end && f.end > s.start,
      ),
    );
  const chosen =
    (prefer.section === undefined ? undefined : inSections([prefer.section])) ??
    inSections(prefer.segment ?? []) ??
    found[0];
  if (chosen === undefined) return undefined;
  const { quotable, start, end } = chosen;
  const section = sectionAt(quotable, start);
  return {
    section: section.ref,
    text: wordsOf(quotable, start, end),
    at: startOf(quotable, section, start),
  };
}

/** The section holding the text at `start`. */
function sectionAt(
  quotable: QuotableSource,
  start: number,
): QuotableSource["sections"][number] {
  const section = quotable.sections.find((s) => start < s.end);
  if (section === undefined)
    throw new Error("The match is past the text's end.");
  return section;
}

interface Match {
  quotable: QuotableSource;
  start: number;
  end: number;
}

/** Where the key is found in the sources, in reading order, each span whole words. */
function matches(needle: string, sources: readonly QuotableSource[]): Match[] {
  const found: Match[] = [];
  if (needle === "") return found;
  for (const quotable of sources) {
    const { key, from } = quotable.key;
    for (
      let at = key.indexOf(needle);
      at !== -1;
      at = key.indexOf(needle, at + 1)
    ) {
      const last = at + needle.length - 1;
      // Not from the middle of a character the key spells as several.
      if (from[at - 1] === from[at] || from[last + 1] === from[last]) continue;
      const start = from[at] ?? 0;
      const lastUnit = from[last] ?? 0;
      const end =
        lastUnit +
        ((quotable.text.codePointAt(lastUnit) ?? 0) > 0xffff ? 2 : 1);
      if (wholeWords(quotable, start, end))
        found.push({ quotable, start, end });
    }
  }
  return found;
}

/** The page or paragraph where the text at `start` is, when the outline can tell. */
function startOf(
  quotable: QuotableSource,
  section: { ref: SectionRef; start: number },
  start: number,
): QuoteStart | undefined {
  const entry = sectionsByRef([quotable.source]).get(section.ref)?.section;
  if (entry === undefined) return undefined;
  const { place } = entry;
  if ("pages" in place) {
    const marker = quotable.pages.findLast((m) => m.start <= start);
    return { page: marker?.page ?? place.pages.first };
  }
  if (entry.paragraphStarts === undefined) return undefined;
  // The outline counts code points.
  const offset = [...quotable.text.slice(section.start, start)].length;
  const before = entry.paragraphStarts.filter((s) => s <= offset).length;
  return { paragraph: place.paragraphs.first + before };
}

// ---- Markup: what in a text is not the source's words

/**
 * The text's code units that are not the source's words, and the newlines
 * that are a line break (a backslash at a line's end, as an EPUB writes
 * `<br>`), not a soft wrap.
 */
interface Markup {
  hidden: Uint8Array;
  breaks: ReadonlySet<number>;
}

/** "quote": the tutor's passage, which may carry what it copied from a section's text. */
type Kind = SourceFormat | "quote";

const NUMBER_LINE = /^[ \t]*[0-9]{1,4}[ \t]*(?:\n|$)/gm;
const QUOTE_MARKS = /^(?:[ \t]*>)+[ \t]?/gm;
// A note's definition, after a block quote's marks or a note's indent.
const DEFINITION = /^(?:[ \t]*>)*[ \t]*\[\^[^\]\s]+\]:[ \t]?/gm;
const PDF_NOTE = /^\[\^[^\]\s]+\]:[^\n]*(?:\n|$)/gm;
const PDF_ESCAPE = /^\\(?=[#><])/gm;
const REFERENCE = /\[\^[^\]\s]+\]/y;
const REFERENCES = /\[\^[^\]\s]+\]/g;

function markupOf(text: string, kind: Kind): Markup {
  const hidden = new Uint8Array(text.length);
  const breaks = new Set<number>();
  const hide = (start: number, end: number) => hidden.fill(1, start, end);
  const hideAll = (pattern: RegExp) => {
    for (const m of text.matchAll(pattern))
      hide(m.index, m.index + m[0].length);
  };
  hideAll(NUMBER_LINE);
  if (kind === "text") return { hidden, breaks };
  for (const marker of pageMarkers(text)) hide(marker.start, marker.end);
  if (kind === "pdf") {
    hideAll(PDF_NOTE);
    hideAll(PDF_ESCAPE);
    hideAll(REFERENCES);
    return { hidden, breaks };
  }
  hideAll(QUOTE_MARKS);
  hideAll(DEFINITION);
  for (let i = 0; i < text.length; i++) {
    if (hidden[i] === 1) continue;
    const c = text[i];
    if (c === "\\") {
      const next = text[i + 1];
      if (next === "\n") {
        hidden[i] = 1;
        breaks.add(i + 1);
      } else if (next !== undefined && ASCII_PUNCTUATION.test(next)) {
        // What it escapes is the source's own character.
        hidden[i] = 1;
        i += 1;
      }
    } else if (c === "[") {
      REFERENCE.lastIndex = i;
      const m = REFERENCE.exec(text);
      if (m !== null) {
        hide(i, i + m[0].length);
        i += m[0].length - 1;
      }
    } else if (c === "*" || (c === "_" && kind !== "epub")) {
      let end = i;
      while (text[end] === c) end += 1;
      if (emphasis(text, i, end, c, kind)) hide(i, end);
      i = end - 1;
    }
  }
  return { hidden, breaks };
}

const ASCII_PUNCTUATION = /^[!-/:-@[-`{-~]$/;

/**
 * Whether a run of `*` or `_` is emphasis. An EPUB escapes every star of its
 * own; elsewhere a run with whitespace on both sides is a character, and so
 * is an underscore inside a word (CommonMark's rules, simplified).
 */
function emphasis(
  text: string,
  start: number,
  end: number,
  mark: string,
  kind: Kind,
): boolean {
  if (kind === "epub") return true;
  const before = text[start - 1] ?? " ";
  const after = text[end] ?? " ";
  if (/\s/.test(before) && /\s/.test(after)) return false;
  return !(mark === "_" && WORD.test(before) && WORD.test(after));
}

const WORD = /^[\p{L}\p{N}\p{M}]$/u;

// ---- The key

/** A text's key, and for each of its code units the text's unit it came from. */
interface Key {
  key: string;
  from: readonly number[];
}

function keyOf(text: string, hidden: Uint8Array): Key {
  const parts: string[] = [];
  const from: number[] = [];
  for (let i = 0; i < text.length; ) {
    const code = text.codePointAt(i) ?? 0;
    const size = code > 0xffff ? 2 : 1;
    if (hidden[i] !== 1) {
      const folded = fold(code);
      for (let k = 0; k < folded.length; k++) from.push(i);
      parts.push(folded);
    }
    i += size;
  }
  return { key: parts.join(""), from };
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
    // Spaces and controls, `-`, `*`, `\` and `_`.
    if (
      code <= 0x20 ||
      code === 0x2d ||
      code === 0x2a ||
      code === 0x5c ||
      code === 0x5f
    ) {
      return "";
    }
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
          : (FOLDED[c] ?? c.toLowerCase());
  }
  return out;
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
  return !(word(before) && word(start)) && !(word(end - 1) && word(after));
}

/**
 * The span's words: markup left out, a paragraph break as a blank line, a
 * line break as a newline, a word hyphenated at a line's end joined with its
 * hyphen, and other whitespace as a space.
 */
function wordsOf(
  { text, markup }: QuotableSource,
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
      const wrapped =
        newlines === 1 && !lineBreak && /\p{L}[-\u00ad\u2010]$/u.test(out);
      out += newlines >= 2 ? "\n\n" : lineBreak ? "\n" : wrapped ? "" : " ";
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
  const { hidden } = markupOf(text, "quote");
  let visible = "";
  for (let i = 0; i < text.length; i++) {
    visible += hidden[i] === 1 ? " " : text[i];
  }
  return visible.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}
