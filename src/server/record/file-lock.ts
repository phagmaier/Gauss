// Work on one file, done one piece at a time in the order it was asked for.
// Two atomic writes to one file can finish in either order (task 1.2), and
// two read-modify-writes that overlap lose one change; the record runs each
// such piece of work on a file through withFileLock. The lock holds within
// this process, which is the only writer of the data root.

import { resolve } from "node:path";

/** The end of the work queued on each file, while there is any. */
const tails = new Map<string, Promise<void>>();

/**
 * Runs `work` once the work queued earlier on the file has finished, whether
 * it succeeded or not, and returns its result.
 */
export function withFileLock<T>(
  path: string,
  work: () => Promise<T>,
): Promise<T> {
  const key = resolve(path);
  const result = (tails.get(key) ?? Promise.resolve()).then(work);
  const tail = result.then(
    () => undefined,
    () => undefined,
  );
  tails.set(key, tail);
  void tail.then(() => {
    if (tails.get(key) === tail) tails.delete(key);
  });
  return result;
}
