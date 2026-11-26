// A photo taken in as the engine does it: `pytools/photo.py` in the real
// sandbox, so these tests need what the sandbox needs (on Linux `bwrap`,
// `socat` and `rg`) and fail, rather than skip, where it cannot run.
// `pytools/tests/test_photo.py` covers the script's own rules.

import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { type DataRoot, openDataRoot } from "../record/data-root.ts";
import { createPhotoTaker, type PhotoTaker } from "./photos.ts";
import { type Sandbox, startSandbox } from "./sandbox.ts";

/** A 4 by 3 PNG, made with Pillow. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAIAAAA7ljmRAAAAFElEQVR4nGM8ISfHAANMDEgAhQMAJtoBCkAAOw8AAAAASUVORK5CYII=",
  "base64",
);
const UNKNOWN = "0b7e1f9a-2c3d-4e5f-8a9b-0c1d2e3f4a5b";

let sandbox: Extract<Sandbox, { available: true }>;
/** The data root the sandbox closes to reads, made once for the sandbox. */
let root: string;
let dataRoot: DataRoot;
let course: string;
let taker: PhotoTaker;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "gauss-photos-"));
  const started = await startSandbox({ log: () => {}, dataRoot: root });
  if (!started.available) {
    throw new Error(`These tests need the sandbox: ${started.reason}`);
  }
  sandbox = started;
});
afterAll(async () => {
  await sandbox?.close();
  await rm(root, { recursive: true, force: true });
});
beforeEach(async () => {
  await rm(join(root, "uploads"), { recursive: true, force: true });
  dataRoot = openDataRoot({ path: root });
  course = (await dataRoot.createCourse({ title: "Calculus I" })).id;
  taker = createPhotoTaker({ sandbox, dataRoot });
});

function upload(bytes: Buffer, name = "photo.png") {
  return {
    name,
    size: bytes.length,
    body: (async function* () {
      yield new Uint8Array(bytes);
    })(),
  };
}

async function staged(): Promise<string[]> {
  return readdir(join(root, "uploads", "photos")).catch(() => []);
}

test("a photo staged and then sent is kept in the course as a JPEG, leaving nothing staged", async () => {
  const taken = await taker.stage(upload(PNG));
  if (!taken.ok) throw new Error(taken.error);

  expect(await staged()).toEqual([`${taken.photo}.jpg`]);
  expect(await dataRoot.keepPhotos(course, [taken.photo])).toBe(true);
  const kept = await dataRoot.readPhoto(course, taken.photo);
  expect(kept?.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
  expect(await staged()).toEqual([]);
});

test("a file that is not an image is refused with the script's reason, and nothing stays staged", async () => {
  expect(
    await taker.stage(upload(Buffer.from("Not an image.\n"), "photo.jpg")),
  ).toEqual({
    ok: false,
    status: 415,
    error: "It is not a JPEG, PNG or WebP image.",
  });
  expect(await staged()).toEqual([]);
});

test("a file larger than the limit is refused, whether or not its request says its size", async () => {
  const small = createPhotoTaker({ sandbox, dataRoot, sizeLimit: 1024 });
  const big = Buffer.alloc(2048);

  expect(await small.stage(upload(big))).toEqual({
    ok: false,
    status: 413,
    error: "It is 2 KB; Gauss takes files up to 1 KB.",
  });
  expect(await small.stage({ ...upload(big), size: undefined })).toEqual({
    ok: false,
    status: 413,
    error: "It is more than 1 KB, the most Gauss takes.",
  });
  expect(await staged()).toEqual([]);
});

test("a message naming a photo not staged, or one photo twice, keeps none of them, and two at once keep it once", async () => {
  const taken = await taker.stage(upload(PNG));
  if (!taken.ok) throw new Error(taken.error);

  expect(await dataRoot.keepPhotos(course, [taken.photo, UNKNOWN])).toBe(false);
  expect(await dataRoot.keepPhotos(course, [taken.photo, taken.photo])).toBe(
    false,
  );
  expect(await dataRoot.readPhoto(course, taken.photo)).toBeUndefined();
  // Two messages naming it at once: one keeps it, the other is told it is not staged.
  expect(
    await Promise.all([
      dataRoot.keepPhotos(course, [taken.photo]),
      dataRoot.keepPhotos(course, [taken.photo]),
    ]),
  ).toEqual([true, false]);
  expect(await dataRoot.readPhoto(course, taken.photo)).toBeDefined();
});

test("a photo staged and never sent is gone after a startup", async () => {
  const taken = await taker.stage(upload(PNG));
  if (!taken.ok) throw new Error(taken.error);

  await dataRoot.clearUploads();

  expect(await staged()).toEqual([]);
  expect(await dataRoot.keepPhotos(course, [taken.photo])).toBe(false);
});

test("only a photo's id reads a photo", async () => {
  expect(await dataRoot.readPhoto(course, UNKNOWN)).toBeUndefined();
  await expect(dataRoot.readPhoto(course, "../state.json")).rejects.toThrow();
  await expect(dataRoot.readPhoto(course, `${UNKNOWN}.jpg`)).rejects.toThrow();
});
