// The Claude backend's one-shot request against a stand-in for the SDK's
// query(), which records its options and replays the messages given. No model.
import type * as AgentSdk from "@anthropic-ai/claude-agent-sdk";
import {
  type Options,
  query,
  type SDKMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { afterEach, expect, test, vi } from "vitest";
import { WrittenGrade } from "../../shared/question.ts";
import { createClaudeBackend } from "./claude.ts";

vi.mock("@anthropic-ai/claude-agent-sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof AgentSdk>();
  return { ...actual, query: vi.fn() };
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const sdk = (message: object) => message as SDKMessage;
const success = (fields: object) =>
  sdk({
    type: "result",
    subtype: "success",
    is_error: false,
    result: "",
    ...fields,
  });

/** query() yields these messages, then throws `error` if one is given. */
function replay(messages: SDKMessage[], error?: Error) {
  const seen: { prompt: unknown; options: Options }[] = [];
  vi.mocked(query).mockImplementation(({ prompt, options }) => {
    seen.push({ prompt, options: options as Options });
    async function* run() {
      for (const message of messages) yield message;
      if (error !== undefined) throw error;
    }
    return run() as unknown as ReturnType<typeof query>;
  });
  return seen;
}

const REQUEST = {
  systemPrompt: "You are a test grader.",
  prompt: "Grade this answer.",
  schema: WrittenGrade,
};

test("a one-shot request is one query with its own system prompt, no tools, nothing kept, the reply's JSON schema, and an environment off the plan login's redirects", async () => {
  vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
  vi.stubEnv("ANTHROPIC_BASE_URL", "http://127.0.0.1:9");
  vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "bogus");
  vi.stubEnv("CLAUDE_CODE_USE_BEDROCK", "1");
  const seen = replay([success({ structured_output: { verdict: "correct" } })]);
  const backend = createClaudeBackend({ model: "claude-haiku-5-5" });

  await backend.oneShot(REQUEST);

  expect(seen).toHaveLength(1);
  const { prompt, options } = seen[0] ?? {};
  expect(prompt).toBe("Grade this answer.");
  expect(options).toMatchObject({
    systemPrompt: "You are a test grader.",
    model: "claude-haiku-5-5",
    tools: [],
    settingSources: [],
    skills: [],
    strictMcpConfig: true,
    persistSession: false,
    outputFormat: {
      type: "json_schema",
      schema: {
        type: "object",
        properties: {
          verdict: { enum: ["correct", "incorrect"] },
          flaw: { type: "string" },
        },
        required: ["verdict"],
      },
    },
  });
  expect(options?.mcpServers).toBeUndefined();
  expect(options?.allowedTools).toBeUndefined();
  expect(options?.sandbox).toBeUndefined();
  expect(options?.permissionMode).toBeUndefined();
  const names = Object.keys(options?.env ?? {});
  expect(names.filter((n) => /^(ANTHROPIC|CLAUDE)/.test(n))).toEqual([]);
  expect(names).toContain("PATH");
});

test.each<{
  name: string;
  messages: SDKMessage[];
  error?: Error;
  outcome: unknown;
}>([
  {
    name: "a reply in the schema's shape",
    messages: [
      success({ structured_output: { verdict: "incorrect", flaw: "Step 2." } }),
    ],
    outcome: { ok: true, value: { verdict: "incorrect", flaw: "Step 2." } },
  },
  {
    name: "a reply the SDK accepted that the schema refuses",
    messages: [success({ structured_output: { verdict: "incorrect" } })],
    outcome: {
      ok: false,
      error: expect.stringMatching(/^The reply was not in the shape asked for/),
    },
  },
  {
    name: "a success with no structured output",
    messages: [success({ result: "It is correct." })],
    outcome: { ok: false, error: "The reply had no structured output." },
  },
  {
    name: "an error result, after which the query throws",
    messages: [
      sdk({
        type: "result",
        subtype: "error_max_structured_output_retries",
        is_error: true,
        errors: [],
      }),
    ],
    error: new Error("Claude Code process exited with code 1"),
    outcome: {
      ok: false,
      error: "The model's reply was not in the shape asked for, after retries.",
    },
  },
  {
    name: "an error during execution",
    messages: [
      sdk({
        type: "result",
        subtype: "error_during_execution",
        is_error: true,
        errors: ["API Error: 529 Overloaded"],
      }),
    ],
    outcome: { ok: false, error: "API Error: 529 Overloaded" },
  },
  {
    name: "a query that throws before any result",
    messages: [],
    error: new Error("Claude Code executable not found"),
    outcome: { ok: false, error: "Claude Code executable not found" },
  },
  {
    name: "a query that ends without a result",
    messages: [],
    outcome: { ok: false, error: "The request ended without a result." },
  },
])("$name", async ({ messages, error, outcome }) => {
  replay(messages, error);

  expect(await createClaudeBackend().oneShot(REQUEST)).toEqual(outcome);
});

test("a stopped request fails as stopped, whatever the SDK says after", async () => {
  vi.mocked(query).mockImplementation(({ options }) => {
    const { signal } = (options as Options).abortController ?? {};
    async function* run() {
      await new Promise((resolve) =>
        signal?.addEventListener("abort", resolve, { once: true }),
      );
      throw new Error("Request was aborted.");
    }
    return run() as unknown as ReturnType<typeof query>;
  });
  const stop = new AbortController();

  const outcome = createClaudeBackend().oneShot({
    ...REQUEST,
    signal: stop.signal,
  });
  stop.abort();

  expect(await outcome).toEqual({
    ok: false,
    error: "The request was stopped.",
  });
});
