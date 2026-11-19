// The Claude backend, built on the Agent SDK with the options found in stage 0
// (docs/decisions.md, "Claude backend"). One long-lived `query()` per
// session: each engine turn is pushed onto its input stream, and the turn's
// messages are read until its `result`.
//
// A session given a working directory, a unit's tutor or an intake, is kept
// by the SDK and can be resumed by its id (tasks 2.14 and 2.15); its system
// prompt is sent afresh with every request, so a resumed session gets the
// current one.
//
// A one-shot request (the grader, task 2.8) is a `query()` of its own, with
// the SDK's structured output: the model's reply comes back as JSON in the
// schema's shape.
//
// A tutor's session gets the file and shell tools, confined to its course's
// workspace (task 3.3; decisions.md, "Confinement"): writes by the file tools
// only there, commands only in Claude Code's sandbox, and a temporary folder
// of its own. The engine can refuse a write or a command, which a PreToolUse
// hook asks it about.

import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import {
  createSdkMcpServer,
  getSessionInfo,
  type HookCallback,
  type Options,
  query,
  type SDKMessage,
  type SDKResultMessage,
  type SDKUserMessage,
  tool,
} from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { sandboxCommand } from "../sandbox-command.ts";
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

const SERVER = "gauss";
const TOOL_PREFIX = `mcp__${SERVER}__`;
const execute = promisify(execFile);
const SESSION_LOOKUP = `
  import { getSessionInfo } from ${JSON.stringify(import.meta.resolve("@anthropic-ai/claude-agent-sdk"))};
  const found = await getSessionInfo(process.argv[1], { dir: process.argv[2] });
  process.stdout.write(String(found !== undefined));
`;

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

/**
 * The help judge's model (task 2.21; docs/decisions.md, "Help judge"),
 * picked on the hand-judged set in `scripts/help-set.ts`.
 */
export const JUDGE_MODEL = "claude-haiku-5-5";

/**
 * The dispute judge's model (task 3.9; docs/decisions.md, "Disputes"). On
 * the hand-judged set in `scripts/dispute-set.ts` it agreed with every hand
 * outcome; so did Haiku 5.5, but a dispute reviews the grader's work, which
 * is Sonnet's.
 */
export const DISPUTE_MODEL = "claude-sonnet-5-5";

/**
 * The handoff writer's model (task 5.7; docs/decisions.md, "Mastery
 * loop"): Haiku 5.5 until task 5.13 compares it with Sonnet 5.5 on the
 * same stretches.
 */
export const HANDOFF_MODEL = "claude-haiku-5-5";

export function createClaudeBackend(
  backendOptions: ClaudeBackendOptions = {},
): TutorBackend {
  return {
    startSession: (options) => startSession(options, backendOptions),
    hasSession,
    oneShot: (request) => oneShot(request, backendOptions),
  };
}

async function hasSession(id: string, cwd: string): Promise<boolean> {
  if (process.env.CLAUDE_CONFIG_DIR === undefined) {
    return (await getSessionInfo(id, { dir: cwd })) !== undefined;
  }
  // The SDK's file lookup has no env/root option. A custom inherited root
  // must not hide sessions kept by isolated(), which strips that override.
  // Only this case pays for a short Node process; it never starts Claude.
  const { stdout } = await execute(
    process.execPath,
    ["--input-type=module", "--eval", SESSION_LOOKUP, "--", id, cwd],
    { env: sdkEnvironment(process.env), encoding: "utf8" },
  );
  return stdout === "true";
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

/** The settings that keep the learner's own Claude Code setup out (task 0.2). */
const ISOLATED_SETTINGS = {
  autoMemoryEnabled: false,
  disableClaudeAiConnectors: true,
} as const;

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
    settings: ISOLATED_SETTINGS,
    strictMcpConfig: true,
    env: sdkEnvironment(process.env),
    tools: [],
  };
}

/** The file and shell tools a tutor gets (task 3.3). */
const WORKSPACE_TOOLS = ["Read", "Glob", "Grep", "Write", "Edit", "Bash"];

/** The calls the engine is asked about: the writes and the commands. */
const CHANGES = new Set(["Write", "Edit", "Bash"]);

/** The file tools that write a file, whose path the thread shows. */
const WRITES = new Set(["Write", "Edit"]);

/**
 * The private temporary folder of the tutor working in `cwd`, one per
 * course (decisions.md, "Confinement"). Claude Code gives sandboxed
 * commands `<it>/claude-<uid>` as $TMPDIR only if that path is at most 44
 * bytes, and otherwise a folder shared by every Claude Code session of the
 * user; one in the course's folder would be longer. So it lies under /tmp,
 * named from the workspace's path.
 */
export function workspaceTmpDir(cwd: string): string {
  const name = createHash("sha256").update(cwd).digest("hex").slice(0, 8);
  return `/tmp/gauss-${name}`;
}

/**
 * The options that give a session the file and shell tools in `cwd`, which
 * replace the isolation options' tools, settings and environment and keep
 * their isolation. Anything not allowed is refused, never asked about.
 * Writes: the file tools only where the one Edit rule allows (it covers
 * Write), which blockWritesOutsideWorkingDirectories backs; commands only
 * in the sandbox, which must run and cannot be left, writing only in `cwd`
 * and the temporary folder, with no network. Reads are not confined.
 */
function workspaceOptions(cwd: string, tmpDir: string): Options {
  return {
    tools: WORKSPACE_TOOLS,
    permissionMode: "dontAsk",
    // "//" makes a rule absolute; the absolute cwd gives the second slash.
    // Without the rule for Bash, dontAsk refuses some sandboxed commands.
    allowedTools: [`Edit(/${cwd}/**)`, "Bash"],
    sandbox: {
      enabled: true,
      failIfUnavailable: true,
      autoAllowBashIfSandboxed: true,
      allowUnsandboxedCommands: false,
      network: { allowedDomains: [] },
    },
    settings: {
      ...ISOLATED_SETTINGS,
      permissions: { blockWritesOutsideWorkingDirectories: true },
    },
    env: {
      ...sdkEnvironment(process.env),
      CLAUDE_CODE_TMPDIR: tmpDir,
      CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: "1",
    },
  };
}

/**
 * Makes the folder, closed to other users, or checks that the one there is:
 * a folder and not a link, this user's, closed to others. /tmp is shared,
 * so another user could have made it first.
 */
async function makePrivateFolder(path: string): Promise<void> {
  try {
    await mkdir(path, { mode: 0o700 });
  } catch (error) {
    if (
      !(error instanceof Error && "code" in error && error.code === "EEXIST")
    ) {
      throw error;
    }
  }
  const found = await lstat(path);
  if (
    !found.isDirectory() ||
    found.uid !== process.getuid?.() ||
    (found.mode & 0o077) !== 0
  ) {
    throw new Error(
      `The tutor's temporary folder ${path} is not closed to other users.`,
    );
  }
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

/**
 * Where a session runs and whether it is kept (task 2.14). A kept session
 * runs in the folder given, where it must be resumed too, since the
 * folder it resumes in becomes its working directory (task 0.4). Its system
 * prompt is not recorded with it (`snapshot: false`): it is sent as given
 * with every request, so a resumed session gets the prompt it is resumed
 * with, not the one it started with. A new one is given its title, so Claude
 * Code does not generate one. A session that is not kept runs in the
 * server's folder, as before.
 */
export function sessionPlace(
  options: Pick<SessionOptions, "systemPrompt" | "cwd" | "resumeId" | "title">,
  sessionId: string,
): Options {
  const { systemPrompt, cwd, resumeId, title } = options;
  if (cwd === undefined) {
    if (resumeId !== undefined) {
      throw new Error("A session is resumed in the folder it was kept in.");
    }
    return { systemPrompt, sessionId, persistSession: false };
  }
  return {
    cwd,
    persistSession: true,
    systemPrompt: { type: "custom", prompt: systemPrompt, snapshot: false },
    // The SDK takes a session id of our choosing only for a new session, and
    // a title too: given one, Claude Code does not generate its own.
    ...(resumeId === undefined
      ? { sessionId, ...(title === undefined ? {} : { title }) }
      : { resume: resumeId }),
  };
}

/** The start of the error Claude Code gives for a session id it cannot find (task 0.4). */
const NOT_FOUND = "No conversation found with session ID";

async function startSession(
  options: SessionOptions,
  backendOptions: ClaudeBackendOptions,
): Promise<TutorSession> {
  const sessionId = options.resumeId ?? randomUUID();
  const place = sessionPlace(options, sessionId);
  const { workspace, cwd } = options;
  let builtIn: Options = {};
  if (workspace !== undefined) {
    if (cwd === undefined) {
      throw new Error("The file and shell tools need a working folder.");
    }
    const tmpDir = workspaceTmpDir(cwd);
    await makePrivateFolder(tmpDir);
    builtIn = workspaceOptions(cwd, tmpDir);
  }
  const inbox = createInbox();
  let interruptRequested = false;
  let closed = false;
  const mutations = new Map<string, () => void>();

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
  const endTurn: HookCallback = async (input) => {
    if (
      input.hook_event_name === "PostToolUse" ||
      input.hook_event_name === "PostToolUseFailure" ||
      input.hook_event_name === "PermissionDenied"
    ) {
      mutations.get(input.tool_use_id)?.();
      mutations.delete(input.tool_use_id);
    }
    if (input.hook_event_name === "PermissionDenied") return {};
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
  // The engine refuses writes and commands by phase, as it refuses teaching
  // tools; the reason goes to the model as the call's result.
  const askEngine: HookCallback = async (input, _id, { signal }) => {
    if (input.hook_event_name !== "PreToolUse") return {};
    if (!CHANGES.has(input.tool_name)) return {};
    let reason: string | undefined;
    if (interruptRequested || closed) {
      reason = "The learner stopped this turn.";
    } else if (
      input.tool_name === "Bash" &&
      typeof input.tool_input === "object" &&
      input.tool_input !== null &&
      "run_in_background" in input.tool_input &&
      input.tool_input.run_in_background === true
    ) {
      reason =
        "Background commands are not allowed. Run the command in the foreground.";
    } else if (workspace !== undefined) {
      const reservation = await workspace.acquire();
      if ("refused" in reservation) {
        reason = reservation.refused;
      } else if (closed || interruptRequested || signal.aborted) {
        reservation.release();
        reason = "The learner stopped this turn.";
      } else {
        mutations.set(input.tool_use_id, reservation.release);
      }
    }
    if (reason !== undefined) {
      return {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: reason,
        },
      };
    }
    if (
      process.platform === "linux" &&
      input.tool_name === "Bash" &&
      typeof input.tool_input === "object" &&
      input.tool_input !== null &&
      "command" in input.tool_input &&
      typeof input.tool_input.command === "string"
    ) {
      return {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "allow",
          updatedInput: {
            ...input.tool_input,
            command: `exec ${sandboxCommand(["bash", "-c", input.tool_input.command])}`,
          },
        },
      };
    }
    return {};
  };

  const session = query({
    prompt: inbox.messages,
    options: {
      ...isolated(backendOptions),
      ...place,
      ...builtIn,
      mcpServers: {
        [SERVER]: createSdkMcpServer({ name: SERVER, tools, alwaysLoad: true }),
      },
      allowedTools: [
        ...options.tools.map((t) => TOOL_PREFIX + t.name),
        ...(builtIn.allowedTools ?? []),
      ],
      hooks: {
        UserPromptSubmit: [{ hooks: [cancelPendingTurn], onFailure: "block" }],
        ...(workspace === undefined
          ? {}
          : {
              PreToolUse: [
                {
                  matcher: "Write|Edit|Bash",
                  hooks: [askEngine],
                  onFailure: "block",
                },
              ],
              PostToolUseFailure: [{ hooks: [endTurn], onFailure: "block" }],
              PermissionDenied: [{ hooks: [endTurn], onFailure: "block" }],
            }),
        PostToolUse: [{ hooks: [endTurn], onFailure: "block" }],
      },
      includePartialMessages: true,
    },
  });
  if (options.resumeId !== undefined) {
    // An id Claude Code cannot find fails while it starts, before any input
    // and any model request; a session it finds is ready once it has started
    // (task 2.14).
    try {
      await session.initializationResult();
    } catch (error) {
      inbox.close();
      session.close();
      closed = true;
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes(NOT_FOUND)) {
        throw new SessionNotFound(options.resumeId);
      }
      throw error;
    }
  }
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
    const reader = createTurnReader(cwd);
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
        closed = true;
        session.close();
        finished = error instanceof Error ? error.message : String(error);
        yield { type: "turn_end", outcome: "error", error: finished };
        return;
      }
      if (next.done === true) {
        closed = true;
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
      closed = true;
      inbox.close();
      session.close();
      // close() only starts the SDK's asynchronous shutdown. A missing
      // completion hook must leave its lease held, not permit a question
      // while command descendants may still be alive.
    },
  };
}

/**
 * Turns one turn's SDK messages into backend events. Separate text blocks in
 * a turn are joined with a blank line. Messages from subagents are skipped.
 * A file tool's write is reported once its result says it succeeded, with
 * the file's path in `cwd`.
 */
export function createTurnReader(cwd?: string) {
  let textBlocks = 0;
  /** The files that the file tools' calls not yet answered write, by call id. */
  const writing = new Map<string, string>();
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
              const path = filePath(block.input);
              if (WRITES.has(block.name) && path !== undefined) {
                writing.set(block.id, path);
              }
            }
          }
          return events;
        }
        case "user": {
          // Only the calls read above are looked for: a subagent's are not.
          const { content } = message.message;
          if (typeof content === "string") return [];
          const events: BackendEvent[] = [];
          for (const block of content) {
            if (block.type !== "tool_result") continue;
            const path = writing.get(block.tool_use_id);
            if (path === undefined) continue;
            writing.delete(block.tool_use_id);
            if (block.is_error !== true) {
              events.push({ type: "file_written", path: inFolder(cwd, path) });
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

/** The file a file tool's input names, if it names one. */
function filePath(input: unknown): string | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const path = (input as { file_path?: unknown }).file_path;
  return typeof path === "string" ? path : undefined;
}

/** A path relative to `cwd` if it lies inside it, and absolute otherwise. */
function inFolder(cwd: string | undefined, path: string): string {
  if (cwd === undefined) return path;
  const full = resolve(cwd, path);
  const inside = relative(cwd, full);
  return inside === "" ||
    inside === ".." ||
    inside.startsWith(`..${sep}`) ||
    isAbsolute(inside)
    ? full
    : inside;
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
