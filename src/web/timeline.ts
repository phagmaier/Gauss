// The thread as the page shows it, rebuilt from the chat's event log. Pure, so
// a replay after a reload or a reconnect gives the same thread. A unit chat's
// log starts with the unit's earlier sessions (task 2.13), and its own
// opening repeats where the unit stands: a phase, an open question or a
// closing card the thread already shows is not shown twice.

import type { Slug } from "../shared/course.ts";
import type { Unit } from "../shared/curriculum.ts";
import type { PageEvent } from "../shared/events.ts";
import type { Plan } from "../shared/plan.ts";
import type { QuestionView, WrittenAnswer } from "../shared/question.ts";
import type { Phase } from "../shared/state.ts";
import type { ObjectiveStatus } from "../shared/status.ts";
import { changedUnits } from "./units.ts";

export type Graded = Extract<PageEvent, { type: "graded" }>;

/** A posted question, and what has happened to it since. */
export interface QuestionItem {
  kind: "question";
  key: number;
  question: QuestionView;
  /** A written answer sent and kept until it is graded (task 2.8). */
  grading?: WrittenAnswer;
  /** Why the last grading of the kept answer failed. */
  gradingFailed?: string;
  graded?: Graded;
  /** The learner moved on without the check while it was open. */
  withdrawn?: boolean;
}

/** Where a unit chat is: the phase of a segment that began last. */
export interface Position {
  segment: number;
  phase: Phase;
  /** For a segment after the plan's last: the objectives it goes over again. */
  again?: string[];
}

/** The closing card at a unit's end (task 2.1, piece 10). */
export interface UnitEndItem {
  kind: "unit_end";
  key: number;
  /** Every objective passed. */
  passed: boolean;
  objectives: Record<string, ObjectiveStatus>;
  /** The step taken from a card whose objectives did not all pass, once taken. */
  stepTaken?: "again" | "moved-on";
}

export type Item =
  | { kind: "learner"; key: number; text: string }
  | { kind: "tutor"; key: number; text: string }
  | QuestionItem
  /** A phase of a segment began, or the chat opened in it. */
  | ({ kind: "phase"; key: number } & Position)
  | UnitEndItem
  /** A unit's session, a sitting, began after an earlier one (task 2.13). */
  | {
      kind: "session";
      key: number;
      startedAt: string;
      /** The session before ended while the tutor was writing: a restart cut it off. */
      cutOff: boolean;
    }
  | {
      kind: "proposal";
      key: number;
      revision: number;
      courseId: Slug;
      title: string;
      units: Unit[];
      /** The ids of the units this revision changed; none in the first. */
      changed: Set<string>;
      /** How the tutor would teach the course; a draft from before task 2.10 has none. */
      style: string | undefined;
      /** The style note differs from the revision before's. */
      styleChanged: boolean;
    }
  | { kind: "note"; key: number; text: string };

export interface Timeline {
  chatId: string | null;
  /** The index of the last event applied, or -1. */
  last: number;
  items: Item[];
  /** The tutor is writing. */
  busy: boolean;
  /** The tutor's next text continues the last item. */
  tutorOpen: boolean;
  /** The newest proposal's revision, the only one that can be approved; 0 if none. */
  latestRevision: number;
  approved: { courseId: Slug; revision: number } | null;
  /** The intake started from a stored draft, its conversation lost. */
  reopened: boolean;
  // A unit chat's own (tasks 2.6 to 2.8):
  /** A session has begun: the unit's thread was read, and what follows is in it. */
  inSession: boolean;
  /** The unit's plan, once it is known. */
  plan: Plan | null;
  /** The unit has no plan yet and is being planned. */
  planning: boolean;
  /** Why the unit could not be opened; opening it again tries again. */
  failed: string | null;
  /** The phase that began last; null until the unit is open, and when it opens finished. */
  position: Position | null;
  /** The unit is finished, and how. */
  finished: "passed" | "overridden" | null;
}

export const emptyTimeline: Timeline = {
  chatId: null,
  last: -1,
  items: [],
  busy: false,
  tutorOpen: false,
  latestRevision: 0,
  approved: null,
  reopened: false,
  inSession: false,
  plan: null,
  planning: false,
  failed: null,
  position: null,
  finished: null,
};

/** Changes the question with this id, and leaves every other item as it is. */
function withQuestion(
  items: Item[],
  id: string,
  change: (item: QuestionItem) => QuestionItem,
): Item[] {
  return items.map((item) =>
    item.kind === "question" && item.question.id === id ? change(item) : item,
  );
}

/**
 * A closing card is in the thread with no phase begun since: a `unit_end`
 * now is that card shown again, by a chat that opened at it.
 */
function cardStanding(items: Item[]): boolean {
  const card = items.findLastIndex((i) => i.kind === "unit_end");
  return card >= 0 && items.findLastIndex((i) => i.kind === "phase") < card;
}

/** Records the step taken from the last closing card, if none was taken yet. */
function stepFromCard(items: Item[], stepTaken: "again" | "moved-on"): Item[] {
  const at = items.findLastIndex((i) => i.kind === "unit_end");
  const card = items[at];
  if (
    card?.kind !== "unit_end" ||
    card.passed ||
    card.stepTaken !== undefined
  ) {
    return items;
  }
  return items.with(at, { ...card, stepTaken });
}

export type TimelineAction =
  /** Sent first on every connection; a new chat id means the server restarted. */
  | { type: "hello"; chatId: string }
  | { type: "event"; index: number; event: PageEvent };

export function reduce(state: Timeline, action: TimelineAction): Timeline {
  if (action.type === "hello") {
    return action.chatId === state.chatId
      ? state
      : { ...emptyTimeline, chatId: action.chatId };
  }
  const { index, event } = action;
  if (index <= state.last) return state;
  const next: Timeline = { ...state, last: index };
  switch (event.type) {
    case "session": {
      // What was under way when the session before ended is over.
      const settled: Timeline = {
        ...next,
        inSession: true,
        busy: false,
        tutorOpen: false,
        planning: false,
        failed: null,
      };
      // Before the first session the thread could not be read, and the note
      // that said so stood where the thread begins. Opening the unit again
      // read it, so the note gives way to the thread.
      if (!state.inSession) return { ...settled, items: [] };
      const last = state.items.at(-1);
      // The first session needs no marker.
      if (last === undefined) return settled;
      const item: Item = {
        kind: "session",
        key: index,
        startedAt: event.startedAt,
        cutOff: state.busy || (last.kind === "session" && last.cutOff),
      };
      return {
        ...settled,
        // A session that showed nothing gives way to this one.
        items:
          last.kind === "session"
            ? state.items.with(-1, item)
            : [...state.items, item],
      };
    }
    case "learner":
      return {
        ...next,
        items: [
          ...state.items,
          { kind: "learner", key: index, text: event.text },
        ],
        tutorOpen: false,
      };
    case "turn_start":
      return { ...next, busy: true, tutorOpen: false };
    case "tutor_text": {
      const lastItem = state.items.at(-1);
      if (state.tutorOpen && lastItem?.kind === "tutor") {
        return {
          ...next,
          items: [
            ...state.items.slice(0, -1),
            { ...lastItem, text: lastItem.text + event.text },
          ],
        };
      }
      return {
        ...next,
        items: [
          ...state.items,
          { kind: "tutor", key: index, text: event.text },
        ],
        tutorOpen: true,
      };
    }
    case "question":
      // A unit opened again, after a failure or a restart, posts its open
      // question again.
      if (
        state.items.some(
          (i) => i.kind === "question" && i.question.id === event.question.id,
        )
      ) {
        return next;
      }
      return {
        ...next,
        items: [
          ...state.items,
          { kind: "question", key: index, question: event.question },
        ],
        tutorOpen: false,
      };
    case "grading":
      return {
        ...next,
        items: withQuestion(
          state.items,
          event.questionId,
          ({ gradingFailed: _, ...item }) => ({
            ...item,
            grading: event.answer,
          }),
        ),
      };
    case "grading_failed":
      return {
        ...next,
        items: withQuestion(state.items, event.questionId, (item) => ({
          ...item,
          gradingFailed: event.error,
        })),
      };
    case "graded":
      return {
        ...next,
        items: withQuestion(
          state.items,
          event.questionId,
          ({ grading: _, gradingFailed: __, ...item }) => ({
            ...item,
            graded: event,
          }),
        ),
      };
    case "draft_reopened":
      return { ...next, reopened: true };
    case "curriculum_proposed": {
      const previous = state.items.findLast((i) => i.kind === "proposal");
      return {
        ...next,
        items: [
          ...state.items,
          {
            kind: "proposal",
            key: index,
            revision: event.revision,
            courseId: event.courseId,
            title: event.title,
            units: event.units,
            changed: changedUnits(event.units, previous?.units),
            style: event.style,
            styleChanged:
              previous !== undefined && previous.style !== event.style,
          },
        ],
        tutorOpen: false,
        latestRevision: event.revision,
      };
    }
    case "curriculum_approved":
      return {
        ...next,
        approved: { courseId: event.courseId, revision: event.revision },
      };
    // The unit chat's events (tasks 2.6 to 2.8), shown by the session view.
    case "unit_planning":
      return { ...next, planning: true, failed: null };
    case "unit_plan":
      return { ...next, plan: event.plan, planning: false, failed: null };
    // How the unit stands: the closing card carries its own statuses.
    case "unit_status":
      return next;
    case "phase": {
      const position: Position = {
        segment: event.segment,
        phase: event.phase,
        ...(event.again === undefined ? {} : { again: event.again }),
      };
      // A chat that opens in the phase the thread is in, as a unit reopened
      // after a restart does, begins nothing new.
      if (
        state.position?.segment === position.segment &&
        state.position.phase === position.phase
      ) {
        return { ...next, position };
      }
      // Going over again starts with the extra segment's teaching.
      const items =
        event.again !== undefined && event.phase === "teach"
          ? stepFromCard(state.items, "again")
          : state.items;
      return {
        ...next,
        items: [...items, { kind: "phase", key: index, ...position }],
        position,
        tutorOpen: false,
      };
    }
    case "unit_end":
      if (cardStanding(state.items)) return next;
      return {
        ...next,
        items: [
          ...state.items,
          {
            kind: "unit_end",
            key: index,
            passed: event.passed,
            objectives: event.objectives,
          },
        ],
        tutorOpen: false,
      };
    case "unit_closed":
      return {
        ...next,
        items:
          event.status === "overridden"
            ? stepFromCard(state.items, "moved-on")
            : state.items,
        finished: event.status,
      };
    case "unit_failed":
      return {
        ...next,
        items: [
          ...state.items,
          { kind: "note", key: index, text: event.error },
        ],
        planning: false,
        failed: event.error,
      };
    case "overridden": {
      const { withdrawnQuestionId } = event;
      const items =
        withdrawnQuestionId === undefined
          ? state.items
          : withQuestion(state.items, withdrawnQuestionId, (item) => ({
              ...item,
              withdrawn: true,
            }));
      return {
        ...next,
        items: [
          ...items,
          {
            kind: "note",
            key: index,
            text: "You moved on without the check. Recorded as an override.",
          },
        ],
        tutorOpen: false,
      };
    }
    case "turn_end": {
      const note =
        event.outcome === "error"
          ? `The tutor stopped because of an error: ${event.error ?? "unknown"}`
          : event.outcome === "interrupted"
            ? "Stopped."
            : undefined;
      return {
        ...next,
        busy: false,
        tutorOpen: false,
        items:
          note === undefined
            ? state.items
            : [...state.items, { kind: "note", key: index, text: note }],
      };
    }
  }
}
