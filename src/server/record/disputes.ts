// Disputes in the evidence log (task 3.8).
// Pure: the caller reads the record. A dispute names an answer by its
// question's id and holds the outcome; the answer's line keeps its first
// grade. An answer counts with its dispute's verdict where the answer
// stands in the log, not where the dispute does, so status, the check rules
// and calibration read the log through `countedEvidence`.

import { countedVerdict } from "../../shared/dispute.ts";
import type {
  AnswerEvidence,
  DisputeEvidence,
  EvidenceEntry,
  OverrideEvidence,
} from "../../shared/evidence.ts";

/** An answer or an override, the entries that count toward status. */
export type CountedEntry = AnswerEvidence | OverrideEvidence;

/**
 * The disputes in the log, by the question whose answer each names. Only the
 * first counts: the record refuses a second (`appendDispute` in
 * data-root.ts), so another would be a record written by hand.
 */
export function disputesIn(
  evidence: readonly EvidenceEntry[],
): Map<string, DisputeEvidence> {
  const disputes = new Map<string, DisputeEvidence>();
  for (const entry of evidence) {
    if (entry.kind === "dispute" && !disputes.has(entry.questionId)) {
      disputes.set(entry.questionId, entry);
    }
  }
  return disputes;
}

/** The answer to the question, if the log has it; a question has one. */
export function answerTo(
  evidence: readonly EvidenceEntry[],
  questionId: string,
): AnswerEvidence | undefined {
  return evidence.find(
    (e): e is AnswerEvidence =>
      e.kind === "answer" && e.answer.questionId === questionId,
  );
}

/**
 * The answers and overrides in log order, each disputed answer with its
 * outcome's verdict, and no disputes. The rest of a disputed answer is as
 * it was recorded.
 */
export function countedEvidence(
  evidence: readonly EvidenceEntry[],
): CountedEntry[] {
  const disputes = disputesIn(evidence);
  return evidence.flatMap((entry): CountedEntry[] =>
    entry.kind === "dispute" ? [] : [counted(entry, disputes)],
  );
}

/** The answers given, each with its dispute's verdict, if it has one. */
export function countedAnswers(
  answers: readonly AnswerEvidence[],
  evidence: readonly EvidenceEntry[],
): AnswerEvidence[] {
  const disputes = disputesIn(evidence);
  return answers.map((answer) => counted(answer, disputes));
}

function counted<E extends CountedEntry>(
  entry: E,
  disputes: ReadonlyMap<string, DisputeEvidence>,
): E {
  if (entry.kind !== "answer") return entry;
  const dispute = disputes.get(entry.answer.questionId);
  return dispute === undefined
    ? entry
    : { ...entry, verdict: countedVerdict(entry.verdict, dispute) };
}

/** The answer to dispute, or why it cannot be disputed. */
export type Disputable =
  | { ok: true; answer: AnswerEvidence }
  | { ok: false; status: 404 | 409; error: string };

/**
 * The answer to the question, if it can be disputed: not if the log has no
 * answer to it, if it was disputed once already, or if it is "I don't know"
 * to a written or code question, which shows no answer that could be wrong.
 * "I don't know" to a choice or math question can be: its answer shown is
 * reported as wrong.
 */
export function disputable(
  evidence: readonly EvidenceEntry[],
  questionId: string,
): Disputable {
  const answer = answerTo(evidence, questionId);
  if (answer === undefined) {
    return {
      ok: false,
      status: 404,
      error: "No answer to that question is recorded in this course.",
    };
  }
  const { kind } = answer.question;
  const unknown = answer.answer.kind === "unknown";
  if (unknown && kind !== "choice" && kind !== "math") {
    return {
      ok: false,
      status: 409,
      error: `"I don't know" to a ${kind} question was shown no answer, so there is none to report as wrong.`,
    };
  }
  if (disputesIn(evidence).has(questionId)) {
    return {
      ok: false,
      status: 409,
      error: unknown
        ? "The answer shown was reported once already, and it can be reported only once."
        : "This grade was disputed once already, and a grade can be disputed only once.",
    };
  }
  return { ok: true, answer };
}
