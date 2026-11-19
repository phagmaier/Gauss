// The propose_curriculum teaching tool (architecture.md section 5). The tutor
// sends the whole curriculum each time, with its style note (task 2.10),
// background note (task 2.22) and the learner profile (task 5.8); the intake
// stores it as the draft and shows it to the learner as a card.
// Posting ends the tutor's turn, so the card is the last thing in it, and
// the learner's reply arrives as the next turn. An invalid curriculum is
// refused with the schema's reasons.

import { PlannerProposal } from "../../shared/curriculum.ts";
import { defineTool, type TeachingTool } from "./tool.ts";

/** Where proposals are kept and shown. The intake provides it. */
export interface CurriculumBoard {
  /** Stores and shows the proposal; its revision number, or why not. */
  propose(
    proposal: PlannerProposal,
  ): Promise<{ revision: number } | { refused: string }>;
}

export function proposeCurriculumTool(board: CurriculumBoard): TeachingTool {
  return defineTool({
    name: "propose_curriculum",
    description:
      "Propose the course's curriculum: its title, its units, each with " +
      "one goal and the units it builds on, a short note on how you would " +
      "teach it, a short note on what the learner told you about " +
      "themselves for this course, and the learner's profile, which holds " +
      "across their courses. It appears to the learner as a card with an " +
      "Approve button, which saves the profile too. Posting ends your " +
      "turn, so say anything you want to say before calling this. To " +
      "revise, call it again with the whole revised curriculum, notes and " +
      "profile; it replaces the one before. Keep the id of every unit you " +
      "keep.",
    input: PlannerProposal,
    async run(proposal) {
      const result = await board.propose(proposal);
      if ("refused" in result) {
        return { status: "refused", text: result.refused };
      }
      return {
        status: "done",
        text:
          `Posted as proposal ${result.revision}. Your turn is over; the ` +
          "learner's reply will arrive in the next message.",
        endTurn: true,
      };
    },
  });
}
