// The install_packages teaching tool (task 3.11): the tutor names the
// Python packages a course's code needs, and the learner
// is asked, on a card, to install them into the course's workspace. Whether a
// request may be made now (not while a question is open, not while another
// waits) is the engine's rule, so that refusal comes from the desk with its
// reason. The request does not end the tutor's turn; the learner's answer
// comes in a message of its own.

import { type PackageSpec, PackagesInput } from "../../shared/packages.ts";
import { defineTool, type TeachingTool } from "./tool.ts";

/** Where requests to install packages go. The engine provides it. */
export interface PackageDesk {
  /** Shows the request to the learner, or says why not. */
  request(
    packages: readonly PackageSpec[],
  ): Promise<{ requested: true } | { refused: string }>;
}

export function installPackagesTool(desk: PackageDesk): TeachingTool {
  return defineTool({
    name: "install_packages",
    description:
      "Ask the learner to install Python packages from PyPI into the " +
      "course's workspace, for code they or you run there: name each " +
      "package, with a version range if it matters. The learner sees a " +
      "card with the packages and presses Install or Not now; the app " +
      "then runs uv itself. Only wheels are installed. Refused while a " +
      "question is open and while another request waits. Your turn goes " +
      "on after it; the learner's answer comes in a message of its own.",
    input: PackagesInput,
    async run({ packages }) {
      const asked = await desk.request(packages);
      if ("refused" in asked) return { status: "refused", text: asked.refused };
      return {
        status: "done",
        text:
          "The learner sees your request on a card. The packages are not " +
          "installed until they press Install, so do not use them yet. Say " +
          "in a sentence what they are for, then end your reply.",
      };
    },
  });
}
