// The close_segment teaching tool (architecture.md section 5). The tutor
// closes the segment once its check is done; the engine refuses it before
// then, with the reason (task 2.6). Closing ends the tutor's turn, so its
// feedback on the last answer comes first, and the learner then starts the
// next segment.

import { z } from "zod";
import { defineTool, type TeachingTool } from "./tool.ts";

/** Closes the segment in progress, or says why not. The engine provides it. */
export interface SegmentCloser {
  close(): Promise<{ closed: true } | { refused: string }>;
}

export function closeSegmentTool(closer: SegmentCloser): TeachingTool {
  return defineTool({
    name: "close_segment",
    description:
      "Close the segment once its check is done: every objective of the " +
      "segment has an answer from this check. It is refused before then, " +
      "with the reason. Closing ends your turn, so give your feedback on " +
      "the last answer first. The learner starts the next segment.",
    input: z.object({}),
    async run() {
      const result = await closer.close();
      if ("refused" in result) {
        return { status: "refused", text: result.refused };
      }
      return {
        status: "done",
        text: "The segment is closed. Your turn is over.",
        endTurn: true,
      };
    },
  });
}
