// A scripted backend for automated tests, which never call a real model
// (AGENTS.md). Each scripted turn lists what the "tutor" does in order: write
// text, call a teaching tool, or hold until it is interrupted. Tool calls run
// the real teaching tool, and a call that ends the turn ends it here too.

import type { ToolResult } from "../tools/tool.ts";
import type {
  BackendEvent,
  EngineTurn,
  SessionOptions,
  TutorBackend,
  TutorSession,
} from "./backend.ts";

export type FakeStep =
  | { text: string }
  | { call: string; input: unknown }
  /** Waits until the turn is interrupted or the session closed. */
  | { hold: true };

/** A turn's steps, or a function that picks them from the turn received. */
export type FakeTurn = FakeStep[] | ((turn: EngineTurn) => FakeStep[]);

export interface FakeCall {
  name: string;
  input: unknown;
  result: ToolResult;
}

export interface FakeBackend extends TutorBackend {
  /** Every turn the engine sent, in order. */
  readonly received: EngineTurn[];
  /** Every tool call the script made, with what the tool returned. */
  readonly calls: FakeCall[];
  /** The options of every session started. */
  readonly sessions: SessionOptions[];
}

export function createFakeBackend(script: FakeTurn[]): FakeBackend {
  const received: EngineTurn[] = [];
  const calls: FakeCall[] = [];
  const sessions: SessionOptions[] = [];
  let nextTurn = 0;

  async function startSession(options: SessionOptions): Promise<TutorSession> {
    sessions.push(options);
    let interrupted = false;
    let closed = false;
    let release: (() => void) | undefined;

    async function* send(turn: EngineTurn): AsyncGenerator<BackendEvent> {
      received.push(turn);
      interrupted = false;
      const entry = script[nextTurn];
      nextTurn += 1;
      if (entry === undefined) {
        yield {
          type: "turn_end",
          outcome: "error",
          error: `The fake backend has no scripted turn ${nextTurn}.`,
        };
        return;
      }
      const steps = typeof entry === "function" ? entry(turn) : entry;
      for (const step of steps) {
        if (interrupted || closed) break;
        if ("text" in step) {
          yield { type: "text", text: step.text };
        } else if ("call" in step) {
          yield { type: "tool_call", name: step.call };
          const tool = options.tools.find((t) => t.name === step.call);
          const result: ToolResult =
            tool === undefined
              ? { status: "refused", text: `No such tool: ${step.call}` }
              : await tool.run(step.input);
          calls.push({ name: step.call, input: step.input, result });
          if (result.status === "done" && result.endTurn === true) {
            yield { type: "turn_end", outcome: "ended_by_tool" };
            return;
          }
        } else {
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        }
      }
      yield { type: "turn_end", outcome: interrupted ? "interrupted" : "done" };
    }

    return {
      backendSessionId: `fake-session-${sessions.length}`,
      send,
      async interrupt() {
        interrupted = true;
        release?.();
        release = undefined;
      },
      async close() {
        closed = true;
        release?.();
        release = undefined;
      },
    };
  }

  return { received, calls, sessions, startSession };
}
