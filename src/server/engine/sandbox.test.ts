// These tests run real commands in the sandbox, so they need what it needs
// (on Linux `bwrap`, `socat` and `rg`) and fail, rather than skip, where it
// cannot run.

import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
import { type Sandbox, startSandbox } from "./sandbox.ts";

let sandbox: Extract<Sandbox, { available: true }>;
let dir: string;
let work: string;
let other: string;

beforeAll(async () => {
  const started = await startSandbox({ log: () => {} });
  if (!started.available) {
    throw new Error(`These tests need the sandbox: ${started.reason}`);
  }
  sandbox = started;
});
afterAll(async () => {
  await sandbox?.close();
});

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "gauss-sandbox-"));
  work = join(dir, "work");
  other = join(dir, "other");
  await mkdir(work);
  await mkdir(other);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});

/** Runs a shell script in the sandbox, in `work`, which it may write. */
function sh(
  script: string,
  options: { args?: string[]; input?: string; timeLimitMs?: number } = {},
) {
  return sandbox.run({
    argv: ["sh", "-c", script, "sh", ...(options.args ?? [])],
    cwd: work,
    writable: [work],
    timeLimitMs: options.timeLimitMs ?? 10_000,
    ...(options.input === undefined ? {} : { input: options.input }),
  });
}

describe("a command", () => {
  test("gets its input and gives back its output and exit status", async () => {
    const result = await sh("cat; printf 'to stderr' >&2; exit 3", {
      input: "from stdin",
    });

    expect(result).toEqual({
      exitCode: 3,
      timedOut: false,
      stdout: "from stdin",
      stderr: "to stderr",
      cut: false,
    });
  });

  test("receives its arguments as they are, read by no shell", async () => {
    const odd = `it's $HOME; \`true\` "quoted"`;
    const result = await sandbox.run({
      argv: ["printf", "%s|", odd, "two"],
      cwd: work,
      writable: [],
      timeLimitMs: 10_000,
    });

    expect(result.stdout).toBe(`${odd}|two|`);
  });
});

describe("writes", () => {
  test("go into the folders named and are refused everywhere else", async () => {
    const result = await sh(
      'echo in > "$1/a"; echo out > "$2/b"; echo out > "$3/c"',
      { args: [work, other, dir] },
    );

    expect(await readFile(join(work, "a"), "utf8")).toBe("in\n");
    expect(existsSync(join(other, "b"))).toBe(false);
    expect(existsSync(join(dir, "c"))).toBe(false);
    expect(result.stderr).toContain("Read-only file system");
  });

  test("go into a temporary folder of the command's own, which is removed when it ends", async () => {
    const result = await sh('echo scratch > "$TMPDIR/t" && echo "$TMPDIR"');

    expect(result.exitCode).toBe(0);
    const temporary = result.stdout.trim();
    expect(temporary).not.toBe("");
    expect(temporary.startsWith(work)).toBe(false);
    expect(existsSync(temporary)).toBe(false);
  });
});

describe("the network", () => {
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

  test("is closed: a server on this machine is reached neither directly nor through the sandbox's proxy", async () => {
    // The server answers a request from outside the sandbox.
    expect(await (await fetch(`http://127.0.0.1:${port}/`)).text()).toBe(
      "reached\n",
    );
    expect(requests).toBe(1);

    // Inside, a direct connection, then a request through the proxy the
    // runtime names in HTTP_PROXY with the credentials it gives there.
    const client = `
      const net = require("node:net");
      const http = require("node:http");
      const port = Number(process.argv[1]);
      const socket = net.connect(port, "127.0.0.1");
      socket.on("connect", () => { console.log("direct: connected"); socket.end(); });
      socket.on("error", (error) => console.log("direct: " + error.code));
      const proxy = new URL(process.env.HTTP_PROXY);
      const credentials = decodeURIComponent(proxy.username) + ":" + proxy.password;
      http.get({
        host: proxy.hostname,
        port: proxy.port,
        path: "http://127.0.0.1:" + port + "/",
        headers: { "proxy-authorization": "Basic " + Buffer.from(credentials).toString("base64") },
        agent: false,
      }, (response) => { console.log("proxy: " + response.statusCode); response.resume(); })
        .on("error", (error) => console.log("proxy: " + error.code));
    `;
    const result = await sandbox.run({
      argv: [process.execPath, "-e", client, String(port)],
      cwd: work,
      writable: [],
      timeLimitMs: 10_000,
    });

    expect(result.stdout).toMatch(/^direct: E[A-Z]+$/m);
    expect(result.stdout).toMatch(/^proxy: 403$/m);
    expect(requests).toBe(1);
  });

  test("refuses Unix socket pairs inherited through exec, including reconnectable datagram endpoints", async () => {
    const result = await sandbox.run({
      argv: [
        "python",
        "-I",
        "-c",
        `import errno, socket
for kind in (socket.SOCK_STREAM, socket.SOCK_DGRAM):
    try:
        socket.socketpair(socket.AF_UNIX, kind)
    except OSError as error:
        assert error.errno == errno.EPERM, error
        print("blocked")
    else:
        raise AssertionError("Unix socket pair allowed")
`,
      ],
      cwd: work,
      writable: [],
      timeLimitMs: 10_000,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("blocked\nblocked\n");
  });
});

describe("the time limit", () => {
  test("stops a command past it, with a child it started in a session of its own", async () => {
    const ticks = join(work, "ticks");
    const started = Date.now();
    const result = await sh(
      `setsid sh -c 'while :; do echo tick >> "$1"; sleep 0.05; done' sh "$1" &
       sleep 30`,
      { args: [ticks], timeLimitMs: 1000 },
    );

    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBeNull();
    expect(Date.now() - started).toBeLessThan(5000);

    // The child had been writing; once stopped, it writes no more.
    await new Promise((resolve) => setTimeout(resolve, 200));
    const before = await readFile(ticks, "utf8");
    expect(before).toContain("tick");
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(await readFile(ticks, "utf8")).toBe(before);
  });
});

describe("output over the limit", () => {
  test("is cut to its last bytes", async () => {
    const result = await sandbox.run({
      argv: [
        "sh",
        "-c",
        'i=0; while [ $i -lt 2000 ]; do echo "line $i"; i=$((i+1)); done',
      ],
      cwd: work,
      writable: [],
      timeLimitMs: 10_000,
      outputLimit: 1005,
    });

    expect(result.exitCode).toBe(0);
    expect(result.cut).toBe(true);
    expect(Buffer.byteLength(result.stdout)).toBeLessThanOrEqual(1005);
    expect(result.stdout.endsWith("line 1998\nline 1999\n")).toBe(true);
    expect(result.stdout).not.toContain("line 0\n");
  });

  test("is cut at a character, never inside one", async () => {
    // 600 two-byte characters, kept to 101 bytes: the cut falls inside a
    // character, which is dropped whole.
    const result = await sandbox.run({
      argv: [
        "sh",
        "-c",
        'i=0; while [ $i -lt 600 ]; do printf "é"; i=$((i+1)); done',
      ],
      cwd: work,
      writable: [],
      timeLimitMs: 10_000,
      outputLimit: 101,
    });

    expect(result.stdout).toBe("é".repeat(50));
  });

  test.each([
    [4, "�"],
    [2, ""],
    [0, ""],
  ])("keeps decoded invalid UTF-8 within %i bytes", async (limit, expected) => {
    const result = await sandbox.run({
      argv: [
        process.execPath,
        "-e",
        "process.stdout.write(Buffer.alloc(4, 255)); process.stderr.write(Buffer.alloc(4, 255))",
      ],
      cwd: work,
      writable: [],
      timeLimitMs: 10_000,
      outputLimit: limit,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(expected);
    expect(result.stderr).toBe(expected);
    expect(Buffer.byteLength(result.stdout)).toBeLessThanOrEqual(limit);
    expect(result.cut).toBe(true);
  });
});

describe("starting", () => {
  test("without bwrap, socat and rg the sandbox is unavailable and says once what is missing", async () => {
    vi.stubEnv("PATH", dir);
    const lines: string[] = [];

    const started = await startSandbox({ log: (line) => lines.push(line) });

    expect(started.available).toBe(false);
    expect(lines).toHaveLength(1);
    for (const tool of ["bwrap", "socat", "rg"]) {
      expect(lines[0]).toContain(tool);
    }
  });
});
