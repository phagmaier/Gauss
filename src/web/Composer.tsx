// The message box (docs/prototype/01-reading-chat.html): it grows with its
// text, sends on Enter, and turns into a stop button while the tutor writes.
// A send owns only the draft it sent, so text typed meanwhile is kept
// (task 0.8). A quoted passage (piece 19) and an aid's question go after the
// draft; neither is sent until the learner sends it. In the intake, a clip
// first in the box attaches a source (piece 22), and Send waits while a file
// converts, so that the planner's turn has its outline. In a unit, the clip
// or a paste attaches photos (piece 28): they wait as squares above the
// text, Send waits while one is taken in, and a message of photos alone
// can be sent.

import {
  type Ref,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import { withQuote } from "../shared/quote.ts";
import { withAsk } from "./artifact.ts";
import { PHOTO_TYPES, PhotoSquares, type PhotoTray } from "./Photos.tsx";
import { photosToSend, stagingPhotos } from "./photo-tray.ts";

const SEND_ICON = (
  <svg
    width="18"
    height="18"
    viewBox="0 0 18 18"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M9 14.5v-11M4.5 8 9 3.5 13.5 8" />
  </svg>
);
const CLIP_ICON = (
  <svg
    width="18"
    height="18"
    viewBox="0 0 18 18"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M14.5 8.6 9 14.1a3.6 3.6 0 0 1-5.1-5.1l5.8-5.8a2.4 2.4 0 0 1 3.4 3.4L7.4 12.3a1.2 1.2 0 0 1-1.7-1.7l5.2-5.2" />
  </svg>
);
/** What the file picker offers: the formats a source can be. */
const SOURCE_TYPES =
  ".pdf,.epub,.txt,.md,.markdown,application/pdf,application/epub+zip,text/plain,text/markdown";
const STOP_ICON = (
  <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
    <rect x="2" y="2" width="10" height="10" rx="2" fill="currentColor" />
  </svg>
);

/** What the page can do to the message box from outside it. */
export interface ComposerHandle {
  /** Puts the passage, as a quote, after the draft, and focuses the box at its end. */
  quote(passage: string): void;
  /** Puts an aid's question after the draft, and focuses the box at its end. */
  ask(question: string): void;
}

export function Composer(props: {
  enabled: boolean;
  placeholder: string;
  busy: boolean;
  onSend(text: string): Promise<string | undefined>;
  onStop(): void;
  /** Given, the box offers to attach a file as a source. */
  onAttach?(file: File): void;
  /** Send waits: a file is being converted. */
  holdSend?: boolean;
  /** Given, the box takes photos for the message instead (piece 28). */
  photos?: PhotoTray;
  ref?: Ref<ComposerHandle>;
}) {
  const [text, setText] = useState("");
  const picker = useRef<HTMLInputElement>(null);
  const { onAttach, photos } = props;
  const holding =
    props.holdSend === true ||
    (photos !== undefined && stagingPhotos(photos.waiting));
  const withPhotos =
    photos !== undefined && photosToSend(photos.waiting).length > 0;
  const clip =
    photos !== undefined
      ? {
          label: "Attach photos: JPEG, PNG or WebP",
          accept: PHOTO_TYPES,
          multiple: true,
          take: photos.attach,
        }
      : onAttach !== undefined
        ? {
            label: "Attach a source: PDF, EPUB, text or Markdown",
            accept: SOURCE_TYPES,
            multiple: false,
            take: (files: File[]) => {
              const file = files[0];
              if (file !== undefined) onAttach(file);
            },
          }
        : undefined;
  const [sending, setSending] = useState(false);
  const sendPending = useRef(false);
  const draftRevision = useRef(0);
  const box = useRef<HTMLTextAreaElement>(null);

  // The box grows with its text, up to the limit set in the style sheet.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the text changes
  useLayoutEffect(() => {
    const el = box.current;
    if (el === null) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  useImperativeHandle(props.ref, () => {
    /** Replaces the draft with `next`, and focuses the box at its end. */
    function fill(next: string) {
      draftRevision.current += 1;
      flushSync(() => setText(next));
      const el = box.current;
      if (el === null) return;
      el.focus();
      el.setSelectionRange(next.length, next.length);
      el.scrollTop = el.scrollHeight;
    }
    return {
      quote: (passage) => fill(withQuote(text, passage)),
      ask: (question) => fill(withAsk(text, question)),
    };
  }, [text]);

  async function submit() {
    const message = text.trim();
    if (
      (message === "" && !withPhotos) ||
      sendPending.current ||
      props.busy ||
      !props.enabled ||
      holding
    ) {
      return;
    }
    // Lock immediately; another submit can arrive before React or SSE updates.
    sendPending.current = true;
    setSending(true);
    const revision = draftRevision.current;
    try {
      const refused = await props.onSend(message);
      if (refused === undefined && draftRevision.current === revision) {
        setText("");
      }
    } finally {
      sendPending.current = false;
      setSending(false);
    }
  }

  return (
    <form
      className={
        photos !== undefined && photos.waiting.length > 0 ? "box tray" : "box"
      }
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      {photos === undefined ? null : (
        <PhotoSquares
          waiting={photos.waiting}
          sending={sending}
          onRemove={photos.remove}
        />
      )}
      {clip === undefined ? null : (
        <>
          <button
            type="button"
            className="att"
            aria-label={clip.label}
            title={clip.label}
            disabled={!props.enabled}
            onClick={() => picker.current?.click()}
          >
            {CLIP_ICON}
          </button>
          <input
            ref={picker}
            type="file"
            accept={clip.accept}
            multiple={clip.multiple}
            hidden
            onChange={(e) => {
              const input = e.currentTarget;
              const files = [...(input.files ?? [])];
              // Cleared, so that the same file can be chosen again.
              input.value = "";
              clip.take(files);
            }}
          />
        </>
      )}
      <textarea
        ref={box}
        rows={1}
        value={text}
        placeholder={props.placeholder}
        aria-label="Message"
        onChange={(e) => {
          draftRevision.current += 1;
          setText(e.target.value);
        }}
        onPaste={(e) => {
          // A copied image or file arrives as files, beside any text.
          const files = [...e.clipboardData.files];
          if (photos === undefined || !props.enabled || files.length === 0) {
            return;
          }
          e.preventDefault();
          photos.attach(files);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            // Focus can have just moved here from Enter on an aid's button.
            if (!e.repeat) void submit();
          }
        }}
      />
      {props.busy ? (
        <button
          type="button"
          className="send stop"
          aria-label="Stop the tutor"
          onClick={props.onStop}
        >
          {STOP_ICON}
        </button>
      ) : (
        <button
          type="submit"
          className="send"
          aria-label={
            !holding
              ? "Send"
              : photos !== undefined
                ? "Send, once the photos are taken in"
                : "Send, once the conversion is done"
          }
          disabled={
            !props.enabled ||
            sending ||
            holding ||
            (text.trim() === "" && !withPhotos)
          }
        >
          {SEND_ICON}
        </button>
      )}
    </form>
  );
}
