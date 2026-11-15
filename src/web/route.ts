// Which view the address shows: the library, an intake, or a course. The
// page moves between them without reloading, and the browser's Back works.

import { useEffect, useState } from "react";

export type Route =
  | { view: "library" }
  | { view: "intake"; intakeId: string }
  | { view: "course"; courseId: string };

export const paths = {
  library: "/",
  intake: (id: string) => `/intakes/${encodeURIComponent(id)}`,
  course: (id: string) => `/courses/${encodeURIComponent(id)}`,
};

/** Any address that names no view shows the library. */
export function parseRoute(pathname: string): Route {
  const [kind, id, ...rest] = pathname.split("/").filter((p) => p !== "");
  const name = id === undefined ? undefined : decoded(id);
  if (name !== undefined && rest.length === 0) {
    if (kind === "intakes") return { view: "intake", intakeId: name };
    if (kind === "courses") return { view: "course", courseId: name };
  }
  return { view: "library" };
}

/** Undefined for a malformed escape such as "%E0%A4", which would throw. */
function decoded(part: string): string | undefined {
  try {
    return decodeURIComponent(part);
  } catch {
    return undefined;
  }
}

const CHANGED = "gauss:navigate";

export function navigate(path: string) {
  window.history.pushState(null, "", path);
  window.dispatchEvent(new Event(CHANGED));
}

export function useRoute(): Route {
  const [path, setPath] = useState(() => window.location.pathname);
  useEffect(() => {
    const update = () => setPath(window.location.pathname);
    window.addEventListener("popstate", update);
    window.addEventListener(CHANGED, update);
    return () => {
      window.removeEventListener("popstate", update);
      window.removeEventListener(CHANGED, update);
    };
  }, []);
  return parseRoute(path);
}
