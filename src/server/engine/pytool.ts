// One run of a script in `pytools/` in the engine's sandbox, on the venv's
// own Python, isolated, for a file that comes from outside the machine.
// Within the data root, which the sandbox closes, the script can read only
// what `readable` names and write only `writable`; elsewhere it has the
// sandbox's usual reads and private temporary folder. It prints one line of
// JSON. A run that fails, runs out of time or prints something out of shape
// comes back as a failure, never an exception.

import { fileURLToPath } from "node:url";
import type { z } from "zod";
import { sandboxPython } from "../sandbox-command.ts";
import { duration } from "./grading.ts";
import type { Sandbox, SandboxResult } from "./sandbox.ts";

export type PytoolFailure =
  | { result: "failed"; reason: string }
  | { result: "timed-out"; limit: string };

/** The path of `pytools/<name>`. */
export function pytool(name: string): string {
  return fileURLToPath(new URL(`../../../pytools/${name}`, import.meta.url));
}

/** Runs the script with these arguments, and reads its line of output in the shape given. */
export async function runPytool<T>(
  run: Extract<Sandbox, { available: true }>["run"],
  script: string,
  args: readonly string[],
  within: { writable: string; readable: string },
  shape: z.ZodType<T>,
  limitMs: number,
  signal: AbortSignal | undefined,
): Promise<T | PytoolFailure> {
  let ran: SandboxResult;
  try {
    ran = await run({
      argv: [sandboxPython, "-I", script, ...args],
      cwd: "/",
      writable: [within.writable],
      readable: [within.readable],
      timeLimitMs: limitMs,
      outputLimit: 64 * 1024,
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error) {
    return {
      result: "failed",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
  if (ran.timedOut) {
    return { result: "timed-out", limit: duration(limitMs) };
  }
  if (ran.exitCode !== 0) {
    const said = ran.stderr.trim().split("\n").at(-1)?.trim();
    return {
      result: "failed",
      reason: `it stopped with exit status ${ran.exitCode}${said ? `: ${said}` : ""}`,
    };
  }
  try {
    return shape.parse(JSON.parse(ran.stdout));
  } catch {
    return { result: "failed", reason: "its output could not be read" };
  }
}
