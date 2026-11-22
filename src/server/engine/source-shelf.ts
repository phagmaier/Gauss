// What the tutor reads of its course's sources (task 4.8): a section's
// text for read_section, after a line naming it,
// and a PDF page's image for view_page, rendered by `convert.py page` in the
// engine's sandbox the first time it is asked for and kept in the source's
// pages/ (DataRoot.pageImage). Each read and each page looked at is shown in
// the thread. Neither depends on the unit's phase. And the passages it
// quotes with quote_source (task 4.9), looked for in a shared course index
// off the server thread and shown when found, as the unit's chat allows
// (`QuoteDesk`).

import type { Slug } from "../../shared/course.ts";
import type { PageEvent } from "../../shared/events.ts";
import {
  type Outline,
  pageMarkers,
  passageRangeProblem,
  type SectionPlace,
  type SectionRef,
  sectionsByRef,
} from "../../shared/source.ts";
import { QUOTE_NOT_FOUND } from "../../shared/source-quote.ts";
import type { DataRoot } from "../record/data-root.ts";
import type { SourceShelf } from "../tools/sources.ts";
import {
  NotRendered,
  renderSourcePage,
  type SourceConverter,
} from "./source-convert.ts";
import { findCourseQuote } from "./source-quote-index.ts";
import {
  formatText,
  missingSection,
  numberedParagraphs,
  placeText,
  sectionText,
} from "./source-text.ts";

export type SourceQuoted = Extract<PageEvent, { type: "source_quoted" }>;

/** The unit's chat's part in a quote: whether one can be shown now, and where. */
export interface QuoteDesk {
  /** Why no quote can be shown now, or nothing. */
  closed(): Promise<string | undefined>;
  /**
   * Shows the quote in the thread, unless that closed meanwhile: then why
   * not. Nothing once the turn is stopped.
   */
  show(quote: SourceQuoted, signal?: AbortSignal): Promise<string | undefined>;
  /** The sections the segment under way draws on, where a quote is looked for first. */
  segmentSections(): readonly SectionRef[];
}

export function createSourceShelf(options: {
  dataRoot: DataRoot;
  courseId: Slug;
  courseInstance: string | undefined;
  /** The course's sources, which do not change once it has units. */
  sources: readonly Outline[];
  /** Renders pages not kept yet; none when nothing can be rendered. */
  converter: SourceConverter | undefined;
  /** Shows a read or a page looked at in the thread. */
  emit(event: PageEvent): void;
  /** The default range while teaching a planned segment. */
  plannedRange?(section: SectionRef): SectionPlace | undefined;
  quotes: QuoteDesk;
}): SourceShelf {
  const {
    dataRoot,
    courseId,
    courseInstance,
    sources,
    converter,
    emit,
    quotes,
  } = options;
  const home = { course: courseId };
  const byRef = sectionsByRef(sources);
  const quoteCourse = {
    dataRoot,
    courseId,
    courseInstance,
    sources,
    sections: byRef,
  };
  const sourceIds = sources.map((s) => `"${s.id}"`).join(", ");

  async function sectionFile(ref: SectionRef): Promise<string> {
    const text = await dataRoot.readSection(home, ref);
    if (text === undefined) {
      throw new Error(`The file of the section "${ref}" is missing.`);
    }
    return text;
  }

  /** What the page's marker says its text lost; nothing when no section carries it. */
  async function marker(source: Outline, page: number) {
    for (const found of byRef.values()) {
      const { place } = found.section;
      if (
        found.source !== source ||
        !("pages" in place) ||
        page < place.pages.first ||
        page > place.pages.last
      ) {
        continue;
      }
      const text = await dataRoot.readSection(home, found.ref);
      if (text === undefined) continue;
      const marked = pageMarkers(text).find((m) => m.page === page);
      if (marked !== undefined)
        return { ...marked, literal: text.slice(marked.start, marked.end) };
    }
    return undefined;
  }

  return {
    async read({ section: ref, range: explicit }, signal) {
      const found = byRef.get(ref);
      if (found === undefined) {
        return {
          refused: `"${ref}" cannot be read, since ${missingSection(ref, sources)}.`,
        };
      }
      const range = explicit ?? options.plannedRange?.(ref);
      const { source, section } = found;
      if (range !== undefined) {
        const problem = passageRangeProblem(section, range);
        if (problem !== undefined) return { refused: `"${ref}": ${problem}` };
      }
      let text = await sectionFile(ref);
      if (range !== undefined) {
        if ("pages" in range && "pages" in section.place) {
          const { first, last } = range.pages;
          const markers = pageMarkers(text);
          const at = markers.find((m) => m.page >= first);
          const end = markers.find((m) => m.page > last)?.start;
          if (first === section.place.pages.first && at?.page !== first) {
            // Sections can start halfway down a page whose marker is in
            // the previous section. Keep its flags for view_page.
            const inherited = await marker(source, first);
            text =
              `${inherited?.literal ?? `<!-- page ${first} -->`}\n` +
              text.slice(0, end);
          } else if (at !== undefined && at.page <= last) {
            text = text.slice(at.start, end);
          } else {
            return {
              refused: `"${ref}" has no extracted text in that page range. Look at the pages with view_page.`,
            };
          }
        } else if ("paragraphs" in range) {
          text = numberedParagraphs(text, section, range.paragraphs);
        }
      }
      signal?.throwIfAborted();
      emit({
        type: "section_read",
        section: ref,
        ...(range === undefined ? {} : { range }),
      });
      return {
        text:
          `Section "${ref}" of ${JSON.stringify(source.title)}: ` +
          `${JSON.stringify(section.title)}, ${placeText(range ?? section.place, source)}.` +
          `\n\n${text}`,
      };
    },

    async view(sourceId, page, signal) {
      const source = sources.find((s) => s.id === sourceId);
      if (source === undefined) {
        return {
          refused: `The course has no source "${sourceId}": its sources are ${sourceIds}.`,
        };
      }
      if (source.pages === undefined) {
        return {
          refused:
            `"${sourceId}" is ${formatText(source)}, not a PDF, so it has no ` +
            "pages to look at. Read its sections with read_section.",
        };
      }
      if (page > source.pages.count) {
        return {
          refused:
            `"${sourceId}" has ${source.pages.count} pages, so it has no page ` +
            `${page}. Name a page by its number from 1, as its marker gives it.`,
        };
      }
      let image: Buffer | undefined;
      try {
        image = await dataRoot.pageImage(home, sourceId, page, (o, png) =>
          renderSourcePage(converter, o, page, png, signal),
        );
      } catch (error) {
        if (error instanceof NotRendered) return { refused: error.message };
        throw error;
      }
      if (image === undefined) {
        throw new Error(`The source "${sourceId}" is missing.`);
      }
      signal?.throwIfAborted();
      const marked = await marker(source, page);
      signal?.throwIfAborted();
      emit({
        type: "page_viewed",
        source: source.id,
        page,
        ...(marked?.math ? { math: true } : {}),
        ...(marked?.images ? { images: true } : {}),
      });
      return {
        text: `The image of ${placeText({ pages: { first: page, last: page } }, source)} of ${JSON.stringify(source.title)}.`,
        image: { data: image, mimeType: "image/png" },
      };
    },

    async quote({ text, section }, signal) {
      if (section !== undefined && !byRef.has(section)) {
        return {
          refused: `There is no section "${section}" to look in, since ${missingSection(section, sources)}.`,
        };
      }
      const closed = await quotes.closed();
      if (closed !== undefined) return { refused: closed };
      const found = await findCourseQuote(
        quoteCourse,
        text,
        () => ({
          ...(section === undefined ? {} : { section }),
          segment: quotes.segmentSections(),
        }),
        signal,
      );
      signal?.throwIfAborted();
      if (found === undefined) return { refused: QUOTE_NOT_FOUND };
      const where = byRef.get(found.section);
      if (where === undefined)
        throw new Error("The quote's section is not in the outlines.");
      const { at } = found;
      const refused = await quotes.show(
        {
          type: "source_quoted",
          section: found.section,
          text: found.text,
          ...(at === undefined ? {} : { at }),
        },
        signal,
      );
      if (refused !== undefined) return { refused };
      const start =
        at === undefined
          ? ""
          : "heading" in at
            ? `, starting at the heading ${JSON.stringify(at.heading)}`
            : `, starting at ${placeText(
                "page" in at
                  ? { pages: { first: at.page, last: at.page } }
                  : { paragraphs: { first: at.paragraph, last: at.paragraph } },
                where.source,
              )}`;
      return {
        text:
          "Shown to the learner in the source's own words, with its " +
          `citation: found in ${sectionText(where)}${start}. Go on with your reply.`,
      };
    },
  };
}
