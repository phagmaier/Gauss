// A photo the learner attaches to a message (brief.md, "Photos"). Its id
// names its file, `<id>.jpg`, while it waits staged in `uploads/photos/` and
// once its message has kept it in the course's `photos/`.

import { z } from "zod";

/** A photo's id: a UUID as `randomUUID` writes it. */
export const PhotoId = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
export type PhotoId = z.infer<typeof PhotoId>;

/** The largest image file taken, in bytes; a phone's photo is a few megabytes. */
export const PHOTO_SIZE_LIMIT = 20 * 1024 * 1024;

/** The most photos one message takes. */
export const PHOTOS_PER_MESSAGE = 4;

/** Why a message with more photos is refused, by the server or the page. */
export const TOO_MANY_PHOTOS = `A message takes at most ${PHOTOS_PER_MESSAGE} photos.`;

/** "1 photo", "2 photos": how the models are told a message's photos. */
export function photoCount(photos: number): string {
  return photos === 1 ? "1 photo" : `${photos} photos`;
}

/** What staging a photo answers: its id, which the message that sends it names. */
export const PhotoStaged = z.object({ photo: PhotoId });
export type PhotoStaged = z.infer<typeof PhotoStaged>;
