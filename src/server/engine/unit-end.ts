// When the unit's last segment closes, the unit ends, in three steps (task
// 5.5): with objectives not passed, the closing card, where the learner
// goes over them again in one more segment, or moves on without them, which
// records them as overridden; then the unit's gate, offered once on a card,
// an assessment over its objectives passed and not yet retained and a few
// of other units' (`pickForGate`), which the learner starts or skips; last,
// the closing card again, with the statuses as they now are. If the gate
// left objectives of the unit not passed, it offers the same two steps, and
// going over them again brings no second gate; otherwise the unit is
// finished and out of state.json. A unit whose gate has nothing to ask
// finishes without it.

// Made for each loaded unit. The chat keeps the queue and the actions' guards.

import { randomUUID } from "node:crypto";
import type { Slug } from "../../shared/course.ts";
import type { PageEvent } from "../../shared/events.ts";
import type { EvidenceEntry } from "../../shared/evidence.ts";
import type { StoredCourse } from "../../shared/library.ts";
import type { Misconception } from "../../shared/misconception.ts";
import type { AssessmentRun } from "../../shared/state.ts";
import { pickForGate, type ReviewPick } from "../record/review.ts";
import { objectiveStatus } from "../record/status.ts";
import { isLastSegment, notPassed, toGoOver } from "./check-rules.ts";
import type { ChatResult } from "./conversation.ts";
import type { UnitRecord } from "./unit-record.ts";
import type { UnitContext } from "./unit-turns.ts";

export interface UnitEnd {
  /** Shows or advances the unit's end. Runs inside the chat's queue. */
  end(closedNow?: boolean): Promise<void>;
  /** The body of the chat's goOverAgain, inside its guard. */
  goOverAgain(): Promise<ChatResult>;
  /** The body of the chat's finishUnit, inside its guard. */
  finishUnit(finishId: string): Promise<ChatResult>;
}

export function createUnitEnd({
  record,
  context,
  setUnits,
  setMisconceptions,
  emit,
  showRun,
  sendTeaching,
  runWaits,
  readCourse,
  readEvidence,
  readMisconceptions,
  now,
  unitId,
}: {
  record: Pick<
    UnitRecord,
    | "position"
    | "evidence"
    | "move"
    | "moveOn"
    | "finish"
    | "offerAssessment"
    | "objectiveStatuses"
  >;
  context(): Pick<UnitContext, "plan" | "units">;
  setUnits(units: UnitContext["units"]): void;
  setMisconceptions(misconceptions: Misconception[]): void;
  emit(event: PageEvent): void;
  showRun(run: AssessmentRun): void;
  sendTeaching(cutOff: boolean): void;
  runWaits(): ChatResult | undefined;
  readCourse(): Promise<StoredCourse | undefined>;
  readEvidence(): Promise<EvidenceEntry[]>;
  readMisconceptions(): Promise<Misconception[]>;
  now(): Date;
  unitId: Slug;
}): UnitEnd {
  /** The standing closing card's action and what the learner confirms with it. */
  let finishAction:
    | { id: string; objectives: string[]; gateFollows: boolean }
    | undefined;

  /**
   * The last segment has closed (`closedNow`), or the unit's end is shown
   * again with the statuses as they now are. Before the gate: the closing
   * card while objectives are not passed; once every one has passed, the
   * gate's card, or the unit's finish if it has nothing to ask, after the
   * card shown again if one stands. After the gate: the closing card with
   * what the gate asked, which finishes the unit unless the gate left
   * objectives of it not passed. Runs inside `exclusive`.
   */
  async function end(closedNow = false): Promise<void> {
    if (record.position.pendingMoveOn !== undefined) {
      await moveOnAtEnd();
      return;
    }
    if (record.position.gated === true) {
      await closeAfterGate();
      return;
    }
    const rest = notPassed(context().plan, record.evidence);
    const passed = rest.length === 0;
    // Every objective passed as the last segment closed: the gate's card,
    // or the finish, comes with no closing card before it.
    if (!passed || !closedNow) {
      const follows = !passed && (await gatePicks()).length > 0;
      showClosingCard(passed, rest, follows);
    }
    if (passed) await gateOrFinish(!closedNow);
  }

  /** Keep the move-on action while its scope and destination are unchanged. */
  function showClosingCard(
    passed: boolean,
    rest: string[],
    gateFollows: boolean,
    gate?: Extract<PageEvent, { type: "unit_end" }>["gate"],
  ): void {
    const was = finishAction;
    if (rest.length === 0) {
      finishAction = undefined;
    } else if (
      was === undefined ||
      was.gateFollows !== gateFollows ||
      !sameObjectives(was.objectives, rest)
    ) {
      finishAction = { id: randomUUID(), objectives: rest, gateFollows };
    }
    emit({
      type: "unit_end",
      passed,
      objectives: record.objectiveStatuses(),
      ...(gate === undefined ? {} : { gate }),
      ...(gateFollows ? { gateFollows: true } : {}),
      ...(finishAction === undefined ? {} : { finishId: finishAction.id }),
    });
  }

  /**
   * Offers the gate if it is due and has something to ask; otherwise
   * finishes the unit. `shown` means a closing card already stands.
   * `tell` acknowledges a move-on; `gate` is its confirmed pick, if one
   * was kept (including an empty pick to finish without the gate).
   * Runs inside `exclusive`.
   */
  async function gateOrFinish(
    shown: boolean,
    { tell, gate }: { tell?: () => void; gate?: ReviewPick[] | undefined } = {},
  ): Promise<void> {
    if (record.position.gated !== true && (await offerGate(gate, tell))) {
      return;
    }
    const passed = notPassed(context().plan, record.evidence).length === 0;
    if (passed && !shown) {
      emit({
        type: "unit_end",
        passed,
        objectives: record.objectiveStatuses(),
      });
    }
    await record.finish(passed ? "passed" : "overridden", { tell });
  }

  async function gateRecord() {
    const [stored, evidence] = await Promise.all([
      readCourse(),
      readEvidence(),
    ]);
    return { units: stored?.curriculum?.units ?? context().units, evidence };
  }

  async function gatePicks(): Promise<ReviewPick[]> {
    const { units, evidence } = await gateRecord();
    return pickForGate(units, unitId, evidence, now());
  }

  /**
   * Offers the gate on its confirmed questions, or picks them when no
   * closing-card choice preceded it. Reads current evidence for the run,
   * not to re-decide an accepted move-on. Runs inside `exclusive`.
   */
  async function offerGate(
    gate: ReviewPick[] | undefined,
    tell?: () => void,
  ): Promise<boolean> {
    if (gate?.length === 0) return false;
    const [{ units, evidence }, misconceptions] = await Promise.all([
      gateRecord(),
      readMisconceptions(),
    ]);
    const objectives = gate ?? pickForGate(units, unitId, evidence, now());
    setMisconceptions(misconceptions);
    if (objectives.length === 0) return false;
    setUnits(units);
    const run: AssessmentRun = { mode: "gate", stage: "offered", objectives };
    await record.offerAssessment(run, evidence, () => {
      tell?.();
      showRun(run);
    });
    return true;
  }

  /**
   * The closing card after the gate, or after it was skipped: each
   * objective's status, and the other units' objectives the gate asked,
   * with theirs. The unit finishes unless the gate left objectives of it
   * not passed, which the card's steps then cover. Runs inside `exclusive`.
   */
  async function closeAfterGate(): Promise<void> {
    const { plan } = context();
    const { evidence } = record;
    const goOver = toGoOver(plan, evidence, true);
    const passed = notPassed(plan, evidence).length === 0;
    showClosingCard(passed, goOver, false, {
      goOver,
      others: gateOthers(),
    });
    if (goOver.length === 0) {
      await record.finish(passed ? "passed" : "overridden");
    }
  }

  /**
   * The other units' objectives the unit's gate asked, in its order, each
   * with its unit and its status now. Includes a question shown before a
   * skip even when no answer was recorded.
   */
  function gateOthers() {
    const { plan, units } = context();
    const own = new Set(plan.objectives.map((o) => o.id));
    const asked: string[] = [];
    for (const entry of record.evidence) {
      if (
        entry.kind === "answer" &&
        entry.assessment?.mode === "gate" &&
        entry.assessment.unit === unitId &&
        !own.has(entry.objective) &&
        !asked.includes(entry.objective)
      ) {
        asked.push(entry.objective);
      }
    }
    const withdrawn = record.position.gateUnanswered;
    const unanswered =
      withdrawn !== undefined && !asked.includes(withdrawn)
        ? withdrawn
        : undefined;
    if (unanswered !== undefined) asked.push(unanswered);
    return asked.flatMap((objective) => {
      const at = units.findIndex((u) =>
        u.plan?.objectives.some((o) => o.id === objective),
      );
      const unit = units[at];
      const statement = unit?.plan?.objectives.find(
        (o) => o.id === objective,
      )?.statement;
      if (unit === undefined || statement === undefined) return [];
      return [
        {
          objective,
          statement,
          unit: { number: at + 1, title: unit.title },
          status: objectiveStatus(record.evidence, objective),
          ...(objective === unanswered ? { unanswered: true as const } : {}),
        },
      ];
    });
  }

  /**
   * At the unit's end, the objectives the closing card's steps cover: those
   * not passed, or after the gate those it left not passed. Or why there
   * are none.
   */
  function atUnitEnd(): string[] | string {
    const { position, evidence } = record;
    if (
      position.phase !== "closed" ||
      !isLastSegment(context().plan, position)
    ) {
      return "The unit has not reached its end.";
    }
    const rest = toGoOver(context().plan, evidence, position.gated === true);
    return rest.length > 0 ? rest : "Every objective has passed.";
  }

  /** Completes a new or interrupted move-on, telling the page once it can advance. */
  async function moveOnAtEnd(action?: {
    objectives: string[];
    gate: ReviewPick[];
  }): Promise<void> {
    const { objectives, gate } = await record.moveOn(action);
    await gateOrFinish(true, {
      gate,
      tell: () => emit({ type: "moved_on", objectives }),
    });
    finishAction = undefined;
  }

  async function goOverAgain(): Promise<ChatResult> {
    const waits = runWaits();
    if (waits !== undefined) return waits;
    if (record.position.pendingMoveOn !== undefined) {
      return refused(
        "Choose Move on again to finish the step already started.",
      );
    }
    const again = atUnitEnd();
    if (typeof again === "string") return refused(again);
    await record.move({
      segment: context().plan.segments.length,
      phase: "teach",
      again,
    });
    finishAction = undefined;
    sendTeaching(false);
    return { ok: true };
  }

  async function finishUnit(finishId: string): Promise<ChatResult> {
    const waits = runWaits();
    if (waits !== undefined) return waits;
    const pending = record.position.pendingMoveOn;
    const objectives = pending?.objectives ?? atUnitEnd();
    if (typeof objectives === "string") return refused(objectives);
    const action = finishAction;
    if (action?.id !== finishId) {
      return refused("The closing card changed. Confirm its current step.");
    }
    if (pending !== undefined) {
      await moveOnAtEnd();
      return { ok: true };
    }
    const gated = record.position.gated === true;
    const gate = gated ? [] : await gatePicks();
    const follows = gate.length > 0;
    if (!sameObjectives(action.objectives, objectives)) {
      showClosingCard(
        false,
        objectives,
        follows,
        gated ? { goOver: objectives, others: gateOthers() } : undefined,
      );
      return refused("The closing card changed. Confirm its current step.");
    }
    if (follows !== action.gateFollows) {
      showClosingCard(false, objectives, follows);
      return refused(
        follows
          ? "The unit gate now has questions to ask, so it comes next if you move on. The card is shown again."
          : "The unit gate has nothing to ask now, so moving on finishes the unit. The card is shown again.",
      );
    }
    await moveOnAtEnd({ objectives, gate });
    return { ok: true };
  }

  return { end, goOverAgain, finishUnit };
}

export function sameObjectives(
  left: readonly string[],
  right: readonly string[],
) {
  return left.length === right.length && left.every((id, i) => id === right[i]);
}

function refused(error: string): ChatResult {
  return { ok: false, status: 409, error };
}
