// Exercise the real adapter against an SDK boundary that keeps pending input
// runnable after interrupt(), as SDKControlInterruptResponse documents. No model.

import { execFileSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
import { type CommandReads, sandboxPython } from "../sandbox-command.ts";
import { askQuestionTool } from "../tools/ask-question.ts";
import { viewPageTool } from "../tools/sources.ts";
import { workspaceTmpDir } from "../tools/workspace.ts";
import {
  type BackendEvent,
  SessionNotFound,
  type SessionOptions,
} from "./backend.ts";
import { createClaudeBackend } from "./claude.ts";

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

test("a page tool sends text and raw base64 image content to Claude, or a text error", async () => {
  startingQuery(Promise.resolve({}));
  const session = await createClaudeBackend().startSession({
    systemPrompt: "Test tutor.",
    tools: [
      viewPageTool({
        view: async (_source, page) =>
          page === 1
            ? {
                text: "Page one.",
                image: {
                  data: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
                  mimeType: "image/png",
                },
              }
            : { refused: "There is no such page." },
      }),
    ],
  });
  try {
    const tool = vi.mocked(createSdkMcpServer).mock.lastCall?.[0].tools?.[0];
    if (tool === undefined) throw new Error("No page tool.");
    expect(await tool.handler({ source: "book", page: 1 }, undefined)).toEqual({
      content: [
        { type: "text", text: "Page one." },
        { type: "image", data: "iVBORw==", mimeType: "image/png" },
      ],
    });
    expect(await tool.handler({ source: "book", page: 2 }, undefined)).toEqual({
      content: [{ type: "text", text: "There is no such page." }],
      isError: true,
    });
  } finally {
    await session.close();
  }
});

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

test("a live check's tutor session runs on the pinned model and effort, whatever the caller asks for", async () => {
  vi.stubEnv("GAUSS_LIVE_CHECK", "1");
  startingQuery(Promise.resolve({}));
  try {
    const session = await createClaudeBackend({
      model: "claude-opus-5-5",
      effort: "high",
    }).startSession({
      systemPrompt: "Test tutor.",
      tools: [],
      cwd: "/data/courses/vectors",
      resumeId: RESUMED,
    });

    expect(vi.mocked(query).mock.lastCall?.[0].options).toMatchObject({
      model: "claude-sonnet-5-5",
      effort: "medium",
    });
    await session.close();
  } finally {
    vi.unstubAllEnvs();
  }
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
/** Where the engine says the tutor's commands may read; Claude runs its own. */
const COMMANDS = {
  reads: {
    denied: ["/home/learner", "/data"],
    allowed: ["/opt/gauss/pytools"],
  } satisfies CommandReads,
  run: () => Promise.reject(new Error("A Claude tutor runs its own commands.")),
};

/** Starts a new session on the stand-in query and returns the options it got. */
async function sessionOptions(given: Partial<SessionOptions>) {
  startingQuery(Promise.resolve({}));
  const session = await createClaudeBackend().startSession({
    systemPrompt: "Test tutor.",
    tools: [askQuestionTool({ post: vi.fn() })],
    ...given,
  });
  const options = vi.mocked(query).mock.lastCall?.[0].options;
  if (options === undefined) throw new Error("query() was not called");
  return { options, session };
}

async function optionsOf(given: Partial<SessionOptions>): Promise<Options> {
  const { options, session } = await sessionOptions(given);
  await session.close();
  return options;
}

/** A PreToolUse call of the hook the session was given, as Claude Code makes it. */
async function preToolUse(
  options: Options,
  tool: string,
  id = "t1",
  input: object = {},
) {
  const [matcher] = options.hooks?.PreToolUse ?? [];
  const hook = matcher?.hooks[0];
  if (hook === undefined) throw new Error("no PreToolUse hook");
  return hook(
    {
      hook_event_name: "PreToolUse",
      tool_name: tool,
      tool_input: input,
      tool_use_id: id,
      session_id: "test",
      transcript_path: "",
      cwd: WORKSPACE,
    },
    id,
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
      workspace: { acquire: async () => ({ release() {} }), ...COMMANDS },
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
        // Reads as the engine says, and in the workspace.
        filesystem: {
          denyRead: ["/home/learner", "/data"],
          allowRead: [WORKSPACE, "/opt/gauss/pytools"],
        },
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
    expect(options.env?.CLAUDE_CODE_DISABLE_BACKGROUND_TASKS).toBe("1");
    // One per course, under /tmp, made for this user alone.
    expect(tmpDir).toMatch(/^\/tmp\/gauss-[0-9a-f]{8}$/);
    expect(workspaceTmpDir("/data/courses/other/workspace")).not.toBe(tmpDir);
    expect((await stat(tmpDir)).mode & 0o777).toBe(0o700);
    // Claude Code gives sandboxed commands <it>/claude-<uid> as $TMPDIR only
    // if that path is at most 44 bytes; the largest uid.
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
      workspace: { acquire: async () => ({ release() {} }), ...COMMANDS },
    }),
  ).rejects.toThrow("The file and shell tools need a working folder.");
});

// --- Web search (task 4.11) --------------------------------------------------

test("a session given web search gets WebSearch, allowed with nothing asked, beside the file and shell tools or alone, and never WebFetch; one not given it has no WebSearch", async () => {
  const tmpDir = workspaceTmpDir(WORKSPACE);
  try {
    const withTools = await optionsOf({
      cwd: WORKSPACE,
      workspace: { acquire: async () => ({ release() {} }), ...COMMANDS },
      webSearch: true,
    });
    expect(withTools).toMatchObject({
      tools: ["Read", "Glob", "Grep", "Write", "Edit", "Bash", "WebSearch"],
      permissionMode: "dontAsk",
      allowedTools: [
        "mcp__gauss__ask_question",
        `Edit(//data/courses/vectors/workspace/**)`,
        "Bash",
        "WebSearch",
      ],
      sandbox: { enabled: true, network: { allowedDomains: [] } },
    });
    expect(withTools.hooks?.PreToolUse?.map((m) => m.matcher)).toEqual([
      "Write|Edit|Bash",
      "WebSearch",
    ]);

    // Where the sandbox cannot run, a tutor has no file and shell tools.
    const alone = await optionsOf({ cwd: WORKSPACE, webSearch: true });
    expect(alone).toMatchObject({
      tools: ["WebSearch"],
      permissionMode: "dontAsk",
      allowedTools: ["mcp__gauss__ask_question", "WebSearch"],
    });
    expect(alone.hooks?.PreToolUse?.map((m) => m.matcher)).toEqual([
      "WebSearch",
    ]);

    const without = await optionsOf({
      cwd: WORKSPACE,
      workspace: { acquire: async () => ({ release() {} }), ...COMMANDS },
    });
    for (const options of [withTools, alone, without]) {
      expect(options.tools).not.toContain("WebFetch");
      expect(options.allowedTools).not.toContain("WebFetch");
    }
    expect(without.tools).not.toContain("WebSearch");
    expect(without.allowedTools).not.toContain("WebSearch");
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

/** A session given web search, on a query that reads the account as `account` says. */
async function searchingSession(
  account: () => Promise<object>,
  searchRefusal?: () => Promise<string | undefined>,
) {
  vi.mocked(query).mockImplementation(
    () =>
      ({
        initializationResult: async () => ({}),
        accountInfo: account,
        close() {},
        async *[Symbol.asyncIterator]() {},
      }) as unknown as Query,
  );
  const session = await createClaudeBackend().startSession({
    systemPrompt: "Test tutor.",
    tools: [],
    cwd: WORKSPACE,
    webSearch: true,
    ...(searchRefusal === undefined ? {} : { searchRefusal }),
  });
  const options = vi.mocked(query).mock.lastCall?.[0].options;
  if (options === undefined) throw new Error("query() was not called");
  const hook = options.hooks?.PreToolUse?.find((m) => m.matcher === "WebSearch")
    ?.hooks[0];
  if (hook === undefined) throw new Error("no hook before a search");
  const search = (input: object) =>
    hook(
      {
        hook_event_name: "PreToolUse",
        tool_name: "WebSearch",
        tool_input: input,
        tool_use_id: "s1",
        session_id: "test",
        transcript_path: "",
        cwd: WORKSPACE,
      },
      "s1",
      { signal: new AbortController().signal },
    );
  return { session, search };
}

/** A hook's refusal, with the reason the model is given. */
const refusal = (reason: string | RegExp) => ({
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason: expect.stringMatching(reason),
  },
});

test("a search whose query or domains hold the account's email address, in any case, is refused before it runs, and says why; any other search goes on", async () => {
  const { session, search } = await searchingSession(async () => ({
    email: "Ada.Lovelace@Example.org",
    subscriptionType: "max",
  }));
  try {
    expect(await search({ query: "Hegel the true is the whole" })).toEqual({});
    // The name alone is not the address.
    expect(await search({ query: "Ada Lovelace notes" })).toEqual({});
    for (const input of [
      { query: "papers by ada.lovelace@example.org" },
      { query: "ADA.LOVELACE@EXAMPLE.ORG Hegel" },
      { query: "Hegel", allowed_domains: ["Ada.Lovelace@Example.org"] },
    ]) {
      expect(await search(input)).toEqual(refusal(/email address/));
    }
  } finally {
    await session.close();
  }
});

test("with no email address on the account every search goes on, and with an account that cannot be read every search is refused", async () => {
  const none = await searchingSession(async () => ({ apiProvider: "bedrock" }));
  try {
    expect(await none.search({ query: "anything@example.org" })).toEqual({});
  } finally {
    await none.session.close();
  }
  const unread = await searchingSession(async () => {
    throw new Error("Claude Code exited.");
  });
  try {
    expect(await unread.search({ query: "Hegel" })).toEqual(
      refusal(/could not be read/),
    );
  } finally {
    await unread.session.close();
  }
});

test("a search the engine refuses now is refused with the engine's reason, after the email check; one it allows goes on", async () => {
  let reason: string | undefined = "Question 1 is open.";
  const { session, search } = await searchingSession(
    async () => ({ email: "ada@example.org" }),
    async () => reason,
  );
  try {
    expect(await search({ query: "Hegel" })).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: "Question 1 is open.",
      },
    });
    expect(await search({ query: "ada@example.org" })).toEqual(
      refusal(/email address/),
    );
    reason = undefined;
    expect(await search({ query: "Hegel" })).toEqual({});
  } finally {
    await session.close();
  }
});

test("before each write and command the engine is asked, and its reason refuses the call; reads are not asked about", async () => {
  let reason: string | undefined;
  const acquire = vi.fn(async () =>
    reason === undefined ? { release() {} } : { refused: reason },
  );
  const tmpDir = workspaceTmpDir(WORKSPACE);
  try {
    const { options, session } = await sessionOptions({
      cwd: WORKSPACE,
      workspace: { acquire, ...COMMANDS },
    });
    expect(options.hooks?.PreToolUse?.[0]?.matcher).toBe("Write|Edit|Bash");

    for (const tool of ["Write", "Edit", "Bash"]) {
      expect(await preToolUse(options, tool, tool)).toEqual({});
    }
    reason = "Question 1 is open.";
    for (const tool of ["Write", "Edit", "Bash"]) {
      expect(await preToolUse(options, tool, `denied-${tool}`)).toEqual({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: "Question 1 is open.",
        },
      });
    }
    expect(await preToolUse(options, "Read")).toEqual({});
    expect(acquire).toHaveBeenCalledTimes(6);
    await session.close();
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

async function postToolUse(
  options: Options,
  event: "PostToolUse" | "PostToolUseFailure",
  id: string,
) {
  const hook = options.hooks?.[event]?.[0]?.hooks[0];
  if (hook === undefined) throw new Error(`no ${event} hook`);
  const common = {
    tool_name: "Bash",
    tool_input: {},
    tool_use_id: id,
    session_id: "test",
    transcript_path: "",
    cwd: WORKSPACE,
  };
  return hook(
    event === "PostToolUse"
      ? { ...common, hook_event_name: event, tool_response: {} }
      : { ...common, hook_event_name: event, error: "Command failed." },
    id,
    { signal: new AbortController().signal },
  );
}

test("a teaching tool can end a planning turn with a refusal that stays an MCP error", async () => {
  let endTurn = false;
  const reason = "Name only the sections assigned to this unit.";
  const { options, session } = await sessionOptions({
    tools: [
      {
        name: "plan_unit",
        description: "Store the unit plan.",
        inputShape: {},
        async run() {
          return { status: "refused", text: reason, endTurn };
        },
      },
    ],
  });
  try {
    const tool = vi.mocked(createSdkMcpServer).mock.lastCall?.[0].tools?.[0];
    if (tool === undefined) throw new Error("No planning tool.");
    const hook = options.hooks?.PostToolBatch?.[0]?.hooks[0];
    if (hook === undefined) throw new Error("No PostToolBatch hook.");
    for (const stop of [false, true]) {
      endTurn = stop;
      const result = await tool.handler({}, undefined);
      expect(result).toEqual({
        content: [{ type: "text", text: reason }],
        isError: true,
      });
      const decision = await hook(
        {
          hook_event_name: "PostToolBatch",
          session_id: "test",
          transcript_path: "",
          cwd: WORKSPACE,
          tool_calls: [
            {
              tool_name: "mcp__gauss__plan_unit",
              tool_input: {},
              tool_use_id: "plan",
              tool_response: result,
            },
          ],
        },
        undefined,
        { signal: new AbortController().signal },
      );
      expect(decision).toEqual(
        stop
          ? { continue: false, stopReason: "A teaching tool ended the turn." }
          : {},
      );
    }
  } finally {
    await session.close();
  }
});

test("concurrent mutations remain reserved until their own success or failure, even after close, and background Bash never starts", async () => {
  const releases = [vi.fn(), vi.fn(), vi.fn()];
  let next = 0;
  const acquire = vi.fn(async () => {
    const release = releases[next++];
    if (release === undefined) throw new Error("Unexpected mutation.");
    return { release };
  });
  const { options, session } = await sessionOptions({
    cwd: WORKSPACE,
    workspace: { acquire, ...COMMANDS },
  });
  try {
    expect(options.hooks?.PreToolUse?.[0]?.onFailure).toBe("block");
    expect(options.hooks?.PostToolUse?.[0]?.onFailure).toBe("block");
    expect(options.hooks?.PostToolUseFailure?.[0]?.onFailure).toBe("block");
    expect(
      await preToolUse(options, "Bash", "background", {
        command: "sleep 1; echo late > hint.py",
        run_in_background: true,
      }),
    ).toMatchObject({
      hookSpecificOutput: {
        permissionDecision: "deny",
        permissionDecisionReason: expect.stringContaining(
          "Background commands are not allowed",
        ),
      },
    });
    expect(acquire).not.toHaveBeenCalled();
    await Promise.all([
      preToolUse(options, "Bash", "command"),
      preToolUse(options, "Write", "write"),
      preToolUse(options, "Edit", "edit"),
    ]);
    expect(acquire).toHaveBeenCalledTimes(3);
    for (const release of releases) expect(release).not.toHaveBeenCalled();
    await postToolUse(options, "PostToolUse", "write");
    expect(releases[1]).toHaveBeenCalledTimes(1);
    expect(releases[0]).not.toHaveBeenCalled();
    expect(releases[2]).not.toHaveBeenCalled();
    await postToolUse(options, "PostToolUseFailure", "command");
    expect(releases[0]).toHaveBeenCalledTimes(1);
    expect(releases[2]).not.toHaveBeenCalled();
    await session.close();
    expect(releases[2]).not.toHaveBeenCalled();
    await postToolUse(options, "PostToolUseFailure", "edit");
    expect(releases[2]).toHaveBeenCalledTimes(1);
  } finally {
    await session.close();
    await rm(workspaceTmpDir(WORKSPACE), { recursive: true, force: true });
  }
  for (const release of releases) expect(release).toHaveBeenCalledTimes(1);
});

test("a permission-denied write releases only its unstarted mutation without retaining the course lock", async () => {
  const denied = vi.fn();
  const running = vi.fn();
  const acquire = vi
    .fn()
    .mockResolvedValueOnce({ release: denied })
    .mockResolvedValueOnce({ release: running });
  const { options, session } = await sessionOptions({
    cwd: WORKSPACE,
    workspace: { acquire, ...COMMANDS },
  });
  try {
    await preToolUse(options, "Write", "outside", {
      file_path: "/outside/hint.py",
    });
    await preToolUse(options, "Bash", "running");
    const matcher = options.hooks?.PermissionDenied?.[0];
    expect(matcher?.onFailure).toBe("block");
    const hook = matcher?.hooks[0];
    if (hook === undefined) throw new Error("no PermissionDenied hook");
    const input = {
      hook_event_name: "PermissionDenied" as const,
      tool_name: "Write",
      tool_input: { file_path: "/outside/hint.py" },
      tool_use_id: "outside",
      reason: "Writing outside the working directory is denied.",
      session_id: "test",
      transcript_path: "",
      cwd: WORKSPACE,
    };
    expect(
      await hook(input, "outside", {
        signal: new AbortController().signal,
      }),
    ).toEqual({});
    expect(denied).toHaveBeenCalledTimes(1);
    expect(running).not.toHaveBeenCalled();
    await postToolUse(options, "PostToolUseFailure", "outside");
    expect(denied).toHaveBeenCalledTimes(1);
    await postToolUse(options, "PostToolUse", "running");
    expect(running).toHaveBeenCalledTimes(1);
  } finally {
    await session.close();
    await rm(workspaceTmpDir(WORKSPACE), { recursive: true, force: true });
  }
});

test("a failed safety hook blocks execution, and closing during an asynchronous reservation releases it without allowing the tool", async () => {
  const pending = Promise.withResolvers<{ release(): void }>();
  const release = vi.fn();
  const acquire = vi
    .fn()
    .mockRejectedValueOnce(new Error("State could not be read."))
    .mockReturnValueOnce(pending.promise);
  const { options, session } = await sessionOptions({
    cwd: WORKSPACE,
    workspace: { acquire, ...COMMANDS },
  });
  try {
    expect(options.hooks?.PreToolUse?.[0]?.onFailure).toBe("block");
    await expect(preToolUse(options, "Bash", "failure")).rejects.toThrow(
      "State could not be read.",
    );
    const starting = preToolUse(options, "Write", "pending");
    await session.close();
    pending.resolve({ release });
    expect(await starting).toMatchObject({
      hookSpecificOutput: { permissionDecision: "deny" },
    });
    expect(release).toHaveBeenCalledTimes(1);
  } finally {
    pending.resolve({ release });
    await session.close();
    await rm(workspaceTmpDir(WORKSPACE), { recursive: true, force: true });
  }
});

test.skipIf(process.platform !== "linux")(
  "an approved Bash input runs through the workload filter: no datagram Unix socketpair, a stream one allowed, and none of the server's variables but the listed ones",
  async () => {
    vi.stubEnv("GAUSS_SERVER_SECRET", "s3cret");
    const cwd = await mkdtemp(join(tmpdir(), "gauss-sdk-command-"));
    const release = vi.fn();
    const { options, session } = await sessionOptions({
      cwd,
      workspace: { acquire: async () => ({ release }), ...COMMANDS },
    });
    const program = [
      "import os, socket",
      "try:",
      "    socket.socketpair(socket.AF_UNIX, socket.SOCK_DGRAM)",
      '    print("escaped")',
      "except OSError as error:",
      "    print(error.errno)",
      "socket.socketpair()",
      'print("stream")',
      'print(os.environ.get("GAUSS_SERVER_SECRET"), os.environ["HOME"])',
    ].join("\n");
    const command = `'${sandboxPython.replaceAll("'", `'\\''`)}' -I -c '${program.replaceAll("'", `'\\''`)}'`;
    const input = {
      command,
      timeout: 1000,
      description: "Check Unix socketpair confinement.",
    };
    try {
      const output = await preToolUse(options, "Bash", "guarded", input);
      expect(output).toMatchObject({
        hookSpecificOutput: {
          permissionDecision: "allow",
          updatedInput: { timeout: 1000, description: input.description },
        },
      });
      if (
        !("hookSpecificOutput" in output) ||
        output.hookSpecificOutput?.hookEventName !== "PreToolUse"
      ) {
        throw new Error("The Bash input was not guarded.");
      }
      const guarded = output.hookSpecificOutput.updatedInput?.command;
      if (typeof guarded !== "string") throw new Error("No guarded command.");
      expect(
        execFileSync("bash", ["-c", guarded], { cwd, encoding: "utf8" }),
      ).toBe(`1\nstream\nNone ${process.env.HOME}\n`);
      expect(input.command).toBe(command);
      expect(release).not.toHaveBeenCalled();
      await postToolUse(options, "PostToolUse", "guarded");
      expect(release).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllEnvs();
      await session.close();
      await rm(workspaceTmpDir(cwd), { recursive: true, force: true });
      await rm(cwd, { recursive: true, force: true });
    }
  },
);

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
        workspace: { acquire: async () => ({ release() {} }), ...COMMANDS },
      }),
    ).rejects.toThrow(
      `The tutor's temporary folder ${tmpDir} is not closed to other users.`,
    );
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});
