// The plan_unit teaching tool. A unit's planning session
// (src/server/engine/unit-planning.ts) sends the unit's objectives
// and the segments that teach them, and the engine stores them on the unit.
// Storing ends the turn, which ends the planning. A plan that the schema or
// the record refuses goes back with the reasons, so the session can fix it.

import { Plan } from "../../shared/plan.ts";
import { defineTool, type TeachingTool } from "./tool.ts";

/** Where the plan of the unit being planned goes. The engine provides it. */
export interface PlanStore {
  store(plan: Plan): Promise<{ stored: true } | { refused: string }>;
}

export function planUnitTool(store: PlanStore): TeachingTool {
  return defineTool({
    name: "plan_unit",
    description:
      "Store the plan of the unit you are planning: its objectives, and the " +
      "segments that teach them, in order. Storing ends your turn and the " +
      "planning. If the plan is refused, the reasons say what to fix: fix " +
      "it and call this again with the whole plan.",
    input: Plan,
    async run(plan) {
      const result = await store.store(plan);
      if ("refused" in result) {
        return { status: "refused", text: result.refused };
      }
      return {
        status: "done",
        text: "Stored. The planning is over; end your turn.",
        endTurn: true,
      };
    },
  });
}
