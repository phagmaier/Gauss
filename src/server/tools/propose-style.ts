// The propose_style teaching tool (task 5.11): the tutor proposes the
// whole revised style note of the course, with a line
// on why, and the learner sees it on a card with Apply and "Keep the current
// one". Whether one may be proposed now (not while a question is open, not
// while another proposal waits) is the engine's rule, so that refusal comes
// from the desk with its reason. The proposal does not end the tutor's turn;
// the learner's answer comes in its next header.

import { StyleInput } from "../../shared/style.ts";
import { defineTool, type TeachingTool } from "./tool.ts";

/** Where proposals to change the style note go. The engine provides it. */
export interface StyleDesk {
  /** Shows the proposal to the learner, or says why not. */
  propose(input: StyleInput): Promise<{ proposed: true } | { refused: string }>;
}

export function proposeStyleTool(desk: StyleDesk): TeachingTool {
  return defineTool({
    name: "propose_style",
    description:
      "Propose a change to this course's style note, the note at the end of " +
      "your instructions: give the whole revised note and a line on why. The " +
      "learner sees a card with the changes marked and presses Apply or " +
      '"Keep the current one". Nothing changes until they apply it. Refused ' +
      "while a question is open and while another proposal waits. Your turn " +
      "goes on after it; the learner's answer comes in a later header.",
    input: StyleInput,
    async run(input) {
      const asked = await desk.propose(input);
      if ("refused" in asked) return { status: "refused", text: asked.refused };
      return {
        status: "done",
        text:
          "The learner sees your proposal on a card. Until a header says they " +
          "applied it, teach to the current note. Say in a sentence what the " +
          "change would do, then go on with your reply.",
      };
    },
  });
}
