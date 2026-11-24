import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  CODEX_LIVE_CHECK_OPTIONS,
  codexAppConfig,
  codexEnvironment,
  codexOptions,
  codexUnavailable,
  pinnedCodexVersion,
  writeCodexCatalog,
} from "./codex.ts";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "gauss-codex-"));
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});

const PINNED = {
  model: "gpt-6.1-terra",
  effort: "medium",
  serviceTier: "default",
};

test("a live check runs Codex on gpt-6.1-terra at medium on the standard tier, whatever the caller asks for", () => {
  vi.stubEnv("GAUSS_LIVE_CHECK", "1");
  vi.stubEnv("GAUSS_CODEX_MODEL", "not-the-live-model");

  expect(
    codexOptions({
      model: "gpt-6.2-sol",
      effort: "high",
      serviceTier: "priority",
    }),
  ).toEqual(PINNED);
  expect(codexOptions()).toEqual(PINNED);
});

test("normal Codex sessions default to terra or the model override, but stay on medium and the standard tier", () => {
  vi.stubEnv("GAUSS_LIVE_CHECK", undefined);
  vi.stubEnv("GAUSS_CODEX_MODEL", undefined);
  expect(codexOptions()).toEqual(PINNED);
  const requested = {
    model: "caller-model",
    effort: "high",
    serviceTier: "priority",
  };
  expect(codexOptions(requested)).toEqual({ ...PINNED, model: "caller-model" });
  vi.stubEnv("GAUSS_CODEX_MODEL", "configured-model");
  expect(codexOptions(requested)).toEqual({
    ...PINNED,
    model: "configured-model",
  });
});

/**
 * A stand-in for the `codex` CLI: `--version` prints `version`, and
 * `app-server` answers `initialize` and `account/read` over stdio, signed in
 * when its home holds a `signed-in` file and no API key reached it.
 */
async function fakeCodex(
  version: string,
  appServer: "answers" | "dies" = "answers",
): Promise<string> {
  const path = join(dir, "codex");
  await writeFile(
    path,
    `#!/usr/bin/env node
import { existsSync } from "node:fs";
import { createInterface } from "node:readline";
if (process.argv[2] === "--version") {
  console.log(${JSON.stringify(version)});
  process.exit(0);
}
if (${JSON.stringify(appServer)} === "dies") {
  console.error("Error: the state database is locked");
  process.exit(1);
}
const signedIn =
  existsSync(process.env.CODEX_HOME + "/signed-in") &&
  process.env.OPENAI_API_KEY === undefined;
const reply = (id, result) =>
  process.stdout.write(JSON.stringify({ id, result }) + "\\n");
createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") reply(message.id, { userAgent: "fake" });
  if (message.method === "account/read") {
    reply(message.id, {
      account: signedIn ? { type: "chatgpt", planType: "plus" } : null,
      requiresOpenaiAuth: true,
    });
  }
});
`,
  );
  await chmod(path, 0o755);
  return path;
}

async function home(signedIn: boolean): Promise<string> {
  const path = join(dir, "home");
  await mkdir(path);
  if (signedIn) await writeFile(join(path, "signed-in"), "");
  return path;
}

test("Codex can run when the CLI is the pinned version and its home is signed in, whatever OPENAI_ and CODEX_ variables the server has", async () => {
  vi.stubEnv("OPENAI_API_KEY", "sk-not-the-plan");
  vi.stubEnv("CODEX_HOME", join(dir, "elsewhere"));

  expect(
    await codexUnavailable({
      command: await fakeCodex("codex-cli 0.171.0"),
      home: await home(true),
      version: "0.171.0",
    }),
  ).toBeUndefined();
});

test.each([
  {
    case: "a home signed out",
    version: "codex-cli 0.171.0",
    signedIn: false,
    says: /^Gauss's Codex home, .*\/home, is not signed in\./,
  },
  {
    case: "a CLI of another version",
    version: "codex-cli 0.170.2",
    signedIn: true,
    says: /^Gauss needs the Codex CLI 0\.171\.0, but `codex --version` says "codex-cli 0\.170\.2"\./,
  },
  {
    case: "an app-server that ends before answering",
    version: "codex-cli 0.171.0",
    signedIn: true,
    appServer: "dies" as const,
    says: /^Codex did not say whether it is signed in: codex app-server ended \(exit 1\): Error: the state database is locked/,
  },
])("Codex is refused with the reason for $case", async (given) => {
  const folder = await home(given.signedIn);
  const reason = await codexUnavailable({
    command: await fakeCodex(given.version, given.appServer),
    home: folder,
    version: "0.171.0",
  });
  expect(reason).toMatch(given.says);
  expectSignInCommands(reason, folder);
});

test("Codex says when its home does not exist or the CLI is missing, with the sign-in commands in either case", async () => {
  const missingHome = join(dir, "never-made");
  const noHome = await codexUnavailable({
    command: await fakeCodex("codex-cli 0.171.0"),
    home: missingHome,
    version: "0.171.0",
  });
  expect(noHome).toMatch(
    /^Gauss's Codex home, .*\/never-made, does not exist\./,
  );
  expectSignInCommands(noHome, missingHome);

  const folder = await home(true);
  const noCli = await codexUnavailable({
    command: join(dir, "not-installed"),
    home: folder,
    version: "0.171.0",
  });
  expect(noCli).toMatch(
    /^Codex could not be run \(.*ENOENT.*\)\. Gauss needs the Codex CLI 0\.171\.0, which `mise install` in Gauss's folder installs\./,
  );
  expectSignInCommands(noCli, folder);
});

test("an existing file where Codex needs a folder is not reported as a missing home", async () => {
  const file = join(dir, "not-a-folder");
  await writeFile(file, "");
  const reason = await codexUnavailable({
    command: await fakeCodex("codex-cli 0.171.0"),
    home: file,
    version: "0.171.0",
  });
  expect(reason).toMatch(
    /is not a folder\. Move the existing file aside first\./,
  );
  expectSignInCommands(reason, file);
});

function expectSignInCommands(reason: string | undefined, folder: string) {
  expect(reason).toContain(`\`mkdir -p -m 700 ${folder}\``);
  expect(reason).toContain(`\`CODEX_HOME=${folder} mise exec -- codex login\``);
}

// The pinned CLI itself, which mise puts on the PATH: `prompt-input` prints
// the model's input and calls no model, in a scratch home signed out.
test("the pinned Codex CLI, as Gauss configures it, gives the model none of its shell or patch tools", async () => {
  const run = promisify(execFile);
  const { stdout: version } = await run("codex", ["--version"]);
  expect(version.trim().split(/\s+/).at(-1)).toBe(await pinnedCodexVersion());
  const scratchHome = join(dir, "codex-home");
  const work = join(dir, "work");
  await mkdir(scratchHome, { mode: 0o700 });
  await mkdir(work);
  const catalog = await writeCodexCatalog("codex", scratchHome);

  const { stdout } = await run(
    "codex",
    [
      "debug",
      "prompt-input",
      ...codexAppConfig(catalog),
      "-c",
      `model=${JSON.stringify(CODEX_LIVE_CHECK_OPTIONS.model)}`,
    ],
    { cwd: work, env: codexEnvironment(scratchHome), maxBuffer: 16 << 20 },
  );
  type Tool = { name: string; description?: string; tools?: Tool[] };
  const input: { type: string; tools?: Tool[] }[] = JSON.parse(stdout);
  const direct = input
    .flatMap((item) => item.tools ?? [])
    .flatMap((namespace) => namespace.tools ?? [namespace]);
  // In code mode the rest are nested in `exec`, each under a heading.
  const exec = direct.find((tool) => tool.name === "exec");
  const nested = [...(exec?.description ?? "").matchAll(/^### `(\w+)`$/gm)].map(
    ([, name]) => name,
  );
  expect(direct.map((tool) => tool.name)).toEqual(["exec", "wait"]);
  expect(nested).toContain("list_mcp_resources");
  for (const name of ["exec_command", "write_stdin", "apply_patch"]) {
    expect(nested).not.toContain(name);
  }
});
