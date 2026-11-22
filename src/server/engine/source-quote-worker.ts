import { readFile } from "node:fs/promises";
import { parentPort } from "node:worker_threads";
import type {
  Outline,
  SearchSourceInput,
  SectionRef,
} from "../../shared/source.ts";
import {
  type FoundQuote,
  findQuote,
  type QuotableSource,
  quotableSource,
  quotableSourceBytes,
  readingOrder,
} from "../../shared/source-quote.ts";
import { findPassages, type PassageHit } from "./source-passage-search.ts";

export type QuotePreference = NonNullable<Parameters<typeof findQuote>[2]>;

export type QuoteRequest =
  | { type: "select"; key: string }
  | {
      type: "prepare";
      key: string;
      sources: readonly Outline[];
      files: ReadonlyMap<SectionRef, string>;
    }
  | { type: "find"; text: string; preference: QuotePreference }
  | { type: "search"; input: SearchSourceInput }
  | { type: "release" };

export type QuoteReply =
  | { type: "selected"; hit: boolean }
  | { type: "prepared" }
  | { type: "found"; quote: FoundQuote | undefined }
  | { type: "passages"; hits: PassageHit[] }
  | { type: "failed"; error: Error };

// Bound retained indexes, not the working memory of constructing or searching
// one course. An oversized course serves its current requests without eviction
// of other courses or becoming a resident cache entry itself.
const BYTE_BUDGET = 64 * 1024 * 1024;
const COURSE_LIMIT = 16;
const cache = new Map<string, { sources: QuotableSource[]; bytes: number }>();
let bytesKept = 0;
let active: QuotableSource[] | undefined;

if (parentPort === null)
  throw new Error("The quote index must run in a worker.");
const port = parentPort;
port.on("message", async (request: QuoteRequest) => {
  try {
    switch (request.type) {
      case "select": {
        const entry = cache.get(request.key);
        active = entry?.sources;
        if (entry !== undefined) {
          cache.delete(request.key);
          cache.set(request.key, entry);
        }
        reply({ type: "selected", hit: entry !== undefined });
        break;
      }
      case "prepare": {
        const sources = await prepare(request.sources, request.files);
        active = sources;
        let bytes = 128 + request.key.length * 2;
        for (const source of sources) {
          bytes += quotableSourceBytes(source) + outlineBytes(source.source);
        }
        if (bytes <= BYTE_BUDGET) {
          cache.set(request.key, { sources, bytes });
          bytesKept += bytes;
          for (const [key, entry] of cache) {
            if (bytesKept <= BYTE_BUDGET && cache.size <= COURSE_LIMIT) break;
            cache.delete(key);
            bytesKept -= entry.bytes;
          }
        }
        reply({ type: "prepared" });
        break;
      }
      case "find":
        if (active === undefined) throw new Error("No quote index is active.");
        reply({
          type: "found",
          quote: findQuote(request.text, active, request.preference),
        });
        break;
      case "search":
        if (active === undefined) throw new Error("No source index is active.");
        reply({ type: "passages", hits: findPassages(request.input, active) });
        break;
      case "release":
        active = undefined;
        break;
    }
  } catch (error) {
    reply({
      type: "failed",
      error: error instanceof Error ? error : new Error(String(error)),
    });
  }
});

function reply(message: QuoteReply) {
  port.postMessage(message);
}

async function prepare(
  outlines: readonly Outline[],
  files: ReadonlyMap<SectionRef, string>,
): Promise<QuotableSource[]> {
  const sources: QuotableSource[] = [];
  for (const outline of outlines) {
    const sections: { ref: SectionRef; text: string }[] = [];
    for (const ref of readingOrder(outline)) {
      const file = files.get(ref);
      if (file === undefined) throw missingFile(ref);
      try {
        // One read at a time keeps descriptors bounded even for a long book.
        sections.push({ ref, text: await readFile(file, "utf8") });
      } catch (error) {
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOENT"
        ) {
          throw missingFile(ref, error);
        }
        throw error;
      }
    }
    sources.push(quotableSource(outline, sections));
  }
  return sources;
}

function missingFile(ref: SectionRef, cause?: unknown): Error {
  return new Error(`The file of the section "${ref}" is missing.`, { cause });
}

/** Estimate the plain outline objects, field slots and two-byte strings. */
function outlineBytes(value: unknown): number {
  if (typeof value === "string") return 32 + value.length * 2;
  if (value === null || typeof value !== "object") return 8;
  const fields = value as Record<string, unknown>;
  let bytes = 64;
  for (const name in fields) bytes += 32 + outlineBytes(fields[name]);
  return bytes;
}
