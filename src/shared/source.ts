// A source's outline, `sources/<source id>/outline.json`, which
// `pytools/convert.py` writes when the source is converted (architecture.md
// section 8). A section is a leaf of the outline and the only entry with a
// file, `sections/<section id>.md`; the files in reading order are the
// source's whole text. A course names a section `<source id>/<section id>`.

import { z } from "zod";
import { Slug } from "./course.ts";

export const SourceFormat = z.enum(["pdf", "epub", "text", "markdown"]);
export type SourceFormat = z.infer<typeof SourceFormat>;

/** A section's id in its source: `s1`, `s2`, ... in reading order. */
export const SectionId = z.string().regex(/^s[1-9][0-9]*$/);
export type SectionId = z.infer<typeof SectionId>;

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
  z.object({ pages: Range }),
  z.object({ paragraphs: Range }),
]);
export type SectionPlace = z.infer<typeof SectionPlace>;

export const OutlineSection = z.object({
  id: SectionId,
  /** For a part of a cut stretch, "<the stretch's title> (part n of m)". */
  title: z.string().min(1),
  /** Characters of the section's file. */
  size: Count,
  place: SectionPlace,
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
export const OutlineHeading = z.object({
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
  /** The converter's version: the same original and version give the same files. */
  converter: Count,
  /** The section size, in characters, that stretches were cut at. */
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
