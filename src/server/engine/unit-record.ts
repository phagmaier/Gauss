// One unit's part of the course record, kept in memory by its unit chat
// (unit-chat.ts; split out in task 2.8b): the unit's position, as state.json
// has it, and the evidence on its objectives. Every change is written before
// it is kept and the page hears of it. An answer
// is appended to the evidence before its question is closed, and a question
// has one answer: one the evidence already holds is the one kept (task 2.8a).
//
// A miss opens a detour (task 2.20) in the same write that closes its
// question, so a restart never finds the question closed and no detour.
//
// The position also keeps the id of the unit's tutor session, so a unit
// reopened after a restart resumes it (task 2.14). The notices waiting for
// the tutor's next header are kept the same way, from the write that makes
// them due until a turn carrying them is sent. A finished unit keeps both
// in its finished position, which goes once neither is left.
//
// Once a segment's close or the unit's end is written, the backup is asked
// for a commit (task 2.25), and the handoff writer for a note (task 5.7).
//
// An assessment (task 5.4) is kept in the position too, from when its card is
// offered until it ends or is skipped; while it is under way, an answer is
// recorded with its mode and this unit, and the position's open question and
// detour are its own. It can ask about another unit's objectives, so the
// evidence kept here is on the plan's objectives, those of the assessment,
// and those of every answer given in this unit's thread. Once the unit's
// gate (task 5.5) is offered, the position says so until the unit
// finishes, since it is offered once. A unit opened for its test (task 5.6)
// starts with the test due; a miss in the test opens no detour, and once it
// ends the position keeps its result waiting, then what the learner chose
// to skip, until the unit finishes.
//
// A dispute of one of the unit's answers (task 3.8) is written here when the
// unit's chat is open, so it lands in order with the chat's own writes; one
// written elsewhere while the chat was not open is learned when it opens.
// Either way the page is told, with the statuses the outcome gives. In a
// finished unit, a dispute that takes a pass away records the objective as
// overridden with it, so the unit stays finished.
//
// The chat decides which changes the phase rules allow; this module carries
// them out. Its changes are not safe to run concurrently: the chat makes them
// only from inside its queue. Reading is safe at any time.

import { randomUUID } from "node:crypto";
import type { Slug } from "../../shared/course.ts";
import type { StoredUnit } from "../../shared/curriculum.ts";
import type {
  CurriculumChange,
  CurriculumDecision,
} from "../../shared/curriculum-change.ts";
import type { PageEvent } from "../../shared/events.ts";
import type {
  AnswerEvidence,
  DisputeEvidence,
  EvidenceEntry,
  OverrideEvidence,
} from "../../shared/evidence.ts";
import type {
  PackageCompletion,
  PackageRequest,
} from "../../shared/packages.ts";
import type { Plan } from "../../shared/plan.ts";
import type {
  AnswerSubmission,
  QuestionKind,
  Unsettled,
  Verdict,
} from "../../shared/question.ts";
import {
  type AssessedObjective,
  type AssessmentRun,
  type Detour,
  isBeforeTest,
  type OpenQuestion,
  type PassedOver,
  type TutorNotice,
  type UnitPosition,
} from "../../shared/state.ts";
import type { ObjectiveStatus } from "../../shared/status.ts";
import type { StyleDecision, StyleProposal } from "../../shared/style.ts";
import { type Backup, noBackup } from "../record/backup.ts";
import type { DataRoot } from "../record/data-root.ts";
import { disputesIn } from "../record/disputes.ts";
import { objectiveStatus, takesPass, unitStatus } from "../record/status.ts";
import { answeredInRun, answersInRun } from "./assessment-rules.ts";
import { segmentOf } from "./check-rules.ts";
import {
  checkpointAfterAssessment,
  consumesAnswerCheckpoint,
  feedbackCheckpoint,
} from "./unit-progression.ts";

/** A notice as the chat gives it, before the record names it. */
export type NewNotice = TutorNotice extends infer N
  ? N extends TutorNotice
    ? Omit<N, "id">
    : never
  : never;

/** A question closed with its answer, as the tutor is to be told it. */
export interface Answered {
  number: number;
  entry: AnswerEvidence;
}

/** A self-test as the learner set it up: its objectives, in the order asked, and the kinds of question picked. */
export interface SelfTestSetUp {
  objectives: AssessedObjective[];
  kinds: QuestionKind[];
}

export interface UnitRecord {
  /**
   * Where the unit stands, with its tutor session's id once one is kept;
   * a finished unit's is its closed position, unless it holds an assessment.
   */
  readonly position: UnitPosition;
  /**
   * The evidence on the unit's objectives, in log order, and on those of its
   * assessment and of every answer given in its thread.
   */
  readonly evidence: readonly EvidenceEntry[];
  /** The answers to the segment's objectives in this check, in order. */
  readonly checkAnswers: readonly AnswerEvidence[];
  /** The answers given in the assessment under way, in order; none without one. */
  readonly runAnswers: readonly AnswerEvidence[];
  /** Completed package cards, kept even after the unit's position is removed. */
  readonly packageCompletions: readonly PackageCompletion[];
  /** The learner's style decisions not yet delivered to the tutor. */
  readonly pendingStyleDecisions: readonly StyleDecision[];
  /** The learner's curriculum decisions not yet delivered to the tutor. */
  readonly pendingCurriculumDecisions: readonly CurriculumDecision[];
  /** The notices waiting for the tutor's next header, in order. */
  readonly tutorNotices: readonly TutorNotice[];
  /** Set once the unit is finished and out of the units in progress. */
  readonly finished: "passed" | "overridden" | undefined;
  /** The learner skipped every segment and finished at the test's result. */
  readonly testedOut: boolean;
  /**
   * A position was read from state.json: in progress, or a finished unit's,
   * held for a review or a self-test or for its tutor's session.
   */
  readonly reopened: boolean;
  /** The unit's status and each objective's, as `unit_status` tells the page. */
  status(): PageEvent;
  /** The answer the evidence has to the question, if it has one. */
  recordedAnswer(questionId: string): AnswerEvidence | undefined;
  /** The dispute of the answer to the question, if it has one. */
  disputeOf(questionId: string): DisputeEvidence | undefined;
  /**
   * Records the dispute of one of the unit's answers, with an override of
   * its objective if the unit is finished and the dispute takes its pass,
   * and tells the page. Throws DisputeRefused if the record refuses it.
   * Resolves to the override written with it, if there is one. A `notice`
   * for the tutor is kept before the page is told, as `keepNotice` keeps
   * one, so a thread that shows the outcome after a restart has it too.
   */
  dispute(
    entry: DisputeEvidence,
    notice?: NewNotice,
  ): Promise<OverrideEvidence | undefined>;
  /**
   * Keeps a dispute written to the record without this unit, with the
   * override written with it, and tells the page, after keeping `notice`
   * as `dispute` does; nothing if it is kept already. False if it was.
   */
  learnDispute(
    entry: DisputeEvidence,
    override?: OverrideEvidence,
    notice?: NewNotice,
  ): Promise<boolean>;
  /**
   * Keeps an answer on one of the unit's objectives that another unit's
   * assessment recorded, and tells the page its status; nothing if it is
   * kept already. False if it was.
   */
  learnAnswer(entry: AnswerEvidence): boolean;
  objectiveStatuses(): Record<string, ObjectiveStatus>;
  /**
   * Writes the position to state.json, with the tutor session's id kept, then
   * keeps it and tells the page: first what `tell` emits, if anything, then
   * the phase if it changed. A `notice` is written with it, and kept only
   * once the write lands.
   */
  move(
    position: UnitPosition,
    tell?: () => void,
    notice?: NewNotice,
  ): Promise<void>;
  /**
   * Writes the id of the unit's tutor session into its position, with the
   * names of the tools it began with if the backend keeps them, or takes
   * them out, so the next start of the unit makes a new session.
   */
  keepSession(id: string | undefined, tools?: readonly string[]): Promise<void>;
  /**
   * Writes the tutor's request to install packages into the position. It is
   * kept across moves, as the session's id is.
   */
  keepPackageRequest(request: PackageRequest, tell: () => void): Promise<void>;
  /**
   * Saves and shows the completion, removing the matching pending request.
   * A unit in progress keeps a notice of it for the tutor in the same write.
   */
  completePackageRequest(completion: PackageCompletion): Promise<boolean>;
  /**
   * Writes the tutor's proposed style note into the position. It is kept
   * across moves, as a package request is.
   */
  keepStyleProposal(proposal: StyleProposal, tell: () => void): Promise<void>;
  /** Commits the learner's decision and takes the matching proposal out of the position. */
  answerStyleProposal(decision: StyleDecision): Promise<StyleDecision>;
  /**
   * Writes the tutor's proposed curriculum change into the position. It is
   * kept across moves, as a style proposal is.
   */
  keepCurriculumChange(
    change: CurriculumChange,
    tell: () => void,
  ): Promise<void>;
  /**
   * Commits the learner's decision, with an applied one curriculum.json, and
   * takes the matching change out of the position. Resolves to the decision
   * recorded: "applied" if an Apply a restart cut short already wrote it.
   * Throws CurriculumChangeRefused if the change can no longer be applied.
   */
  answerCurriculumChange(
    decision: CurriculumDecision,
  ): Promise<CurriculumDecision>;
  /**
   * Keeps a notice for the tutor's next header, written with `next`, as
   * `move` writes it, or with the position as it stands. It is kept in
   * memory even if the write fails, and the next write saves it.
   */
  keepNotice(notice: NewNotice, next?: UnitPosition): Promise<void>;
  /**
   * Takes out the notices a header carried to the tutor, or that no longer
   * apply. Taken out of memory even if the write fails, and the next write
   * takes them out of state.json.
   */
  deliverNotices(ids: readonly string[]): Promise<void>;
  /**
   * Takes out of the test's waiting result that the tutor's word on it is
   * owed; nothing if it is not.
   */
  testSummaryGiven(): Promise<void>;
  /** Marks only the decisions that were in a completed turn's header. */
  deliverDecisions(sent: {
    style: readonly StyleDecision[];
    curriculum: readonly CurriculumDecision[];
  }): Promise<void>;
  /** Starts the segment's check: this check is the evidence from here on. */
  startCheck(): Promise<void>;
  /**
   * Offers the assessment on its card: it is kept in the position, a gate
   * with the mark that it was offered, and the evidence on its objectives
   * is taken from `log`, the course's evidence as read now. `tell` tells the
   * page, once it is written.
   */
  offerAssessment(
    run: AssessmentRun,
    log: readonly EvidenceEntry[],
    tell: () => void,
  ): Promise<void>;
  /**
   * Starts the assessment offered: its answers are the evidence from here
   * on. `tell` tells the page, once it is written.
   */
  startAssessment(tell: (run: AssessmentRun) => void): Promise<AssessmentRun>;
  /**
   * Starts the test that is due, over every objective of the plan, under
   * way at once: its answers are the evidence from here on. `tell` tells the
   * page, once it is written.
   */
  startTest(tell: (run: AssessmentRun) => void): Promise<AssessmentRun>;
  /**
   * Starts a self-test the learner set up, under way at once with no card:
   * its answers are the evidence from here on, `log` being the course's
   * evidence as read now, from which the evidence on its objectives is
   * taken. `tell` tells the page, once it is written.
   */
  startSelfTest(
    setUp: SelfTestSetUp,
    log: readonly EvidenceEntry[],
    tell: (run: AssessmentRun) => void,
  ): Promise<AssessmentRun>;
  /**
   * Keeps the objective as passed over in the self-test under way, with the
   * tutor's reason; nothing goes in the evidence. `tell` tells the page,
   * once it is written.
   */
  passOver(passed: PassedOver, tell: () => void): Promise<void>;
  /**
   * Ends the assessment, every objective asked, or skipped: takes it out of
   * the position with its detour, withdraws its open question with nothing
   * recorded, and tells the page what it did to the record. The statuses
   * come from the evidence read again: other units' chats write on its
   * objectives too, while its card waits and while it runs. A test's
   * result then waits in the position, with whether the learner stopped
   * it; any other run that was under way leaves a notice of how it ended
   * for the tutor, in the same write.
   */
  endAssessment(skipped: boolean): Promise<{
    run: AssessmentRun;
    withdrawn: OpenQuestion | undefined;
    /** The objectives it recorded an answer on, in its order, with their statuses now. */
    statuses: Record<string, ObjectiveStatus>;
  }>;
  /**
   * Records the graded answer to the open question, closes the question,
   * and tells the page; a miss opens a detour as the question closes. If
   * the evidence has an answer to it already, because writing state.json
   * failed after it, that one is kept and this answer and grade are
   * dropped.
   */
  answer(
    submission: AnswerSubmission,
    grade: {
      verdict: Verdict;
      flaw?: string;
      unsettled?: Unsettled;
      output?: string;
    },
  ): Promise<Answered>;
  /**
   * Closes the open question, and tells the page, if the evidence has its
   * answer already: a stop came between recording it and closing it. A
   * miss opens its detour, as `answer` does.
   */
  closeAnswered(): Promise<Answered | undefined>;
  /** Ends the detour and keeps its next step in the same write, then tells the page. */
  endDetour(next: NonNullable<UnitPosition["afterAnswer"]>): Promise<void>;
  /**
   * Records or recovers an override of the segment's objectives and closes
   * the segment, withdrawing any open question and ending any detour. The
   * write that closes it keeps the notice for the tutor's next header, so
   * moving on costs no reply.
   */
  overrideSegment(): Promise<void>;
  /**
   * Keeps and records the closing-card override, or resumes a pending one.
   * The caller tells the page once its gate or finish is saved.
   */
  moveOn(action?: {
    objectives: string[];
    gate: AssessedObjective[];
  }): Promise<NonNullable<UnitPosition["pendingMoveOn"]>>;
  /**
   * Takes the unit out of the units in progress, keeping its closed
   * position if it holds the tutor's session or a notice, and any full
   * test-out finish, then shows it.
   * A style proposal still waiting is withdrawn.
   */
  finish(
    status: "passed" | "overridden",
    outcome?: { tell?: (() => void) | undefined; testedOut?: boolean },
  ): Promise<void>;
}

/**
 * Reads the unit's position and evidence. A unit with no position starts at
 * segment 1 in teach, which is written at once, unless its objectives make
 * it passed or overridden: then it is finished, and not started again.
 */
export async function openUnitRecord(options: {
  dataRoot: DataRoot;
  courseId: Slug;
  /** The unit with its plan. */
  unit: StoredUnit;
  plan: Plan;
  emit: (event: PageEvent) => void;
  /** Publishes an Apply finished by a later position write in this chat. */
  recoveredCurriculumChange: (decision: CurriculumDecision) => Promise<void>;
  packagePreview: (request: PackageRequest) => PackageCompletion["preview"];
  /** An install that started keeps its card until the real outcome arrives. */
  savingPackage: (requestId: string) => boolean;
  /** The clock for the evidence's dates. */
  now: () => Date;
  /** Commits the record once a segment closes or the unit ends; none if not given. */
  backup?: Backup;
  /** A unit with no position starts with its test due (task 5.6) instead of its teaching. */
  testOut?: boolean;
  /** Asks for a handoff note once a segment closes or the unit ends; nothing if not given. */
  handoff?: () => void;
}): Promise<UnitRecord> {
  const { dataRoot, courseId, unit, plan, emit, now } = options;
  const backup = options.backup ?? noBackup;
  const unitId = unit.id;
  // The unit's own entry only: an id such as "constructor" is also the name
  // of a property every object inherits.
  const {
    units: positions,
    finishedReviews = {},
    packageCompletions = {},
    testedOut: tests,
    styleDecisions = {},
    curriculumDecisions = {},
  } = await dataRoot.readState(courseId);
  const completed = Object.hasOwn(packageCompletions, unitId)
    ? (packageCompletions[unitId] ?? {})
    : {};
  let pendingStyle = decisionsForUnit(styleDecisions);
  let pendingCurriculum = decisionsForUnit(curriculumDecisions);
  function decisionsForUnit<T>(byUnit: Record<Slug, T[]> | undefined): T[] {
    return Object.hasOwn(byUnit ?? {}, unitId) ? (byUnit?.[unitId] ?? []) : [];
  }
  const stored = Object.hasOwn(positions, unitId)
    ? positions[unitId]
    : undefined;
  const storedRun = Object.hasOwn(finishedReviews, unitId)
    ? finishedReviews[unitId]
    : undefined;
  const allEvidence = await dataRoot.readEvidence(courseId);
  // An older build could restart teaching and leave both entries for a
  // finished unit. An ordinary position alone still means in progress.
  const before =
    stored === undefined || storedRun !== undefined
      ? unitStatus(unit, allEvidence, undefined)
      : undefined;
  let finished: "passed" | "overridden" | undefined =
    before === "passed" || before === "overridden" ? before : undefined;
  let testedOut = finished !== undefined && tests?.[unitId] === true;
  const runningFinished = finished === undefined ? undefined : storedRun;
  const kept = runningFinished ?? stored;
  if (kept !== undefined) checkPosition(plan, kept);
  let sessionId = kept?.tutorSessionId;
  let sessionTools = kept?.tutorTools;
  let notices: readonly TutorNotice[] = kept?.tutorNotices ?? [];
  /** A notice being written with a change, kept once the write lands (`withNotice`). */
  let adding: TutorNotice | undefined;

  /** The tutor's session as the position keeps it: its id, and the tools it began with. */
  function session(): Pick<UnitPosition, "tutorSessionId" | "tutorTools"> {
    return {
      ...(sessionId === undefined ? {} : { tutorSessionId: sessionId }),
      ...(sessionTools === undefined ? {} : { tutorTools: sessionTools }),
    };
  }

  /** The notices a write saves: those kept, with one being written. */
  function noticesSaved(): readonly TutorNotice[] {
    return adding === undefined ? notices : [...notices, adding];
  }

  /** The position with the notices as they stand: none, or at least one. */
  function withNotices(given: UnitPosition): UnitPosition {
    const { tutorNotices: _, ...rest } = given;
    const saved = noticesSaved();
    return saved.length === 0 ? rest : { ...rest, tutorNotices: [...saved] };
  }

  function closedPosition(): UnitPosition {
    return withNotices({
      segment: plan.segments.length - 1,
      phase: "closed",
      ...session(),
    });
  }

  if (runningFinished !== undefined && stored !== undefined) {
    await dataRoot.writePosition(courseId, unitId, null);
  } else if (storedRun !== undefined && finished === undefined) {
    await dataRoot.writePosition(courseId, unitId, null, { finished: true });
  }
  let position: UnitPosition =
    kept ??
    (finished !== undefined
      ? closedPosition()
      : options.testOut === true
        ? { segment: 0, phase: "teach", testOut: { stage: "due" } }
        : { segment: 0, phase: "teach" });
  if (stored === undefined && finished === undefined) {
    await dataRoot.writePosition(courseId, unitId, position);
  }
  const evidence = concerning(
    allEvidence,
    objectivesKept(plan, allEvidence, unitId, position),
  );
  let checkAnswers = answersInCheck(allEvidence, position, plan);
  let runAnswers =
    position.assessment === undefined
      ? []
      : answersInRun(allEvidence, position.assessment, unitId);

  /**
   * Saves a move and notices an Apply recovered before or during the write.
   * A finished unit's position is saved in `finishedReviews` while it holds
   * an assessment (a review or a self-test the learner asked for), and
   * otherwise as its closed position while that holds the tutor's session
   * or a notice; null leaves it as it is.
   */
  async function savePosition(
    given: UnitPosition | null,
    outcome?: Parameters<DataRoot["writePosition"]>[3],
  ) {
    // Every write keeps the notices as they stand, whichever position it
    // was given, so a write after a failed delivery takes them out too.
    const next = given === null ? null : withNotices(given);
    if (finished !== undefined) {
      const kept = next ?? withNotices(position);
      const holding =
        kept.assessment !== undefined
          ? kept
          : sessionId !== undefined || noticesSaved().length > 0
            ? closedPosition()
            : null;
      const saved = await dataRoot.writePosition(courseId, unitId, holding, {
        ...outcome,
        finished: true,
      });
      position = holding ?? closedPosition();
      return saved;
    }
    const waiting = position.curriculumChange;
    const saved = await dataRoot.writePosition(courseId, unitId, next, outcome);
    const current = saved.units[unitId];
    if (next !== null) position = next;
    if (waiting !== undefined && current?.curriculumChange?.id !== waiting.id) {
      if (next !== null && current !== undefined) position = current;
      pendingCurriculum = decisionsForUnit(saved.curriculumDecisions);
      const recovered = pendingCurriculum.find(
        (d) => d.proposalId === waiting.id && d.outcome === "applied",
      );
      if (recovered !== undefined) {
        await options.recoveredCurriculumChange(recovered);
      }
    }
    return saved;
  }

  /**
   * Runs a write that saves `notice` with it for the tutor's next header.
   * The notice is kept only once the write lands, so no header carries a
   * notice of a change not saved, or before what it names is kept.
   */
  async function withNotice<T>(
    notice: NewNotice | undefined,
    write: () => Promise<T>,
  ): Promise<T> {
    if (notice === undefined) return write();
    const added: TutorNotice = { ...notice, id: randomUUID() };
    adding = added;
    try {
      const done = await write();
      notices = [...notices, added];
      return done;
    } finally {
      adding = undefined;
    }
  }

  async function move(given: UnitPosition, tell?: () => void): Promise<void> {
    const {
      tutorSessionId: _,
      tutorTools: _____,
      packageRequest: __,
      styleProposal: ___,
      curriculumChange: ____,
      ...rest
    } = given;
    const next: UnitPosition = {
      ...rest,
      ...session(),
      ...(position.packageRequest === undefined
        ? {}
        : { packageRequest: position.packageRequest }),
      ...(position.styleProposal === undefined
        ? {}
        : { styleProposal: position.styleProposal }),
      ...(position.curriculumChange === undefined
        ? {}
        : { curriculumChange: position.curriculumChange }),
      // The gate is offered once, whatever position the chat gives.
      ...(position.gated === true ? { gated: true as const } : {}),
      // What the learner chose to skip holds until the unit finishes.
      ...(position.testOut?.stage === "skip" && rest.testOut === undefined
        ? { testOut: position.testOut }
        : {}),
      ...(position.gateUnanswered === undefined
        ? {}
        : { gateUnanswered: position.gateUnanswered }),
    };
    if (consumesAnswerCheckpoint(position, next)) {
      delete next.afterAnswer;
    }
    const was = position;
    await savePosition(next);
    tell?.();
    if (was.segment !== next.segment || was.phase !== next.phase) {
      emit(phaseEvent(next));
      if (next.phase === "closed") {
        const segment =
          next.again === undefined
            ? `segment ${next.segment + 1} of ${unitId}`
            : `the segment going over ${unitId}'s objectives again`;
        backup.commit(`${courseId}: ${segment} closed`);
        options.handoff?.();
      }
    }
  }

  /**
   * Takes the evidence the unit keeps from `log`, the course's evidence as
   * read now. An assessment can ask about other units' objectives, which
   * their own chats, and other units' assessments, write on too.
   */
  function readAgain(log: readonly EvidenceEntry[], at = position): void {
    evidence.splice(
      0,
      evidence.length,
      ...concerning(log, objectivesKept(plan, log, unitId, at)),
    );
  }

  async function append(entry: EvidenceEntry): Promise<void> {
    await dataRoot.appendEvidence(courseId, entry);
    evidence.push(entry);
  }

  function objectiveStatuses(): Record<string, ObjectiveStatus> {
    return Object.fromEntries(
      plan.objectives.map((o) => [o.id, objectiveStatus(evidence, o.id)]),
    );
  }

  function status(): Extract<PageEvent, { type: "unit_status" }> {
    return {
      type: "unit_status",
      unit: unitStatus(
        unit,
        evidence,
        finished === undefined ? position : undefined,
      ),
      objectives: objectiveStatuses(),
    };
  }

  function tellStatus(): void {
    const event = status();
    if (
      finished !== undefined &&
      (event.unit === "passed" || event.unit === "overridden")
    ) {
      finished = event.unit;
    }
    emit(event);
  }

  function openQuestion(): OpenQuestion {
    const open = position.openQuestion;
    if (open === undefined) throw new Error("No question is open.");
    return open;
  }

  function recordedAnswer(questionId: string): AnswerEvidence | undefined {
    return evidence.find(
      (e): e is AnswerEvidence =>
        e.kind === "answer" && e.answer.questionId === questionId,
    );
  }

  /**
   * Keeps the dispute and its override, and tells the page, once `notice`,
   * if given, is kept for the tutor. A finished unit's status can change
   * with it: overridden once a pass is taken, or passed once a miss is
   * overturned.
   */
  async function keepDispute(
    entry: DisputeEvidence,
    override: OverrideEvidence | undefined,
    notice: NewNotice | undefined,
  ): Promise<void> {
    evidence.push(entry);
    if (override !== undefined) evidence.push(override);
    if (notice !== undefined) {
      // The dispute is recorded already: a failed write leaves the notice
      // in memory, and the record's next write saves it. A restart before
      // that loses it while the thread shows the outcome, so the tutor is
      // never told. Accepted (the user's choice, 2026-11-25): it takes a
      // failed state write, and the evidence and the thread stay right;
      // withholding the outcome from the thread until the notice is saved
      // was turned down.
      await keepNotice(notice).catch((error: unknown) => {
        console.error("The tutor's notice could not be saved:", error);
      });
    }
    emit(disputedEvent(entry));
    tellStatus();
  }

  async function keepNotice(notice: NewNotice, next = position): Promise<void> {
    notices = [...notices, { ...notice, id: randomUUID() }];
    await move(next);
  }

  /**
   * Closes the question its recorded answer answers, and tells the page.
   * A miss opens a detour on it.
   */
  async function close(
    question: OpenQuestion,
    entry: AnswerEvidence,
  ): Promise<Answered> {
    const { openQuestion: _, ...rest } = position;
    // A miss in the test before the unit opens no detour: it means "teach me this".
    const detour: Detour | undefined =
      entry.verdict === "correct" || entry.assessment?.mode === "test-out"
        ? undefined
        : {
            questionId: question.id,
            number: question.number,
            objective: question.objective,
          };
    await move({
      ...rest,
      ...(detour === undefined ? {} : { detour }),
      ...(entry.assessment?.mode === "test-out"
        ? {}
        : {
            afterAnswer: feedbackCheckpoint(question),
          }),
    });
    emit(gradedEvent(entry));
    tellStatus();
    if (detour !== undefined) emit(detourEvent(detour));
    return { number: question.number, entry };
  }

  async function finish(
    how: "passed" | "overridden",
    {
      tell,
      testedOut: byTest = false,
    }: {
      tell?: (() => void) | undefined;
      testedOut?: boolean;
    } = {},
  ): Promise<void> {
    const { packageRequest, styleProposal, curriculumChange } = position;
    const completion: PackageCompletion | undefined =
      packageRequest === undefined
        ? undefined
        : {
            request: packageRequest,
            preview: options.packagePreview(packageRequest),
            outcome: "withdrawn",
          };
    // The unit's finished position keeps its tutor's session, in the same
    // write that takes it out of the units in progress.
    const saved = await savePosition(null, {
      completion,
      testedOut: byTest,
      ...(sessionId !== undefined || noticesSaved().length > 0
        ? { held: closedPosition() }
        : {}),
    });
    finished = how;
    testedOut = byTest;
    position = closedPosition();
    tell?.();
    if (completion !== undefined) {
      keepCompletion(completion, !options.savingPackage(completion.request.id));
    }
    emit(status());
    if (styleProposal !== undefined) {
      emit({
        type: "style_answered",
        proposalId: styleProposal.id,
        outcome: "withdrawn",
      });
    }
    if (
      curriculumChange !== undefined &&
      !decisionsForUnit(saved.curriculumDecisions).some(
        (d) => d.proposalId === curriculumChange.id && d.outcome === "applied",
      )
    ) {
      emit({
        type: "curriculum_change_answered",
        proposalId: curriculumChange.id,
        outcome: "withdrawn",
      });
    }
    emit({ type: "unit_closed", status: how });
    backup.commit(`${courseId}: unit ${unitId} finished, ${how}`);
    options.handoff?.();
  }

  function keepCompletion(completion: PackageCompletion, tell = true): void {
    completed[completion.request.id] = completion;
    if (tell) emit(packagesAnsweredEvent(completion));
  }

  return {
    get position() {
      return position;
    },
    evidence,
    get checkAnswers() {
      return checkAnswers;
    },
    get runAnswers() {
      return runAnswers;
    },
    get packageCompletions() {
      return Object.values(completed);
    },
    get pendingStyleDecisions() {
      return pendingStyle;
    },
    get pendingCurriculumDecisions() {
      return pendingCurriculum;
    },
    get tutorNotices() {
      return notices;
    },
    get finished() {
      return finished;
    },
    get testedOut() {
      return testedOut;
    },
    reopened: kept !== undefined,
    status,
    recordedAnswer,
    disputeOf: (questionId) => disputesIn(evidence).get(questionId),
    objectiveStatuses,
    move: (given, tell, notice) => withNotice(notice, () => move(given, tell)),

    async testSummaryGiven() {
      const { testOut, ...rest } = position;
      if (testOut?.stage !== "result" || testOut.summaryOwed !== true) return;
      const { summaryOwed: _, ...given } = testOut;
      await move({ ...rest, testOut: given });
    },

    async dispute(entry, notice) {
      const answered = recordedAnswer(entry.questionId);
      const override: OverrideEvidence | undefined =
        finished !== undefined &&
        answered !== undefined &&
        takesPass(evidence, entry, answered.objective)
          ? {
              kind: "override",
              recordedAt: entry.recordedAt,
              objectives: [answered.objective],
            }
          : undefined;
      await dataRoot.appendDispute(courseId, entry, override);
      await keepDispute(entry, override, notice);
      return override;
    },

    async learnDispute(entry, override, notice) {
      if (disputesIn(evidence).has(entry.questionId)) return false;
      await keepDispute(entry, override, notice);
      return true;
    },

    learnAnswer(entry) {
      if (recordedAnswer(entry.answer.questionId) !== undefined) return false;
      evidence.push(entry);
      tellStatus();
      return true;
    },

    async keepSession(id, tools) {
      if (id === sessionId) return;
      const was = { id: sessionId, tools: sessionTools };
      sessionId = id;
      sessionTools =
        id === undefined || tools === undefined ? undefined : [...tools];
      try {
        await move(position);
      } catch (error) {
        sessionId = was.id;
        sessionTools = was.tools;
        throw error;
      }
    },

    async keepPackageRequest(request, tell) {
      if (finished !== undefined) return;
      const next = { ...position, packageRequest: request };
      await savePosition(next);
      tell();
    },

    async completePackageRequest(completion) {
      const { packageRequest, ...next } = position;
      const { id } = completion.request;
      const recorded = completed[id];
      if (
        recorded?.outcome === completion.outcome &&
        recorded.output === completion.output
      ) {
        emit(packagesAnsweredEvent(recorded));
        return true;
      }
      if (finished !== undefined) {
        // The unit ended during the install. Replace its withdrawal with
        // the install's result, but do not give the finished unit a position.
        if (completed[id]?.outcome !== "withdrawn") return false;
        await savePosition(null, { completion });
      } else {
        if (packageRequest?.id !== id) return false;
        // Kept within the write, so the notice never names a completion
        // the record does not hold yet.
        await withNotice({ kind: "packages", requestId: id }, async () => {
          await savePosition(next, { completion });
          keepCompletion(completion);
        });
        return true;
      }
      keepCompletion(completion);
      return true;
    },

    async keepStyleProposal(proposal, tell) {
      if (finished !== undefined) return;
      const next = { ...position, styleProposal: proposal };
      await savePosition(next);
      tell();
    },

    async keepCurriculumChange(change, tell) {
      if (finished !== undefined) return;
      const next = { ...position, curriculumChange: change };
      await savePosition(next);
      tell();
    },

    async answerStyleProposal(decision) {
      const { styleProposal, ...next } = position;
      if (finished !== undefined || styleProposal?.id !== decision.proposalId) {
        throw new Error("That proposed style note is not waiting.");
      }
      const saved = await savePosition(next, { style: { decision } });
      pendingStyle = decisionsForUnit(saved.styleDecisions);
      const recorded = pendingStyle.find(
        (d) => d.proposalId === decision.proposalId,
      );
      if (recorded === undefined) {
        throw new Error("The style decision was not recorded.");
      }
      return recorded;
    },

    async answerCurriculumChange(decision) {
      const { curriculumChange, ...next } = position;
      if (
        finished !== undefined ||
        curriculumChange?.id !== decision.proposalId
      ) {
        throw new Error("That proposed curriculum change is not waiting.");
      }
      const saved = await dataRoot.writePosition(courseId, unitId, next, {
        curriculum: { decision },
      });
      position = saved.units[unitId] ?? next;
      pendingCurriculum = decisionsForUnit(saved.curriculumDecisions);
      const recorded = pendingCurriculum.find(
        (d) => d.proposalId === decision.proposalId,
      );
      if (recorded === undefined) {
        throw new Error("The curriculum decision was not recorded.");
      }
      return recorded;
    },

    keepNotice,

    async deliverNotices(ids) {
      const left = notices.filter((notice) => !ids.includes(notice.id));
      if (left.length === notices.length) return;
      notices = left;
      await move(position);
    },

    async deliverDecisions({ style, curriculum }) {
      const saved = await savePosition(
        finished === undefined ? position : null,
        {
          ...(style.length === 0 ? {} : { style: { delivered: style } }),
          ...(curriculum.length === 0
            ? {}
            : { curriculum: { delivered: curriculum } }),
        },
      );
      pendingStyle = decisionsForUnit(saved.styleDecisions);
      pendingCurriculum = decisionsForUnit(saved.curriculumDecisions);
    },

    async startCheck() {
      const checkFrom = (await dataRoot.readEvidence(courseId)).length;
      await move({ ...position, phase: "check", checkFrom });
      checkAnswers = [];
    },

    async startAssessment(tell) {
      const offered = position.assessment;
      if (offered?.stage !== "offered") {
        throw new Error("No assessment is offered.");
      }
      const from = (await dataRoot.readEvidence(courseId)).length;
      const run: AssessmentRun = { ...offered, stage: "on", from };
      await move({ ...position, assessment: run }, () => tell(run));
      runAnswers = [];
      return run;
    },

    async startTest(tell) {
      if (position.testOut?.stage !== "due") {
        throw new Error("No test is due.");
      }
      const from = (await dataRoot.readEvidence(courseId)).length;
      const run: AssessmentRun = {
        mode: "test-out",
        stage: "on",
        objectives: plan.objectives.map((o) => ({
          unit: unitId,
          objective: o.id,
        })),
        from,
      };
      const { testOut: _, ...rest } = position;
      await move({ ...rest, assessment: run }, () => tell(run));
      runAnswers = [];
      return run;
    },

    async passOver(passed, tell) {
      const run = position.assessment;
      if (run?.mode !== "self-test" || run.stage !== "on") {
        throw new Error("No self-test is under way.");
      }
      await move(
        {
          ...position,
          assessment: {
            ...run,
            passedOver: [...(run.passedOver ?? []), passed],
          },
        },
        tell,
      );
    },

    async startSelfTest({ objectives, kinds }, log, tell) {
      const run: AssessmentRun = {
        mode: "self-test",
        stage: "on",
        objectives,
        kinds,
        from: log.length,
      };
      readAgain(log, { ...position, assessment: run });
      await move({ ...position, assessment: run }, () => tell(run));
      runAnswers = [];
      return run;
    },

    async offerAssessment(run, log, tell) {
      readAgain(log, { ...position, assessment: run });
      const { pendingMoveOn: _, ...rest } = position;
      await move(
        {
          ...rest,
          assessment: run,
          ...(run.mode === "gate" ? { gated: true as const } : {}),
        },
        tell,
      );
    },

    async endAssessment(skipped) {
      const run = position.assessment;
      if (run === undefined)
        throw new Error("No assessment is offered or under way.");
      const answered = answeredInRun(run, runAnswers);
      readAgain(await dataRoot.readEvidence(courseId));
      const withdrawn = position.openQuestion;
      const gateUnanswered =
        run.mode === "gate" &&
        withdrawn !== undefined &&
        run.objectives.some(
          (o) => o.unit !== unitId && o.objective === withdrawn.objective,
        )
          ? withdrawn.objective
          : undefined;
      const {
        assessment: _,
        openQuestion: __,
        detour: ___,
        afterAnswer: ____,
        ...rest
      } = position;
      const resume = checkpointAfterAssessment(position, skipped);
      const statuses = Object.fromEntries(
        answered.map((id) => [id, objectiveStatus(evidence, id)]),
      );
      const ended: NewNotice | undefined =
        run.stage !== "on" || run.mode === "test-out"
          ? undefined
          : {
              kind: "assessment-end",
              mode: run.mode,
              skipped,
              ...(skipped && withdrawn !== undefined
                ? { withdrawn: withdrawn.number }
                : {}),
              statuses,
              ...(run.passedOver === undefined
                ? {}
                : { passedOver: run.passedOver.map((p) => p.objective) }),
            };
      await withNotice(ended, () =>
        move(
          run.mode === "test-out"
            ? {
                ...rest,
                testOut: {
                  stage: "result",
                  summaryOwed: true,
                  ...(skipped
                    ? {
                        stopped:
                          withdrawn === undefined
                            ? {}
                            : { withdrawn: withdrawn.number },
                      }
                    : {}),
                },
              }
            : gateUnanswered === undefined
              ? {
                  ...rest,
                  ...(resume === undefined ? {} : { afterAnswer: resume }),
                }
              : { ...rest, gateUnanswered },
          () =>
            emit({
              type: "assessment_end",
              mode: run.mode,
              skipped,
              statuses,
              ...(withdrawn === undefined
                ? {}
                : { withdrawnQuestionId: withdrawn.id }),
              ...(run.passedOver === undefined
                ? {}
                : { passedOver: run.passedOver.length }),
            }),
        ),
      );
      runAnswers = [];
      if (answered.length > 0) {
        backup.commit(
          `${courseId}: ${run.mode} in ${unitId} ${skipped ? "skipped" : "ended"}`,
        );
      }
      return { run, withdrawn, statuses };
    },

    async answer(submission, grade) {
      const question = openQuestion();
      let entry = recordedAnswer(question.id);
      if (entry === undefined) {
        const flaw = grade.verdict === "incorrect" ? grade.flaw : undefined;
        const { unsettled, output } = grade;
        const run =
          position.assessment?.stage === "on" ? position.assessment : undefined;
        entry = {
          kind: "answer",
          recordedAt: now().toISOString(),
          objective: question.objective,
          question: question.question,
          answer: submission,
          assisted: question.assisted === true,
          verdict: grade.verdict,
          ...(flaw === undefined ? {} : { flaw }),
          ...(unsettled === undefined ? {} : { unsettled }),
          ...(output === undefined ? {} : { output }),
          ...(run === undefined
            ? {}
            : { assessment: { mode: run.mode, unit: unitId } }),
        };
        // The evidence first: a stop before the position is written leaves
        // the question open, and reopening closes it with this entry.
        await append(entry);
        if (run === undefined) checkAnswers.push(entry);
        else runAnswers.push(entry);
      }
      return close(question, entry);
    },

    async closeAnswered() {
      const question = position.openQuestion;
      const entry =
        question === undefined ? undefined : recordedAnswer(question.id);
      if (question === undefined || entry === undefined) return undefined;
      return close(question, entry);
    },

    async endDetour(afterAnswer) {
      const { detour, ...rest } = position;
      if (detour === undefined) throw new Error("No detour is open.");
      await move({ ...rest, afterAnswer }, () => emit({ type: "detour_end" }));
    },

    async overrideSegment() {
      const { segment } = position;
      let entry = position.pendingSegmentOverride;
      if (entry === undefined) {
        entry = {
          kind: "override",
          recordedAt: now().toISOString(),
          objectives: [...segmentOf(plan, position).objectives],
          moveOnId: randomUUID(),
        };
        await move({ ...position, pendingSegmentOverride: entry });
        await append(entry);
      } else {
        readAgain(await dataRoot.recoverOverride(courseId, entry));
      }
      const { objectives } = entry;
      const withdrawn = position.openQuestion;
      const {
        checkFrom: _,
        openQuestion: __,
        detour: ___,
        pendingSegmentOverride: ____,
        ...rest
      } = position;
      await withNotice(
        {
          kind: "override",
          objectives,
          ...(withdrawn === undefined ? {} : { withdrawn: withdrawn.number }),
        },
        () =>
          move({ ...rest, phase: "closed" }, () => {
            emit({
              type: "overridden",
              segment,
              objectives,
              ...(withdrawn === undefined
                ? {}
                : { withdrawnQuestionId: withdrawn.id }),
            });
            emit(status());
          }),
      );
      checkAnswers = [];
    },

    async moveOn(action) {
      let pending = position.pendingMoveOn;
      if (pending === undefined) {
        if (action === undefined) throw new Error("No move-on is pending.");
        const entry = {
          kind: "override",
          recordedAt: now().toISOString(),
          objectives: action.objectives,
          moveOnId: randomUUID(),
        } as const;
        pending = { ...entry, gate: action.gate };
        await move({ ...position, pendingMoveOn: pending });
        await append(entry);
      } else {
        const { gate: _, ...entry } = pending;
        readAgain(await dataRoot.recoverOverride(courseId, entry));
      }
      emit(status());
      return pending;
    },
    finish,
  };
}

/** The durable outcome of a package card. */
export function packagesAnsweredEvent({
  request,
  outcome,
  output,
}: PackageCompletion): PageEvent {
  return {
    type: "packages_answered",
    requestId: request.id,
    outcome,
    ...(output === undefined ? {} : { output }),
  };
}

/** A `graded` event: the grade the evidence has for the answer to a question. */
export function gradedEvent(entry: AnswerEvidence): PageEvent {
  return {
    type: "graded",
    questionId: entry.answer.questionId,
    verdict: entry.verdict,
    answer: entry.answer,
    ...(entry.question.kind === "choice"
      ? { correctChoice: entry.question.answer }
      : entry.question.kind === "math"
        ? { expected: entry.question.expected }
        : {}),
    ...(entry.unsettled === undefined ? {} : { unsettled: entry.unsettled }),
    ...(entry.flaw === undefined ? {} : { flaw: entry.flaw }),
    ...(entry.output === undefined ? {} : { output: entry.output }),
    assisted: entry.assisted,
  };
}

/** A `disputed` event: the outcome of a dispute of the answer to a question. */
export function disputedEvent(entry: DisputeEvidence): PageEvent {
  return {
    type: "disputed",
    questionId: entry.questionId,
    dispute: {
      recordedAt: entry.recordedAt,
      reason: entry.reason,
      outcome: entry.outcome,
    },
  };
}

/** A `detour` event: a detour opened after a miss, or the chat opened in it. */
export function detourEvent(detour: Detour): PageEvent {
  return {
    type: "detour",
    questionId: detour.questionId,
    number: detour.number,
  };
}

/**
 * An `assessment` event: its card offered, or it began, or the chat opened
 * with it. A gate's says how many of its objectives are the unit's own, and
 * from which of the course's `units` the rest come; a self-test's, the
 * kinds of question picked.
 */
export function assessmentEvent(
  run: AssessmentRun,
  unitId: string,
  units: readonly { id: string }[],
): PageEvent {
  const event = {
    type: "assessment" as const,
    mode: run.mode,
    stage: run.stage,
    count: run.objectives.length,
  };
  if (run.mode === "self-test") {
    return run.kinds === undefined ? event : { ...event, kinds: run.kinds };
  }
  if (run.mode !== "gate") return event;
  const others = run.objectives.filter((o) => o.unit !== unitId);
  const from = new Set(
    others.map((o) => units.findIndex((u) => u.id === o.unit) + 1),
  );
  from.delete(0);
  return {
    ...event,
    own: run.objectives.length - others.length,
    from: [...from].sort((a, b) => a - b),
  };
}

/** A `phase` event: the segment's phase began, or the chat opened in it. */
export function phaseEvent(
  position: UnitPosition,
): Extract<PageEvent, { type: "phase" }> {
  const { testOut } = position;
  const beforeTest = isBeforeTest(position);
  return {
    type: "phase",
    segment: position.segment,
    phase: position.phase,
    ...(beforeTest ? { beforeTest: true } : {}),
    ...(position.again === undefined ? {} : { again: position.again }),
    ...(testOut?.stage === "skip" ? { skipping: testOut.passed } : {}),
  };
}

/**
 * A position read back from state.json fits the unit's plan: a segment of
 * the plan, or the one after it that goes over objectives of the plan, and
 * skipping only objectives of the plan.
 */
function checkPosition(plan: Plan, position: UnitPosition): void {
  const ids = new Set(plan.objectives.map((o) => o.id));
  const fits =
    position.again === undefined
      ? plan.segments[position.segment] !== undefined
      : position.segment === plan.segments.length &&
        position.again.every((id) => ids.has(id));
  if (!fits) {
    throw new Error(
      `state.json puts the unit at segment ${position.segment + 1}, which its plan does not have.`,
    );
  }
  const { testOut } = position;
  if (testOut?.stage === "skip" && !testOut.passed.every((id) => ids.has(id))) {
    throw new Error(
      "state.json has the unit skip objectives its plan does not have.",
    );
  }
}

/**
 * The objectives whose evidence the unit keeps: its plan's, its assessment's,
 * and those of every answer and withdrawn gate question in its thread.
 */
function objectivesKept(
  plan: Plan,
  log: readonly EvidenceEntry[],
  unitId: string,
  position: Pick<UnitPosition, "assessment" | "gateUnanswered">,
): Set<string> {
  const ids = new Set(plan.objectives.map((o) => o.id));
  for (const { objective } of position.assessment?.objectives ?? []) {
    ids.add(objective);
  }
  if (position.gateUnanswered !== undefined) ids.add(position.gateUnanswered);
  for (const entry of log) {
    if (entry.kind === "answer" && entry.assessment?.unit === unitId) {
      ids.add(entry.objective);
    }
  }
  return ids;
}

/**
 * The entries about these objectives: answers on them, overrides naming
 * them, and disputes of those answers.
 */
function concerning(
  evidence: readonly EvidenceEntry[],
  ids: ReadonlySet<string>,
): EvidenceEntry[] {
  const answers = new Set(
    evidence.flatMap((e) =>
      e.kind === "answer" && ids.has(e.objective) ? [e.answer.questionId] : [],
    ),
  );
  return evidence.filter((e) =>
    e.kind === "answer"
      ? ids.has(e.objective)
      : e.kind === "override"
        ? e.objectives.some((id) => ids.has(id))
        : answers.has(e.questionId),
  );
}

/** The answers in the position's check to its segment's objectives. */
function answersInCheck(
  evidence: readonly EvidenceEntry[],
  position: UnitPosition,
  plan: Plan,
): AnswerEvidence[] {
  if (position.phase !== "check" || position.checkFrom === undefined) {
    return [];
  }
  const { objectives } = segmentOf(plan, position);
  return evidence
    .slice(position.checkFrom)
    .filter(
      (e): e is AnswerEvidence =>
        e.kind === "answer" &&
        e.assessment === undefined &&
        objectives.includes(e.objective),
    );
}
