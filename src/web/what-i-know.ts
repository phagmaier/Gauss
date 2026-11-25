// What the "What I know" view says (task 2.26): a summary of the course's
// objectives by status, the units not started, each objective's and unit's
// status word, and what one answer in its evidence says beside its question
// and answer, with the verdict and key a dispute left (task 3.8; dispute.ts)
// and the assessment it was given in (piece 16); and what a misconception
// found on the objective says above its answers (piece 18).
// The view is drawn in WhatIKnow.tsx from what the server derives
// (src/server/record/what-i-know.ts).

import { standing, verdictWord } from "../shared/dispute-view.ts";
import type { Assessment } from "../shared/evidence.ts";
import { isOpen } from "../shared/misconception.ts";
import {
  type ChoiceLetter,
  confidenceLabel,
  type Unsettled,
  type Verdict,
} from "../shared/question.ts";
import type { ObjectiveStatus, UnitStatus } from "../shared/status.ts";
import type {
  ShownEvidence,
  ShownMisconception,
  WhatIKnow,
} from "../shared/what-i-know.ts";
import { unitNumbers } from "./units.ts";

/** A word and the class that colours it. */
export interface Word {
  text: string;
  className: string;
}

/** The words in the order the summary counts them, as the learner reads them. */
const STATUS_WORDS: Record<ObjectiveStatus, Word> = {
  retained: { text: "Retained", className: "kept" },
  passed: { text: "Passed", className: "pass" },
  slipping: { text: "Slipping", className: "slip" },
  overridden: { text: "Overridden", className: "over" },
  attempted: { text: "Not passed yet", className: "miss" },
  "not-started": { text: "Not started", className: "" },
};

export function objectiveMark(status: ObjectiveStatus): Word {
  return STATUS_WORDS[status];
}

/**
 * A unit's status beside its heading, in the course view's words. A unit in
 * progress takes the colour of its form, the outline of an objective not
 * passed yet: the accent marks only the current unit, in the course view.
 */
export function unitWord(status: UnitStatus): Word {
  switch (status) {
    case "passed":
      return { text: "Passed", className: "pass" };
    case "overridden":
      return { text: "Overridden", className: "over" };
    case "in-progress":
      return { text: "In progress", className: "miss" };
    case "not-started":
      return { text: "Not started", className: "" };
  }
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/**
 * "2 units started, with 9 objectives: 2 retained, 1 passed, 1 slipping, 3
 * not passed yet and 2 not started." A unit has objectives once it starts.
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
  /** The verdict it counts with: a dispute's, if it has one. */
  verdict: Word;
  /** A dispute changed the verdict. */
  changed: boolean;
  /** How sure the learner said they were; none for "I don't know". */
  sure?: string;
  /** Set when the answer was given with help. */
  help?: string;
  /** The right choice, for a choice question missed, as a dispute left it. */
  correctChoice?: ChoiceLetter;
  /** The expected answer, for a math question missed, as a dispute left it. */
  expected?: string;
  /** Why the grader graded a math answer, when the symbolic check did not. */
  gradedBy?: string;
  /** The assessment it was given in: "In a review", "In unit 3's gate", "Testing out". */
  givenIn?: string;
}

/**
 * @param unitNumber the number of the unit by its id, to name the unit whose
 *   gate an answer was given in
 */
export function answerLine(
  entry: Extract<ShownEvidence, { kind: "answer" }>,
  unitNumber: (unitId: string) => number | undefined = () => undefined,
): AnswerLine {
  const { answer, question } = entry;
  const now = standing({
    verdict: entry.verdict,
    key: question.kind === "choice" ? question.answer : undefined,
    expected: question.kind === "math" ? question.expected : undefined,
    dispute: entry.dispute,
  });
  const { verdict } = now;
  return {
    verdict: verdictWord(verdict),
    changed: now.changed,
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
    ...(question.kind === "choice" && verdict !== "correct" && now.key
      ? { correctChoice: now.key }
      : {}),
    ...(question.kind === "math" && verdict !== "correct" && now.expected
      ? { expected: now.expected }
      : {}),
    ...(entry.unsettled === undefined
      ? {}
      : { gradedBy: unsettledLine(entry.unsettled) }),
    ...(entry.assessment === undefined
      ? {}
      : { givenIn: givenIn(entry.assessment, verdict, unitNumber) }),
  };
}

/** Where an answer was given; a miss while testing out does not count as one. */
function givenIn(
  assessment: Assessment,
  verdict: Verdict,
  unitNumber: (unitId: string) => number | undefined,
): string {
  switch (assessment.mode) {
    case "review":
      return "In a review";
    case "gate": {
      const number = unitNumber(assessment.unit);
      return number === undefined ? "In a gate" : `In unit ${number}'s gate`;
    }
    case "test-out":
      return verdict === "correct"
        ? "Testing out"
        : "Testing out, so not counted as a miss";
    case "self-test":
      return "In a self-test";
  }
}

/** What a misconception's head says (piece 18). */
export interface MisconceptionHead {
  /** Open while its objective is not passed; cleared once it has. */
  open: boolean;
  state: "Open" | "Cleared";
  /** "Found 17 November 2026, in the detour after question 3". */
  found: string;
}

/**
 * @param status the status of the objective it sits under
 * @param unit the id of that objective's unit, and the number of a unit by
 *   its id, to name another unit whose thread showed it
 */
export function misconceptionHead(
  misconception: ShownMisconception,
  status: ObjectiveStatus,
  unit: { id: string; number: (unitId: string) => number | undefined },
): MisconceptionHead {
  const open = isOpen(status);
  const { where } = misconception;
  const place =
    where.in === "detour"
      ? `in the detour after question ${where.number}`
      : where.in === "test"
        ? "in the test"
        : "in the discussion";
  const other =
    misconception.unit === unit.id
      ? undefined
      : unit.number(misconception.unit);
  const day = new Date(misconception.recordedAt).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  return {
    open,
    state: open ? "Open" : "Cleared",
    found: `Found ${day}, ${other === undefined ? "" : `in unit ${other}, `}${place}`,
  };
}

/**
 * Why the grader graded a math answer: the symbolic check did not settle
 * it. The graded card in the session says it too.
 */
export function unsettledLine(unsettled: Unsettled): string {
  const why =
    unsettled.result === "unparsable"
      ? `could not read the answer (${unsettled.reason})`
      : unsettled.result === "undecided"
        ? `could not decide it (${unsettled.reason})`
        : `did not run (${unsettled.reason})`;
  return `The grader, since the symbolic check ${why}.`;
}

/** A line of a code question's output, marked when it says the run failed or passed. */
export interface OutputLine {
  text: string;
  /** "f": a failure, "p": the pass; none for the rest. */
  mark?: "f" | "p";
}

/**
 * The end of a code question's tests' output, line by line (task 3.7): the
 * lines that name a failure marked, and the last line, which says how the
 * run ended, marked a pass or a failure by the verdict.
 */
export function outputLines(
  output: string,
  verdict: "correct" | "incorrect" | "unknown",
): OutputLine[] {
  const lines = output.split("\n");
  return lines.map((text, i) => {
    if (i === lines.length - 1) {
      return { text, mark: verdict === "correct" ? "p" : "f" };
    }
    return /^(FAILED|ERROR)\b/.test(text) ? { text, mark: "f" } : { text };
  });
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
