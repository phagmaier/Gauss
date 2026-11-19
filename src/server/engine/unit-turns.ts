// What the tutor of a unit chat is told (architecture.md sections 4 and 9):
// the system prompt its session starts with, and every turn's header. A
// header names the unit, the segment and the phase, the event that prompted
// the turn, and what is allowed now; the learner's text or the event's
// details follow it. Pure, so the wording is tested without a chat.

import type { StoredUnit } from "../../shared/curriculum.ts";
import type {
  AnswerEvidence,
  AssessmentMode,
  DisputeEvidence,
  EvidenceEntry,
} from "../../shared/evidence.ts";
import {
  type PackageSpec,
  type PackagesOutcome,
  requirement,
} from "../../shared/packages.ts";
import type { Plan } from "../../shared/plan.ts";
import { CHOICE_LETTERS, confidenceLabel } from "../../shared/question.ts";
import type { AssessmentRun, UnitPosition } from "../../shared/state.ts";
import type { ObjectiveStatus } from "../../shared/status.ts";
import type { RunObjective, RunStep } from "./assessment-rules.ts";
import {
  isLastSegment,
  type ObjectiveCheck,
  segmentOf,
} from "./check-rules.ts";

/** The unit being taught, as the course record has it. */
export interface UnitContext {
  courseTitle: string;
  /** The curriculum's units, in order, with their plans as read when the chat opened or an assessment was offered. */
  units: readonly StoredUnit[];
  unitId: string;
  plan: Plan;
}

/**
 * The course's notes, kept with its curriculum. A course approved before
 * style notes (task 2.10) or background notes (task 2.22) existed lacks them.
 */
export interface CourseNotes {
  style: string | undefined;
  background: string | undefined;
}

/**
 * The tutor's system prompt: `prompts/tutor.md`, then the course and the
 * unit's plan, then the course's background note, or a line saying none was
 * recorded, then its style note, or the default style when it has none. A
 * session keeps the prompt it started with (task 0.4), so the position is in
 * every turn's header instead.
 */
export function tutorSystemPrompt(
  tutor: string,
  context: UnitContext,
  notes: CourseNotes,
): string {
  const { style, background } = notes;
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
    "# The learner",
    "",
    background === undefined || background.trim() === ""
      ? "No background note was recorded for this course: learn what the " +
        "learner knows from what they ask and answer."
      : `What the learner told the planner when the course was made: ${background.trim()}`,
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
  /** The unit's objectives that have not passed, slipping ones too, in the plan's order. */
  notPassed: readonly string[];
  /** Those of them that are slipping: passed, then missed in a review or a gate. */
  slipping: readonly string[];
  /**
   * At the unit's end, the objectives the closing card's steps cover: those
   * not passed, or after the gate those it left not passed.
   */
  goOver: readonly string[];
  /** Set once the unit is finished and no longer in progress. */
  finished?: "passed" | "overridden";
  /** A graded answer's feedback is queued behind earlier learner messages. */
  feedbackPending?: number;
  /** Things the tutor has not been told yet, said once, in this header. */
  notes: readonly string[];
  /**
   * The evidence on the objectives a question may be on, in log order: a
   * turn that allows a question lists those asked on them before.
   */
  evidence: readonly EvidenceEntry[];
  /** An assessment offered or under way, with where it stands. */
  assessment?: RunWhere;
}

/** An assessment offered or under way (task 5.4), with where it stands. */
export interface RunWhere {
  run: AssessmentRun;
  /** Where each of its objectives stands, in its order. */
  standing: readonly RunObjective[];
  /** Once under way, the question it asks next; none once it has asked all it will. */
  next: RunStep | undefined;
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

/** Resumes a check whose question was blocked by another unit's install. */
export function workspaceReadyTurn(where: Where): string {
  return turn(
    where,
    "The package install in the course workspace ended. Continue the check by posting the question that was blocked.",
  );
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
          : question.kind === "math"
            ? ` The expected answer is ${question.expected}.`
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
  } else if (answer.kind === "math" && question.kind === "math") {
    lines.push(
      `The learner's answer, at ${confidenceLabel(answer.confidence)} confidence: ${answer.expression}`,
      answer.reasoning === undefined || answer.reasoning.trim() === ""
        ? "They gave no reasoning."
        : `Their reasoning: ${answer.reasoning}`,
      mathGrade(entry, question.expected),
    );
  } else if (answer.kind === "code" && question.kind === "code") {
    lines.push(
      `The learner ran the tests, at ${confidenceLabel(answer.confidence)} confidence, on their files as they were then:`,
      "",
      ...answer.files.flatMap((file) => [
        `${file.path}:`,
        fenced(file.content),
        "",
      ]),
      entry.verdict === "correct"
        ? "The tests passed: correct. The end of their output:"
        : "The tests failed: incorrect. The end of their output:",
      fenced(entry.output ?? ""),
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
  const opens = detour?.questionId === answer.questionId;
  const running = where.assessment?.run.stage === "on";
  return turn(
    where,
    `The learner answered question ${number}.`,
    lines.join("\n"),
    where.finished !== undefined
      ? undefined
      : entry.assessment !== undefined
        ? !running
          ? undefined
          : opens
            ? runDetourOpening(where, entry)
            : runFeedbackAllowed(where)
        : where.position.phase !== "check"
          ? undefined
          : opens
            ? detourOpening(where, entry)
            : feedbackAllowed(where),
  );
}

/**
 * How a math answer was graded: by the symbolic check, or by the grader
 * when the check did not settle it.
 */
function mathGrade(entry: AnswerEvidence, expected: string): string {
  const { unsettled } = entry;
  if (unsettled === undefined) {
    return entry.verdict === "correct"
      ? `The symbolic check found it equal to the expected answer, ${expected}: correct.`
      : `The symbolic check found it not equal to the expected answer, ${expected}: incorrect.`;
  }
  const why =
    unsettled.result === "unparsable"
      ? `could not read it (${unsettled.reason})`
      : unsettled.result === "undecided"
        ? `could not decide whether it equals the expected answer (${unsettled.reason})`
        : `did not run (${unsettled.reason})`;
  const by =
    `The symbolic check ${why}, so the grader, which saw only the question, ` +
    `the expected answer, ${expected}, and this answer, graded it`;
  return entry.verdict === "correct"
    ? `${by} correct.`
    : `${by} incorrect. The flaw it found: ${entry.flaw}`;
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
  const from = confusionFrom(entry);
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

/** Where a missed answer may show the learner's confusion, for a detour's first turn. */
function confusionFrom(entry: AnswerEvidence): string {
  const { answer } = entry;
  return answer.kind === "choice"
    ? `from the choice they picked${answer.reasoning?.trim() ? " and their reasoning" : ""}, or, if that does not show it, `
    : answer.kind === "math"
      ? `from the answer they gave${entry.flaw === undefined ? "" : ", the grader's flaw"}${answer.reasoning?.trim() ? " and their reasoning" : ""}, or, if that does not show it, `
      : answer.kind === "code"
        ? "from the end of the tests' output and the files they ran, or, if that does not show it, "
        : answer.kind === "written"
          ? "from the grader's flaw and what they wrote, or, if that does not show it, "
          : answer.stuck !== undefined
            ? "from where they say they got stuck, or, if that does not show it, "
            : "";
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
      " Posting ends your turn." +
      askedBefore(where, toAsk),
  );
}

// --- Assessments (task 5.4) ----------------------------------------------------

/** What an assessment is called, in a header and on its buttons. */
export function runName(mode: AssessmentMode): string {
  return mode === "test-out" ? "test" : mode;
}

/**
 * The turn that asks for an assessment's next question, with the header
 * alone: once the learner starts it, after the feedback on question
 * `number`, once the learner ends the detour after it, or when a unit
 * reopens in it with nothing open.
 */
export function runTurn(
  where: Where,
  event:
    | { after: "start" | "reopened" }
    | { after: "feedback" | "detour"; number: number; objective?: string },
): string {
  const run = where.assessment?.run;
  const name = runName(run?.mode ?? "review");
  const count = run?.objectives.length ?? 0;
  let said: string;
  switch (event.after) {
    case "start":
      said =
        run?.mode === "gate"
          ? `The learner started the unit's gate: ${questions(count)}, ${gateSplit(where)}, ` +
            "one on each objective they passed, and one more after a miss."
          : `The learner started the ${name}: ${questions(count)} ` +
            "on objectives they passed before, one on each, and one more after a miss.";
      break;
    case "reopened":
      said = `The ${name} goes on where it was.`;
      break;
    case "feedback":
      said = `The ${name} goes on after your feedback on question ${event.number}.`;
      break;
    case "detour":
      said =
        `The learner pressed "${detourButton(where.assessment, event.objective ?? "")}": ` +
        `the detour after question ${event.number} is over, and the ${name} goes on.`;
      break;
  }
  return turn(where, said);
}

/**
 * The note for the turn after an assessment the tutor was asking ended:
 * every objective asked, or skipped partway.
 */
export function runEndNote(
  mode: AssessmentMode,
  ended:
    | { skipped: true; withdrawn: number | undefined }
    | { skipped: false; statuses: Record<string, ObjectiveStatus> },
): string {
  const name = runName(mode);
  const goesOn =
    mode === "gate"
      ? "The learner now sees the unit's closing card, with each objective's status as it stands."
      : `The unit goes on where it stood before the ${name}.`;
  if (ended.skipped) {
    const withdrawn =
      ended.withdrawn === undefined
        ? ""
        : `, and question ${ended.withdrawn} was withdrawn`;
    return `The learner skipped the rest of the ${name}${withdrawn}. ${goesOn}`;
  }
  const said = Object.entries(ended.statuses).map(
    ([id, status]) =>
      `"${id}" ${status === "slipping" ? "slipping (passed before, now missed, so it must pass again)" : status}`,
  );
  return (
    `The ${name} is over: ${said.join("; ")}. ${goesOn} Do not go back ` +
    `over the ${name} unless the learner asks.`
  );
}

/** The turn that takes the check up again once an assessment that came in it ends. */
export function checkGoesOnTurn(where: Where): string {
  return turn(where, "The check goes on.");
}

/** Where the assessment's objectives stand, for the tutor. */
function runStanding(where: Where): string {
  const { assessment } = where;
  if (assessment === undefined) return "";
  return assessment.run.objectives
    .map(({ objective }, i) => {
      const standing = assessment.standing[i];
      const said =
        standing === undefined || standing.state === "unasked"
          ? "not asked yet"
          : standing.state === "again"
            ? "missed, so one more question follows the detour"
            : standing.missed
              ? "missed, then asked once more"
              : "answered correctly";
      return `question ${i + 1}, "${objective}": ${said}`;
    })
    .join("; ");
}

/** The objective as the tutor needs it: whose it is, and what it states. */
function aboutObjective(where: Where, step: RunStep): string {
  const { context } = where;
  if (step.unit === context.unitId) {
    const statement = context.plan.objectives.find(
      (o) => o.id === step.objective,
    )?.statement;
    return `"${step.objective}" is an objective of this unit: ${statement}`;
  }
  const at = context.units.findIndex((u) => u.id === step.unit);
  const unit = context.units[at];
  const statement = unit?.plan?.objectives.find(
    (o) => o.id === step.objective,
  )?.statement;
  return (
    `"${step.objective}" is an objective of unit ${at + 1}, ` +
    `"${unit?.title}", which this conversation may not have taught: ${statement}`
  );
}

/**
 * What the learner presses to end the detour after a miss on the
 * objective: another question on it, or going on to the assessment's next
 * objective, or its end.
 */
export function detourButton(
  assessment: RunWhere | undefined,
  objective: string,
): string {
  const name = runName(assessment?.run.mode ?? "review");
  const at =
    assessment?.run.objectives.findIndex((o) => o.objective === objective) ??
    -1;
  if (assessment?.standing[at]?.state === "again") {
    return "Ready for another question";
  }
  return assessment?.next === undefined
    ? `Finish the ${name}`
    : `Go on with the ${name}`;
}

/** What an assessment allows while it is offered or under way; undefined once it is neither. */
function runAllowed(where: Where): string | undefined {
  const { assessment, position } = where;
  if (assessment === undefined) return undefined;
  const { run, next } = assessment;
  const name = runName(run.mode);
  if (run.stage === "offered") {
    const count = run.objectives.length;
    if (run.mode === "gate") {
      return (
        `The unit's gate, ${questions(count)}, ${gateSplit(where)}, is ` +
        "offered to the learner on a card, which they start or skip, now or " +
        "in a later sitting; the unit ends after it. Allowed now: reply to " +
        "the learner. No teaching tools."
      );
    }
    return (
      `A ${name} of ${questions(count)} is ` +
      "offered to the learner on a card, which they start or skip; the unit " +
      "waits until they do. Allowed now: reply to the learner. No teaching tools."
    );
  }
  // An open question, or feedback queued, reads as in a check.
  const waiting = questionAllowed(where);
  if (waiting !== undefined) return waiting;
  const standing = runStanding(where);
  const { detour } = position;
  if (detour !== undefined) {
    return (
      `In this ${name}, ${standing}. A detour is open after the miss on ` +
      `question ${detour.number}, on "${detour.objective}": nothing in it ` +
      "is graded, and the learner's messages are not help. Allowed now: " +
      "work through the confusion with the learner, briefly: a refresher, " +
      "not the unit taught again. ask_question is refused until they press " +
      `"${detourButton(assessment, detour.objective)}"; you may suggest it once ` +
      "the confusion seems cleared."
    );
  }
  if (next === undefined) {
    return (
      `In this ${name}, ${standing}. Every objective has been asked, and ` +
      `the ${name} is ending. Allowed now: reply to the learner. No more questions.`
    );
  }
  const unlike = next.second
    ? ", and unlike the one just missed: ask about the same idea another way"
    : "";
  return (
    `In this ${name}, ${standing}. Allowed now: a lead-in of one sentence, ` +
    `then a question on "${next.objective}" with ask_question, unlike the ` +
    `ones asked before${unlike}. ${aboutObjective(where, next)} No teaching ` +
    `in a ${name}: before the question, no reminder of the idea, rule or ` +
    "method, and no example. Posting ends your turn." +
    askedBefore(where, [next.objective])
  );
}

/** "one question", or "9 questions". */
function questions(count: number): string {
  return count === 1 ? "one question" : `${count} questions`;
}

/** How a gate's questions divide between this unit's objectives and other units'. */
function gateSplit(where: Where): string {
  const objectives = where.assessment?.run.objectives ?? [];
  const own = objectives.filter((o) => o.unit === where.context.unitId).length;
  const others = objectives.length - own;
  if (others === 0) return "all on this unit's objectives";
  if (own === 0) return "all on other units' objectives";
  return `${own} on this unit's objectives and ${others} on other units'`;
}

/** The turn after a correct answer in an assessment: feedback alone, briefly. */
function runFeedbackAllowed(where: Where): string {
  const name = runName(where.assessment?.run.mode ?? "review");
  const next =
    where.assessment?.next === undefined
      ? `this was the ${name}'s last question, and the ${name} ends once your feedback does`
      : "once it ends, the app asks you for the next question in a message of its own";
  return (
    `In this ${name}, ${runStanding(where)}. Allowed now: feedback on this ` +
    "answer in a sentence or two, written as text, and nothing else: no " +
    `teaching. No tool may be called in this reply: ${next}.`
  );
}

/**
 * The first turn of a detour in an assessment: the right answer, the
 * confusion found and worked through, briefly. After a first miss one more
 * question on the objective follows; after a second, none.
 */
function runDetourOpening(where: Where, entry: AnswerEvidence): string {
  const name = runName(where.assessment?.run.mode ?? "review");
  const button = detourButton(where.assessment, entry.objective);
  const at =
    where.assessment?.run.objectives.findIndex(
      (o) => o.objective === entry.objective,
    ) ?? -1;
  const after =
    where.assessment?.standing[at]?.state === "again"
      ? `When they press it, one more question on "${entry.objective}" follows.`
      : `Nothing more is asked on "${entry.objective}": when they press it, ` +
        `the ${name} ${where.assessment?.next === undefined ? "ends" : "moves on to its next objective"}.`;
  return (
    `In this ${name}, ${runStanding(where)}. The miss opens a detour, a ` +
    `pause in the ${name}: no question is posted until the learner presses ` +
    `"${button}", and nothing said in it is graded. Allowed now, as text, ` +
    "with no tool: give the right answer and why it is right; then find " +
    `where the confusion is, ${confusionFrom(entry)}by asking them one ` +
    "question, and work through it with them: a short refresher, not the " +
    `unit taught again. ${after} You may suggest pressing "${button}" once ` +
    "the confusion seems cleared."
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

/**
 * The note that tells the tutor of a unit in progress how a dispute of an
 * answer's grade ended (task 3.8), since its feedback or detour may have
 * taught from a wrong key: the question, the grade before and after, a
 * corrected key or expected answer, the judge's reason and the learner's.
 */
export function disputeNote(
  answer: AnswerEvidence,
  dispute: DisputeEvidence,
): string {
  const { question } = answer;
  const { outcome } = dispute;
  const first = answer.verdict === "correct" ? "correct" : "incorrect";
  const grade =
    outcome.verdict === first
      ? `kept the grade, ${first}`
      : `changed the grade from ${first} to ${outcome.verdict}`;
  const key =
    outcome.key !== undefined && question.kind === "choice"
      ? ` The key was wrong: the correct choice is ${outcome.key}, not ${question.answer}.`
      : outcome.expected !== undefined && question.kind === "math"
        ? ` The expected answer was wrong: it is ${outcome.expected}, not ${question.expected}.`
        : "";
  return (
    `The learner disputed the grade of their answer to a question on ` +
    `"${answer.objective}" ("${shortPrompt(question.prompt)}"), giving this reason: ` +
    `"${oneLine(dispute.reason)}". A separate judge, which saw the question, ` +
    `what it was graded by, the answer and that reason, ${grade}.${key} ` +
    `Its reason: ${oneLine(outcome.reason)} The answer now counts as ` +
    `${outcome.verdict}, and where the check stands follows from that.`
  );
}

/**
 * The note that tells the tutor how its request to install packages ended
 * (task 3.11): installed, failed with the end of the output, or declined.
 */
export function packagesNote(
  outcome: PackagesOutcome,
  packages: readonly PackageSpec[],
  output?: string,
): string {
  const named = packages.map((p) => requirement(p)).join(", ");
  switch (outcome) {
    case "installed":
      return (
        `The learner installed the packages you asked for: ${named}. They ` +
        "are in the workspace's environment: run its Python as " +
        "`.venv/bin/python` (as `.venv/bin/python -m pytest`)."
      );
    case "failed":
      return (
        `Installing the packages you asked for, ${named}, failed. The end ` +
        `of its output:\n\n${output ?? ""}\n\nThey are not installed. ` +
        "Tell the learner in a sentence; you may ask again with other names " +
        "or versions."
      );
    case "declined":
      return (
        `The learner answered "Not now" to installing ${named}. They are not ` +
        "installed: go on without them, and ask again only when the learner " +
        "says they are ready."
      );
    case "withdrawn":
      return (
        `The unit ended before the learner answered your request to install ${named}. ` +
        "They are not installed."
      );
  }
}

/** The turn that brings a note on packages the tutor asked for (task 3.11). */
export function packagesTurn(where: Where): string {
  return turn(where, "The learner answered your request to install packages.");
}

/** The note for the first turn of a session that joins a unit under way. */
export const JOINED_NOTE =
  "This conversation is new: the earlier conversation in this unit is not available to you, so do not refer to it.";

// --- The header ------------------------------------------------------------

function turn(
  where: Where,
  event: string,
  body?: string,
  allowedNow = runAllowed(where) ?? allowed(where),
): string {
  const waiting = where.position.packageRequest;
  const request =
    waiting === undefined || where.finished !== undefined
      ? []
      : [
          `Your request to install ${waiting.packages.map((p) => requirement(p)).join(", ")} ` +
            "waits for the learner's answer: the packages are not installed yet.",
        ];
  const header = [
    describe(where),
    event,
    ...where.notes,
    ...request,
    allowedNow,
  ].join(" ");
  return body === undefined ? `[${header}]` : `[${header}]\n${body}`;
}

function describe(where: Where): string {
  const { context, position } = where;
  const unitAt = context.units.findIndex((u) => u.id === context.unitId);
  const unit = `Unit ${unitAt + 1} of ${context.units.length}, "${context.units[unitAt]?.title}"`;
  if (where.finished !== undefined) {
    const { slipping } = where;
    const movedOn = where.notPassed.filter((id) => !slipping.includes(id));
    const since =
      slipping.length === 0
        ? ""
        : ` Since then, ${quoted(slipping)} ${slipping.length === 1 ? "was" : "were"} missed in a review or a gate, and ${slipping.length === 1 ? "is" : "are"} slipping.`;
    return movedOn.length === 0
      ? `${unit}. The unit is finished: every objective passed.${since}`
      : `${unit}. The unit is finished: the learner moved on without passing ${quoted(movedOn)}.${since}`;
  }
  const segment = segmentOf(context.plan, position);
  const which = segment.again
    ? `a segment after the plan's ${context.plan.segments.length}, going over ${quoted(segment.objectives)} again`
    : `segment ${position.segment + 1} of ${context.plan.segments.length}, ` +
      `"${segment.title}", on ${quoted(segment.objectives)}`;
  const run =
    where.assessment?.run.stage !== "on"
      ? ""
      : where.assessment.run.mode === "gate"
        ? " The unit's gate is under way, and the unit ends after it."
        : ` A ${runName(where.assessment.run.mode)} is under way, and the segment waits until it ends.`;
  return `${unit}; ${which}. Phase: ${position.phase}.${run}`;
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
      const waiting = questionAllowed(where);
      if (waiting !== undefined) return waiting;
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
          "then a one-sentence lead-in." +
          askedBefore(where, toAsk)
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
        ? "The segment is closed, and it was the unit's last. " +
            (position.gated === true
              ? `The unit's gate left ${quoted(where.goOver)} not passed.`
              : `Not passed: ${quoted(where.goOver)}.`) +
            " The learner chooses whether to go over them again or to move " +
            "on without them. Allowed now: reply to the learner. No teaching tools."
        : "The segment is closed; the learner starts the next one when they " +
            "choose. Allowed now: reply to the learner. No teaching tools " +
            "until the next segment starts.";
  }
}

/**
 * What a question open, or a graded answer whose feedback is queued, allows,
 * in a check or an assessment; undefined when neither is so.
 */
function questionAllowed(where: Where): string | undefined {
  const open = where.position.openQuestion;
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
  return undefined;
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
    case "second":
      return `answered correctly, which does not pass alone, so a second correct answer, to a different question, is needed (${count})`;
  }
}

/** How many of the questions asked on an objective a turn lists, the latest. */
const ASKED_LISTED = 6;

/** Separates question history from the scripted backend's control text. */
export const QUESTION_HISTORY_START = "\nQuestions asked before:\n";

/**
 * For a turn that allows a question: the questions the evidence holds on
 * each objective it may be on, a line each, from a new line. Each prompt is
 * quoted, so no line of the list ends in a "]" of a prompt's: the scripted
 * backend takes the first "]" at a line's end for the header's.
 */
function askedBefore(where: Where, objectives: readonly string[]): string {
  if (objectives.length === 0) return "";
  const sections = objectives.map((id) => {
    const prompts = where.evidence.flatMap((e) =>
      e.kind === "answer" && e.objective === id ? [e.question.prompt] : [],
    );
    if (prompts.length === 0) {
      return `No question has been asked on "${id}" before.`;
    }
    const listed = prompts.slice(-ASKED_LISTED);
    const head =
      listed.length < prompts.length
        ? `The latest ${listed.length} of the ${prompts.length} questions asked on "${id}" before, the oldest first:`
        : `Asked on "${id}" before, the oldest first:`;
    return [head, ...listed.map((p) => `- "${shortPrompt(p)}"`)].join("\n");
  });
  return QUESTION_HISTORY_START + sections.join("\n");
}

/** A question's prompt on one line, cut to 200 characters, for a header. */
function shortPrompt(prompt: string): string {
  const line = oneLine(prompt);
  if (line.length <= 200) return line;
  // In Unicode mode the final two characters establish that the line is too long.
  const prefix = /^(.{199}).{2}/u.exec(line)?.[1];
  return prefix === undefined ? line : `${prefix}…`;
}

/** Text on one line: a header ends at its first "]" and line end. */
function oneLine(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

/** Text between fences of backticks longer than any run of them in it. */
function fenced(text: string): string {
  const longest = Math.max(
    0,
    ...(text.match(/`+/g) ?? []).map((r) => r.length),
  );
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}\n${text.trimEnd()}\n${fence}`;
}

/** "a", or "a" and "b", or "a", "b" and "c". */
export function quoted(ids: readonly string[]): string {
  const q = ids.map((id) => `"${id}"`);
  return q.length <= 1
    ? (q[0] ?? "")
    : `${q.slice(0, -1).join(", ")} and ${q.at(-1)}`;
}
