// A timer for tests (task 2.15): work given to it runs only when the test
// moves the time on, so a test says how long a chat has been idle and never
// waits for it.

import type { Timer } from "./conversation.ts";

export interface FakeTimer extends Timer {
  /** Moves the time on by `ms`, running the work that comes due, in time order. */
  advance(ms: number): void;
}

export function createFakeTimer(): FakeTimer {
  let now = 0;
  let next = 0;
  const waiting = new Map<number, { at: number; work: () => void }>();
  return {
    after(ms, work) {
      const id = next;
      next += 1;
      waiting.set(id, { at: now + ms, work });
      return () => {
        waiting.delete(id);
      };
    },
    advance(ms) {
      const until = now + ms;
      while (true) {
        // Work can schedule more, which runs too if it comes due in time.
        let due: [number, { at: number; work: () => void }] | undefined;
        for (const entry of waiting) {
          if (
            entry[1].at <= until &&
            (due === undefined || entry[1].at < due[1].at)
          ) {
            due = entry;
          }
        }
        if (due === undefined) break;
        waiting.delete(due[0]);
        now = due[1].at;
        due[1].work();
      }
      now = until;
    },
  };
}
