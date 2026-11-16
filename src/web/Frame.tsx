// What the views share around their content: the top line with the path out
// (docs/prototype/04-session-nav.html, 06-library.html) and the side pane
// (05-side-pane.html).

import { Fragment, type ReactNode, useEffect } from "react";
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
