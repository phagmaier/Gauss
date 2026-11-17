// Exercise the real adapter against an SDK boundary that keeps pending input
// runnable after interrupt(), as SDKControlInterruptResponse documents. No model.

import { chmod, mkdir, rm, stat } from "node:fs/promises";
import type * as AgentSdk from "@anthropic-ai/claude-agent-sdk";
import {
  createSdkMcpServer,
  type Options,
  type Query,
  query,
  type SDKMessage,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { expect, test, vi } from "vitest";
import { askQuestionTool } from "../tools/ask-question.ts";
import {
  type BackendEvent,
  SessionNotFound,
  type SessionOptions,
} from "./backend.ts";
import { createClaudeBackend, workspaceTmpDir } from "./claude.ts";

vi.mock("@anthropic-ai/claude-agent-sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof AgentSdk>();
  return {
    ...actual,
    createSdkMcpServer: vi.fn(actual.createSdkMcpServer),
    query: vi.fn(),
  };
});

const sdk = (message: object) => message as SDKMessage;

function sdkBoundary(pause: "before_prompt" | "before_model" | "during_model") {
  const parked = Promise.withResolvers<void>();
  const resume = Promise.withResolvers<void>();
  let active = false;
  let aborted = false;
  let turn = 0;
  const generated: string[] = [];

  vi.mocked(query).mockImplementation(({ prompt, options }) => {
    async function* messages() {
      for await (const input of prompt as AsyncIterable<SDKUserMessage>) {
        turn += 1;
        aborted = false;
        async function gate(where: typeof pause) {
          if (turn === 2 && pause === where) {
            parked.resolve();
            await resume.promise;
          }
        }
        await gate("before_prompt");
        const hooks = (options as Options).hooks?.UserPromptSubmit ?? [];
        let stopped = false;
        for (const matcher of hooks) {
          for (const hook of matcher.hooks) {
            const output = await hook(
              {
                hook_event_name: "UserPromptSubmit",
                prompt: String(input.message.content),
                session_id: "test",
                transcript_path: "",
                cwd: "/tmp",
              },
              undefined,
              { signal: new AbortController().signal },
            );
            if ("continue" in output && output.continue === false)
              stopped = true;
          }
        }
        if (!stopped) {
          await gate("before_model");
          active = true;
          yield sdk({
            type: "stream_event",
            parent_tool_use_id: null,
            event: { type: "message_start" },
          });
          await gate("during_model");
          if (turn === 2) {
            // Tool RPCs and output may already be buffered when Stop arrives.
            const tool =
              vi.mocked(createSdkMcpServer).mock.lastCall?.[0].tools?.[0];
            if (tool === undefined) throw new Error("Missing teaching tool");
            await tool.handler(
              {
                objective: "Test",
                prompt: "Question?",
                choices: ["One", "Two"],
                answer: "A",
              },
              undefined,
            );
            yield sdk({
              type: "stream_event",
              parent_tool_use_id: null,
              event: {
                type: "content_block_delta",
                delta: { type: "text_delta", text: "Buffered after Stop." },
              },
            });
          }
          if (!aborted) {
            const text = `Reply ${turn}.`;
            generated.push(text);
            yield sdk({
              type: "stream_event",
              parent_tool_use_id: null,
              event: {
                type: "content_block_delta",
                delta: { type: "text_delta", text },
              },
            });
          }
        }
        active = false;
        // A stopped prompt produces a success result without terminal_reason.
        yield sdk({
          type: "result",
          subtype: "success",
          is_error: false,
          ...(aborted ? { terminal_reason: "aborted" } : {}),
        });
      }
    }
    return {
      [Symbol.asyncIterator]: messages,
      async interrupt() {
        if (active) aborted = true;
        // Pending, UUID-less input survives, but cannot appear in the receipt.
        return { still_queued: [] };
      },
      close() {},
    } as unknown as Query;
  });
  return { parked: parked.promise, resume: () => resume.resolve(), generated };
}

test.each(["before_prompt", "before_model", "during_model"] as const)(
  "stopping %s prevents the pending reply and leaves the next turn usable",
  async (pause) => {
    const boundary = sdkBoundary(pause);
    const postQuestion = vi.fn(async () => ({
      id: "q1",
      number: 1,
      question: { kind: "written" as const, prompt: "Why?", rubric: "Any." },
    }));
    const session = await createClaudeBackend().startSession({
      systemPrompt: "Test tutor.",
      tools: [askQuestionTool({ post: postQuestion })],
    });
    const read = async (text: string) => {
      const events: BackendEvent[] = [];
      for await (const event of session.send({ text })) events.push(event);
      return events;
    };
    try {
      await read("First.");
      const pending = read("Stop this one.");
      await boundary.parked;
      await session.interrupt();
      boundary.resume();
      expect(await pending).toEqual([
        { type: "turn_end", outcome: "interrupted" },
      ]);
      expect(await read("Continue.")).toEqual([
        { type: "text", text: "Reply 3." },
        { type: "turn_end", outcome: "done" },
      ]);
      expect(boundary.generated).toEqual(["Reply 1.", "Reply 3."]);
      expect(postQuestion).not.toHaveBeenCalled();
    } finally {
      boundary.resume();
      await session.close();
    }
  },
);

/**
 * A query that starts, or fails to, as Claude Code did when task 2.14 resumed
 * sessions: an unknown id fails `initializationResult()` with the error below
 * before any input, and a known one resolves it.
 */
function startingQuery(start: Promise<unknown>) {
  const closed = vi.fn();
  vi.mocked(query).mockImplementation(
    () =>
      ({
        initializationResult: () => start,
        close: closed,
        async *[Symbol.asyncIterator]() {},
      }) as unknown as Query,
  );
  return { closed };
}

const RESUMED = "46a23d60-3723-4703-b5ff-f62ad2721ea0";

test("a session resumed by its id runs in the folder given, under that id, and is ready once Claude Code has started", async () => {
  startingQuery(Promise.resolve({}));

  const session = await createClaudeBackend().startSession({
    systemPrompt: "Test tutor.",
    tools: [],
    cwd: "/data/courses/vectors",
    resumeId: RESUMED,
  });

  expect(session.backendSessionId).toBe(RESUMED);
  const options = vi.mocked(query).mock.lastCall?.[0].options;
  expect(options).toMatchObject({
    resume: RESUMED,
    cwd: "/data/courses/vectors",
    persistSession: true,
  });
  expect(options).not.toHaveProperty("sessionId");
  await session.close();
});

test("a session Claude Code cannot find is a failure of its own, and its query is closed", async () => {
  const { closed } = startingQuery(
    Promise.reject(
      new Error(
        `Claude Code returned an error result: No conversation found with session ID: ${RESUMED}`,
      ),
    ),
  );

  const starting = createClaudeBackend().startSession({
    systemPrompt: "Test tutor.",
    tools: [],
    cwd: "/data/courses/vectors",
    resumeId: RESUMED,
  });

  await expect(starting).rejects.toBeInstanceOf(SessionNotFound);
  expect(closed).toHaveBeenCalled();
});

test("resuming that fails another way keeps its own error", async () => {
  const { closed } = startingQuery(
    Promise.reject(new Error("Claude Code process exited with code 1")),
  );

  const starting = createClaudeBackend().startSession({
    systemPrompt: "Test tutor.",
    tools: [],
    cwd: "/data/courses/vectors",
    resumeId: RESUMED,
  });

  await expect(starting).rejects.toThrow(
    "Claude Code process exited with code 1",
  );
  await expect(starting).rejects.not.toBeInstanceOf(SessionNotFound);
  expect(closed).toHaveBeenCalled();
});

// --- The tutor's file and shell tools (task 3.3) ------------------------------

const WORKSPACE = "/data/courses/vectors/workspace";

/** Starts a new session on the stand-in query and returns the options it got. */
async function optionsOf(given: Partial<SessionOptions>): Promise<Options> {
  startingQuery(Promise.resolve({}));
  const session = await createClaudeBackend().startSession({
    systemPrompt: "Test tutor.",
    tools: [askQuestionTool({ post: vi.fn() })],
    ...given,
  });
  await session.close();
  const options = vi.mocked(query).mock.lastCall?.[0].options;
  if (options === undefined) throw new Error("query() was not called");
  return options;
}

/** A PreToolUse call of the hook the session was given, as Claude Code makes it. */
async function preToolUse(options: Options, tool: string) {
  const [matcher] = options.hooks?.PreToolUse ?? [];
  const hook = matcher?.hooks[0];
  if (hook === undefined) throw new Error("no PreToolUse hook");
  return hook(
    {
      hook_event_name: "PreToolUse",
      tool_name: tool,
      tool_input: {},
      tool_use_id: "t1",
      session_id: "test",
      transcript_path: "",
      cwd: WORKSPACE,
    },
    "t1",
    { signal: new AbortController().signal },
  );
}

test("a tutor's session gets the file and shell tools confined to its workspace: one Edit rule for it, Bash only in the sandbox, which must run, no network, nothing asked, writes outside refused, and a private temporary folder within Claude Code's limit", async () => {
  vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
  const tmpDir = workspaceTmpDir(WORKSPACE);
  await rm(tmpDir, { recursive: true, force: true });
  try {
    const options = await optionsOf({
      cwd: WORKSPACE,
      workspace: { refusal: () => undefined },
    });

    expect(options).toMatchObject({
      cwd: WORKSPACE,
      tools: ["Read", "Glob", "Grep", "Write", "Edit", "Bash"],
      permissionMode: "dontAsk",
      allowedTools: [
        "mcp__gauss__ask_question",
        `Edit(//data/courses/vectors/workspace/**)`,
        "Bash",
      ],
      sandbox: {
        enabled: true,
        failIfUnavailable: true,
        autoAllowBashIfSandboxed: true,
        allowUnsandboxedCommands: false,
        network: { allowedDomains: [] },
      },
      // The isolation settings stay.
      settings: {
        autoMemoryEnabled: false,
        disableClaudeAiConnectors: true,
        permissions: { blockWritesOutsideWorkingDirectories: true },
      },
      settingSources: [],
      strictMcpConfig: true,
    });
    expect(options.disallowedTools).toBeUndefined();
    expect(options.env).not.toHaveProperty("ANTHROPIC_API_KEY");
    expect(options.env?.CLAUDE_CODE_TMPDIR).toBe(tmpDir);
    // One per course, under /tmp, made for this user alone.
    expect(tmpDir).toMatch(/^\/tmp\/gauss-[0-9a-f]{8}$/);
    expect(workspaceTmpDir("/data/courses/other/workspace")).not.toBe(tmpDir);
    expect((await stat(tmpDir)).mode & 0o777).toBe(0o700);
    // Sandboxed commands get <it>/claude-<uid> as $TMPDIR only if that path
    // is at most 44 bytes (decisions.md, "Confinement"); the largest uid.
    expect(
      Buffer.byteLength(`${tmpDir}/claude-4294967295`),
    ).toBeLessThanOrEqual(44);
  } finally {
    vi.unstubAllEnvs();
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("sessions without the file and shell tools, an intake's and a unit's planning, get no built-in tools, no sandbox and no hook before tools", async () => {
  for (const given of [{ cwd: "/data/intake" }, {}]) {
    const options = await optionsOf(given);
    expect(options.tools).toEqual([]);
    expect(options.allowedTools).toEqual(["mcp__gauss__ask_question"]);
    expect(options.sandbox).toBeUndefined();
    expect(options.permissionMode).toBeUndefined();
    expect(options.hooks?.PreToolUse).toBeUndefined();
    expect(options.env).not.toHaveProperty("CLAUDE_CODE_TMPDIR");
  }
  await expect(
    createClaudeBackend().startSession({
      systemPrompt: "Test tutor.",
      tools: [],
      workspace: { refusal: () => undefined },
    }),
  ).rejects.toThrow("The file and shell tools need a working folder.");
});

test("before each write and command the engine is asked, and its reason refuses the call; reads are not asked about", async () => {
  let reason: string | undefined;
  const refusal = vi.fn(() => reason);
  const tmpDir = workspaceTmpDir(WORKSPACE);
  try {
    const options = await optionsOf({ cwd: WORKSPACE, workspace: { refusal } });
    expect(options.hooks?.PreToolUse?.[0]?.matcher).toBe("Write|Edit|Bash");

    for (const tool of ["Write", "Edit", "Bash"]) {
      expect(await preToolUse(options, tool)).toEqual({});
    }
    reason = "Question 1 is open.";
    for (const tool of ["Write", "Edit", "Bash"]) {
      expect(await preToolUse(options, tool)).toEqual({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: "Question 1 is open.",
        },
      });
    }
    expect(await preToolUse(options, "Read")).toEqual({});
    expect(refusal).toHaveBeenCalledTimes(6);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("a temporary folder another user could reach refuses the session", async () => {
  const cwd = "/data/courses/shared/workspace";
  const tmpDir = workspaceTmpDir(cwd);
  await rm(tmpDir, { recursive: true, force: true });
  await mkdir(tmpDir);
  await chmod(tmpDir, 0o755);
  try {
    await expect(
      createClaudeBackend().startSession({
        systemPrompt: "Test tutor.",
        tools: [],
        cwd,
        workspace: { refusal: () => undefined },
      }),
    ).rejects.toThrow(
      `The tutor's temporary folder ${tmpDir} is not closed to other users.`,
    );
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});
