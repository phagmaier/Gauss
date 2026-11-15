// Writes a file so that, whatever stops the process partway, the file holds
// either its old contents or its new ones in full. The new contents go to a
// temporary file in the same folder, are flushed to disk, and are renamed
// over the target; a rename within one folder is atomic. The folder is then
// flushed so the rename itself survives a power cut.
//
// A crash can leave the temporary file behind. Its name starts with a dot and
// ends in ".tmp", and the record reads only the files it knows by name.

import { randomUUID } from "node:crypto";
import { open, rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

export async function writeFileAtomic(
  path: string,
  contents: string,
): Promise<void> {
  const folder = dirname(path);
  const temporary = join(folder, `.${basename(path)}.${randomUUID()}.tmp`);
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

async function syncFolder(folder: string): Promise<void> {
  const handle = await open(folder, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
