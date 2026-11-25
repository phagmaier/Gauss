// Attaching a source in a conversation with a planner: the intake's (piece
// 22) and a planning conversation's (piece 26). The files being sent and
// converted, which Send waits for; a file dropped on the page; and the
// outline of a file attached before a course's collection of outlines
// holds it.

import { type DragEvent, useEffect, useReducer, useRef, useState } from "react";
import type { Unit } from "../shared/curriculum.ts";
import { FILE_NAME_HEADER } from "../shared/events.ts";
import { formatBytes, Outline, SOURCE_SIZE_LIMIT } from "../shared/source.ts";
import type { SourceTarget } from "../shared/source-target.ts";
import type { Item } from "../shared/timeline.ts";
import { type Answer, getJson, postFile } from "./api.ts";
import { SidePane } from "./Frame.tsx";
import { SourcePane } from "./SourcePane.tsx";

/** An upload refused before its card could show it. */
export interface UploadError {
  key: number;
  name: string;
  error: string;
}

interface Uploads {
  /** Requests not answered yet. */
  posting: number;
  /** Files taken, by attachment, whose cards may not have caught up yet. */
  taken: string[];
  errors: UploadError[];
}

type UploadAction =
  | { type: "start" }
  | { type: "taken"; attachment: string }
  | { type: "refused"; error: UploadError | undefined };

function reduceUploads(state: Uploads, action: UploadAction): Uploads {
  switch (action.type) {
    case "start":
      return { ...state, posting: state.posting + 1 };
    case "taken":
      return {
        ...state,
        posting: state.posting - 1,
        taken: [...state.taken, action.attachment],
      };
    case "refused":
      return {
        ...state,
        posting: state.posting - 1,
        errors:
          action.error === undefined
            ? state.errors
            : [...state.errors, action.error],
      };
  }
}

/**
 * Sends files to `path`, and says whether one is still being sent or
 * converted: the thread's items show a conversion's end, which can come
 * before or after the upload's answer.
 */
export function useSourceUploads(
  path: string | undefined,
  items: readonly Item[],
): {
  attach(file: File): void;
  converting: boolean;
  errors: readonly UploadError[];
} {
  const [state, dispatch] = useReducer(reduceUploads, {
    posting: 0,
    taken: [],
    errors: [],
  });
  const next = useRef(0);
  const settled = (attachment: string) =>
    items.some(
      (i) =>
        i.kind === "source" &&
        i.attachment === attachment &&
        i.state !== "converting",
    );
  const converting =
    state.posting > 0 ||
    state.taken.some((attachment) => !settled(attachment)) ||
    items.some((i) => i.kind === "source" && i.state === "converting");
  return {
    attach(file) {
      if (path === undefined) return;
      const key = next.current++;
      dispatch({ type: "start" });
      void postFile(path, file, FILE_NAME_HEADER).then((result) => {
        if (result.ok) {
          dispatch({ type: "taken", attachment: result.attachment });
        } else {
          // A refusal with a card of its own is shown there.
          dispatch({
            type: "refused",
            error: result.shown
              ? undefined
              : { key, name: file.name, error: result.error },
          });
        }
      });
    },
    converting,
    errors: state.errors,
  };
}

/**
 * A file held over the page, which can be dropped to attach it: the
 * handlers for the page's element, and whether to show the hint.
 */
export function useFileDrop(open: boolean, attach: (file: File) => void) {
  const [dragging, setDragging] = useState(false);
  /** How deep in the page's elements a file is held, which enter and leave count. */
  const depth = useRef(0);
  const holdsFiles = (e: DragEvent) =>
    open && e.dataTransfer.types.includes("Files");
  return {
    dragging,
    handlers: {
      onDragEnter(e: DragEvent) {
        if (!holdsFiles(e)) return;
        e.preventDefault();
        depth.current += 1;
        setDragging(true);
      },
      onDragOver(e: DragEvent) {
        if (!holdsFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      },
      onDragLeave() {
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setDragging(false);
      },
      onDrop(e: DragEvent) {
        depth.current = 0;
        setDragging(false);
        if (!holdsFiles(e)) return;
        e.preventDefault();
        for (const file of e.dataTransfer.files) attach(file);
      },
    },
  };
}

/** Shown over the page while a file is held over it. */
export function DropHint() {
  return (
    <div className="drop">
      <div className="drop-t">Drop the file to attach it</div>
      <p className="drop-p">
        PDF, EPUB, plain text or Markdown, up to{" "}
        {formatBytes(SOURCE_SIZE_LIMIT)}
      </p>
    </div>
  );
}

type OutlineTarget = Extract<SourceTarget, { kind: "outline" }>;

/** An attachment can be read before a course or its collection of outlines holds it. */
export function AttachmentOutline(props: {
  target: OutlineTarget;
  base: string;
  title: string;
  known: Outline | undefined;
  units: readonly Unit[];
  onClose(): void;
}) {
  const { target, base, known } = props;
  const [answer, setAnswer] = useState<Answer<Outline>>();
  useEffect(() => {
    if (known !== undefined) return;
    const stop = new AbortController();
    void getJson(
      `${base}/${encodeURIComponent(target.source)}`,
      Outline,
      stop.signal,
    ).then((result) => {
      if (!stop.signal.aborted) setAnswer(result);
    });
    return () => stop.abort();
  }, [base, target.source, known]);

  const source = known ?? (answer?.ok ? answer.data : undefined);
  if (source !== undefined) {
    return (
      <SourcePane
        base={base}
        source={source}
        target={target}
        units={props.units}
        onClose={props.onClose}
      />
    );
  }
  return (
    <SidePane title="Outline" subtitle={props.title} onClose={props.onClose}>
      {answer !== undefined && !answer.ok ? (
        <p className="qa-error" role="alert">
          The source's outline could not be loaded: {answer.error}
        </p>
      ) : (
        <p className="ph-note" role="status">
          Loading the outline…
        </p>
      )}
    </SidePane>
  );
}
