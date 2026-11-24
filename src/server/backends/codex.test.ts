import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { codexOptions, codexUnavailable } from "./codex.ts";

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

  expect(
    codexOptions({
      model: "gpt-6.2-sol",
      effort: "high",
      serviceTier: "priority",
    }),
  ).toEqual(PINNED);
  expect(codexOptions()).toEqual(PINNED);
});

test("outside a live check the caller's model and effort stand", () => {
  vi.stubEnv("GAUSS_LIVE_CHECK", "");

  expect(codexOptions({ model: "gpt-6.2-sol", effort: "high" })).toEqual({
    model: "gpt-6.2-sol",
    effort: "high",
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
    says: /^Gauss's Codex home, .*\/home, is not signed in\. Sign in once, from Gauss's folder: `mkdir -p -m 700 .*\/home`, then `CODEX_HOME=.*\/home mise exec -- codex login`\.$/,
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
    says: /^Codex did not say whether it is signed in: codex app-server ended \(exit 1\) before answering: Error: the state database is locked$/,
  },
])("Codex is refused with the reason for $case", async (given) => {
  expect(
    await codexUnavailable({
      command: await fakeCodex(given.version, given.appServer),
      home: await home(given.signedIn),
      version: "0.171.0",
    }),
  ).toMatch(given.says);
});

test("Codex is refused with the reason when its home does not exist, or the CLI is not installed", async () => {
  expect(
    await codexUnavailable({
      command: await fakeCodex("codex-cli 0.171.0"),
      home: join(dir, "never-made"),
      version: "0.171.0",
    }),
  ).toMatch(/^Gauss's Codex home, .*\/never-made, is not signed in\./);
  expect(
    await codexUnavailable({
      command: join(dir, "not-installed"),
      home: await home(true),
      version: "0.171.0",
    }),
  ).toMatch(
    /^Codex could not be run \(.*ENOENT.*\)\. Gauss needs the Codex CLI 0\.171\.0, which `mise install` in Gauss's folder installs\.$/,
  );
});
