// Calibration (task 2.27): across every course in the data root, for each
// confidence level, the answers given without help and how many were
// correct, with "I don't know" counted apart. Derived from the evidence when
// asked, never stored. The schema and what counts are in
// src/shared/calibration.ts; why answers from before task 2.23 count is in
// docs/decisions.md, "Calibration".

import type { Calibration } from "../../shared/calibration.ts";
import type { EvidenceEntry } from "../../shared/evidence.ts";
import { CONFIDENCE_LEVELS } from "../../shared/question.ts";
import type { DataRoot } from "./data-root.ts";

/** Counts the answers in these logs, one log per course. Pure. */
export function countCalibration(
  logs: readonly (readonly EvidenceEntry[])[],
): Omit<Calibration, "skipped"> {
  const levels = CONFIDENCE_LEVELS.map((confidence) => ({
    confidence,
    correct: 0,
    answered: 0,
  }));
  let unknown = 0;
  for (const entry of logs.flat()) {
    // An answer given with help says nothing of how sure the learner was alone.
    if (entry.kind !== "answer" || entry.assisted) continue;
    const { answer } = entry;
    if (answer.kind === "unknown") {
      unknown += 1;
      continue;
    }
    const level = levels.find((l) => l.confidence === answer.confidence);
    if (level === undefined) continue;
    level.answered += 1;
    if (entry.verdict === "correct") level.correct += 1;
  }
  return { levels, unknown };
}

/**
 * Counts every course's evidence. A course whose evidence cannot be read is
 * left out and named, so one bad log does not hide the rest, as in the
 * library's list.
 */
export async function readCalibration(
  dataRoot: DataRoot,
): Promise<Calibration> {
  const courses = await dataRoot.listCourses();
  const read = await Promise.all(
    courses.map(async (stored) => {
      try {
        return { log: await dataRoot.readEvidence(stored.id) };
      } catch (error) {
        console.error(error);
        return { skipped: stored.course.title };
      }
    }),
  );
  return {
    ...countCalibration(read.flatMap((r) => ("log" in r ? [r.log] : []))),
    skipped: read.flatMap((r) => ("skipped" in r ? [r.skipped] : [])),
  };
}
