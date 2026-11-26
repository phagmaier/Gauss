// An assessment run (task 5.4), from its start to its end: review, the
// gate, the test before a unit, or a self-test. While it is offered or
// under way the unit's own steps and a teaching turn that waits hold. When
// a review or a self-test ends or is skipped the unit goes on where it was;
// when the gate ends or is skipped, the unit returns to its end
// (unit-end.ts). A self-test the learner sets up starts at once, with no
// card.
// The test before a unit (task 5.6): chosen on the course view for a unit
// not started, it opens the unit, planned as any is, and runs over all its
// objectives in place of the teaching turn, after a review that is due. It
// has no feedback and no detour. When it ends, or the learner stops it, the
// tutor says what it showed and a result card waits: skipping what passed
// starts the teaching at the first segment with an objective not passed,
// leaving out the passed ones, and with all passed finishes the unit with
// no gate; the other step teaches the whole unit.

// Made for each loaded unit. The chat keeps the queue and the actions'
// guards. `readAssessmentHandoffs` is exported on its own: the chat's
// opening reads it before the unit is loaded.

import type { Slug } from "../../shared/course.ts";
import type { PageEvent, TestShown } from "../../shared/events.ts";
import type { EvidenceEntry } from "../../shared/evidence.ts";
import { firstTaught } from "../../shared/plan.ts";
import type { AssessmentHead } from "../../shared/question.ts";
import type { PassOverInput } from "../../shared/self-test.ts";
import type { AssessmentRun, OpenQuestion } from "../../shared/state.ts";
import { hasPassed } from "../../shared/status.ts";
import { objectiveStatus } from "../record/status.ts";
import {
  nextInRun,
  type RunStep,
  runObjective,
  testShowed,
} from "./assessment-rules.ts";
import type { ChatResult } from "./conversation.ts";
import type { UnitAgents } from "./unit-agents.ts";
import { sameObjectives } from "./unit-end.ts";
import type { UnitProgression } from "./unit-progression.ts";
import {
  assessmentEvent,
  type SelfTestSetUp,
  type UnitRecord,
} from "./unit-record.ts";
import {
  type RunWhere,
  runName,
  runWaitsText,
  testEndTurn,
  type UnitContext,
  type Where,
} from "./unit-turns.ts";

export interface UnitAssessments {
  /** Starts the test that is due, in place of the teaching turn. Runs inside the chat's queue. */
  startTest(): Promise<void>;
  /** What the test before the unit showed on each objective, as it stands now. */
  shownByTest(): TestShown[];
  /** Shows the test's result card, as it stands now: again if one is shown. */
  showTestResult(): void;
  /**
   * Sends the turn that asks the tutor what the test showed, and shows the
   * result card once it ends, however it ends, while the result waits. The
   * word is given once the turn is sent and completes, or the learner stops
   * it; otherwise it stays owed.
   */
  sendTestSummary(text: () => string): void;
  /** A turn of its own that asks what the test showed is queued or running. */
  summaryQueued(): boolean;
  /** The assessment under way, if one is. */
  runOn(): AssessmentRun | undefined;
  /** Tells the page of the assessment: its card offered, or it began, or the chat opened with it. */
  showRun(run: AssessmentRun): void;
  /** Where the assessment stands, for the tutor's header. */
  runWhere(run: AssessmentRun): RunWhere;
  /** The question the assessment asks next; none once it has asked all it will. */
  nextOf(run: AssessmentRun): RunStep | undefined;
  /**
   * An assessment under way with nothing open, no detour and no feedback to
   * come, as a restart leaves one: it asks on, or ends if it has asked all.
   * Runs inside the chat's queue.
   */
  goOnInRun(): Promise<void>;
  /** Starts the assessment offered: the tutor is asked for its first question. Runs inside the chat's queue. */
  startRun(offered: AssessmentRun): Promise<void>;
  /**
   * Starts a self-test the learner set up, at once and with no card: the
   * tutor is asked for its first question. `log` is the course's evidence
   * as read now. Runs inside the chat's queue.
   */
  startSelfTest(
    setUp: SelfTestSetUp,
    log: readonly EvidenceEntry[],
  ): Promise<void>;
  /** Ends the assessment, every objective asked or skipped. Runs inside the chat's queue. */
  endRun(skipped: boolean): Promise<void>;
  /**
   * Why the unit's own steps wait while an assessment is offered or under
   * way, or the test's result card waits.
   */
  runWaits(): ChatResult | undefined;
  /**
   * The head of an open question of the assessment under way: its place,
   * whether it is the second on its objective, and the objective's unit
   * when it is another.
   */
  headOf(open: OpenQuestion): AssessmentHead | undefined;
  /** The body of the chat's startAssessment, inside its guard. */
  startAssessment(): Promise<ChatResult>;
  /** The body of the chat's skipAssessment, inside its guard. */
  skipAssessment(): Promise<ChatResult>;
  /** The body of pass_over_objective, inside the chat's queue. */
  passOver(
    passed: PassOverInput,
  ): Promise<{ next: string | undefined } | { refused: string }>;
  /** The body of the chat's skipTested, inside its guard. */
  skipTested(shown: readonly string[]): Promise<ChatResult>;
  /** The body of the chat's teachWhole, inside its guard. */
  teachWhole(): Promise<ChatResult>;
}

/** The other units' handoff notes for a run, read when it starts or resumes. */
export async function readAssessmentHandoffs(
  run: Pick<AssessmentRun, "mode" | "objectives">,
  unitId: Slug,
  readHandoff: (unit: string) => Promise<{ note: string } | undefined>,
): Promise<ReadonlyMap<string, string> | undefined> {
  if (run.mode === "test-out") return undefined;
  const sources = new Set<string>();
  for (const { unit } of run.objectives) {
    if (unit !== unitId) sources.add(unit);
  }
  if (sources.size === 0) return undefined;
  const notes = new Map<string, string>();
  await Promise.all(
    Array.from(sources, async (source) => {
      const handoff = await readHandoff(source);
      if (handoff !== undefined) notes.set(source, handoff.note);
    }),
  );
  return notes;
}

export function createUnitAssessments({
  record,
  agents,
  exclusive,
  emit,
  where,
  progression,
  stopCount,
  closing,
  end,
  sendTeaching,
  context,
  readHandoff,
  handoffs: read,
  unitId,
}: {
  record: Pick<
    UnitRecord,
    | "position"
    | "evidence"
    | "runAnswers"
    | "finished"
    | "reopened"
    | "startTest"
    | "startSelfTest"
    | "passOver"
    | "startAssessment"
    | "endAssessment"
    | "move"
    | "finish"
    | "testSummaryGiven"
  >;
  agents: Pick<UnitAgents, "send" | "canMoveOn" | "grading">;
  exclusive<T>(work: () => Promise<T>): Promise<T>;
  emit(event: PageEvent): void;
  where(): Where;
  progression: {
    askInRun: UnitProgression["askInRun"];
    afterReview(): Promise<void>;
    feedback(): UnitProgression["feedback"];
  };
  stopCount(): number;
  /** The chat is closing: a turn it interrupts was not the learner's Stop. */
  closing(): boolean;
  /** The unit end's `end`, with the statuses as they now are. */
  end(): Promise<void>;
  sendTeaching(cutOff: boolean): void;
  context(): Pick<UnitContext, "plan" | "units">;
  readHandoff(unit: string): Promise<{ note: string } | undefined>;
  /** The other units' handoff notes `load` read for a run already under way. */
  handoffs: ReadonlyMap<string, string> | undefined;
  unitId: Slug;
}): UnitAssessments {
  /** The other units' handoff notes, read when an assessment starts or resumes. */
  let handoffs = read;
  /** The turns of their own asking what the test showed, queued or running. */
  let summaries = 0;

  /** Starts the test that is due, in place of the teaching turn. Runs inside `exclusive`. */
  async function startTest(): Promise<void> {
    const stops = stopCount();
    await record.startTest((run) => showRun(run));
    progression.askInRun({ after: "start" }, stops);
  }

  /** What the test before the unit showed on each objective, as it stands now. */
  function shownByTest() {
    return testShowed(
      context().plan.objectives.map((o) => o.id),
      record.evidence,
      unitId,
    );
  }

  /** Shows the test's result card, as it stands now: again if one is shown. */
  function showTestResult(): void {
    emit({ type: "test_result", objectives: shownByTest() });
  }

  /** Whether the tutor's word on the test is owed, while its result waits. */
  function summaryOwed(): boolean {
    const { testOut } = record.position;
    return testOut?.stage === "result" && testOut.summaryOwed === true;
  }

  /** Shows the result card while it waits for the learner. */
  function showWaitingResult(): Promise<void> {
    return exclusive(async () => {
      if (record.position.testOut?.stage === "result") showTestResult();
    });
  }

  /**
   * Sends the turn that asks the tutor what the test showed, and shows the
   * result card once it ends, however it ends, while the result waits.
   */
  function sendTestSummary(text: () => string): void {
    summaries += 1;
    let sent = false;
    agents.send({
      // A message that reopening let in ahead of it may have given the
      // word already: then only the card is shown.
      skip: () => {
        if (summaryOwed()) return false;
        summaries -= 1;
        void showWaitingResult();
        return true;
      },
      text,
      sent: () => {
        sent = true;
      },
      // Before the page sees the turn end, as feedback is saved: a close
      // that cuts it off, however the backend ends it then, leaves the word
      // owed, and a Stop before it was sent too. A close that starts while
      // this waits for the queue did not cut it off.
      beforeEnd: (outcome) => {
        const given =
          sent &&
          !closing() &&
          (outcome === "done" || outcome === "interrupted");
        return exclusive(async () => {
          if (given) {
            await record.testSummaryGiven().catch((error: unknown) => {
              console.error(
                "The tutor's word on the test could not be saved:",
                error,
              );
            });
          }
          return outcome;
        });
      },
      ended: () => {
        summaries -= 1;
        return showWaitingResult();
      },
    });
  }

  /** The assessment under way, if one is. */
  function runOn(): AssessmentRun | undefined {
    const run = record.position.assessment;
    return run?.stage === "on" ? run : undefined;
  }

  /** Tells the page of the assessment: its card offered, or it began, or the chat opened with it. */
  function showRun(run: AssessmentRun): void {
    emit(assessmentEvent(run, unitId, context().units));
  }

  /** Where the assessment stands, for the tutor's header. */
  function runWhere(run: AssessmentRun): RunWhere {
    const { runAnswers, evidence } = record;
    const next = run.stage === "on" ? nextOf(run) : undefined;
    const sourceHandoff =
      next === undefined ? undefined : handoffs?.get(next.unit);
    return {
      run,
      standing: run.objectives.map(({ objective }) =>
        runObjective(objective, runAnswers, evidence, run),
      ),
      next,
      ...(sourceHandoff === undefined ? {} : { sourceHandoff }),
    };
  }

  /** The question the assessment asks next; none once it has asked all it will. */
  function nextOf(run: AssessmentRun): RunStep | undefined {
    return nextInRun(run, record.runAnswers, record.evidence);
  }

  /**
   * An assessment under way with nothing open, no detour and no feedback to
   * come, as a restart leaves one: it asks on, or ends if it has asked all.
   * Runs inside `exclusive`.
   */
  async function goOnInRun(): Promise<void> {
    const run = runOn();
    const { position } = record;
    if (
      run === undefined ||
      position.openQuestion !== undefined ||
      position.detour !== undefined ||
      progression.feedback() !== undefined
    ) {
      return;
    }
    if (nextOf(run) === undefined) await endRun(false);
    else progression.askInRun({ after: "reopened" });
  }

  /** Starts the assessment offered: the tutor is asked for its first question. Runs inside `exclusive`. */
  async function startRun(offered: AssessmentRun): Promise<void> {
    const stops = stopCount();
    handoffs = await readAssessmentHandoffs(offered, unitId, readHandoff);
    await record.startAssessment((run) => showRun(run));
    progression.askInRun({ after: "start" }, stops);
  }

  /** Starts a self-test the learner set up, at once and with no card. Runs inside `exclusive`. */
  async function startSelfTest(
    setUp: SelfTestSetUp,
    log: readonly EvidenceEntry[],
  ): Promise<void> {
    const stops = stopCount();
    handoffs = await readAssessmentHandoffs(
      { mode: "self-test", ...setUp },
      unitId,
      readHandoff,
    );
    await record.startSelfTest(setUp, log, (run) => showRun(run));
    progression.askInRun({ after: "start" }, stops);
  }

  /**
   * Ends the assessment: every objective asked, or skipped. The record keeps
   * the tutor's notice of it if it was asking. After the gate the unit comes
   * to its end; after a test, the tutor is asked what it showed, and its
   * result card follows; after a review or a self-test the unit goes on
   * where it stood: a test that waited starts, a teaching turn that waited
   * is sent, and a check takes up again. Runs inside `exclusive`.
   */
  async function endRun(skipped: boolean): Promise<void> {
    const { run, withdrawn } = await record.endAssessment(skipped);
    handoffs = undefined;
    if (run.mode === "test-out") {
      sendTestSummary(() =>
        testEndTurn(
          where(),
          skipped
            ? { stopped: true, withdrawn: withdrawn?.number }
            : { stopped: false },
        ),
      );
      return;
    }
    if (record.finished !== undefined) return;
    if (run.mode === "gate") {
      await end();
      return;
    }
    const { position } = record;
    if (position.testOut?.stage === "due") {
      await startTest();
    } else if (position.phase === "teach") {
      sendTeaching(record.reopened);
    } else {
      await progression.afterReview();
    }
  }

  /**
   * The body of pass_over_objective, inside the chat's queue: in a
   * self-test under way, with nothing open or owed, the objective it asks
   * next is kept as passed over, the page is told, and the self-test asks
   * its next objective, or ends. Answers the objective asked next, if any.
   */
  async function passOver(
    passed: PassOverInput,
  ): Promise<{ next: string | undefined } | { refused: string }> {
    const run = runOn();
    const { openQuestion, detour } = record.position;
    if (run?.mode !== "self-test") {
      return {
        refused:
          "pass_over_objective is only for a self-test under way. Do as the header allows.",
      };
    }
    if (openQuestion !== undefined) {
      const n = openQuestion.number;
      return {
        refused:
          openQuestion.answer !== undefined
            ? `Question ${n} is answered and its answer is being graded. End your turn; the grade arrives in a message of its own.`
            : `Question ${n} is open: nothing is passed over until the learner answers it. End your turn.`,
      };
    }
    if (detour !== undefined) {
      return {
        refused:
          "A detour is open: work through it with the learner. The self-test goes on once they end it.",
      };
    }
    if (progression.feedback() !== undefined) {
      return {
        refused:
          "Your feedback on the last answer comes first; the app asks for the next question in a message of its own.",
      };
    }
    const next = nextOf(run);
    if (next === undefined) {
      return {
        refused:
          "Every objective of the self-test has been asked, and it is ending: nothing is left to pass over.",
      };
    }
    if (next.objective !== passed.objective) {
      return {
        refused: `The self-test asks about "${next.objective}" now: pass over only that objective, or ask it.`,
      };
    }
    if (next.second) {
      return {
        refused: `"${next.objective}" was asked with a kind picked and missed: ask its fresh question with ask_question.`,
      };
    }
    const stops = stopCount();
    await record.passOver(passed, () =>
      emit({ type: "passed_over", ...passed }),
    );
    const now = runOn();
    const after = now === undefined ? undefined : nextOf(now);
    if (after === undefined) {
      await endRun(false);
    } else {
      progression.askInRun(
        { after: "passed-over", objective: passed.objective },
        stops,
      );
    }
    return { next: after?.objective };
  }

  /**
   * Why the unit's own steps wait while an assessment is offered or under
   * way, or the test's result card waits.
   */
  function runWaits(): ChatResult | undefined {
    const run = record.position.assessment;
    if (record.position.testOut?.stage === "result") {
      return refused("Answer the test's result card first.");
    }
    if (run === undefined) return undefined;
    return refused(runWaitsText(run));
  }

  /**
   * The head of an open question of the assessment under way: its place,
   * whether it is the second on its objective, and the objective's unit
   * when it is another.
   */
  function headOf(open: OpenQuestion): AssessmentHead | undefined {
    const run = runOn();
    if (run === undefined) return undefined;
    const second = record.runAnswers.some(
      (a) => a.objective === open.objective && a.answer.questionId !== open.id,
    );
    const place = run.objectives.findIndex(
      (o) => o.objective === open.objective,
    );
    const unit = run.objectives[place]?.unit;
    const at = context().units.findIndex((u) => u.id === unit);
    const other = context().units[at];
    return {
      of: run.objectives.length,
      // A test's questions are counted, so its head names the objective.
      ...(run.mode === "test-out" ? { objective: place + 1 } : {}),
      ...(second ? { second: true as const } : {}),
      ...(unit === unitId || other === undefined
        ? {}
        : { from: { number: at + 1, title: other.title } }),
    };
  }

  /** Why the test's result card cannot be answered now, if it cannot. */
  function answersResult(): ChatResult | undefined {
    if (record.position.testOut?.stage === "result") return undefined;
    return refused("No test result waits for an answer.");
  }

  /** The plan's objectives passed now, in its order. */
  function passedNow(): string[] {
    return context()
      .plan.objectives.map((o) => o.id)
      .filter((id) => hasPassed(objectiveStatus(record.evidence, id)));
  }

  async function startAssessment(): Promise<ChatResult> {
    const offered = record.position.assessment;
    if (offered?.stage !== "offered") {
      return refused(
        offered === undefined
          ? "Nothing is offered to start."
          : `The ${runName(offered.mode)} has started already.`,
      );
    }
    await startRun(offered);
    return { ok: true };
  }

  async function skipAssessment(): Promise<ChatResult> {
    const { assessment, openQuestion } = record.position;
    if (assessment === undefined) {
      return refused("Nothing is offered or under way to skip.");
    }
    // As with moving on, only a failure lets a kept answer be withdrawn.
    if (
      openQuestion?.answer !== undefined &&
      !agents.canMoveOn(openQuestion.id)
    ) {
      return refused(
        openQuestion.judging !== undefined || agents.grading()
          ? "An answer is being graded. Wait for its grade, then skip."
          : "An answer is kept and waits to be graded again. Grade it again, then skip.",
      );
    }
    await endRun(true);
    return { ok: true };
  }

  async function skipTested(shown: readonly string[]): Promise<ChatResult> {
    const waits = answersResult();
    if (waits !== undefined) return waits;
    const { plan } = context();
    const passed = passedNow();
    if (!sameObjectives(passed, shown)) {
      return refused(
        "The test result changed. Review the card and choose again.",
      );
    }
    if (passed.length === 0) {
      return refused(
        "The test passed nothing to skip: the unit is taught from its first segment.",
      );
    }
    const first = firstTaught(plan, passed);
    const tell = () => emit({ type: "test_answered", skipped: passed });
    if (first === undefined) {
      // Every objective passed: the unit is finished, with no gate.
      await record.finish("passed", { tell, testedOut: true });
      return { ok: true };
    }
    await record.move(
      {
        segment: first,
        phase: "teach",
        testOut: { stage: "skip", passed },
      },
      tell,
      { kind: "test-answered", skip: true, passed },
    );
    sendTeaching(false);
    return { ok: true };
  }

  async function teachWhole(): Promise<ChatResult> {
    const waits = answersResult();
    if (waits !== undefined) return waits;
    const passed = passedNow();
    await record.move(
      { segment: 0, phase: "teach" },
      () => emit({ type: "test_answered", skipped: [] }),
      { kind: "test-answered", skip: false, passed },
    );
    sendTeaching(false);
    return { ok: true };
  }

  return {
    startTest,
    shownByTest,
    showTestResult,
    sendTestSummary,
    summaryQueued: () => summaries > 0,
    runOn,
    showRun,
    runWhere,
    nextOf,
    goOnInRun,
    startRun,
    startSelfTest,
    passOver,
    endRun,
    runWaits,
    headOf,
    startAssessment,
    skipAssessment,
    skipTested,
    teachWhole,
  };
}

function refused(error: string): ChatResult {
  return { ok: false, status: 409, error };
}
