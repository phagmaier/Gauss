// "Quote" over a selection in the tutor's text or a question's prompt (piece
// 19). It shows once the selection is made, not while the mouse is still
// dragging it, follows a selection made with the keyboard, and goes when the
// thread scrolls. Pressing it keeps the selection, so the passage it quotes
// is the one shown.

import { useEffect, useRef, useState } from "react";
import { passageSource, quotableRange } from "./quote.ts";

const QUOTE_ICON = (
  <svg
    width="14"
    height="14"
    viewBox="0 0 16 16"
    fill="currentColor"
    aria-hidden="true"
  >
    <path d="M3 4h4v4H5c0 1.3.7 2 2 2v2c-2.6 0-4-1.6-4-4.2V4zm6 0h4v4h-2c0 1.3.7 2 2 2v2c-2.6 0-4-1.6-4-4.2V4z" />
  </svg>
);

export function QuoteOffer(props: { onQuote(passage: string): void }) {
  const [at, setAt] = useState<{ left: number; top: number }>();
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let pressing = false;
    const update = () => {
      const range = pressing
        ? undefined
        : quotableRange(document.getSelection());
      if (range === undefined) {
        setAt(undefined);
        return;
      }
      const box = range.getBoundingClientRect();
      setAt({ left: box.left + box.width / 2, top: box.top });
    };
    const down = (e: PointerEvent) => {
      if (!button.current?.contains(e.target as Node)) pressing = true;
    };
    const up = () => {
      if (!pressing) return;
      pressing = false;
      update();
    };
    const hide = () => setAt(undefined);
    document.addEventListener("selectionchange", update);
    document.addEventListener("pointerdown", down);
    document.addEventListener("pointerup", up);
    document.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      document.removeEventListener("selectionchange", update);
      document.removeEventListener("pointerdown", down);
      document.removeEventListener("pointerup", up);
      document.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, []);

  if (at === undefined) return null;
  return (
    <button
      type="button"
      ref={button}
      className="qpop"
      style={{ left: at.left, top: at.top }}
      // The selection stays, as the press would otherwise clear it.
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        const selection = document.getSelection();
        const range = quotableRange(selection);
        if (range === undefined) return;
        const passage = passageSource(range);
        selection?.removeAllRanges();
        props.onQuote(passage);
      }}
    >
      {QUOTE_ICON}
      Quote
    </button>
  );
}
