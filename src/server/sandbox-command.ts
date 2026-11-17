// The workload filter must run inside the runtime's sandbox, after its
// relays and namespace helper. Shared by engine commands and tutor Bash.
import { fileURLToPath } from "node:url";

export const sandboxPython = fileURLToPath(
  new URL("../../pytools/.venv/bin/python", import.meta.url),
);
const socketGuard = fileURLToPath(
  new URL("../../pytools/sandbox_exec.py", import.meta.url),
);

/** A shell command whose argv is passed unread, with Linux's extra filter. */
export function sandboxCommand(argv: readonly string[]): string {
  const guarded =
    process.platform === "linux"
      ? [sandboxPython, "-I", socketGuard, ...argv]
      : argv;
  return guarded.map((word) => `'${word.replaceAll("'", `'\\''`)}'`).join(" ");
}
