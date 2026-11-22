// The mapping from Agent SDK messages to backend events, on hand-written
// messages with only the fields the reader uses. The text, tool and
// "hook_stopped" shapes follow the stage 0 runs; the
// interrupted and failed results are not recorded shapes, so those cases
// check only that an interrupt request or an error decides the outcome. No
// model is called.

import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { expect, test, vi } from "vitest";
import { createTurnReader, sdkEnvironment, sessionPlace } from "./claude.ts";

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

/** A tool call's result, as Claude Code sends it back to the model. */
const toolResult = (id: string, isError: boolean, parent: string | null) =>
  sdk({
    type: "user",
    parent_tool_use_id: parent,
    message: {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: id,
          content: "result",
          ...(isError ? { is_error: true } : {}),
        },
      ],
    },
  });

test("a file the file tools wrote is reported once its call succeeded, by its path in the working folder, or whole outside it; a refused write, a command and a subagent's write are not", () => {
  const reader = createTurnReader("/data/courses/bpe/workspace");
  const call = (
    id: string,
    name: string,
    input: object,
    parent: string | null = null,
  ) =>
    sdk({
      type: "assistant",
      parent_tool_use_id: parent,
      message: { content: [{ type: "tool_use", id, name, input }] },
    });
  const read = (messages: SDKMessage[]) =>
    messages
      .flatMap((m) => reader.read(m, false))
      .filter((e) => e.type !== "tool_call");

  expect(
    read([
      call("w1", "Write", {
        file_path: "/data/courses/bpe/workspace/src/bpe.py",
        content: "",
      }),
      call("w2", "Write", { file_path: "/data/courses/bpe/state.json" }),
      call("e1", "Edit", { file_path: "/tmp/notes.md", old_string: "a" }),
      call("b1", "Bash", { command: "touch made.py" }),
      call(
        "e2",
        "Edit",
        { file_path: "/data/courses/bpe/workspace/x.py" },
        "agent-1",
      ),
      toolResult("w1", false, null),
      toolResult("w2", true, null),
      toolResult("e1", false, null),
      toolResult("b1", false, null),
      toolResult("e2", false, "agent-1"),
    ]),
  ).toEqual([
    { type: "file_written", path: "src/bpe.py" },
    { type: "file_written", path: "/tmp/notes.md" },
  ]);
});

test("a web search is reported once its result came back, with the query searched and each page found once, in order; a refused search and one that stepped aside for a message are not", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const search = (id: string, query: string) =>
    sdk({
      type: "assistant",
      parent_tool_use_id: null,
      message: {
        content: [
          { type: "tool_use", id, name: "WebSearch", input: { query } },
        ],
      },
    });
  const answered = (id: string, output: unknown, isError = false) =>
    sdk({
      ...(toolResult(id, isError, null) as object),
      tool_use_result: output,
    });
  const page = (title: string, url: string) => ({ title, url });
  try {
    const events = readAll([
      search("s1", "adorno whole false"),
      // WebSearchOutput, as sdk-tools.d.ts gives it: hits among commentary,
      // a page found twice by the searches it made.
      answered("s1", {
        query: "Adorno whole is the false",
        results: [
          "Here are the results.",
          {
            tool_use_id: "srvtoolu_1",
            content: [
              page("Theodor W. Adorno", "https://plato.stanford.edu/adorno"),
              page("Minima Moralia", "https://en.wikipedia.org/wiki/Minima"),
            ],
          },
          {
            tool_use_id: "srvtoolu_2",
            content: [
              page("Theodor W. Adorno", "https://plato.stanford.edu/adorno"),
              page("Hegel and Adorno", "https://philpapers.org/rec/HA"),
            ],
          },
        ],
        durationSeconds: 2.5,
        searchCount: 2,
      }),
      search("s2", "learner@example.com"),
      answered("s2", undefined, true),
      search("s3", "a search set aside"),
      answered("s3", { detachedToolCall: true }),
    ]).filter((e) => e.type !== "tool_call");

    expect(events).toEqual([
      {
        type: "web_searched",
        query: "Adorno whole is the false",
        results: [
          page("Theodor W. Adorno", "https://plato.stanford.edu/adorno"),
          page("Minima Moralia", "https://en.wikipedia.org/wiki/Minima"),
          page("Hegel and Adorno", "https://philpapers.org/rec/HA"),
        ],
      },
    ]);
  } finally {
    warn.mockRestore();
  }
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
    CLAUDE_CONFIG_DIR: "/home/learner/other-claude",
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

test("a session given a folder is kept there under the id chosen, with its system prompt sent afresh on every request; one resumed is named by its id alone", () => {
  const prompt = "You are a test tutor.";
  const afresh = { type: "custom", prompt, snapshot: false };

  expect(sessionPlace({ systemPrompt: prompt, cwd: "/c" }, "new-id")).toEqual({
    cwd: "/c",
    persistSession: true,
    systemPrompt: afresh,
    sessionId: "new-id",
  });
  // A new session is given its title, so Claude Code generates none.
  expect(
    sessionPlace(
      { systemPrompt: prompt, cwd: "/c", title: "Limits" },
      "new-id",
    ),
  ).toMatchObject({ sessionId: "new-id", title: "Limits" });
  // The SDK refuses a chosen id together with resume (sdk.d.ts, `sessionId`),
  // and a resumed session keeps the title it has (`title`).
  expect(
    sessionPlace(
      { systemPrompt: prompt, cwd: "/c", resumeId: "old", title: "Limits" },
      "old",
    ),
  ).toEqual({
    cwd: "/c",
    persistSession: true,
    systemPrompt: afresh,
    resume: "old",
  });
});

test("a session given no folder is not kept, and cannot be resumed", () => {
  expect(sessionPlace({ systemPrompt: "Plan." }, "id")).toEqual({
    systemPrompt: "Plan.",
    sessionId: "id",
    persistSession: false,
  });
  expect(() =>
    sessionPlace({ systemPrompt: "Plan.", resumeId: "old" }, "old"),
  ).toThrow("A session is resumed in the folder it was kept in.");
});
