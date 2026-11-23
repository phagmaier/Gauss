// Writes a file so that, whatever stops the process partway, the file holds
// either its old contents or its new ones in full. The new contents go to a
// temporary file in the same folder, are flushed to disk, and are renamed
// over the target; a rename within one folder is atomic. The folder is then
// flushed so the rename itself survives a power cut.
//
// A crash can leave the temporary file behind: a plain file named after the
// target (`isTemporaryName`). The record reads only the files it knows by
// name, and at startup, before anything writes, removes those left in its
// own folders (`clearInterruptedWrites` in data-root.ts).

import { randomUUID } from "node:crypto";
import { link, open, rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

/** `.<target's name>.<a UUID as randomUUID writes it>.tmp` */
const TEMPORARY_NAME =
  /^\..+\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.tmp$/;

/** Where a write of `path` puts its contents first: hidden, beside it. */
function temporaryPath(path: string): string {
  return join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
}

/**
 * Whether a name has the shape of this module's temporary files. They are
 * not alone in having it: a deleted course's parked folder has it, and so
 * can anything the tutor or the learner names, so only the record's own
 * folders are cleared.
 */
export function isTemporaryName(name: string): boolean {
  return TEMPORARY_NAME.test(name);
}

export async function writeFileAtomic(
  path: string,
  contents: string,
): Promise<void> {
  const folder = dirname(path);
  const temporary = temporaryPath(path);
  try {
    const file = await open(temporary, "wx");
    try {
      await file.writeFile(contents, "utf8");
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  await syncFolder(folder);
}

/**
 * Writes a new file whole, never over one that is there: false, with nothing
 * written, if the path is taken. The contents go to a flushed temporary file
 * first, as in writeFileAtomic; a hard link then gives them the name, which
 * fails if the name is taken, where a rename would replace the file.
 */
export async function writeFileNew(
  path: string,
  contents: string,
): Promise<boolean> {
  const folder = dirname(path);
  const temporary = temporaryPath(path);
  try {
    const file = await open(temporary, "wx");
    try {
      await file.writeFile(contents, "utf8");
      await file.sync();
    } finally {
      await file.close();
    }
    try {
      await link(temporary, path);
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "EEXIST"
      ) {
        return false;
      }
      throw error;
    }
  } finally {
    await rm(temporary, { force: true });
  }
  await syncFolder(folder);
  return true;
}

export async function syncFolder(folder: string): Promise<void> {
  const handle = await open(folder, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
