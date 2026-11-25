import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const script = fileURLToPath(
  new URL("../../scripts/dev-fake.ts", import.meta.url),
);

function start(root: string, port = 0, args = ["--empty"]) {
  const child = spawn(process.execPath, [script, ...args], {
    env: {
      ...process.env,
      GAUSS_BACKUP: "off",
      GAUSS_DATA_ROOT: root,
      GAUSS_PORT: String(port),
    },
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const listening = Promise.withResolvers<{ port: number }>();
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
    stdout += chunk;
    const match = /Gauss is running at http:\/\/localhost:(\d+)\//.exec(stdout);
    if (match) listening.resolve({ port: Number(match[1]) });
  });
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
    stderr += chunk;
  });
  const exited = once(child, "close").then(([code, signal]) => ({
    code,
    signal,
    stdout,
    stderr,
  }));
  return {
    child,
    exited,
    startup: () => Promise.race([listening.promise, exited]),
  };
}

async function listening(server: ReturnType<typeof start>): Promise<number> {
  const result = await server.startup();
  if (!("port" in result)) {
    throw new Error(
      `Fake server exited before listening (${result.code ?? result.signal}):\n${result.stdout}${result.stderr}`,
    );
  }
  return result.port;
}

test("fake servers keep a data root exclusive until their process exits", async ({
  onTestFinished,
  signal,
}) => {
  const dir = await mkdtemp(join(tmpdir(), "gauss-serve-lock-"));
  const servers: ReturnType<typeof start>[] = [];
  onTestFinished(async () => {
    // A hard stop can leave the sandbox's bridge running in the group.
    for (const { child } of servers) {
      if (child.pid === undefined) continue;
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch (error) {
        if (
          !(error instanceof Error && "code" in error && error.code === "ESRCH")
        ) {
          throw error;
        }
      }
    }
    await Promise.allSettled(servers.map(({ exited }) => exited));
    await rm(dir, { recursive: true, force: true });
  });

  function launch(...args: Parameters<typeof start>) {
    signal.throwIfAborted();
    const server = start(...args);
    servers.push(server);
    return server;
  }

  const root = join(dir, "active");
  await mkdir(root);
  const alias = join(dir, "alias");
  await symlink(root, alias, "dir");
  const active = launch(alias);
  const port = await listening(active);
  const uploads = join(root, "uploads");
  const upload = join(uploads, "staged-source.md");
  const temporary = join(
    root,
    ".profile.md.12345678-1234-1234-1234-123456789abc.tmp",
  );
  await mkdir(uploads);
  await writeFile(upload, "staged source");
  await writeFile(temporary, "write in progress");

  // The owner is unseeded; this contender would seed it before recovery.
  const refused = launch(root, port === 4330 ? 4331 : 4330, []);
  expect(await refused.startup()).toMatchObject({
    code: 1,
    stderr: expect.stringContaining(
      `Data root "${root}" is already in use by another Gauss server`,
    ),
  });
  expect(await readFile(upload, "utf8")).toBe("staged source");
  expect(await readFile(temporary, "utf8")).toBe("write in progress");
  const url = `http://127.0.0.1:${port}`;
  const library = await fetch(`${url}/api/courses`, { signal });
  expect(await library.json()).toEqual({ courses: [] });

  const otherRoot = join(dir, "independent");
  const independent = launch(otherRoot);
  expect(await listening(independent)).not.toBe(port);

  // Retargeting the startup alias must not move the active server's record
  // onto the independent server's root.
  await writeFile(join(root, "profile.md"), "Profile in the locked root");
  await rm(alias);
  await symlink(otherRoot, alias, "dir");
  const profile = await fetch(`${url}/api/profile`, { signal });
  expect(await profile.json()).toMatchObject({
    text: "Profile in the locked root",
  });

  active.child.kill("SIGTERM");
  expect(await active.exited).toMatchObject({ code: 0, signal: null });
  const restarted = launch(root);
  await listening(restarted);
  await expect(readFile(upload)).rejects.toMatchObject({ code: "ENOENT" });
  await expect(readFile(temporary)).rejects.toMatchObject({ code: "ENOENT" });

  restarted.child.kill("SIGKILL");
  expect(await restarted.exited).toMatchObject({
    code: null,
    signal: "SIGKILL",
  });
  await listening(launch(root));
});
