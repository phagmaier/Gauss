// What the tutor reads of its course's sources (task 4.8): a section's
// text for read_section, after a line naming it,
// and a PDF page's image for view_page, rendered by `convert.py page` in the
// engine's sandbox the first time it is asked for and kept in the source's
// pages/ (DataRoot.pageImage). Each read and each page looked at is shown in
// the thread. A read without a range takes the teaching segment's planned
// range while that segment is taught (`plannedRange`); a page view does not
// depend on the phase. And the passages it
// quotes with quote_source (task 4.9), looked for in a shared course index
// off the server thread and shown when found, as the unit's chat allows
// (`QuoteDesk`). verifyQuote checks a lecture's passage, which must start in
// the section named, without showing it.

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
import { type FoundQuote, QUOTE_NOT_FOUND } from "../../shared/source-quote.ts";
import type { DataRoot } from "../record/data-root.ts";
import type { SourceQuoted, SourceShelf } from "../tools/sources.ts";
import {
  NotRendered,
  renderSourcePage,
  type SourceConverter,
} from "./source-convert.ts";
import { findCourseQuote, searchCoursePassages } from "./source-quote-index.ts";
import {
  formatText,
  missingSection,
  numberedParagraphs,
  placeText,
  sectionText,
} from "./source-text.ts";

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
  /** The course's sources; a chat makes a new shelf when an Apply adds some. */
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

  /**
   * The marker a read opens with when its section starts partway down its
   * first page, whose marker is in a section before: its flags are what
   * the tutor goes by to look at the page with view_page.
   */
  async function startMarker(source: Outline, page: number) {
    const inherited = await marker(source, page);
    return `${inherited?.literal ?? `<!-- page ${page} -->`}\n`;
  }

  async function locateQuote(
    text: string,
    section: SectionRef | undefined,
    signal?: AbortSignal,
  ): Promise<{ found: FoundQuote } | { refused: string }> {
    if (section !== undefined && !byRef.has(section)) {
      return {
        refused: `There is no section "${section}" to look in, since ${missingSection(section, sources)}.`,
      };
    }
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
    return found === undefined ? { refused: QUOTE_NOT_FOUND } : { found };
  }

  function quoteEvent({ section, text, at }: FoundQuote): SourceQuoted {
    return {
      type: "source_quoted",
      section,
      text,
      ...(at === undefined ? {} : { at }),
    };
  }

  return {
    async search(input, signal) {
      if (
        input.source !== undefined &&
        !sources.some((s) => s.id === input.source)
      ) {
        return {
          refused: `There is no source "${input.source}" to search. This course has ${sourceIds}.`,
        };
      }
      const hits = await searchCoursePassages(quoteCourse, input, signal);
      if (hits.length === 0) {
        return {
          text: "No passage matched. Try fewer or different words from the source, or say you did not find it.",
        };
      }
      const lines = [
        "Local passage matches. Previews are not verified quotes.",
      ];
      for (const [i, { preview, ...read }] of hits.entries()) {
        const found = byRef.get(read.section);
        if (found === undefined)
          throw new Error("Search returned an unknown section.");
        lines.push(
          `${i + 1}. ${sectionText(found, read.range)}\n` +
            `   read_section: ${JSON.stringify(read)}\n   Preview: ${preview}`,
        );
      }
      return { text: lines.join("\n\n") };
    },

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
      if (range === undefined) {
        if (
          "pages" in section.place &&
          pageMarkers(text)[0]?.page !== section.place.pages.first
        ) {
          text = (await startMarker(source, section.place.pages.first)) + text;
        }
      } else if ("pages" in range && "pages" in section.place) {
        const { first, last } = range.pages;
        const markers = pageMarkers(text);
        const at = markers.find((m) => m.page >= first);
        const end = markers.find((m) => m.page > last)?.start;
        if (first === section.place.pages.first && at?.page !== first) {
          text = (await startMarker(source, first)) + text.slice(0, end);
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
      const closed = await quotes.closed();
      if (closed !== undefined) return { refused: closed };
      const result = await locateQuote(text, section, signal);
      if ("refused" in result) return result;
      const { found } = result;
      const where = byRef.get(found.section);
      if (where === undefined)
        throw new Error("The quote's section is not in the outlines.");
      const { at } = found;
      const refused = await quotes.show(quoteEvent(found), signal);
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

    async verifyQuote({ section, text }, signal) {
      const result = await locateQuote(text, section, signal);
      if ("refused" in result) return result;
      if (result.found.section !== section)
        return {
          refused: `The passage does not start in "${section}". Name the section where you copied its start.`,
        };
      return { quote: quoteEvent(result.found) };
    },
  };
}
