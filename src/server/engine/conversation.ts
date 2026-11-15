// What every chat with the tutor shares: an event log for the page, and a
// queue that sends the tutor one turn at a time and writes its reply into
// the log. Built from the minimal page's chat (task 0.5); the intake chat and
// the unit chats (task 2.6) are made from these two parts.

import { randomUUID } from "node:crypto";
import type { PageEvent } from "../../shared/events.ts";
import type { TutorBackend, TutorSession } from "../backends/backend.ts";
import type { TeachingTool } from "../tools/tool.ts";

/** What a chat says to something the learner did: done, or why not. */
export type ChatResult =
  | { ok: true }
  | { ok: false; status: 400 | 404 | 409; error: string };

export type EventListener = (event: PageEvent, index: number) => void;

export interface EventLog {
  /** Changes when the server restarts, so a page can tell. */
  readonly id: string;
  events(): readonly PageEvent[];
  /** Calls the listener with every new event and its index in the log. */
  subscribe(listener: EventListener): () => void;
  emit(event: PageEvent): void;
}

export function createEventLog(): EventLog {
  const id = randomUUID();
  const log: PageEvent[] = [];
  const listeners = new Set<EventListener>();
  return {
    id,
    events: () => log,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    emit(event) {
      log.push(event);
      const index = log.length - 1;
      // A failing listener must not stop the turn: the tutor's reply has to
      // be read to its end, or the next turn would read its leftovers.
      for (const listener of listeners) {
        try {
          listener(event, index);
        } catch (error) {
          console.error("A chat listener failed:", error);
        }
      }
    },
  };
}

/** How a turn ended, as the page is told. */
export type TurnOutcome = "done" | "interrupted" | "error";

/** A turn for the tutor, when its text or its end matters to the chat. */
export interface Turn {
  /**
   * What the tutor receives. A function is called when the turn is sent to
   * the tutor, after the turns before it, so its header says how things
   * stand then.
   */
  text: string | (() => string);
  /** Runs once the turn has ended, before the next turn is sent. */
  ended?(outcome: TurnOutcome): Promise<void> | void;
}

export interface Conversation {
  /** Whether the first turn has been sent, which starts the tutor session. */
  started(): boolean;
  /** Queues a turn for the tutor. The first one starts the session. */
  send(turn: string | Turn): void;
  /** A turn is queued or running. */
  busy(): boolean;
  /** Stops the tutor's turn in progress, if there is one. */
  interrupt(): Promise<void>;
  /** Resolves once every turn sent so far has finished. */
  settled(): Promise<void>;
  close(): Promise<void>;
}

export function createConversation(options: {
  backend: TutorBackend;
  systemPrompt: string;
  tools: TeachingTool[];
  log: EventLog;
}): Conversation {
  const { log } = options;
  let session: Promise<TutorSession> | undefined;
  let turnRunning = false;
  let turnsWaiting = 0;
  let queue: Promise<void> = Promise.resolve();

  async function runTurn(turn: Turn): Promise<void> {
    turnRunning = true;
    log.emit({ type: "turn_start" });
    let outcome: TurnOutcome = "error";
    try {
      outcome = await relay(turn);
    } finally {
      turnRunning = false;
      try {
        await turn.ended?.(outcome);
      } catch (error) {
        // The next turn must still run.
        console.error("A chat's end-of-turn work failed:", error);
      }
      turnsWaiting -= 1;
    }
  }

  /** Sends the turn and writes the reply into the log, to its turn_end. */
  async function relay(turn: Turn): Promise<TurnOutcome> {
    const fail = (error: string): TurnOutcome => {
      log.emit({ type: "turn_end", outcome: "error", error });
      return "error";
    };
    try {
      if (session === undefined) throw new Error("The chat has not started.");
      const tutor = await session;
      const text = typeof turn.text === "string" ? turn.text : turn.text();
      for await (const event of tutor.send({ text })) {
        if (event.type === "text") {
          log.emit({ type: "tutor_text", text: event.text });
        } else if (event.type === "turn_end") {
          const outcome =
            event.outcome === "ended_by_tool" ? "done" : event.outcome;
          log.emit({
            type: "turn_end",
            outcome,
            ...(event.error === undefined ? {} : { error: event.error }),
          });
          return outcome;
        }
      }
      return fail("The tutor's reply ended early.");
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error));
    }
  }

  return {
    started: () => session !== undefined,
    send(turn) {
      if (session === undefined) {
        session = options.backend.startSession({
          systemPrompt: options.systemPrompt,
          tools: options.tools,
        });
        // A failed start is reported by the first turn.
        session.catch(() => {});
      }
      turnsWaiting += 1;
      const queued = typeof turn === "string" ? { text: turn } : turn;
      queue = queue.then(() => runTurn(queued));
    },
    busy: () => turnsWaiting > 0,
    async interrupt() {
      if (turnRunning && session !== undefined) {
        await (await session).interrupt();
      }
    },
    settled: () => queue,
    async close() {
      if (session !== undefined) await (await session).close();
    },
  };
}
