// A source's outline, `sources/<source id>/outline.json`, which
// `pytools/convert.py` writes when the source is converted. A section is a
// leaf of the outline and the only entry with a
// file, `sections/<section id>.md`; the files in reading order are the
// source's whole text. A course names a section `<source id>/<section id>`
// (`SectionRef`): a unit, the sections it teaches, and a segment of its plan,
// those it draws on. Also what the intake's card shows of a file the learner
// attached (piece 22): a converted source's facts, or why the file is not a
// source.

import { z } from "zod";
import { Slug } from "./course.ts";

export const SourceFormat = z.enum(["pdf", "epub", "text", "markdown"]);
export type SourceFormat = z.infer<typeof SourceFormat>;

/** A section's id in its source: `s1`, `s2`, ... in reading order. */
export const SectionId = z.string().regex(/^s[1-9][0-9]*$/);
export type SectionId = z.infer<typeof SectionId>;

/** A section as a course names it: `<source id>/<section id>`. */
export const SectionRef = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*\/s[1-9][0-9]*$/, {
    error:
      'Name a section as "<source id>/<section id>", such as "phenomenology/s3".',
  });
export type SectionRef = z.infer<typeof SectionRef>;

/**
 * The most text a unit reads, in the unit of `OutlineSection.size`: its
 * sections' sizes summed (docs/findings.md, "Source conversion").
 */
export const UNIT_TEXT_LIMIT = 150_000;

const Count = z.number().int().positive();

const Range = z
  .object({ first: Count, last: Count })
  .refine((range) => range.first <= range.last, {
    error: "The first comes after the last.",
  });

/**
 * Where a section sits in the original: its first and last page for a PDF
 * (pages counted from 1; `Outline.pages.labels` gives their printed
 * labels), otherwise its first and last paragraph, numbered within the
 * stretch of its heading, the text from the heading to the next one.
 */
export const SectionPlace = z.union([
  z.strictObject({ pages: Range }),
  z.strictObject({ paragraphs: Range }),
]);
export type SectionPlace = z.infer<typeof SectionPlace>;

/**
 * Where a quote starts: its PDF page (counted from 1), its paragraph
 * within the stretch, or a heading that is outside its numbered paragraphs.
 */
export const QuoteStart = z.union([
  z.strictObject({ page: Count }),
  z.strictObject({ paragraph: Count }),
  z.strictObject({ heading: z.string().min(1) }),
]);
export type QuoteStart = z.infer<typeof QuoteStart>;

export const OutlineSection = z.strictObject({
  id: SectionId,
  /** For a part of a cut stretch, "<the stretch's title> (part n of m)". */
  title: z.string().min(1),
  /** Unicode code points in the section's file, not UTF-16 code units. */
  size: Count,
  place: SectionPlace,
  /**
   * For a section placed by its paragraphs: where each of its paragraphs
   * after its first starts in its text, in code points, so that a quote is
   * cited at its paragraph. Absent from sources converted before version 6.
   */
  paragraphStarts: z.array(Count).optional(),
  /** An EPUB reference whose definition lives in another section: label to section id (from converter 8). */
  noteDefinitions: z.record(z.string(), SectionId).optional(),
  /** Non-paragraph headings in this file, with section-relative code-point spans. */
  headings: z
    .array(
      z.strictObject({
        start: z.number().int().nonnegative(),
        end: Count,
        title: z.string().min(1),
      }),
    )
    .optional(),
  /**
   * For a stretch cut into parts at the size limit: which part this is. The
   * parts sit in their stretch's heading, or at the top for the text before
   * any heading, whose title is the source's.
   */
  part: z
    .object({ number: Count, of: z.number().int().min(2) })
    .refine((part) => part.number <= part.of, {
      error: "The part's number is more than its count.",
    })
    .optional(),
});
export type OutlineSection = z.infer<typeof OutlineSection>;

/**
 * A heading with its entries: the section of its text before its first
 * subheading, or that section's parts, then its subheadings'. A heading with
 * no text of its own has its lines in the next section's file, or at the
 * end of the last one's.
 */
export const OutlineHeading = z.strictObject({
  title: z.string().min(1),
  get entries(): z.ZodArray<
    z.ZodUnion<[typeof OutlineSection, typeof OutlineHeading]>
  > {
    return z.array(z.union([OutlineSection, OutlineHeading]));
  },
});
export type OutlineHeading = z.infer<typeof OutlineHeading>;

export const OutlineEntry = z.union([OutlineSection, OutlineHeading]);
export type OutlineEntry = z.infer<typeof OutlineEntry>;

export const Outline = z.object({
  /** The source's folder's name. */
  id: Slug,
  title: z.string().min(1),
  /** The copy of the original in the source's folder, `original.<ext>`. */
  file: z.string().min(1),
  /** The original's name as the learner gave it. */
  name: z.string().min(1),
  format: SourceFormat,
  /** Of the original. */
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  /** Converter version; output is repeatable for the same inputs and version. */
  converter: Count,
  /** Target section size, in Unicode code points. */
  limit: Count,
  /** A PDF's pages. */
  pages: z
    .object({
      count: Count,
      /** Each page's printed label, where the PDF defines labels. */
      labels: z.array(z.string()).optional(),
      /** The pages with no text: blank, or pictures. */
      blank: z.array(Count),
    })
    .optional(),
  entries: z.array(OutlineEntry).min(1),
});
export type Outline = z.infer<typeof Outline>;

/** The sources of a course, as the page reads them. */
export const CourseSources = z.object({ sources: z.array(Outline) });
export type CourseSources = z.infer<typeof CourseSources>;

/**
 * A section with what is needed to name it: its source, and the title of
 * its stretch, its heading's for a part of a cut stretch (the source's for
 * the text before any heading), else its own.
 */
export interface SourceSection {
  ref: SectionRef;
  source: Outline;
  section: OutlineSection;
  stretch: string;
}

/** The sections of the sources, each by its `SectionRef`. */
export function sectionsByRef(
  sources: readonly Outline[],
): Map<SectionRef, SourceSection> {
  const found = new Map<SectionRef, SourceSection>();
  for (const source of sources) {
    const walk = (entries: readonly OutlineEntry[], heading: string) => {
      for (const entry of entries) {
        if ("id" in entry) {
          const ref = `${source.id}/${entry.id}`;
          found.set(ref, {
            ref,
            source,
            section: entry,
            stretch: entry.part === undefined ? entry.title : heading,
          });
        } else {
          walk(entry.entries, entry.title);
        }
      }
    };
    walk(source.entries, source.title);
  }
  return found;
}

/** What the tutor asks read_section for (task 4.8): a section of the course's sources. */
export const ReadSectionInput = z.object({
  section: SectionRef.describe(
    'The section, as "<source id>/<section id>" from the outlines under "# Sources" in your instructions, such as "phenomenology/s3".',
  ),
});
export type ReadSectionInput = z.infer<typeof ReadSectionInput>;

/** What the tutor asks view_page for (task 4.8): a page of a PDF source. */
export const ViewPageInput = z.object({
  source: Slug.describe(
    'The source\'s id, as the outlines under "# Sources" in your instructions give it.',
  ),
  page: Count.describe(
    "The page's number, counted from 1, as its page marker gives it: not its printed label.",
  ),
});
export type ViewPageInput = z.infer<typeof ViewPageInput>;

/**
 * What the tutor gives quote_source (task 4.9): a passage of the course's
 * sources, and the section it was copied from, whose match comes first.
 */
export const QuoteSourceInput = z.object({
  text: z
    .string()
    .describe(
      "The passage, copied from a section you have read: its words in order, without quotation marks around it.",
    ),
  section: SectionRef.optional().describe(
    'The section you copied it from, as "<source id>/<section id>": where the passage is found there, that is the one shown.',
  ),
});
export type QuoteSourceInput = z.infer<typeof QuoteSourceInput>;

/**
 * A page marker in a PDF section's text, `<!-- page 31 label "5" math
 * images -->`: the page, counted from 1, and
 * whether its text lost math, and whether images cover some of it; and
 * where the marker starts and ends in the text.
 */
export interface PageMarker {
  page: number;
  math: boolean;
  images: boolean;
  start: number;
  end: number;
}

/** The PDF's inserted page markers, excluding literal comments escaped by the converter. */
export function pageMarkers(text: string): PageMarker[] {
  return [
    ...text.matchAll(
      /(?<!\\)<!-- page ([1-9][0-9]*)(?: label "[^"]*")?( math)?( images)? -->/g,
    ),
  ].map((match) => ({
    page: Number(match[1]),
    math: match[2] !== undefined,
    images: match[3] !== undefined,
    start: match.index,
    end: match.index + match[0].length,
  }));
}

/** The largest file the intake takes as a source (piece 22): 100 MB. */
export const SOURCE_SIZE_LIMIT = 100 * 1024 * 1024;

/** A size in bytes as the page and the planner read it: "5.7 MB", "84 KB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes === 1 ? "1 byte" : `${bytes} bytes`;
  const [value, unit] =
    bytes < 1024 * 1024
      ? [bytes / 1024, "KB"]
      : bytes < 1024 * 1024 * 1024
        ? [bytes / (1024 * 1024), "MB"]
        : [bytes / (1024 * 1024 * 1024), "GB"];
  const shown = value < 10 ? value.toFixed(1) : Math.round(value).toString();
  return `${shown.replace(/\.0$/, "")} ${unit}`;
}

/**
 * What the intake's card says of a converted source (piece 22), taken from
 * its outline by `sourceFacts`.
 */
export const SourceFacts = z.object({
  id: Slug,
  title: z.string().min(1),
  /** The original's name as the learner gave it. */
  name: z.string().min(1),
  format: SourceFormat,
  sections: Count,
  /**
   * A PDF's pages: how many, whether the PDF prints labels of its own, and
   * the pages with no text, as runs of consecutive pages, each end by its
   * printed label or else its number.
   */
  pages: z
    .object({
      count: Count,
      labelled: z.boolean(),
      blank: z.object({
        count: z.number().int().nonnegative(),
        runs: z.array(z.object({ first: z.string(), last: z.string() })),
      }),
    })
    .optional(),
  /** Each stretch cut into parts at the size limit, in reading order. */
  cut: z.array(
    z.object({ title: z.string().min(1), parts: z.number().int().min(2) }),
  ),
});
export type SourceFacts = z.infer<typeof SourceFacts>;

export function sourceFacts(outline: Outline): SourceFacts {
  let sections = 0;
  const cut: SourceFacts["cut"] = [];
  const walk = (entries: readonly OutlineEntry[], stretch: string) => {
    for (const entry of entries) {
      if ("id" in entry) {
        sections += 1;
        if (entry.part?.number === 1) {
          cut.push({ title: stretch, parts: entry.part.of });
        }
      } else {
        walk(entry.entries, entry.title);
      }
    }
  };
  // The parts of the text before any heading sit at the top, under the
  // source's title.
  walk(outline.entries, outline.title);
  const facts: SourceFacts = {
    id: outline.id,
    title: outline.title,
    name: outline.name,
    format: outline.format,
    sections,
    cut,
  };
  const { pages } = outline;
  if (pages === undefined) return facts;
  const label = (page: number) => pages.labels?.[page - 1] || String(page);
  const runs: { first: string; last: string }[] = [];
  let start: number | undefined;
  const blank = [...pages.blank].sort((a, b) => a - b);
  for (const [i, page] of blank.entries()) {
    start ??= page;
    const next = blank[i + 1];
    if (next !== page + 1) {
      runs.push({ first: label(start), last: label(page) });
      start = undefined;
    }
  }
  return {
    ...facts,
    pages: {
      count: pages.count,
      labelled: pages.labels !== undefined,
      blank: { count: blank.length, runs },
    },
  };
}

/**
 * Why a file the learner attached is not a source (piece 22), with a
 * sentence the card shows and the planner is told: the converter's
 * refusals ("format", "empty", "scanned", "protected"), a file over
 * SOURCE_SIZE_LIMIT, a conversion that failed or ran out of time, and no
 * sandbox to convert it in.
 */
export const SourceRefusal = z.object({
  reason: z.enum([
    "format",
    "empty",
    "scanned",
    "protected",
    "large",
    "failed",
    "timed-out",
    "sandbox",
  ]),
  detail: z.string().min(1),
});
export type SourceRefusal = z.infer<typeof SourceRefusal>;
