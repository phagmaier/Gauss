// The Claude backend, built on the Agent SDK with the options found in stage 0
// (docs/decisions.md, tasks 0.2 to 0.4). One long-lived `query()` per
// session: each engine turn is pushed onto its input stream, and the turn's
// messages are read until its `result`.
//
// A one-shot request (the grader, task 2.8) is a `query()` of its own, with
// the SDK's structured output: the model's reply comes back as JSON in the
// schema's shape.
//
// Not yet here (task 1.3): resume, the course folder as working directory,
// and built-in tools and their confinement.

import { randomUUID } from "node:crypto";
import {
  createSdkMcpServer,
  type HookCallback,
  type Options,
  query,
  type SDKMessage,
  type SDKResultMessage,
  type SDKUserMessage,
  tool,
} from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import {
  type BackendEvent,
  checkReply,
  type EngineTurn,
  type OneShotRequest,
  type OneShotResult,
  type SessionOptions,
  type TutorBackend,
  type TutorSession,
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

/**
 * The grader's model (task 2.9; docs/decisions.md, "Grader prompt"). On the
 * hand-graded set, Sonnet 5.5 agreed with every hand grade and kept to the
 * prompt's rules for the flaw; Haiku 5.5 marked a correct answer in plain
 * words incorrect.
 */
export const GRADER_MODEL = "claude-sonnet-5-5";

export function createClaudeBackend(
  backendOptions: ClaudeBackendOptions = {},
): TutorBackend {
  return {
    startSession: (options) => startSession(options, backendOptions),
    oneShot: (request) => oneShot(request, backendOptions),
  };
}

/**
 * The environment the SDK runs in, without what could take it off the plan
 * login. `ANTHROPIC_API_KEY` takes precedence over the login (task 0.2), and
 * the other `ANTHROPIC_` variables can send requests elsewhere or sign them
 * another way (`ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, and the rest;
 * task 2.8). Variables starting with `CLAUDE` are what a Claude Code session
 * passes to the programs it starts, and they include the cloud-provider
 * switches (`CLAUDE_CODE_USE_BEDROCK` and the like); without a switch, the
 * providers' own credentials are not used.
 */
export function sdkEnvironment(
  base: NodeJS.ProcessEnv,
): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(base)) {
    if (name.startsWith("ANTHROPIC_") || name.startsWith("CLAUDE")) continue;
    env[name] = value;
  }
  return env;
}

/**
 * The options that keep the learner's own Claude Code setup out of a
 * session (tasks 0.2 and 0.3), with no built-in tools, and never
 * ToolSearch (task 0.3).
 */
function isolated(backendOptions: ClaudeBackendOptions): Options {
  return {
    ...(backendOptions.model === undefined
      ? {}
      : { model: backendOptions.model }),
    settingSources: [],
    skills: [],
    settings: { autoMemoryEnabled: false, disableClaudeAiConnectors: true },
    strictMcpConfig: true,
    env: sdkEnvironment(process.env),
    tools: [],
  };
}

async function oneShot<T>(
  request: OneShotRequest<T>,
  backendOptions: ClaudeBackendOptions,
): Promise<OneShotResult<T>> {
  const abortController = new AbortController();
  const stop = () => abortController.abort();
  if (request.signal?.aborted === true) stop();
  request.signal?.addEventListener("abort", stop, { once: true });
  let result: SDKResultMessage | undefined;
  try {
    const messages = query({
      prompt: request.prompt,
      options: {
        ...isolated(backendOptions),
        systemPrompt: request.systemPrompt,
        // The SDK checks the reply against JSON Schema draft 7.
        outputFormat: {
          type: "json_schema",
          schema: z.toJSONSchema(request.schema, { target: "draft-7" }),
        },
        persistSession: false,
        abortController,
      },
    });
    for await (const message of messages) {
      if (message.type === "system" && message.subtype === "init") {
        console.info(`Claude one-shot request on ${message.model}`);
      }
      if (message.type === "result") result = message;
    }
  } catch (error) {
    // A single request throws after it yields an error result; that result
    // says more than the error, so it is read below if there is one.
    if (result === undefined) {
      return {
        ok: false,
        error: abortController.signal.aborted
          ? "The request was stopped."
          : error instanceof Error
            ? error.message
            : String(error),
      };
    }
  } finally {
    request.signal?.removeEventListener("abort", stop);
  }
  return readOneShot(request, result, abortController.signal.aborted);
}

/** What a one-shot request's result message comes to. */
export function readOneShot<T>(
  request: Pick<OneShotRequest<T>, "schema">,
  result: SDKResultMessage | undefined,
  stopped: boolean,
): OneShotResult<T> {
  if (stopped) return { ok: false, error: "The request was stopped." };
  if (result === undefined) {
    return { ok: false, error: "The request ended without a result." };
  }
  if (result.subtype === "error_max_structured_output_retries") {
    return {
      ok: false,
      error: "The model's reply was not in the shape asked for, after retries.",
    };
  }
  if (result.subtype !== "success" || result.is_error) {
    const error =
      result.subtype === "success"
        ? result.result
        : result.errors.join("; ") || result.subtype;
    return { ok: false, error };
  }
  if (result.structured_output === undefined) {
    return { ok: false, error: "The reply had no structured output." };
  }
  return checkReply(request.schema, result.structured_output);
}

async function startSession(
  options: SessionOptions,
  backendOptions: ClaudeBackendOptions,
): Promise<TutorSession> {
  const sessionId = randomUUID();
  const inbox = createInbox();
  let interruptRequested = false;

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
        if (interruptRequested) {
          return {
            content: [{ type: "text", text: "The learner stopped this turn." }],
            isError: true,
          };
        }
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
    if (interruptRequested) {
      return { continue: false, stopReason: "The learner stopped this turn." };
    }
    if (!endTurnRequested) return {};
    endTurnRequested = false;
    return { continue: false, stopReason: "A teaching tool ended the turn." };
  };
  // interrupt() alone leaves pending SDK input runnable. Stop it at pickup
  // instead; continue:false still produces the result send() must drain.
  const cancelPendingTurn: HookCallback = async () =>
    interruptRequested
      ? { continue: false, stopReason: "The learner stopped this turn." }
      : {};

  const session = query({
    prompt: inbox.messages,
    options: {
      ...isolated(backendOptions),
      systemPrompt: options.systemPrompt,
      sessionId,
      mcpServers: {
        [SERVER]: createSdkMcpServer({ name: SERVER, tools, alwaysLoad: true }),
      },
      allowedTools: options.tools.map((t) => TOOL_PREFIX + t.name),
      hooks: {
        UserPromptSubmit: [{ hooks: [cancelPendingTurn], onFailure: "block" }],
        PostToolUse: [{ hooks: [endTurn] }],
      },
      includePartialMessages: true,
      // Resume needs this on (task 0.4); the minimal page does not resume.
      persistSession: false,
    },
  });
  // Read by hand, not with for-await: leaving a for-await loop would close
  // the whole query, and each turn reads only its own share of messages.
  const messages = session[Symbol.asyncIterator]();
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
    let interruptedOnStart = false;
    while (true) {
      let next: IteratorResult<SDKMessage, void>;
      try {
        next = await messages.next();
        // The prompt hook may already have passed when Stop arrives, while
        // the CLI has not armed its abort controller yet. Once a response
        // starts, interrupt again against that live controller.
        if (
          interruptRequested &&
          !interruptedOnStart &&
          !next.done &&
          next.value.type === "stream_event" &&
          next.value.parent_tool_use_id === null &&
          next.value.event.type === "message_start"
        ) {
          interruptedOnStart = true;
          await session.interrupt();
        }
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
      // Drain to the result without publishing output buffered after Stop.
      if (interruptRequested && message.type !== "result") continue;
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
  if (interruptRequested) {
    return { type: "turn_end", outcome: "interrupted" };
  }
  if (result.subtype === "success" && !result.is_error) {
    if (result.terminal_reason === "hook_stopped") {
      return { type: "turn_end", outcome: "ended_by_tool" };
    }
    return {
      type: "turn_end",
      outcome: "done",
    };
  }
  if (result.terminal_reason?.startsWith("aborted")) {
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
