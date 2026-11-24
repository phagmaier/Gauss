// Answers: grading and help. A choice is graded at once; a written answer
// is kept in state.json and graded by the grader (grading.ts), outside the
// chat's queue, and if the grading fails it can be graded again. A math
// question's answer is kept and graded the same way, by the symbolic check
// (math-check.ts, task 3.5), or by the grader when the check does not
// settle it. A code question names files in the workspace that the learner
// edits (task 3.7); its answer, the learner's files as they are when "Run
// the tests" is pressed, is kept and graded the same way, by running the
// tests on them (code-run.ts). A message the tutor receives while a
// question waits for its answer has the tutor's reply judged, once it ends,
// by the help judge (help-judge.ts, task 2.21): clarification leaves the
// answer counting, help, or a call that fails, makes it given with help. An
// answer sent before the judge's calls are in is kept and waits for them.
// Made for each loaded unit. The unit chat keeps the Stop count, whether it
// is closing, and the workspace's folder, read at each call; `say`'s
// admission and the actions' guards; and the progression, which takes a
// recorded answer.

import { join } from "node:path";
import type { Slug } from "../../shared/course.ts";
import type { PageEvent } from "../../shared/events.ts";
import type { AnswerEvidence } from "../../shared/evidence.ts";
import {
  type AnswerPost,
  type AnswerSubmission,
  CHOICE_LETTERS,
  type CodeFile,
  type GradedAnswer,
} from "../../shared/question.ts";
import type { AssessmentRun, OpenQuestion } from "../../shared/state.ts";
import {
  type CodeRunner,
  fileProblem,
  gradeCode,
  readWorkspaceFiles,
} from "./code-run.ts";
import type { ChatResult, Turn, TurnOutcome } from "./conversation.ts";
import { type Grader, gradeChoice, gradeMath } from "./grading.ts";
import type { HelpOutcome } from "./help-judge.ts";
import type { MathCheck } from "./math-check.ts";
import type { Grade, Grading, UnitAgents } from "./unit-agents.ts";
import type { UnitProgression } from "./unit-progression.ts";
import type { UnitRecord } from "./unit-record.ts";
import { messageTurn, type Where } from "./unit-turns.ts";

export interface UnitAnswers {
  /**
   * Grades an answer to the open question once no reply during it waits
   * for the judge. Runs inside `exclusive`.
   */
  grade(
    open: OpenQuestion,
    answer: AnswerSubmission,
    stops?: number,
  ): Promise<void>;
  /**
   * Takes these replies out of those the open question waits on, with
   * their verdict, and grades the answer kept for them once none is left.
   * Runs inside `exclusive`.
   */
  settleJudging(
    open: OpenQuestion,
    learnerIds: readonly string[],
    verdict: "clarification" | "help",
    tell?: () => void,
  ): Promise<void>;
  /**
   * The turn's text and end for the learner's message `id`: the exchange
   * that has the tutor's reply judged, if a question waits for its answer
   * when the tutor receives it. One per message.
   */
  message(id: string, text: string): Required<Pick<Turn, "text" | "ended">>;
  /** The body of the chat's `answer`, inside its guard. */
  answer(sent: AnswerPost): Promise<ChatResult>;
  /** The body of the chat's `gradeAgain`, inside its guard. */
  gradeAgain(): Promise<ChatResult>;
  /**
   * An answer kept for the judge has set the Stop count it was sent at,
   * and no grade has taken it since.
   */
  answerAwaitingJudge(): boolean;
}

export function createUnitAnswers({
  record,
  agents,
  exclusive,
  emit,
  grader,
  mathCheck,
  code,
  folder,
  closing,
  stopCount,
  unitId,
  where,
  runOn,
  progression,
  tell,
}: {
  record: Pick<UnitRecord, "position" | "finished" | "move" | "answer">;
  agents: Pick<UnitAgents, "grade" | "judge" | "grading">;
  exclusive<T>(work: () => Promise<T>): Promise<T>;
  emit(event: PageEvent): void;
  grader: Grader;
  mathCheck: MathCheck;
  code: CodeRunner;
  /** The course's workspace, once the unit's load has found it. */
  folder(): string | undefined;
  /** The chat is closing. */
  closing(): boolean;
  /** How many Stops the chat has had. */
  stopCount(): number;
  unitId: Slug;
  /** Where the unit stands now, with the notes not yet given, which this takes. */
  where(): Where;
  /** The assessment under way, if one is. */
  runOn(): AssessmentRun | undefined;
  /** The progression, whose `answered` takes a recorded answer. */
  progression: Pick<UnitProgression, "answered">;
  /** Tells the chat of another unit, if it is open, an answer on its objective. */
  tell(unitId: Slug, entry: AnswerEvidence): void;
}): UnitAnswers {
  /** The code questions whose kept answer's tests have run past their limit once; in memory only. */
  const timedOut = new Set<string>();
  /**
   * How many Stops there had been when the answer kept for the judging was
   * sent, so a Stop after it cancels the automatic next question as it does
   * for an answer recorded at once (task 2.17a).
   */
  let answerStops: number | undefined;

  /**
   * Records the graded answer to the open question, closes the question, and
   * sends the grade to the tutor. Runs inside `exclusive`.
   */
  async function recordAnswer(
    submission: AnswerSubmission,
    grade: Grade,
    stops?: number,
  ): Promise<void> {
    const answered = await record.answer(submission, grade);
    // Another unit's chat, open with its own record, learns the answer.
    const owner = runOn()?.objectives.find(
      (o) => o.objective === answered.entry.objective,
    )?.unit;
    if (owner !== undefined && owner !== unitId) {
      tell(owner, answered.entry);
    }
    await progression.answered(answered, stops);
  }

  /**
   * Grades an answer to the open question once no reply during it waits
   * for the judge: a written, math or code one outside the queue, kept in
   * state.json first, and any other at once. Runs inside `exclusive`.
   */
  async function grade(
    open: OpenQuestion,
    answer: AnswerSubmission,
    stops?: number,
  ): Promise<void> {
    const { question } = open;
    if (
      answer.kind === "written" ||
      answer.kind === "math" ||
      answer.kind === "code"
    ) {
      // Kept before it is graded, so a restart does not lose it.
      const kept: OpenQuestion = { ...open, answer };
      if (open.answer === undefined) {
        await record.move({ ...record.position, openQuestion: kept });
      }
      startGrading(kept, answer, stops);
      return;
    }
    await recordAnswer(
      answer,
      {
        verdict:
          question.kind === "choice"
            ? gradeChoice(question.answer, answer)
            : "unknown",
      },
      stops,
    );
  }

  /**
   * The learner's files of a code question as they are now, read from the
   * workspace, or why the tests cannot be run on them.
   */
  async function readFiles(
    paths: readonly string[],
  ): Promise<CodeFile[] | string> {
    // Read once: only the unit's load sets it, and it never loads again
    // once it is running, which an answer needs.
    const workspace = folder();
    if (workspace === undefined) return "The unit is not open.";
    try {
      const read = await readWorkspaceFiles(workspace, paths);
      if ("files" in read) return read.files;
      return (
        `${fileProblem(read)} Nothing was run or recorded: put it right ` +
        `at ${join(workspace, read.path)} and run the tests again, or answer "I don't know".`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return `Your files could not be read: ${message}`;
    }
  }

  // --- Help (task 2.21) ------------------------------------------------------

  /**
   * The tutor's reply to the learner's message `learnerId`, received while
   * the question `questionId` was open, has ended: it is judged, unless the
   * question has been withdrawn since. A reply with no text gave the learner
   * nothing, so it is not judged and is no help. Runs inside `exclusive`.
   */
  async function replyEnded(
    exchange: { learnerId: string; questionId: string; message: string },
    reply: string,
  ): Promise<void> {
    if (closing()) return;
    const { learnerId, questionId, message } = exchange;
    const open = record.position.openQuestion;
    if (open?.id !== questionId || !open.judging?.includes(learnerId)) return;
    if (reply.trim() === "") {
      await settleJudging(open, [learnerId], "clarification");
      return;
    }
    const { number, question } = open;
    agents.judge({
      learnerId,
      number,
      question,
      message,
      reply,
      record: (outcome) => judged(questionId, learnerId, number, outcome),
    });
  }

  /**
   * Records the judge's call on a reply, and tells the page. A failed call
   * counts as help. A question withdrawn since keeps nothing of it. Runs
   * inside `exclusive`.
   */
  async function judged(
    questionId: string,
    learnerId: string,
    number: number,
    outcome: HelpOutcome,
  ): Promise<void> {
    if (!outcome.ok) {
      console.error(
        "A reply could not be judged, so it counts as help:",
        outcome.error,
      );
    }
    const verdict = outcome.ok ? outcome.verdict : "help";
    const tell = () =>
      emit({
        type: "judged",
        learnerId,
        number,
        verdict,
        ...(outcome.ok ? {} : { unjudged: "failed" as const }),
      });
    const open = record.position.openQuestion;
    if (open?.id !== questionId || !open.judging?.includes(learnerId)) {
      tell();
      return;
    }
    await settleJudging(open, [learnerId], verdict, tell);
  }

  /**
   * Takes these replies out of those the open question waits on, with
   * their verdict, and once none is left grades the answer kept for them.
   * Runs inside `exclusive`.
   */
  async function settleJudging(
    open: OpenQuestion,
    learnerIds: readonly string[],
    verdict: "clarification" | "help",
    tell?: () => void,
  ): Promise<void> {
    const judging = (open.judging ?? []).filter(
      (id) => !learnerIds.includes(id),
    );
    const { judging: _, ...rest } = open;
    const next: OpenQuestion = {
      ...rest,
      ...(verdict === "help" ? { assisted: true } : {}),
      ...(judging.length > 0 ? { judging } : {}),
    };
    await record.move({ ...record.position, openQuestion: next }, tell);
    if (judging.length === 0 && next.answer !== undefined) {
      const stops = answerStops;
      answerStops = undefined;
      await grade(next, next.answer, stops);
    }
  }

  /**
   * Grades the open question's kept written, math or code answer. The
   * grading runs outside `exclusive`, so the chat goes on while it works;
   * its grade is recorded inside, if the question is still open.
   */
  function startGrading(
    open: OpenQuestion,
    answer: GradedAnswer,
    stops?: number,
  ): void {
    const { question } = open;
    let run: Grading["run"];
    if (answer.kind === "written" && question.kind === "written") {
      run = (signal) => grader.grade(question, answer.text, signal);
    } else if (answer.kind === "math" && question.kind === "math") {
      run = (signal) =>
        gradeMath(question, answer, { check: mathCheck, grader }, signal);
    } else if (answer.kind === "code" && question.kind === "code") {
      const workspace = folder();
      if (workspace === undefined) throw new Error("The unit is not open.");
      run = async (signal) => {
        const graded = await gradeCode(
          code,
          question,
          answer,
          workspace,
          signal,
        );
        if (graded.ok) return graded;
        if (graded.timedOut === undefined) {
          return { ok: false, error: graded.error, canMoveOn: true };
        }
        // Past the limit a second time on the same files: the code, not a
        // slow moment, kept the tests from ending, so it is a miss.
        if (timedOut.has(open.id)) {
          return {
            ok: true,
            verdict: "incorrect",
            output: graded.timedOut.output,
          };
        }
        timedOut.add(open.id);
        return {
          ok: false,
          error: `${graded.error} Run them again; if they run past it again, the answer is graded as a miss.`,
        };
      };
    } else {
      // The answer's kind is its question's: `answer` and the schema check it.
      throw new Error("The answer is not of its question's kind.");
    }
    agents.grade({
      questionId: open.id,
      answer,
      run,
      applies: () =>
        record.position.openQuestion?.id === open.id &&
        (record.finished === undefined || runOn() !== undefined),
      record: (grade: Grade) => recordAnswer(answer, grade, stops),
    });
  }

  function message(id: string, text: string) {
    /** Set if the tutor received the message while a question waited for its answer. */
    let exchange:
      | { learnerId: string; questionId: string; message: string }
      | undefined;
    return {
      // Help is judged on what the tutor received while a question was
      // open (task 2.21), so the exchange begins when the message is sent
      // to the tutor, not when the learner wrote it, and is kept in
      // state.json until the judge's call on the reply. Once an answer is
      // sent, it is final, and help no longer applies.
      text: () =>
        exclusive(async () => {
          const { position } = record;
          const open = position.openQuestion;
          if (open !== undefined && open.answer === undefined) {
            await record.move({
              ...position,
              openQuestion: {
                ...open,
                judging: [...(open.judging ?? []), id],
              },
            });
            exchange = {
              learnerId: id,
              questionId: open.id,
              message: text,
            };
          }
          return messageTurn(where(), text);
        }),
      ended: (_: TurnOutcome, reply: string) => {
        const asked = exchange;
        if (asked === undefined) return;
        return exclusive(() => replyEnded(asked, reply));
      },
    };
  }

  async function answer(sent: AnswerPost): Promise<ChatResult> {
    const open = record.position.openQuestion;
    if (open === undefined) return refused("No question is open.");
    if (sent.questionId !== open.id) {
      return refused(`That question is not open; question ${open.number} is.`);
    }
    if (open.answer !== undefined) {
      return refused(
        open.judging !== undefined
          ? WAITS_FOR_JUDGE
          : agents.grading()
            ? "Your answer to this question is being graded."
            : "Your answer to this question is kept and waits to be graded again.",
      );
    }
    const { question } = open;
    if (sent.kind !== "unknown" && sent.kind !== question.kind) {
      return {
        ok: false,
        status: 400,
        error:
          question.kind === "choice"
            ? `Question ${open.number} is answered with one of its choices.`
            : question.kind === "math"
              ? `Question ${open.number} is answered with an expression.`
              : question.kind === "code"
                ? `Question ${open.number} is answered by running the tests on your files.`
                : `Question ${open.number} is answered in writing.`,
      };
    }
    let submission: AnswerSubmission;
    if (sent.kind !== "code") {
      submission = sent;
    } else {
      if (question.kind !== "code")
        throw new Error("Expected a code question.");
      const unavailable =
        code.unavailable ??
        (question.inputs === undefined
          ? "This question predates saved exercise inputs."
          : undefined);
      if (unavailable !== undefined) {
        return refused(
          `${unavailable} Nothing was run or recorded. Move on without the check.`,
        );
      }
      // The files as they are now are the answer, final once sent.
      const read = await readFiles(question.files);
      if (typeof read === "string") return refused(read);
      submission = { ...sent, files: read };
    }
    if (
      submission.kind === "choice" &&
      question.kind === "choice" &&
      CHOICE_LETTERS.indexOf(submission.choice) >= question.choices.length
    ) {
      return {
        ok: false,
        status: 400,
        error: `Question ${open.number} has no choice ${submission.choice}.`,
      };
    }
    if (open.judging !== undefined) {
      // Replies during the question still wait for the judge, whose
      // calls say whether the answer had help (task 2.21): the answer
      // waits for them, kept so a restart does not lose it.
      answerStops = stopCount();
      await record.move(
        {
          ...record.position,
          openQuestion: { ...open, answer: submission },
        },
        () =>
          emit({
            type: "answer_waiting",
            questionId: open.id,
            answer: submission,
          }),
      );
      return { ok: true };
    }
    await grade(open, submission);
    return { ok: true };
  }

  async function gradeAgain(): Promise<ChatResult> {
    const open = record.position.openQuestion;
    const kept = open?.answer;
    if (
      open === undefined ||
      (kept?.kind !== "written" &&
        kept?.kind !== "math" &&
        kept?.kind !== "code")
    ) {
      return refused("No answer is waiting to be graded again.");
    }
    if (open.judging !== undefined) return refused(WAITS_FOR_JUDGE);
    if (agents.grading()) {
      return refused("The answer is being graded.");
    }
    startGrading(open, kept);
    return { ok: true };
  }

  return {
    grade,
    settleJudging,
    message,
    answer,
    gradeAgain,
    answerAwaitingJudge: () => answerStops !== undefined,
  };
}

/** An answer kept while the tutor's replies during its question are judged (task 2.21). */
const WAITS_FOR_JUDGE =
  "Your answer to this question is kept, and is graded once the tutor's replies while it was open have been judged.";

function refused(error: string): ChatResult {
  return { ok: false, status: 409, error };
}
