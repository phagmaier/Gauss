// Real SDK file lookup only: no Claude process or model. A fresh Node process
// gives the SDK a scratch HOME before it imports or caches configuration paths.
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, expect, test } from "vitest";

const execute = promisify(execFile);
const KEPT = "46a23d60-3723-4703-b5ff-f62ad2721ea0";
const OVERRIDE_ONLY = "259edbb9-e538-48ec-ae15-8c7116b51951";
const UNKNOWN = "b3399ebc-78b2-48f9-ad22-13056b85b1a7";
const LOOKUP = `
  import { createClaudeBackend } from ${JSON.stringify(new URL("./claude.ts", import.meta.url).href)};
  const backend = createClaudeBackend();
  const found = [];
  for (const id of JSON.parse(process.argv[1])) {
    found.push(await backend.hasSession(id, process.argv[2]));
  }
  process.stdout.write(JSON.stringify({
    found,
    override: process.env.CLAUDE_CONFIG_DIR ?? null,
  }));
`;

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "gauss-claude-lookup-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function seedSession(root: string, cwd: string, id: string) {
  const project = join(root, "projects", cwd.replace(/[^a-zA-Z0-9]/g, "-"));
  await mkdir(project, { recursive: true });
  const messages = [
    {
      type: "user",
      uuid: "4074c5f3-d542-4a53-b2a6-bb45166d074f",
      parentUuid: null,
      sessionId: id,
      isSidechain: false,
      cwd,
      timestamp: "2026-11-16T12:00:00.000Z",
      message: { role: "user", content: "A synthetic kept tutor session." },
    },
    { type: "custom-title", sessionId: id, customTitle: "Synthetic tutor" },
  ];
  await writeFile(
    join(project, `${id}.jsonl`),
    `${messages.map((message) => JSON.stringify(message)).join("\n")}\n`,
  );
}

test.each(["default", "custom", "empty"] as const)(
  "session lookup uses the tutor's default root with a %s config environment",
  async (config) => {
    const cwd = join(dir, "course");
    const custom = join(dir, "other-claude");
    await mkdir(cwd);
    await seedSession(join(dir, ".claude"), cwd, KEPT);
    await seedSession(custom, cwd, OVERRIDE_ONLY);
    const override =
      config === "default" ? undefined : config === "custom" ? custom : "";

    const { stdout } = await execute(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        LOOKUP,
        "--",
        JSON.stringify([KEPT, OVERRIDE_ONLY, UNKNOWN, "--not-a-session"]),
        cwd,
      ],
      {
        cwd: dir,
        env: {
          PATH: process.env.PATH,
          HOME: dir,
          USERPROFILE: dir,
          XDG_CONFIG_HOME: join(dir, "config"),
          GAUSS_DATA_ROOT: join(dir, "data"),
          TMPDIR: dir,
          CLAUDE_CONFIG_DIR: override,
        },
        encoding: "utf8",
      },
    );

    expect(JSON.parse(stdout)).toEqual({
      override: override ?? null,
      found: [true, false, false, false],
    });
  },
);
