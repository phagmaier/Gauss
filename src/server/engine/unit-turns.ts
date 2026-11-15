// What the tutor of a unit chat is told (architecture.md sections 4 and 9):
// the system prompt its session starts with, and every turn's header. A
// header names the unit, the segment and the phase, the event that prompted
// the turn, and what is allowed now; the learner's text or the event's
// details follow it. Pure, so the wording is tested without a chat.

import type { Unit } from "../../shared/curriculum.ts";
import type { AnswerEvidence } from "../../shared/evidence.ts";
import type { Plan } from "../../shared/plan.ts";
import { CHOICE_LETTERS, confidenceLabel } from "../../shared/question.ts";
import type { UnitPosition } from "../../shared/state.ts";

/** The unit being taught, as the course record has it. */
export interface UnitContext {
  courseTitle: string;
  /** The curriculum's units, in order. */
  units: readonly Unit[];
  unitId: string;
  plan: Plan;
}

/**
 * The tutor's system prompt: `prompts/tutor.md`, then the course and the
 * unit's plan, then the course's style note, or the default style when it
 * has none. A session keeps the prompt it started with (task 0.4), so the
 * position is in every turn's header instead.
 */
export function tutorSystemPrompt(
  tutor: string,
  context: UnitContext,
  style: string | undefined,
): string {
  const { units, plan } = context;
  const at = units.findIndex((u) => u.id === context.unitId);
  const unit = units[at];
  const statement = new Map(plan.objectives.map((o) => [o.id, o.statement]));
  const lines = [
    tutor.trimEnd(),
    "",
    "# This course",
    "",
    `The course is "${context.courseTitle}". Its units, in order:`,
    "",
    ...units.map((u, i) => `${i + 1}. ${u.title} (id "${u.id}"): ${u.goal}`),
    "",
    `You teach unit ${at + 1}, "${unit?.title}". Its goal: ${unit?.goal}`,
    "",
    "Its plan, in teaching order:",
    "",
    ...plan.segments.flatMap((segment, i) => [
      `Segment ${i + 1}, "${segment.title}":`,
      ...segment.objectives.map((id) => `- "${id}": ${statement.get(id)}`),
    ]),
    "",
    "# This course's style",
    "",
    style === undefined || style.trim() === ""
      ? "This course has no style note of its own: use the default style above."
      : style.trim(),
  ];
  return `${lines.join("\n")}\n`;
}

/** Where the unit stands when a turn is sent. */
export interface Where {
  context: UnitContext;
  position: UnitPosition;
  /** The objectives with an answer in this check; empty outside the check. */
  answered: ReadonlySet<string>;
  /** Things the tutor has not been told yet, said once, in this header. */
  notes: readonly string[];
}

export function teachTurn(where: Where, again: boolean): string {
  const segment = currentSegment(where);
  const statement = new Map(
    where.context.plan.objectives.map((o) => [o.id, o.statement]),
  );
  const event = again
    ? "Your teaching of this segment was cut off before it ended. Teach it again, from the start."
    : "Start of the segment.";
  return turn(
    where,
    event,
    [
      "Teach these objectives:",
      ...segment.objectives.map((id) => `- "${id}": ${statement.get(id)}`),
    ].join("\n"),
  );
}

export function messageTurn(where: Where, text: string): string {
  return turn(where, "Message from the learner.", text);
}

export function readyTurn(where: Where): string {
  return turn(where, 'The learner pressed "ready".');
}

export function answerTurn(
  where: Where,
  entry: AnswerEvidence,
  number: number,
): string {
  const { question, answer } = entry;
  const lines = [
    `Question ${number}, on "${entry.objective}":`,
    question.prompt,
    ...question.choices.map((c, i) => `${CHOICE_LETTERS[i]}. ${c}`),
    "",
  ];
  if (answer.kind === "unknown") {
    lines.push(
      `The learner answered "I don't know", which counts as a miss. The correct choice is ${question.answer}.`,
    );
  } else {
    lines.push(
      `The learner chose ${answer.choice}, at ${confidenceLabel(answer.confidence)} confidence.`,
      answer.reasoning === undefined || answer.reasoning.trim() === ""
        ? "They gave no reasoning."
        : `Their reasoning: ${answer.reasoning}`,
      entry.verdict === "correct"
        ? "Graded: correct."
        : `Graded: incorrect. The correct choice is ${question.answer}.`,
    );
  }
  return turn(
    where,
    `The learner answered question ${number}.`,
    lines.join("\n"),
  );
}

/** The note for the turn after the learner moved on without the check. */
export function overrideNote(
  objectives: readonly string[],
  withdrawn: number | undefined,
): string {
  const question =
    withdrawn === undefined ? "" : ` Question ${withdrawn} was withdrawn.`;
  return (
    "The learner moved on without finishing the check of the segment just " +
    `closed, which is recorded as an override of ${quoted(objectives)}.${question}`
  );
}

/** The note for the first turn of a session that joins a unit under way. */
export const JOINED_NOTE =
  "This conversation is new: the earlier conversation in this unit is not available to you, so do not refer to it.";

// --- The header ------------------------------------------------------------

function turn(where: Where, event: string, body?: string): string {
  const header = [describe(where), event, ...where.notes, allowed(where)].join(
    " ",
  );
  return body === undefined ? `[${header}]` : `[${header}]\n${body}`;
}

function describe(where: Where): string {
  const { context, position } = where;
  const unitAt = context.units.findIndex((u) => u.id === context.unitId);
  const unit = context.units[unitAt];
  const segment = currentSegment(where);
  return (
    `Unit ${unitAt + 1} of ${context.units.length}, "${unit?.title}"; ` +
    `segment ${position.segment + 1} of ${context.plan.segments.length}, ` +
    `"${segment.title}", on ${quoted(segment.objectives)}. ` +
    `Phase: ${position.phase}.`
  );
}

function allowed(where: Where): string {
  const { position, context } = where;
  switch (position.phase) {
    case "teach":
      return (
        "Allowed now: teach the segment's objectives in this turn, within " +
        "the length the style sets, then stop; the learner can ask anything " +
        "next. No questions yet: ask_question and close_segment are refused " +
        'until the learner presses "ready".'
      );
    case "discuss":
      return (
        "Allowed now: answer the learner; nothing here is graded. You may " +
        'suggest they press "ready" for the check when they seem ready. ' +
        "ask_question and close_segment are refused until they do."
      );
    case "check": {
      const open = position.openQuestion;
      if (open !== undefined) {
        return (
          `Question ${open.number}, on "${open.objective}", is open. Allowed ` +
          "now: reply without giving its answer away. ask_question and " +
          "close_segment are refused until the learner answers it."
        );
      }
      const missing = currentSegment(where).objectives.filter(
        (id) => !where.answered.has(id),
      );
      if (missing.length > 0) {
        return (
          `Without an answer in this check: ${quoted(missing)}. Allowed now: ` +
          "post a question on one of them with ask_question. Posting ends " +
          "your turn, so give any feedback first. close_segment is refused " +
          "until each objective of the segment has an answer."
        );
      }
      return (
        "Every objective of the segment has an answer in this check. " +
        "Allowed now: give your feedback, then close the segment with " +
        "close_segment, which ends your turn; or post another question with " +
        "ask_question."
      );
    }
    case "closed":
      return position.segment + 1 >= context.plan.segments.length
        ? "The segment is closed, and it was the unit's last. Allowed now: " +
            "reply to the learner. No teaching tools."
        : "The segment is closed; the learner starts the next one when they " +
            "choose. Allowed now: reply to the learner. No teaching tools " +
            "until the next segment starts.";
  }
}

function currentSegment(where: Where) {
  const segment = where.context.plan.segments[where.position.segment];
  if (segment === undefined) {
    throw new Error(
      `The unit has no segment ${where.position.segment + 1} in its plan.`,
    );
  }
  return segment;
}

/** "a", or "a" and "b", or "a", "b" and "c". */
export function quoted(ids: readonly string[]): string {
  const q = ids.map((id) => `"${id}"`);
  return q.length <= 1
    ? (q[0] ?? "")
    : `${q.slice(0, -1).join(", ")} and ${q.at(-1)}`;
}
