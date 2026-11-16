// A scripted backend for automated tests, which never call a real model
// (AGENTS.md). Each scripted turn lists what the "tutor" does in order: write
// text, call a teaching tool, or hold until it is interrupted. Tool calls run
// the real teaching tool, and a call that ends the turn ends it here too.
// One-shot requests get the scripted replies in order, checked against the
// request's schema as the real backends check theirs. In place of a list, a
// function can answer every turn or request it is given, without end
// (scripted.ts, which runs the dev server of task 2.12b).
//
// A session started with a working directory is kept, as the SDK keeps it
// on disk, and can be resumed by its id; resuming an id that was not kept
// fails with SessionNotFound (task 2.14). Backends given one set of kept ids
// resume each other's sessions, as a server does after a restart. The
// script goes on across a resume: the fake has no conversation to carry.

import { randomUUID } from "node:crypto";
import type { ToolResult } from "../tools/tool.ts";
import {
  type BackendEvent,
  checkReply,
  type EngineTurn,
  type OneShotRequest,
  type OneShotResult,
  SessionNotFound,
  type SessionOptions,
  type TutorBackend,
  type TutorSession,
} from "./backend.ts";

export type FakeStep =
  | { text: string }
  | { call: string; input: unknown }
  /** Waits until the turn is interrupted or the session closed. */
  | { hold: true };

/** A turn's steps, or a function that picks them from the turn received. */
export type FakeTurn = FakeStep[] | ((turn: EngineTurn) => FakeStep[]);

/** The steps of any turn, from the turn and the session it was sent in. */
export type FakeScript = (
  turn: EngineTurn,
  session: SessionOptions,
) => FakeStep[];

/**
 * A one-shot reply: the model's output, before it is checked; a failed
 * request; one that holds until it is stopped; or one that comes when the
 * test releases it.
 */
export type FakeReply =
  | { output: unknown }
  | { fail: string }
  | { hold: true }
  | { later: Promise<FakeReply> };

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
  /** The options of every session started or resumed, a resume that failed too. */
  readonly sessions: SessionOptions[];
  /** The id of every session started or resumed, in the same order, once it is. */
  readonly ids: string[];
  /** The ids of the sessions closed, in order. */
  readonly closed: string[];
  /** Every one-shot request, in order. */
  readonly oneShots: OneShotRequest<unknown>[];
}

/** How the id of every session the fake starts begins. */
export const FAKE_SESSION = "fake-session-";

/** The ids of the sessions kept, which a session can be resumed by. A Set will do. */
export interface KeptSessions {
  has(id: string): boolean;
  add(id: string): void;
}

export function createFakeBackend(
  script: FakeTurn[] | FakeScript,
  replies: FakeReply[] | ((request: OneShotRequest<unknown>) => FakeReply) = [],
  options: {
    /** Shared between backends to resume across a restart; its own if not given. */
    kept?: KeptSessions;
  } = {},
): FakeBackend {
  const received: EngineTurn[] = [];
  const calls: FakeCall[] = [];
  const sessions: SessionOptions[] = [];
  const ids: string[] = [];
  const closedIds: string[] = [];
  const oneShots: OneShotRequest<unknown>[] = [];
  const kept = options.kept ?? new Set<string>();
  let nextTurn = 0;
  let nextReply = 0;

  // A stopped request fails whatever its reply, as Claude's does (claude.ts).
  async function oneShot<T>(
    request: OneShotRequest<T>,
  ): Promise<OneShotResult<T>> {
    oneShots.push(request);
    const { signal } = request;
    let reply =
      typeof replies === "function" ? replies(request) : replies[nextReply];
    nextReply += 1;
    while (reply !== undefined && "later" in reply) {
      const next = await Promise.race([reply.later, whenStopped(signal)]);
      if (next === STOP) return stopped();
      reply = next;
    }
    if (reply === undefined) {
      return {
        ok: false,
        error: `The fake backend has no scripted reply ${nextReply}.`,
      };
    }
    if ("hold" in reply) {
      if (signal !== undefined) await whenStopped(signal);
      return stopped();
    }
    if (signal?.aborted === true) return stopped();
    if ("fail" in reply) return { ok: false, error: reply.fail };
    return checkReply(request.schema, reply.output);
  }

  async function startSession(options: SessionOptions): Promise<TutorSession> {
    sessions.push(options);
    const { resumeId } = options;
    if (resumeId !== undefined && !kept.has(resumeId)) {
      throw new SessionNotFound(resumeId);
    }
    // Unique across backends that share their kept sessions.
    const id = resumeId ?? `${FAKE_SESSION}${randomUUID()}`;
    if (options.cwd !== undefined) kept.add(id);
    ids.push(id);
    let interrupted = false;
    let ended = false;
    let release: (() => void) | undefined;

    async function* send(turn: EngineTurn): AsyncGenerator<BackendEvent> {
      received.push(turn);
      interrupted = false;
      const entry =
        typeof script === "function" ? script(turn, options) : script[nextTurn];
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
        if (interrupted || ended) break;
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
      backendSessionId: id,
      send,
      async interrupt() {
        interrupted = true;
        release?.();
        release = undefined;
      },
      async close() {
        if (!ended) closedIds.push(id);
        ended = true;
        release?.();
        release = undefined;
      },
    };
  }

  return {
    received,
    calls,
    sessions,
    ids,
    closed: closedIds,
    oneShots,
    startSession,
    oneShot,
  };
}

const STOP = Symbol("stopped");

/** Resolves once the signal is aborted, at once if it is; never without one. */
function whenStopped(signal: AbortSignal | undefined): Promise<typeof STOP> {
  return new Promise((resolve) => {
    if (signal === undefined) return;
    if (signal.aborted) resolve(STOP);
    else signal.addEventListener("abort", () => resolve(STOP), { once: true });
  });
}

function stopped(): OneShotResult<never> {
  return { ok: false, error: "The request was stopped." };
}
