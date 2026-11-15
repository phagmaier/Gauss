// The thread as the page shows it, rebuilt from the chat's event log. Pure, so
// a replay after a reload or a reconnect gives the same thread.

import type { PageEvent } from "../shared/events.ts";
import type { QuestionView } from "../shared/question.ts";

export type Graded = Extract<PageEvent, { type: "graded" }>;

export type Item =
  | { kind: "learner"; key: number; text: string }
  | { kind: "tutor"; key: number; text: string }
  | { kind: "question"; key: number; question: QuestionView; graded?: Graded }
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
}

export const emptyTimeline: Timeline = {
  chatId: null,
  last: -1,
  items: [],
  busy: false,
  tutorOpen: false,
};

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
      return {
        ...next,
        items: [
          ...state.items,
          { kind: "question", key: index, question: event.question },
        ],
        tutorOpen: false,
      };
    case "graded":
      return {
        ...next,
        items: state.items.map((item) =>
          item.kind === "question" && item.question.id === event.questionId
            ? { ...item, graded: event }
            : item,
        ),
      };
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
