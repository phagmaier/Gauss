// The commands here run in the real sandbox, so these tests need what it
// needs (on Linux `bwrap`, `socat` and `rg`) and fail where it cannot run.

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import type { WorkspaceTools } from "../backends/backend.ts";
import { type Sandbox, startSandbox } from "../engine/sandbox.ts";
import type { TeachingTool, ToolResult } from "./tool.ts";
import { workspaceTmpDir, workspaceTools } from "./workspace.ts";

let sandbox: Extract<Sandbox, { available: true }>;
let dataRoot: string;
let course: string;
let workspace: string;
let outside: string;

beforeAll(async () => {
  dataRoot = await realpath(await mkdtemp(join(tmpdir(), "gauss-tools-")));
  const started = await startSandbox({ log: () => {}, dataRoot });
  if (!started.available) {
    throw new Error(`These tests need the sandbox: ${started.reason}`);
  }
  sandbox = started;
});
afterAll(async () => {
  await sandbox?.close();
  await rm(dataRoot, { recursive: true, force: true });
});

beforeEach(async () => {
  course = await mkdtemp(join(dataRoot, "course-"));
  workspace = join(course, "workspace");
  outside = join(course, "state.json");
  await mkdir(workspace);
  await writeFile(outside, "the record\n");
});
afterEach(async () => {
  await rm(workspaceTmpDir(workspace), { recursive: true, force: true });
  await rm(course, { recursive: true, force: true });
});

/** The tools over a desk that grants or refuses, counting each reservation. */
function setUp(
  given: {
    refused?: string;
    run?: WorkspaceTools["run"];
    /** Holds each reservation back until this settles. */
    queue?: Promise<void>;
  } = {},
) {
  const desk = { acquired: 0, released: 0 };
  const run = vi.fn(given.run ?? sandbox.run);
  const tools = workspaceTools(workspace, {
    async acquire() {
      if (given.refused !== undefined) return { refused: given.refused };
      await given.queue;
      desk.acquired += 1;
      return {
        release: () => {
          desk.released += 1;
        },
      };
    },
    run,
  });
  function call(name: string, input: unknown, signal?: AbortSignal) {
    const tool = tools.find((t: TeachingTool) => t.name === name);
    if (tool === undefined) throw new Error(`No tool ${name}`);
    return tool.run(input, signal);
  }
  return { desk, run, call };
}

const done = (text: string, fileWritten?: string): ToolResult => ({
  status: "done",
  text,
  ...(fileWritten === undefined ? {} : { fileWritten }),
});
const refused = (text: string): ToolResult => ({ status: "refused", text });

describe("a change", () => {
  test("is refused with the engine's reason, and nothing is written or run", async () => {
    await writeFile(join(workspace, "starter.py"), "x = 1\n");
    const { desk, run, call } = setUp({ refused: "Question 2 is open." });

    for (const [name, input] of [
      ["write_file", { path: "new.py", content: "y = 2\n" }],
      ["edit_file", { path: "starter.py", old_text: "1", new_text: "3" }],
      ["run_command", { command: "touch made.txt" }],
    ] as const) {
      expect(await call(name, input)).toEqual(refused("Question 2 is open."));
    }
    expect(run).not.toHaveBeenCalled();
    expect(existsSync(join(workspace, "new.py"))).toBe(false);
    expect(existsSync(join(workspace, "made.txt"))).toBe(false);
    expect(await readFile(join(workspace, "starter.py"), "utf8")).toBe(
      "x = 1\n",
    );
    expect(desk).toEqual({ acquired: 0, released: 0 });
  });

  test("a write and an edit hold one reservation each and name the file written", async () => {
    const { desk, call } = setUp();

    expect(
      await call("write_file", {
        path: "lesson/starter.py",
        content: "def times(x):\n    return 0\n",
      }),
    ).toEqual(done("Wrote lesson/starter.py.", "lesson/starter.py"));
    expect(desk).toEqual({ acquired: 1, released: 1 });
    expect(
      await call("edit_file", {
        path: join(workspace, "lesson", "starter.py"),
        old_text: "return 0",
        new_text: "raise NotImplementedError",
      }),
    ).toEqual(done("Edited lesson/starter.py.", "lesson/starter.py"));
    expect(desk).toEqual({ acquired: 2, released: 2 });
    expect(
      await readFile(join(workspace, "lesson", "starter.py"), "utf8"),
    ).toBe("def times(x):\n    raise NotImplementedError\n");
  });

  test("an edit that cannot be made is refused, leaves the file, and releases its reservation", async () => {
    await writeFile(join(workspace, "a.py"), "x = 1\nx = 1\n");
    const { desk, call } = setUp();

    expect(
      await call("edit_file", {
        path: "a.py",
        old_text: "x = 2",
        new_text: "",
      }),
    ).toEqual(
      refused(
        "a.py does not hold the text to replace. Read it again and copy the text exactly.",
      ),
    );
    expect(
      await call("edit_file", {
        path: "a.py",
        old_text: "x = 1",
        new_text: "y",
      }),
    ).toEqual(
      refused(
        "The text to replace appears 2 times in a.py. Give more of the text around it, or replace every occurrence.",
      ),
    );
    expect(await readFile(join(workspace, "a.py"), "utf8")).toBe(
      "x = 1\nx = 1\n",
    );
    expect(
      await call("edit_file", {
        path: "a.py",
        old_text: "x = 1",
        new_text: "y = $&",
        replace_all: true,
      }),
    ).toEqual(done("Edited a.py.", "a.py"));
    expect(await readFile(join(workspace, "a.py"), "utf8")).toBe(
      "y = $&\ny = $&\n",
    );
    // Replacement text is taken as written, never as a pattern.
    expect(
      await call("edit_file", {
        path: "a.py",
        old_text: "y = $&\ny",
        new_text: "$` $' $&",
      }),
    ).toEqual(done("Edited a.py.", "a.py"));
    expect(await readFile(join(workspace, "a.py"), "utf8")).toBe(
      "$` $' $& = $&\n",
    );
    expect(desk).toEqual({ acquired: 4, released: 4 });
  });

  test("a command that fails to run releases its reservation", async () => {
    const { desk, call } = setUp({
      run: () => Promise.reject(new Error("Sandbox could not launch")),
    });

    expect(await call("run_command", { command: "true" })).toEqual(
      refused("The tool failed: Sandbox could not launch"),
    );
    expect(desk).toEqual({ acquired: 1, released: 1 });
  });

  test("a Stop while the reservation waits changes nothing and releases it; a Stop during a command ends it and releases its reservation", async () => {
    const queue = Promise.withResolvers<void>();
    const first = setUp({ queue: queue.promise });
    const stopped = new AbortController();
    const waiting = first.call(
      "write_file",
      { path: "a.py", content: "" },
      stopped.signal,
    );
    stopped.abort();
    queue.resolve();
    expect(await waiting).toEqual(refused("The learner stopped this turn."));
    expect(first.desk).toEqual({ acquired: 1, released: 1 });
    expect(existsSync(join(workspace, "a.py"))).toBe(false);

    const started = Promise.withResolvers<void>();
    const { desk, call } = setUp({
      run: (command) => {
        started.resolve();
        return sandbox.run(command);
      },
    });
    const stop = new AbortController();
    const began = Date.now();
    const result = call(
      "run_command",
      { command: "sleep 30; touch late.txt" },
      stop.signal,
    );
    await started.promise;
    stop.abort();
    expect((await result).status).toBe("refused");
    expect(Date.now() - began).toBeLessThan(10_000);
    expect(desk).toEqual({ acquired: 1, released: 1 });
    expect(existsSync(join(workspace, "late.txt"))).toBe(false);
  });
});

describe("a path", () => {
  test("outside the workspace, or reached through a link out of it, is refused, and nothing outside is read or written", async () => {
    await mkdir(join(course, "elsewhere"));
    await symlink(outside, join(workspace, "record.json"));
    await symlink(join(course, "elsewhere"), join(workspace, "out"));
    await symlink(join(course, "missing.json"), join(workspace, "dangling"));
    const { desk, call } = setUp();
    const refusal = (path: string) =>
      refused(
        `${path} is outside the course's workspace, ${workspace}. Only files in it can be used.`,
      );

    for (const path of ["../state.json", outside, "record.json"]) {
      expect(await call("read_file", { path })).toEqual(refusal(path));
      expect(await call("write_file", { path, content: "lost\n" })).toEqual(
        refusal(path),
      );
      expect(
        await call("edit_file", {
          path,
          old_text: "the record",
          new_text: "lost",
        }),
      ).toEqual(refusal(path));
    }
    expect(
      await call("write_file", { path: "out/new.py", content: "lost\n" }),
    ).toEqual(refusal("out/new.py"));
    expect(await call("list_files", { path: "out" })).toEqual(refusal("out"));
    expect(
      await call("search_files", { text: "record", path: "record.json" }),
    ).toEqual(refusal("record.json"));
    expect(
      await call("write_file", { path: "dangling", content: "lost\n" }),
    ).toEqual(
      refused(
        "dangling is a link that leads nowhere in the workspace. Use a file in it.",
      ),
    );

    expect(await readFile(outside, "utf8")).toBe("the record\n");
    expect(existsSync(join(course, "missing.json"))).toBe(false);
    expect(existsSync(join(course, "elsewhere", "new.py"))).toBe(false);
    // Each change was reserved, refused, then released.
    expect(desk.acquired).toBe(desk.released);
  });

  test("what the learner's git, editor or shell runs or reads as settings is changed by no tool, and a command finds no placeholder for what is missing", async () => {
    await promisify(execFile)("git", ["init", "-q", workspace]);
    const config = await readFile(join(workspace, ".git", "config"), "utf8");
    await mkdir(join(workspace, ".vscode"));
    await mkdir(join(workspace, "lesson"));
    await symlink(join(workspace, ".git", "hooks"), join(workspace, "hooks"));
    const { desk, call } = setUp();
    const kept = (path: string) =>
      refused(
        `${path} is where the learner's git, editor or shell finds settings or what it runs; no tool may change it.`,
      );

    for (const [path, shown] of [
      [".git/hooks/pre-commit", ".git/hooks/pre-commit"],
      ["hooks/post-checkout", ".git/hooks/post-checkout"],
      [".vscode/settings.json", ".vscode/settings.json"],
      ["lesson/.git/config", "lesson/.git/config"],
      [".bashrc", ".bashrc"],
    ] as const) {
      expect(await call("write_file", { path, content: "x\n" })).toEqual(
        kept(shown),
      );
    }
    expect(
      await call("edit_file", {
        path: ".git/config",
        old_text: "[core]",
        new_text: "[core]\n\tfsmonitor = touch /tmp/x",
      }),
    ).toEqual(kept(".git/config"));
    const ran = await call("run_command", {
      command: [
        'echo x >> .git/config || echo "config: refused"',
        'echo x > .git/hooks/pre-commit || echo "hook: refused"',
        'echo x > .vscode/settings.json || echo "editor: refused"',
        "echo ---",
        "ls -A",
      ].join("\n"),
    });
    const [said = "", listed = ""] = ran.text.split("---\n");
    expect(
      said.split("\n").filter((line) => line.endsWith(": refused")),
    ).toEqual(["config: refused", "hook: refused", "editor: refused"]);
    expect(listed).toBe(".git\n.vscode\nhooks\nlesson\n\nExit status 0.");

    expect(await readFile(join(workspace, ".git", "config"), "utf8")).toBe(
      config,
    );
    for (const path of [
      ".git/hooks/pre-commit",
      ".git/hooks/post-checkout",
      ".vscode/settings.json",
      "lesson/.git",
      ".bashrc",
    ]) {
      expect(existsSync(join(workspace, path))).toBe(false);
    }
    expect(desk).toEqual({ acquired: 7, released: 7 });
  });

  test("a listing and a search stay in the workspace: links are listed, not followed, and installed packages are not entered", async () => {
    await mkdir(join(workspace, "lesson"));
    await mkdir(join(workspace, ".venv", "lib"), { recursive: true });
    await writeFile(join(workspace, "lesson", "a.py"), "def times(x):\n");
    await writeFile(join(workspace, "b.txt"), "Times table\n");
    await writeFile(join(workspace, ".venv", "lib", "c.py"), "def times():\n");
    await symlink(course, join(workspace, "up"));
    await writeFile(join(course, "notes.md"), "times\n");
    const { desk, call } = setUp();

    expect(await call("list_files", {})).toEqual(
      done(".venv/\nb.txt\nlesson/\nlesson/a.py\nup"),
    );
    expect(await call("list_files", { pattern: "**/*.py" })).toEqual(
      done("lesson/a.py"),
    );
    expect(
      await call("search_files", { text: "times", ignore_case: true }),
    ).toEqual(done("b.txt:1: Times table\nlesson/a.py:1: def times(x):"));
    expect(
      await call("search_files", { text: "times", path: "lesson" }),
    ).toEqual(done("lesson/a.py:1: def times(x):"));
    expect(desk).toEqual({ acquired: 0, released: 0 });
  });

  test("a pipe is refused at once, not waited on, and its reservation released", async () => {
    await promisify(execFile)("mkfifo", [join(workspace, "pipe")]);
    const { desk, call } = setUp();
    const notAFile = refused("pipe is not a file.");

    expect(await call("read_file", { path: "pipe" })).toEqual(notAFile);
    expect(await call("write_file", { path: "pipe", content: "x" })).toEqual(
      notAFile,
    );
    expect(
      await call("edit_file", { path: "pipe", old_text: "x", new_text: "y" }),
    ).toEqual(notAFile);
    expect(await call("search_files", { text: "x" })).toEqual(
      done("No line in . holds it."),
    );
    expect(desk).toEqual({ acquired: 2, released: 2 });
  });

  test("a read gives the lines asked for and says where to read on", async () => {
    const lines = Array.from({ length: 2500 }, (_, i) => `line ${i + 1}`);
    await writeFile(join(workspace, "long.txt"), `${lines.join("\n")}\n`);
    const { call } = setUp();

    const first = await call("read_file", { path: "long.txt" });
    expect(first.text.split("\n").slice(-3)).toEqual([
      "line 2000",
      "",
      "(Lines 1 to 2000 of 2500 of long.txt. Read on from line 2001.)",
    ]);
    expect(await call("read_file", { path: "long.txt", offset: 2499 })).toEqual(
      done("line 2499\nline 2500"),
    );
    expect(await call("read_file", { path: "long.txt", offset: 3000 })).toEqual(
      refused("long.txt has 2500 lines; line 3000 is past its end."),
    );
    await writeFile(
      join(workspace, "wide.txt"),
      `${"x".repeat(300_000)}\nend\n`,
    );
    const wide = await call("read_file", { path: "wide.txt" });
    expect(wide.text.startsWith("x".repeat(256 * 1024))).toBe(true);
    expect(wide.text.slice(256 * 1024)).toBe(
      "\n\n(Line 1 of wide.txt is longer than 256 KB; this is its start. Search the file, or run a command, for the rest.)",
    );
  });
});

describe("a command, in the real sandbox", () => {
  let server: Server;
  let port: number;
  let requests: number;

  beforeEach(async () => {
    requests = 0;
    server = createServer((_request, response) => {
      requests += 1;
      response.end("reached\n");
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error();
    port = address.port;
  });
  afterEach(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  test("runs in the workspace, writes only there and in its temporary folder, cannot read the record or reach the network, and reports its output and status", async () => {
    const elsewhere = await mkdtemp(join(tmpdir(), "gauss-elsewhere-"));
    const { desk, call } = setUp();
    const script = [
      'echo work > made.txt && echo "made: $?"',
      'echo scratch > "$TMPDIR/scratch.txt" && echo "scratch: $?"',
      // Read-only, or, in the data root, the sandbox's own empty copy.
      `{ echo lost > ${join(elsewhere, "lost.txt")}; } 2>/dev/null || echo "elsewhere: refused"`,
      `{ echo lost > ${join(course, "lost.txt")}; } 2>/dev/null`,
      `cat ${outside} 2>/dev/null || echo "record: unread"`,
      'cat ../state.json 2>/dev/null || echo "record by ..: unread"',
      `(exec 3<>/dev/tcp/127.0.0.1/${port}) 2>/dev/null || echo "network: refused"`,
      "exit 3",
    ].join("\n");

    try {
      expect(await call("run_command", { command: script })).toEqual(
        done(
          [
            "made: 0\nscratch: 0\nelsewhere: refused\nrecord: unread\nrecord by ..: unread\nnetwork: refused",
            "Exit status 3.",
          ].join("\n\n"),
        ),
      );
      expect(existsSync(join(elsewhere, "lost.txt"))).toBe(false);
    } finally {
      await rm(elsewhere, { recursive: true, force: true });
    }
    expect(await readFile(join(workspace, "made.txt"), "utf8")).toBe("work\n");
    expect(existsSync(join(course, "lost.txt"))).toBe(false);
    expect(requests).toBe(0);
    // The temporary folder is the course's, kept between commands.
    expect(
      await call("run_command", { command: 'cat "$TMPDIR/scratch.txt"' }),
    ).toEqual(done("scratch\n\nExit status 0."));
    expect(desk).toEqual({ acquired: 2, released: 2 });
  });
});
