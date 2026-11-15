// Append-only logs of JSON values, one per line: evidence.jsonl now, the
// transcripts in task 2.13. A line is appended, never rewritten, so a crash
// partway through an append can leave the start of a line at the end of the
// file. An entry counts once its line ends: reading skips an unfinished last
// line, and the next append clears it first, rather than gluing its own line
// onto it.

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
export async function appendJsonLine(
  path: string,
  value: unknown,
): Promise<void> {
  const line = `${JSON.stringify(value)}\n`;
  // "a+": created if missing, readable, and every write goes to the end.
  const file = await open(path, "a+");
  let created: boolean;
  try {
    const { size } = await file.stat();
    created = size === 0;
    const end = await lastLineEnd(file, size);
    if (end < size) await file.truncate(end);
    await file.write(line);
    await file.sync();
  } finally {
    await file.close();
  }
  if (created) await syncFolder(dirname(path));
}

/**
 * The file's values, each checked against the schema; empty if there is no
 * file. An unfinished last line is skipped. Any other line that is not valid
 * JSON or does not match is an error naming the file and line, because an
 * append cannot leave one.
 */
export async function readJsonLines<T>(
  path: string,
  schema: z.ZodType<T>,
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
  return lines.map((line, i) => {
    const where = `${path}, line ${i + 1}`;
    let data: unknown;
    try {
      data = JSON.parse(line);
    } catch (error) {
      throw new Error(`${where} is not valid JSON.`, { cause: error });
    }
    const parsed = schema.safeParse(data);
    if (!parsed.success) {
      throw new Error(
        `${where} does not match its schema:\n${z.prettifyError(parsed.error)}`,
      );
    }
    return parsed.data;
  });
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
