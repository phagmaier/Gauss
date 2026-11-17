// What every chat with the tutor shares: an event log for the page, and a
// queue that sends the tutor one turn at a time and writes its reply into
// the log. Built from the minimal page's chat (task 0.5); the intake chat and
// the unit chats (task 2.6) are made from these two parts.
//
// The tutor's session starts when a turn is to be sent and none is running,
// and a session that fails to start is tried again by the next turn. A
// conversation whose sessions the backend keeps closes its session once it
// has been idle for a while, and the next turn resumes it by its id (task
// 2.15), so a chat left open holds no Claude Code process. A session to
// resume that the backend cannot find gives way to a new one.

import { randomUUID } from "node:crypto";
import type { PageEvent } from "../../shared/events.ts";
import { SessionNotFound, type TutorSession } from "../backends/backend.ts";

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
  /** The learner event this turn delivers, if any, kept across transcript replay. */
  learnerId?: string;
  /**
   * What the tutor receives. A function is called when the turn is sent to
   * the tutor, after the turns before it, so its header says how things
   * stand then, and the chat can note what the tutor received when.
   */
  text: string | (() => string | Promise<string>);
  /**
   * Asked when the turn's time comes, after the turns before it: true if it
   * is no longer wanted. A skipped turn is not started: nothing is sent, the
   * page hears nothing of it, and `ended` does not run.
   */
  skip?(): boolean;
  /**
   * Runs once the turn has ended, before the next turn is sent, with the
   * text the tutor wrote in it, which is empty if it wrote none.
   */
  ended?(outcome: TurnOutcome, reply: string): Promise<void> | void;
}

export interface Conversation {
  /** Whether the conversation has begun: a turn was sent, or it resumes a kept session. */
  started(): boolean;
  /**
   * Queues a turn for the tutor. A turn sent while no session is running
   * starts one, or resumes the kept one.
   */
  send(turn: string | Turn): void;
  /** A turn is queued or running. */
  busy(): boolean;
  /** Stops the tutor's turn in progress, if there is one. */
  interrupt(): Promise<void>;
  /**
   * Resolves once every turn sent so far has finished, with the turns sent
   * when they ended.
   */
  settled(): Promise<void>;
  /** Closes the session for good: no turn after this starts one. */
  close(): Promise<void>;
}

/** Runs work later: the server's on `setTimeout`, a test's when the test says. */
export interface Timer {
  /** Runs `work` once `ms` have passed, unless the function returned cancels it first. */
  after(ms: number, work: () => void): () => void;
}

export const systemTimer: Timer = {
  after(ms, work) {
    const handle = setTimeout(work, ms);
    // A session waiting to be closed does not keep the process running.
    handle.unref();
    return () => clearTimeout(handle);
  },
};

/**
 * How long a kept session may be idle before it is closed (task 2.15). The
 * next turn then resumes it, which takes about half a second (task 2.14).
 */
export const IDLE_MS = 10 * 60_000;

/**
 * For a conversation whose sessions the backend keeps (task 2.15): how to
 * resume one, and when one is idle.
 */
export interface Kept {
  /** Resumes the kept session with this id; rejects with SessionNotFound if the backend has none. */
  resume(id: string): Promise<TutorSession>;
  /** A kept session to resume with the first turn, as a reopened unit's (task 2.14). */
  resumeId?: string;
  /**
   * The session to resume could not be found, so a new one starts. Called
   * before the turn's text is composed, so the text can tell the new session.
   */
  lost(learnerId?: string): void;
  /**
   * Something outside the conversation will send it a turn, such as a
   * grading whose grade goes to the tutor: the session is not idle.
   */
  waiting?(): boolean;
  /** Closes idle sessions; the system's timer if not given. */
  timer?: Timer;
}

/** The turn in progress: from when it starts, which is before it is sent. */
interface RunningTurn {
  /** The learner pressed Stop during this turn. */
  stopped: boolean;
  /** The session the turn was sent to, once it is sent. */
  sentTo?: TutorSession;
  /** The text the tutor has written in this turn. */
  reply: string;
}

export function createConversation(options: {
  /** Starts a new session for the tutor. */
  start: () => Promise<TutorSession>;
  /** Given, sessions are kept: closed once idle for IDLE_MS, and resumed by the next turn. */
  kept?: Kept;
  log: EventLog;
}): Conversation {
  const { log, kept } = options;
  const timer = kept?.timer ?? systemTimer;
  /** The session running or starting: none before the first turn, or once closed for being idle. */
  let session: Promise<TutorSession> | undefined;
  /** The kept session to resume when none is running. */
  let resumeId = kept?.resumeId;
  let begun = resumeId !== undefined;
  /** The closing of the session last closed for being idle, which a resume waits for. */
  let closing: Promise<void> = Promise.resolve();
  let cancelIdle: (() => void) | undefined;
  let closed = false;
  let running: RunningTurn | undefined;
  let turnsWaiting = 0;
  let queue: Promise<void> = Promise.resolve();

  async function runTurn(turn: Turn): Promise<void> {
    let skipped = false;
    try {
      skipped = turn.skip?.() === true;
    } catch (error) {
      // The turn is sent; the turns after it must still run.
      console.error("A chat could not tell whether to skip a turn:", error);
    }
    if (skipped) {
      turnsWaiting -= 1;
      idleFromNow();
      return;
    }
    const current: RunningTurn = { stopped: false, reply: "" };
    running = current;
    log.emit({ type: "turn_start" });
    let outcome: TurnOutcome = "error";
    try {
      outcome = await relay(turn, current);
    } finally {
      running = undefined;
      try {
        await turn.ended?.(outcome, current.reply);
      } catch (error) {
        // The next turn must still run.
        console.error("A chat's end-of-turn work failed:", error);
      }
      turnsWaiting -= 1;
      idleFromNow();
    }
  }

  /** The session for the turn about to be sent: the one running, or one started or resumed now. */
  function tutorSession(learnerId?: string): Promise<TutorSession> {
    if (session !== undefined) return session;
    const opening = open(learnerId);
    session = opening;
    opening.then(
      (started) => {
        if (kept !== undefined) resumeId = started.backendSessionId;
      },
      () => {
        // The next turn tries again.
        if (session === opening) session = undefined;
      },
    );
    return opening;
  }

  async function open(learnerId?: string): Promise<TutorSession> {
    if (closed) throw new Error("The chat is closed.");
    // An idle session is closed before it is resumed.
    await closing;
    if (kept === undefined || resumeId === undefined) return options.start();
    try {
      return await kept.resume(resumeId);
    } catch (error) {
      if (!(error instanceof SessionNotFound)) throw error;
      resumeId = undefined;
      kept.lost(learnerId);
      return options.start();
    }
  }

  /** Closes a kept session once it has been idle for IDLE_MS from now. */
  function idleFromNow(): void {
    cancelIdle?.();
    cancelIdle = undefined;
    if (kept === undefined || closed || session === undefined) return;
    cancelIdle = timer.after(IDLE_MS, closeIdle);
  }

  function closeIdle(): void {
    cancelIdle = undefined;
    if (closed || session === undefined) return;
    // Never while a turn is queued or running; its end counts again.
    if (turnsWaiting > 0) return;
    if (kept?.waiting?.() === true) {
      idleFromNow();
      return;
    }
    const idle = session;
    session = undefined;
    closing = idle
      .then((tutor) => tutor.close())
      .catch((error: unknown) => {
        console.error("An idle tutor session could not be closed:", error);
      });
  }

  /** Sends the turn and writes the reply into the log, to its turn_end. */
  async function relay(turn: Turn, current: RunningTurn): Promise<TurnOutcome> {
    const fail = (error: string): TurnOutcome => {
      log.emit({ type: "turn_end", outcome: "error", error });
      return "error";
    };
    // A Stop before the turn reaches the backend is kept here: the backend
    // clears its own stop flag when it is sent a turn.
    const stoppedBeforeSending = (): TurnOutcome => {
      log.emit({ type: "turn_end", outcome: "interrupted" });
      return "interrupted";
    };
    try {
      const tutor = await tutorSession(turn.learnerId);
      // Checked before composing, which can have effects (help is noted
      // then), and again after, since composing can wait.
      if (current.stopped) return stoppedBeforeSending();
      const text =
        typeof turn.text === "string" ? turn.text : await turn.text();
      if (current.stopped) return stoppedBeforeSending();
      // From here a Stop goes to the backend. Setting this, sending, and the
      // backend clearing its flag happen without a pause between them, so a
      // Stop lands either before (seen above) or after (seen by the backend).
      current.sentTo = tutor;
      begun = true;
      for await (const event of tutor.send({ text })) {
        if (event.type === "text") {
          current.reply += event.text;
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
    started: () => begun,
    send(turn) {
      cancelIdle?.();
      cancelIdle = undefined;
      turnsWaiting += 1;
      const queued = typeof turn === "string" ? { text: turn } : turn;
      queue = queue.then(() => runTurn(queued));
    },
    busy: () => turnsWaiting > 0,
    async interrupt() {
      const turn = running;
      if (turn === undefined) return;
      turn.stopped = true;
      await turn.sentTo?.interrupt();
    },
    async settled() {
      // A turn's end can send another turn, which is waited for too.
      let last: Promise<void>;
      do {
        last = queue;
        await last;
      } while (last !== queue);
    },
    async close() {
      closed = true;
      cancelIdle?.();
      cancelIdle = undefined;
      const last = session;
      session = undefined;
      await closing;
      // A session that failed to start has nothing to close.
      const tutor = await last?.catch(() => undefined);
      await tutor?.close();
    },
  };
}
