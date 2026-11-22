// The outlines of a course's sources, which the cards need to say what its
// units read. Fetched only once a unit shown names a section, and again when
// one names a source not yet held: an intake can attach a source after its
// first proposal.

import { useEffect, useState } from "react";
import { type Unit, unitSections } from "../shared/curriculum.ts";
import { CourseSources, type Outline } from "../shared/source.ts";
import { getJson } from "./api.ts";

/**
 * The course's outlines, or undefined while none is needed or they are
 * being fetched (then the cards show no reads).
 */
export function useCourseSources(
  courseId: string | undefined,
  units: readonly Pick<Unit, "sections">[],
): readonly Outline[] | undefined {
  const [held, setHeld] = useState<{
    courseId: string;
    /** The sources named when they were fetched. */
    named: string;
    outlines: Outline[];
  }>();
  const ids = new Set(
    units.flatMap((unit) =>
      unitSections(unit).map((ref) => ref.slice(0, ref.indexOf("/"))),
    ),
  );
  const named = [...ids].sort().join(" ");
  const outlines = held?.courseId === courseId ? held?.outlines : undefined;
  const missing =
    courseId !== undefined &&
    [...ids].some((id) => !outlines?.some((source) => source.id === id));
  // A source still missing after a fetch for the same names is not one of
  // the course's: the fetch is not repeated, and lines name its sections by
  // their refs.
  const settled = !missing || held?.named === named;
  const wanted = missing ? named : "";

  useEffect(() => {
    if (courseId === undefined || wanted === "") return;
    const stop = new AbortController();
    void getJson(
      `/api/courses/${encodeURIComponent(courseId)}/sources`,
      CourseSources,
      stop.signal,
    ).then((answer) => {
      if (answer.ok) {
        setHeld({ courseId, named: wanted, outlines: answer.data.sources });
      }
    });
    return () => stop.abort();
  }, [courseId, wanted]);

  return settled ? outlines : undefined;
}
