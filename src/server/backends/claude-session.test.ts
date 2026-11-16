// Exercise the real adapter against an SDK boundary that keeps pending input
// runnable after interrupt(), as SDKControlInterruptResponse documents. No model.
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
import { type BackendEvent, SessionNotFound } from "./backend.ts";
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
