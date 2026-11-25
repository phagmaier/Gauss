// Admits review, and a self-test the learner sets up, to one unit chat.
// Owns the held offer and the message barrier; uses the chat's queue,
// record and assessment lifecycle.

import type { StoredUnit } from "../../shared/curriculum.ts";
import type { EvidenceEntry } from "../../shared/evidence.ts";
import type { Plan } from "../../shared/plan.ts";
import type { AssessmentRun } from "../../shared/state.ts";
import { pickForReview, type ReviewPick } from "../record/review.ts";
import { isLastSegment } from "./check-rules.ts";
import type { ChatResult } from "./conversation.ts";
import type { SelfTestSetUp, UnitRecord } from "./unit-record.ts";
import { runWaitsText } from "./unit-turns.ts";

interface OfferContext {
  units: readonly StoredUnit[];
  evidence: readonly EvidenceEntry[];
}

export interface ReviewAdmission {
  sittingOpened(): Promise<void>;
  /** Inside the chat queue; rechecks the offer after the tutor settles. */
  segmentClosed(last: boolean): void;
  /** Inside the chat queue; the requested pick has already chosen this thread. */
  request(objectives: ReviewPick[] | undefined): Promise<ChatResult>;
  /**
   * Inside the chat queue; the self-test's pick has already chosen this
   * thread. Refused for Review now's reasons, but a review card offered
   * here, as opening the thread can offer one, gives way to it, as it does
   * to a message: it is withdrawn, and what it held waits on the self-test.
   */
  selfTest(setUp: SelfTestSetUp): Promise<ChatResult>;
  sendMessage(send: () => void): void;
  settled(): Promise<void> | undefined;
}

export function createReviewAdmission({
  record,
  plan,
  tutor,
  exclusive,
  now,
  count,
  closing,
  feedbackPending,
  installing,
  unsavedInstall,
  overridePending,
  readOfferContext,
  markOffered,
  saveOffer,
  start,
  skip,
  withdrawCard,
  startSelfTest,
}: {
  record: Pick<UnitRecord, "position" | "finished">;
  plan: Plan;
  tutor: { busy(): boolean; settled(): Promise<void> };
  exclusive<T>(work: () => Promise<T>): Promise<T>;
  now(): Date;
  count: number;
  closing(): boolean;
  feedbackPending(): boolean;
  installing(): boolean;
  unsavedInstall(): string | undefined;
  overridePending: string;
  readOfferContext(): Promise<OfferContext>;
  markOffered(at: Date, options?: { requested: true }): Promise<boolean>;
  saveOffer(run: AssessmentRun, context: OfferContext): Promise<void>;
  start(run: AssessmentRun): Promise<void>;
  skip(): Promise<void>;
  /** Takes the card offered out, with nothing else moving on. */
  withdrawCard(): Promise<void>;
  startSelfTest(setUp: SelfTestSetUp, context: OfferContext): Promise<void>;
}): ReviewAdmission {
  let held = false;
  let offering = false;
  let heldOffer: Promise<void> | undefined;

  function reviewOffered(): boolean {
    const run = record.position.assessment;
    return run?.mode === "review" && run.stage === "offered";
  }

  async function offer(): Promise<void> {
    const { position, finished } = record;
    if (
      closing() ||
      finished !== undefined ||
      position.assessment !== undefined
    ) {
      return;
    }
    if (position.phase === "discuss" || position.phase === "check") {
      held = true;
      return;
    }
    if (
      feedbackPending() ||
      tutor.busy() ||
      position.openQuestion !== undefined ||
      position.detour !== undefined ||
      position.packageRequest !== undefined ||
      position.styleProposal !== undefined ||
      position.curriculumChange !== undefined ||
      unsavedInstall() !== undefined ||
      position.testOut?.stage === "result" ||
      (position.phase === "closed" && isLastSegment(plan, position))
    ) {
      return;
    }
    held = false;
    offering = true;
    try {
      const at = now();
      const context = await readOfferContext();
      const objectives = pickForReview(context.units, context.evidence, {
        at,
        count,
        leaveOut: [],
      });
      if (objectives.length === 0) return;
      // Claim the course's cooldown before saving and showing the card.
      if (!(await markOffered(at))) return;
      await saveOffer(
        { mode: "review", stage: "offered", objectives },
        context,
      );
    } catch (error) {
      offerFailed(error);
    } finally {
      offering = false;
    }
  }

  /**
   * Why the learner cannot start a run here now, if they cannot.
   * `cardGivesWay`: a review card offered is no reason.
   */
  function requestBlocker(cardGivesWay = false): string | undefined {
    const { position, finished } = record;
    if (position.pendingSegmentOverride !== undefined) return overridePending;
    if (tutor.busy() || feedbackPending()) {
      return "The tutor is writing. Wait until it has finished, or stop it.";
    }
    const run = position.assessment;
    if (run !== undefined && !(cardGivesWay && reviewOffered())) {
      return runWaitsText(run);
    }
    if (finished !== undefined) return undefined;
    if (position.testOut?.stage === "result") {
      return "Answer the test's result card first.";
    }
    if (position.openQuestion !== undefined) {
      return `Question ${position.openQuestion.number} is open: answer it first.`;
    }
    if (position.detour !== undefined) {
      return `A detour is open after question ${position.detour.number}: end it first.`;
    }
    if (position.packageRequest !== undefined) {
      return "A request to install packages waits for your answer.";
    }
    if (position.styleProposal !== undefined) {
      return "A proposed style note waits for your answer.";
    }
    if (position.curriculumChange !== undefined) {
      return "A proposed curriculum change waits for your answer.";
    }
    if (position.phase === "closed" && isLastSegment(plan, position)) {
      return "The unit's closing card waits for you.";
    }
    return undefined;
  }

  /** Why nothing can start while packages install, or an install's result is unsaved. */
  function installBlocked(): string | undefined {
    return installing()
      ? "Packages are being installed. Wait until the install finishes."
      : unsavedInstall();
  }

  function sittingOpened(): Promise<void> {
    return exclusive(offer);
  }

  return {
    sittingOpened,
    segmentClosed(last) {
      if (!held) return;
      if (last) {
        held = false;
        return;
      }
      heldOffer = tutor.settled().then(sittingOpened).catch(offerFailed);
    },
    async request(objectives) {
      const run = record.position.assessment;
      let offered = run?.mode === "review" ? run : undefined;
      if (offered?.stage === "on") return { ok: true };
      const installBlocker = installBlocked();
      if (installBlocker !== undefined) return refused(installBlocker);
      if (offered === undefined) {
        const blocker = requestBlocker();
        if (blocker !== undefined) return refused(blocker);
        if (objectives === undefined) {
          return refused("That review has already ended.");
        }
        // Refresh the context, not the pick that chose the thread.
        const context = await readOfferContext();
        offered = { mode: "review", stage: "offered", objectives };
        await saveOffer(offered, context);
      }
      await start(offered);
      held = false;
      // Unlike an automatic offer, Review now refreshes the cooldown after
      // saving and showing the start and queuing its first tutor turn.
      await markOffered(now(), { requested: true });
      return { ok: true };
    },
    async selfTest(setUp) {
      const blocker = installBlocked() ?? requestBlocker(true);
      if (blocker !== undefined) return refused(blocker);
      if (reviewOffered()) await withdrawCard();
      // A review held for the segment's close stays held: the self-test's
      // scope is the learner's, not what is due.
      await startSelfTest(setUp, await readOfferContext());
      return { ok: true };
    },
    sendMessage(send) {
      if (!offering && !reviewOffered()) {
        send();
        return;
      }
      // Wait for any in-flight automatic offer to land. Skip only a review
      // card, not a gate; teaching that waited is queued before this message.
      void exclusive(async () => {
        try {
          if (reviewOffered()) await skip();
        } finally {
          send();
        }
      }).catch((error: unknown) =>
        console.error("The card could not be skipped:", error),
      );
    },
    settled: () => heldOffer,
  };
}

function offerFailed(error: unknown): void {
  console.error("Review could not be offered:", error);
}

function refused(error: string): ChatResult {
  return { ok: false, status: 409, error };
}
