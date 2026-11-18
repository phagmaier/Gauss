import { existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import type { PageEvent } from "../../shared/events.ts";
import type { PackageSpec } from "../../shared/packages.ts";
import { type DataRoot, openDataRoot } from "../record/data-root.ts";
import { clearPackageInstall, createPackageInstaller } from "./packages.ts";
import type { SandboxCommand, SandboxResult } from "./sandbox.ts";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "gauss-package-install-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const PYTHON = "/opt/python/bin/python3";
const OK: SandboxResult = {
  exitCode: 0,
  timedOut: false,
  stdout: "",
  stderr: "",
  cut: false,
};

function installer(
  run: (command: SandboxCommand) => Promise<SandboxResult>,
  dataRoot?: Pick<DataRoot, "readCourse" | "readTranscripts">,
) {
  const options = {
    run,
    cacheFolder: join(dir, "cache", "uv"),
    python: PYTHON,
    ...(dataRoot === undefined ? {} : { dataRoot }),
  };
  const subject = createPackageInstaller(options);
  return {
    commands: subject.commands,
    install(workspace: string, packages: PackageSpec[]) {
      return subject.install(workspace, "loops", {
        request: { id: "approved", packages, requestedAt: "2026-11-17T10:00:00Z" },
        preview: { commands: subject.commands(workspace, packages), folder: workspace },
      });
    },
  };
}

function request(
  workspace: string,
  requestId: string,
  pkg: PackageSpec,
): PageEvent {
  return {
    type: "packages_requested",
    requestId,
    packages: [pkg],
    commands: [["uv", "add", `${pkg.name}${pkg.version ?? ""}`]],
    folder: workspace,
  };
}

async function writeCandidate(command: SandboxCommand) {
  const environment = resolve(
    command.cwd,
    command.env?.UV_PROJECT_ENVIRONMENT ?? ".venv",
  );
  await mkdir(environment, { recursive: true });
  await writeFile(join(environment, "candidate.txt"), "new environment\n");
}

test("the networked install uses only the new request and previously approved, successful roots", async () => {
  const root = openDataRoot({ path: dir });
  const { id } = await root.createCourse({ title: "Counting" });
  const proposal = {
    title: "Counting",
    units: [
      { id: "loops", title: "Loops", goal: "Count.", prerequisites: [] },
      { id: "sets", title: "Sets", goal: "Group.", prerequisites: [] },
    ],
    style: "Short.",
    background: "Some Python.",
  };
  await root.saveProposal(id, proposal);
  await root.approveCurriculum(id, proposal);
  const workspace = await root.workspaceFolder(id);
  const manifest =
    '[project]\nname = "counting"\nversion = "0.1.0"\ndependencies = ["httpx"]\n';
  const lock =
    'version = 1\n[[package]]\nname = "colorama"\nversion = "0.4.6"\n';
  await writeFile(join(workspace, "pyproject.toml"), manifest);
  await writeFile(join(workspace, "uv.lock"), lock);
  await root.appendTranscript(id, "loops", 1, [
    request(workspace, "retained", { name: "numpy", version: ">=1.26" }),
    { type: "packages_installing", requestId: "retained" },
    { type: "packages_answered", requestId: "retained", outcome: "installed" },
    request(workspace, "failed", { name: "pandas" }),
    { type: "packages_installing", requestId: "failed" },
    { type: "packages_answered", requestId: "failed", outcome: "failed" },
    request(workspace, "declined", { name: "rich" }),
    { type: "packages_answered", requestId: "declined", outcome: "declined" },
    request(workspace, "unfinished", { name: "urllib3" }),
    { type: "packages_installing", requestId: "unfinished" },
    request(workspace, "no-approval", { name: "packaging" }),
    {
      type: "packages_answered",
      requestId: "no-approval",
      outcome: "installed",
    },
  ]);
  await root.appendTranscript(id, "sets", 1, [
    request(workspace, "other-unit", { name: "sympy" }),
    { type: "packages_installing", requestId: "other-unit" },
    // The old server withdrew the card when its unit ended while uv ran.
    {
      type: "packages_answered",
      requestId: "other-unit",
      outcome: "withdrawn",
    },
    {
      type: "packages_answered",
      requestId: "other-unit",
      outcome: "installed",
    },
  ]);
  const network: { cwd: string; resolutionInputs: string }[] = [];
  const subject = installer(async (command) => {
    if (command.hosts?.length) {
      const cwd = await realpath(command.cwd);
      const projectFiles = await Promise.all(
        ["pyproject.toml", "uv.lock"].map((name) => {
          const path = join(cwd, name);
          return existsSync(path) ? readFile(path, "utf8") : "";
        }),
      );
      network.push({
        cwd,
        resolutionInputs: [
          ...command.argv,
          command.input,
          ...projectFiles,
        ].join("\n"),
      });
      await writeCandidate(command);
    }
    return OK;
  }, root);

  const result = await subject.install(workspace, [
    { name: "pytest", version: ">=8" },
  ]);

  expect(result.outcome).toBe("installed");
  expect(network).toHaveLength(1);
  expect(network[0]?.cwd).toBe(
    join(dirname(await realpath(workspace)), "packages"),
  );
  const inputs = network[0]?.resolutionInputs;
  for (const approved of ["pytest>=8", "numpy>=1.26", "sympy"]) {
    expect(inputs).toContain(approved);
  }
  for (const unapproved of [
    workspace,
    "httpx",
    "colorama",
    "pandas",
    "rich",
    "urllib3",
    "packaging",
  ]) {
    expect(inputs).not.toContain(unapproved);
  }
  expect(await readFile(join(workspace, "pyproject.toml"), "utf8")).toBe(
    manifest,
  );
  expect(await readFile(join(workspace, "uv.lock"), "utf8")).toBe(lock);
  expect(
    await readFile(join(workspace, ".venv", "candidate.txt"), "utf8"),
  ).toBe("new environment\n");
});

test("creating or removing a workspace manifest cannot change the commands on an approval card", async () => {
  const workspace = join(dir, "workspace");
  await mkdir(workspace);
  const ran: SandboxCommand[] = [];
  const subject = installer(async (command) => {
    ran.push(command);
    return OK;
  });
  const packages = [{ name: "pytest" }];
  const beforeCreation = subject.commands(workspace, packages);

  const manifest = join(workspace, "pyproject.toml");
  await writeFile(
    manifest,
    '[project]\nname = "counting"\nversion = "0.1.0"\n',
  );
  const beforeRemoval = subject.commands(workspace, packages);
  await rm(manifest);
  await subject.install(workspace, packages);

  expect(beforeRemoval).toEqual(beforeCreation);
  expect(subject.commands(workspace, packages)).toEqual(beforeRemoval);
  expect(ran.map((command) => command.argv)).toEqual(beforeCreation);
});

test("a failed command preserves the old environment even after writing a candidate", async () => {
  const workspace = join(dir, "workspace");
  const oldFile = join(workspace, ".venv", "bin", "python");
  await mkdir(join(workspace, ".venv", "bin"), { recursive: true });
  await writeFile(oldFile, "previous environment\n");
  const subject = installer(async (command) => {
    expect(await readdir(join(workspace, ".venv"))).toEqual([]);
    await writeCandidate(command);
    return { ...OK, exitCode: 1, stderr: "fixture resolution failed" };
  });

  const result = await subject.install(workspace, [{ name: "pytest" }]);

  expect(result.outcome).toBe("failed");
  expect(result.output).toContain("fixture resolution failed");
  expect(await readFile(oldFile, "utf8")).toBe("previous environment\n");
  expect(existsSync(join(workspace, ".venv", "candidate.txt"))).toBe(false);
});

test("an interrupted swap is undone before the next install starts", async () => {
  const workspace = join(dir, "workspace");
  const environment = join(workspace, ".venv");
  const park = join(dir, ".package-install.tmp", "running");
  const project = join(dir, "packages");
  const previousManifest =
    '[project]\nname = "gauss-course-packages"\nversion = "0.0.0"\ndependencies = ["numpy"]\n';
  await mkdir(join(park, "previous"), { recursive: true });
  await mkdir(environment, { recursive: true });
  await mkdir(project);
  await writeFile(join(park, "previous", "kept.txt"), "previous environment\n");
  await writeFile(join(park, "pyproject.toml"), previousManifest);
  await writeFile(join(environment, "partial.txt"), "interrupted candidate\n");
  await writeFile(join(project, "pyproject.toml"), "interrupted manifest\n");
  await writeFile(join(project, "uv.lock"), "interrupted lock\n");
  const subject = installer(async (command) => {
    expect(await readdir(environment)).toEqual([]);
    expect(await readFile(join(command.cwd, "pyproject.toml"), "utf8")).toBe(
      previousManifest,
    );
    expect(existsSync(join(command.cwd, "uv.lock"))).toBe(false);
    return { ...OK, exitCode: 1, stderr: "second install failed" };
  });

  const result = await subject.install(workspace, [{ name: "pytest" }]);

  expect(result.outcome).toBe("failed");
  expect(result.output).toContain("second install failed");
  expect(await readdir(environment)).toEqual(["kept.txt"]);
  expect(await readFile(join(environment, "kept.txt"), "utf8")).toBe(
    "previous environment\n",
  );
  await clearPackageInstall(workspace);
  expect(existsSync(dirname(park))).toBe(false);
});

test("a symlink in a workspace parent is refused before the environment is touched", async () => {
  const course = join(dir, "elsewhere");
  const environment = join(course, "workspace", ".venv");
  await mkdir(environment, { recursive: true });
  const oldFile = join(environment, "kept.txt");
  await writeFile(oldFile, "previous environment\n");
  const parent = join(dir, "course");
  await symlink(course, parent);
  const commands: SandboxCommand[] = [];
  const subject = installer((command) => {
    commands.push(command);
    return Promise.resolve(OK);
  });

  const result = await subject.install(join(parent, "workspace"), [
    { name: "pytest" },
  ]);

  expect(result.outcome).toBe("failed");
  expect(commands).toHaveLength(0);
  expect(await readFile(oldFile, "utf8")).toBe("previous environment\n");
});
