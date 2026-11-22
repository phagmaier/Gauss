// What the tutor reads of its course's sources (task 4.8; architecture.md
// section 8): a section's text for read_section, after a line naming it,
// and a PDF page's image for view_page, rendered by `convert.py page` in the
// engine's sandbox the first time it is asked for and kept in the source's
// pages/ (DataRoot.pageImage). Each read and each page looked at is shown in
// the thread. Neither depends on the unit's phase. And the passages it
// quotes with quote_source (task 4.9), each looked for in the sources'
// whole text (`findQuote`), read once for the chat, and shown in the thread
// when found, as the unit's chat allows (`QuoteDesk`).

import type { Slug } from "../../shared/course.ts";
import type { PageEvent } from "../../shared/events.ts";
import {
  type Outline,
  pageMarkers,
  type SectionRef,
  sectionsByRef,
} from "../../shared/source.ts";
import {
  findQuote,
  QUOTE_NOT_FOUND,
  type QuotableSource,
  quotableSource,
  readingOrder,
} from "../../shared/source-quote.ts";
import type { DataRoot } from "../record/data-root.ts";
import type { SourceShelf } from "../tools/sources.ts";
import type { SourceConverter } from "./source-convert.ts";
import {
  formatText,
  missingSection,
  placeText,
  sectionText,
} from "./source-text.ts";

/** A page that could not be rendered, with why, said to the tutor as a refusal. */
class NotRendered extends Error {}

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
  /** The course's sources, which do not change once it has units. */
  sources: readonly Outline[];
  /** Renders pages not kept yet; none when nothing can be rendered. */
  converter: SourceConverter | undefined;
  /** Shows a read or a page looked at in the thread. */
  emit(event: PageEvent): void;
  quotes: QuoteDesk;
}): SourceShelf {
  const { dataRoot, courseId, sources, converter, emit, quotes } = options;
  const byRef = sectionsByRef(sources);
  const sourceIds = sources.map((s) => `"${s.id}"`).join(", ");

  async function sectionFile(ref: SectionRef): Promise<string> {
    const text = await dataRoot.readSection(courseId, ref);
    if (text === undefined) {
      throw new Error(`The file of the section "${ref}" is missing.`);
    }
    return text;
  }

  /** The sources' whole texts, read at the first quote and kept for the chat. */
  let searching: Promise<QuotableSource[]> | undefined;
  function searched(): Promise<QuotableSource[]> {
    if (searching !== undefined) return searching;
    const reading = Promise.all(
      sources.map(async (source) =>
        quotableSource(
          source,
          await Promise.all(
            readingOrder(source).map(async (ref) => ({
              ref,
              text: await sectionFile(ref),
            })),
          ),
        ),
      ),
    );
    searching = reading;
    // A failed read is tried again at the next quote.
    reading.catch(() => {
      if (searching === reading) searching = undefined;
    });
    return reading;
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
      const text = await dataRoot.readSection(courseId, found.ref);
      const marked = pageMarkers(text ?? "").find((m) => m.page === page);
      if (marked !== undefined) return marked;
    }
    return undefined;
  }

  async function render(
    original: string,
    page: number,
    png: string,
    signal?: AbortSignal,
  ) {
    signal?.throwIfAborted();
    if (converter === undefined || converter.unavailable !== undefined) {
      throw new NotRendered(
        `Pages cannot be rendered here: ${converter?.unavailable ?? "no converter was given"}.`,
      );
    }
    const rendered = await converter.renderPage(original, page, png, signal);
    signal?.throwIfAborted();
    if (rendered.result === "failed") {
      throw new NotRendered(
        `The page could not be rendered: ${rendered.reason}.`,
      );
    }
    if (rendered.result === "timed-out") {
      throw new NotRendered(
        `The page could not be rendered within ${rendered.limit}.`,
      );
    }
  }

  return {
    async read(ref: SectionRef, signal) {
      const found = byRef.get(ref);
      if (found === undefined) {
        return {
          refused: `"${ref}" cannot be read, since ${missingSection(ref, sources)}.`,
        };
      }
      const text = await sectionFile(ref);
      signal?.throwIfAborted();
      emit({ type: "section_read", section: ref });
      const { source, section } = found;
      return {
        text:
          `Section "${ref}" of ${JSON.stringify(source.title)}: ` +
          `${JSON.stringify(section.title)}, ${placeText(section.place, source)}.` +
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
        image = await dataRoot.pageImage(courseId, sourceId, page, (o, png) =>
          render(o, page, png, signal),
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
      const texts = await searched();
      signal?.throwIfAborted();
      const found = findQuote(text, texts, {
        ...(section === undefined ? {} : { section }),
        segment: quotes.segmentSections(),
      });
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
