// A unit chat's event log that is also its transcripts (task 2.13). The
// chat's events reach the page as before, and each is appended, as it
// happens, to the transcript of the session it belongs to:
// sessions/<unit id>.<number>.jsonl in the course's folder (record/
// data-root.ts). Opening the log first replays the unit's earlier sessions
// into it, so a unit reopened after a restart shows its whole thread, and
// then starts a session of its own.
//
// A session is one sitting (docs/brief.md, "Terms"). One starts when the
// unit's chat opens, which is once per server run, and again when something
// happens after the unit has been quiet for SESSION_GAP_MS: the learner went
// away and came back. Each starts with a `session` event, which the page
// shows between sittings. None starts inside a turn of the tutor's: a reply
// that the machine slept through stays in the session it began in, and the
// next session starts with what comes after the turn. So a `session` that
// follows a turn left open means the server stopped, which is what the page
// says there.
//
// The page hears of an event at once, and its line is written soon after, so
// a crash can lose the last few lines. The transcript only shows the
// conversation: where the unit stands is in state.json and the evidence,
// which are written, and flushed to disk, before the page hears of a change.
// Lines are written in batches: one write for all the events that came while
// the write before ran, not flushed (data-root.ts says why). The backend
// streams the tutor's text in small pieces, so each run of it in a batch is
// joined into one line, which the page shows the same way. A real backend's
// pieces mostly come further apart than a write takes and get a line each,
// so the earlier sessions are joined again when they are replayed: a page
// that connects is sent one event a reply, not one a piece.

import { type PageEvent, SESSION_GAP_MS } from "../../shared/events.ts";
import type { DataRoot } from "../record/data-root.ts";
import { createEventLog, type EventLog } from "./conversation.ts";

export interface TranscribedLog extends EventLog {
  /**
   * Replays the unit's earlier sessions into the log, then starts a session.
   * Done once; after a failure, the next call tries again. Events given
   * before it is done belong to no session, and are not written.
   */
  open(): Promise<void>;
  /** Resolves once every event given so far is written, or its write failed. */
  flushed(): Promise<void>;
  /**
   * Whether the next event would start a new session: the log is open, the
   * unit has been quiet for the gap, and no turn of the tutor's is open.
   */
  quiet(): boolean;
}

export function createTranscribedLog(options: {
  dataRoot: DataRoot;
  courseId: string;
  unitId: string;
  now: () => Date;
  /** How long the unit is quiet before the next event starts a session. */
  gapMs?: number;
}): TranscribedLog {
  const { dataRoot, courseId, unitId, now } = options;
  const gapMs = options.gapMs ?? SESSION_GAP_MS;
  const log = createEventLog();
  /** The session events are written to, once the log is open. */
  let session: { number: number; lastAt: number } | undefined;
  /** A turn of the tutor's has started and not ended. */
  let turnOpen = false;
  let opening: Promise<void> | undefined;
  let pending: { session: number; event: PageEvent }[] = [];
  let writing: Promise<void> = Promise.resolve();
  let scheduled = false;

  function begin(number: number, at: Date): void {
    session = { number, lastAt: at.getTime() };
    record({ type: "session", startedAt: at.toISOString() });
  }

  function record(event: PageEvent): void {
    if (session === undefined) throw new Error("No session has started.");
    log.emit(event);
    pending.push({ session: session.number, event });
    if (!scheduled) {
      scheduled = true;
      writing = writing.then(write);
    }
  }

  async function write(): Promise<void> {
    scheduled = false;
    const batch = pending;
    pending = [];
    for (const { number, events } of bySession(batch)) {
      try {
        await dataRoot.appendTranscript(
          courseId,
          unitId,
          number,
          joinText(events),
        );
      } catch (error) {
        // The chat goes on: the record is written apart from the transcript,
        // and only a thread rebuilt after a restart would miss these lines.
        console.error(
          `Lines of the transcript of "${courseId}" unit "${unitId}", session ${number}, could not be written:`,
          error,
        );
      }
    }
  }

  return {
    id: log.id,
    events: log.events,
    subscribe: log.subscribe,
    watched: log.watched,

    emit(event) {
      if (session === undefined || event.type === "curriculum_changed") {
        log.emit(event);
        return;
      }
      const at = now();
      const quiet = at.getTime() - session.lastAt >= gapMs;
      // Inside a turn, the quiet time is kept as it was, so the session
      // starts with the first event after the turn.
      if (quiet && !turnOpen) begin(session.number + 1, at);
      else if (!quiet) session.lastAt = at.getTime();
      if (event.type === "turn_start") turnOpen = true;
      else if (event.type === "turn_end") turnOpen = false;
      record(event);
    },

    open() {
      opening ??= (async () => {
        const earlier = await dataRoot.readTranscripts(courseId, unitId);
        for (const { events, unreadable } of earlier) {
          for (const problem of unreadable) {
            console.error(`A transcript line was left out: ${problem}`);
          }
          for (const event of joinText(events)) {
            // The current chat alone can grant approval or offer a save retry.
            if (event.type === "packages_save_failed") continue;
            log.emit(
              event.type === "artifact" ||
                event.type === "packages_requested" ||
                event.type === "style_proposed" ||
                event.type === "curriculum_change_proposed"
                ? { ...event, historical: true }
                : event,
            );
          }
        }
        begin((earlier.at(-1)?.session ?? 0) + 1, now());
      })().catch((error: unknown) => {
        opening = undefined;
        throw error;
      });
      return opening;
    },

    quiet() {
      return (
        session !== undefined &&
        !turnOpen &&
        now().getTime() - session.lastAt >= gapMs
      );
    },

    async flushed() {
      // Another write can be queued while this waits for one.
      while (true) {
        const tail = writing;
        await tail;
        if (tail === writing) return;
      }
    },
  };
}

/** The batch's events in runs that belong to one session, in order. */
function bySession(
  batch: readonly { session: number; event: PageEvent }[],
): { number: number; events: PageEvent[] }[] {
  const runs: { number: number; events: PageEvent[] }[] = [];
  for (const { session, event } of batch) {
    const last = runs.at(-1);
    if (last?.number === session) last.events.push(event);
    else runs.push({ number: session, events: [event] });
  }
  return runs;
}

/** Joins each run of the tutor's text into one event, as the page joins it. */
function joinText(events: readonly PageEvent[]): PageEvent[] {
  const joined: PageEvent[] = [];
  for (const event of events) {
    const last = joined.at(-1);
    if (event.type === "tutor_text" && last?.type === "tutor_text") {
      joined[joined.length - 1] = {
        type: "tutor_text",
        text: last.text + event.text,
      };
    } else {
      joined.push(event);
    }
  }
  return joined;
}
