// A photo the learner attaches to a message (brief.md, "Photos"), taken in
// before the message is sent. The file is received into a scratch folder in
// the data root's staged photos, then `pytools/photo.py` reads it in the
// engine's sandbox, since an image comes from outside the machine and Pillow
// is native code that parses it, and writes the JPEG the tutor will see. The
// photo waits staged as `<id>.jpg` until its message moves it into the course
// (`DataRoot.keepPhotos`); startup removes what was never sent.

import { randomUUID } from "node:crypto";
import { mkdir, open, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { PHOTO_SIZE_LIMIT, type PhotoId } from "../../shared/photo.ts";
import type { DataRoot } from "../record/data-root.ts";
import { receive, tooLarge, type Upload } from "./attached-sources.ts";
import { pytool, runPytool } from "./pytool.ts";
import type { Sandbox } from "./sandbox.ts";

/** A minute: a 48-megapixel phone photo is taken in within a few seconds. */
export const PHOTO_TIME_LIMIT_MS = 60_000;

/** What staging a photo came to: its id, or why it was not taken, as the page shows it. */
export type PhotoStaging =
  | { ok: true; photo: PhotoId }
  | { ok: false; status: 400 | 409 | 413 | 415 | 422; error: string };

export interface PhotoTaker {
  /** Takes in the image the learner attached and stages it. Never throws. */
  stage(upload: Upload, signal?: AbortSignal): Promise<PhotoStaging>;
}

const Output = z.discriminatedUnion("result", [
  z.object({
    result: z.literal("taken"),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }),
  z.object({
    result: z.literal("refused"),
    reason: z.enum(["format", "damaged", "large"]),
    detail: z.string().min(1),
  }),
]);

const REFUSED_STATUS = { format: 415, damaged: 422, large: 413 } as const;

const script = pytool("photo.py");

export function createPhotoTaker(options: {
  sandbox: Sandbox;
  dataRoot: Pick<DataRoot, "photoUploads">;
  /** The largest file taken, in bytes; PHOTO_SIZE_LIMIT unless a test sets it. */
  sizeLimit?: number;
  timeLimitMs?: number;
}): PhotoTaker {
  const { sandbox, dataRoot } = options;
  const limit = options.sizeLimit ?? PHOTO_SIZE_LIMIT;
  const timeLimitMs = options.timeLimitMs ?? PHOTO_TIME_LIMIT_MS;

  async function stage(
    { size, body }: Upload,
    signal?: AbortSignal,
  ): Promise<PhotoStaging> {
    if (size !== undefined && size > limit) {
      return { ok: false, status: 413, error: tooLarge(size, limit) };
    }
    if (!sandbox.available) {
      return {
        ok: false,
        status: 409,
        error: `Gauss reads a photo in its sandbox, which does not run here: ${sandbox.reason}.`,
      };
    }
    const photo = randomUUID();
    let scratch: string | undefined;
    try {
      const staged = await dataRoot.photoUploads();
      // The original alone is readable to the script, and only out/ writable.
      scratch = join(staged, `.${photo}.tmp`);
      const original = join(scratch, "original");
      const out = join(scratch, "out");
      await mkdir(out, { recursive: true });
      const got = await receive(
        body,
        original,
        limit,
        signal ?? new AbortController().signal,
      );
      if ("over" in got) {
        return { ok: false, status: 413, error: tooLarge(undefined, limit) };
      }
      if ("failed" in got) {
        return {
          ok: false,
          status: 400,
          error: `The file did not arrive whole: ${got.failed}.`,
        };
      }
      const jpeg = join(out, "photo.jpg");
      const ran = await runPytool(
        sandbox.run,
        script,
        [original, jpeg],
        { writable: out, readable: original },
        Output,
        timeLimitMs,
        signal,
      );
      if (ran.result === "taken") {
        // Flushed before it is named, as every whole file in the record is:
        // keepPhotos syncs only the folders.
        const written = await open(jpeg, "r");
        try {
          await written.sync();
        } finally {
          await written.close();
        }
        await rename(jpeg, join(staged, `${photo}.jpg`));
        return { ok: true, photo };
      }
      if (ran.result === "refused") {
        return {
          ok: false,
          status: REFUSED_STATUS[ran.reason],
          error: ran.detail,
        };
      }
      return {
        ok: false,
        status: 409,
        error:
          ran.result === "timed-out"
            ? `The photo could not be read within ${ran.limit}.`
            : `The photo could not be read: ${ran.reason}.`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        status: 409,
        error: `The photo could not be kept: ${message}.`,
      };
    } finally {
      // Left behind, startup's clearing of the uploads removes it.
      if (scratch !== undefined) {
        await rm(scratch, { recursive: true, force: true }).catch(() => {});
      }
    }
  }

  return { stage };
}
