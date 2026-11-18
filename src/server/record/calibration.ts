// Calibration (tasks 2.27 and 2.29): in one course's evidence, for each
// confidence level, the answers given without help and how many were
// correct, with "I don't know" counted apart. Derived when asked, never
// stored; "What I know" sends it (what-i-know.ts). The schema and what
// counts are in src/shared/calibration.ts; why answers from before task
// 2.23 count is in docs/decisions.md, "Calibration". A disputed answer
// counts with its dispute's verdict (task 3.8).

import type { Calibration } from "../../shared/calibration.ts";
import type { EvidenceEntry } from "../../shared/evidence.ts";
import { CONFIDENCE_LEVELS } from "../../shared/question.ts";
import { countedEvidence } from "./disputes.ts";

/** Counts the answers in a course's evidence. Pure. */
export function countCalibration(
  evidence: readonly EvidenceEntry[],
): Calibration {
  const levels = CONFIDENCE_LEVELS.map((confidence) => ({
    confidence,
    correct: 0,
    answered: 0,
  }));
  let unknown = 0;
  for (const entry of countedEvidence(evidence)) {
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
