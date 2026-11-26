// Source conversion as the engine runs it:
// `pytools/convert.py ingest`, in the engine's sandbox (sandbox.ts), since
// the file comes from outside the machine and PDFium is native code that
// parses it. The command reads the original, whose
// folder its caller names, and writes only the source's folder. It runs on
// the venv's own Python, isolated. `convert.py page`, which renders a PDF's
// page for view_page (task 4.8), runs the same way and writes only the
// image's folder. Its header says what it writes; this module turns a run
// into a result, and a run that fails, runs out of time or writes something
// out of shape into a failure, never an exception.

import { dirname } from "node:path";
import { z } from "zod";
import { pytool, runPytool } from "./pytool.ts";
import type { Sandbox } from "./sandbox.ts";

/** What converting a file came to. */
export type Conversion =
  /** The folder holds the source's files, its outline naming the folder. */
  | { result: "converted" }
  /** Not a file Gauss reads, with the converter's sentence saying why. */
  | {
      result: "refused";
      reason: "format" | "empty" | "scanned" | "protected";
      detail: string;
    }
  | { result: "failed"; reason: string }
  | { result: "timed-out"; limit: string };

/** What rendering a PDF's page came to. */
export type Rendering =
  | { result: "rendered" }
  | { result: "failed"; reason: string }
  | { result: "timed-out"; limit: string };

export interface SourceConverter {
  /** Why nothing can be converted here; undefined when it can. */
  readonly unavailable: string | undefined;
  /**
   * Converts `original` into `folder`, an empty folder whose name is a
   * valid source id. Never throws.
   */
  convert(
    original: string,
    folder: string,
    signal?: AbortSignal,
  ): Promise<Conversion>;
  /**
   * Renders page `page`, counted from 1, of the PDF `original` as a PNG
   * image into `png`, a file its folder does not have yet. Never throws.
   */
  renderPage(
    original: string,
    page: number,
    png: string,
    signal?: AbortSignal,
  ): Promise<Rendering>;
}

/** A first render could not be completed; a cache hit never needs the converter. */
export class NotRendered extends Error {}

export async function renderSourcePage(
  converter: SourceConverter | undefined,
  original: string,
  page: number,
  png: string,
  signal?: AbortSignal,
): Promise<void> {
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

/** Five minutes: the Inwood PDF, 543 pages, converts in about 11 seconds. */
export const CONVERSION_TIME_LIMIT_MS = 5 * 60_000;

/** A minute: a page of the Inwood PDF renders in about a quarter of a second. */
export const PAGE_TIME_LIMIT_MS = 60_000;

const script = pytool("convert.py");

/** The sandbox's status-only output; the full outline is read from disk. */
const Output = z.discriminatedUnion("result", [
  z.strictObject({ result: z.literal("converted") }),
  z.object({
    result: z.literal("refused"),
    reason: z.enum(["format", "empty", "scanned", "protected"]),
    detail: z.string().min(1),
  }),
]);

const Rendered = z.object({ result: z.literal("rendered") });

export function createSourceConverter(options: {
  sandbox: Sandbox;
  timeLimitMs?: number;
  pageTimeLimitMs?: number;
}): SourceConverter {
  const { sandbox } = options;
  const timeLimitMs = options.timeLimitMs ?? CONVERSION_TIME_LIMIT_MS;
  const pageTimeLimitMs = options.pageTimeLimitMs ?? PAGE_TIME_LIMIT_MS;
  if (!sandbox.available) {
    const failed = async () => ({
      result: "failed" as const,
      reason: `there is no sandbox to run it in (${sandbox.reason})`,
    });
    return { unavailable: sandbox.reason, convert: failed, renderPage: failed };
  }
  const { run } = sandbox;

  /** Runs convert.py with these arguments, and reads its line of output in the shape given. */
  function convertPy<T>(
    args: string[],
    within: { writable: string; readable: string },
    shape: z.ZodType<T>,
    limitMs: number,
    signal: AbortSignal | undefined,
  ) {
    return runPytool(run, script, args, within, shape, limitMs, signal);
  }

  return {
    unavailable: undefined,
    convert: (original, folder, signal) =>
      // Status only: titles and cuts can exceed the command output cap; the
      // metadata is in the outline on disk.
      convertPy(
        ["ingest", "--status-only", original, folder],
        { writable: folder, readable: dirname(original) },
        Output,
        timeLimitMs,
        signal,
      ),
    async renderPage(original, page, png, signal) {
      // The original alone: its folder holds the image's, which a read-only
      // folder around it would close to writes.
      const rendered = await convertPy(
        ["page", original, String(page), png],
        { writable: dirname(png), readable: original },
        Rendered,
        pageTimeLimitMs,
        signal,
      );
      return rendered.result === "rendered" ? { result: "rendered" } : rendered;
    },
  };
}
