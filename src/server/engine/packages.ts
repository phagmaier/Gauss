// The tutor controls the workspace, so uv resolves packages in a separate,
// engine-owned project. The learner's previous environment is parked outside
// uv's writable paths until the fresh environment is ready.

import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  rmdir,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import type { Slug } from "../../shared/course.ts";
import {
  type PackageCompletion,
  PackageReceipt,
  type PackageSpec,
  PackagesInput,
  requirement,
} from "../../shared/packages.ts";
import { syncFolder, writeFileAtomic } from "../record/atomic-write.ts";
import type { DataRoot } from "../record/data-root.ts";
import type { SandboxCommand, SandboxResult } from "./sandbox.ts";

/** The hosts the install may reach: PyPI's index and its files. */
export const PACKAGE_HOSTS = ["pypi.org", "files.pythonhosted.org"] as const;

/** How long an install may run. */
const TIME_LIMIT_MS = 10 * 60_000;

/** How many lines of the output's end the card and the tutor get. */
const OUTPUT_LINES = 30;

const PROJECT_FOLDER = "packages";
const PROJECT_FILES = ["pyproject.toml", "uv.lock"] as const;
const INSTALL_PARK = ".package-install.tmp";

type InstallCompletion = PackageReceipt["completion"];
type InstallCard = Pick<PackageCompletion, "request" | "preview">;

export interface PackageInstaller {
  /** The networked command the approval card shows and the installer runs. */
  commands(workspace: string, packages: readonly PackageSpec[]): string[][];
  /** Installs the packages and journals the result until the chat saves it. */
  install(
    workspace: string,
    unitId: Slug,
    card: InstallCard,
  ): Promise<InstallCompletion>;
}

export function createPackageInstaller(options: {
  /** Runs a command in the engine's sandbox. */
  run(command: SandboxCommand): Promise<SandboxResult>;
  /** uv's cache, a folder outside the record. */
  cacheFolder: string;
  /** The Python the workspace's environment is made from. */
  python: string;
  /** Course records used only to migrate earlier successful installs. */
  dataRoot?: Pick<DataRoot, "readCourse" | "readTranscripts">;
}): PackageInstaller {
  const { python, dataRoot } = options;

  function command(
    workspace: string,
    packages: readonly PackageSpec[],
  ): [string, ...string[]] {
    return [
      "uv",
      "add",
      "--directory",
      resolve(workspace, "..", PROJECT_FOLDER),
      "--default-index",
      "https://pypi.org/simple",
      "--no-build",
      "--no-install-project",
      "--no-install-workspace",
      "--no-install-local",
      "--no-sources",
      "--no-config",
      "--no-python-downloads",
      "--raw",
      "--python",
      python,
      "--color",
      "never",
      "--no-progress",
      ...PackagesInput.parse({ packages }).packages.map(requirement),
    ];
  }

  return {
    commands: (workspace, packages) => [command(workspace, packages)],
    async install(workspace, unitId, card) {
      const output: string[] = [];
      const completion = (
        outcome: InstallCompletion["outcome"],
      ): InstallCompletion => ({ ...card, outcome, output: lastLines(output) });
      try {
        const argv = command(workspace, card.request.packages);
        const folder = await checkedFolder(resolve(workspace));
        const course = dirname(folder);
        if (await recoverPackageInstall(folder)) {
          throw new Error("The previous install's result has not been saved.");
        }
        const project = await checkedFolder(join(course, PROJECT_FOLDER), true);
        const park = join(course, INSTALL_PARK);
        const environment = join(folder, ".venv");
        const cache = await checkedFolder(resolve(options.cacheFolder), true);
        await mkdir(park);
        try {
          await syncFolder(course);
          const preparing = join(park, "preparing");
          const running = join(park, "running");
          await mkdir(preparing);
          for (const name of PROJECT_FILES) {
            const file = join(project, name);
            const state = await entry(file);
            if (state === undefined) continue;
            if (!state.isFile()) throw new Error(`Not a regular file: ${file}`);
            await copyFile(file, join(preparing, name));
          }
          // Rename the directory entry itself, including a dangling symlink.
          if (await entry(environment)) {
            await rename(environment, join(preparing, "previous"));
            await syncFolder(preparing);
            await syncFolder(folder);
          }
          await rename(preparing, running);
          await syncFolder(park);

          let outcome: InstallCompletion["outcome"] = "failed";
          try {
            const manifest = join(project, "pyproject.toml");
            if (!(await entry(manifest))) {
              await rm(join(project, "uv.lock"), { force: true });
              const dependencies = await recordedRoots(
                dataRoot,
                basename(course),
              );
              await writeFile(manifest, projectManifest(dependencies), {
                flag: "wx",
              });
            }
            // uv gets an empty directory at the final path, both to bind it
            // into the sandbox and to keep generated entry-point paths valid.
            await mkdir(environment);
            const result = await options.run({
              argv,
              cwd: project,
              writable: [project, cache, environment],
              hosts: PACKAGE_HOSTS,
              env: {
                UV_PROJECT_ENVIRONMENT: environment,
                UV_CACHE_DIR: cache,
                UV_LINK_MODE: "copy",
              },
              timeLimitMs: TIME_LIMIT_MS,
            });
            output.push(result.stdout, result.stderr);
            if (result.timedOut) {
              output.push(
                `Stopped after ${TIME_LIMIT_MS / 60_000} minutes, its time limit.`,
              );
            } else if (result.exitCode !== 0) {
              output.push(`Exit status ${result.exitCode}.`);
            } else {
              outcome = "installed";
            }
          } catch (error) {
            output.push(error instanceof Error ? error.message : String(error));
          }
          await writeFileAtomic(
            join(running, "receipt.json"),
            JSON.stringify({
              unitId,
              completion: completion(outcome),
            } satisfies PackageReceipt),
          );
          if (outcome === "installed") {
            // Publish the candidate and its receipt with the same rename.
            await syncFolder(folder);
            await syncFolder(project);
            await rename(running, join(park, "committed"));
            await syncFolder(park);
          }
        } catch (error) {
          output.push(error instanceof Error ? error.message : String(error));
        }
        const receipt = await recoverPackageInstall(folder);
        if (receipt !== undefined) return receipt.completion;
      } catch (error) {
        output.push(error instanceof Error ? error.message : String(error));
      }
      return completion("failed");
    },
  };
}

/**
 * Recovers an interrupted swap without ever opening the old venv. A
 * published receipt is only read here; the course clears it after saving.
 */
export async function recoverPackageInstall(
  workspace: string,
): Promise<PackageReceipt | undefined> {
  const path = join(dirname(resolve(workspace)), INSTALL_PARK);
  if (!(await entry(path))) return undefined;
  const folder = await checkedFolder(resolve(workspace));
  const park = await checkedFolder(join(dirname(folder), INSTALL_PARK));
  const environment = join(folder, ".venv");
  const preparing = join(park, "preparing");
  const running = join(park, "running");
  const committed = join(park, "committed");
  const active = await entry(running);
  if (active !== undefined) {
    if (!active.isDirectory()) throw new Error(`Not a directory: ${running}`);
    const project = await checkedFolder(
      join(dirname(folder), PROJECT_FOLDER),
      true,
    );
    for (const name of PROJECT_FILES) {
      const file = join(project, name);
      const saved = join(running, name);
      await rm(file, { force: true });
      if (await entry(saved)) await copyFile(saved, file);
    }
    await rm(environment, { recursive: true, force: true });
    // On reentry after this rename there is no candidate left to remove.
    await rename(running, preparing);
  }
  const pending = await entry(preparing);
  if (pending !== undefined) {
    if (!pending.isDirectory())
      throw new Error(`Not a directory: ${preparing}`);
    const previous = join(preparing, "previous");
    if (await entry(previous)) await rename(previous, environment);
    const receipt = await readReceipt(preparing);
    if (receipt?.completion.outcome === "failed") {
      // The previous environment is back; the failure can now be recorded.
      await rename(preparing, committed);
      await syncFolder(park);
    } else {
      // An installed receipt not yet committed goes away with its candidate.
      await rm(preparing, { recursive: true });
    }
  }
  const done = await entry(committed);
  if (done !== undefined) {
    if (!done.isDirectory()) throw new Error(`Not a directory: ${committed}`);
    const receipt = await readReceipt(committed);
    if (receipt !== undefined) return receipt;
    // Older journals committed the environment without a receipt.
    await rm(committed, { recursive: true });
  }
  await rmdir(park);
}

async function readReceipt(
  folder: string,
): Promise<PackageReceipt | undefined> {
  const path = join(folder, "receipt.json");
  const state = await entry(path);
  if (state === undefined) return undefined;
  if (!state.isFile()) throw new Error(`Not a regular file: ${path}`);
  return PackageReceipt.parse(JSON.parse(await readFile(path, "utf8")));
}

/** Discards the journal of a committed result once state.json has it. */
export async function clearPackageInstall(workspace: string): Promise<void> {
  const path = join(dirname(resolve(workspace)), INSTALL_PARK);
  if (!(await entry(path))) return;
  const park = await checkedFolder(path);
  await rm(join(park, "committed"), { recursive: true, force: true });
  await rmdir(park);
}

/** Checks ancestors before looking through them, allowing macOS system aliases. */
async function checkedFolder(path: string, create = false): Promise<string> {
  const parent = dirname(path);
  if (parent === path) return path;
  const folder = join(await checkedFolder(parent, create), basename(path));
  let state = await entry(folder);
  if (create && state === undefined) {
    await mkdir(folder, { recursive: true });
    state = await entry(folder);
  }
  if (state?.isDirectory()) return folder;
  if (
    process.platform === "darwin" &&
    state?.isSymbolicLink() &&
    (folder === "/tmp" || folder === "/var") &&
    (await realpath(folder)) === `/private${folder}`
  ) {
    return `/private${folder}`;
  }
  throw new Error(
    `Not a directory (symbolic links are not allowed): ${folder}`,
  );
}

async function entry(path: string) {
  try {
    return await lstat(path);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

async function recordedRoots(
  dataRoot: Pick<DataRoot, "readCourse" | "readTranscripts"> | undefined,
  courseId: string,
): Promise<string[]> {
  const course = await dataRoot?.readCourse(courseId);
  const roots = new Map<string, string>();
  if (dataRoot === undefined) return [];
  for (const unit of course?.curriculum?.units ?? []) {
    const requests = new Map<
      string,
      { packages: readonly PackageSpec[]; approved: boolean }
    >();
    for (const transcript of await dataRoot.readTranscripts(
      courseId,
      unit.id,
    )) {
      for (const event of transcript.events) {
        if (event.type === "packages_requested") {
          if (requests.has(event.requestId)) continue; // Restored waiting card.
          const parsed = PackagesInput.safeParse({ packages: event.packages });
          if (parsed.success) {
            requests.set(event.requestId, {
              packages: parsed.data.packages,
              approved: false,
            });
          }
        } else if (event.type === "packages_installing") {
          const request = requests.get(event.requestId);
          if (request !== undefined) request.approved = true;
        } else if (
          event.type === "packages_answered" &&
          event.outcome !== "withdrawn"
        ) {
          const request = requests.get(event.requestId);
          requests.delete(event.requestId);
          if (request?.approved && event.outcome === "installed") {
            for (const pkg of request.packages) {
              const name = pkg.name.toLowerCase().replace(/[-_.]+/g, "-");
              roots.set(name, requirement(pkg));
            }
          }
        }
      }
    }
  }
  return [...roots.values()];
}

function projectManifest(dependencies: readonly string[]): string {
  return `[project]
name = "gauss-course-packages"
version = "0.0.0"
dependencies = [${dependencies.map((dependency) => JSON.stringify(dependency)).join(", ")}]

[tool.uv]
package = false

[tool.uv.workspace]
members = []
`;
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
