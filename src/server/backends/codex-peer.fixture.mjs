#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  appendFileSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

// Stand-in for the Codex CLI. Only metadata survives a process; the learner
// text selects a script for the current turn. Both sides of the wire are logged.
const home = join(dirname(fileURLToPath(import.meta.url)), "codex-home");
assert.equal(process.env.CODEX_HOME, home);
const trace = join(home, "wire.jsonl");
const saved = join(home, "kept-thread.json");
const BUNDLED_CATALOG = {
  models: [
    {
      slug: "gpt-6.1-terra",
      apply_patch_tool_type: "freeform",
      tool_mode: "code_mode_only",
    },
  ],
};
// Turn scripts that call Gauss's workspace tools, and the call each makes.
const WORKSPACE_CALLS = {
  "workspace-write": {
    tool: "write_file",
    arguments: { path: "notes/hello.py", content: "print('hi')\n" },
  },
  "workspace-edit": {
    tool: "edit_file",
    arguments: { path: "notes/hello.py", old_text: "hi", new_text: "hello" },
  },
};
const cwd = process.cwd();
const threadId = "019a0000-0000-7000-8000-000000000001";
let handshake = "new";
let thread;
let active;
let nextTurn = 0;

function record(entry) {
  appendFileSync(trace, `${JSON.stringify({ pid: process.pid, ...entry })}\n`);
}

function send(message) {
  record({ direction: "out", message });
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function reply(id, result) {
  send({ id, result });
}

function error(id, message) {
  send({ id, error: { code: -32600, message } });
}

function notify(method, params) {
  send({ method, params: { threadId, ...params } });
}

function turn(status, error = null) {
  return {
    id: active.id,
    rootTurnId: null,
    status,
    error,
    items: [],
    itemsView: "notLoaded",
    startedAt: null,
    completedAt: null,
    durationMs: null,
  };
}

function complete(status = "completed", error = null) {
  notify("turn/completed", { turn: turn(status, error) });
  active = undefined;
}

function itemEvent(phase, item) {
  notify(`item/${phase}`, { turnId: active.id, item });
}

function agentMessage(name, deltas, finished = true, wholeText = "") {
  const item = {
    type: "agentMessage",
    id: `${active.id}-${name}`,
    text: wholeText,
    moderation: null,
    phase: null,
    memoryCitation: null,
    delivery: null,
    questions: null,
  };
  itemEvent("started", item);
  for (const delta of deltas) {
    notify("item/agentMessage/delta", {
      turnId: active.id,
      itemId: item.id,
      delta,
    });
  }
  if (finished)
    itemEvent("completed", { ...item, text: wholeText + deltas.join("") });
}

function callTool() {
  const callId = `call-${active.id}`;
  const id = `server-${active.id}`;
  const call = {
    namespace: "gauss",
    ...(WORKSPACE_CALLS[active.script] ?? {
      tool: "view_page",
      arguments: {
        source: "book",
        page: active.script === "tool-refusal" ? 3 : 2,
      },
    }),
  };
  const item = {
    type: "dynamicToolCall",
    id: callId,
    ...call,
    durationMs: null,
  };
  active.tool = { id, item };
  itemEvent("started", {
    ...item,
    status: "inProgress",
    contentItems: null,
    success: null,
  });
  send({
    id,
    method: "item/tool/call",
    params: { threadId, turnId: active.id, callId, ...call },
  });
}

function toolResponse({ id, result }) {
  if (active?.tool?.id !== id) return; // A stopped call can answer late.
  const { item } = active.tool;
  assert.ok(result && typeof result.success === "boolean");
  itemEvent("completed", {
    ...item,
    status: result.success ? "completed" : "failed",
    ...result,
  });
  delete active.tool;
  if (active.script === "tool-end-overlap") {
    // Tool completion can precede the last content from the same response.
    agentMessage("old-response-tail", ["Do not show this either."]);
  }
  if (active.script !== "hold-tool") {
    // The pinned CLI publishes usage after it records all tool outputs.
    notify("thread/tokenUsage/updated", {
      turnId: active.id,
      tokenUsage: {
        total: {
          totalTokens: 3,
          inputTokens: 2,
          outputTokens: 1,
          cachedInputTokens: 0,
          reasoningOutputTokens: 0,
        },
        last: {
          totalTokens: 3,
          inputTokens: 2,
          outputTokens: 1,
          cachedInputTokens: 0,
          reasoningOutputTokens: 0,
        },
        modelContextWindow: null,
      },
    });
  }
  switch (active.script) {
    case "hold-tool":
      return;
    case "tool-end-overlap":
    case "tool-end-empty":
      agentMessage("closing", []);
      break;
    case "tool-end-text":
      agentMessage("unwanted", ["Do not show this."], false);
      return;
    case "tool-end-whole":
      agentMessage("unwanted", [], true, "Do not show this.");
      return;
    case "tool-end-item":
      itemEvent("started", {
        type: "reasoning",
        id: `${active.id}-reasoning`,
        summary: [],
        content: [],
      });
      return;
    default:
      agentMessage("after-tool", ["Back to the lesson."]);
  }
  complete();
}

function startTurn(id, params) {
  assert.equal(active, undefined);
  assert.equal(params.threadId, thread.id);
  // A learner's photos come as image items before the one text item.
  const text = params.input.at(-1);
  assert.equal(text?.type, "text");
  for (const item of params.input.slice(0, -1)) {
    assert.equal(item.type, "image");
    assert.match(item.url, /^data:image\/jpeg;base64,/);
  }
  const script = text.text;
  active = { id: `turn-${++nextTurn}`, script };
  notify("turn/started", { turn: turn("inProgress") });
  reply(id, { turn: turn("inProgress") });
  if (
    script.startsWith("tool-") ||
    script === "hold-tool" ||
    script in WORKSPACE_CALLS
  ) {
    callTool();
    return;
  }
  switch (script) {
    case "stream":
      agentMessage("first", ["First ", "message."]);
      agentMessage("empty-between", []);
      agentMessage("without-deltas", [], true, "Whole message.");
      agentMessage("second", ["Second message."]);
      agentMessage("empty-after", []);
      break;
    case "late-stop":
    case "hold-text":
      agentMessage("held", ["Before Stop."], false);
      return;
    case "dies":
      agentMessage("partial", ["Before exit."], false);
      process.stderr.write("scripted app-server exit\n", () => {
        process.stdout.write("", () => process.exit(17));
      });
      return;
    case "failed":
      return complete("failed", {
        message: "The provider rejected the turn.",
        codexErrorInfo: null,
        additionalDetails: null,
        misalignment: null,
      });
    case "continue":
      agentMessage("reply", ["Still here."]);
      break;
    default:
      assert.fail(`Unknown turn script: ${script}`);
  }
  complete();
}

async function receive(line) {
  const message = JSON.parse(line);
  record({ direction: "in", message });
  const { id, method, params } = message;
  assert.equal(message.jsonrpc, undefined);
  if (method === "initialize") {
    assert.equal(handshake, "new");
    handshake = "initializing";
    assert.equal(typeof params.clientInfo.name, "string");
    assert.equal(params.capabilities.experimentalApi, true);
    // Let eagerly pipelined input arrive before answering initialize.
    await readFile(new URL(import.meta.url));
    reply(id, {
      userAgent: "codex/scripted",
      codexHome: home,
      platformFamily: "unix",
      platformOs: process.platform,
    });
    handshake = "acknowledged";
    return;
  }
  if (method === "initialized") {
    assert.equal(handshake, "acknowledged");
    assert.equal(id, undefined);
    handshake = "ready";
    return;
  }
  assert.equal(handshake, "ready");
  switch (method) {
    case "thread/start":
      thread = {
        id: threadId,
        cwd: params.cwd ?? cwd,
        ephemeral: params.ephemeral,
      };
      reply(id, { thread });
      break;
    case "thread/name/set":
      assert.equal(params.threadId, thread.id);
      if (thread.ephemeral) return error(id, "cannot name an ephemeral thread");
      thread.name = params.name;
      writeFileSync(saved, JSON.stringify(thread));
      reply(id, {});
      break;
    case "thread/resume":
    case "thread/read": {
      const kept = existsSync(saved)
        ? JSON.parse(readFileSync(saved, "utf8"))
        : undefined;
      if (kept?.id !== params.threadId) {
        return error(
          id,
          method === "thread/read"
            ? `thread not loaded: ${params.threadId}`
            : `no rollout found for thread id ${params.threadId}`,
        );
      }
      if (method === "thread/resume") thread = kept;
      reply(id, { thread: kept });
      break;
    }
    case "turn/start":
      startTurn(id, params);
      break;
    case "turn/interrupt":
      assert.equal(params.threadId, thread.id);
      // On some races the turn is already complete when the request arrives.
      if (active === undefined) return error(id, "no active turn to interrupt");
      assert.equal(params.turnId, active.id);
      if (active.script === "late-stop") {
        error(id, "no active turn to interrupt");
        return complete("completed");
      }
      reply(id, {});
      complete("interrupted");
      break;
    case "thread/unsubscribe":
      assert.equal(params.threadId, thread.id);
      reply(id, { status: "unsubscribed" });
      break;
    case undefined:
      toolResponse(message);
      break;
    default:
      assert.fail(`Unknown app-server request: ${method}`);
  }
}

// The bundled catalog, for the adapter to write the catalog it gives Codex.
if (process.argv[2] === "debug") {
  assert.deepEqual(process.argv.slice(3), ["models", "--bundled"]);
  record({ argv: process.argv.slice(2) });
  process.stdout.write(JSON.stringify(BUNDLED_CATALOG));
} else {
  assert.equal(process.argv[2], "app-server");
  record({
    cwd,
    home,
    argv: process.argv.slice(2),
    envNames: Object.keys(process.env)
      .filter((name) => /^(OPENAI_|CODEX_)/.test(name))
      .sort(),
    inherited: process.env.GAUSS_CODEX_PEER_SENTINEL,
  });
  const input = createInterface({ input: process.stdin });
  input.on("line", (line) => {
    // Fail fast for unreadable/incorrect requests rather than leave the client
    // hanging. The rejection exits Node and reaches the adapter's error path.
    void receive(line);
  });
}
