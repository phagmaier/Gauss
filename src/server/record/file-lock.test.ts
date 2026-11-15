import { expect, test } from "vitest";
import { withFileLock } from "./file-lock.ts";

// The paths are only keys; nothing here touches the disk.

/** A promise and the function that settles it. */
function gate() {
  let open = () => {};
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, opened };
}

test("work on one file runs a piece at a time, in the order asked, however long each takes", async () => {
  const done: string[] = [];
  const slow = gate();

  const first = withFileLock("/data/courses/a/state.json", async () => {
    await slow.opened;
    done.push("first");
    return 1;
  });
  const second = withFileLock("/data/courses/a/state.json", async () => {
    done.push("second");
    return 2;
  });
  await new Promise((resolve) => setTimeout(resolve, 20));

  expect(done).toEqual([]);
  slow.open();
  expect(await Promise.all([first, second])).toEqual([1, 2]);
  expect(done).toEqual(["first", "second"]);
});

test("a failure reaches its caller, and the work queued after it still runs", async () => {
  const path = "/data/courses/a/evidence.jsonl";

  const failing = withFileLock(path, async () => {
    throw new Error("disk full");
  });
  const after = withFileLock(path, async () => "ran");

  await expect(failing).rejects.toThrow("disk full");
  expect(await after).toBe("ran");
});

test("work on another file does not wait", async () => {
  const held = gate();
  const blocked = withFileLock("/data/courses/a/state.json", () =>
    held.opened.then(() => "a"),
  );

  expect(
    await withFileLock("/data/courses/b/state.json", async () => "b"),
  ).toBe("b");
  held.open();
  expect(await blocked).toBe("a");
});
