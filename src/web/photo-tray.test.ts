import { expect, test } from "vitest";
import {
  afterSend,
  attachPhoto,
  photoAnswered,
  photosToSend,
  removePhoto,
  stagingPhotos,
  type WaitingPhoto,
} from "./photo-tray.ts";

const HEIC = "It is not a JPEG, PNG or WebP image.";
const TOO_MANY = "A message takes at most 4 photos.";

/** Attaches each name in turn, as a drop of several files does. */
function attachAll(waiting: readonly WaitingPhoto[], names: string[]) {
  let next = [...waiting];
  const staged: number[] = [];
  for (const name of names) {
    const key = next.length === 0 ? 0 : Math.max(...next.map((p) => p.key)) + 1;
    const added = attachPhoto(next, { key, name, preview: `blob:${name}` });
    next = added.waiting;
    if (added.stage) staged.push(key);
  }
  return { waiting: next, staged };
}

test("a fifth photo is refused with the limit's reason and not staged, while one the server refused leaves its place free", () => {
  let { waiting, staged } = attachAll([], ["a.heic", "b.jpg"]);
  waiting = photoAnswered(waiting, 0, { error: HEIC });
  waiting = photoAnswered(waiting, 1, { photo: "id-b" });
  ({ waiting, staged } = attachAll(waiting, ["c.png", "d.png", "e.webp"]));
  expect(staged).toEqual([2, 3, 4]);

  const fifth = attachAll(waiting, ["f.jpg"]);
  expect(fifth.staged).toEqual([]);
  expect(fifth.waiting.at(-1)).toMatchObject({
    name: "f.jpg",
    state: "refused",
    error: TOO_MANY,
  });
  expect(fifth.waiting.at(0)).toMatchObject({ state: "refused", error: HEIC });

  // Removing one of the four makes room again.
  const again = attachAll(removePhoto(waiting, 3), ["g.jpg"]);
  expect(again.staged).toEqual([5]);
});

test("Send waits while a photo stages, then carries the staged photos in the order attached, without the refused or removed", () => {
  let { waiting } = attachAll([], ["a.jpg", "b.heic", "c.png", "d.png"]);
  waiting = photoAnswered(waiting, 2, { photo: "id-c" });
  expect(stagingPhotos(waiting)).toBe(true);
  waiting = photoAnswered(waiting, 1, { error: HEIC });
  waiting = photoAnswered(waiting, 0, { photo: "id-a" });
  waiting = removePhoto(waiting, 3);
  expect(stagingPhotos(waiting)).toBe(false);
  expect(photosToSend(waiting)).toEqual(["id-a", "id-c"]);
});

test("an answer for a photo removed while it staged does not bring it back, and an answer never changes a photo already settled", () => {
  let { waiting } = attachAll([], ["a.jpg", "b.jpg"]);
  waiting = removePhoto(waiting, 0);
  waiting = photoAnswered(waiting, 0, { photo: "id-a" });
  waiting = photoAnswered(waiting, 1, { photo: "id-b" });
  waiting = photoAnswered(waiting, 1, { error: "Late." });
  expect(waiting).toEqual([
    {
      key: 1,
      name: "b.jpg",
      preview: "blob:b.jpg",
      state: "staged",
      photo: "id-b",
    },
  ]);
});

test("after a send, the photos in the box when it was sent go, refused ones too, and one attached meanwhile stays", () => {
  let { waiting } = attachAll([], ["a.jpg", "b.heic"]);
  waiting = photoAnswered(waiting, 0, { photo: "id-a" });
  waiting = photoAnswered(waiting, 1, { error: HEIC });
  const sent = new Set(waiting.map((p) => p.key));
  ({ waiting } = attachAll(waiting, ["c.jpg"]));
  expect(afterSend(waiting, sent).map((p) => p.name)).toEqual(["c.jpg"]);
});
