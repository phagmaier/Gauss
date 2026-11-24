// The pinned app-server speaks newline-delimited JSON-RPC over stdio.
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

export type RequestId = number | string;
export type ServerMessage = {
  id?: RequestId;
  method: string;
  params?: object;
};

type Reply = {
  id: RequestId;
  result?: unknown;
  error?: { code: number; message: string };
};

export class CodexRpcError extends Error {
  readonly code: number;

  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function openCodexAppServer(options: {
  command: string;
  home: string;
  env: NodeJS.ProcessEnv;
  config?: readonly string[];
  timeoutMs?: number;
}) {
  const { command, home, env, config = [], timeoutMs = 20_000 } = options;
  // Start in the isolated home. A thread's cwd is set in its request.
  const child = spawn(command, ["app-server", ...config], { cwd: home, env });
  const exited = Promise.withResolvers<void>();
  const pending = new Map<
    number,
    { resolve(value: unknown): void; reject(error: Error): void }
  >();
  let serial = 0;
  let failure: Error | undefined;
  let stderr = "";
  let onMessage: ((message: ServerMessage) => void) | undefined;
  let onFailure: ((error: Error) => void) | undefined;
  let closing: Promise<void> | undefined;

  function fail(error: Error) {
    if (failure !== undefined) return;
    failure = error;
    for (const request of pending.values()) request.reject(error);
    pending.clear();
    onFailure?.(error);
  }

  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr = (stderr + chunk).slice(-500);
  });
  child.on("error", fail);
  child.on("close", (code, signal) => {
    const status = signal === null ? `exit ${code}` : signal;
    fail(
      new Error(
        `codex app-server ended (${status})` +
          (stderr.trim() === "" ? "." : `: ${stderr.trim()}`),
      ),
    );
    exited.resolve();
  });
  // The close event has the useful exit status and stderr if the pipe broke.
  child.stdin.on("error", () => {});
  createInterface({ input: child.stdout }).on("line", (line) => {
    try {
      const message: Reply | ServerMessage = JSON.parse(line);
      if ("method" in message) {
        if (onMessage !== undefined) onMessage(message);
        else if (message.id !== undefined) unsupported(message);
      } else if (typeof message.id === "number") {
        const request = pending.get(message.id);
        if (request === undefined) return;
        pending.delete(message.id);
        if (message.error !== undefined) {
          request.reject(
            new CodexRpcError(message.error.code, message.error.message),
          );
        } else {
          request.resolve(message.result);
        }
      }
    } catch (error) {
      abort(new Error(`Invalid codex app-server message: ${messageOf(error)}`));
    }
  });

  function write(message: object) {
    if (failure === undefined && !child.stdin.destroyed) {
      child.stdin.write(`${JSON.stringify(message)}\n`);
    }
  }

  function unsupported(message: ServerMessage) {
    write({
      id: message.id,
      error: {
        code: -32601,
        message: `Gauss does not support ${message.method}.`,
      },
    });
  }

  async function request<T = unknown>(
    method: string,
    params: object,
  ): Promise<T> {
    if (failure !== undefined) throw failure;
    const id = ++serial;
    const { promise, resolve, reject } = Promise.withResolvers<unknown>();
    const timeout = setTimeout(() => {
      abort(
        new Error(
          `codex app-server: no answer to ${method} within ${Math.round(timeoutMs / 1000)} s.`,
        ),
      );
    }, timeoutMs);
    pending.set(id, { resolve, reject });
    try {
      write({ id, method, params });
      return (await promise) as T;
    } finally {
      clearTimeout(timeout);
      pending.delete(id);
    }
  }

  function close(): Promise<void> {
    closing ??= (async () => {
      child.stdin.end();
      // Closing stdin lets Codex shut down normally and flush thread state.
      const kill = setTimeout(() => child.kill("SIGKILL"), 2_000);
      try {
        await exited.promise;
      } finally {
        clearTimeout(kill);
      }
    })();
    return closing;
  }

  function abort(error: unknown): void {
    fail(error instanceof Error ? error : new Error(String(error)));
    void close();
  }

  try {
    await request("initialize", {
      clientInfo: { name: "gauss", title: null, version: "0" },
      capabilities: { experimentalApi: true, requestAttestation: false },
    });
    write({ method: "initialized" });
  } catch (error) {
    await close();
    throw error;
  }

  return {
    request,
    close,
    abort,
    unsupported,
    reply(id: RequestId, result: object) {
      write({ id, result });
    },
    listen(message: typeof onMessage, failed: typeof onFailure) {
      onMessage = message;
      onFailure = failed;
    },
    get failure() {
      return failure;
    },
  };
}

export type CodexAppServer = Awaited<ReturnType<typeof openCodexAppServer>>;
