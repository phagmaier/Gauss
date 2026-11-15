// Test helper for the crash test in data-root.test.ts. It writes the contents
// of one file to another with writeFileAtomic, in a process of its own, so
// the test can start it under a file size limit that stops the write partway.
//
//   node write-in-child.ts <target> <source>

import { readFile } from "node:fs/promises";
import { writeFileAtomic } from "./atomic-write.ts";

const [target, source] = process.argv.slice(2);
if (target === undefined || source === undefined) {
  throw new Error("Usage: write-in-child.ts <target> <source>");
}
await writeFileAtomic(target, await readFile(source, "utf8"));
