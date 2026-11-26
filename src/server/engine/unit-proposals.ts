// The tutor's proposals: a new style note for the course with propose_style
// (task 5.11) and a changed curriculum with amend_curriculum (task 5.12).
// A proposal is kept in the unit's position and shown on a card the learner
// answers with Apply or "Keep the current one"; the tutor hears the answer
// in its next header. Not while a question of the unit is open, where the
// card would sit beside the question, nor in a feedback-only turn. One
// proposal of either kind waits in a course: the course's queue refuses a
// tutor's proposal while another waits in a unit or in the course's
// planning conversation (task 5.38), and a chat refused for the planning
// conversation's is told how the learner answered it, or, if that answer
// does not reach it, that the block lifted (unit-header.ts). An Apply in
// another unit's chat or in the planning conversation reaches this chat,
// which takes the new note or curriculum in.
// Reopening shows the answers the thread lacks and the cards that wait. The
// unit chat keeps the style note its system prompt and headers give, which
// an Apply replaces; the running unit and whether the chat is closing, read
// at each call; and each action's guard and entry into its queue.

import { randomUUID } from "node:crypto";
import type { StoredUnit } from "../../shared/curriculum.ts";
import {
  type CurriculumChange,
  type CurriculumDecision,
  droppedStarted,
  sameUnits,
  withoutPlan,
} from "../../shared/curriculum-change.ts";
import type { PageEvent } from "../../shared/events.ts";
import type { State, UnitPosition } from "../../shared/state.ts";
import type { StyleDecision, StyleProposal } from "../../shared/style.ts";
import type { Backup } from "../record/backup.ts";
import { CurriculumChangeRefused, type DataRoot } from "../record/data-root.ts";
import type { CurriculumDesk } from "../tools/amend-curriculum.ts";
import type { StyleDesk } from "../tools/propose-style.ts";
import type { ChatResult } from "./conversation.ts";
import { sectionsRefused } from "./source-text.ts";
import type { UnitHeader } from "./unit-header.ts";
import type { UnitProgression } from "./unit-progression.ts";
import type { UnitRecord } from "./unit-record.ts";
import { curriculumNote, styleNote, type UnitContext } from "./unit-turns.ts";

/** The loaded unit, as the proposals read and change it. */
interface ProposalUnit {
  context: UnitContext;
  plannerContext?: UnitContext;
  record: Pick<
    UnitRecord,
    | "position"
    | "finished"
    | "keepStyleProposal"
    | "answerStyleProposal"
    | "keepCurriculumChange"
    | "answerCurriculumChange"
  >;
  notes: string[];
  header: Pick<UnitHeader, "plannerAnswered">;
  progression: Pick<UnitProgression, "feedback">;
}

type Learned = "changed" | "planner-applied";

export interface UnitProposals {
  styleDesk: StyleDesk;
  curriculumDesk: CurriculumDesk;
  /** Apply or Keep on the style note's card, inside the chat's queue. */
  answerStyle(
    r: ProposalUnit,
    proposalId: string,
    outcome: StyleDecision["outcome"],
  ): Promise<ChatResult>;
  /** Apply or Keep on the curriculum change's card, inside the chat's queue. */
  answerCurriculum(
    r: ProposalUnit,
    proposalId: string,
    outcome: CurriculumDecision["outcome"],
  ): Promise<ChatResult>;
  /**
   * A curriculum decision the record holds: on Apply, the curriculum read
   * again, the course's other chats told, the backup committed and the page
   * told; then the card answered.
   */
  publish(r: ProposalUnit, decision: CurriculumDecision): Promise<void>;
  /** Inside the chat's queue: a style note the learner applied in another unit's chat. */
  learnStyle(note: string): void;
  /** Tells a refused tutor the learner kept the curriculum from the course view. */
  learnPlannerKept(): void;
  /**
   * Outside the chat's queue: with units given, on a loaded unit while the
   * chat is not closing, the next header gives them at once, and the
   * returned install, for the queue, puts them in the unit's context.
   */
  takeUnits(
    units: readonly StoredUnit[] | undefined,
    outcome: Learned,
  ): (() => Promise<void>) | undefined;
  /** Inside the chat's queue: reads the course's curriculum again and tells the tutor. */
  refreshUnits(outcome: Learned): Promise<void>;
  /** On reopening: the answers the record holds and the thread does not show. */
  showAnswered(
    record: Pick<
      UnitRecord,
      "pendingStyleDecisions" | "pendingCurriculumDecisions"
    >,
  ): void;
  /** On reopening: the card of a proposal that waits. */
  showWaiting(position: UnitPosition): void;
}

export function createUnitProposals({
  exclusive,
  running,
  closing,
  emit,
  events,
  propose,
  courseId,
  now,
  readStyle,
  readCourse,
  readSources,
  restyle,
  recurriculum,
  backup,
  setStyle,
  unitFinished,
}: {
  exclusive<T>(work: () => Promise<T>): Promise<T>;
  /** The unit once it is loaded. */
  running(): ProposalUnit | undefined;
  closing(): boolean;
  emit(event: PageEvent): void;
  events(): readonly PageEvent[];
  /** The course queue's check that no other proposal waits, on behalf of this chat. */
  propose<T>(
    work: (state: State) => Promise<T>,
  ): Promise<T | { refused: string }>;
  courseId: string;
  now(): Date;
  readStyle(): ReturnType<DataRoot["readStyle"]>;
  readCourse(): ReturnType<DataRoot["readCourse"]>;
  readSources(): ReturnType<DataRoot["readSources"]>;
  /** Tells the chats of the course's other open units a style note the learner applied. */
  restyle(note: string): void;
  /** Tells the chats of the course's other open units a curriculum the learner applied. */
  recurriculum(): void;
  backup: Pick<Backup, "commit"> | undefined;
  setStyle(note: string): void;
  unitFinished: string;
}): UnitProposals {
  // Not while a question of the unit is open, where the card would sit
  // beside the question; one proposal waits in a course at a time.
  const styleDesk: StyleDesk = {
    propose: ({ note, why }, signal) =>
      exclusive(async () => {
        const r = running();
        if (r === undefined) return { refused: "The unit is not open." };
        if (r.record.finished !== undefined) return { refused: unitFinished };
        if (r.progression.feedback?.started === true) {
          return {
            refused:
              "This turn is for feedback only. Propose a style change in a later reply.",
          };
        }
        const open = r.record.position.openQuestion;
        if (open !== undefined) {
          return {
            refused:
              `Question ${open.number} is open: propose a change to the ` +
              "style once its answer is graded.",
          };
        }
        // Read once no other proposal waits, so an Apply in another unit
        // has written style.md before this one compares with it.
        return propose(async () => {
          const current = await readStyle();
          if (note === current) {
            return {
              refused: "That is the current style note: nothing would change.",
            };
          }
          const proposal: StyleProposal = {
            id: randomUUID(),
            note,
            ...(current === undefined ? {} : { was: current }),
            why,
            proposedAt: now().toISOString(),
          };
          // A turn stopped while this waited for the unit or the course
          // shows and keeps nothing; one stopped during the save below
          // shows its card, as one stopped just after it would.
          signal?.throwIfAborted();
          await r.record.keepStyleProposal(proposal, () =>
            emit(proposedEvent(proposal)),
          );
          return { proposed: true as const };
        });
      }),
  };

  /** The card that presents a proposed style note. */
  function proposedEvent(proposal: StyleProposal): PageEvent {
    return {
      type: "style_proposed",
      proposalId: proposal.id,
      note: proposal.note,
      ...(proposal.was === undefined ? {} : { was: proposal.was }),
      why: proposal.why,
    };
  }

  function styleAnsweredEvent({
    proposalId,
    outcome,
  }: StyleDecision): PageEvent {
    return { type: "style_answered", proposalId, outcome };
  }

  async function answerStyle(
    r: ProposalUnit,
    proposalId: string,
    outcome: StyleDecision["outcome"],
  ): Promise<ChatResult> {
    const proposal = r.record.position.styleProposal;
    if (proposal?.id !== proposalId) {
      return refused("That proposed style note is not waiting.");
    }
    const decision = await r.record.answerStyleProposal(
      outcome === "applied"
        ? { proposalId, outcome, note: proposal.note }
        : { proposalId, outcome },
    );
    if (decision.outcome === "applied") {
      setStyle(decision.note);
      restyle(decision.note);
      backup?.commit(`${courseId}: style note changed`);
    }
    emit(styleAnsweredEvent(decision));
    return { ok: true };
  }

  // As the style desk: not while a question of the unit is open, nor in a
  // feedback-only turn; one proposal of either kind waits in a course.
  const curriculumDesk: CurriculumDesk = {
    propose: ({ units, why }, signal) =>
      exclusive(async () => {
        const r = running();
        if (r === undefined) return { refused: "The unit is not open." };
        if (r.record.finished !== undefined) return { refused: unitFinished };
        if (r.progression.feedback?.started === true) {
          return {
            refused:
              "This turn is for feedback only. Propose a curriculum change in a later reply.",
          };
        }
        const open = r.record.position.openQuestion;
        if (open !== undefined) {
          return {
            refused:
              `Question ${open.number} is open: propose a change to the ` +
              "curriculum once its answer is graded.",
          };
        }
        // Read once no other proposal waits, so an Apply in another unit
        // has written curriculum.json before this one compares with it.
        return propose(async (state) => {
          const current = (await readCourse())?.curriculum;
          if (current === null || current === undefined) {
            return { refused: "The course has no curriculum." };
          }
          if (sameUnits(current.units, units)) {
            return {
              refused: "That is the current curriculum: nothing would change.",
            };
          }
          const dropped = droppedStarted(current.units, units, state);
          if (dropped !== undefined) return { refused: dropped };
          const sections = sectionsRefused(units, await readSources());
          if (sections !== undefined) return { refused: sections };
          const change: CurriculumChange = {
            id: randomUUID(),
            units,
            was: current.units.map(withoutPlan),
            why,
            proposedAt: now().toISOString(),
          };
          // As for the style: a turn stopped meanwhile keeps nothing.
          signal?.throwIfAborted();
          await r.record.keepCurriculumChange(change, () =>
            emit(changeProposedEvent(change)),
          );
          return { proposed: true as const };
        });
      }),
  };

  /** The card that presents a proposed curriculum change. */
  function changeProposedEvent(change: CurriculumChange): PageEvent {
    return {
      type: "curriculum_change_proposed",
      proposalId: change.id,
      units: change.units,
      was: change.was,
      why: change.why,
    };
  }

  function changeAnsweredEvent({
    proposalId,
    outcome,
  }: CurriculumDecision): PageEvent {
    return { type: "curriculum_change_answered", proposalId, outcome };
  }

  async function refreshCurriculum(r: ProposalUnit) {
    const stored = await readCourse();
    const units = stored?.curriculum?.units ?? r.context.units;
    r.context = { ...r.context, units };
  }

  function tellCurriculum(r: ProposalUnit, outcome: Learned) {
    if (outcome === "planner-applied" || r.record.finished === undefined) {
      r.notes.push(
        curriculumNote(outcome, (r.plannerContext ?? r.context).units),
      );
      if (outcome === "planner-applied") r.header.plannerAnswered();
    }
  }

  async function publishCurriculumDecision(
    r: ProposalUnit,
    decision: CurriculumDecision,
  ) {
    if (decision.outcome === "applied") {
      await refreshCurriculum(r);
      recurriculum();
      backup?.commit(`${courseId}: curriculum changed`);
      emit({ type: "curriculum_changed" });
    }
    emit(changeAnsweredEvent(decision));
  }

  async function answerCurriculum(
    r: ProposalUnit,
    proposalId: string,
    outcome: CurriculumDecision["outcome"],
  ): Promise<ChatResult> {
    if (r.record.position.curriculumChange?.id !== proposalId) {
      return refused("That proposed curriculum change is not waiting.");
    }
    let decision: CurriculumDecision;
    try {
      decision = await r.record.answerCurriculumChange({
        proposalId,
        outcome,
      });
    } catch (error) {
      if (!(error instanceof CurriculumChangeRefused)) throw error;
      return refused(`This change can no longer be applied. ${error.message}`);
    }
    await publishCurriculumDecision(r, decision);
    return { ok: true };
  }

  function learnStyle(note: string) {
    setStyle(note);
    const r = running();
    if (r !== undefined && r.record.finished === undefined) {
      r.notes.push(styleNote("changed", note));
    }
  }

  function learnPlannerKept() {
    const r = running();
    if (r !== undefined && !closing()) {
      r.notes.push(curriculumNote("planner-kept", r.context.units));
      r.header.plannerAnswered();
    }
  }

  function takeUnits(
    units: readonly StoredUnit[] | undefined,
    outcome: Learned,
  ): (() => Promise<void>) | undefined {
    const r = running();
    if (units === undefined || r === undefined || closing()) return undefined;
    // Ready and other queued turns can compose outside the chat queue.
    // Keep the snapshot visible while an earlier assessment writes back
    // its older context, then install it in queue order.
    const context = { ...r.context, units };
    r.plannerContext = context;
    tellCurriculum(r, outcome);
    return async () => {
      if (r.plannerContext !== context) return;
      r.context = context;
      delete r.plannerContext;
    };
  }

  async function refreshUnits(outcome: Learned) {
    const loaded = running();
    if (loaded === undefined || closing()) return;
    await refreshCurriculum(loaded);
    tellCurriculum(loaded, outcome);
  }

  function showAnswered(
    record: Pick<
      UnitRecord,
      "pendingStyleDecisions" | "pendingCurriculumDecisions"
    >,
  ) {
    const shown = (type: PageEvent["type"], proposalId: string) =>
      events().some(
        (event) =>
          event.type === type &&
          "proposalId" in event &&
          event.proposalId === proposalId,
      );
    for (const decision of record.pendingStyleDecisions) {
      if (!shown("style_answered", decision.proposalId)) {
        emit(styleAnsweredEvent(decision));
      }
    }
    for (const decision of record.pendingCurriculumDecisions) {
      if (!shown("curriculum_change_answered", decision.proposalId)) {
        emit(changeAnsweredEvent(decision));
      }
    }
  }

  function showWaiting(position: UnitPosition) {
    if (position.styleProposal !== undefined) {
      emit(proposedEvent(position.styleProposal));
    }
    if (position.curriculumChange !== undefined) {
      emit(changeProposedEvent(position.curriculumChange));
    }
  }

  return {
    styleDesk,
    curriculumDesk,
    answerStyle,
    answerCurriculum,
    publish: publishCurriculumDecision,
    learnStyle,
    learnPlannerKept,
    takeUnits,
    refreshUnits,
    showAnswered,
    showWaiting,
  };
}

function refused(error: string): ChatResult {
  return { ok: false, status: 409, error };
}
