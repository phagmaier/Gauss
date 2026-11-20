// What the views share around their content: the top line with the path out
// (docs/prototype/04-session-nav.html, 06-library.html) and the side pane
// (05-side-pane.html).

import { Fragment, type ReactNode, useEffect, useState } from "react";
import { navigate } from "./route.ts";

/** An address the page shows itself, so Back and new tabs work. */
export function Link(props: {
  to: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <a
      href={props.to}
      className={props.className}
      onClick={(e) => {
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
        e.preventDefault();
        navigate(props.to);
      }}
    >
      {props.children}
    </a>
  );
}

export function TopLine(props: {
  trail: { label: string; to: string }[];
  here: string;
  /** A label before `here`, such as "Unit 3" before the unit's title. */
  hereLabel?: string | undefined;
  /** The page's main action at the right, or in a session the position. */
  action?: ReactNode;
}) {
  return (
    <header className="nl">
      <nav className="crumbs" aria-label="Where you are">
        {props.trail.map((step) => (
          <Fragment key={step.to}>
            <Link to={step.to}>{step.label}</Link>
            <span>/</span>
          </Fragment>
        ))}
        {props.hereLabel === undefined ? null : (
          <span className="crumbs-k">{props.hereLabel}</span>
        )}
        <b>{props.here}</b>
      </nav>
      {props.action}
    </header>
  );
}

const CLOSE_ICON = (
  <svg
    width="14"
    height="14"
    viewBox="0 0 14 14"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    aria-hidden="true"
  >
    <path d="M3 3l8 8M11 3l-8 8" />
  </svg>
);

/** The pane beside the content. Esc closes it. */
export function SidePane(props: {
  title: string;
  subtitle: string;
  onClose(): void;
  children: ReactNode;
}) {
  const { onClose } = props;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <aside className="sp" aria-label={props.title}>
      <div className="sv-head">
        <b>{props.title}</b>
        <span>{props.subtitle}</span>
        <button
          type="button"
          className="sv-close"
          aria-label="Close"
          onClick={onClose}
        >
          {CLOSE_ICON}
        </button>
      </div>
      <div className="sv-body">{props.children}</div>
    </aside>
  );
}

/** The course map's icon: three units and their lines. */
const MAP_ICON = (
  <svg
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    aria-hidden="true"
  >
    <rect x="1.5" y="1.5" width="5" height="3.5" rx="1" />
    <rect x="9.5" y="6.25" width="5" height="3.5" rx="1" />
    <rect x="1.5" y="11" width="5" height="3.5" rx="1" />
    <path d="M4 5v6M6.5 3.25h3v3" />
  </svg>
);

/** "Course map" in the top line, which opens the curriculum's diagram in the side pane (piece 19). */
export function CourseMapButton(props: {
  open: boolean;
  disabled: boolean;
  onToggle(): void;
}) {
  return (
    <button
      type="button"
      className="nl-pos"
      aria-pressed={props.open}
      disabled={props.disabled}
      onClick={props.onToggle}
    >
      {MAP_ICON}
      Course map
    </button>
  );
}

export function CopyPath(props: { path: string }) {
  const [copied, setCopied] = useState<"copied" | "failed">();
  return (
    <button
      type="button"
      className="textbtn"
      onClick={() => {
        // The page is served from localhost, where the clipboard is open.
        navigator.clipboard.writeText(props.path).then(
          () => setCopied("copied"),
          () => setCopied("failed"),
        );
      }}
    >
      {copied === "copied"
        ? "Copied"
        : copied === "failed"
          ? "Could not copy"
          : "Copy path"}
    </button>
  );
}
