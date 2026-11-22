import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Unit } from "../shared/curriculum.ts";
import type { Outline, OutlineSection } from "../shared/source.ts";
import { pageLabel, placeSpan } from "../shared/source-lines.ts";
import { orderedSections } from "../shared/source-quote.ts";
import type { SourceTarget } from "../shared/source-target.ts";
import { SidePane } from "./Frame.tsx";
import { SourceText } from "./SourceText.tsx";
import { FORMAT_NAMES } from "./source-card.ts";
import {
  keptTexts,
  type OutlineRow,
  openSection,
  outlineRows,
  type ReaderPart,
  type SectionRead,
} from "./source-reader.ts";
import "./source-pane.css";

type SectionTarget = Extract<SourceTarget, { kind: "section" }>;
interface Props {
  base: string;
  source: Outline;
  target: SourceTarget;
  units?: readonly Unit[];
  onClose(): void;
}

/** External opens are actions, not just locations. Clicking the same link a
 * second time returns from a page or outline and lights its text again. */
export function SourcePane(props: Props) {
  const [opened, setOpened] = useState({ target: props.target, key: 0 });
  if (opened.target !== props.target)
    setOpened({ target: props.target, key: opened.key + 1 });
  const url = `${props.base}/${encodeURIComponent(props.source.id)}`;
  // Kept across the reader's views and reopenings, while the pane is open.
  const load = useMemo(
    () =>
      keptTexts(async (id, signal) => {
        const response = await fetch(
          `${url}/sections/${encodeURIComponent(id)}`,
          { signal },
        );
        if (!response.ok)
          throw new Error(`${response.status} ${response.statusText}`);
        return response.text();
      }),
    [url],
  );
  return (
    <Reader key={`${url}/${opened.key}`} {...props} url={url} load={load} />
  );
}

const NO_UNITS: readonly Unit[] = [];

function Reader({
  url,
  load,
  source,
  units = NO_UNITS,
  target,
  onClose,
}: Props & { url: string; load: SectionRead }) {
  const order = useMemo(() => orderedSections(source), [source]);
  const [view, setView] = useState(target);
  const [origin, setOrigin] = useState<SectionTarget>();
  const [backPage, setBackPage] = useState<number>();
  const index =
    view.kind === "section"
      ? order.findIndex((s) => s.id === view.section)
      : view.kind === "page"
        ? order.findIndex(
            (s) =>
              "pages" in s.place &&
              s.place.pages.first <= view.page &&
              s.place.pages.last >= view.page,
          )
        : -1;
  const section = order[index];
  const previous = order[index - 1];
  const next = order[index + 1];
  const showPage = useCallback(
    (page: number) => {
      if (view.kind === "section") setOrigin({ ...view, page });
      setView({ kind: "page", source: source.id, page });
    },
    [view, source.id],
  );
  const goSection = (id: string) => {
    setBackPage(undefined);
    setView({ kind: "section", source: source.id, section: id });
  };
  const outline = () => {
    setBackPage(undefined);
    setView({
      kind: "outline",
      source: source.id,
      ...(target.kind === "outline" && target.unit && { unit: target.unit }),
    });
  };
  const sub =
    view.kind === "outline"
      ? "Outline"
      : view.kind === "page"
        ? `Page ${pageLabel(source, view.page)}`
        : section
          ? [section.title, placeSpan(source, section.place)]
              .filter(Boolean)
              .join(" · ")
          : view.section;
  return (
    <SidePane
      title={source.title}
      subtitle={sub}
      onClose={onClose}
      className="source-pane"
      actions={
        view.kind === "outline" ? undefined : (
          <button className="reader-to-outline" type="button" onClick={outline}>
            Outline
          </button>
        )
      }
    >
      {view.kind === "outline" ? (
        <OutlineView
          source={source}
          units={units}
          count={order.length}
          focus={view.unit}
          onSelect={goSection}
        />
      ) : view.kind === "page" ? (
        <PageView
          key={view.page}
          source={source}
          page={view.page}
          url={url}
          onPage={showPage}
          onBack={() => {
            setBackPage(view.page);
            if (
              origin &&
              (origin.page === view.page || section?.id === origin.section)
            )
              setView(origin);
            else if (section)
              setView({
                kind: "section",
                source: source.id,
                section: section.id,
                page: view.page,
              });
            else outline();
          }}
        />
      ) : (
        <>
          <SectionView
            key={view.section}
            target={view}
            source={source}
            load={load}
            order={order}
            backPage={backPage}
            onPage={showPage}
          />
          {section && (
            <nav className="reader-neighbors" aria-label="Sections">
              {previous && (
                <button type="button" onClick={() => goSection(previous.id)}>
                  <small>Previous</small> {previous.title}
                </button>
              )}
              {next && (
                <button
                  className="reader-next"
                  type="button"
                  onClick={() => goSection(next.id)}
                >
                  {next.title} <small>Next</small>
                </button>
              )}
            </nav>
          )}
        </>
      )}
    </SidePane>
  );
}

function OutlineView({
  source,
  count,
  focus,
  units,
  onSelect,
}: {
  source: Outline;
  count: number;
  focus: string | undefined;
  units: readonly Unit[];
  onSelect(id: string): void;
}) {
  const rows = useMemo(
    () => outlineRows(source, units, focus),
    [source, units, focus],
  );
  const pane = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (focus)
      pane.current
        ?.querySelector(".reader-focused")
        ?.scrollIntoView({ block: "nearest" });
  }, [focus]);
  return (
    <div className="reader-scroll reader-outline" ref={pane}>
      <p className="reader-facts">
        {FORMAT_NAMES[source.format]}
        {source.pages
          ? ` · ${source.pages.count} ${source.pages.count === 1 ? "page" : "pages"}`
          : ""}{" "}
        · {count} {count === 1 ? "section" : "sections"}
        <br />
        {source.name}
      </p>
      <Rows rows={rows} units={units} onSelect={onSelect} />
    </div>
  );
}

function Rows({
  rows,
  units,
  onSelect,
}: {
  rows: readonly OutlineRow[];
  units: readonly Unit[];
  onSelect(id: string): void;
}) {
  return (
    <ul>
      {rows.map((row) =>
        "children" in row ? (
          <li key={row.id}>
            <details open={row.open}>
              <summary>{row.title}</summary>
              <Rows rows={row.children} units={units} onSelect={onSelect} />
            </details>
          </li>
        ) : (
          <li key={row.id}>
            <button
              type="button"
              className={`reader-leaf${row.focused ? " reader-focused" : ""}`}
              onClick={() => onSelect(row.id)}
            >
              <span>{row.title}</span>
              <span className="reader-place">{row.place}</span>
              <span className="reader-units">
                {row.units.map((number) => (
                  <span title={units[number - 1]?.title} key={number}>
                    Unit {number}
                  </span>
                ))}
              </span>
            </button>
          </li>
        ),
      )}
    </ul>
  );
}

function PageView({
  source,
  url,
  page,
  onBack,
  onPage,
}: {
  source: Outline;
  url: string;
  page: number;
  onBack(): void;
  onPage(page: number): void;
}) {
  const [failed, setFailed] = useState(false);
  const label = pageLabel(source, page);
  return (
    <div className="reader-scroll reader-page">
      <div className="reader-page-tools">
        {/* The printed label is for citations; the count is in PDF order. */}
        <span>
          Page {label}
          {source.pages &&
            (label === String(page)
              ? ` of ${source.pages.count}`
              : ` · PDF page ${page} of ${source.pages.count}`)}
        </span>
        <button
          type="button"
          aria-label="Previous page"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          ‹
        </button>
        <button
          type="button"
          aria-label="Next page"
          disabled={page >= (source.pages?.count ?? page)}
          onClick={() => onPage(page + 1)}
        >
          ›
        </button>
        <button type="button" onClick={onBack}>
          Back to the text
        </button>
      </div>
      {failed ? (
        <p role="alert">The image of page {label} could not be loaded.</p>
      ) : (
        <img
          src={`${url}/pages/${page}`}
          alt={`Page ${label} of ${source.title}`}
          onError={() => setFailed(true)}
        />
      )}
    </div>
  );
}

function SectionView({
  target,
  source,
  load,
  order,
  onPage,
  backPage,
}: {
  target: SectionTarget;
  source: Outline;
  load: SectionRead;
  order: readonly OutlineSection[];
  onPage(page: number): void;
  backPage: number | undefined;
}) {
  const [read, setRead] = useState<ReaderPart[] | string>();
  const pane = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const stop = new AbortController();
    void openSection(source, order, target.section, target.quote, (id) =>
      load(id, stop.signal),
    ).then(
      (parts) => {
        if (!stop.signal.aborted) setRead(parts);
      },
      (error: unknown) => {
        if (!stop.signal.aborted)
          setRead(error instanceof Error ? error.message : String(error));
      },
    );
    return () => stop.abort();
  }, [load, source, order, target.section, target.quote]);
  useLayoutEffect(() => {
    const box = pane.current;
    if (!Array.isArray(read) || !box) return;
    const page = backPage ?? target.page;
    const number = page && box.querySelector(`[data-page="${page}"]`);
    const at =
      (backPage === undefined && target.quote && box.querySelector("mark")) ||
      number ||
      box.querySelector(".reader-text > :first-child");
    if (!at) return;
    box.scrollTop +=
      at.getBoundingClientRect().top - box.getBoundingClientRect().top - 64;
    if (target.light && backPage === undefined) {
      const block = at.closest("p, h1, h2, h3, h4, h5, h6, li, pre") ?? at;
      block.classList.add("reader-lit");
      const timer = window.setTimeout(
        () => block.classList.remove("reader-lit"),
        1600,
      );
      return () => {
        clearTimeout(timer);
        block.classList.remove("reader-lit");
      };
    }
  }, [read, target, backPage]);
  return (
    <div className="reader-scroll" ref={pane}>
      {read === undefined ? (
        <p className="reader-status" role="status">
          Loading section…
        </p>
      ) : typeof read === "string" ? (
        <p className="reader-status" role="alert">
          The section could not be loaded: {read}
        </p>
      ) : (
        <>
          {target.quote && !read.some((part) => part.mark) && (
            <p className="reader-status">
              The quoted passage could not be located in this section.
            </p>
          )}
          {read.map((part) => (
            <SourceText key={part.id} part={part} onPage={onPage} />
          ))}
        </>
      )}
    </div>
  );
}
