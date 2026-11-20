// Which view the address shows: the library, the learner profile, an
// intake, a course, its "What I know", its planning conversation, a unit's
// session or its notes.
// The page moves between them without reloading, and the browser's Back works.

import { useEffect, useState } from "react";

export type Route =
  | { view: "library" }
  | { view: "profile" }
  | { view: "intake"; intakeId: string }
  | { view: "course"; courseId: string }
  | { view: "known"; courseId: string }
  | { view: "planning"; courseId: string }
  | { view: "unit"; courseId: string; unitId: string }
  | { view: "notes"; courseId: string; unitId: string };

export const paths = {
  library: "/",
  profile: "/profile",
  intake: (id: string) => `/intakes/${encodeURIComponent(id)}`,
  course: (id: string) => `/courses/${encodeURIComponent(id)}`,
  known: (id: string) => `/courses/${encodeURIComponent(id)}/what-i-know`,
  planning: (id: string) => `/courses/${encodeURIComponent(id)}/planning`,
  unit: (courseId: string, unitId: string) =>
    `/courses/${encodeURIComponent(courseId)}/units/${encodeURIComponent(unitId)}`,
  notes: (courseId: string, unitId: string) =>
    `${paths.unit(courseId, unitId)}/notes`,
};

/** Any address that names no view shows the library. */
export function parseRoute(pathname: string): Route {
  const [kind, id, ...rest] = pathname.split("/").filter((p) => p !== "");
  const name = id === undefined ? undefined : decoded(id);
  if (kind === "profile" && id === undefined) return { view: "profile" };
  if (name !== undefined && rest.length === 0) {
    if (kind === "intakes") return { view: "intake", intakeId: name };
    if (kind === "courses") return { view: "course", courseId: name };
  }
  if (kind === "courses" && name !== undefined && rest.length === 1) {
    if (rest[0] === "what-i-know") return { view: "known", courseId: name };
    if (rest[0] === "planning") return { view: "planning", courseId: name };
  }
  const [units, unit, ...beyond] = rest;
  const unitName = unit === undefined ? undefined : decoded(unit);
  if (
    kind === "courses" &&
    name !== undefined &&
    units === "units" &&
    unitName !== undefined
  ) {
    if (beyond.length === 0)
      return { view: "unit", courseId: name, unitId: unitName };
    if (beyond.length === 1 && beyond[0] === "notes")
      return { view: "notes", courseId: name, unitId: unitName };
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
