// Opens a file in the system's default app for it (task 3.22): "Open" on a
// code question's card. The server starts the platform's opener, xdg-open
// on Linux and open on macOS, outside the sandbox, as the learner's own
// click would, and leaves what it starts running, in a process group of its
// own so that stopping the server does not stop the learner's editor.
//
// An opener that fails says so on its error stream and exits non-zero, at
// once. One that is still running after a short wait has started something
// (xdg-open on a desktop with no opener of its own runs the app itself and
// can wait for it), and counts as started. Its errors go to a file, never
// to a pipe: a pipe the server closes could stop the app with SIGPIPE.

import { spawn } from "node:child_process";
import { mkdtemp, open, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type OpenResult = { ok: true } | { ok: false; error: string };

/** Opens the file, by its absolute path, in the system's default app for it. */
export type FileOpener = (path: string) => Promise<OpenResult>;

/** How long an opener has to fail before it counts as started. */
const WAIT_MS = 3000;

/** The longest line of an opener's errors the learner is shown. */
const LINE_LIMIT = 300;

type Ended =
  | { started: true }
  | { error: NodeJS.ErrnoException }
  | { code: number | null; signal: NodeJS.Signals | null };

export function systemOpener(
  options: {
    platform?: NodeJS.Platform;
    /** The opener's environment; the server's own when unset. */
    env?: NodeJS.ProcessEnv;
    /** The program and its first words, with the file's path after them; the platform's opener when unset. */
    command?: readonly [string, ...string[]];
    waitMs?: number;
  } = {},
): FileOpener {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const waitMs = options.waitMs ?? WAIT_MS;
  const opener = PLATFORM_OPENERS[platform];
  return async (path) => {
    if (opener === undefined) {
      return {
        ok: false,
        error: "Gauss can open files only on Linux and macOS.",
      };
    }
    const [program, ...words] = options.command ?? [opener];
    const folder = await mkdtemp(join(tmpdir(), "gauss-open-"));
    try {
      const errors = join(folder, "errors");
      const sink = await open(errors, "w");
      let ended: Ended;
      try {
        const child = spawn(program, [...words, path], {
          detached: true,
          env,
          stdio: ["ignore", "ignore", sink.fd],
        });
        ended = await new Promise<Ended>((resolve) => {
          const timer = setTimeout(() => resolve({ started: true }), waitMs);
          child.once("error", (error) => {
            clearTimeout(timer);
            resolve({ error });
          });
          child.once("exit", (code, signal) => {
            clearTimeout(timer);
            resolve({ code, signal });
          });
        });
        child.unref();
      } finally {
        await sink.close();
      }
      if ("started" in ended) return { ok: true };
      if ("error" in ended) {
        return {
          ok: false,
          error:
            ended.error.code === "ENOENT"
              ? `${program} was not found, so the file could not be opened.`
              : `${program} could not be started: ${ended.error.message}`,
        };
      }
      if (ended.code === 0) return { ok: true };
      const said = lastLine(await readFile(errors, "utf8"));
      const how =
        ended.code === null
          ? `${program} was stopped by ${ended.signal}`
          : `${program} exited with status ${ended.code}`;
      return {
        ok: false,
        error: [
          said === undefined ? `${how}.` : `${said} (${how}).`,
          ...(platform === "linux" && !hasDisplay(env) ? [NO_DISPLAY] : []),
        ].join(" "),
      };
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  };
}

const PLATFORM_OPENERS: Partial<Record<NodeJS.Platform, string>> = {
  linux: "xdg-open",
  darwin: "open",
};

/**
 * xdg-open finds no way to open a file without a display, and a server
 * started outside the desktop session, as from a service, has none.
 */
const NO_DISPLAY =
  "The server has no desktop display (neither WAYLAND_DISPLAY nor DISPLAY is set): start Gauss from a terminal in your desktop session.";

function hasDisplay(env: NodeJS.ProcessEnv): boolean {
  return Boolean(env.WAYLAND_DISPLAY) || Boolean(env.DISPLAY);
}

function lastLine(text: string): string | undefined {
  const line = text
    .split("\n")
    .map((l) => l.trim())
    .findLast((l) => l !== "");
  return line === undefined || line.length <= LINE_LIMIT
    ? line
    : `${line.slice(0, LINE_LIMIT)}...`;
}
