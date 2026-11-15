// Spike for plan task 0.3: an in-process `ask_question` tool that stores a
// question and returns "posted; end your turn", with the learner's answer fed
// back as the next turn of the same session. Throwaway code; task 0.7 decides
// whether any of it stays.
//
// Run inside mise from the repository root, with the Claude Code session's
// CLAUDE* variables unset (see spike/claude-login.ts):
//   node spike/question-round-trip.ts [options]
//     --builtin <names>  built-in tools, comma-separated; "default" leaves the
//                        `tools` option out; empty (the default) gives none
//     --always-load      set alwaysLoad on the tool server
//     --enforce-stop     a PostToolUse hook ends the turn after ask_question
//     --one-open         ask_question rejects a call while a question is open
//     --no-connectors    settings.disableClaudeAiConnectors
//     --strict-mcp       strictMcpConfig
//     --probe-only       report the tool set and deferral, send no message
//
// The findings are in docs/decisions.md under "Question round trip".

import { parseArgs } from "node:util";
import {
  createSdkMcpServer,
  type HookCallback,
  type Options,
  query,
  type SDKUserMessage,
  tool,
} from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

const { values } = parseArgs({
  options: {
    builtin: { type: "string", default: "" },
    "always-load": { type: "boolean", default: false },
    "enforce-stop": { type: "boolean", default: false },
    "one-open": { type: "boolean", default: false },
    "no-connectors": { type: "boolean", default: false },
    "strict-mcp": { type: "boolean", default: false },
    "probe-only": { type: "boolean", default: false },
  },
});

const ASK_QUESTION = "mcp__gauss__ask_question";

// --- The question store and the tool ---------------------------------------

type Question = {
  id: string;
  objective: string;
  prompt: string;
  choices: { id: string; text: string }[];
  answer: string;
  answered: boolean;
};
const questions: Question[] = [];

const askQuestion = tool(
  "ask_question",
  "Post one multiple-choice check question to the learner. The question " +
    "appears as a card in the conversation. The learner's answer arrives in " +
    "the next message, not as this tool's result.",
  {
    objective: z.string().describe("The objective the question checks"),
    prompt: z.string().describe("The question, in Markdown"),
    choices: z
      .array(z.object({ id: z.string(), text: z.string() }))
      .min(2)
      .max(6),
    answer: z
      .string()
      .describe("The id of the correct choice. Never shown to the learner."),
  },
  async (input) => {
    const open = questions.find((q) => !q.answered);
    if (values["one-open"] && open !== undefined) {
      note(`ask_question rejected while ${open.id} is open`);
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `Question ${open.id} is still open. End your turn and wait for the learner's answer.`,
          },
        ],
      };
    }
    const id = `q${questions.length + 1}`;
    questions.push({ id, ...input, answered: false });
    note(`ask_question stored ${id}`, input);
    return {
      content: [
        {
          type: "text",
          text: `Posted as ${id}. End your turn now; the learner's answer will arrive in the next message.`,
        },
      ],
    };
  },
);

const gauss = createSdkMcpServer({
  name: "gauss",
  tools: [askQuestion],
  ...(values["always-load"] ? { alwaysLoad: true } : {}),
});

// --- The engine's side of the conversation --------------------------------

const SYSTEM_PROMPT = `You are a tutor in a teaching app.
Every message from the app starts with a header in square brackets that says
what is allowed now. Follow it.
To post a check question, call the ask_question tool. After calling it, end
your turn at once: write nothing more. The learner's answer arrives in the
next message.
Never reveal or hint at the answer to a question before the learner answers.
Keep every reply under 100 words.`;

const OPENING = `[Unit: Derivatives. Segment 1 of 1: the power rule. Phase: check.
The learner pressed "ready". Allowed: one short sentence, then post one check
question with ask_question.]
The segment taught that d/dx x^n = n·x^(n-1) for any real n.`;

// The scripted learner misses the first question and gets the second right.
function answerTurn(question: Question): string {
  const isFirst = question.id === "q1";
  const chosen = isFirst
    ? question.choices.find((c) => c.id !== question.answer)
    : question.choices.find((c) => c.id === question.answer);
  if (chosen === undefined)
    throw new Error(`no choice to pick in ${question.id}`);
  const grade = chosen.id === question.answer ? "correct" : "incorrect";
  const next = isFirst
    ? "Allowed: brief feedback on this answer, then post one more check question on the same objective with ask_question."
    : "Allowed: brief feedback. The check is over; do not post another question.";
  return `[Answer submitted for ${question.id}. Phase: check. ${next}]
The learner chose ${chosen.id} ("${chosen.text}") with confidence 75%.
Reasoning given: "I think that's the rule."
The engine graded it ${grade}. The correct choice is ${question.answer}.`;
}

// --- A minimal push-based input stream -------------------------------------

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
    send(text: string) {
      pending.push({
        type: "user",
        message: { role: "user", content: text },
        parent_tool_use_id: null,
      });
      poke();
    },
    close() {
      closed = true;
      poke();
    },
  };
}

// --- Options ---------------------------------------------------------------

// Only ask_question and the tool search step may run.
const guardTools: HookCallback = async (input) => {
  if (input.hook_event_name !== "PreToolUse") return {};
  if (input.tool_name === ASK_QUESTION || input.tool_name === "ToolSearch") {
    return {};
  }
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: "Only ask_question is available here.",
    },
  };
};

const stopAfterQuestion: HookCallback = async () => ({
  continue: false,
  stopReason: "Question posted; waiting for the learner.",
});

const env: Record<string, string | undefined> = { ...process.env };
delete env.ANTHROPIC_API_KEY;

const options: Options = {
  systemPrompt: SYSTEM_PROMPT,
  settingSources: [],
  skills: [],
  settings: {
    autoMemoryEnabled: false,
    ...(values["no-connectors"] ? { disableClaudeAiConnectors: true } : {}),
  },
  ...(values["strict-mcp"] ? { strictMcpConfig: true } : {}),
  env,
  persistSession: false,
  includePartialMessages: true,
  mcpServers: { gauss },
  allowedTools: [ASK_QUESTION],
  hooks: {
    PreToolUse: [{ hooks: [guardTools] }],
    ...(values["enforce-stop"]
      ? { PostToolUse: [{ matcher: ASK_QUESTION, hooks: [stopAfterQuestion] }] }
      : {}),
  },
};
if (values.builtin !== "default") {
  options.tools = values.builtin.split(",").filter((name) => name !== "");
}

// --- Logging ---------------------------------------------------------------

function note(label: string, value?: unknown): void {
  const body = value === undefined ? "" : ` ${JSON.stringify(value, null, 2)}`;
  process.stdout.write(`\n[${label}]${body}\n`);
}

// What the session produced in each turn, in order: "text(n): ...",
// "tool_use <name>", "tool_result".
const turns: string[][] = [];
let current: string[] = [];

// --- Run -------------------------------------------------------------------

note("run", {
  builtin: values.builtin,
  alwaysLoad: values["always-load"],
  enforceStop: values["enforce-stop"],
  oneOpen: values["one-open"],
  noConnectors: values["no-connectors"],
  strictMcp: values["strict-mcp"],
  probeOnly: values["probe-only"],
});

const inbox = createInbox();
const session = query({ prompt: inbox.messages, options });

async function reportTools(when: string): Promise<void> {
  const usage = await session.getContextUsage({ detail: "summary" });
  // A deferred tool counts under mcp_tools_deferred, a loaded one under
  // mcp_tools.
  note(`context usage, ${when}`, {
    categories: usage.categories
      .filter((c) => c.kind !== "free" && c.kind !== "buffer")
      .map((c) => `${c.id}: ${c.tokens} (${c.kind})`),
    mcpTools: usage.mcpTools,
    deferredBuiltinTools: usage.deferredBuiltinTools,
    systemTools: usage.systemTools?.map((t) => t.name),
  });
}

if (values["probe-only"]) {
  // The in-process server connects after the session starts; until it does,
  // the context breakdown leaves its tools out.
  let status = await session.mcpServerStatus();
  for (let tries = 0; tries < 50; tries += 1) {
    if (status.some((s) => s.name === "gauss" && s.status === "connected")) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
    status = await session.mcpServerStatus();
  }
  // claude.ai connectors are fetched over the network and can appear later.
  await new Promise((resolve) => setTimeout(resolve, 4000));
  status = await session.mcpServerStatus();
  note(
    "mcp server status",
    status.map((s) => `${s.name}: ${s.status}`),
  );
  await reportTools("before any message");
  inbox.close();
  session.close();
} else {
  inbox.send(OPENING);
  let reported = false;
  let answered = 0;
  try {
    for await (const message of session) {
      switch (message.type) {
        case "system":
          if (message.subtype === "init" && !reported) {
            reported = true;
            note("init", {
              apiKeySource: message.apiKeySource,
              model: message.model,
              tools: message.tools,
              mcp_servers: message.mcp_servers,
            });
          }
          break;
        case "stream_event":
          if (
            message.event.type === "content_block_delta" &&
            message.event.delta.type === "text_delta"
          ) {
            process.stdout.write(message.event.delta.text);
          }
          break;
        case "assistant":
          for (const block of message.message.content) {
            if (block.type === "text") {
              current.push(`text(${block.text.length}): ${block.text}`);
            } else if (block.type === "tool_use") {
              current.push(`tool_use ${block.name}`);
            } else {
              current.push(block.type);
            }
          }
          break;
        case "user":
          if (Array.isArray(message.message.content)) {
            for (const block of message.message.content) {
              if (block.type === "tool_result") current.push("tool_result");
            }
          }
          break;
        case "result": {
          note(`turn ${turns.length + 1} result`, {
            subtype: message.subtype,
            stop_reason: message.stop_reason,
            terminal_reason: message.terminal_reason,
            num_turns: message.num_turns,
            is_error: message.is_error,
          });
          turns.push(current);
          current = [];
          if (turns.length === 1) await reportTools("after turn 1");
          const open = questions.find((q) => !q.answered);
          if (open !== undefined && answered < 2) {
            answered += 1;
            open.answered = true;
            inbox.send(answerTurn(open));
          } else {
            inbox.close();
          }
          break;
        }
        default:
          break;
      }
    }
  } catch (error) {
    note("thrown", error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
  note("turns", turns);
  note("questions", questions);
}
