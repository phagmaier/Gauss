// The backend adapter (architecture.md section 7). The engine talks only to
// these types; the SDKs stay inside the files of this folder.

import type { TeachingTool } from "../tools/tool.ts";

export interface SessionOptions {
  systemPrompt: string;
  /** The teaching tools this session may call. */
  tools: TeachingTool[];
}

/** One message from the engine: a header and the learner's text or an event. */
export interface EngineTurn {
  text: string;
}

export type BackendEvent =
  /** A piece of the tutor's text. Separate blocks arrive already separated. */
  | { type: "text"; text: string }
  /** The tutor called a tool: a teaching tool by its own name, or a built-in one. */
  | { type: "tool_call"; name: string }
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
  send(turn: EngineTurn): AsyncIterable<BackendEvent>;
  /** Stops the turn in progress, which then ends with outcome "interrupted". */
  interrupt(): Promise<void>;
  close(): Promise<void>;
}

export interface TutorBackend {
  startSession(options: SessionOptions): Promise<TutorSession>;
}
