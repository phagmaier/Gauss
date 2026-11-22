// Planning a unit when it starts (brief.md, "How a course runs"; task 2.5).
// A unit without a plan is planned in a backend session of its own, with
// prompts/unit-planner.md, before the tutor's session starts. The session
// gets one turn holding the learner profile (task 5.8), the course's
// background note (task 2.22) and its curriculum, with how the learner stands on each objective planned so far,
// and what earlier units showed (task 5.7): the last handoff notes of the
// unit's prerequisites and the open misconceptions on other units'
// objectives; then, for a unit that names sections, their whole text. It
// stores the plan through plan_unit; then it closes. A session that ends
// without a plan is tried once more, in a new session told why; after that
// the failure is the caller's to report to the learner.

import {
  type Curriculum,
  type StoredUnit,
  unitSections,
} from "../../shared/curriculum.ts";
import type { EvidenceEntry } from "../../shared/evidence.ts";
import type { StoredCourse } from "../../shared/library.ts";
import type { Plan } from "../../shared/plan.ts";
import { sectionsByRef } from "../../shared/source.ts";
import type { TutorBackend } from "../backends/backend.ts";
import { type DataRoot, PlanSectionsChanged } from "../record/data-root.ts";
import { objectiveStatus } from "../record/status.ts";
import { planUnitTool } from "../tools/plan-unit.ts";
import type { TeachingTool } from "../tools/tool.ts";
import { type EarlierUnits, earlierText, readEarlier } from "./handoff.ts";
import { placeText } from "./source-text.ts";

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
    let problem: string | undefined;
    for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
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
          error:
            "The curriculum is not approved yet, so its units cannot start.",
        };
      }
      if (unit.plan !== undefined) return { ok: true, plan: unit.plan };

      const [evidence, background, profile, misconceptions] = await Promise.all(
        [
          dataRoot.readEvidence(courseId),
          dataRoot.readBackground(courseId),
          dataRoot.readProfile(),
          dataRoot.readMisconceptions(courseId),
        ],
      );
      const context = planningContext(stored, curriculum, unit, evidence);
      const earlier = await readEarlier(
        dataRoot,
        courseId,
        curriculum.units,
        unitId,
        evidence,
        misconceptions,
      );
      const refs = unitSections(unit);
      const text = await unitText(dataRoot, courseId, unitId, refs);
      const outcome = await runSession(
        courseId,
        unitId,
        refs,
        planningTurn(stored, curriculum, unit, {
          context,
          background,
          profile,
          earlier,
          text,
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
    refs: readonly string[],
    text: string,
  ): Promise<{ plan: Plan } | { problem: string }> {
    let plan: Plan | undefined;
    let sectionsChanged: string | undefined;
    const planUnit = planUnitTool({
      async store(proposed) {
        if (plan !== undefined) {
          return { refused: "The plan is stored already. End your turn." };
        }
        if (sectionsChanged !== undefined) return { refused: sectionsChanged };
        try {
          const course = await dataRoot.storePlan(
            courseId,
            unitId,
            proposed,
            refs,
          );
          plan = course.curriculum.units.find((u) => u.id === unitId)?.plan;
          return { stored: true };
        } catch (error) {
          if (error instanceof PlanSectionsChanged) {
            sectionsChanged = error.message;
            return {
              refused: `${sectionsChanged} End your turn; your copy of the text is out of date.`,
            };
          }
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
          if (sectionsChanged !== undefined) break;
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
    if (sectionsChanged !== undefined) return { problem: sectionsChanged };
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
      ...(unitSections(u).length === 0 ? {} : { sections: u.sections }),
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

/**
 * The sections the unit names, whole, each in a tag with its id, title and
 * place, in the unit's order; none for a unit that names none. Throws when a
 * section cannot be read: a plan made without its text would not be one.
 */
async function unitText(
  dataRoot: DataRoot,
  courseId: string,
  unitId: string,
  refs: readonly string[],
): Promise<string | undefined> {
  if (refs.length === 0) return undefined;
  const byRef = sectionsByRef(await dataRoot.readSources(courseId));
  const tags = await Promise.all(
    refs.map(async (ref) => {
      const found = byRef.get(ref);
      const text = await dataRoot.readSection(courseId, ref);
      if (found === undefined || text === undefined) {
        throw new Error(
          `Unit "${unitId}" names the section "${ref}", which the course's sources do not have.`,
        );
      }
      return (
        `<section id=${JSON.stringify(ref)} ` +
        `title=${JSON.stringify(found.section.title)} ` +
        `place=${JSON.stringify(placeText(found.section.place, found.source))}>\n` +
        `${text.replace(/\n$/, "")}\n</section>`
      );
    }),
  );
  return tags.join("\n\n");
}

function planningTurn(
  stored: StoredCourse,
  curriculum: Curriculum,
  unit: StoredUnit,
  given: {
    context: string;
    /** The course's background note; a course from before task 2.22 has none. */
    background: string | undefined;
    /** The learner profile (task 5.8); none until one is approved or written. */
    profile: string | undefined;
    earlier: EarlierUnits;
    /** The unit's sections, whole; none for a unit that names none. */
    text: string | undefined;
    earlierProblem: string | undefined;
  },
): string {
  const { context, background, profile, text, earlierProblem } = given;
  const earlier = earlierText(given.earlier);
  const at = curriculum.units.indexOf(unit) + 1;
  const retry =
    earlierProblem === undefined
      ? ""
      : ` An earlier planning session for this unit stored nothing: ${earlierProblem}`;
  const reads =
    text === undefined
      ? ""
      : ' Last, under "# The unit\'s text", the sections it teaches, whole: ' +
        "name in each segment those it draws on.";
  return (
    `[Plan unit ${at} of ${curriculum.units.length} of the course ` +
    `"${stored.course.title}": "${unit.title}" (id "${unit.id}"). Allowed ` +
    "now: plan_unit, once the plan is ready. Nobody reads your text or " +
    `answers questions here.${reads}${retry}]\n` +
    `# The learner\n\n${learnerSection(profile, background)}\n\n` +
    "The curriculum, in order, as JSON. Units already planned list their " +
    "objectives, each with how the learner stands on it.\n" +
    context +
    (earlier === undefined
      ? ""
      : `\n\n# What earlier units showed\n\n${earlier}`) +
    (text === undefined ? "" : `\n\n# The unit's text\n\n${text}`)
  );
}

/**
 * The learner profile (task 5.8), when there is one, then the course's
 * background note (task 2.22), or a line saying none was recorded.
 */
function learnerSection(
  profile: string | undefined,
  background: string | undefined,
): string {
  const kept = profile?.trim();
  return [
    ...(kept === undefined || kept === ""
      ? []
      : [
          "The learner's profile, which holds across their courses:\n" +
            `<learner_profile>\n${kept}\n</learner_profile>`,
        ]),
    background === undefined || background.trim() === ""
      ? kept === undefined || kept === ""
        ? "No background note was recorded for this course: nothing is " +
          "known about the learner beyond their record."
        : "No background note was recorded for this course."
      : `What the learner told the planner when the course was made:\n${background.trim()}`,
  ].join("\n\n");
}
