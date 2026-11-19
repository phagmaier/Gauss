// The first grade, standing after a dispute, and feedback shown on graded cards
// in the live thread, What I know, and the transcript export.

import { countedVerdict, type GradedBy, type ShownDispute } from "./dispute.ts";
import type { ChoiceLetter, Verdict } from "./question.ts";

/** A public grade and its dispute, without the private grading material. */
export interface Disputed {
  /** The first grade. */
  verdict: Verdict;
  /** The choice key, for a choice question. */
  key?: ChoiceLetter | undefined;
  /** The expected expression, for a math question. */
  expected?: string | undefined;
  dispute?: ShownDispute | undefined;
}

/** The first grade, as the record beside the outcome names it. */
export interface FirstGrade extends Disputed {
  kind: "choice" | "math" | "written" | "code";
  flaw?: string | undefined;
}

/** The first verdict and the public feedback that went with it. */
export function firstGradeFeedback(
  first: FirstGrade,
):
  | { label: string; flaw: string }
  | { label: string; key: ChoiceLetter }
  | { label: string; expected: string }
  | { label: string } {
  const verdict = verdictWord(first.verdict).text;
  if (first.flaw !== undefined)
    return { label: `${verdict}:`, flaw: first.flaw };
  if (first.kind === "choice" && first.key !== undefined)
    return { label: `${verdict}, by the key`, key: first.key };
  if (first.kind === "math" && first.expected !== undefined)
    return {
      label: `${verdict}, by the expected answer`,
      expected: first.expected,
    };
  return {
    label: first.kind === "code" ? `${verdict}, by the tests` : verdict,
  };
}

/** What the answer shows, as its dispute left it. */
export interface Standing {
  /** The verdict it counts with. */
  verdict: Verdict;
  /** A dispute changed its verdict: marked "after your dispute". */
  changed: boolean;
  /** A dispute changed its verdict, its key or its expected answer: the first grade is shown. */
  corrected: boolean;
  /** The right choice now, for a choice question. */
  key?: ChoiceLetter;
  /** The expected answer now, for a math question. */
  expected?: string;
}

export function standing(answer: Disputed): Standing {
  const { dispute } = answer;
  const verdict = countedVerdict(answer.verdict, dispute);
  const key = dispute?.outcome.key ?? answer.key;
  const expected = dispute?.outcome.expected ?? answer.expected;
  const changed = verdict !== answer.verdict;
  return {
    verdict,
    changed,
    corrected:
      changed ||
      dispute?.outcome.key !== undefined ||
      dispute?.outcome.expected !== undefined,
    ...(key === undefined ? {} : { key }),
    ...(expected === undefined ? {} : { expected }),
  };
}

/** "Correct", "Not quite" or "Did not know", with the class that colours it. */
export function verdictWord(verdict: Verdict): {
  text: string;
  className: string;
} {
  return verdict === "correct"
    ? { text: "Correct", className: "ok" }
    : verdict === "incorrect"
      ? { text: "Not quite", className: "no" }
      : { text: "Did not know", className: "dk" };
}

/** The mark beside a verdict a dispute changed. */
export const AFTER_DISPUTE = "after your dispute";

/** The outcome's first words: "The grade stands." or "Changed to Correct." */
export function outcomeHead(answer: Disputed): string {
  const { verdict, changed } = standing(answer);
  return changed
    ? `Changed to ${verdictWord(verdict).text}.`
    : "The grade stands.";
}

/** The heading over what the answer was graded by, in the dispute's form. */
export function gradedByHeading(by: GradedBy): string {
  switch (by.kind) {
    case "choice":
      return "Graded by this key";
    case "math":
      return by.rubric === undefined
        ? "Graded by the symbolic check, comparing your answer with"
        : "Graded by the grader, since the symbolic check did not settle it, against this rubric";
    case "written":
      return "Graded against this rubric";
    case "code":
      return by.tests.length === 1
        ? "Graded by this test"
        : "Graded by these tests";
  }
}

/** Said under the reason: who decides, and what it sees. */
export const DECIDED_BY =
  "Decided once, by a separate check that sees the question, what it was " +
  "graded by, your answer and this reason, and nothing of the conversation.";
