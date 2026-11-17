// Installing a course's packages (task 3.11; decisions.md, "Confinement"):
// the one command of a course with network access, open to the package index
// alone. The tutor names the packages; the commands are built here, from
// names and version ranges the schema has checked, so that no text of the
// tutor's runs with the network open. Python's packages go in through uv.
//
// The tutor can write anything in the workspace, so the commands trust
// nothing in it that could run:
//
// - `.venv` is removed first and made again, since a `python` or a `.pth`
//   file the tutor put there would run when uv looks at the environment;
// - `--no-build` and `--no-install-project`: wheels only, and the workspace's
//   own project is never built, so no build script or `setup.py` runs;
// - `--no-config` and `--no-sources`: no `uv.toml`, index or source of the
//   tutor's applies;
// - `--python` names the project's own interpreter, and none is downloaded.
//
// uv's cache lies outside the record, in the data root's `cache/uv`, and is
// copied from rather than linked to, so that a file the tutor changes in the
// environment does not change the cache.

import { existsSync } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { type PackageSpec, requirement } from "../../shared/packages.ts";
import { sandboxPython } from "../sandbox-command.ts";
import type { SandboxCommand, SandboxResult } from "./sandbox.ts";

/** The hosts the install may reach: PyPI's index and its files. */
export const PACKAGE_HOSTS = ["pypi.org", "files.pythonhosted.org"] as const;

/** How long an install may run. */
const TIME_LIMIT_MS = 10 * 60_000;

/** How many lines of the output's end the card and the tutor get. */
const OUTPUT_LINES = 30;

export interface InstallResult {
  ok: boolean;
  /** The end of what the commands wrote, both streams. */
  output: string;
}

export interface PackageInstaller {
  /** The commands an install of these packages runs in the workspace, in order. */
  commands(workspace: string, packages: readonly PackageSpec[]): string[][];
  /** Installs the packages in the workspace. Never throws. */
  install(
    workspace: string,
    packages: readonly PackageSpec[],
  ): Promise<InstallResult>;
}

export function createPackageInstaller(options: {
  /** Runs a command in the engine's sandbox. */
  run(command: SandboxCommand): Promise<SandboxResult>;
  /** uv's cache, a folder outside the record. */
  cacheFolder: string;
  /** The Python the workspace's environment is made from. */
  python: string;
}): PackageInstaller {
  const { cacheFolder, python } = options;

  function commands(
    workspace: string,
    packages: readonly PackageSpec[],
  ): string[][] {
    const add = [
      "uv",
      "add",
      "--no-build",
      "--no-install-project",
      "--no-sources",
      "--no-config",
      "--no-python-downloads",
      "--python",
      python,
      "--color",
      "never",
      "--no-progress",
      ...packages.map(requirement),
    ];
    if (existsSync(join(workspace, "pyproject.toml"))) return [add];
    const init = [
      "uv",
      "init",
      "--bare",
      "--no-workspace",
      "--vcs",
      "none",
      "--no-config",
      "--no-python-downloads",
      "--python",
      python,
    ];
    return [init, add];
  }

  return {
    commands,
    async install(workspace, packages) {
      const output: string[] = [];
      try {
        await mkdir(cacheFolder, { recursive: true });
        await rm(join(workspace, ".venv"), { recursive: true, force: true });
        for (const argv of commands(workspace, packages)) {
          const [program, ...rest] = argv;
          if (program === undefined) continue;
          const result = await options.run({
            argv: [program, ...rest],
            cwd: workspace,
            writable: [workspace, cacheFolder],
            hosts: argv[1] === "add" ? PACKAGE_HOSTS : [],
            env: { UV_CACHE_DIR: cacheFolder, UV_LINK_MODE: "copy" },
            timeLimitMs: TIME_LIMIT_MS,
          });
          output.push(result.stdout, result.stderr);
          if (result.timedOut) {
            output.push(
              `Stopped after ${TIME_LIMIT_MS / 60_000} minutes, its time limit.`,
            );
            return { ok: false, output: lastLines(output) };
          }
          if (result.exitCode !== 0) {
            output.push(`Exit status ${result.exitCode}.`);
            return { ok: false, output: lastLines(output) };
          }
        }
        return { ok: true, output: lastLines(output) };
      } catch (error) {
        output.push(error instanceof Error ? error.message : String(error));
        return { ok: false, output: lastLines(output) };
      }
    },
  };
}

/**
 * The Python the project's helpers run on, which mise pins: the base of
 * `pytools/.venv`, read from its `pyvenv.cfg`, so none is looked for on the
 * path or downloaded.
 */
export async function projectPython(): Promise<string> {
  const config = await readFile(
    join(dirname(dirname(sandboxPython)), "pyvenv.cfg"),
    "utf8",
  );
  const home = /^home\s*=\s*(.+)$/m.exec(config)?.[1]?.trim();
  if (home === undefined) {
    throw new Error("pytools/.venv/pyvenv.cfg names no Python.");
  }
  return join(home, "python3");
}

/** The last lines of the output, without the blank ones. */
function lastLines(parts: readonly string[]): string {
  const lines = parts
    .join("\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line !== "");
  return lines.slice(-OUTPUT_LINES).join("\n");
}
