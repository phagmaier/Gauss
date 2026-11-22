// Disputes (task 3.8; docs/brief.md, "Mastery and evidence"), raised from
// the graded card in a session or from an answer
// in "What I know", for any graded answer of the course, in a finished unit
// too. What the answer was graded by is shown to the learner while they
// dispute it. The dispute judge (dispute-judge.ts) decides, outside every
// queue, and only one dispute of an answer is decided at a time; a failed
// call records nothing, and the learner can send the dispute again. The
// outcome is recorded through the unit's chat when it is open, so it lands
// in order with the chat's own writes and the tutor is told; otherwise it is
// written here, and the chat learns it when it opens.

import type { Slug } from "../../shared/course.ts";
import type { StoredUnit } from "../../shared/curriculum.ts";
import type { GradedBy } from "../../shared/dispute.ts";
import type {
  AnswerEvidence,
  DisputeEvidence,
  OverrideEvidence,
} from "../../shared/evidence.ts";
import { type DataRoot, DisputeRefused } from "../record/data-root.ts";
import { answerTo, disputable } from "../record/disputes.ts";
import { takesPass, unitStatus } from "../record/status.ts";
import type { CourseHolder } from "./course-deletion.ts";
import type { DisputeJudge } from "./dispute-judge.ts";
import { mathRubric } from "./grading.ts";
import type { UnitChats } from "./unit-chat.ts";

export type DisputeResult =
  | { ok: true; dispute: DisputeEvidence }
  | { ok: false; status: 404 | 409 | 502; error: string };

export interface Disputes extends CourseHolder {
  /**
   * What the recorded answer to the question was graded by, for the learner
   * to dispute it; not for "I don't know", nor for a question not answered.
   */
  gradedBy(
    courseId: Slug,
    questionId: string,
  ): Promise<
    | { ok: true; gradedBy: GradedBy }
    | { ok: false; status: 404 | 409; error: string }
  >;
  /** Decides the learner's dispute of the answer to the question, and records it. */
  raise(
    courseId: Slug,
    questionId: string,
    reason: string,
  ): Promise<DisputeResult>;
}

export function createDisputes(options: {
  dataRoot: DataRoot;
  judge: DisputeJudge;
  units: UnitChats;
  /** The clock for the dispute's date. */
  now?: () => Date;
}): Disputes {
  const { dataRoot, judge, units } = options;
  const now = options.now ?? (() => new Date());
  /** The answers whose dispute is being decided, by course and question. */
  const deciding = new Set<string>();
  const key = (courseId: string, questionId: string) =>
    JSON.stringify([courseId, questionId]);

  async function answered(courseId: Slug, questionId: string) {
    if ((await dataRoot.readCourse(courseId)) === undefined) {
      return {
        ok: false as const,
        status: 404 as const,
        error: "No such course.",
      };
    }
    return disputable(await dataRoot.readEvidence(courseId), questionId);
  }

  return {
    async gradedBy(courseId, questionId) {
      if ((await dataRoot.readCourse(courseId)) === undefined) {
        return { ok: false, status: 404, error: "No such course." };
      }
      const answer = answerTo(
        await dataRoot.readEvidence(courseId),
        questionId,
      );
      if (answer === undefined) {
        return {
          ok: false,
          status: 404,
          error: "No answer to that question is recorded in this course.",
        };
      }
      const by = gradedBy(answer);
      return by === undefined
        ? {
            ok: false,
            status: 409,
            error: `"I don't know" was not graded, so nothing graded it.`,
          }
        : { ok: true, gradedBy: by };
    },

    async raise(courseId, questionId, reason) {
      const found = await answered(courseId, questionId);
      if (!found.ok) return found;
      const at = key(courseId, questionId);
      if (deciding.has(at)) {
        return {
          ok: false,
          status: 409,
          error: "A dispute of this grade is being decided.",
        };
      }
      deciding.add(at);
      try {
        const decided = await judge.decide(found.answer, reason);
        if (!decided.ok) {
          return {
            ok: false,
            status: 502,
            error: `The dispute could not be decided, and nothing was recorded: ${decided.error}`,
          };
        }
        const dispute: DisputeEvidence = {
          kind: "dispute",
          recordedAt: now().toISOString(),
          questionId,
          reason: reason.trim(),
          outcome: decided.outcome,
        };
        await record(courseId, found.answer, dispute);
        return { ok: true, dispute };
      } catch (error) {
        if (!(error instanceof DisputeRefused)) throw error;
        return { ok: false, status: error.status, error: error.message };
      } finally {
        deciding.delete(at);
      }
    },
    inUse(courseId) {
      for (const at of deciding) {
        const [course] = JSON.parse(at) as [string, string];
        if (course === courseId) return { doing: "dispute" };
      }
      return undefined;
    },
    // Nothing is kept of a course but the disputes being decided.
    async forget() {},
  };

  /**
   * Records the dispute through the chat of the answer's unit if it is open,
   * or else here. A chat that opened meanwhile, and read the evidence before
   * the dispute was written, then learns it. An answer given in another
   * unit's assessment is that unit's too: its chat learns the dispute, so
   * the assessment goes on with the corrected verdict and its tutor is told.
   */
  async function record(
    courseId: Slug,
    answer: AnswerEvidence,
    dispute: DisputeEvidence,
  ): Promise<void> {
    const stored = await dataRoot.readCourse(courseId);
    const unit = stored?.curriculum?.units.find((u) =>
      u.plan?.objectives.some((o) => o.id === answer.objective),
    );
    const chat = unit === undefined ? undefined : units.get(courseId, unit.id);
    const recorded =
      chat === undefined ? false : await chat.recordDispute(dispute);
    const override =
      recorded === false
        ? await recordHere(courseId, unit, dispute, answer.objective)
        : recorded.override;
    const asker = answer.assessment?.unit;
    if (asker !== undefined && asker !== unit?.id) {
      await units.get(courseId, asker)?.learnDispute(dispute, override);
    }
  }

  /**
   * Records the dispute without the chat of the answer's unit, which is not
   * open, and resolves to the override recorded with it, if any.
   */
  async function recordHere(
    courseId: Slug,
    unit: StoredUnit | undefined,
    dispute: DisputeEvidence,
    objective: string,
  ): Promise<OverrideEvidence | undefined> {
    // Only a chat writes the unit's position, so the position read here
    // stands while this is written.
    let override: OverrideEvidence | undefined;
    if (unit?.plan !== undefined) {
      const [state, evidence] = await Promise.all([
        dataRoot.readState(courseId),
        dataRoot.readEvidence(courseId),
      ]);
      const position = Object.hasOwn(state.units, unit.id)
        ? state.units[unit.id]
        : undefined;
      const status = unitStatus(unit, evidence, position);
      const finished = status === "passed" || status === "overridden";
      if (finished && takesPass(evidence, dispute, objective)) {
        override = {
          kind: "override",
          recordedAt: dispute.recordedAt,
          objectives: [objective],
        };
      }
    }
    await dataRoot.appendDispute(courseId, dispute, override);
    if (unit !== undefined) {
      await units.get(courseId, unit.id)?.learnDispute(dispute, override);
    }
    return override;
  }
}

/**
 * What the answer was graded by: the key, the expected expression (with the
 * rubric the grader had, if the symbolic check left it to the grader), the
 * rubric, or the tests with their command. None for "I don't know".
 */
export function gradedBy(entry: AnswerEvidence): GradedBy | undefined {
  const { question, answer } = entry;
  if (answer.kind === "unknown") return undefined;
  switch (question.kind) {
    case "choice":
      return { kind: "choice", key: question.answer };
    case "math":
      return {
        kind: "math",
        expected: question.expected,
        ...(entry.unsettled === undefined
          ? {}
          : { rubric: mathRubric(question) }),
      };
    case "written":
      return { kind: "written", rubric: question.rubric };
    case "code":
      return {
        kind: "code",
        tests: question.tests,
        command: question.command,
        ...(question.inputs === undefined ? {} : { inputs: question.inputs }),
      };
  }
}
