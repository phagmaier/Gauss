// The photos waiting in a unit's message box (piece 28): each is staged on
// the server as soon as it is attached, and the message names those staged.
// A photo past the message's four is refused here, before it is sent.

import { PHOTOS_PER_MESSAGE, TOO_MANY_PHOTOS } from "../shared/photo.ts";

interface Attached {
  /** The page's own number for it, never reused while the page is open. */
  key: number;
  /** The file's name, as the learner's system gave it. */
  name: string;
  /** An object URL of the file, for its square. */
  preview: string;
}

export type WaitingPhoto =
  | (Attached & { state: "staging" })
  | (Attached & { state: "staged"; photo: string })
  | (Attached & { state: "refused"; error: string });

/**
 * Adds a photo to the box: staging, or refused at once if the message
 * already has its four. Says whether to stage it.
 */
export function attachPhoto(
  waiting: readonly WaitingPhoto[],
  photo: Attached,
): { waiting: WaitingPhoto[]; stage: boolean } {
  const taken = waiting.filter((p) => p.state !== "refused").length;
  return taken < PHOTOS_PER_MESSAGE
    ? { waiting: [...waiting, { ...photo, state: "staging" }], stage: true }
    : {
        waiting: [
          ...waiting,
          { ...photo, state: "refused", error: TOO_MANY_PHOTOS },
        ],
        stage: false,
      };
}

/**
 * The server's answer to staging: the photo's id, or why it was refused.
 * A photo removed while it was staged stays removed.
 */
export function photoAnswered(
  waiting: readonly WaitingPhoto[],
  key: number,
  answer: { photo: string } | { error: string },
): WaitingPhoto[] {
  return waiting.map((p) =>
    p.key !== key || p.state !== "staging"
      ? p
      : "photo" in answer
        ? { ...p, state: "staged", photo: answer.photo }
        : { ...p, state: "refused", error: answer.error },
  );
}

export function removePhoto(
  waiting: readonly WaitingPhoto[],
  key: number,
): WaitingPhoto[] {
  return waiting.filter((p) => p.key !== key);
}

/** Send waits while any photo is still being staged. */
export function stagingPhotos(waiting: readonly WaitingPhoto[]): boolean {
  return waiting.some((p) => p.state === "staging");
}

/** What a message sent now carries: the staged photos' ids, in order. */
export function photosToSend(waiting: readonly WaitingPhoto[]): string[] {
  return waiting.flatMap((p) => (p.state === "staged" ? [p.photo] : []));
}

/**
 * Once the message is sent, the photos in the box when it was sent go,
 * refused ones too; one attached while it was being sent stays.
 */
export function afterSend(
  waiting: readonly WaitingPhoto[],
  sent: ReadonlySet<number>,
): WaitingPhoto[] {
  return waiting.filter((p) => !sent.has(p.key));
}
