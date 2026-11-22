import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { type Processor, unified } from "unified";
import { type Unit, unitSections } from "../shared/curriculum.ts";
import {
  type Outline,
  type OutlineEntry,
  type OutlineSection,
  type PageMarker,
  pageMarkers,
} from "../shared/source.ts";
import { pageLabel, placeSpan } from "../shared/source-lines.ts";
import { citedSpan, quotableSource } from "../shared/source-quote.ts";

export type OutlineRow =
  | {
      id: string;
      title: string;
      place: string | undefined;
      units: number[];
      focused: boolean;
    }
  | { id: string; title: string; children: OutlineRow[]; open: boolean };

export function outlineRows(
  source: Outline,
  units: readonly Unit[],
  focus?: string,
): OutlineRow[] {
  const associations = new Map<string, number[]>();
  units.forEach((unit, index) => {
    for (const ref of unitSections(unit)) {
      const numbers = associations.get(ref);
      if (numbers) numbers.push(index + 1);
      else associations.set(ref, [index + 1]);
    }
  });
  const focusNumber = units.findIndex((unit) => unit.id === focus) + 1;
  function row(entry: OutlineEntry): OutlineRow {
    if ("entries" in entry) {
      const children = entry.entries.map(row);
      return {
        id: children[0]?.id ?? entry.title,
        title: entry.title,
        children,
        open: children.some((child) =>
          "open" in child ? child.open : child.units.length > 0,
        ),
      };
    }
    const reads = associations.get(`${source.id}/${entry.id}`) ?? [];
    return {
      id: entry.id,
      title: entry.title,
      place: placeSpan(source, entry.place),
      units: reads,
      focused: reads.includes(focusNumber),
    };
  }
  return source.entries.map(row);
}

export interface Margin {
  at: number;
  label: string;
  page?: number;
  loss?: string;
}

export interface ReaderPart {
  id: string;
  /** A separate document per stretch: GFM names its footnotes locally. */
  prefix: string;
  format: Outline["format"];
  text: string;
  margins: Margin[];
  mark?: { start: number; end: number };
}

/**
 * A PDF's text is its printed characters. Of Markdown the conversion writes
 * only headings and notes, and its own backslashes (`PDF_ESCAPE`), so
 * nothing else in the text is read as syntax: not emphasis, code, links,
 * lists, quotes, tables, entities or other escapes. Used after `remarkGfm`,
 * whose notes it keeps.
 */
export function pdfSyntax(this: Processor) {
  const data = this.data();
  data.micromarkExtensions = [
    ...(data.micromarkExtensions ?? []),
    {
      disable: {
        null: [
          "attention",
          "autolink",
          "blockQuote",
          "characterEscape",
          "characterReference",
          "codeFenced",
          "codeIndented",
          "codeText",
          "definition",
          "emailAutolink",
          "hardBreakEscape",
          "htmlFlow",
          "htmlText",
          "labelEnd",
          "labelStartImage",
          "labelStartLink",
          "list",
          "protocolAutolink",
          "setextUnderline",
          "strikethrough",
          "table",
          "tasklistCheck",
          "thematicBreak",
          "wwwAutolink",
        ],
      },
    },
  ];
  // GFM also looks through the finished text for addresses to link.
  data.fromMarkdownExtensions = (data.fromMarkdownExtensions ?? []).map(
    (extension) =>
      [extension].flat().map((one) => ({ ...one, transforms: [] })),
  );
}

const parser = unified().use(remarkParse).use(remarkGfm).freeze();
const pdfParser = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(pdfSyntax)
  .freeze();

/** Extract definitions as Markdown (including all their indented blocks).
 * A reference without a local definition is ordinarily just text to GFM;
 * supplying candidates lets GFM distinguish it from escapes and code. */
interface SectionNotes {
  definitions: Map<string, string>;
  references: Set<string>;
}
function notesOf(text: string, format: Outline["format"]): SectionNotes {
  const definitions = new Map<string, string>();
  const references = new Set<string>();
  if (!text.includes("[^")) return { definitions, references };
  const candidates = new Set(
    [...text.matchAll(/\[\^((?:\\.|[^\s[\]\\])+)\]/g)].map((m) => m[0]),
  );
  const tree = (format === "pdf" ? pdfParser : parser).parse(
    text + [...candidates].map((label) => `\n\n${label}: note`).join(""),
  );
  function visit(node: (typeof tree.children)[number]): void {
    const at = node.position?.start.offset;
    if (at === undefined || at >= text.length) return;
    if (node.type === "footnoteDefinition")
      definitions.set(
        node.identifier,
        text.slice(at, node.position?.end.offset),
      );
    if (node.type === "footnoteReference") references.add(node.identifier);
    if ("children" in node) node.children.forEach(visit);
  }
  tree.children.forEach(visit);
  return { definitions, references };
}

function stretch(section: OutlineSection): number {
  return Number(section.id.slice(1)) - (section.part?.number ?? 1) + 1;
}

export type SectionRead = (id: string, signal: AbortSignal) => Promise<string>;

/**
 * Reads of a source's sections that keep each text once it has come, for as
 * long as a pane stays on the source: a converted source does not change.
 * A read that failed or was cancelled is asked for again.
 */
export function keptTexts(read: SectionRead): SectionRead {
  const kept = new Map<string, string>();
  return async (id, signal) => {
    const saved = kept.get(id);
    if (saved !== undefined) return saved;
    const text = await read(id, signal);
    kept.set(id, text);
    return text;
  };
}

/** Offsets in the outline count code points; Markdown positions count UTF-16. */
function paragraphMargins(text: string, section: OutlineSection): Margin[] {
  if (!("paragraphs" in section.place)) return [];
  const { first: firstNumber } = section.place.paragraphs;
  let codePoint = 0;
  let unit = 0;
  const offsetOf = (offset: number) => {
    while (codePoint < offset && unit < text.length) {
      unit += (text.codePointAt(unit) ?? 0) > 0xffff ? 2 : 1;
      codePoint++;
    }
    return unit;
  };
  // Heading lines at the start precede the first numbered paragraph.
  let first = 0;
  for (const heading of section.headings ?? []) {
    if (/\S/.test(text.slice(first, offsetOf(heading.start)))) break;
    first = offsetOf(heading.end);
  }
  // A heading at the end of a section can follow its numbered paragraphs.
  codePoint = 0;
  unit = 0;
  return [
    { at: first, label: `¶ ${firstNumber}` },
    ...(section.paragraphStarts ?? []).map((offset, index) => ({
      at: offsetOf(offset),
      label: `¶ ${firstNumber + index + 1}`,
    })),
  ];
}

/** A read through one opened section, extended only as far as its citation
 * requires. Supplemental note definitions and inherited page flags are data,
 * not extra sections to show in the pane. */
export async function openSection(
  source: Outline,
  order: readonly OutlineSection[],
  id: string,
  quote: string | undefined,
  load: (id: string) => Promise<string>,
): Promise<ReaderPart[]> {
  const start = order.findIndex((s) => s.id === id);
  const first = order[start];
  if (!first) throw new Error("This section is not in the source's outline.");
  const texts = new Map<string, Promise<string>>();
  function textOf(section: OutlineSection) {
    let saved = texts.get(section.id);
    if (!saved) {
      saved = load(section.id);
      texts.set(section.id, saved);
    }
    return saved;
  }
  const shown = [{ section: first, text: await textOf(first) }];
  let mark: ReaderPart["mark"];
  if (quote) {
    // A cut can fall inside a word or an emphasis run. The preceding part
    // supplies parsing and word-boundary context, never a possible start.
    const previous =
      first.part && first.part.number > 1 ? order[start - 1] : undefined;
    const preceding = previous
      ? [{ ref: `${source.id}/${previous.id}`, text: await textOf(previous) }]
      : [];
    const shift = preceding[0]?.text.length ?? 0;
    for (;;) {
      const candidate = quotableSource(
        source,
        preceding.concat(
          shown.map(({ section, text }) => ({
            ref: `${source.id}/${section.id}`,
            text,
          })),
        ),
      );
      const { span, more } = citedSpan(quote, candidate, `${source.id}/${id}`);
      // A span that reaches the slice's very end may stop inside a word, and
      // words not found yet may end in the next part: only then read on.
      if (!more || start + shown.length >= order.length) {
        if (span) mark = { start: span.start - shift, end: span.end - shift };
        break;
      }
      // Grow geometrically: even a passage spanning many tiny sections is not
      // reparsed once per cut. Only the matching sections will be displayed.
      for (const section of order.slice(
        start + shown.length,
        start + shown.length * 2,
      ))
        shown.push({ section, text: await textOf(section) });
    }
  }
  const parts: ReaderPart[] = [];
  let absolute = 0;
  let index = start;
  const noteCache = new Map<string, SectionNotes>();
  async function sectionNotes(section: OutlineSection) {
    let notes = noteCache.get(section.id);
    if (!notes) {
      notes = notesOf(await textOf(section), source.format);
      noteCache.set(section.id, notes);
    }
    return notes;
  }
  while (
    index < start + shown.length &&
    (index === start || (mark && absolute < mark.end))
  ) {
    const initial = order[index];
    if (!initial) break;
    const partsStart = absolute;
    const margins: Margin[] = [];
    const pieces: string[] = [];
    const removed: { at: number; length: number }[] = [];
    let removedLength = 0;
    const mappings = new Map<string, string>();
    do {
      const item = shown[index - start];
      if (!item) throw new Error("The quoted section is missing.");
      const { section, text } = item;
      const offset = absolute - partsStart;
      if (source.format === "pdf" && "pages" in section.place) {
        const markers = pageMarkers(text);
        const page = section.place.pages.first;
        if (index === start && markers[0]?.page !== page) {
          let previous: PageMarker | undefined;
          for (let i = index - 1; i >= 0 && !previous; i--) {
            const before = order[i];
            if (
              !before ||
              !("pages" in before.place) ||
              before.place.pages.last < page
            )
              break;
            previous = pageMarkers(await textOf(before)).findLast(
              (m) => m.page === page,
            );
          }
          markers.unshift({
            page,
            start: 0,
            end: 0,
            math: previous?.math ?? false,
            images: previous?.images ?? false,
          });
        }
        let from = 0;
        for (const m of markers) {
          const loss = [m.math && "math", m.images && "images"]
            .filter(Boolean)
            .join(" and ");
          margins.push({
            at: offset + m.start - removedLength,
            page: m.page,
            label: pageLabel(source, m.page),
            ...(loss && { loss }),
          });
          pieces.push(text.slice(from, m.start));
          removed.push({ at: offset + m.start, length: m.end - m.start });
          removedLength += m.end - m.start;
          from = m.end;
        }
        pieces.push(text.slice(from));
      } else {
        for (const margin of paragraphMargins(text, section))
          margins.push({ ...margin, at: offset + margin.at });
        pieces.push(text);
      }
      for (const [label, def] of Object.entries(section.noteDefinitions ?? {}))
        mappings.set(label.toLowerCase(), def);
      absolute += text.length;
      index++;
    } while (
      mark &&
      absolute < mark.end &&
      stretch(shown[index - start]?.section ?? initial) === stretch(initial)
    );
    let text = pieces.join("");
    if (source.format !== "text" && text.includes("[^")) {
      const local = notesOf(text, source.format);
      for (const label of local.references) {
        if (local.definitions.has(label)) continue;
        let definition: string | undefined;
        const target = mappings.get(label);
        if (target) {
          const entry = order.find((s) => s.id === target);
          if (entry)
            definition = (await sectionNotes(entry)).definitions.get(label);
        } else if (source.format !== "epub" || source.converter < 8) {
          const inStretch = (s: OutlineSection) =>
            stretch(s) === stretch(initial);
          // Read together: a search through a whole source is one wait.
          const defined = async (sections: readonly OutlineSection[]) =>
            (await Promise.all(sections.map(sectionNotes))).flatMap(
              (notes) => notes.definitions.get(label) ?? [],
            );
          [definition] = await defined(order.filter(inStretch));
          if (!definition && source.format !== "pdf") {
            // Legacy EPUBs do not preserve external targets. Never silently
            // attach the first note in a different stretch with this label.
            const elsewhere = await defined(order.filter((s) => !inStretch(s)));
            if (elsewhere.length === 1) [definition] = elsewhere;
          }
        }
        if (definition) text += `\n\n${definition}`;
      }
    }
    const position = (raw: number) =>
      raw -
      removed.reduce(
        (total, m) => total + Math.min(m.length, Math.max(raw - m.at, 0)),
        0,
      );
    parts.push({
      id: initial.id,
      prefix: `reader-${source.id}-${initial.id}-`,
      format: source.format,
      text,
      margins,
      ...(mark && {
        mark: {
          start: position(Math.max(0, mark.start - partsStart)),
          end: position(Math.min(absolute, mark.end) - partsStart),
        },
      }),
    });
  }
  return parts;
}
