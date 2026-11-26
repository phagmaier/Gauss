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

/** What staging a photo answers: its id, which the message that sends it names. */
export const PhotoStaged = z.object({ photo: PhotoId });
export type PhotoStaged = z.infer<typeof PhotoStaged>;
