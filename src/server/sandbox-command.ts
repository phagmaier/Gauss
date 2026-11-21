// What a sandboxed command gets, the engine's and the tutor's alike
// (decisions.md, "Confinement"): the Linux workload filter, which must run
// inside the runtime's sandbox after its relays and namespace helper; the
// variables of the server's environment it keeps; and where it may read.
import { constants } from "node:fs";
import { access, readFile, realpath } from "node:fs/promises";
import { homedir, userInfo } from "node:os";
import { delimiter, dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

/** The sandbox's helpers, its workload filter among them, and their venv. */
const helpers = fileURLToPath(new URL("../../pytools", import.meta.url));
export const sandboxPython = join(helpers, ".venv", "bin", "python");
const workloadFilter = join(helpers, "sandbox_exec.py");

/**
 * The variables of the server's environment a command keeps. Every variable
 * starting with `LC_` is kept too. Inside, the workload filter adds only
 * what the sandbox sets: its temporary folder and its proxy.
 */
const KEPT = new Set(["PATH", "HOME", "LANG", "TZ", "TERM"]);

/** The variables of `environment` a command keeps. */
export function commandEnvironment(
  environment: NodeJS.ProcessEnv,
): Record<string, string> {
  const kept: Record<string, string> = {};
  for (const [name, value] of Object.entries(environment)) {
    if (value !== undefined && (KEPT.has(name) || name.startsWith("LC_"))) {
      kept[name] = value;
    }
  }
  return kept;
}

/**
 * A shell command that runs `argv`, passed unread, in the workload filter,
 * with only the kept variables of the server's environment and `variables`
 * over them. Linux only, as the sandboxes that run it are.
 */
export function sandboxCommand(
  argv: readonly string[],
  variables: Readonly<Record<string, string>> = {},
): string {
  const environment = { ...commandEnvironment(process.env), ...variables };
  return [
    sandboxPython,
    "-I",
    workloadFilter,
    ...Object.entries(environment).map(([name, value]) => `${name}=${value}`),
    "--",
    ...argv,
  ]
    .map((word) => `'${word.replaceAll("'", `'\\''`)}'`)
    .join(" ");
}

/**
 * Where a command may read: nowhere in `denied` but in `allowed`, which lies
 * inside it. Real paths, since the runtime allows a path back only where it
 * really lies.
 */
export interface CommandReads {
  denied: string[];
  allowed: string[];
}

/**
 * The reads of every command, the engine's and the tutor's: closed are the
 * home folder (as HOME and the account give it), the data root and the
 * user's runtime folder (`/run/user/<uid>`, its sockets and keyrings); open
 * again is what a command needs to start: `pytools/`, the workload filter
 * and the sandbox's other helpers with their venv; that venv's Python, which
 * the workspaces' venvs are made from too (`projectPython`); and the uv on
 * the server's path. A workspace's own venv is not read for its Python: the
 * tutor can write it. Rejects when that Python or uv would open a closed
 * folder whole.
 */
export async function commandReads(dataRoot: string): Promise<CommandReads> {
  const { uid, homedir: account } = userInfo();
  const denied = unique(
    await Promise.all(
      [homedir(), account, dataRoot, `/run/user/${uid}`].map(real),
    ),
  );
  // The Python's prefix, above its bin/.
  const python = dirname(dirname(await realpath(await projectPython())));
  const allowed = [await realpath(helpers), python];
  const uv = await onPath("uv");
  if (uv !== undefined) allowed.push(await realpath(uv));
  for (const path of allowed) {
    const opened = denied.find((folder) => isAtOrUnder(folder, path));
    if (opened !== undefined) {
      throw new Error(
        `${path}, which commands need, would open ${opened} to them`,
      );
    }
  }
  return { denied, allowed };
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

/** The first executable of the name on the server's path. */
async function onPath(name: string): Promise<string | undefined> {
  for (const folder of (process.env.PATH ?? "").split(delimiter)) {
    if (folder === "") continue;
    const path = join(folder, name);
    try {
      await access(path, constants.X_OK);
      return path;
    } catch {}
  }
  return undefined;
}

/** The real path of one that exists, or the path as given. */
async function real(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return path;
  }
}

/** Whether `path` is `folder` or lies inside it. */
function isAtOrUnder(path: string, folder: string): boolean {
  const rest = relative(folder, path);
  return rest !== ".." && !rest.startsWith(`..${sep}`);
}

function unique(paths: readonly string[]): string[] {
  return [...new Set(paths)];
}
