// What the "What I know" view says (task 2.26): a summary of the course's
// objectives by status, the units not started, each objective's and unit's
// status word, and what one answer in its evidence says beside its question
// and answer. The view is drawn in WhatIKnow.tsx from what the server
// derives (src/server/record/what-i-know.ts).

import { type ChoiceLetter, confidenceLabel } from "../shared/question.ts";
import type { ObjectiveStatus, UnitStatus } from "../shared/status.ts";
import type { ShownEvidence, WhatIKnow } from "../shared/what-i-know.ts";
import { unitNumbers } from "./units.ts";

/** A word and the class that colours it. */
export interface Word {
  text: string;
  className: string;
}

/** The words in the order the summary counts them, as the learner reads them. */
const STATUS_WORDS: Record<ObjectiveStatus, Word> = {
  passed: { text: "Passed", className: "pass" },
  overridden: { text: "Overridden", className: "over" },
  attempted: { text: "Not passed yet", className: "miss" },
  "not-started": { text: "Not started", className: "" },
};

export function objectiveMark(status: ObjectiveStatus): Word {
  return STATUS_WORDS[status];
}

/** A unit's status beside its heading, in the course view's words. */
export function unitWord(status: UnitStatus): Word {
  switch (status) {
    case "passed":
      return { text: "Passed", className: "pass" };
    case "overridden":
      return { text: "Overridden", className: "over" };
    case "in-progress":
      return { text: "In progress", className: "now" };
    case "not-started":
      return { text: "Not started", className: "" };
  }
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/**
 * "2 units started, with 9 objectives: 3 passed, 1 overridden, 3 not passed
 * yet and 2 not started." A unit has objectives once it starts.
 */
export function knownSummary(view: WhatIKnow): string {
  const started = view.units.flatMap((u) =>
    u.objectives === null ? [] : [u.objectives],
  );
  if (started.length === 0) return "No unit has started yet.";
  const statuses = started.flat().map((o) => o.status);
  const head = `${plural(started.length, "unit")} started, with ${plural(statuses.length, "objective")}`;
  const counts = (Object.keys(STATUS_WORDS) as ObjectiveStatus[])
    .map((status) => ({
      status,
      count: statuses.filter((s) => s === status).length,
    }))
    .filter((c) => c.count > 0);
  const [only] = counts;
  if (counts.length === 1 && only !== undefined) {
    const word = objectiveMark(only.status).text.toLowerCase();
    return `${head}: ${only.count === 1 ? word : `all ${word}`}.`;
  }
  const parts = counts.map(
    (c) => `${c.count} ${objectiveMark(c.status).text.toLowerCase()}`,
  );
  return `${head}: ${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}.`;
}

/** "Units 2 and 4 have not started; …", or null when every unit has. */
export function unstartedLine(view: WhatIKnow): string | null {
  const numbers = view.units
    .filter((u) => u.objectives === null)
    .map((u) => u.number);
  if (numbers.length === 0) return null;
  const units = unitNumbers(numbers);
  return `${units[0]?.toUpperCase()}${units.slice(1)} ${numbers.length === 1 ? "has" : "have"} not started; a unit's objectives are set when it starts.`;
}

/** What an answer's line says beside its question and answer. */
export interface AnswerLine {
  verdict: Word;
  /** How sure the learner said they were; none for "I don't know". */
  sure?: string;
  /** Set when the answer was given with help. */
  help?: string;
  /** The right choice, for a choice question missed. */
  correctChoice?: ChoiceLetter;
}

export function answerLine(
  entry: Extract<ShownEvidence, { kind: "answer" }>,
): AnswerLine {
  const { answer, question, verdict } = entry;
  return {
    verdict:
      verdict === "correct"
        ? { text: "Correct", className: "ok" }
        : verdict === "incorrect"
          ? { text: "Not quite", className: "no" }
          : { text: "Did not know", className: "dk" },
    ...(answer.kind === "unknown"
      ? {}
      : { sure: `${confidenceLabel(answer.confidence)} sure` }),
    // A miss is a miss with help or without; only a right answer loses by it.
    ...(entry.assisted
      ? {
          help:
            verdict === "correct"
              ? "With help, so it did not count"
              : "With help",
        }
      : {}),
    ...(question.kind === "choice" && verdict !== "correct"
      ? { correctChoice: question.answer }
      : {}),
  };
}

/**
 * "14 November 2026, 10:05": the day and the time, in local time. Each part
 * is formatted on its own, as how a locale joins them differs between ICU
 * versions ("," or "at").
 */
export function recordedOn(iso: string): string {
  const at = new Date(iso);
  const day = at.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const time = at.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${day}, ${time}`;
}
