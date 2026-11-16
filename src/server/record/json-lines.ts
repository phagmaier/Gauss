// Append-only logs of JSON values, one per line: evidence.jsonl, and the
// session transcripts (task 2.13). A line is appended, never rewritten, so a
// crash partway through an append can leave the start of a line at the end
// of the file. An entry counts once its line ends: reading skips an
// unfinished last line, and the next append clears it first, rather than
// gluing its own line onto it.

import { open, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { syncFolder } from "./atomic-write.ts";

/** How much of the file's end is read at a time to find its last line end. */
const CHUNK = 4096;

/**
 * Appends the value as one line and flushes it to disk. Two appends to one
 * file must not overlap, or the second could clear the first's line as
 * unfinished: run each through withFileLock (file-lock.ts) on the path.
 */
export function appendJsonLine(path: string, value: unknown): Promise<void> {
  return appendJsonLines(path, [value]);
}

/**
 * Appends the values, one line each, in one write, and flushes them to disk
 * unless `flush` is false. Not flushed, the lines survive the server
 * stopping, since the system holds them, but not the machine stopping. The
 * same rule holds as for appendJsonLine.
 */
export async function appendJsonLines(
  path: string,
  values: readonly unknown[],
  { flush = true }: { flush?: boolean } = {},
): Promise<void> {
  if (values.length === 0) return;
  const lines = Buffer.from(
    values.map((value) => `${JSON.stringify(value)}\n`).join(""),
  );
  // "a+": created if missing, readable, and every write goes to the end.
  const file = await open(path, "a+");
  let created: boolean;
  try {
    const { size } = await file.stat();
    created = size === 0;
    const end = await lastLineEnd(file, size);
    if (end < size) await file.truncate(end);
    // One write can store only part of what it is given, so the lines are
    // written until the whole of them is there.
    for (let written = 0; written < lines.byteLength; ) {
      const { bytesWritten } = await file.write(lines, written);
      if (bytesWritten === 0) {
        throw new Error(`Nothing could be written to ${path}.`);
      }
      written += bytesWritten;
    }
    if (flush) await file.sync();
  } finally {
    await file.close();
  }
  if (created && flush) await syncFolder(dirname(path));
}

/**
 * The file's values, each checked against the schema; empty if there is no
 * file. An unfinished last line is skipped. Any other line that is not valid
 * JSON or does not match is an error naming the file and line, because an
 * append cannot leave one; given `skip`, it is reported there and left out
 * instead.
 */
export async function readJsonLines<T>(
  path: string,
  schema: z.ZodType<T>,
  skip?: (problem: string) => void,
): Promise<T[]> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
  // The piece after the last line end is either empty or unfinished.
  const lines = text.split("\n").slice(0, -1);
  const values: T[] = [];
  for (const [i, line] of lines.entries()) {
    const where = `${path}, line ${i + 1}`;
    const bad = (problem: string, cause?: unknown): void => {
      if (skip === undefined) {
        throw cause === undefined
          ? new Error(problem)
          : new Error(problem, { cause });
      }
      skip(problem);
    };
    let data: unknown;
    try {
      data = JSON.parse(line);
    } catch (error) {
      bad(`${where} is not valid JSON.`, error);
      continue;
    }
    const parsed = schema.safeParse(data);
    if (parsed.success) {
      values.push(parsed.data);
    } else {
      bad(
        `${where} does not match its schema:\n${z.prettifyError(parsed.error)}`,
      );
    }
  }
  return values;
}

/** The length of the file up to and including its last newline; 0 if none. */
async function lastLineEnd(
  file: Awaited<ReturnType<typeof open>>,
  size: number,
): Promise<number> {
  const buffer = Buffer.alloc(CHUNK);
  for (let end = size; end > 0; end -= CHUNK) {
    const start = Math.max(0, end - CHUNK);
    const { bytesRead } = await file.read(buffer, 0, end - start, start);
    const at = buffer.subarray(0, bytesRead).lastIndexOf(0x0a);
    if (at >= 0) return start + at + 1;
  }
  return 0;
}
