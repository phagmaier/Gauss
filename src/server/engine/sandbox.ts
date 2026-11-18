// The one way the engine runs a command whose input a model or the learner
// wrote (decisions.md, "Confinement"): a code question's tests, the symbolic
// check, installing a course's packages. It runs on
// `@anthropic-ai/sandbox-runtime`, the runtime of Claude Code's sandbox,
// which on Linux is bubblewrap. A command has no network, unless its caller
// names the hosts it may reach through the runtime's proxy; writes only to the
// folders its caller names and to a temporary folder of its own, its
// `$TMPDIR`, removed when it ends; is stopped at its time limit with
// everything it started; and has its output cut to a limit. Reads are not
// confined.
//
// The runtime keeps one configuration per process, so the server starts one
// sandbox (`serve.ts`). Starting checks that it can run, by its dependency
// check and a trial command, and says once what is missing; a sandbox that
// cannot run has no `run`, so nothing that needs it runs.

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { constants, homedir, tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import {
  SandboxManager,
  type SandboxRuntimeConfig,
} from "@anthropic-ai/sandbox-runtime";
import { sandboxCommand, sandboxPython } from "../sandbox-command.ts";

export interface SandboxCommand {
  /** The program and its arguments, passed as they are: no shell reads them. */
  argv: readonly [string, ...string[]];
  /** The folder it runs in, an absolute path. */
  cwd: string;
  /**
   * The folders it may write to, absolute paths. Beyond them it writes only
   * to its `$TMPDIR`.
   */
  writable: readonly string[];
  /**
   * The hosts it may reach, through the runtime's proxy, which refuses every
   * other. Absent or empty: none.
   */
  hosts?: readonly string[];
  /** Variables set for it, over the server's environment. */
  env?: Readonly<Record<string, string>>;
  /** Written to its standard input, which is then closed. Absent: none. */
  input?: string;
  /** How long it may run; then it and everything it started are stopped. */
  timeLimitMs: number;
  /** How many bytes of each output stream are kept, its last; 64 KiB unless given. */
  outputLimit?: number;
  /**
   * Sends its standard error to its standard output, so what the two say
   * keeps its order; `stderr` is then empty.
   */
  mergeOutput?: boolean;
}

export interface SandboxResult {
  /**
   * Its exit status, 128 and the signal's number when a signal ended it;
   * null when it was stopped at its time limit.
   */
  exitCode: number | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  /** Whether the start of either stream was dropped to keep within the limit. */
  cut: boolean;
}

export type Sandbox =
  | {
      available: true;
      run(command: SandboxCommand): Promise<SandboxResult>;
      /** Stops the runtime's proxies. Wait for every run first. */
      close(): Promise<void>;
    }
  | {
      available: false;
      /** What is missing, or why it does not run. */
      reason: string;
      close(): Promise<void>;
    };

const DEFAULT_OUTPUT_LIMIT = 64 * 1024;
// No Unix socket may be made that could connect to one on the host. A
// missing runtime seccomp helper may only warn, and a successful `true` says
// nothing about Unix-socket confinement. A stream pair must be allowed: it is
// connected for good, and uv and asyncio need one.
const socketProbe = `
import errno, socket
creations = [lambda kind=kind: socket.socket(socket.AF_UNIX, kind)
             for kind in (socket.SOCK_STREAM, socket.SOCK_DGRAM)]
creations += [lambda kind=kind: socket.socketpair(socket.AF_UNIX, kind)
              for kind in (socket.SOCK_DGRAM, socket.SOCK_SEQPACKET)]
for create in creations:
    try:
        create()
    except OSError as error:
        if error.errno == errno.EPERM:
            continue
        raise
    raise RuntimeError("the sandbox allowed a Unix socket")
socket.socketpair(socket.AF_UNIX, socket.SOCK_STREAM)
`;

/**
 * Checks that the sandbox can run and starts it. `log` gets one line when it
 * cannot, saying why, and one per warning of the runtime's when it can.
 */
export async function startSandbox(options: {
  log: (line: string) => void;
}): Promise<Sandbox> {
  const { log } = options;
  const unavailable = (why: string): Sandbox => {
    const reason = why.replace(/\s*\n\s*/g, " ");
    log(
      `No sandbox for the engine's commands: ${reason}. Nothing that needs one will run.`,
    );
    return { available: false, reason, close: () => Promise.resolve() };
  };

  if (!SandboxManager.isSupportedPlatform()) {
    return unavailable(`the sandbox does not run on ${process.platform}`);
  }
  const { errors, warnings } = SandboxManager.checkDependencies();
  if (errors.length > 0) return unavailable(errors.join("; "));
  try {
    await SandboxManager.initialize(configFor([]));
  } catch (error) {
    await SandboxManager.reset();
    return unavailable(messageOf(error));
  }
  // Run the workload guard too: installed dependencies do not establish
  // that namespaces, seccomp and the project's Python actually work.
  const trial = await run({
    argv:
      process.platform === "linux"
        ? [sandboxPython, "-I", "-c", socketProbe]
        : ["true"],
    cwd: "/",
    writable: [],
    timeLimitMs: 10_000,
  }).catch((error: unknown) => messageOf(error));
  if (typeof trial === "string" || trial.exitCode !== 0) {
    await SandboxManager.reset();
    const why =
      typeof trial === "string"
        ? trial
        : trial.stderr.trim() || `exit status ${trial.exitCode}`;
    return unavailable(`a trial command failed: ${why}`);
  }
  for (const warning of warnings) {
    log(`The sandbox for the engine's commands has a warning: ${warning}`);
  }
  return { available: true, run, close: () => SandboxManager.reset() };
}

/**
 * The runtime's configuration for a command that may write to `writable`.
 * It has no network: an empty allow list sends every connection to the
 * runtime's proxy, which refuses it. The runtime always leaves a few paths
 * writable that no caller named; two are closed here. `~/.npm/_logs` and
 * `~/.claude/debug` are dropped when a read deny covers them (they become
 * empty folders whose writes are lost), and `/tmp/claude` is denied writes.
 */
function configFor(writable: readonly string[]): SandboxRuntimeConfig {
  return {
    network: { allowedDomains: [], deniedDomains: [] },
    filesystem: {
      denyRead: [
        join(homedir(), ".npm", "_logs"),
        join(homedir(), ".claude", "debug"),
      ],
      allowWrite: [...writable],
      denyWrite: ["/tmp/claude"],
    },
  };
}

async function run(command: SandboxCommand): Promise<SandboxResult> {
  for (const path of [command.cwd, ...command.writable]) {
    if (!isAbsolute(path)) throw new Error(`Not an absolute path: ${path}`);
  }
  // The runtime sets TMPDIR inside the sandbox, so the command's own is
  // set by the script it runs, after the runtime's.
  const variables = Object.entries(command.env ?? {});
  for (const [name] of variables) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      throw new Error(`Not a variable's name: ${name}`);
    }
  }
  const temporary = await mkdtemp(join(tmpdir(), "gauss-run-"));
  // The proxy knows a command's hosts by the id its client presents, so the
  // id is random, as the runtime requires, and lives only while it runs.
  const hosts = command.hosts ?? [];
  const commandId = randomBytes(16).toString("base64url");
  try {
    const exports = [["TMPDIR", temporary], ...variables]
      .map(([name, value]) => `export ${name}=${quote(value ?? "")}; `)
      .join("");
    const merge = command.mergeOutput === true ? " 2>&1" : "";
    const script = `${exports}exec ${sandboxCommand(command.argv)}${merge}`;
    const wrapped = await SandboxManager.wrapWithSandbox(
      script,
      undefined,
      configFor([...command.writable, temporary]),
      undefined,
      { commandId },
    );
    if (hosts.length > 0) {
      SandboxManager.registerCommandNetworkLists(commandId, {
        allowedDomains: [...hosts],
      });
    }
    try {
      return await runWrapped(wrapped, command);
    } finally {
      if (hosts.length > 0) {
        SandboxManager.unregisterCommandNetworkLists(commandId);
      }
      SandboxManager.cleanupAfterCommand();
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

/**
 * Runs the runtime's command line. It runs in a process group of its own,
 * which the time limit kills; bubblewrap gives the command a PID namespace,
 * so everything the command started dies with it, whatever group or
 * session it moved to. The runtime's own argv form starts `/bin/bash`,
 * which not every system has; `/bin/sh` is what it is written for.
 */
function runWrapped(
  wrapped: string,
  command: SandboxCommand,
): Promise<SandboxResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("/bin/sh", ["-c", wrapped], {
      cwd: command.cwd,
      detached: true,
      stdio: [command.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });
    const limit = command.outputLimit ?? DEFAULT_OUTPUT_LIMIT;
    const stdout = lastBytes(limit);
    const stderr = lastBytes(limit);
    child.stdout?.on("data", stdout.add);
    child.stderr?.on("data", stderr.add);
    if (command.input !== undefined) {
      // A command that exits without reading its input closes the pipe.
      child.stdin?.on("error", () => {});
      child.stdin?.end(command.input);
    }

    let timedOut = false;
    const timer = setTimeout(() => {
      // Ended, its output not yet all read: it kept to its limit.
      if (child.exitCode !== null || child.signalCode !== null) return;
      timedOut = true;
      if (child.pid === undefined) return;
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        // It ended as the limit came.
      }
    }, command.timeLimitMs);

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      const out = stdout.end();
      const err = stderr.end();
      resolve({
        exitCode: timedOut
          ? null
          : (code ?? 128 + (signal === null ? 0 : constants.signals[signal])),
        timedOut,
        stdout: out.text,
        stderr: err.text,
        cut: out.cut || err.cut,
      });
    });
  });
}

/**
 * Keeps the last `limit` bytes of a stream, holding no more than that and
 * one chunk at a time. A cut that falls inside a UTF-8 character drops the
 * character.
 */
function lastBytes(limit: number) {
  const chunks: Buffer[] = [];
  let size = 0;
  let cut = false;
  return {
    add(chunk: Buffer): void {
      chunks.push(chunk);
      size += chunk.length;
      for (;;) {
        const first = chunks[0];
        if (chunks.length < 2 || first === undefined) break;
        if (size - first.length < limit) break;
        chunks.shift();
        size -= first.length;
        cut = true;
      }
    },
    end(): { text: string; cut: boolean } {
      let bytes = Buffer.concat(chunks);
      if (bytes.length > limit) {
        bytes = bytes.subarray(bytes.length - limit);
        cut = true;
      }
      if (cut) {
        let start = 0;
        while (start < bytes.length && ((bytes[start] ?? 0) & 0xc0) === 0x80) {
          start += 1;
        }
        bytes = bytes.subarray(start);
      }
      let text = bytes.toString("utf8");
      // Replacement characters for invalid UTF-8 can occupy more bytes than
      // their input. Bound the returned text too, keeping a complete suffix.
      if (Buffer.byteLength(text) > limit) {
        const encoded = Buffer.from(text);
        let start = encoded.length - limit;
        while (((encoded[start] ?? 0) & 0xc0) === 0x80) start += 1;
        text = encoded.subarray(start).toString("utf8");
        cut = true;
      }
      return { text, cut };
    },
  };
}

/** Quotes a word for the shell, so that it reads it as it is. */
function quote(word: string): string {
  return `'${word.replaceAll("'", `'\\''`)}'`;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
