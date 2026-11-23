// The amend_curriculum teaching tool (task 5.12): the tutor proposes the
// whole revised unit list of the course, as
// propose_curriculum does, with a line on why, and the learner sees it on a
// card with Apply and "Keep the current one". Whether one may be proposed
// now (not while a question is open, not while another proposal waits, not
// dropping a unit that has started) is the engine's rule, so that refusal
// comes from the desk with its reason. The tutor's proposal does not end its
// turn; the learner's answer comes in its next header. The course's planner
// has its own (planCurriculumChangeTool), whose proposal ends its turn.

import { CurriculumChangeInput } from "../../shared/curriculum-change.ts";
import { defineTool, type TeachingTool } from "./tool.ts";

/** Where proposed curriculum changes go. The engine provides it. */
export interface CurriculumDesk {
  /** Shows the proposal to the learner, or says why not; given the turn's stop signal, a stopped turn shows nothing. */
  propose(
    input: CurriculumChangeInput,
    signal?: AbortSignal,
  ): Promise<{ proposed: true } | { refused: string }>;
}

export function amendCurriculumTool(desk: CurriculumDesk): TeachingTool {
  return defineTool({
    name: "amend_curriculum",
    description:
      "Propose a change to this course's curriculum, the units listed in " +
      "your instructions: give the whole revised list of units, each with " +
      "its id, title, goal, the units it builds on and the sections it " +
      "reads, if any, as the curriculum would be, and a line on why. Keep " +
      "every unit you do not change as it is, with its id. The learner sees " +
      "a card with the changes marked and " +
      'presses Apply or "Keep the current one". Nothing changes until they ' +
      "apply it. Refused if it drops a unit the learner has started or " +
      "finished, or changes its id, while a question is open, and while " +
      "another proposal waits. Your turn goes on after it; the learner's " +
      "answer comes in a later header.",
    input: CurriculumChangeInput,
    async run(input, signal) {
      const asked = await desk.propose(input, signal);
      if ("refused" in asked) return { status: "refused", text: asked.refused };
      return {
        status: "done",
        text:
          "The learner sees your proposal on a card. Until a header says they " +
          "applied it, the curriculum is as it was. Say in a sentence what " +
          "the change would do, then go on with your reply.",
      };
    },
  });
}

/**
 * The planner's amend_curriculum, in the course's planning conversation
 * (task 5.38): the same proposal and card, but posting ends the planner's
 * turn, as propose_curriculum does in the intake, so the card comes last,
 * and a new proposal replaces the one waiting.
 */
export function planCurriculumChangeTool(desk: CurriculumDesk): TeachingTool {
  return defineTool({
    name: "amend_curriculum",
    description:
      "Propose a change to this course's curriculum, the units given in " +
      "<course>: give the whole revised list of units, each with its id, " +
      "title, goal, the units it builds on and the sections it reads, if " +
      "any, as the curriculum would be, and a line on why. Keep every unit " +
      "you do not change as it is, with its id. The learner sees a card " +
      "with the changes marked and presses " +
      'Apply or "Keep the current one". Nothing changes until they apply ' +
      "it. A new proposal replaces the one waiting. Refused if it drops a " +
      "unit the learner has started or finished, or changes its id, if it " +
      "changes nothing, and while a proposal made in a unit's chat waits. " +
      "Posting ends your turn, so say what you want to say before calling " +
      "this.",
    input: CurriculumChangeInput,
    async run(input, signal) {
      const asked = await desk.propose(input, signal);
      if ("refused" in asked) return { status: "refused", text: asked.refused };
      return {
        status: "done",
        text:
          "The learner sees your proposal on a card. Your turn is over; " +
          "their answer or reply comes in the next message.",
        endTurn: true,
      };
    },
  });
}
