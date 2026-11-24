// The model and effort a Codex session runs on, the live-check pin, and
// whether a Codex course can be made here (docs/findings.md, "Codex").

import { execFile, spawn } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { promisify } from "node:util";

export interface CodexBackendOptions {
  /** The model, such as "gpt-6.1-terra". Left out, the login's default. */
  model?: string;
  /**
   * The reasoning effort, such as "medium". Left out, the model's default.
   * A resume can fall back to the effort the thread saved, or to none, so
   * a caller gives both on every `turn/start` (docs/findings.md, "Codex").
   */
  effort?: string;
  /**
   * The service tier; "default" is standard speed. Left out, the model's
   * catalog default, which for gpt-6.1-terra is the faster "priority".
   */
  serviceTier?: string;
}

/** The one model, effort and tier a live check runs Codex on (AGENTS.md). */
export const CODEX_LIVE_CHECK_OPTIONS = {
  model: "gpt-6.1-terra",
  effort: "medium",
  serviceTier: "default",
} as const satisfies CodexBackendOptions;

/**
 * The model, effort and tier Codex runs on: under the live-check launcher
 * always the pinned ones, whatever the caller asks for, so that a trial or
 * an older harness cannot run another.
 */
export function codexOptions(
  requested: CodexBackendOptions = {},
): CodexBackendOptions {
  return process.env.GAUSS_LIVE_CHECK === "1"
    ? CODEX_LIVE_CHECK_OPTIONS
    : requested;
}

/**
 * Gauss's own Codex home, outside every data root, holding only its login
 * and what Codex writes (docs/architecture.md, "Working here").
 */
export const GAUSS_CODEX_HOME = join(
  homedir(),
  ".local",
  "state",
  "gauss",
  "codex",
);

/**
 * The environment Codex runs in: the server's, without its `OPENAI_` and
 * `CODEX_` variables, which could sign Codex in another way or move its
 * home, and with `CODEX_HOME` set to `home`.
 */
export function codexEnvironment(
  home: string,
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const kept = Object.entries(env).filter(
    ([name]) => !name.startsWith("OPENAI_") && !name.startsWith("CODEX_"),
  );
  return { ...Object.fromEntries(kept), CODEX_HOME: home };
}

/** The Codex CLI version `mise.toml` pins, whose app-server protocol Gauss speaks. */
export async function pinnedCodexVersion(): Promise<string> {
  const toml = await readFile(
    new URL("../../../mise.toml", import.meta.url),
    "utf8",
  );
  const pin = /^codex\s*=\s*"([^"]+)"/m.exec(toml)?.[1];
  if (pin === undefined) throw new Error("mise.toml pins no Codex version.");
  return pin;
}

/**
 * Why a course cannot run on Codex now, or undefined when it can: the CLI
 * on the PATH is the pinned version and Gauss's Codex home is signed in,
 * which `account/read` answers with an account (null signed out; its
 * `requiresOpenaiAuth` is true either way). Calls no model.
 */
export async function codexUnavailable(
  options: {
    /** The `codex` executable; the one on the PATH if not given. */
    command?: string;
    home?: string;
    /** The version required; mise.toml's pin if not given. */
    version?: string;
    timeoutMs?: number;
  } = {},
): Promise<string | undefined> {
  const command = options.command ?? "codex";
  const home = options.home ?? GAUSS_CODEX_HOME;
  const pinned = options.version ?? (await pinnedCodexVersion());
  const timeoutMs = options.timeoutMs ?? 20_000;
  const env = codexEnvironment(home);
  let said: string;
  try {
    const { stdout } = await promisify(execFile)(command, ["--version"], {
      env,
      timeout: timeoutMs,
    });
    said = stdout.trim();
  } catch (error) {
    return (
      `Codex could not be run (${messageOf(error)}). Gauss needs the ` +
      `Codex CLI ${pinned}, which \`mise install\` in Gauss's folder installs.`
    );
  }
  if (said.split(/\s+/).at(-1) !== pinned) {
    return (
      `Gauss needs the Codex CLI ${pinned}, but \`codex --version\` says ` +
      `"${said}". Start Gauss through mise, which runs the version it pins.`
    );
  }
  // Codex refuses a home that does not exist, with an error of its own.
  const isFolder = await stat(home).then(
    (s) => s.isDirectory(),
    () => false,
  );
  if (!isFolder) return notSignedIn(home);
  try {
    return (await readAccount(command, home, env, timeoutMs)) === null
      ? notSignedIn(home)
      : undefined;
  } catch (error) {
    return `Codex did not say whether it is signed in: ${messageOf(error)}`;
  }
}

function notSignedIn(home: string): string {
  const shown = home.startsWith(`${homedir()}/`)
    ? `~${home.slice(homedir().length)}`
    : home;
  return (
    `Gauss's Codex home, ${shown}, is not signed in. Sign in once, from ` +
    `Gauss's folder: \`mkdir -p -m 700 ${shown}\`, then ` +
    `\`CODEX_HOME=${shown} mise exec -- codex login\`.`
  );
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The account `account/read` reports through `codex app-server`, null when signed out. */
function readAccount(
  command: string,
  home: string,
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
): Promise<unknown> {
  const { promise, resolve, reject } = Promise.withResolvers<unknown>();
  // In the home, so that no project's files are near.
  const child = spawn(command, ["app-server"], { cwd: home, env });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr = (stderr + chunk).slice(-500);
  });
  child.on("error", reject);
  child.on("close", (code) =>
    reject(
      new Error(
        `codex app-server ended (exit ${code}) before answering` +
          (stderr.trim() === "" ? "." : `: ${stderr.trim()}`),
      ),
    ),
  );
  // Writing to a process that has ended is reported by "close" above.
  child.stdin.on("error", () => {});
  const timer = setTimeout(
    () =>
      reject(new Error(`no answer within ${Math.round(timeoutMs / 1000)} s.`)),
    timeoutMs,
  );
  createInterface({ input: child.stdout }).on("line", (line) => {
    let message: {
      id?: unknown;
      result?: { account?: unknown };
      error?: { message?: string };
    };
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (message.id !== 2) return;
    if (message.error !== undefined) {
      reject(new Error(message.error.message ?? "account/read failed."));
    } else {
      resolve(message.result?.account ?? null);
    }
  });
  for (const message of [
    {
      id: 1,
      method: "initialize",
      params: {
        clientInfo: { name: "gauss", title: null, version: "0" },
        capabilities: null,
      },
    },
    { method: "initialized" },
    { id: 2, method: "account/read", params: { refreshToken: false } },
  ]) {
    child.stdin.write(`${JSON.stringify(message)}\n`);
  }
  return promise.finally(() => {
    clearTimeout(timer);
    child.kill();
  });
}
