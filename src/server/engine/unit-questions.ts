// Question posting: the board behind ask_question. The tutor posts a
// question in the check, on an objective of the segment that still needs
// one (check-rules.ts), or in an assessment, on the objective it asks next;
// anything else is refused with a reason the tutor can act on. When a
// question is posted, a math question's expected expression must read
// (math-check.ts, task 3.5), and a code question's tests must fail on the
// starter files and pass on the tutor's solution (code-run.ts, task 3.7).
// A question is stored in the course's queue, which a package install
// closes; one that an install in another unit refused is asked for again
// in a turn of its own when the install ends, if the chat still waits for
// it. A Stop, or the chat's close, cancels a posting under way and aborts
// its math read or code check; the close waits for the code check to end.
// The unit chat keeps the running unit, the Stop count, whether it is
// closing, and the workspace's folder, read at each call; the check's rules
// (`checks` and the rest); the assessment's rules from the unit's
// assessments (`runOn`, `nextOf` and the rest, unit-assessments.ts); and
// the course's workspace, whose queue admits a question.

import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { PageEvent } from "../../shared/events.ts";
import {
  type AssessmentHead,
  postedQuestion,
  type Question,
  type QuestionInput,
  type QuestionView,
} from "../../shared/question.ts";
import type {
  AssessmentRun,
  OpenQuestion,
  Phase,
  UnitPosition,
} from "../../shared/state.ts";
import type { QuestionBoard } from "../tools/ask-question.ts";
import type { RunStep } from "./assessment-rules.ts";
import type { ObjectiveCheck } from "./check-rules.ts";
import { type ChoiceOrder, reorder } from "./choice-order.ts";
import type { CodeRunner } from "./code-run.ts";
import type { MathCheck } from "./math-check.ts";
import type { UnitAgents } from "./unit-agents.ts";
import type { UnitProgression } from "./unit-progression.ts";
import type { UnitRecord } from "./unit-record.ts";
import {
  checkText,
  detourButton,
  pickedKinds,
  quoted,
  type RunWhere,
  runName,
  type Where,
  workspaceReadyTurn,
} from "./unit-turns.ts";

/** Returned when a Stop or the chat's close cancels a posting under way. */
export const QUESTION_STOPPED = {
  refused: "Stop canceled posting this question.",
};

/** The loaded unit, as posting reads and changes it. */
interface PostingUnit {
  record: Pick<
    UnitRecord,
    "position" | "finished" | "checkAnswers" | "runAnswers" | "move"
  >;
  agents: Pick<UnitAgents, "send">;
  progression: Pick<
    UnitProgression,
    "feedback" | "waitingInCheck" | "waitingInRun"
  >;
}

export interface UnitQuestions {
  board: QuestionBoard;
  /**
   * Aborts the math read, then the code check, of a question being posted,
   * as they are now; returns the code check's end, for the close to wait
   * for.
   */
  stop(): Promise<unknown> | undefined;
}

export function createUnitQuestions<U extends PostingUnit>({
  exclusive,
  running,
  stopCount,
  closing,
  folder,
  course,
  mathCheck,
  code,
  order,
  now,
  emit,
  unitId,
  unitFinished,
  where,
  checks,
  segmentObjectives,
  runOn,
  runWhere,
  nextOf,
  headOf,
}: {
  exclusive<T>(work: () => Promise<T>): Promise<T>;
  /** The unit once it is loaded. */
  running(): U | undefined;
  /** How many Stops the chat has had. */
  stopCount(): number;
  /** The chat is closing. */
  closing(): boolean;
  /** The course's workspace, once the unit's load has found it. */
  folder(): string | undefined;
  /** The course's workspace, whose queue admits a question. */
  course: {
    post<T>(
      attempt: { unitId: string; stopped(): boolean; retry(): void },
      work: () => Promise<T>,
    ): Promise<T | { refused: string }>;
  };
  mathCheck: MathCheck;
  code: CodeRunner;
  order: ChoiceOrder;
  now(): Date;
  emit(event: PageEvent): void;
  unitId: string;
  unitFinished: string;
  /** Where the unit given stands now, with the notes not yet given, which this takes. */
  where(r: U): Where;
  /** Where each objective of the segment stands in its check, if it is in one. */
  checks(r: U): ReadonlyMap<string, ObjectiveCheck>;
  segmentObjectives(r: U): readonly string[];
  /** The assessment under way, if one is. */
  runOn(r: U): AssessmentRun | undefined;
  runWhere(r: U, run: AssessmentRun): RunWhere;
  /** The objective the assessment asks next, if any is left. */
  nextOf(r: U, run: AssessmentRun): RunStep | undefined;
  /** The question's place in the assessment under way, if it is in one. */
  headOf(r: U, open: OpenQuestion): AssessmentHead | undefined;
}): UnitQuestions {
  let mathPosting: AbortController | undefined;
  let codePosting:
    | { stop: AbortController; done: Promise<unknown> }
    | undefined;

  const board = {
    post(question: QuestionInput) {
      const stops = stopCount();
      const stopped = () => closing() || stopCount() !== stops;
      return exclusive(
        async (): Promise<
          | { id: string; number: number; question: Question }
          | { refused: string }
        > => {
          const r = running();
          if (stopped()) return QUESTION_STOPPED;
          if (r === undefined) return { refused: "The unit is not open." };
          if (r.record.finished !== undefined && runOn(r) === undefined) {
            return { refused: unitFinished };
          }
          const { position } = r.record;
          const offered = position.assessment;
          if (offered?.stage === "offered") {
            return {
              refused:
                `A ${runName(offered.mode)} waits on its card for the learner to start or skip; ` +
                "no question is posted until they do. Reply to the learner without one.",
            };
          }
          const run = runOn(r);
          if (position.detour !== undefined) {
            const { number, objective } = position.detour;
            return {
              refused: inDetour(
                number,
                run === undefined
                  ? "Ready for another question"
                  : detourButton(runWhere(r, run), objective),
              ),
            };
          }
          const feedback = r.progression.feedback;
          if (feedback !== undefined) {
            const { number, started } = feedback;
            return {
              refused: started ? feedbackOnly(number) : feedbackPending(number),
            };
          }
          const test = position.testOut?.stage;
          if (run === undefined && (test === "result" || test === "due")) {
            return {
              refused:
                test === "result"
                  ? "The test is over, and its result card waits for the learner: no question is posted until they answer it. Reply to the learner without one."
                  : "The test has not started yet: no question is posted until it does. Reply to the learner without one.",
            };
          }
          if (run === undefined && position.phase !== "check") {
            return { refused: outOfPhase(position.phase) };
          }
          if (position.openQuestion !== undefined) {
            const { number, answer } = position.openQuestion;
            return {
              refused:
                answer === undefined
                  ? `Question ${number} is still open. End your turn and wait for the learner's answer.`
                  : `Question ${number} is answered and its answer is being graded. End your turn; the grade arrives in a message of its own.`,
            };
          }
          const asked =
            run === undefined
              ? checkAsks(r, question.objective)
              : runAsks(r, run, question.objective, question.kind);
          if ("refused" in asked) return asked;
          const posted = postedQuestion(question);
          const workspace = folder();
          if (workspace === undefined)
            return { refused: "The unit is not open." };
          if (posted.kind === "math" && posted.mathGrading === "symbolic") {
            // Only symbolic questions need an expected answer the check reads.
            const stop = new AbortController();
            mathPosting = stop;
            try {
              const unread = await mathCheck.read(posted.expected, stop.signal);
              if (stopped()) return QUESTION_STOPPED;
              if (unread !== undefined) return unread;
            } finally {
              mathPosting = undefined;
            }
          }
          const since = r.record.checkAnswers.length;
          const count = r.record.runAnswers.length;
          return course.post(
            {
              unitId,
              stopped,
              retry: () =>
                run === undefined
                  ? retryAfterInstall(r, position, since, stopped)
                  : retryRunAfterInstall(r, run, count, stopped),
            },
            async () => {
              let checked = posted;
              if (posted.kind === "code") {
                // Hold the course queue until both runs and their cleanup finish.
                const stop = new AbortController();
                const done = code.check(
                  posted,
                  workspace,
                  question.dependencies ?? [],
                  stop.signal,
                );
                codePosting = { stop, done };
                try {
                  const result = await done;
                  if (stopped()) return QUESTION_STOPPED;
                  if ("refused" in result) return result;
                  checked = result.question;
                } finally {
                  codePosting = undefined;
                }
              }
              const open: OpenQuestion = {
                id: randomUUID(),
                number: asked.number,
                objective: question.objective,
                postedAt: now().toISOString(),
                // Shown and stored in the engine's order (task 2.17).
                question:
                  checked.kind === "choice"
                    ? reorder(checked, order(checked.choices.length))
                    : checked,
              };
              await r.record.move({ ...position, openQuestion: open });
              emit({
                type: "question",
                question: view(open, workspace, headOf(r, open)),
              });
              return {
                id: open.id,
                number: open.number,
                question: open.question,
              };
            },
          );
        },
      );
    },
  };

  /**
   * Whether the check may ask about the objective now, and the number its
   * question gets, or why not.
   */
  function checkAsks(
    r: U,
    objective: string,
  ): { number: number } | { refused: string } {
    const objectives = segmentObjectives(r);
    if (!objectives.includes(objective)) {
      return {
        refused: `"${objective}" is not an objective of this segment. Name one of ${quoted(objectives)}.`,
      };
    }
    const standing = checks(r);
    const check = standing.get(objective);
    if (check?.state === "done") {
      const open = objectives.filter(
        (id) => standing.get(id)?.state !== "done",
      );
      return {
        refused:
          `"${objective}" needs no more questions in this check: ${checkText(check)}. ` +
          (open.length > 0
            ? `Ask about ${quoted(open)} instead.`
            : "Every objective is done, and the segment is closing: no more questions."),
      };
    }
    return { number: r.record.checkAnswers.length + 1 };
  }

  /**
   * Whether the assessment may ask about the objective now: only the one it
   * asks next. Its question is numbered by the objective's place in it.
   */
  function runAsks(
    r: U,
    run: AssessmentRun,
    objective: string,
    kind: QuestionInput["kind"],
  ): { number: number } | { refused: string } {
    const next = nextOf(r, run);
    const name = runName(run.mode);
    if (next === undefined) {
      return {
        refused: `Every objective of the ${name} has been asked, and it is ending: no more questions.`,
      };
    }
    if (next.objective !== objective) {
      return {
        refused: `The ${name} asks about "${next.objective}" now, and about no other objective: post the question on it.`,
      };
    }
    if (run.kinds !== undefined && !run.kinds.includes(kind)) {
      return {
        refused:
          `The learner picked only ${pickedKinds(run)} questions for this self-test, so a ${kind} question is refused. ` +
          `Ask "${next.objective}" with one of those kinds${next.second ? "." : "; if none fits it, call pass_over_objective on it with why."}`,
      };
    }
    // A test counts its questions, one or two on each objective; the others
    // number a question by its objective's place.
    return {
      number:
        run.mode === "test-out"
          ? r.record.runAnswers.length + 1
          : next.index + 1,
    };
  }

  /** Asks again for the assessment's question an install blocked. */
  function retryRunAfterInstall(
    r: U,
    run: AssessmentRun,
    count: number,
    stopped: () => boolean,
  ): void {
    const skip = () =>
      closing() ||
      stopped() ||
      !r.progression.waitingInRun(run, count) ||
      r.progression.feedback !== undefined;
    if (skip()) return;
    r.agents.send({ skip, text: () => workspaceReadyTurn(where(r)) });
  }

  /** Continues the same check after another unit's workspace install. */
  function retryAfterInstall(
    r: U,
    check: UnitPosition,
    number: number,
    stopped: () => boolean,
  ): void {
    const skip = () =>
      closing() ||
      stopped() ||
      !r.progression.waitingInCheck(number) ||
      r.record.position.segment !== check.segment ||
      r.record.position.checkFrom !== check.checkFrom ||
      r.record.position.detour !== undefined ||
      r.progression.feedback !== undefined;
    if (skip()) return;
    r.agents.send({ skip, text: () => workspaceReadyTurn(where(r)) });
  }

  return {
    board,
    stop() {
      mathPosting?.abort();
      const posting = codePosting;
      posting?.stop.abort();
      return posting?.done;
    },
  };
}

/**
 * The question as the page sees it: never its grading material. A code
 * question's files are named by their full paths in the workspace.
 */
export function view(
  open: OpenQuestion,
  workspace: string | undefined,
  head: AssessmentHead | undefined,
): QuestionView {
  const { id, number, question } = open;
  const base = {
    id,
    number,
    prompt: question.prompt,
    ...(head === undefined ? {} : { assessment: head }),
  };
  switch (question.kind) {
    case "choice":
      return { kind: "choice", ...base, choices: question.choices };
    case "code":
      return {
        kind: "code",
        ...base,
        files: question.files.map((path) => join(workspace ?? "", path)),
      };
    default:
      return { kind: question.kind, ...base };
  }
}

/** Why ask_question is refused in a detour (task 2.20), in its first turn or later. */
function inDetour(number: number, button: string): string {
  return (
    `A detour is open after the miss on question ${number}: no question ` +
    `may be posted until the learner presses "${button}". ` +
    "The learner sees only the text you write, never your thinking: work " +
    "through the confusion with them as text, suggest pressing it if they " +
    "seem ready, then end your reply."
  );
}

/** A learner's earlier message must not post a question before feedback. */
function feedbackPending(number: number): string {
  return (
    `The feedback on question ${number} is queued in a message of its own. ` +
    "Reply to the learner without posting a question, then end your reply " +
    "so that feedback can be sent."
  );
}

/** Why ask_question is refused during the feedback turn itself (task 2.16a). */
function feedbackOnly(number: number): string {
  return (
    `This reply is for your feedback on question ${number} only, and no ` +
    "tool may be called in it. The learner sees only the text you write, " +
    "never your thinking: write your feedback as text if you have not, " +
    "then end your reply. The app then asks you for the next question in " +
    "a message of its own, or closes the segment if the check is done."
  );
}

/** Why ask_question is refused outside the check, said so it can act on it. */
function outOfPhase(phase: Exclude<Phase, "check">): string {
  switch (phase) {
    case "teach":
      return (
        "The check has not started: the segment is in its teach phase. " +
        'Teach now; the learner moves to the check by pressing "ready" ' +
        "after the discussion."
      );
    case "discuss":
      return (
        'The check has not started: the learner has not pressed "ready". ' +
        'Answer their questions; you may suggest they press "ready" when ' +
        "they seem ready."
      );
    case "closed":
      return "The segment is closed, so its check is over. The learner starts the next segment.";
  }
}
