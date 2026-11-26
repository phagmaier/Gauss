// A scripted backend for automated tests, which never call a real model
// (AGENTS.md). Each scripted turn lists what the "tutor" does in order: write
// text, call a teaching tool, call a file or shell tool, search the web, or
// hold until it is interrupted. Tool calls run the real teaching tool, and a
// call that ends the turn ends it here too. A write or a command asks the
// engine first, as Claude's hook does, and a file written is reported;
// nothing is written, unless a Write gives the file's content (a code
// question's starter file, task 3.7), which is written in the working
// folder. A search is reported with the pages scripted for it, in a session
// given web search, unless the engine refuses it; in another, it is refused
// as a tool it does not have.
// One-shot requests get the scripted replies in order, checked against the
// request's schema as the real backends check theirs. In place of a list, a
// function can answer every turn or request it is given, without end
// (scripted.ts, which runs the dev server of task 2.12b).
//
// A session started with a working directory is kept and can be found and
// resumed by its id only in that folder. An unavailable resume fails with
// SessionNotFound. Backends sharing their kept sessions can resume each
// other's sessions, as a server does after a restart. The script goes on
// across a resume: the fake has no conversation to carry. Created with
// `keepsTools`, it reports the tools a session begins with, as Codex's
// adapter does (`SessionBackend.toolNames`).

import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { WebResult } from "../../shared/events.ts";
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
  /** A file or shell tool; Write and Edit name the file, relative to the working folder. */
  | {
      builtIn: "Read" | "Write" | "Edit" | "Bash";
      path?: string;
      /** A Write's content: given, the file is written, once the engine allows it. */
      content?: string;
      run_in_background?: boolean;
      /**
       * Called after a mutation is admitted and logged, so tests can observe
       * its start. The returned promise holds the mutation open.
       */
      until?: () => Promise<void>;
    }
  /** WebSearch, which reports the pages given (task 4.11). */
  | { search: string; results: WebResult[] }
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

/** Saved fake sessions; share the store to simulate a restart. */
export class KeptSessions {
  readonly #folders = new Map<string, string>();

  create(cwd: string): string {
    const id = `${FAKE_SESSION}${randomUUID()}`;
    this.#folders.set(id, cwd);
    return id;
  }

  has(id: string, cwd: string): boolean {
    return this.#folders.get(id) === cwd;
  }

  delete(id: string): void {
    this.#folders.delete(id);
  }

  clear(): void {
    this.#folders.clear();
  }
}

export function createFakeBackend(
  script: FakeTurn[] | FakeScript,
  replies: FakeReply[] | ((request: OneShotRequest<unknown>) => FakeReply) = [],
  options: {
    /** Shared between backends to resume across a restart; its own if not given. */
    kept?: Pick<KeptSessions, "create" | "has">;
    /** Reports `toolNames`, as a backend whose sessions keep their tools. */
    keepsTools?: boolean;
  } = {},
): FakeBackend {
  const received: EngineTurn[] = [];
  const calls: FakeCall[] = [];
  const sessions: SessionOptions[] = [];
  const ids: string[] = [];
  const closedIds: string[] = [];
  const oneShots: OneShotRequest<unknown>[] = [];
  const kept = options.kept ?? new KeptSessions();
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
    const { cwd, resumeId } = options;
    if (
      resumeId !== undefined &&
      (cwd === undefined || !kept.has(resumeId, cwd))
    ) {
      throw new SessionNotFound(resumeId);
    }
    const id =
      resumeId ??
      (cwd === undefined ? `${FAKE_SESSION}${randomUUID()}` : kept.create(cwd));
    ids.push(id);
    let interrupted = false;
    let ended = false;
    let release: (() => void) | undefined;
    const mutations = new Set<() => void>();

    async function* send(
      turn: EngineTurn,
      signal?: AbortSignal,
    ): AsyncGenerator<BackendEvent> {
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
        } else if ("builtIn" in step) {
          yield { type: "tool_call", name: step.builtIn };
          const reservation = await builtIn(options, step);
          if (interrupted || ended) {
            reservation.release?.();
            break;
          }
          if (reservation.release !== undefined) {
            mutations.add(reservation.release);
          }
          const { result } = reservation;
          try {
            calls.push({ name: step.builtIn, input: step, result });
            if (result.status === "done" && step.until !== undefined) {
              const stopped = Promise.withResolvers<void>();
              release = stopped.resolve;
              await Promise.race([step.until(), stopped.promise]);
              release = undefined;
            }
            if (
              result.status === "done" &&
              !interrupted &&
              !ended &&
              step.path !== undefined &&
              (step.builtIn === "Write" || step.builtIn === "Edit")
            ) {
              yield { type: "file_written", path: step.path };
            }
          } finally {
            if (reservation.release !== undefined) {
              reservation.release();
              mutations.delete(reservation.release);
            }
          }
        } else if ("search" in step) {
          const { search: query, results } = step;
          if (options.webSearch !== true) {
            calls.push({
              name: "WebSearch",
              input: { query },
              result: { status: "refused", text: "No such tool: WebSearch" },
            });
            continue;
          }
          yield { type: "tool_call", name: "WebSearch" };
          // The engine is asked first, as Claude's hook asks it.
          const refused = await options.searchRefusal?.();
          calls.push({
            name: "WebSearch",
            input: { query },
            result:
              refused === undefined
                ? { status: "done", text: "" }
                : { status: "refused", text: refused },
          });
          if (refused === undefined) {
            yield { type: "web_searched", query, results };
          }
        } else if ("call" in step) {
          yield { type: "tool_call", name: step.call };
          const tool = options.tools.find((t) => t.name === step.call);
          const result: ToolResult =
            tool === undefined
              ? { status: "refused", text: `No such tool: ${step.call}` }
              : await tool.run(step.input, signal);
          calls.push({ name: step.call, input: step.input, result });
          if (result.endTurn === true) {
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
        for (const release of mutations) release();
        mutations.clear();
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
    hasSession: async (id, cwd) => kept.has(id, cwd),
    ...(options.keepsTools === true
      ? {
          toolNames: ({
            tools,
            cwd,
            workspace,
          }: Pick<SessionOptions, "tools" | "cwd" | "workspace">) =>
            [
              ...tools.map((tool) => tool.name),
              ...(workspace === undefined || cwd === undefined
                ? []
                : ["Bash", "Edit", "Read", "Write"]),
            ].sort(),
        }
      : {}),
    oneShot,
  };
}

/** Mirrors the real adapter's reservation, with no real file or command. */
async function builtIn(
  options: SessionOptions,
  step: Extract<FakeStep, { builtIn: string }>,
): Promise<{ result: ToolResult; release?: () => void }> {
  if (options.workspace === undefined) {
    return {
      result: { status: "refused", text: `No such tool: ${step.builtIn}` },
    };
  }
  if (step.builtIn === "Bash" && step.run_in_background === true) {
    return {
      result: {
        status: "refused",
        text: "Background commands are not allowed. Run the command in the foreground.",
      },
    };
  }
  const reservation =
    step.builtIn === "Read" ? undefined : await options.workspace.acquire();
  if (reservation !== undefined && "refused" in reservation) {
    return { result: { status: "refused", text: reservation.refused } };
  }
  const { cwd } = options;
  if (
    step.builtIn === "Write" &&
    step.content !== undefined &&
    step.path !== undefined &&
    cwd !== undefined
  ) {
    const at = join(cwd, step.path);
    try {
      await mkdir(dirname(at), { recursive: true });
      await writeFile(at, step.content);
    } catch (error) {
      reservation?.release();
      const message = error instanceof Error ? error.message : String(error);
      return {
        result: { status: "refused", text: `Write failed: ${message}` },
      };
    }
  }
  return {
    result: { status: "done", text: `${step.builtIn} ran.` },
    ...(reservation === undefined ? {} : { release: reservation.release }),
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
