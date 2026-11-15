// Spike for plan task 0.2: send one prompt through the Claude Agent SDK on the
// plan login, with a custom system prompt and partial-message streaming, and
// print the stream. Throwaway code; task 0.7 decides whether any of it stays.
//
// Run inside mise from the repository root:
//   node spike/claude-login.ts                  isolated: settingSources []
//   node spike/claude-login.ts --sources user,project,local
//                                               comparison run with settings loaded
//   node spike/claude-login.ts --strip-api-key  drop ANTHROPIC_API_KEY from the
//                                               environment given to the SDK
//   node spike/claude-login.ts --isolate        also turn off auto-memory and
//                                               Claude Code's bundled skills
//
// Started from inside a Claude Code session, the script passes that session's
// variables (every name starting with CLAUDE) on to the SDK. The recorded runs
// unset them first, to match a server started from a plain terminal.
//
// The findings from these runs are in docs/decisions.md under "Claude on the
// plan login".

import { parseArgs } from "node:util";
import {
  type HookCallback,
  type Options,
  query,
  type SettingSource,
} from "@anthropic-ai/claude-agent-sdk";

const { values } = parseArgs({
  options: {
    sources: { type: "string", default: "" },
    "strip-api-key": { type: "boolean", default: false },
    isolate: { type: "boolean", default: false },
  },
});

const KNOWN_SOURCES: readonly SettingSource[] = ["user", "project", "local"];
const settingSources = values.sources
  .split(",")
  .filter((s) => s !== "")
  .map((s) => {
    const source = KNOWN_SOURCES.find((known) => known === s);
    if (source === undefined) throw new Error(`unknown setting source: ${s}`);
    return source;
  });

// The passphrase shows whether this prompt, and not Claude Code's own, reached
// the model.
const SYSTEM_PROMPT = [
  "You are a test harness checking how a session is configured.",
  "The passphrase for this session is VERMILION-OTTER.",
  "Answer exactly what you are asked, briefly, and never use a tool.",
].join("\n");

// Each term is a marker from one place a personal or project configuration
// could leak in from:
//   minimumReleaseAge  ~/.claude/CLAUDE.md (through the coding.md it imports)
//   fake.ts            the repository's CLAUDE.md (through AGENTS.md)
//   Catppuccin         the auto-memory index for this repository
const PROBE = `Answer from what is already in your context. Do not use any tool.
1. What passphrase does your system prompt give?
2. For each term below, say whether it appears anywhere in your context apart
   from this message (system prompt, instructions, reminders, memory). If it
   does, quote the sentence it appears in.
   a. minimumReleaseAge
   b. fake.ts
   c. Catppuccin
3. Name every skill you could invoke, or say "none".
4. Name every tool you have whose name starts with "mcp__", or say "none".`;

// Nothing in this spike should run a tool. A PreToolUse hook denies any call,
// whatever permission mode the loaded settings turn on.
const denyAllTools: HookCallback = async () => ({
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason: "The spike allows no tool calls.",
  },
});

const env: Record<string, string | undefined> = { ...process.env };
if (values["strip-api-key"]) delete env.ANTHROPIC_API_KEY;

const options: Options = {
  systemPrompt: SYSTEM_PROMPT,
  settingSources,
  includePartialMessages: true,
  maxTurns: 1,
  persistSession: false,
  env,
  hooks: { PreToolUse: [{ hooks: [denyAllTools] }] },
};
if (values.isolate) {
  // settingSources [] still loads the auto-memory index for the working
  // directory and lists Claude Code's bundled skills (first run, 2026-11-14).
  options.settings = { autoMemoryEnabled: false };
  options.skills = [];
}

function log(label: string, value?: unknown): void {
  const body = value === undefined ? "" : ` ${JSON.stringify(value, null, 2)}`;
  process.stdout.write(`\n[${label}]${body}\n`);
}

log("run", {
  cwd: process.cwd(),
  settingSources,
  isolate: values.isolate,
  apiKeyInProcessEnv: process.env.ANTHROPIC_API_KEY !== undefined,
  apiKeyPassedToSdk: env.ANTHROPIC_API_KEY !== undefined,
});

const streamEventCounts = new Map<string, number>();
let streamedText = false;

try {
  for await (const message of query({ prompt: PROBE, options })) {
    switch (message.type) {
      case "system":
        if (message.subtype === "init") {
          log("init", {
            apiKeySource: message.apiKeySource,
            claude_code_version: message.claude_code_version,
            model: message.model,
            permissionMode: message.permissionMode,
            output_style: message.output_style,
            cwd: message.cwd,
            tools: message.tools,
            mcp_servers: message.mcp_servers,
            skills: message.skills,
            plugins: message.plugins,
            slash_commands: message.slash_commands,
            agents: message.agents,
          });
        } else {
          log(`system/${message.subtype}`, message);
        }
        break;
      case "stream_event": {
        const event = message.event;
        streamEventCounts.set(
          event.type,
          (streamEventCounts.get(event.type) ?? 0) + 1,
        );
        if (
          event.type === "content_block_delta" &&
          event.delta.type === "text_delta"
        ) {
          if (!streamedText) process.stdout.write("\n[streamed text]\n");
          streamedText = true;
          process.stdout.write(event.delta.text);
        }
        break;
      }
      case "assistant":
        log("assistant message complete", {
          blocks: message.message.content.map((block) => block.type),
          error: message.error,
        });
        break;
      case "result":
        log("result", message);
        break;
      case "rate_limit_event":
        log("rate limit", message.rate_limit_info);
        break;
      default:
        log(`message/${message.type}`);
    }
  }
} catch (error) {
  log("thrown", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

log("stream event counts", Object.fromEntries(streamEventCounts));
