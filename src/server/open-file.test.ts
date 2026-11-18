// The system opener (task 3.22), run on small scripts in place of xdg-open,
// so no test opens anything on the learner's desktop.

import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { systemOpener } from "./open-file.ts";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "gauss-open-test-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** An executable shell script in the test's folder, by its path. */
async function script(name: string, body: string): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, `#!/bin/sh\n${body}\n`);
  await chmod(path, 0o755);
  return path;
}

const DESKTOP = { PATH: process.env.PATH ?? "", WAYLAND_DISPLAY: "wayland-1" };
const NO_DESKTOP = { PATH: process.env.PATH ?? "" };

test("the opener gets the file's path as one word, and its exit 0 is success", async () => {
  const opener = await script("opener", `printf '%s' "$1" > "${dir}/given"`);
  const open = systemOpener({
    platform: "linux",
    env: DESKTOP,
    command: [opener],
  });
  const file = join(dir, "my files", "maps.py");

  expect(await open(file)).toEqual({ ok: true });
  expect(await readFile(join(dir, "given"), "utf8")).toBe(file);
});

test("a failed opener is reported with its last line of errors and its status; without a display on Linux, the report says so", async () => {
  const opener = await script(
    "opener",
    `echo "looking" >&2\necho "xdg-open: no method available for opening '$1'" >&2\nexit 3`,
  );
  const failed = (env: Record<string, string>, platform: NodeJS.Platform) =>
    systemOpener({ platform, env, command: [opener] })("/w/maps.py");

  const headless = await failed(NO_DESKTOP, "linux");
  const desktop = await failed(DESKTOP, "linux");
  const mac = await failed(NO_DESKTOP, "darwin");

  for (const result of [headless, desktop, mac]) {
    expect(result).toMatchObject({ ok: false });
    if (result.ok) continue;
    expect(result.error).toContain(
      "xdg-open: no method available for opening '/w/maps.py'",
    );
    expect(result.error).toContain("exited with status 3");
    expect(result.error).not.toContain("looking");
  }
  expect(headless.ok ? "" : headless.error).toContain(
    "neither WAYLAND_DISPLAY nor DISPLAY",
  );
  expect(desktop.ok ? "" : desktop.error).not.toContain("DISPLAY");
  expect(mac.ok ? "" : mac.error).not.toContain("DISPLAY");
});

test("an opener that is not there is reported", async () => {
  const missing = join(dir, "xdg-open");
  const result = await systemOpener({
    platform: "linux",
    env: DESKTOP,
    command: [missing],
  })("/w/maps.py");

  expect(result).toEqual({
    ok: false,
    error: `${missing} was not found, so the file could not be opened.`,
  });
});

test("an opener still running after the wait counts as started, and is left running in a process group of its own", async () => {
  const opener = await script(
    "opener",
    `echo $$ > "${dir}/pid"\nexec sleep 30`,
  );
  const open = systemOpener({
    platform: "linux",
    env: DESKTOP,
    command: [opener],
    waitMs: 300,
  });

  expect(await open("/w/maps.py")).toEqual({ ok: true });
  const pid = Number(await readFile(join(dir, "pid"), "utf8"));
  try {
    // A group of its own: Ctrl-C on the server's terminal does not reach it.
    expect(() => process.kill(-pid, 0)).not.toThrow();
  } finally {
    process.kill(-pid, "SIGKILL");
  }
});

test("on a platform other than Linux and macOS nothing is run", async () => {
  const opener = await script("opener", `touch "${dir}/ran"`);
  const result = await systemOpener({
    platform: "win32",
    env: DESKTOP,
    command: [opener],
  })("/w/maps.py");

  expect(result).toEqual({
    ok: false,
    error: "Gauss can open files only on Linux and macOS.",
  });
  await expect(readFile(join(dir, "ran"))).rejects.toThrow();
});
