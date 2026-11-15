// The Claude backend, built on the Agent SDK with the options found in stage 0
// (docs/decisions.md, tasks 0.2 to 0.4). One long-lived `query()` per
// session: each engine turn is pushed onto its input stream, and the turn's
// messages are read until its `result`.
//
// Not yet here (task 1.3): resume, the course folder as working directory,
// built-in tools and their confinement, and one-shot calls.

import { randomUUID } from "node:crypto";
import {
  createSdkMcpServer,
  type HookCallback,
  query,
  type SDKMessage,
  type SDKResultMessage,
  type SDKUserMessage,
  tool,
} from "@anthropic-ai/claude-agent-sdk";
import type {
  BackendEvent,
  EngineTurn,
  SessionOptions,
  TutorBackend,
  TutorSession,
} from "./backend.ts";

const SERVER = "gauss";
const TOOL_PREFIX = `mcp__${SERVER}__`;

export interface ClaudeBackendOptions {
  /**
   * The model, such as "claude-haiku-5-5". Left out, the session uses the
   * default of the learner's Claude Code login. Development runs that only
   * check that something works use a cheap model (AGENTS.md).
   */
  model?: string;
}

export function createClaudeBackend(
  backendOptions: ClaudeBackendOptions = {},
): TutorBackend {
  return {
    startSession: (options) => startSession(options, backendOptions),
  };
}

/**
 * The environment the SDK runs in. `ANTHROPIC_API_KEY` would take precedence
 * over the plan login (task 0.2). Variables starting with `CLAUDE` are what a
 * Claude Code session passes to the programs it starts, so they are dropped
 * as well, as in every stage 0 run.
 */
export function sdkEnvironment(
  base: NodeJS.ProcessEnv,
): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(base)) {
    if (name === "ANTHROPIC_API_KEY" || name.startsWith("CLAUDE")) continue;
    env[name] = value;
  }
  return env;
}

async function startSession(
  options: SessionOptions,
  backendOptions: ClaudeBackendOptions,
): Promise<TutorSession> {
  const sessionId = randomUUID();
  const inbox = createInbox();

  // A teaching tool asks for the end of the turn through its result; the
  // PostToolUse hook carries it out (task 0.3). A refused call leaves the
  // flag unset, so the model sees the reason and can try again.
  let endTurnRequested = false;
  const tools = options.tools.map((teachingTool) =>
    tool(
      teachingTool.name,
      teachingTool.description,
      teachingTool.inputShape,
      async (args) => {
        const result = await teachingTool.run(args);
        if (result.status === "done" && result.endTurn === true) {
          endTurnRequested = true;
        }
        return {
          content: [{ type: "text", text: result.text }],
          ...(result.status === "refused" ? { isError: true } : {}),
        };
      },
    ),
  );
  const endTurn: HookCallback = async () => {
    if (!endTurnRequested) return {};
    endTurnRequested = false;
    return { continue: false, stopReason: "A teaching tool ended the turn." };
  };

  const session = query({
    prompt: inbox.messages,
    options: {
      systemPrompt: options.systemPrompt,
      ...(backendOptions.model === undefined
        ? {}
        : { model: backendOptions.model }),
      sessionId,
      // Isolation from the learner's own Claude Code setup (tasks 0.2, 0.3).
      settingSources: [],
      skills: [],
      settings: { autoMemoryEnabled: false, disableClaudeAiConnectors: true },
      strictMcpConfig: true,
      env: sdkEnvironment(process.env),
      // No built-in tools yet, and never ToolSearch (task 0.3).
      tools: [],
      mcpServers: {
        [SERVER]: createSdkMcpServer({ name: SERVER, tools, alwaysLoad: true }),
      },
      allowedTools: options.tools.map((t) => TOOL_PREFIX + t.name),
      hooks: { PostToolUse: [{ hooks: [endTurn] }] },
      includePartialMessages: true,
      // Resume needs this on (task 0.4); the minimal page does not resume.
      persistSession: false,
    },
  });
  // Read by hand, not with for-await: leaving a for-await loop would close
  // the whole query, and each turn reads only its own share of messages.
  const messages = session[Symbol.asyncIterator]();
  let interruptRequested = false;
  let finished: string | undefined;

  async function* send(turn: EngineTurn): AsyncGenerator<BackendEvent> {
    if (finished !== undefined) {
      yield { type: "turn_end", outcome: "error", error: finished };
      return;
    }
    interruptRequested = false;
    endTurnRequested = false;
    inbox.push(turn.text);
    const reader = createTurnReader();
    while (true) {
      let next: IteratorResult<SDKMessage, void>;
      try {
        next = await messages.next();
      } catch (error) {
        finished = error instanceof Error ? error.message : String(error);
        yield { type: "turn_end", outcome: "error", error: finished };
        return;
      }
      if (next.done === true) {
        finished = "The Claude session ended.";
        yield { type: "turn_end", outcome: "error", error: finished };
        return;
      }
      const message = next.value;
      if (message.type === "system" && message.subtype === "init") {
        // So a development run shows which model it is spending.
        console.info(`Claude session ${sessionId} on ${message.model}`);
      }
      for (const event of reader.read(message, interruptRequested)) {
        yield event;
        if (event.type === "turn_end") return;
      }
    }
  }

  return {
    backendSessionId: sessionId,
    send,
    async interrupt() {
      interruptRequested = true;
      await session.interrupt();
    },
    async close() {
      inbox.close();
      session.close();
    },
  };
}

/**
 * Turns one turn's SDK messages into backend events. Separate text blocks in
 * a turn are joined with a blank line. Messages from subagents are skipped.
 */
export function createTurnReader() {
  let textBlocks = 0;
  return {
    read(message: SDKMessage, interruptRequested: boolean): BackendEvent[] {
      switch (message.type) {
        case "stream_event": {
          if (message.parent_tool_use_id !== null) return [];
          const event = message.event;
          if (
            event.type === "content_block_start" &&
            event.content_block.type === "text"
          ) {
            textBlocks += 1;
            return textBlocks > 1 ? [{ type: "text", text: "\n\n" }] : [];
          }
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            return [{ type: "text", text: event.delta.text }];
          }
          return [];
        }
        case "assistant": {
          if (message.parent_tool_use_id !== null) return [];
          const events: BackendEvent[] = [];
          for (const block of message.message.content) {
            if (block.type === "tool_use") {
              const name = block.name.startsWith(TOOL_PREFIX)
                ? block.name.slice(TOOL_PREFIX.length)
                : block.name;
              events.push({ type: "tool_call", name });
            }
          }
          return events;
        }
        case "result":
          return [turnEnd(message, interruptRequested)];
        default:
          return [];
      }
    },
  };
}

function turnEnd(
  result: SDKResultMessage,
  interruptRequested: boolean,
): BackendEvent {
  if (result.subtype === "success" && !result.is_error) {
    if (result.terminal_reason === "hook_stopped") {
      return { type: "turn_end", outcome: "ended_by_tool" };
    }
    return {
      type: "turn_end",
      outcome: interruptRequested ? "interrupted" : "done",
    };
  }
  if (interruptRequested || result.terminal_reason?.startsWith("aborted")) {
    return { type: "turn_end", outcome: "interrupted" };
  }
  const error =
    result.subtype === "success"
      ? result.result
      : result.errors.join("; ") || result.subtype;
  return { type: "turn_end", outcome: "error", error };
}

/** The session's input: one user message per engine turn, pushed as it comes. */
function createInbox() {
  const pending: SDKUserMessage[] = [];
  let wake: (() => void) | undefined;
  let closed = false;
  async function* messages(): AsyncGenerator<SDKUserMessage> {
    while (true) {
      const next = pending.shift();
      if (next !== undefined) {
        yield next;
        continue;
      }
      if (closed) return;
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
    }
  }
  function poke() {
    wake?.();
    wake = undefined;
  }
  return {
    messages: messages(),
    push(text: string) {
      pending.push({
        type: "user",
        message: { role: "user", content: text },
        parent_tool_use_id: null,
        // The engine relays what the learner did.
        origin: { kind: "human" },
      });
      poke();
    },
    close() {
      closed = true;
      poke();
    },
  };
}
