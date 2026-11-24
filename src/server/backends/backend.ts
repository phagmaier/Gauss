// The backend adapter. The engine talks only to
// these types; the SDKs stay inside the files of this folder.

import { z } from "zod";
import type { BackendName } from "../../shared/course.ts";
import type { WebResult } from "../../shared/events.ts";
import type { CommandReads } from "../sandbox-command.ts";
import type { TeachingTool } from "../tools/tool.ts";

export interface SessionOptions {
  systemPrompt: string;
  /** The teaching tools this session may call. */
  tools: TeachingTool[];
  /**
   * The folder the session works in: its course's workspace, or for an
   * intake the intakes' folder. A session given one is kept, so it can be
   * resumed by its id; one without is not kept.
   */
  cwd?: string;
  /**
   * Gives the session the file and shell tools, confined to `cwd`, which it
   * must have: a tutor's (task 3.3). Absent: no built-in tools.
   */
  workspace?: WorkspaceTools;
  /**
   * Gives the session the backend's web search, and never a tool that
   * reads a page (task 4.11): a tutor's in a course whose setting allows
   * it. A query holding the account's email address is refused. Given
   * again with each resume, as the setting stands then.
   */
  webSearch?: boolean;
  /**
   * Why a search is refused now, if it is: asked before each search of a
   * session given web search; the reason is what the model is told.
   */
  searchRefusal?: () => Promise<string | undefined>;
  /**
   * The id of a kept session to resume, in the folder it ran in. Its
   * conversation goes on, and the system prompt given here replaces the one
   * it had. A session the backend cannot find rejects with SessionNotFound.
   */
  resumeId?: string;
  /**
   * What a kept session is called where the backend lists its sessions.
   * Given one, the backend does not make a title up, which can cost a
   * request of its own. A resumed session keeps the title it has.
   */
  title?: string;
}

/**
 * The file and shell tools (Read, Glob, Grep, Write, Edit, Bash). The
 * session writes files only in its working folder, reads files only there,
 * and runs commands in a sandbox with no network that writes only there and
 * in a temporary folder of the course's and reads as `reads` says and in
 * the working folder.
 */
export interface WorkspaceTools {
  /**
   * Atomically checks the course's open questions and reserves a mutation
   * until release is called after confirmed success or failure. Closing a
   * real session alone does not confirm its commands have stopped.
   * Reads never acquire a reservation.
   */
  acquire(): Promise<{ refused: string } | { release(): void }>;
  /** Where its commands may read, beside the working folder. */
  reads: CommandReads;
}

/**
 * The session to resume cannot be found: it was never kept, or it has been
 * deleted, as Claude Code deletes sessions after 30 days (task 0.4). The
 * engine then starts a new session.
 */
export class SessionNotFound extends Error {
  constructor(id: string) {
    super(`The tutor's session ${id} cannot be found.`);
    this.name = "SessionNotFound";
  }
}

/** One message from the engine: a header and the learner's text or an event. */
export interface EngineTurn {
  text: string;
  /** Raw text from the message box, when the turn delivers a learner message. */
  learnerMessage?: string;
}

export type BackendEvent =
  /** A piece of the tutor's text. Separate blocks arrive already separated. */
  | { type: "text"; text: string }
  /** The tutor called a tool: a teaching tool by its own name, or a built-in one. */
  | { type: "tool_call"; name: string }
  /**
   * A file tool wrote a file: its path relative to the working folder, or
   * absolute outside it. Only after the write succeeded.
   */
  | { type: "file_written"; path: string }
  /**
   * The web search tool searched: the query as searched and the pages
   * found. Only once its result came back; a refused or failed search is
   * not one.
   */
  | { type: "web_searched"; query: string; results: WebResult[] }
  /** The last event of every turn. */
  | {
      type: "turn_end";
      /** "ended_by_tool": a teaching tool asked for the turn to end. */
      outcome: "done" | "ended_by_tool" | "interrupted" | "error";
      error?: string;
    };

export interface TutorSession {
  /** Known from the start, so the engine can store it before the first turn. */
  readonly backendSessionId: string;
  /**
   * Sends one turn and streams the tutor's reply, ending with `turn_end`.
   * Turns are sent one at a time: the engine waits for `turn_end` before
   * sending the next. Never throws; a failure is a `turn_end` with
   * outcome "error".
   */
  send(turn: EngineTurn, signal?: AbortSignal): AsyncIterable<BackendEvent>;
  /** Stops the turn in progress, which then ends with outcome "interrupted". */
  interrupt(): Promise<void>;
  close(): Promise<void>;
}

/**
 * One request on its own: its own system prompt, no tools, no conversation
 * before it, and nothing kept after it (grading, notes and other writers). The
 * reply is asked for as JSON in the schema's shape and checked against it.
 */
export interface OneShotRequest<T> {
  systemPrompt: string;
  prompt: string;
  schema: z.ZodType<T>;
  /** Stops the request, which then fails. */
  signal?: AbortSignal;
}

export type OneShotResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

/** What runs a conversation: a tutor's, a planner's or an intake's. */
export interface SessionBackend {
  /**
   * Starts a session, or resumes one. A resumed session is ready when this
   * resolves; one that cannot be found rejects with SessionNotFound.
   */
  startSession(options: SessionOptions): Promise<TutorSession>;
  /**
   * Whether the backend has the kept session with this id, kept in this
   * folder, to resume. Found without starting it (task 2.15).
   */
  hasSession(id: string, cwd: string): Promise<boolean>;
}

/**
 * The session backends a server has, by the name a course gives
 * (`Course.backend`). A course's tutor and unit planner run on its own; one
 * the server lacks is absent, and that course's units do not open.
 */
export type SessionBackends = Partial<Record<BackendName, SessionBackend>>;

/** A whole backend: its sessions, and the one-shot requests of the grader, judges and writers. */
export interface TutorBackend extends SessionBackend {
  /** Never throws: a failed request, or a reply not in the schema's shape, is a failure. */
  oneShot<T>(request: OneShotRequest<T>): Promise<OneShotResult<T>>;
}

/** Checks a one-shot reply against the request's schema. */
export function checkReply<T>(
  schema: z.ZodType<T>,
  output: unknown,
): OneShotResult<T> {
  const parsed = schema.safeParse(output);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : {
        ok: false,
        error: `The reply was not in the shape asked for: ${z.prettifyError(parsed.error)}`,
      };
}
