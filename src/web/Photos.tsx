// Photos in a unit's messages (piece 28, direction A): the photos waiting in
// the message box as small squares, each staged when attached; a message's
// photos in its bubble; and one opened over the whole page.

import { useEffect, useRef, useState } from "react";
import { FILE_NAME_HEADER, type UnitMessage } from "../shared/events.ts";
import { PhotoStaged } from "../shared/photo.ts";
import { postFileFor } from "./api.ts";
import { CLOSE_ICON } from "./Frame.tsx";
import {
  afterSend,
  attachPhoto,
  photoAnswered,
  photosToSend,
  removePhoto,
  type WaitingPhoto,
} from "./photo-tray.ts";

/** What the file picker offers: the formats a photo can be. */
export const PHOTO_TYPES =
  "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp";

/** The photos waiting in the message box, and what can be done with them. */
export interface PhotoTray {
  waiting: readonly WaitingPhoto[];
  attach(files: Iterable<File>): void;
  remove(key: number): void;
  /**
   * Sends the message with the staged photos, and takes the photos it
   * carried out of the box once it is taken. Says why it was refused.
   */
  send(
    text: string,
    post: (message: UnitMessage) => Promise<string | undefined>,
  ): Promise<string | undefined>;
}

/** Holds the photos waiting for a message; each is staged at `stagePath`. */
export function usePhotoTray(stagePath: string): PhotoTray {
  const [waiting, setWaiting] = useState<readonly WaitingPhoto[]>([]);
  // Several files can arrive at once, before a render: each is counted
  // against the four from the latest list, not from the last render's.
  const latest = useRef<readonly WaitingPhoto[]>([]);
  const next = useRef(0);

  function commit(after: readonly WaitingPhoto[]) {
    for (const p of latest.current) {
      if (!after.some((q) => q.key === p.key)) URL.revokeObjectURL(p.preview);
    }
    latest.current = after;
    setWaiting(after);
  }

  useEffect(
    () => () => {
      for (const p of latest.current) URL.revokeObjectURL(p.preview);
    },
    [],
  );

  return {
    waiting,
    attach(files) {
      for (const file of files) {
        const key = next.current++;
        const added = attachPhoto(latest.current, {
          key,
          name: file.name,
          preview: URL.createObjectURL(file),
        });
        commit(added.waiting);
        if (!added.stage) continue;
        void postFileFor(stagePath, file, FILE_NAME_HEADER, PhotoStaged).then(
          (answer) =>
            commit(
              photoAnswered(
                latest.current,
                key,
                answer.ok
                  ? { photo: answer.data.photo }
                  : { error: answer.error },
              ),
            ),
        );
      }
    },
    remove(key) {
      commit(removePhoto(latest.current, key));
    },
    async send(text, post) {
      const sent = latest.current;
      const photos = photosToSend(sent);
      const refused = await post(
        photos.length === 0 ? { text } : { text, photos },
      );
      if (refused === undefined) {
        commit(afterSend(latest.current, new Set(sent.map((p) => p.key))));
      }
      return refused;
    },
  };
}

const REMOVE_ICON = (
  <svg
    width="10"
    height="10"
    viewBox="0 0 10 10"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    aria-hidden="true"
  >
    <path d="M2 2l6 6M8 2 2 8" />
  </svg>
);

/**
 * The photos waiting, as squares above the text in the message box, each
 * with a cross; under them, what is still being taken in and why a photo
 * was refused.
 */
export function PhotoSquares(props: {
  waiting: readonly WaitingPhoto[];
  /** A message is being sent: what it carries can no longer be taken back. */
  sending: boolean;
  onRemove(key: number): void;
}) {
  const { waiting } = props;
  if (waiting.length === 0) return null;
  const staging = waiting.filter((p) => p.state === "staging");
  return (
    <>
      <ul className="box-tray" aria-label="Photos for this message">
        {waiting.map((p) => (
          <li
            key={p.key}
            className={p.state === "staged" ? "box-sq" : `box-sq ${p.state}`}
          >
            {p.state === "refused" ? (
              <span className="box-sq-name">{p.name}</span>
            ) : (
              <img
                src={p.preview}
                alt={p.name}
                // A file the browser cannot show, such as a HEIC, is refused
                // by the server; until then its square stays blank.
                onError={(e) => {
                  e.currentTarget.style.visibility = "hidden";
                }}
              />
            )}
            {p.state === "staging" ? (
              <span className="spin" aria-hidden="true" />
            ) : null}
            <button
              type="button"
              className="box-sq-x"
              aria-label={`Remove ${p.name}`}
              title="Remove"
              disabled={props.sending}
              onClick={() => props.onRemove(p.key)}
            >
              {REMOVE_ICON}
            </button>
          </li>
        ))}
      </ul>
      <div className="box-why" role="status">
        {staging.length === 0 ? null : (
          <p className="box-why-p">
            Taking in{" "}
            {staging.length === 1
              ? staging[0]?.name
              : `${staging.length} photos`}
            . Send waits for {staging.length === 1 ? "it" : "them"}.
          </p>
        )}
        {waiting.map((p) =>
          p.state === "refused" ? (
            <p key={p.key} className="box-why-p">
              <b className="box-why-name">{p.name}</b> was not attached.{" "}
              {p.error}
            </p>
          ) : null,
        )}
      </div>
    </>
  );
}

/** A message's photos, in its bubble above its text; each opens at full size. */
export function MessagePhotos(props: {
  photos: readonly string[];
  url(photo: string): string;
  onOpen(at: number): void;
}) {
  const { photos } = props;
  return (
    <div className="th-pics">
      {photos.map((photo, i) => (
        <button
          type="button"
          key={photo}
          aria-label={`Open photo ${i + 1} of ${photos.length}`}
          onClick={() => props.onOpen(i)}
        >
          <img className="th-pic" src={props.url(photo)} alt="" />
        </button>
      ))}
    </div>
  );
}

/**
 * A message's photo over the whole page, dimmed behind, with the message's
 * other photos in a strip below; fitted to the window, or at its own size.
 * Escape or the cross closes it; while it is fitted, the arrow keys go
 * between the photos.
 */
export function PhotoView(props: {
  photos: readonly string[];
  at: number;
  url(photo: string): string;
  onMove(at: number): void;
  onClose(): void;
}) {
  const { photos, at } = props;
  const dialog = useRef<HTMLDialogElement>(null);
  const [actual, setActual] = useState(false);
  const count = photos.length;
  const shown = photos[at];

  // Opened modal once; it leaves the page's top layer when it unmounts.
  useEffect(() => {
    const element = dialog.current;
    if (element !== null && !element.open) element.showModal();
  }, []);

  return (
    <dialog
      ref={dialog}
      className="pv"
      aria-label={`Photo ${at + 1} of ${count}`}
      onClose={props.onClose}
      onKeyDown={(e) => {
        // Keys stay in the view: the open question's shortcuts and a side
        // pane's Escape listen on the window. The dialog still closes
        // itself on Escape.
        e.stopPropagation();
        // At its own size the photo scrolls with the arrows instead.
        if (actual || count < 2) return;
        if (e.key === "ArrowRight") props.onMove((at + 1) % count);
        if (e.key === "ArrowLeft") props.onMove((at + count - 1) % count);
      }}
    >
      <div className="pv-head">
        <span className="pv-k">Your photo</span>
        {count > 1 ? (
          <span>
            {at + 1} of {count}
          </span>
        ) : null}
        <button
          type="button"
          className="pv-tb"
          aria-pressed={actual}
          onClick={() => setActual(!actual)}
        >
          Actual size
        </button>
        <button
          type="button"
          className="sv-close"
          aria-label="Close"
          onClick={() => dialog.current?.close()}
        >
          {CLOSE_ICON}
        </button>
      </div>
      <div className={actual ? "pv-body actual" : "pv-body"}>
        {shown === undefined ? null : (
          <img
            className="pv-img"
            src={props.url(shown)}
            alt={`Sent with your message, ${at + 1} of ${count}`}
          />
        )}
      </div>
      {count > 1 ? (
        <div className="pv-strip">
          {photos.map((photo, i) => (
            <button
              type="button"
              key={photo}
              aria-label={`Photo ${i + 1} of ${count}`}
              aria-current={i === at}
              onClick={() => props.onMove(i)}
            >
              <img className="pv-thumb" src={props.url(photo)} alt="" />
            </button>
          ))}
        </div>
      ) : (
        <div className="pv-strip" />
      )}
    </dialog>
  );
}
