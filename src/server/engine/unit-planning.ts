// Planning a unit when it starts (brief.md, "How a course runs"; task 2.5).
// A unit without a plan is planned in a backend session of its own, with
// prompts/unit-planner.md, before the tutor's session starts. The session
// gets one turn holding the course's background note (task 2.22) and its
// curriculum, with how the learner stands on each objective planned so far,
// and stores the plan through plan_unit; then it closes. A session that ends
// without a plan is tried once more, in a new session told why; after that
// the failure is the caller's to report to the learner.

import type { Curriculum, StoredUnit } from "../../shared/curriculum.ts";
import type { EvidenceEntry } from "../../shared/evidence.ts";
import type { StoredCourse } from "../../shared/library.ts";
import type { Plan } from "../../shared/plan.ts";
import type { TutorBackend } from "../backends/backend.ts";
import type { DataRoot } from "../record/data-root.ts";
import { objectiveStatus } from "../record/status.ts";
import { planUnitTool } from "../tools/plan-unit.ts";
import type { TeachingTool } from "../tools/tool.ts";

export type PlanningResult =
  | { ok: true; plan: Plan }
  | {
      ok: false;
      /**
       * "not-found": no such course or unit. "not-approved": the curriculum
       * is a draft. "failed": two planning sessions ended without a plan.
       */
      problem: "not-found" | "not-approved" | "failed";
      /** Written for the learner. */
      error: string;
    };

export interface UnitPlanner {
  /**
   * The unit's plan: the stored one, or one made now in a planning session.
   * A second call for a unit being planned waits for the same session.
   */
  plan(courseId: string, unitId: string): Promise<PlanningResult>;
}

const ATTEMPTS = 2;

export function createUnitPlanner(options: {
  backend: TutorBackend;
  systemPrompt: string;
  dataRoot: DataRoot;
}): UnitPlanner {
  const { backend, systemPrompt, dataRoot } = options;
  const running = new Map<string, Promise<PlanningResult>>();

  async function planUnit(
    courseId: string,
    unitId: string,
  ): Promise<PlanningResult> {
    const stored = await dataRoot.readCourse(courseId);
    const curriculum = stored?.curriculum ?? undefined;
    const unit = curriculum?.units.find((u) => u.id === unitId);
    if (
      stored === undefined ||
      curriculum === undefined ||
      unit === undefined
    ) {
      return {
        ok: false,
        problem: "not-found",
        error: `There is no unit "${unitId}" in the course "${courseId}".`,
      };
    }
    if (curriculum.approval.status !== "approved") {
      return {
        ok: false,
        problem: "not-approved",
        error: "The curriculum is not approved yet, so its units cannot start.",
      };
    }
    if (unit.plan !== undefined) return { ok: true, plan: unit.plan };

    const evidence = await dataRoot.readEvidence(courseId);
    const background = await dataRoot.readBackground(courseId);
    const context = planningContext(stored, curriculum, unit, evidence);
    let problem: string | undefined;
    for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
      const outcome = await runSession(
        courseId,
        unitId,
        planningTurn(stored, curriculum, unit, {
          context,
          background,
          earlierProblem: problem,
        }),
      );
      if ("plan" in outcome) return { ok: true, plan: outcome.plan };
      problem = outcome.problem;
    }
    return {
      ok: false,
      problem: "failed",
      error: `The tutor could not plan this unit: ${problem} Try starting it again.`,
    };
  }

  /** One planning session: the plan it stored, or what went wrong. */
  async function runSession(
    courseId: string,
    unitId: string,
    text: string,
  ): Promise<{ plan: Plan } | { problem: string }> {
    let plan: Plan | undefined;
    const planUnit = planUnitTool({
      async store(proposed) {
        if (plan !== undefined) {
          return { refused: "The plan is stored already. End your turn." };
        }
        try {
          const course = await dataRoot.storePlan(courseId, unitId, proposed);
          plan = course.curriculum.units.find((u) => u.id === unitId)?.plan;
          return { stored: true };
        } catch (error) {
          return {
            refused: error instanceof Error ? error.message : String(error),
          };
        }
      },
    });
    // The last refusal, whether the input's check or the record refused it.
    let refusal: string | undefined;
    const tool: TeachingTool = {
      ...planUnit,
      async run(input) {
        const result = await planUnit.run(input);
        if (result.status === "refused") refusal = result.text;
        return result;
      },
    };

    let failure: string | undefined;
    try {
      const session = await backend.startSession({
        systemPrompt,
        tools: [tool],
      });
      try {
        for await (const event of session.send({ text })) {
          if (event.type === "turn_end" && event.outcome === "error") {
            failure = event.error ?? "unknown error";
          }
        }
      } finally {
        await session.close();
      }
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    }

    if (plan !== undefined) return { plan };
    if (failure !== undefined) {
      return { problem: `the planning session failed (${failure}).` };
    }
    if (refusal !== undefined) {
      return {
        problem: `the planning session ended with its plan refused: ${refusal}`,
      };
    }
    return { problem: "the planning session ended without a plan." };
  }

  return {
    plan(courseId, unitId) {
      const key = JSON.stringify([courseId, unitId]);
      const underway = running.get(key);
      if (underway !== undefined) return underway;
      const work = planUnit(courseId, unitId).finally(() => {
        running.delete(key);
      });
      running.set(key, work);
      return work;
    },
  };
}

/**
 * The course as the planning session sees it: every unit in order, and for
 * each unit already planned, its objectives and how the learner stands on
 * each (task 2.3).
 */
function planningContext(
  stored: StoredCourse,
  curriculum: Curriculum,
  unit: StoredUnit,
  evidence: readonly EvidenceEntry[],
): string {
  return JSON.stringify({
    course: stored.course.title,
    unitToPlan: unit.id,
    units: curriculum.units.map((u) => ({
      id: u.id,
      title: u.title,
      goal: u.goal,
      prerequisites: u.prerequisites,
      ...(u.plan === undefined
        ? {}
        : {
            objectives: u.plan.objectives.map((o) => ({
              id: o.id,
              statement: o.statement,
              status: objectiveStatus(evidence, o.id),
            })),
          }),
    })),
  });
}

function planningTurn(
  stored: StoredCourse,
  curriculum: Curriculum,
  unit: StoredUnit,
  given: {
    context: string;
    /** The course's background note; a course from before task 2.22 has none. */
    background: string | undefined;
    earlierProblem: string | undefined;
  },
): string {
  const { context, background, earlierProblem } = given;
  const at = curriculum.units.indexOf(unit) + 1;
  const retry =
    earlierProblem === undefined
      ? ""
      : ` An earlier planning session for this unit stored nothing: ${earlierProblem}`;
  return (
    `[Plan unit ${at} of ${curriculum.units.length} of the course ` +
    `"${stored.course.title}": "${unit.title}" (id "${unit.id}"). Allowed ` +
    "now: plan_unit, once the plan is ready. Nobody reads your text or " +
    `answers questions here.${retry}]\n` +
    `${backgroundSection(background)}\n\n` +
    "The curriculum, in order, as JSON. Units already planned list their " +
    "objectives, each with how the learner stands on it.\n" +
    context
  );
}

/** The course's background note (task 2.22), or a line saying none was recorded. */
function backgroundSection(background: string | undefined): string {
  return background === undefined || background.trim() === ""
    ? "No background note was recorded for this course: nothing is known " +
        "about the learner beyond their record."
    : `What the learner told the planner when the course was made:\n${background.trim()}`;
}
