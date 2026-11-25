// The pass_over_objective teaching tool: in a self-test, the tutor passes
// over the objective it asks next when no kind of question the learner
// picked fits it (docs/brief.md, "Assessment modes"), saying why. Nothing is
// recorded on the objective; the thread shows the reason, and the self-test
// asks its next objective, or ends, in a message of its own, so passing over
// ends the tutor's turn. Whether it may pass over now (a self-test under
// way, nothing open, the objective asked next) is the engine's rule, so a
// refusal comes from the desk with its reason.

import { PassOverInput } from "../../shared/self-test.ts";
import { defineTool, type TeachingTool } from "./tool.ts";

/** Where a self-test keeps what it passed over. The engine provides it. */
export interface PassOverDesk {
  /** Keeps the objective as passed over and moves the self-test on, or says why not; answers the objective asked next, if any. */
  passOver(
    passed: PassOverInput,
  ): Promise<{ next: string | undefined } | { refused: string }>;
}

export function passOverObjectiveTool(desk: PassOverDesk): TeachingTool {
  return defineTool({
    name: "pass_over_objective",
    description:
      "In a self-test only: pass over the objective the self-test asks " +
      "next, when no kind of question the learner picked fits it (a proof " +
      "objective when they picked only choice questions, say). Give the " +
      "reason; the learner sees it. Nothing is recorded on the objective. " +
      "Refused outside a self-test, while a question or a detour is open, " +
      "and for any objective but the one asked next. Passing over ends " +
      "your turn.",
    input: PassOverInput,
    async run(passed) {
      const result = await desk.passOver(passed);
      if ("refused" in result) {
        return { status: "refused", text: result.refused };
      }
      return {
        status: "done",
        text:
          `Passed over "${passed.objective}". ` +
          (result.next === undefined
            ? "It was the self-test's last objective, and the self-test is over. "
            : "The app asks for the next question in a message of its own. ") +
          "Your turn is over.",
        endTurn: true,
      };
    },
  });
}
