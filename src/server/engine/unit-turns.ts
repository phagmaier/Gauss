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
import {
  isLastSegment,
  type ObjectiveCheck,
  segmentOf,
} from "./check-rules.ts";

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
  /** In the check: where each objective of the segment stands. */
  checks: ReadonlyMap<string, ObjectiveCheck>;
  /** The unit's objectives that have not passed, in the plan's order. */
  notPassed: readonly string[];
  /** Set once the unit is finished and no longer in progress. */
  finished?: "passed" | "overridden";
  /** A graded answer's feedback is queued behind earlier learner messages. */
  feedbackPending?: number;
  /** Things the tutor has not been told yet, said once, in this header. */
  notes: readonly string[];
}

export function teachTurn(where: Where, cutOff: boolean): string {
  const segment = segmentOf(where.context.plan, where.position);
  const statement = new Map(
    where.context.plan.objectives.map((o) => [o.id, o.statement]),
  );
  const event = cutOff
    ? "Your teaching of this segment was cut off before it ended. Teach it again, from the start."
    : segment.again
      ? "Start of a segment that goes over objectives the learner has not passed."
      : "Start of the segment.";
  const lead = segment.again
    ? "Teach these objectives again, another way, starting from what went wrong:"
    : "Teach these objectives:";
  return turn(
    where,
    event,
    [
      lead,
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

/**
 * The first turn of the session the learner's "Start fresh" begins (task
 * 2.14). Its notes say the conversation is new.
 */
export function freshTurn(where: Where): string {
  return turn(
    where,
    "The learner started a fresh conversation with you, from their progress.",
    "Greet them in a sentence or two, say where the unit stands, then go on as this header allows.",
  );
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
  ];
  if (question.kind === "choice") {
    lines.push(...question.choices.map((c, i) => `${CHOICE_LETTERS[i]}. ${c}`));
  }
  lines.push("");
  if (answer.kind === "unknown") {
    lines.push(
      `The learner answered "I don't know", which counts as a miss.` +
        (question.kind === "choice"
          ? ` The correct choice is ${question.answer}.`
          : ""),
      answer.stuck === undefined
        ? "They did not say where they got stuck."
        : `Where they got stuck, in their words: ${answer.stuck}`,
    );
  } else if (answer.kind === "choice" && question.kind === "choice") {
    lines.push(
      `The learner chose ${answer.choice}, at ${confidenceLabel(answer.confidence)} confidence.`,
      answer.reasoning === undefined || answer.reasoning.trim() === ""
        ? "They gave no reasoning."
        : `Their reasoning: ${answer.reasoning}`,
      entry.verdict === "correct"
        ? "Graded: correct."
        : `Graded: incorrect. The correct choice is ${question.answer}.`,
    );
  } else if (answer.kind === "written") {
    lines.push(
      `The learner wrote, at ${confidenceLabel(answer.confidence)} confidence:`,
      "",
      answer.text,
      "",
      entry.verdict === "correct"
        ? "The grader, which saw only the question, your rubric and this answer, graded it correct."
        : "The grader, which saw only the question, your rubric and this answer, graded it incorrect. " +
            `The first flaw it found: ${entry.flaw}`,
    );
  }
  if (entry.assisted) {
    lines.push(
      "They had help: a reply of yours to a message of theirs while the question was open was judged help, or could not be judged, so this answer does not count toward passing.",
    );
  }
  const { detour } = where.position;
  return turn(
    where,
    `The learner answered question ${number}.`,
    lines.join("\n"),
    where.finished !== undefined || where.position.phase !== "check"
      ? undefined
      : detour?.questionId === answer.questionId
        ? detourOpening(where, entry)
        : feedbackAllowed(where),
  );
}

/**
 * What the first turn of a detour allows (task 2.20): it takes the place of
 * the feedback on the missed answer. The tutor gives the right answer, finds
 * where the confusion is and works through it, and from the objective's
 * second miss in this check teaches it again another way. No tool: the
 * learner asks for the next question.
 */
function detourOpening(where: Where, entry: AnswerEvidence): string {
  const { standing } = checkStanding(where);
  const check = where.checks.get(entry.objective);
  const missed = check?.state === "more" ? check.missed : 1;
  const { answer } = entry;
  const from =
    answer.kind === "choice"
      ? `from the choice they picked${answer.reasoning?.trim() ? " and their reasoning" : ""}, or, if that does not show it, `
      : answer.kind === "written"
        ? "from the grader's flaw and what they wrote, or, if that does not show it, "
        : answer.stuck !== undefined
          ? "from where they say they got stuck, or, if that does not show it, "
          : "";
  const again =
    missed >= 2
      ? ` "${entry.objective}" has been missed ${missed} times in this check, ` +
        "so after the right answer, teach the objective again another way: " +
        "a new angle and a new example, not a repeat of your teaching, and " +
        "not only a fix of this one mistake."
      : "";
  return (
    `In this check, ${standing}. The miss opens a detour, a pause in the ` +
    'check: no question is posted until the learner presses "Ready for ' +
    'another question", and nothing said in it is graded. Allowed now, as ' +
    "text, with no tool: give the right answer and why it is right; then " +
    `find where the confusion is, ${from}by asking them one question, and ` +
    `work through it with them.${again} You may suggest pressing "Ready ` +
    'for another question" once the confusion seems cleared.'
  );
}

/**
 * What the turn after a graded answer allows: feedback, and no tool (task
 * 2.16a). Given the next question to plan, the tutor wrote its feedback in
 * its thinking, which is never shown, so the next question is asked for in
 * a turn of its own.
 */
function feedbackAllowed(where: Where): string {
  const { standing, toAsk } = checkStanding(where);
  const next =
    toAsk.length > 0
      ? "once it ends, the app asks you for the next question in a message of its own"
      : "every objective is done, so the check is over, and the segment closes once it ends";
  return (
    `In this check, ${standing}. Allowed now: your feedback on this ` +
    "answer, written as text, and nothing else. No tool may be called in " +
    `this reply: ${next}.`
  );
}

/**
 * The turn that asks for the check's next question, with the header alone:
 * after the feedback on a correct answer (task 2.16a), or once the learner
 * ends the detour after question `number` (task 2.20).
 */
export function nextQuestionTurn(
  where: Where,
  number: number,
  after: "feedback" | "detour" = "feedback",
): string {
  const { standing, toAsk } = checkStanding(where);
  return turn(
    where,
    after === "feedback"
      ? `The check goes on after your feedback on question ${number}.`
      : 'The learner pressed "Ready for another question": the detour ' +
          `after question ${number} is over, and the check goes on.`,
    undefined,
    `In this check, ${standing}. Allowed now: a lead-in of one sentence, ` +
      `then a question on ${quoted(toAsk)} with ask_question, unlike the ` +
      "ones asked before. " +
      (after === "feedback"
        ? "Do not repeat your feedback."
        : "Do not go back over the detour.") +
      " Posting ends your turn.",
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

function turn(
  where: Where,
  event: string,
  body?: string,
  allowedNow = allowed(where),
): string {
  const header = [describe(where), event, ...where.notes, allowedNow].join(" ");
  return body === undefined ? `[${header}]` : `[${header}]\n${body}`;
}

function describe(where: Where): string {
  const { context, position } = where;
  const unitAt = context.units.findIndex((u) => u.id === context.unitId);
  const unit = `Unit ${unitAt + 1} of ${context.units.length}, "${context.units[unitAt]?.title}"`;
  if (where.finished !== undefined) {
    return where.finished === "passed"
      ? `${unit}. The unit is finished: every objective passed.`
      : `${unit}. The unit is finished: the learner moved on without passing ${quoted(where.notPassed)}.`;
  }
  const segment = segmentOf(context.plan, position);
  const which = segment.again
    ? `a segment after the plan's ${context.plan.segments.length}, going over ${quoted(segment.objectives)} again`
    : `segment ${position.segment + 1} of ${context.plan.segments.length}, ` +
      `"${segment.title}", on ${quoted(segment.objectives)}`;
  return `${unit}; ${which}. Phase: ${position.phase}.`;
}

function allowed(where: Where): string {
  const { position, context } = where;
  if (where.finished !== undefined) {
    return "Allowed now: reply to the learner. No teaching tools.";
  }
  switch (position.phase) {
    case "teach":
      return (
        "Allowed now: teach the segment's objectives in this turn, within " +
        "the length the style sets, then stop; the learner can ask anything " +
        "next. No questions yet: ask_question is refused until the learner " +
        'presses "ready".'
      );
    case "discuss":
      return (
        "Allowed now: answer the learner; nothing here is graded. You may " +
        'suggest they press "ready" for the check when they seem ready. ' +
        "ask_question is refused until they do."
      );
    case "check": {
      const open = position.openQuestion;
      if (open !== undefined) {
        const helped =
          open.assisted === true
            ? " A reply of yours to the learner while it was open was judged help, so the answer will be recorded as given with help."
            : "";
        if (open.answer !== undefined) {
          const state =
            open.judging === undefined
              ? "the answer is being graded"
              : "the answer is graded once your replies to the learner while it was open are judged";
          return (
            `Question ${open.number}, on "${open.objective}", is answered, ` +
            `and ${state}.${helped} Allowed now: reply to the learner. ` +
            "ask_question is refused until the grade arrives, in a message " +
            "of its own."
          );
        }
        return (
          `Question ${open.number}, on "${open.objective}", is open.${helped} ` +
          "Allowed now: reply without giving its answer away. You may " +
          "clarify what the question asks: its wording, its notation, the " +
          "form of answer wanted. A separate judge reads each reply you " +
          "write while it is open, and one that gives anything toward the " +
          "answer (a method, a step, a value, a similar worked example, a " +
          "mistake to avoid, whether a guess is right) makes the answer " +
          "count as given with help. ask_question is refused until the " +
          "learner answers it."
        );
      }
      if (where.feedbackPending !== undefined) {
        return (
          `Question ${where.feedbackPending} is graded, and your feedback on ` +
          "it is queued in a message of its own. Allowed now: reply to the " +
          "learner without posting a question; ask_question is refused " +
          "until that feedback ends."
        );
      }
      const { standing, toAsk } = checkStanding(where);
      const { detour } = position;
      if (detour !== undefined) {
        return (
          `In this check, ${standing}. A detour is open after the miss on ` +
          `question ${detour.number}, on "${detour.objective}": nothing in ` +
          "it is graded, and the learner's messages are not help. Allowed " +
          "now: work through the confusion with the learner. ask_question " +
          'is refused until they press "Ready for another question"; you ' +
          "may suggest it once the confusion seems cleared."
        );
      }
      if (toAsk.length > 0) {
        return (
          `In this check, ${standing}. Allowed now: post a question on ` +
          `${quoted(toAsk)} with ask_question, unlike the ones asked before. ` +
          "Posting ends your turn, so write what you have to say first, " +
          "then a one-sentence lead-in."
        );
      }
      // The segment closes when the feedback on the check's last answer
      // ends, or when a unit reopened at this point opens.
      return (
        `In this check, ${standing}. Every objective is done, and the ` +
        "segment is closing. Allowed now: reply to the learner. No more " +
        "questions."
      );
    }
    case "closed":
      return isLastSegment(context.plan, position)
        ? "The segment is closed, and it was the unit's last. Not passed: " +
            `${quoted(where.notPassed)}. The learner chooses whether to go ` +
            "over them again or to move on without them. Allowed now: reply " +
            "to the learner. No teaching tools."
        : "The segment is closed; the learner starts the next one when they " +
            "choose. Allowed now: reply to the learner. No teaching tools " +
            "until the next segment starts.";
  }
}

/** Where each of the segment's objectives stands in the check, and those that need a question. */
function checkStanding(where: Where): { standing: string; toAsk: string[] } {
  const { objectives } = segmentOf(where.context.plan, where.position);
  return {
    standing: objectives
      .map((id) => `"${id}": ${checkText(where.checks.get(id))}`)
      .join("; "),
    toAsk: objectives.filter((id) => where.checks.get(id)?.state !== "done"),
  };
}

/** Where one objective stands in the check, for the tutor. */
export function checkText(check: ObjectiveCheck | undefined): string {
  if (check === undefined || check.state === "unasked") return "not asked yet";
  if (check.state === "done") return "passed";
  const count = `${check.asked} asked`;
  switch (check.reason) {
    case "missed":
      return `missed, so another question is needed (${count})`;
    case "assisted":
      return `answered correctly with help, which does not count, so another question is needed (${count})`;
    case "unconfident":
      return `answered correctly but under 90% sure, which does not pass, so another question is needed (${count})`;
    case "confirm":
      return `answered correctly and confidently, but missed earlier, so a second correct answer, to a different question, is needed (${count})`;
  }
}

/** "a", or "a" and "b", or "a", "b" and "c". */
export function quoted(ids: readonly string[]): string {
  const q = ids.map((id) => `"${id}"`);
  return q.length <= 1
    ? (q[0] ?? "")
    : `${q.slice(0, -1).join(", ")} and ${q.at(-1)}`;
}
