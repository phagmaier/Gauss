import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { writeFileAtomic } from "./atomic-write.ts";

let folder: string;
beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), "gauss-atomic-"));
});
afterEach(async () => {
  await rm(folder, { recursive: true, force: true });
});

test("a new file is written, and nothing else is left in its folder", async () => {
  await writeFileAtomic(join(folder, "state.json"), "first\n");

  expect(await readFile(join(folder, "state.json"), "utf8")).toBe("first\n");
  expect(await readdir(folder)).toEqual(["state.json"]);
});

test("an existing file is replaced whole", async () => {
  await writeFile(join(folder, "state.json"), "a much longer first version\n");

  await writeFileAtomic(join(folder, "state.json"), "second\n");

  expect(await readFile(join(folder, "state.json"), "utf8")).toBe("second\n");
  expect(await readdir(folder)).toEqual(["state.json"]);
});

test("a write that fails at the last step leaves no temporary file behind", async () => {
  // A folder where the file should be: the contents can be written, but the
  // rename that puts them in place fails.
  await mkdir(join(folder, "state.json"));

  await expect(
    writeFileAtomic(join(folder, "state.json"), "x"),
  ).rejects.toThrow();
  expect(await readdir(folder)).toEqual(["state.json"]);
});

test("a write into a folder that does not exist fails", async () => {
  await expect(
    writeFileAtomic(join(folder, "missing", "state.json"), "x"),
  ).rejects.toThrow(/ENOENT/);
});
