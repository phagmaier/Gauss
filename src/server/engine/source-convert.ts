// Source conversion as the engine runs it (architecture.md section 8):
// `pytools/convert.py ingest`, in the engine's sandbox (sandbox.ts), since
// the file comes from outside the machine and PDFium is native code that
// parses it (decisions.md, "Sources"). The command reads the original, whose
// folder its caller names, and writes only the source's folder. It runs on
// the venv's own Python, isolated. Its header says what it writes; this
// module turns a run into a result, and a run that fails, runs out of time or
// writes something out of shape into a failure, never an exception.

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { SourceFormat } from "../../shared/source.ts";
import { sandboxPython } from "../sandbox-command.ts";
import { duration } from "./grading.ts";
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
}

/** Five minutes: the Inwood PDF, 543 pages, converts in about 11 seconds. */
export const CONVERSION_TIME_LIMIT_MS = 5 * 60_000;

const script = fileURLToPath(
  new URL("../../../pytools/convert.py", import.meta.url),
);

/** The line convert.py writes on standard output. */
const Output = z.discriminatedUnion("result", [
  z.object({
    result: z.literal("converted"),
    title: z.string().min(1),
    format: SourceFormat,
    sections: z.number().int().positive(),
    cut: z.array(
      z.object({ title: z.string(), parts: z.number().int().min(2) }),
    ),
  }),
  z.object({
    result: z.literal("refused"),
    reason: z.enum(["format", "empty", "scanned", "protected"]),
    detail: z.string().min(1),
  }),
]);

export function createSourceConverter(options: {
  sandbox: Sandbox;
  timeLimitMs?: number;
}): SourceConverter {
  const { sandbox } = options;
  const timeLimitMs = options.timeLimitMs ?? CONVERSION_TIME_LIMIT_MS;
  if (!sandbox.available) {
    return {
      unavailable: sandbox.reason,
      convert: async () => ({
        result: "failed",
        reason: `there is no sandbox to run it in (${sandbox.reason})`,
      }),
    };
  }
  const { run } = sandbox;
  return {
    unavailable: undefined,
    async convert(original, folder, signal) {
      let ran: Awaited<ReturnType<typeof run>>;
      try {
        ran = await run({
          argv: [sandboxPython, "-I", script, "ingest", original, folder],
          cwd: "/",
          writable: [folder],
          readable: [dirname(original)],
          timeLimitMs,
          outputLimit: 64 * 1024,
          ...(signal === undefined ? {} : { signal }),
        });
      } catch (error) {
        return {
          result: "failed",
          reason: error instanceof Error ? error.message : String(error),
        };
      }
      if (ran.timedOut) {
        return { result: "timed-out", limit: duration(timeLimitMs) };
      }
      if (ran.exitCode !== 0) {
        const said = ran.stderr.trim().split("\n").at(-1)?.trim();
        return {
          result: "failed",
          reason: `it stopped with exit status ${ran.exitCode}${said ? `: ${said}` : ""}`,
        };
      }
      let out: z.infer<typeof Output>;
      try {
        out = Output.parse(JSON.parse(ran.stdout));
      } catch {
        return { result: "failed", reason: "its output could not be read" };
      }
      return out.result === "converted"
        ? { result: "converted" }
        : { result: "refused", reason: out.reason, detail: out.detail };
    },
  };
}
