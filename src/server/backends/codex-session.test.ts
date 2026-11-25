import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { z } from "zod";
import { defineTool, type ToolResult } from "../tools/tool.ts";
import {
  type BackendEvent,
  SessionNotFound,
  type SessionOptions,
  type TutorSession,
} from "./backend.ts";
import { type CodexBackendOptions, createCodexBackend } from "./codex.ts";

type Message = {
  id?: number | string;
  method?: string;
  params?: Record<string, unknown> & {
    item?: { id: string; type: string };
    turn?: { id: string };
  };
  result?: unknown;
};
type WireEntry = { pid: number; direction: "in" | "out"; message: Message };
type BootEntry = { pid: number; cwd: string; argv: string[] };
type LogEntry = WireEntry | BootEntry;
type ModelOptions = Omit<CodexBackendOptions, "command" | "home">;

const terra = "gpt-6.1-terra";
const absent = "019a0000-0000-7000-8000-000000000111";
const systemPrompt = "Teach only the current objective.";
const sessions = new Set<TutorSession>();
let dir: string;
let command: string;
let home: string;
let cwd: string;

beforeEach(async () => {
  vi.stubEnv("GAUSS_LIVE_CHECK", undefined);
  vi.stubEnv("GAUSS_CODEX_MODEL", undefined);
  dir = await realpath(await mkdtemp(join(tmpdir(), "gauss-codex-session-")));
  command = join(dir, "codex.mjs");
  home = join(dir, "codex-home");
  cwd = join(dir, "workspace");
  await Promise.all([
    mkdir(home),
    mkdir(cwd),
    copyFile(new URL("./codex-peer.fixture.mjs", import.meta.url), command),
  ]);
  await chmod(command, 0o755);
});

afterEach(async () => {
  try {
    await Promise.all([...sessions].map((session) => session.close()));
  } finally {
    sessions.clear();
    vi.unstubAllEnvs();
    await rm(dir, { recursive: true, force: true });
  }
});

function backend(options: ModelOptions = {}) {
  return createCodexBackend({ command, home, ...options });
}

async function open(
  options: Partial<SessionOptions> = {},
  driver = backend(),
): Promise<TutorSession> {
  const session = await driver.startSession({
    systemPrompt,
    tools: [],
    ...options,
  });
  sessions.add(session);
  return session;
}

async function close(session: TutorSession) {
  await session.close();
  sessions.delete(session);
}

async function readTurn(session: TutorSession, text: string) {
  const events: BackendEvent[] = [];
  for await (const event of session.send({ text })) events.push(event);
  return events;
}

async function expectUsable(session: TutorSession) {
  expect(await readTurn(session, "continue")).toEqual([
    { type: "text", text: "Still here." },
    { type: "turn_end", outcome: "done" },
  ]);
}

async function trace(): Promise<LogEntry[]> {
  const lines = await readFile(join(home, "wire.jsonl"), "utf8");
  return lines
    .trimEnd()
    .split("\n")
    .map((line) => JSON.parse(line));
}

function wire(log: LogEntry[]): WireEntry[] {
  return log.filter((entry): entry is WireEntry => "message" in entry);
}

function bootFor(log: LogEntry[], pid: number) {
  return only(
    log.filter(
      (entry): entry is BootEntry => entry.pid === pid && "cwd" in entry,
    ),
  );
}

function requests(log: LogEntry[], method: string, direction = "in") {
  return wire(log).filter(
    (entry) => entry.direction === direction && entry.message.method === method,
  );
}

function methods(log: LogEntry[], pid: number) {
  return wire(log)
    .filter((entry) => entry.pid === pid && entry.direction === "in")
    .map(({ message }) => message.method);
}

function only<T>(entries: T[]): T {
  expect(entries).toHaveLength(1);
  const [entry] = entries;
  if (entry === undefined) throw new Error("The peer trace has no entry.");
  return entry;
}

function expectTurnSettings(log: LogEntry[], model: string, count: number) {
  const turns = requests(log, "turn/start");
  expect(turns).toHaveLength(count);
  for (const { message } of turns) {
    expect(message.params).toMatchObject({
      model,
      effort: "medium",
      serviceTier: "default",
    });
  }
}

function viewPage(
  run: (
    input: { source: string; page: number },
    signal?: AbortSignal,
  ) => ToolResult | Promise<ToolResult>,
) {
  return defineTool({
    name: "view_page",
    description: "Read a page from a source.",
    input: z.object({
      source: z.enum(["book", "notes"]),
      page: z.number().int().min(1).max(8).describe("One-based page number."),
    }),
    run,
  });
}

function expectReadOnly(params: Message["params"]) {
  expect(params).toMatchObject({ approvalPolicy: "never" });
  expect(params?.sandbox).toBeUndefined();
  expect(params?.permissions).toEqual(expect.any(String));
  const config = params?.config as Record<string, unknown>;
  const name = String(params?.permissions);
  expect(config.default_permissions).toBe(name);
  const profiles = config.permissions as Record<
    string,
    { filesystem: Record<string, unknown>; network: { enabled: boolean } }
  >;
  const profile = profiles[name];
  expect(profile).toMatchObject({
    network: { enabled: false },
    filesystem: expect.any(Object),
  });
  const filesystem = profile?.filesystem;
  expect(JSON.stringify(filesystem)).not.toMatch(/"write"|"readWrite"/);
}

function toolExchange(log: LogEntry[]) {
  const request = only(requests(log, "item/tool/call", "out"));
  const response = only(
    wire(log).filter(
      (entry) =>
        entry.direction === "in" && entry.message.id === request.message.id,
    ),
  );
  return { request, response };
}

test("a kept thread is named before the first turn, read without resuming, and resumed with the current prompt", async () => {
  vi.stubEnv("OPENAI_API_KEY", "must not reach Codex");
  vi.stubEnv("OPENAI_BASE_URL", "must not reach Codex");
  vi.stubEnv("CODEX_HOME", join(dir, "wrong-home"));
  vi.stubEnv("CODEX_TEST_OVERRIDE", "must not reach Codex");
  vi.stubEnv("GAUSS_CODEX_PEER_SENTINEL", "retained");
  const driver = backend();
  const first = await open(
    {
      cwd,
      title: "Unit one",
      webSearch: true,
      tools: [
        viewPage(() => ({ status: "done", text: "Read." })),
        defineTool({
          name: "mark_ready",
          description: "Mark a section ready.",
          input: z.object({ note: z.string().optional() }),
          run: () => ({ status: "done", text: "Ready." }),
        }),
      ],
    },
    driver,
  );
  const threadId = first.backendSessionId;
  expect(threadId).toBe("019a0000-0000-7000-8000-000000000001");
  // Naming makes even a thread with no turns discoverable by another process.
  expect(await driver.hasSession(threadId, cwd)).toBe(true);
  expect(await driver.hasSession(threadId, dir)).toBe(false);
  expect(await driver.hasSession(absent, cwd)).toBe(false);

  const events = await readTurn(first, "stream");
  expect(events.slice(0, 2)).toEqual([
    { type: "text", text: "First " },
    { type: "text", text: "message." },
  ]);
  const blocks = events.slice(0, -1);
  expect(
    blocks.every((event) => event.type === "text" && event.text !== ""),
  ).toBe(true);
  expect(
    blocks
      .flatMap((event) => (event.type === "text" ? [event.text] : []))
      .join(""),
  ).toBe("First message.\n\nWhole message.\n\nSecond message.");
  expect(events.at(-1)).toEqual({ type: "turn_end", outcome: "done" });
  await close(first);

  const resumed = await open(
    {
      cwd,
      resumeId: threadId,
      systemPrompt: "Current instructions.",
      title: "Do not rename",
    },
    driver,
  );
  expect(resumed.backendSessionId).toBe(threadId);
  await expectUsable(resumed);
  await close(resumed);

  const log = await trace();
  const start = only(requests(log, "thread/start"));
  expect(start.message.params).toMatchObject({
    cwd,
    ephemeral: false,
    baseInstructions: systemPrompt,
  });
  expectReadOnly(start.message.params);
  const boot = bootFor(log, start.pid);
  expect(boot).toMatchObject({
    cwd: home,
    home,
    envNames: ["CODEX_HOME"],
    inherited: "retained",
  });
  const cliConfig = boot.argv.filter(
    (_, index) => boot.argv[index - 1] === "-c",
  );
  expect(cliConfig).toEqual(
    expect.arrayContaining([
      'features.code_mode.direct_only_tool_namespaces=["gauss"]',
      "thread_unload_delay_secs=0",
      'web_search="disabled"',
      "features.shell_tool=false",
    ]),
  );
  expect(start.message.params?.dynamicTools).toMatchObject([
    {
      type: "namespace",
      name: "gauss",
      tools: [
        {
          type: "function",
          name: "view_page",
          description: "Read a page from a source.",
          inputSchema: {
            type: "object",
            properties: {
              source: { enum: ["book", "notes"] },
              page: {
                type: "integer",
                minimum: 1,
                maximum: 8,
                description: "One-based page number.",
              },
            },
            required: ["source", "page"],
          },
        },
        {
          type: "function",
          name: "mark_ready",
          inputSchema: {
            type: "object",
            properties: { note: { type: "string" } },
          },
        },
      ],
    },
  ]);
  expect(only(requests(log, "thread/name/set")).message.params).toEqual({
    threadId,
    name: "Unit one",
  });
  expect(methods(log, start.pid)).toEqual([
    "initialize",
    "initialized",
    "thread/start",
    "thread/name/set",
    "turn/start",
    "thread/unsubscribe",
  ]);
  const reads = requests(log, "thread/read");
  expect(reads.map(({ message }) => message.params)).toEqual([
    { threadId, includeTurns: false },
    { threadId, includeTurns: false },
    { threadId: absent, includeTurns: false },
  ]);
  for (const { pid } of reads) {
    expect(methods(log, pid)).toEqual([
      "initialize",
      "initialized",
      "thread/read",
    ]);
  }
  const resume = only(requests(log, "thread/resume"));
  expect(bootFor(log, resume.pid).cwd).toBe(home);
  expect(
    new Set([start.pid, resume.pid, ...reads.map(({ pid }) => pid)]).size,
  ).toBe(5);
  expect(resume.message.params).toMatchObject({
    threadId,
    cwd,
    baseInstructions: "Current instructions.",
    excludeTurns: true,
  });
  expectReadOnly(resume.message.params);
  expect(methods(log, resume.pid)).toEqual([
    "initialize",
    "initialized",
    "thread/resume",
    "turn/start",
    "thread/unsubscribe",
  ]);
  expectTurnSettings(log, terra, 2);
});

test("an unknown Codex thread cannot be resumed", async () => {
  await expect(open({ cwd, resumeId: absent })).rejects.toBeInstanceOf(
    SessionNotFound,
  );
  const log = await trace();
  const resume = only(requests(log, "thread/resume"));
  expect(methods(log, resume.pid)).toEqual([
    "initialize",
    "initialized",
    "thread/resume",
  ]);
});

test("a session given a workspace gets Gauss's file and command tools beside its teaching tools, and reports each file written; one without gets none", async () => {
  const desk = { acquired: 0, released: 0 };
  const driver = backend();
  const tutor = await open(
    {
      cwd,
      tools: [viewPage(() => ({ status: "done", text: "Read." }))],
      workspace: {
        reads: { allowed: [], denied: [dir] },
        acquire: async () => {
          desk.acquired += 1;
          return {
            release: () => {
              desk.released += 1;
            },
          };
        },
        run: () => Promise.reject(new Error("No command is run here.")),
      },
    },
    driver,
  );
  const afterWrite = (name: string) => [
    { type: "tool_call", name },
    { type: "file_written", path: "notes/hello.py" },
    { type: "text", text: "Back to the lesson." },
    { type: "turn_end", outcome: "done" },
  ];
  expect(await readTurn(tutor, "workspace-write")).toEqual(
    afterWrite("write_file"),
  );
  expect(await readTurn(tutor, "workspace-edit")).toEqual(
    afterWrite("edit_file"),
  );
  expect(await readFile(join(cwd, "notes", "hello.py"), "utf8")).toBe(
    "print('hello')\n",
  );
  expect(desk).toEqual({ acquired: 2, released: 2 });
  await close(tutor);
  const planner = await open(
    { cwd, tools: [viewPage(() => ({ status: "done", text: "Read." }))] },
    driver,
  );
  await close(planner);

  const log = await trace();
  const names = requests(log, "thread/start").map(({ message }) =>
    (
      (message.params?.dynamicTools ?? []) as { tools: { name: string }[] }[]
    ).flatMap(({ tools }) => tools.map(({ name }) => name)),
  );
  expect(names).toEqual([
    [
      "view_page",
      "read_file",
      "list_files",
      "search_files",
      "write_file",
      "edit_file",
      "run_command",
    ],
    ["view_page"],
  ]);
  // Codex's patch tool goes with its catalog entry: the catalog given is
  // the CLI's own, dumped once for the backend, with no patch tool.
  const dumps = log.filter(
    (entry) => !("message" in entry) && !("cwd" in entry),
  );
  expect(dumps.map(({ argv }) => argv)).toEqual([
    ["debug", "models", "--bundled"],
  ]);
  const boots = log.filter((entry): entry is BootEntry => "cwd" in entry);
  const catalogs = boots.map(({ argv }) =>
    argv.find((setting) => setting.startsWith("model_catalog_json=")),
  );
  // Beside the home, named by its content.
  const [setting] = catalogs;
  const catalog = JSON.parse(
    setting?.slice("model_catalog_json=".length) ?? "null",
  );
  expect(catalog).toMatch(
    new RegExp(`^${join(dir, "codex-home-models-")}[0-9a-f]{12}\\.json$`),
  );
  expect(catalogs).toEqual([setting, setting]);
  expect(JSON.parse(await readFile(catalog, "utf8"))).toEqual({
    models: [
      {
        slug: "gpt-6.1-terra",
        apply_patch_tool_type: null,
        tool_mode: "code_mode_only",
      },
    ],
  });
});

test.each<{
  name: string;
  model: string;
  options: ModelOptions;
  /** The model the session asks for: the learner's setting. */
  asked?: string;
  env?: string;
  live?: string;
}>([
  { name: "defaults", model: terra, options: {} },
  {
    name: "the session's own model",
    model: "gpt-6.2-sol",
    options: {},
    asked: "gpt-6.2-sol",
  },
  {
    name: "the caller model over the session's",
    model: "caller-model",
    options: { model: "caller-model" },
    asked: "gpt-6.2-sol",
  },
  {
    name: "environment model over the caller and session models",
    model: "gauss-test-model",
    env: "gauss-test-model",
    options: { model: "caller-model" },
    asked: "gpt-6.2-sol",
  },
  {
    name: "environment model over the session's",
    model: "gauss-test-model",
    env: "gauss-test-model",
    options: {},
    asked: "gpt-6.2-sol",
  },
  {
    name: "caller model, but not priority or high effort",
    model: "caller-model",
    options: { model: "caller-model", serviceTier: "priority", effort: "high" },
  },
  {
    name: "live pin over every model override, priority and high effort",
    model: terra,
    env: "gauss-test-model",
    live: "1",
    options: { model: "caller-model", serviceTier: "priority", effort: "high" },
    asked: "gpt-6.2-sol",
  },
  {
    name: "live pin over the session's model alone",
    model: terra,
    live: "1",
    options: {},
    asked: "gpt-6.2-sol",
  },
])(
  "ephemeral turns use $name on the wire",
  async ({ model, options, asked, env, live }) => {
    vi.stubEnv("GAUSS_CODEX_MODEL", env);
    vi.stubEnv("GAUSS_LIVE_CHECK", live);
    const session = await open(
      {
        title: "Cannot name an ephemeral thread",
        ...(asked === undefined ? {} : { model: asked }),
      },
      backend(options),
    );
    await expectUsable(session);
    await expectUsable(session);
    await close(session);
    const log = await trace();
    const start = only(requests(log, "thread/start"));
    expect(start.message.params).toMatchObject({ ephemeral: true, model });
    expect(bootFor(log, start.pid).cwd).toBe(home);
    expect(requests(log, "thread/name/set")).toEqual([]);
    expectTurnSettings(log, model, 2);
  },
);

test("a carried-out tool sends text and an image; an ordinary refusal explains why and lets Codex continue", async () => {
  const page = viewPage(({ page }) =>
    page === 2
      ? {
          status: "done",
          text: "Page two.",
          image: {
            mimeType: "image/png",
            data: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
          },
        }
      : { status: "refused", text: "That page has not been introduced." },
  );
  const run = vi.fn(page.run);
  const session = await open({ tools: [{ ...page, run }] });
  const continuation = [
    { type: "tool_call", name: "view_page" },
    { type: "text", text: "Back to the lesson." },
    { type: "turn_end", outcome: "done" },
  ];
  expect(await readTurn(session, "tool-ok")).toEqual(continuation);
  expect(await readTurn(session, "tool-refusal")).toEqual(continuation);
  expect(run.mock.calls.map(([input]) => input)).toEqual([
    { source: "book", page: 2 },
    { source: "book", page: 3 },
  ]);
  const log = await trace();
  const calls = requests(log, "item/tool/call", "out");
  expect(calls).toHaveLength(2);
  expect(calls.map(({ message }) => message.params?.namespace)).toEqual([
    "gauss",
    "gauss",
  ]);
  const responses = wire(log).filter(
    (entry) =>
      entry.direction === "in" &&
      calls.some(({ message }) => message.id === entry.message.id),
  );
  expect(responses.map(({ message }) => message.result)).toEqual([
    {
      success: true,
      contentItems: [
        { type: "inputText", text: "Page two." },
        { type: "inputImage", imageUrl: "data:image/png;base64,iVBORw==" },
      ],
    },
    {
      success: false,
      contentItems: [
        { type: "inputText", text: "That page has not been introduced." },
      ],
    },
  ]);
  expect(requests(log, "turn/interrupt")).toEqual([]);
  expectTurnSettings(log, terra, 2);
});

test.each([
  { script: "tool-end-empty", status: "done", followUp: undefined },
  { script: "tool-end-empty", status: "refused", followUp: undefined },
  { script: "tool-end-overlap", status: "done", followUp: undefined },
  {
    script: "tool-end-text",
    status: "done",
    followUp: "item/agentMessage/delta",
  },
  { script: "tool-end-whole", status: "done", followUp: "item/completed" },
  { script: "tool-end-item", status: "refused", followUp: "item/started" },
] as const)(
  "a $status tool can end a turn in the $script script without losing its result",
  async ({ script, status, followUp }) => {
    const text = "Here is the teaching tool result.";
    const session = await open({
      tools: [viewPage(() => ({ status, text, endTurn: true }))],
    });
    expect(await readTurn(session, script)).toEqual([
      { type: "tool_call", name: "view_page" },
      { type: "turn_end", outcome: "ended_by_tool" },
    ]);
    await expectUsable(session);
    const log = await trace();
    const { request, response } = toolExchange(log);
    expect(response.message.result).toMatchObject({
      success: status === "done",
      contentItems: [expect.objectContaining({ type: "inputText" })],
    });
    const { contentItems } = response.message.result as {
      contentItems: { text: string }[];
    };
    const resultText = only(contentItems).text;
    expect(resultText.startsWith(text)).toBe(true);
    expect(resultText.slice(text.length)).toMatch(/turn is over/i);
    const toolCompleted = only(
      requests(log, "item/completed", "out").filter(
        ({ message }) =>
          message.params?.item?.id === request.message.params?.callId,
      ),
    );
    expect(log.indexOf(toolCompleted)).toBeGreaterThan(log.indexOf(response));
    const interrupts = requests(log, "turn/interrupt");
    if (followUp === undefined) {
      expect(interrupts).toEqual([]);
    } else {
      const completedIndex = log.indexOf(toolCompleted);
      const nextItemIndex = log.findIndex(
        (entry, index) =>
          index > completedIndex &&
          "message" in entry &&
          entry.direction === "out" &&
          entry.message.method === followUp,
      );
      expect(nextItemIndex).toBeGreaterThan(completedIndex);
      const interrupt = only(interrupts);
      expect(log.indexOf(interrupt)).toBeGreaterThan(nextItemIndex);
      expect(interrupt.message.params).toEqual({
        threadId: session.backendSessionId,
        turnId: request.message.params?.turnId,
      });
    }
    expectTurnSettings(log, terra, 2);
  },
);

test("Stop during streamed text interrupts that turn and leaves the session usable", async () => {
  const session = await open();
  const events: BackendEvent[] = [];
  for await (const event of session.send({ text: "hold-text" })) {
    events.push(event);
    if (event.type === "text") await session.interrupt();
  }
  expect(events).toEqual([
    { type: "text", text: "Before Stop." },
    { type: "turn_end", outcome: "interrupted" },
  ]);
  await expectUsable(session);
  const log = await trace();
  const interrupt = only(requests(log, "turn/interrupt"));
  expect(interrupt.message.params).toEqual({
    threadId: session.backendSessionId,
    turnId: requests(log, "turn/started", "out")[0]?.message.params?.turn?.id,
  });
  expectTurnSettings(log, terra, 2);
});

test("a late Stop waits for the turn's terminal notification instead of reporting an interrupt error", async () => {
  const session = await open();
  const events: BackendEvent[] = [];
  for await (const event of session.send({ text: "late-stop" })) {
    events.push(event);
    if (event.type === "text") await session.interrupt();
  }
  expect(events).toEqual([
    { type: "text", text: "Before Stop." },
    { type: "turn_end", outcome: "interrupted" },
  ]);
  await expectUsable(session);
});

test("Stop aborts the signal of a running teaching tool and leaves the session usable", async () => {
  const running = Promise.withResolvers<AbortSignal | undefined>();
  const aborted = Promise.withResolvers<void>();
  const page = viewPage(async (_input, signal) => {
    if (signal?.aborted) aborted.resolve();
    else
      signal?.addEventListener("abort", () => aborted.resolve(), {
        once: true,
      });
    running.resolve(signal);
    await aborted.promise;
    return { status: "refused", text: "The learner stopped this tool." };
  });
  const session = await open({ tools: [page] });
  const pending = readTurn(session, "hold-tool");
  const signal = await Promise.race([
    running.promise,
    pending.then(() => {
      throw new Error("The turn finished without running the tool.");
    }),
  ]);
  expect(signal).toBeInstanceOf(AbortSignal);
  expect(signal?.aborted).toBe(false);
  await session.interrupt();
  expect(signal?.aborted).toBe(true);
  expect(await pending).toEqual([
    { type: "tool_call", name: "view_page" },
    { type: "turn_end", outcome: "interrupted" },
  ]);
  await expectUsable(session);
  const log = await trace();
  const request = only(requests(log, "item/tool/call", "out"));
  const interrupt = only(requests(log, "turn/interrupt"));
  expect(interrupt.message.params).toEqual({
    threadId: session.backendSessionId,
    turnId: request.message.params?.turnId,
  });
  expectTurnSettings(log, terra, 2);
});

test("a failed Codex turn reports its error without killing the session", async () => {
  const session = await open();
  expect(await readTurn(session, "failed")).toEqual([
    {
      type: "turn_end",
      outcome: "error",
      error: "The provider rejected the turn.",
    },
  ]);
  await expectUsable(session);
  expectTurnSettings(await trace(), terra, 2);
});

test("app-server exit fails the active turn and subsequent turns on the dead session", async () => {
  const session = await open();
  expect(await readTurn(session, "dies")).toEqual([
    { type: "text", text: "Before exit." },
    { type: "turn_end", outcome: "error", error: expect.stringMatching(/\S/) },
  ]);
  expect(await readTurn(session, "continue")).toEqual([
    { type: "turn_end", outcome: "error", error: expect.stringMatching(/\S/) },
  ]);
  expectTurnSettings(await trace(), terra, 1);
});
