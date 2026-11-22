// The outlines of a course's sources, which the cards need to say what its
// units read, and the thread to say what the tutor read. The endpoint gives
// all outlines at once. Only the intake can change that set, by attaching a
// source after its first proposal.

import { useEffect, useState } from "react";
import { type Unit, unitSections } from "../shared/curriculum.ts";
import { CourseSources, type Outline } from "../shared/source.ts";
import { getJsonUntilAnswered } from "./api.ts";

/** Whether a unit shown names a section, so the cards need the outlines. */
export function readsSources(
  units: readonly Pick<Unit, "sections">[],
): boolean {
  return units.some((unit) => unitSections(unit).length > 0);
}

/**
 * Loads once `needed`. A new version (a successful intake attachment)
 * refreshes the outlines without hiding the last read.
 */
export function useCourseSources(
  courseId: string | undefined,
  needed: boolean,
  version = 0,
): { sources: readonly Outline[] | undefined; problem: string | undefined } {
  const [held, setHeld] = useState<{
    courseId: string;
    version: number;
    complete: boolean;
    sources: Outline[] | undefined;
    problem: string | undefined;
  }>();
  const current = held?.courseId === courseId ? held : undefined;
  const settled = current?.version === version && current.complete;
  const wanted = needed && !settled ? courseId : undefined;

  useEffect(() => {
    if (wanted === undefined) return;
    const stop = new AbortController();
    const reportFailure = (error: string, retrying: boolean) => {
      setHeld((before) => ({
        courseId: wanted,
        version,
        complete: !retrying,
        sources: before?.courseId === wanted ? before.sources : undefined,
        problem: `The course's source outlines could not be loaded: ${error}${retrying ? " Trying again…" : ""}`,
      }));
    };
    void getJsonUntilAnswered(
      `/api/courses/${encodeURIComponent(wanted)}/sources`,
      CourseSources,
      {
        signal: stop.signal,
        onFailure: (error) => reportFailure(error, true),
      },
    ).then((answer) => {
      if (answer === undefined || stop.signal.aborted) return;
      if (answer.ok) {
        setHeld({
          courseId: wanted,
          version,
          complete: true,
          sources: answer.data.sources,
          problem: undefined,
        });
      } else {
        reportFailure(answer.error, false);
      }
    });
    return () => stop.abort();
  }, [wanted, version]);

  return {
    sources: needed ? current?.sources : undefined,
    problem:
      needed && current?.version === version ? current.problem : undefined,
  };
}
