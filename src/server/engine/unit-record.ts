// One unit's part of the course record, kept in memory by its unit chat
// (unit-chat.ts; split out in task 2.8b): the unit's position, as state.json
// has it, and the evidence on its objectives. Every change is written before
// it is kept and the page hears of it (architecture.md section 4). An answer
// is appended to the evidence before its question is closed, and a question
// has one answer: one the evidence already holds is the one kept (task 2.8a).
//
// A miss opens a detour (task 2.20) in the same write that closes its
// question, so a restart never finds the question closed and no detour.
//
// The position also keeps the id of the unit's tutor session, so a unit
// reopened after a restart resumes it (task 2.14): every position written
// carries the id kept last, whatever position the chat gives.
//
// Once a segment's close or the unit's end is written, the backup is asked
// for a commit (task 2.25).
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

import type { Slug } from "../../shared/course.ts";
import type { StoredUnit } from "../../shared/curriculum.ts";
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
  Unsettled,
  Verdict,
} from "../../shared/question.ts";
import type { Detour, OpenQuestion, UnitPosition } from "../../shared/state.ts";
import type { ObjectiveStatus } from "../../shared/status.ts";
import { type Backup, noBackup } from "../record/backup.ts";
import type { DataRoot } from "../record/data-root.ts";
import { disputesIn } from "../record/disputes.ts";
import { objectiveStatus, takesPass, unitStatus } from "../record/status.ts";
import { segmentOf } from "./check-rules.ts";

/** A question closed with its answer, as the tutor is to be told it. */
export interface Answered {
  question: OpenQuestion;
  entry: AnswerEvidence;
}

export interface UnitRecord {
  /**
   * Where the unit stands, with its tutor session's id once one is kept;
   * kept once the unit is finished and out of state.json.
   */
  readonly position: UnitPosition;
  /** The evidence on the unit's objectives, in log order. */
  readonly evidence: readonly EvidenceEntry[];
  /** The answers to the segment's objectives in this check, in order. */
  readonly checkAnswers: readonly AnswerEvidence[];
  /** Completed package cards, kept even after the unit's position is removed. */
  readonly packageCompletions: readonly PackageCompletion[];
  /** Set once the unit is finished and taken out of state.json. */
  readonly finished: "passed" | "overridden" | undefined;
  /** The unit had a position in state.json when it was opened: it was under way. */
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
   */
  dispute(entry: DisputeEvidence): Promise<void>;
  /**
   * Keeps a dispute written to the record without this unit, with the
   * override written with it, and tells the page; nothing if it is kept
   * already. False if it was.
   */
  learnDispute(entry: DisputeEvidence, override?: OverrideEvidence): boolean;
  objectiveStatuses(): Record<string, ObjectiveStatus>;
  /**
   * Writes the position to state.json, with the tutor session's id kept, then
   * keeps it and tells the page: first what `tell` emits, if anything, then
   * the phase if it changed.
   */
  move(position: UnitPosition, tell?: () => void): Promise<void>;
  /**
   * Writes the id of the unit's tutor session into its position, or takes
   * it out, so the next start of the unit makes a new session. Nothing is
   * written once the unit is finished: it has no position.
   */
  keepSession(id: string | undefined): Promise<void>;
  /**
   * Writes the tutor's request to install packages into the position. It is
   * kept across moves, as the session's id is.
   */
  keepPackageRequest(request: PackageRequest, tell: () => void): Promise<void>;
  /** Saves and shows the completion, removing the matching pending request. */
  completePackageRequest(completion: PackageCompletion): Promise<boolean>;
  /** Starts the segment's check: this check is the evidence from here on. */
  startCheck(): Promise<void>;
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
  /** Ends the open detour, and tells the page: the learner asks for another question. */
  endDetour(): Promise<void>;
  /**
   * The learner moves on without the check: records an override of the
   * segment's objectives and closes the segment, withdrawing any open
   * question and ending any detour.
   */
  overrideSegment(): Promise<{
    objectives: string[];
    withdrawn: OpenQuestion | undefined;
  }>;
  /**
   * Ends the unit and takes it out of state.json: passed, or overridden,
   * after recording an override of the objectives not passed.
   */
  finish(status: "passed"): Promise<void>;
  finish(status: "overridden", objectives: readonly string[]): Promise<void>;
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
  packagePreview: (request: PackageRequest) => PackageCompletion["preview"];
  /** The clock for the evidence's dates. */
  now: () => Date;
  /** Commits the record once a segment closes or the unit ends; none if not given. */
  backup?: Backup;
}): Promise<UnitRecord> {
  const { dataRoot, courseId, unit, plan, emit, now } = options;
  const backup = options.backup ?? noBackup;
  const unitId = unit.id;
  // The unit's own entry only: an id such as "constructor" is also the name
  // of a property every object inherits.
  const { units: positions, packageCompletions = {} } =
    await dataRoot.readState(courseId);
  const completed = Object.hasOwn(packageCompletions, unitId)
    ? (packageCompletions[unitId] ?? {})
    : {};
  const stored = Object.hasOwn(positions, unitId)
    ? positions[unitId]
    : undefined;
  if (stored !== undefined) checkPosition(plan, stored);
  const allEvidence = await dataRoot.readEvidence(courseId);
  const evidence = concerning(allEvidence, plan);
  const before = unitStatus(unit, evidence, undefined);
  let finished: "passed" | "overridden" | undefined =
    stored === undefined && (before === "passed" || before === "overridden")
      ? before
      : undefined;
  let position: UnitPosition =
    stored ??
    (finished === undefined
      ? { segment: 0, phase: "teach" }
      : { segment: plan.segments.length - 1, phase: "closed" });
  if (stored === undefined && finished === undefined) {
    await dataRoot.writePosition(courseId, unitId, position);
  }
  let checkAnswers = answersInCheck(allEvidence, position, plan);
  let sessionId = position.tutorSessionId;

  async function move(given: UnitPosition, tell?: () => void): Promise<void> {
    const { tutorSessionId: _, packageRequest: __, ...rest } = given;
    const next: UnitPosition = {
      ...rest,
      ...(sessionId === undefined ? {} : { tutorSessionId: sessionId }),
      ...(position.packageRequest === undefined
        ? {}
        : { packageRequest: position.packageRequest }),
    };
    await dataRoot.writePosition(courseId, unitId, next);
    const was = position;
    position = next;
    tell?.();
    if (was.segment !== next.segment || was.phase !== next.phase) {
      emit(phaseEvent(next));
      if (next.phase === "closed") {
        const segment =
          next.again === undefined
            ? `segment ${next.segment + 1} of ${unitId}`
            : `the segment going over ${unitId}'s objectives again`;
        backup.commit(`${courseId}: ${segment} closed`);
      }
    }
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

  function status(): PageEvent {
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
   * Keeps the dispute and its override, and tells the page. A finished
   * unit's status can change with it: overridden once a pass is taken, or
   * passed once a miss is overturned.
   */
  function keepDispute(
    entry: DisputeEvidence,
    override: OverrideEvidence | undefined,
  ): void {
    evidence.push(entry);
    if (override !== undefined) evidence.push(override);
    if (finished !== undefined) {
      const now = unitStatus(unit, evidence, undefined);
      if (now === "passed" || now === "overridden") finished = now;
    }
    emit(disputedEvent(entry));
    emit(status());
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
    const detour: Detour | undefined =
      entry.verdict === "correct"
        ? undefined
        : {
            questionId: question.id,
            number: question.number,
            objective: question.objective,
          };
    await move(detour === undefined ? rest : { ...rest, detour });
    emit(gradedEvent(entry));
    emit(status());
    if (detour !== undefined) emit(detourEvent(detour));
    return { question, entry };
  }

  async function finish(
    how: "passed" | "overridden",
    objectives: readonly string[] = [],
  ): Promise<void> {
    if (how === "overridden") {
      await append({
        kind: "override",
        recordedAt: now().toISOString(),
        objectives: [...objectives],
      });
    }
    const { packageRequest, ...closed } = position;
    const completion: PackageCompletion | undefined =
      packageRequest === undefined
        ? undefined
        : {
            request: packageRequest,
            preview: options.packagePreview(packageRequest),
            outcome: "withdrawn",
          };
    await dataRoot.writePosition(courseId, unitId, null, completion);
    finished = how;
    position = closed;
    if (completion !== undefined) keepCompletion(completion);
    emit(status());
    emit({ type: "unit_closed", status: how });
    backup.commit(`${courseId}: unit ${unitId} finished, ${how}`);
  }

  function keepCompletion(completion: PackageCompletion): void {
    completed[completion.request.id] = completion;
    emit(packagesAnsweredEvent(completion));
  }

  return {
    get position() {
      return position;
    },
    evidence,
    get checkAnswers() {
      return checkAnswers;
    },
    get packageCompletions() {
      return Object.values(completed);
    },
    get finished() {
      return finished;
    },
    reopened: stored !== undefined,
    status,
    recordedAnswer,
    disputeOf: (questionId) => disputesIn(evidence).get(questionId),
    objectiveStatuses,
    move,

    async dispute(entry) {
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
      keepDispute(entry, override);
    },

    learnDispute(entry, override) {
      if (disputesIn(evidence).has(entry.questionId)) return false;
      keepDispute(entry, override);
      return true;
    },

    async keepSession(id) {
      if (finished !== undefined || id === sessionId) return;
      const was = sessionId;
      sessionId = id;
      try {
        await move(position);
      } catch (error) {
        sessionId = was;
        throw error;
      }
    },

    async keepPackageRequest(request, tell) {
      if (finished !== undefined) return;
      const next = { ...position, packageRequest: request };
      await dataRoot.writePosition(courseId, unitId, next);
      position = next;
      tell();
    },

    async completePackageRequest(completion) {
      const { packageRequest, ...next } = position;
      const { id } = completion.request;
      if (finished !== undefined) {
        // The unit ended during the install. Replace its withdrawal with
        // the install's result, but do not give the finished unit a position.
        if (completed[id]?.outcome !== "withdrawn") return false;
        await dataRoot.writePosition(courseId, unitId, null, completion);
      } else {
        if (packageRequest?.id !== id) return false;
        await dataRoot.writePosition(courseId, unitId, next, completion);
        position = next;
      }
      keepCompletion(completion);
      return true;
    },

    async startCheck() {
      const checkFrom = (await dataRoot.readEvidence(courseId)).length;
      await move({ ...position, phase: "check", checkFrom });
      checkAnswers = [];
    },

    async answer(submission, grade) {
      const question = openQuestion();
      let entry = recordedAnswer(question.id);
      if (entry === undefined) {
        const flaw = grade.verdict === "incorrect" ? grade.flaw : undefined;
        const { unsettled, output } = grade;
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
        };
        // The evidence first: a stop before the position is written leaves
        // the question open, and reopening closes it with this entry.
        await append(entry);
        checkAnswers.push(entry);
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

    async endDetour() {
      const { detour: _, ...rest } = position;
      await move(rest, () => emit({ type: "detour_end" }));
    },

    async overrideSegment() {
      const { segment } = position;
      const objectives = [...segmentOf(plan, position).objectives];
      await append({
        kind: "override",
        recordedAt: now().toISOString(),
        objectives,
      });
      const withdrawn = position.openQuestion;
      const { checkFrom: _, openQuestion: __, detour: ___, ...rest } = position;
      await move({ ...rest, phase: "closed" }, () => {
        emit({
          type: "overridden",
          segment,
          objectives,
          ...(withdrawn === undefined
            ? {}
            : { withdrawnQuestionId: withdrawn.id }),
        });
        emit(status());
      });
      checkAnswers = [];
      return { objectives, withdrawn };
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

/** A `phase` event: the segment's phase began, or the chat opened in it. */
export function phaseEvent(position: UnitPosition): PageEvent {
  return {
    type: "phase",
    segment: position.segment,
    phase: position.phase,
    ...(position.again === undefined ? {} : { again: position.again }),
  };
}

/**
 * A position read back from state.json fits the unit's plan: a segment of
 * the plan, or the one after it that goes over objectives of the plan.
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
}

/**
 * The entries about the plan's objectives: answers on them, overrides naming
 * them, and disputes of those answers.
 */
function concerning(
  evidence: readonly EvidenceEntry[],
  plan: Plan,
): EvidenceEntry[] {
  const ids = new Set(plan.objectives.map((o) => o.id));
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
        e.kind === "answer" && objectives.includes(e.objective),
    );
}
