// Spike for plan task 0.6: one prompt through @openai/codex-sdk on the
// ChatGPT login, a custom tool server, and streamed text. Throwaway code;
// task 0.7 decides whether any of it stays.
//
// Run inside mise from the repository root:
//   node spike/codex.ts probe [--isolate]   instructions, AGENTS.md and tools
//   node spike/codex.ts tool [--isolate]    ask_question over MCP, then the answer
//
// --isolate adds the config overrides that try to keep the learner's own
// Codex setup out (see ISOLATION below).
//
// The tool server is a minimal MCP server over HTTP, in this process, so the
// real ask_question teaching tool runs here and can end the turn by aborting
// it. The findings are in docs/decisions.md under "Codex spike".

import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Codex, type Thread, type ThreadOptions } from "@openai/codex-sdk";
import { z } from "zod";
import { askQuestionTool } from "../src/server/tools/ask-question.ts";
import type { TeachingTool } from "../src/server/tools/tool.ts";
import { note } from "./isolated-options.ts";

const mode = process.argv[2];
const isolate = process.argv.includes("--isolate");
if (mode !== "probe" && mode !== "tool") {
  throw new Error("usage: node spike/codex.ts probe|tool [--isolate]");
}

const PASSPHRASE = "heron-417";
const INSTRUCTIONS = `You are a tutor in a teaching app called Gauss.
The passphrase for this session is ${PASSPHRASE}.
Write plain text, no Markdown. Keep every reply under 80 words.
To post a multiple-choice check question, call the ask_question tool.
Posting a question ends your turn: say anything you want to say before it.`;

// A working directory of its own, outside any repository.
const dir = mkdtempSync(join(tmpdir(), "gauss-codex-"));
const instructionsFile = join(dir, "instructions.md");
writeFileSync(instructionsFile, INSTRUCTIONS);

// --- A minimal MCP server over HTTP, running the real teaching tool -------

type JsonRpc = { id?: number | string; method: string; params?: unknown };

function startToolServer(
  tools: TeachingTool[],
  afterCall: (name: string, endTurn: boolean) => void,
) {
  async function handle(message: JsonRpc): Promise<unknown> {
    const params = (message.params ?? {}) as Record<string, unknown>;
    switch (message.method) {
      case "initialize":
        return {
          protocolVersion: params.protocolVersion,
          capabilities: { tools: {} },
          serverInfo: { name: "gauss", version: "0.0.0" },
        };
      case "ping":
        return {};
      case "tools/list":
        return {
          tools: tools.map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: z.toJSONSchema(z.object(t.inputShape)),
          })),
        };
      case "tools/call": {
        const tool = tools.find((t) => t.name === params.name);
        if (tool === undefined) throw new Error(`no tool ${params.name}`);
        const result = await tool.run(params.arguments);
        note(`tools/call ${tool.name}`, {
          arguments: params.arguments,
          result,
        });
        const endTurn = result.status === "done" && result.endTurn === true;
        // After the response has gone out.
        setImmediate(() => afterCall(tool.name, endTurn));
        return {
          content: [{ type: "text", text: result.text }],
          isError: result.status === "refused",
        };
      }
      default:
        throw new Error(`unsupported method ${message.method}`);
    }
  }

  const server = createServer(async (req, res) => {
    note(`mcp ${req.method}`);
    if (req.method !== "POST") {
      res.writeHead(405).end();
      return;
    }
    const body = JSON.parse(await readAll(req)) as JsonRpc | JsonRpc[];
    const batch = Array.isArray(body) ? body : [body];
    const replies: unknown[] = [];
    for (const message of batch) {
      note(`mcp ${message.method}`);
      if (message.id === undefined) continue; // a notification
      try {
        replies.push({
          jsonrpc: "2.0",
          id: message.id,
          result: await handle(message),
        });
      } catch (error) {
        replies.push({
          jsonrpc: "2.0",
          id: message.id,
          error: { code: -32601, message: String(error) },
        });
      }
    }
    if (replies.length === 0) {
      res.writeHead(202).end();
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(Array.isArray(body) ? replies : replies[0]));
  });
  return new Promise<{ url: string; close: () => void }>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}/mcp`,
        close: () => server.close(),
      });
    });
  });
}

function readAll(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

// --- Codex options -----------------------------------------------------------

// Only the variables the CLI needs. CODEX_HOME stays the default, where the
// ChatGPT login is stored.
const env: Record<string, string> = {};
for (const name of ["PATH", "HOME", "LANG", "TERM", "USER"]) {
  const value = process.env[name];
  if (value !== undefined) env[name] = value;
}

// Overrides that try to replace what the learner's ~/.codex/config.toml sets.
// The MCP servers are disabled by the names in this learner's config; a real
// backend could not know them.
const ISOLATION = {
  model_instructions_file: instructionsFile,
  project_doc_max_bytes: 0,
  include_environment_context: false,
  features: {
    apps: false,
    multi_agent: false,
    image_generation: false,
    goals: false,
    plugins: false,
    browser_use: false,
    computer_use: false,
    tool_search_always_defer_mcp_tools: false,
  },
  mcp_servers: {
    "codebase-memory": { enabled: false },
    playwright: { enabled: false },
    context7: { enabled: false },
  },
};

const threadOptions: ThreadOptions = {
  workingDirectory: dir,
  skipGitRepoCheck: true,
  sandboxMode: "read-only",
  approvalPolicy: "never",
  modelReasoningEffort: "low",
  webSearchMode: "disabled",
};

async function runTurn(
  thread: Thread,
  input: string,
  signal?: AbortSignal,
): Promise<void> {
  const started = Date.now();
  const at = () => `${((Date.now() - started) / 1000).toFixed(1)}s`;
  try {
    const { events } = await thread.runStreamed(
      input,
      signal === undefined ? {} : { signal },
    );
    for await (const event of events) {
      if (
        event.type === "item.started" ||
        event.type === "item.updated" ||
        event.type === "item.completed"
      ) {
        const item = event.item;
        const detail =
          item.type === "agent_message" || item.type === "reasoning"
            ? `${item.text.length} chars: ${item.text}`
            : item.type === "mcp_tool_call"
              ? `${item.server}.${item.tool} ${item.status}${item.error ? ` error: ${item.error.message}` : ""}`
              : JSON.stringify(item);
        note(`${at()} ${event.type} ${item.type}`, detail);
      } else {
        note(`${at()} ${event.type}`, event);
      }
    }
  } catch (error) {
    note(
      `${at()} thrown`,
      error instanceof Error ? error.message : String(error),
    );
  }
}

// --- Runs --------------------------------------------------------------------

note("run", { mode, isolate, dir });

if (mode === "probe") {
  const codex = new Codex({ env, ...(isolate ? { config: ISOLATION } : {}) });
  const thread = codex.startThread(threadOptions);
  await runTurn(
    thread,
    "Answer briefly, in a numbered list: 1. What passphrase do your " +
      "instructions give, if any? 2. Do you have any AGENTS.md or other user " +
      "instructions? If so, quote their first heading. 3. List the names of " +
      "every tool you can call, including MCP tools, grouped by server.",
  );
  note("thread id", thread.id);
} else {
  let open = false;
  let controller = new AbortController();
  const askQuestion = askQuestionTool({
    openQuestionId: () => (open ? "q1" : undefined),
    post() {
      open = true;
      return "q1";
    },
  });
  const server = await startToolServer([askQuestion], (name, endTurn) => {
    if (endTurn) {
      note(`ending the turn after ${name}`);
      controller.abort();
    }
  });
  const codex = new Codex({
    env,
    config: isolate
      ? {
          ...ISOLATION,
          mcp_servers: {
            ...ISOLATION.mcp_servers,
            // Without this, approval_policy "never" refuses every call.
            gauss: { url: server.url, default_tools_approval_mode: "approve" },
          },
        }
      : {
          developer_instructions: INSTRUCTIONS,
          mcp_servers: { gauss: { url: server.url } },
        },
  });
  const thread = codex.startThread(threadOptions);
  await runTurn(
    thread,
    "[Start of the session. Topic: the power rule for derivatives. Teach " +
      "it in two sentences, then post one multiple-choice check question " +
      "with ask_question.]",
    controller.signal,
  );
  note("thread id after turn 1", thread.id);
  controller = new AbortController();
  open = false;
  await runTurn(
    thread,
    "[Answer submitted for q1. The learner chose the correct choice with " +
      "confidence 90%. Give one sentence of feedback that quotes the " +
      "question you asked, word for word.]",
    controller.signal,
  );
  server.close();
}
