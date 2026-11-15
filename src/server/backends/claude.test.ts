// The mapping from Agent SDK messages to backend events, on hand-written
// messages with only the fields the reader uses. The text, tool and
// "hook_stopped" shapes follow the stage 0 runs (docs/decisions.md); the
// interrupted and failed results are not recorded shapes, so those cases
// check only that an interrupt request or an error decides the outcome. No
// model is called.

import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { expect, test } from "vitest";
import { createTurnReader, sdkEnvironment } from "./claude.ts";

// Only the fields the reader looks at.
const sdk = (message: object) => message as unknown as SDKMessage;
const stream = (event: object, parent: string | null = null) =>
  sdk({ type: "stream_event", event, parent_tool_use_id: parent });
const textStart = stream({
  type: "content_block_start",
  index: 0,
  content_block: { type: "text", text: "" },
});
const delta = (text: string) =>
  stream({
    type: "content_block_delta",
    index: 0,
    delta: { type: "text_delta", text },
  });
const result = (fields: object) => sdk({ type: "result", ...fields });

function readAll(messages: SDKMessage[], interruptRequested = false) {
  const reader = createTurnReader();
  return messages.flatMap((m) => reader.read(m, interruptRequested));
}

test("text streams as pieces, and a second text block in the turn starts a new paragraph", () => {
  const events = readAll([
    textStart,
    delta("The power "),
    delta("rule."),
    stream({ type: "content_block_stop", index: 0 }),
    textStart,
    delta("Next."),
  ]);

  expect(events).toEqual([
    { type: "text", text: "The power " },
    { type: "text", text: "rule." },
    { type: "text", text: "\n\n" },
    { type: "text", text: "Next." },
  ]);
});

test("a teaching tool call is reported by the tool's own name; subagent messages are skipped", () => {
  const events = readAll([
    sdk({
      type: "assistant",
      parent_tool_use_id: null,
      message: {
        content: [
          { type: "text", text: "Here is a question." },
          { type: "tool_use", id: "t1", name: "mcp__gauss__ask_question" },
          { type: "tool_use", id: "t2", name: "Read" },
        ],
      },
    }),
    stream(
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "a subagent's text" },
      },
      "t3",
    ),
  ]);

  expect(events).toEqual([
    { type: "tool_call", name: "ask_question" },
    { type: "tool_call", name: "Read" },
  ]);
});

test.each([
  {
    name: "the hook stopped it after a teaching tool",
    message: {
      subtype: "success",
      is_error: false,
      terminal_reason: "hook_stopped",
    },
    interrupted: false,
    end: { type: "turn_end", outcome: "ended_by_tool" },
  },
  {
    name: "the model finished",
    message: {
      subtype: "success",
      is_error: false,
      terminal_reason: "completed",
    },
    interrupted: false,
    end: { type: "turn_end", outcome: "done" },
  },
  {
    name: "it was interrupted",
    message: { subtype: "error_during_execution", is_error: true, errors: [] },
    interrupted: true,
    end: { type: "turn_end", outcome: "interrupted" },
  },
  {
    name: "the session could not run",
    message: {
      subtype: "error_during_execution",
      is_error: true,
      errors: ["No conversation found with session ID: x"],
    },
    interrupted: false,
    end: {
      type: "turn_end",
      outcome: "error",
      error: "No conversation found with session ID: x",
    },
  },
  {
    name: "the request failed",
    message: {
      subtype: "success",
      is_error: true,
      result: "Invalid API key · Fix external API key",
    },
    interrupted: false,
    end: {
      type: "turn_end",
      outcome: "error",
      error: "Invalid API key · Fix external API key",
    },
  },
])("the turn ends when $name", ({ message, interrupted, end }) => {
  expect(readAll([result(message)], interrupted)).toEqual([end]);
});

test("the SDK's environment has no API key, nothing that could send its requests elsewhere, and nothing from a parent Claude Code session", () => {
  const env = sdkEnvironment({
    PATH: "/usr/bin",
    HOME: "/home/learner",
    ANTHROPIC_API_KEY: "sk-ant-test",
    ANTHROPIC_BASE_URL: "http://127.0.0.1:9",
    ANTHROPIC_AUTH_TOKEN: "bogus",
    CLAUDECODE: "1",
    CLAUDE_CODE_SESSION_ID: "abc",
    CLAUDE_CODE_USE_VERTEX: "1",
    // A provider's credentials do nothing without its switch, so they stay.
    AWS_REGION: "eu-west-1",
  });

  expect(env).toEqual({
    PATH: "/usr/bin",
    HOME: "/home/learner",
    AWS_REGION: "eu-west-1",
  });
});
