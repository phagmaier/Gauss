// What the tutor reads of its course's sources (task 4.8; architecture.md
// section 8): a section's text for read_section, after a line naming it,
// and a PDF page's image for view_page, rendered by `convert.py page` in the
// engine's sandbox the first time it is asked for and kept in the source's
// pages/ (DataRoot.pageImage). Each read and each page looked at is shown in
// the thread. Neither depends on the unit's phase.

import type { Slug } from "../../shared/course.ts";
import type { PageEvent } from "../../shared/events.ts";
import {
  type Outline,
  pageMarkers,
  type SectionRef,
  sectionsByRef,
} from "../../shared/source.ts";
import type { DataRoot } from "../record/data-root.ts";
import type { SourceShelf } from "../tools/sources.ts";
import type { SourceConverter } from "./source-convert.ts";
import { formatText, missingSection, placeText } from "./source-text.ts";

/** A page that could not be rendered, with why, said to the tutor as a refusal. */
class NotRendered extends Error {}

export function createSourceShelf(options: {
  dataRoot: DataRoot;
  courseId: Slug;
  /** The course's sources, which do not change once it has units. */
  sources: readonly Outline[];
  /** Renders pages not kept yet; none when nothing can be rendered. */
  converter: SourceConverter | undefined;
  /** Shows a read or a page looked at in the thread. */
  emit(event: PageEvent): void;
}): SourceShelf {
  const { dataRoot, courseId, sources, converter, emit } = options;
  const byRef = sectionsByRef(sources);
  const sourceIds = sources.map((s) => `"${s.id}"`).join(", ");

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
      const text = await dataRoot.readSection(courseId, ref);
      signal?.throwIfAborted();
      if (text === undefined) {
        throw new Error(`The file of the section "${ref}" is missing.`);
      }
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
  };
}
