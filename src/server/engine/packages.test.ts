// Installing a course's packages (task 3.11): the commands built from the
// names the tutor gives, and the install_packages tool through the unit
// chat, with the commands' run faked (no network, no uv). The real install
// through the sandbox is checked by hand (the task's commit says how).

import { existsSync, readFileSync } from "node:fs";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { CurriculumProposal } from "../../shared/curriculum.ts";
import type { PageEvent } from "../../shared/events.ts";
import {
  PackageName,
  type PackageSpec,
  PackagesInput,
} from "../../shared/packages.ts";
import type { Plan } from "../../shared/plan.ts";
import { createFakeBackend, type FakeTurn } from "../backends/fake.ts";
import { openDataRoot } from "../record/data-root.ts";
import { givenOrder } from "./choice-order.ts";
import type { CodeRunner } from "./code-run.ts";
import { createFakeTimer } from "./fake-timer.ts";
import { createGrader } from "./grading.ts";
import { createHelpJudge } from "./help-judge.ts";
import {
  createPackageInstaller,
  type PackageInstaller,
  PACKAGE_HOSTS,
} from "./packages.ts";
import type { SandboxCommand, SandboxResult } from "./sandbox.ts";
import { createUnitChats } from "./unit-chat.ts";
import { createUnitPlanner } from "./unit-planning.ts";

// Each test gets its own data root; none touches ~/gauss (AGENTS.md).
let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "gauss-packages-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const PY = "/opt/python/bin/python3";
const ok = (stderr = ""): SandboxResult => ({
  exitCode: 0,
  timedOut: false,
  stdout: "",
  stderr,
  cut: false,
});

/** A run that records each command and answers from `answers`, in order. */
function fakeRun(answers: (SandboxResult | Promise<SandboxResult>)[] = []) {
  const commands: SandboxCommand[] = [];
  return {
    commands,
    run(command: SandboxCommand): Promise<SandboxResult> {
      commands.push(command);
      return Promise.resolve(answers.shift() ?? ok());
    },
  };
}

describe("the names the tutor may give", () => {
  test.each([
    "pytest",
    "scikit-learn",
    "zope.interface",
    "typing_extensions",
    "A1",
  ])("%s is a package name", (name) => {
    expect(PackageName.safeParse(name).success).toBe(true);
  });

  test.each([
    ["an option", "--index-url=https://evil.example/simple"],
    ["a short option", "-e"],
    ["a URL", "https://evil.example/pkg.whl"],
    ["a VCS URL", "git+https://github.com/x/y"],
    ["a relative path", "./pkg"],
    ["a parent path", "../pkg"],
    ["an absolute path", "/tmp/pkg"],
    ["a direct reference", "pkg @ https://evil.example/x.whl"],
    ["an extra", "pkg[all]"],
    ["a marker", "pkg; python_version > '3'"],
    ["two words", "two words"],
    ["nothing", ""],
    ["a trailing dot", "pkg."],
  ])("%s is refused: %s", (_, name) => {
    expect(PackageName.safeParse(name).success).toBe(false);
  });

  test("a version range is operators and versions only", () => {
    const valid = (version: string) =>
      PackagesInput.safeParse({ packages: [{ name: "pytest", version }] })
        .success;
    for (const version of [">=8", ">=2.0,<3", "==1.*", "~=2.0", "!=1.5"]) {
      expect(valid(version)).toBe(true);
    }
    for (const version of [
      "8",
      ">= 8",
      ">=8; os_name == 'nt'",
      "@ https://evil.example/x.whl",
      ">=8 --pre",
      "",
    ]) {
      expect(valid(version)).toBe(false);
    }
  });

  test("a package named twice, in another spelling too, is refused", () => {
    expect(
      PackagesInput.safeParse({
        packages: [{ name: "scikit_learn" }, { name: "Scikit-Learn" }],
      }).success,
    ).toBe(false);
  });
});

describe("the install", () => {
  function install(
    subject: PackageInstaller,
    workspace: string,
    packages: PackageSpec[],
  ) {
    return subject.install(workspace, "loops", {
      request: { id: "approved", packages, requestedAt: NOW },
      preview: { commands: subject.commands(workspace, packages), folder: workspace },
    });
  }

  test("the single UV command uses the pinned Python and only PyPI wheels", async () => {
    const workspace = join(dir, "workspace");
    const cache = join(dir, "cache", "uv");
    await mkdir(workspace);
    const fake = fakeRun();
    const installer = createPackageInstaller({
      run: fake.run,
      cacheFolder: cache,
      python: PY,
    });
    const packages = [{ name: "pytest", version: ">=8" }, { name: "numpy" }];

    const result = await install(installer, workspace, packages);

    expect(result).toMatchObject({ outcome: "installed", output: "" });
    expect(fake.commands).toEqual([
      {
        argv: expect.arrayContaining([
          "uv",
          "add",
          "--directory",
          join(dir, "packages"),
          "--default-index",
          "https://pypi.org/simple",
          "--no-build",
          "--no-install-project",
          "--no-install-workspace",
          "--no-install-local",
          "--no-sources",
          "--no-config",
          "--no-python-downloads",
          "--python",
          PY,
          "pytest>=8",
          "numpy",
        ]),
        cwd: await realpath(join(dir, "packages")),
        writable: await Promise.all(
          [join(dir, "packages"), cache, join(workspace, ".venv")].map((path) =>
            realpath(path),
          ),
        ),
        env: {
          UV_PROJECT_ENVIRONMENT: await realpath(join(workspace, ".venv")),
          UV_CACHE_DIR: await realpath(cache),
          UV_LINK_MODE: "copy",
        },
        hosts: ["pypi.org", "files.pythonhosted.org"],
        timeLimitMs: 600_000,
      },
    ]);
    expect(PACKAGE_HOSTS).toEqual(["pypi.org", "files.pythonhosted.org"]);
    expect(existsSync(cache)).toBe(true);
  });

  test("an environment that is a link to a folder elsewhere loses the link only", async () => {
    const workspace = join(dir, "workspace");
    const elsewhere = join(dir, "elsewhere");
    await mkdir(workspace);
    await mkdir(elsewhere);
    await writeFile(join(elsewhere, "kept.txt"), "the learner's\n");
    await symlink(elsewhere, join(workspace, ".venv"));
    const installer = createPackageInstaller({
      run: fakeRun().run,
      cacheFolder: join(dir, "cache"),
      python: PY,
    });

    expect(await install(installer, workspace, [{ name: "pytest" }])).toMatchObject({
      outcome: "installed",
      output: "",
    });

    expect((await lstat(join(workspace, ".venv"))).isDirectory()).toBe(true);
    expect(await readFile(join(elsewhere, "kept.txt"), "utf8")).toBe(
      "the learner's\n",
    );
  });

  test("a command that fails stops the install, and its output's end says why", async () => {
    const workspace = join(dir, "workspace");
    await mkdir(workspace);
    const lines = Array.from({ length: 40 }, (_, i) => `line ${i + 1}`);
    const fake = fakeRun([{ ...ok(lines.join("\n")), exitCode: 1 }]);
    const installer = createPackageInstaller({
      run: fake.run,
      cacheFolder: join(dir, "cache"),
      python: PY,
    });

    const result = await install(installer, workspace, [{ name: "nope" }]);

    expect(result.outcome).toBe("failed");
    const said = result.output.split("\n");
    expect(said).toHaveLength(30);
    expect(said.at(0)).toBe("line 12");
    expect(said.at(-2)).toBe("line 40");
    expect(said.at(-1)).toBe("Exit status 1.");
  });

  test("a command past its time limit fails the install", async () => {
    const workspace = join(dir, "workspace");
    await mkdir(workspace);
    const fake = fakeRun([{ ...ok(), exitCode: null, timedOut: true }]);
    const installer = createPackageInstaller({
      run: fake.run,
      cacheFolder: join(dir, "cache"),
      python: PY,
    });

    const result = await install(installer, workspace, [{ name: "pytest" }]);

    expect(result).toMatchObject({
      outcome: "failed",
      output: "Stopped after 10 minutes, its time limit.",
    });
  });
});

// --- Through the unit chat ---------------------------------------------------

const NOW = "2026-11-17T10:00:00.000Z";
const COURSE = "counting";
const CURRICULUM: CurriculumProposal = {
  title: "Counting",
  units: [
    {
      id: "loops",
      title: "Loops",
      goal: "Count with loops.",
      prerequisites: [],
    },
    {
      id: "sets",
      title: "Sets",
      goal: "Count with sets.",
      prerequisites: [],
    },
  ],
  style: "Short.",
  background: "The learner knows Python.",
};
const PLAN: Plan = {
  objectives: [{ id: "loop-count", statement: "Count with a loop." }],
  segments: [{ title: "Counting", objectives: ["loop-count"] }],
};
const CHOICE = {
  objective: "loop-count",
  kind: "choice",
  prompt: "How many times does `for i in range(3)` run?",
  choices: ["3", "2"],
  answer: "A",
};
const ask = (packages: unknown) => ({
  call: "install_packages",
  input: { packages },
});

/**
 * A server's unit chats on the record in `dir`, with unit `unitId` opened and
 * its teaching turn over. The installer's commands run on `run`.
 */
async function start(
  script: FakeTurn[],
  run = fakeRun().run,
  unitId = "loops",
  {
    codeRunner,
    withoutInstaller = false,
    workspaceTools = false,
  }: {
    codeRunner?: CodeRunner;
    withoutInstaller?: boolean;
    workspaceTools?: boolean;
  } = {},
) {
  const root = openDataRoot({ path: dir, now: () => new Date(NOW) });
  if ((await root.readCourse(COURSE)) === undefined) {
    const { id } = await root.createCourse({ title: CURRICULUM.title });
    await root.saveProposal(id, CURRICULUM);
    await root.approveCurriculum(id, CURRICULUM);
    await root.storePlan(id, "loops", PLAN);
    await root.storePlan(id, "sets", {
      objectives: [{ id: "set-count", statement: "Count with a set." }],
      segments: [{ title: "Sets", objectives: ["set-count"] }],
    });
  }
  const backend = createFakeBackend(script);
  const units = createUnitChats({
    backend,
    systemPrompt: "Tutor.",
    dataRoot: root,
    planner: createUnitPlanner({
      backend,
      systemPrompt: "Plan.",
      dataRoot: root,
    }),
    grader: createGrader({ backend, systemPrompt: "Grader." }),
    judge: createHelpJudge({ backend, systemPrompt: "Judge." }),
    now: () => new Date(NOW),
    timer: createFakeTimer(),
    order: givenOrder,
    workspaceTools,
    ...(codeRunner === undefined ? {} : { codeRunner }),
    ...(withoutInstaller
      ? {}
      : {
          installer: createPackageInstaller({
            run,
            cacheFolder: join(dir, "cache", "uv"),
            dataRoot: root,
            python: PY,
          }),
        }),
  });
  const opened = await units.open(COURSE, unitId);
  if (!opened.ok) throw new Error(opened.error);
  await opened.chat.settled();
  return { backend, root, units, chat: opened.chat };
}

function cards(events: readonly PageEvent[]) {
  return events.filter(
    (e) =>
      e.type === "packages_requested" ||
      e.type === "packages_installing" ||
      e.type === "packages_save_failed" ||
      e.type === "packages_answered",
  );
}

function requestId(events: readonly PageEvent[]): string {
  const card = events.findLast((e) => e.type === "packages_requested");
  if (card?.type !== "packages_requested") throw new Error("no request");
  return card.requestId;
}

test("a request shows its card with the commands and the workspace, and is kept in the unit's position", async () => {
  const { backend, root, chat } = await start([
    [{ text: "Teaching." }, ask([{ name: "pytest", version: ">=8" }])],
  ]);

  expect(backend.calls.at(-1)?.result).toEqual({
    status: "done",
    text: expect.stringContaining("The learner sees your request on a card."),
  });
  const workspace = join(dir, "courses", COURSE, "workspace");
  expect(cards(chat.events())).toEqual([
    {
      type: "packages_requested",
      requestId: expect.any(String),
      packages: [{ name: "pytest", version: ">=8" }],
      commands: [
        expect.arrayContaining([
          "uv",
          "add",
          "--directory",
          join(dir, "courses", COURSE, "packages"),
          "--no-build",
          "pytest>=8",
        ]),
      ],
      folder: workspace,
    },
  ]);
  const state = await root.readState(COURSE);
  expect(state.units.loops?.packageRequest).toEqual({
    id: requestId(chat.events()),
    packages: [{ name: "pytest", version: ">=8" }],
    requestedAt: NOW,
  });
});

test("what is not a package name is refused with the reason, and nothing is asked", async () => {
  const { backend, chat } = await start([
    [
      { text: "Teaching." },
      ask([{ name: "--index-url=https://evil.example/simple" }]),
      ask([{ name: "../wheels/pkg.whl" }]),
      ask([{ name: "pytest", version: "@ https://evil.example/x.whl" }]),
    ],
  ]);

  expect(backend.calls.map((c) => c.result.status)).toEqual([
    "refused",
    "refused",
    "refused",
  ]);
  expect(backend.calls[0]?.result.text).toContain("Not a package name");
  expect(backend.calls[2]?.result.text).toContain("Not a version range");
  expect(cards(chat.events())).toEqual([]);
});

test("Install runs the commands and tells the tutor in a turn of its own; the request leaves the position", async () => {
  const fake = fakeRun([ok(" + pytest==9.2.0")]);
  const { backend, root, chat } = await start(
    [
      [{ text: "Teaching." }, ask([{ name: "pytest" }])],
      [{ text: "Now we can test." }],
    ],
    fake.run,
  );
  const id = requestId(chat.events());

  expect(await chat.installPackages(id)).toEqual({ ok: true });
  await chat.settled();

  expect(fake.commands).toHaveLength(1);
  expect(cards(chat.events()).slice(1)).toEqual([
    { type: "packages_installing", requestId: id },
    {
      type: "packages_answered",
      requestId: id,
      outcome: "installed",
      output: " + pytest==9.2.0",
    },
  ]);
  const told = backend.received.at(-1)?.text ?? "";
  expect(told).toContain(
    "The learner answered your request to install packages.",
  );
  expect(told).toContain(
    "The learner installed the packages you asked for: pytest.",
  );
  expect(told).toContain("`.venv/bin/python -m pytest`");
  expect(
    (await root.readState(COURSE)).units.loops?.packageRequest,
  ).toBeUndefined();
  // Answered once only.
  expect(await chat.installPackages(id)).toEqual({
    ok: false,
    status: 409,
    error: "That request to install packages is not waiting.",
  });
});

test("a failed install tells the tutor with the end of the output, and it may ask again", async () => {
  const fake = fakeRun([
    { ...ok("error: No solution found for nopkg"), exitCode: 1 },
  ]);
  const { backend, chat } = await start(
    [
      [{ text: "Teaching." }, ask([{ name: "nopkg" }])],
      [{ text: "That failed." }, ask([{ name: "pytest" }])],
    ],
    fake.run,
  );

  expect(await chat.installPackages(requestId(chat.events()))).toEqual({
    ok: true,
  });
  await chat.settled();

  const told = backend.received.at(-1)?.text ?? "";
  expect(told).toContain(
    "Installing the packages you asked for, nopkg, failed. The end of its output:",
  );
  expect(told).toContain("error: No solution found for nopkg\nExit status 1.");
  expect(cards(chat.events())).toContainEqual(
    expect.objectContaining({ type: "packages_answered", outcome: "failed" }),
  );
  // Its second request is shown.
  expect(backend.calls.at(-1)?.result.status).toBe("done");
  expect(cards(chat.events()).at(-1)).toEqual(
    expect.objectContaining({
      type: "packages_requested",
      packages: [{ name: "pytest" }],
    }),
  );
});

test('"Not now" runs nothing and tells the tutor in its next header', async () => {
  const fake = fakeRun();
  const { backend, chat } = await start(
    [[{ text: "Teaching." }, ask([{ name: "pytest" }])], [{ text: "Fine." }]],
    fake.run,
  );

  expect(await chat.declinePackages(requestId(chat.events()))).toEqual({
    ok: true,
  });
  await chat.settled();

  expect(fake.commands).toEqual([]);
  expect(cards(chat.events()).at(-1)).toEqual({
    type: "packages_answered",
    requestId: requestId(chat.events()),
    outcome: "declined",
  });
  expect(backend.received.at(-1)?.text).toContain(
    'The learner answered "Not now" to installing pytest.',
  );
});

test("an answer is told once: a learner's message queued when the install ends carries it, and the turn of its own is not sent", async () => {
  const held = Promise.withResolvers<SandboxResult>();
  const { backend, chat } = await start(
    [
      [{ text: "Teaching." }, ask([{ name: "pytest" }])],
      [{ hold: true }],
      [{ text: "Noted." }],
    ],
    fakeRun([held.promise]).run,
  );
  const id = requestId(chat.events());
  expect(await chat.installPackages(id)).toEqual({ ok: true });
  // While it installs: one message the tutor is answering, one queued.
  expect(chat.say("Hold on. /hold")).toEqual({ ok: true });
  expect(chat.say("Something else.")).toEqual({ ok: true });
  held.resolve(ok());
  while (!chat.events().some((e) => e.type === "packages_answered")) {
    await new Promise((r) => setTimeout(r, 5));
  }
  await chat.interrupt();
  await chat.settled();

  const sent = backend.received.map((t) => t.text);
  expect(sent).toHaveLength(3);
  expect(sent[1]).not.toContain("The learner installed");
  expect(sent[2]).toContain("Message from the learner.");
  expect(sent[2]).toContain(
    "The learner installed the packages you asked for: pytest.",
  );
});

test("a request still waiting when the unit ends is withdrawn, and its card says so", async () => {
  const { chat } = await start([
    [{ text: "Teaching." }, ask([{ name: "pytest" }])],
    [{ text: "A question." }, { call: "ask_question", input: CHOICE }],
    [{ text: "Right." }],
  ]);
  const id = requestId(chat.events());
  expect(await chat.ready()).toEqual({ ok: true });
  await chat.settled();
  const posted = chat.events().findLast((e) => e.type === "question");
  if (posted?.type !== "question") throw new Error("no question");
  await chat.answer({
    kind: "choice",
    questionId: posted.question.id,
    choice: "A",
    confidence: "90",
  });
  await chat.settled();

  const events = chat.events();
  const withdrawn = events.findIndex(
    (e) => e.type === "packages_answered" && e.outcome === "withdrawn",
  );
  expect(events[withdrawn]).toEqual({
    type: "packages_answered",
    requestId: id,
    outcome: "withdrawn",
  });
  expect(withdrawn).toBeLessThan(
    events.findIndex((e) => e.type === "unit_closed"),
  );
});

test("the request that waits is said in every header until it is answered, and kept across a restart, where its card shows again", async () => {
  const first = await start([
    [{ text: "Teaching." }, ask([{ name: "pytest" }])],
    [{ text: "A reply." }],
  ]);
  const id = requestId(first.chat.events());
  expect(first.chat.say("And?")).toEqual({ ok: true });
  await first.chat.settled();
  expect(first.backend.received.at(-1)?.text).toContain(
    "Your request to install pytest waits for the learner's answer",
  );
  await first.units.close();

  const fake = fakeRun();
  const { chat, backend } = await start([[{ text: "Installed." }]], fake.run);

  // Shown once, from the transcript, and said again as the chat opens.
  const shown = cards(chat.events());
  expect(shown.filter((e) => e.type === "packages_requested")).toHaveLength(2);
  expect(requestId(chat.events())).toBe(id);
  expect(await chat.installPackages(id)).toEqual({ ok: true });
  await chat.settled();
  expect(fake.commands).toHaveLength(1);
  expect(backend.received.at(-1)?.text).toContain(
    "The learner installed the packages you asked for: pytest.",
  );
});

test("a request is refused while a question is open in the course, and while another waits in any unit", async () => {
  const first = await start([
    [{ text: "Teaching." }],
    [{ text: "A question." }, { call: "ask_question", input: CHOICE }],
    [{ text: "A reply." }, ask([{ name: "pytest" }])],
  ]);
  expect(await first.chat.ready()).toEqual({ ok: true });
  await first.chat.settled();
  expect(first.chat.say("Can we install something?")).toEqual({ ok: true });
  await first.chat.settled();
  expect(first.backend.calls.at(-1)?.result).toEqual({
    status: "refused",
    text: "Question 1 is open: packages can be asked for once its answer is graded.",
  });
  await first.units.close();

  // Another unit of the course: the question in the first still blocks it.
  const second = await start(
    [[{ text: "Teaching sets." }, ask([{ name: "numpy" }])]],
    fakeRun().run,
    "sets",
  );
  expect(second.backend.calls.at(-1)?.result.status).toBe("refused");
  expect(cards(second.chat.events())).toEqual([]);
});

test("a second request is refused while one waits, in another unit too", async () => {
  const first = await start([
    [
      { text: "Teaching." },
      ask([{ name: "pytest" }]),
      ask([{ name: "numpy" }]),
    ],
  ]);
  expect(first.backend.calls.map((c) => c.result)).toEqual([
    expect.objectContaining({ status: "done" }),
    {
      status: "refused",
      text:
        "A request to install packages already waits for the learner's " +
        "answer. Wait for it: you are told when they answer.",
    },
  ]);
  await first.units.close();

  const second = await start(
    [[{ text: "Teaching sets." }, ask([{ name: "numpy" }])]],
    fakeRun().run,
    "sets",
  );
  expect(second.backend.calls.at(-1)?.result.status).toBe("refused");
});

test("while the packages install, no question is posted and the tutor writes nothing, then both are allowed again", async () => {
  const held = Promise.withResolvers<SandboxResult>();
  const fake = fakeRun([held.promise]);
  const { backend, chat } = await start(
    [
      [{ text: "Teaching." }, ask([{ name: "pytest" }])],
      // The "ready" turn, while the packages install.
      [{ text: "A question." }, { call: "ask_question", input: CHOICE }],
      // A message's reply, while they install.
      [{ builtIn: "Write", path: "count.py" }, { text: "Not now." }],
      // The turn with the outcome.
      [{ builtIn: "Write", path: "count.py" }, { text: "Installed." }],
    ],
    fake.run,
    "loops",
    { workspaceTools: true },
  );
  const id = requestId(chat.events());
  expect(await chat.installPackages(id)).toEqual({ ok: true });
  // A second Install while it runs is refused.
  expect(await chat.installPackages(id)).toEqual({
    ok: false,
    status: 409,
    error: "The packages are being installed.",
  });
  expect(await chat.ready()).toEqual({ ok: true });
  expect(chat.say("Write the file?")).toEqual({ ok: true });
  // Until the install ends, only the turns before it run.
  while (backend.calls.length < 3) await new Promise((r) => setTimeout(r, 5));

  expect(backend.calls.slice(1).map((c) => c.result)).toEqual([
    {
      status: "refused",
      text:
        "Packages are being installed in the workspace. End your turn; you " +
        "are told when the install ends, and can post the question then.",
    },
    {
      status: "refused",
      text:
        "Packages are being installed in the workspace: no file may be " +
        "written and no command run until that ends. You may still read files.",
    },
  ]);

  held.resolve(ok());
  await chat.settled();
  expect(backend.calls.at(-1)).toEqual(
    expect.objectContaining({
      name: "Write",
      result: expect.objectContaining({ status: "done" }),
    }),
  );
  expect(cards(chat.events()).at(-1)).toEqual(
    expect.objectContaining({ outcome: "installed" }),
  );
});

test("Install is refused while a question is open, and allowed once it is graded", async () => {
  const fake = fakeRun();
  const { chat } = await start(
    [
      [{ text: "Teaching." }, ask([{ name: "pytest" }])],
      [{ text: "A question." }, { call: "ask_question", input: CHOICE }],
      [{ text: "Not quite: the detour." }],
      [{ text: "Installed." }],
    ],
    fake.run,
  );
  const id = requestId(chat.events());
  expect(await chat.ready()).toEqual({ ok: true });
  await chat.settled();

  expect(await chat.installPackages(id)).toEqual({
    ok: false,
    status: 409,
    error:
      "Answer question 1 first: nothing is installed while a question is open.",
  });
  expect(fake.commands).toEqual([]);

  const posted = chat.events().findLast((e) => e.type === "question");
  if (posted?.type !== "question") throw new Error("no question");
  expect(
    await chat.answer({
      kind: "choice",
      questionId: posted.question.id,
      choice: "B",
      confidence: "90",
    }),
  ).toEqual({ ok: true });
  await chat.settled();

  // In the detour after the miss no question is open.
  expect(await chat.installPackages(id)).toEqual({ ok: true });
  await chat.settled();
  expect(fake.commands).toHaveLength(1);
});

test("a package completion the transcript lost is replayed once after restart", async () => {
  const first = await start(
    [
      [{ text: "Teaching." }, ask([{ name: "pytest" }])],
      [{ text: "Installed." }],
    ],
    fakeRun([ok(" + pytest==9.2.0")]).run,
  );
  const id = requestId(first.chat.events());
  expect(await first.chat.installPackages(id)).toEqual({ ok: true });
  await first.chat.settled();
  const answered = cards(first.chat.events()).filter(
    (e) => e.type === "packages_answered",
  );
  expect(answered).toEqual([
    expect.objectContaining({
      requestId: id,
      outcome: "installed",
      output: " + pytest==9.2.0",
    }),
  ]);
  // Ordinary writes, including in another unit, preserve completed cards.
  await first.root.writePosition(COURSE, "sets", {
    segment: 0,
    phase: "discuss",
  });
  await first.units.close();

  // Lose just the terminal line of this scratch transcript, not the record.
  const path = join(dir, "courses", COURSE, "sessions", "loops.1.jsonl");
  const lines = (await readFile(path, "utf8")).split("\n");
  const at = lines.findIndex(
    (line) => line !== "" && JSON.parse(line).type === "packages_answered",
  );
  expect(at).toBeGreaterThan(0);
  lines.splice(at, 1);
  await writeFile(path, lines.join("\n"));

  const fake = fakeRun();
  const second = await start([], fake.run);
  expect(
    cards(second.chat.events()).filter((e) => e.type === "packages_answered"),
  ).toEqual(answered);
  expect(fake.commands).toEqual([]);
  await second.units.close();

  const third = await start([]);
  expect(
    cards(third.chat.events()).filter((e) => e.type === "packages_answered"),
  ).toEqual(answered);
  await third.units.close();
});

test("opening another unit leaves a live install alone and its blocked question is reasked when the install completes", async () => {
  const held = Promise.withResolvers<SandboxResult>();
  const candidateReady = Promise.withResolvers<void>();
  const setsQuestion = {
    call: "ask_question",
    input: {
      ...CHOICE,
      objective: "set-count",
      prompt: "How many elements are in the set {1, 2, 3}?",
    },
  };
  // The two notifications can run in either order: only Sets asks again.
  const afterInstall: FakeTurn = ({ text }) =>
    text.includes('"set-count"') ? [setsQuestion] : [{ text: "Installed." }];
  const {
    backend,
    root,
    units,
    chat: loops,
  } = await start(
    [
      [{ text: "Teaching loops." }, ask([{ name: "pytest" }])],
      [{ text: "Teaching sets." }],
      [setsQuestion, setsQuestion],
      afterInstall,
      afterInstall,
    ],
    async (command) => {
      const environment = command.env?.UV_PROJECT_ENVIRONMENT ?? "";
      await writeFile(join(environment, "candidate"), "candidate is live");
      candidateReady.resolve();
      return held.promise;
    },
  );
  const course = join(dir, "courses", COURSE);
  const environment = join(course, "workspace", ".venv");
  const running = join(course, ".package-install.tmp", "running");
  await mkdir(environment);
  await writeFile(join(environment, "old"), "previous environment");

  expect(await loops.installPackages(requestId(loops.events()))).toEqual({
    ok: true,
  });
  await candidateReady.promise;
  const opened = await units.open(COURSE, "sets");
  if (!opened.ok) throw new Error(opened.error);
  const sets = opened.chat;
  try {
    await sets.settled();
    expect(await readFile(join(running, "previous", "old"), "utf8")).toBe(
      "previous environment",
    );
    expect(await readFile(join(environment, "candidate"), "utf8")).toBe(
      "candidate is live",
    );
    expect(await sets.ready()).toEqual({ ok: true });
    await sets.settled();
    expect(backend.calls.slice(-2).map((call) => call.result)).toEqual([
      expect.objectContaining({
        status: "refused",
        text: expect.stringContaining("Packages are being installed"),
      }),
      expect.objectContaining({
        status: "refused",
        text: expect.stringContaining("Packages are being installed"),
      }),
    ]);
    expect(sets.events().filter((e) => e.type === "question")).toEqual([]);
    expect(
      (await root.readState(COURSE)).units.sets?.openQuestion,
    ).toBeUndefined();
  } finally {
    held.resolve(ok());
    await loops.settled();
  }
  await sets.settled();

  expect(sets.events().filter((e) => e.type === "question")).toEqual([
    expect.objectContaining({
      question: expect.objectContaining({ prompt: setsQuestion.input.prompt }),
    }),
  ]);
  expect(backend.received).toHaveLength(5);
  await units.close();
});

test('"Not now" during its own open question waits for a safe tutor turn', async () => {
  const fake = fakeRun();
  const { backend, chat, units } = await start(
    [
      [{ text: "Teaching." }, ask([{ name: "pytest" }])],
      [{ call: "ask_question", input: CHOICE }],
      [{ text: "Not quite: the detour." }],
      [{ text: "Let's review the loop." }],
    ],
    fake.run,
  );
  const id = requestId(chat.events());
  expect(await chat.ready()).toEqual({ ok: true });
  await chat.settled();
  const posted = chat.events().findLast((e) => e.type === "question");
  if (posted?.type !== "question") throw new Error("no question");
  const before = chat.events().length;

  expect(await chat.declinePackages(id)).toEqual({ ok: true });
  await chat.settled();

  expect(cards(chat.events()).at(-1)).toEqual({
    type: "packages_answered",
    requestId: id,
    outcome: "declined",
  });
  expect(
    chat
      .events()
      .slice(before)
      .filter((e) => e.type === "tutor_text"),
  ).toEqual([]);
  expect(backend.received).toHaveLength(2);
  expect(fake.commands).toEqual([]);

  expect(
    await chat.answer({
      kind: "choice",
      questionId: posted.question.id,
      choice: "B",
      confidence: "90",
    }),
  ).toEqual({ ok: true });
  await chat.settled();
  expect(chat.say("Can we review why?")).toEqual({ ok: true });
  await chat.settled();

  expect(
    backend.received
      .slice(2)
      .filter((t) =>
        t.text.includes('The learner answered "Not now" to installing pytest.'),
      ),
  ).toHaveLength(1);
  await units.close();
});

test("a finished unit recovers its withdrawn package card even when both transcript lines are lost", async () => {
  const first = await start([
    [{ text: "Teaching." }, ask([{ name: "pytest" }])],
    [{ call: "ask_question", input: CHOICE }],
    [{ text: "Right." }],
  ]);
  expect(await first.chat.ready()).toEqual({ ok: true });
  await first.chat.settled();
  const posted = first.chat.events().findLast((e) => e.type === "question");
  if (posted?.type !== "question") throw new Error("no question");
  expect(
    await first.chat.answer({
      kind: "choice",
      questionId: posted.question.id,
      choice: "A",
      confidence: "90",
    }),
  ).toEqual({ ok: true });
  await first.chat.settled();
  const withdrawn = cards(first.chat.events());
  expect(withdrawn).toEqual([
    expect.objectContaining({ type: "packages_requested" }),
    expect.objectContaining({
      type: "packages_answered",
      outcome: "withdrawn",
    }),
  ]);
  await first.units.close();

  const path = join(dir, "courses", COURSE, "sessions", "loops.1.jsonl");
  const lines = (await readFile(path, "utf8")).split("\n");
  await writeFile(
    path,
    lines
      .filter(
        (line) => line === "" || !JSON.parse(line).type.startsWith("packages_"),
      )
      .join("\n"),
  );

  const second = await start([]);
  expect(cards(second.chat.events())).toEqual([
    { ...withdrawn[0], historical: true },
    withdrawn[1],
  ]);
  expect(second.backend.received).toEqual([]);
  await second.units.close();
});

test("Retry saving preserves the original install outcome after the unit finishes", async () => {
  const started = Promise.withResolvers<void>();
  const held = Promise.withResolvers<SandboxResult>();
  const fake = fakeRun([held.promise]);
  const { backend, chat, root, units } = await start(
    [[{ text: "Teaching." }, ask([{ name: "pytest" }])]],
    (command) => {
      started.resolve();
      return fake.run(command);
    },
  );
  const id = requestId(chat.events());
  const [request] = cards(chat.events());
  expect(await chat.installPackages(id)).toEqual({ ok: true });
  await started.promise;
  expect(await chat.override()).toEqual({ ok: true });
  expect(await chat.finishUnit()).toEqual({ ok: true });
  expect((await root.readState(COURSE)).units.loops).toBeUndefined();
  expect(backend.received).toHaveLength(1);

  const path = join(dir, "courses", COURSE, "state.json");
  const state = await readFile(path);
  const journal = join(dir, "courses", COURSE, ".package-install.tmp");
  const receipt = join(journal, "committed", "receipt.json");
  await rm(path);
  await mkdir(path);
  try {
    held.resolve(ok(" + pytest==9.2.0"));
    await chat.settled();
    expect(cards(chat.events())).toEqual([
      request,
      { type: "packages_installing", requestId: id },
      { type: "packages_save_failed", requestId: id },
    ]);
    expect(existsSync(receipt)).toBe(true);
    expect(await chat.retryPackageSave(id)).toMatchObject({
      ok: false,
      status: 409,
    });
    expect(existsSync(receipt)).toBe(true);
  } finally {
    await rm(path, { recursive: true });
    await writeFile(path, state);
  }

  expect(await chat.installPackages(id)).toMatchObject({ ok: false, status: 409 });
  expect(await chat.declinePackages(id)).toMatchObject({ ok: false, status: 409 });
  expect(await chat.retryPackageSave(id)).toEqual({ ok: true });
  await chat.settled();
  expect(existsSync(journal)).toBe(false);
  expect(backend.received).toHaveLength(1);
  expect(fake.commands.map((command) => command.argv[1])).toEqual(["add"]);
  expect(cards(chat.events()).at(-1)).toEqual({
    type: "packages_answered",
    requestId: id,
    outcome: "installed",
    output: " + pytest==9.2.0",
  });
  const saved = await root.readState(COURSE);
  expect(saved.units.loops).toBeUndefined();
  expect(saved.packageCompletions?.loops?.[id]).toMatchObject({
    outcome: "installed",
    output: " + pytest==9.2.0",
  });
  await units.close();
});

test.each(["preparing", "running"] as const)(
  "reopening restores a legacy %s journal before a tutor turn, even without an installer",
  async (stage) => {
    const first = await start([
      [{ text: "Teaching." }, ask([{ name: "pytest" }])],
    ]);
    await first.units.close();
    const course = join(dir, "courses", COURSE);
    const environment = join(course, "workspace", ".venv");
    const project = join(course, "packages");
    const journal = join(course, ".package-install.tmp");
    const parked = join(journal, stage);
    await mkdir(join(parked, "previous"), { recursive: true });
    await mkdir(project);
    await writeFile(join(parked, "previous", "old"), "previous environment");
    await writeFile(join(parked, "pyproject.toml"), "previous manifest");
    await writeFile(join(parked, "uv.lock"), "previous lock");
    if (stage === "running") {
      await mkdir(environment);
      await writeFile(join(environment, "candidate"), "interrupted candidate");
    }
    await writeFile(
      join(project, "pyproject.toml"),
      stage === "running" ? "interrupted manifest" : "previous manifest",
    );
    await writeFile(
      join(project, "uv.lock"),
      stage === "running" ? "interrupted lock" : "previous lock",
    );

    const observed: unknown[] = [];
    const reopened = await start(
      [
        () => {
          observed.push({
            old: readFileSync(join(environment, "old"), "utf8"),
            candidate: existsSync(join(environment, "candidate")),
            manifest: readFileSync(join(project, "pyproject.toml"), "utf8"),
            lock: readFileSync(join(project, "uv.lock"), "utf8"),
          });
          return [{ text: "Teaching sets." }];
        },
      ],
      undefined,
      "sets",
      { withoutInstaller: true },
    );
    expect(observed).toEqual([
      {
        old: "previous environment",
        candidate: false,
        manifest: "previous manifest",
        lock: "previous lock",
      },
    ]);
    expect(existsSync(journal)).toBe(false);
    const loops = await reopened.units.open(COURSE, "loops");
    if (!loops.ok) throw new Error(loops.error);
    await loops.chat.settled();
    const id = requestId(first.chat.events());
    expect(cards(loops.chat.events()).at(-1)).toMatchObject({
      type: "packages_requested",
      requestId: id,
    });
    expect(cards(loops.chat.events()).at(-1)).not.toHaveProperty("historical");
    expect(await loops.chat.declinePackages(id)).toEqual({ ok: true });
    await reopened.units.close();
  },
);

test.each([
  {
    outcome: "installed",
    exitCode: 0,
    output: "pytest was added",
    marker: "candidate",
  },
  {
    outcome: "failed",
    exitCode: 1,
    output: "resolution failed\nExit status 1.",
    marker: "old",
  },
])(
  "a restart saves a committed $outcome receipt without rerunning uv",
  async ({ outcome, exitCode, output, marker }) => {
    const entered = Promise.withResolvers<void>();
    const held = Promise.withResolvers<void>();
    const launches: string[][] = [];
    const run = async (command: SandboxCommand) => {
      launches.push([...command.argv]);
      const environment = command.env?.UV_PROJECT_ENVIRONMENT ?? "";
      await writeFile(join(environment, "candidate"), "new environment");
      entered.resolve();
      await held.promise;
      return { ...ok(output.split("\n")[0]), exitCode };
    };
    const first = await start(
      [[{ text: "Teaching." }, ask([{ name: "pytest" }])]],
      run,
    );
    const id = requestId(first.chat.events());
    const course = join(dir, "courses", COURSE);
    const environment = join(course, "workspace", ".venv");
    const journal = join(course, ".package-install.tmp");
    await mkdir(environment);
    await writeFile(join(environment, "old"), "previous environment");
    expect(await first.chat.installPackages(id)).toEqual({ ok: true });
    await entered.promise;

    const path = join(course, "state.json");
    const state = await readFile(path);
    await rm(path);
    await mkdir(path);
    try {
      held.resolve();
      await first.chat.settled();
      expect(cards(first.chat.events()).at(-1)).toEqual({
        type: "packages_save_failed",
        requestId: id,
      });
      expect(existsSync(join(journal, "committed", "receipt.json"))).toBe(true);
    } finally {
      await rm(path, { recursive: true });
      await writeFile(path, state);
    }
    expect(
      (await first.root.readState(COURSE)).units.loops?.packageRequest?.id,
    ).toBe(id);
    await first.units.close();

    const second = await start([], run, "loops", { withoutInstaller: true });
    expect(
      cards(second.chat.events()).filter(
        (e) => e.type === "packages_requested" && !e.historical,
      ),
    ).toEqual([]);
    expect(cards(second.chat.events()).at(-1)).toEqual({
      type: "packages_answered",
      requestId: id,
      outcome,
      output,
    });
    expect(await second.chat.installPackages(id)).toMatchObject({
      ok: false,
      status: 409,
    });
    expect(await second.chat.declinePackages(id)).toMatchObject({
      ok: false,
      status: 409,
    });
    const saved = await second.root.readState(COURSE);
    expect(saved.packageCompletions?.loops?.[id]).toMatchObject({
      outcome,
      output,
    });
    expect(saved.units.loops?.packageRequest).toBeUndefined();
    expect(existsSync(journal)).toBe(false);
    expect(await readFile(join(environment, marker), "utf8")).toBe(
      marker === "candidate" ? "new environment" : "previous environment",
    );
    expect(
      existsSync(join(environment, marker === "candidate" ? "old" : "candidate")),
    ).toBe(false);
    expect(launches).toHaveLength(1);
    expect(second.backend.received).toEqual([]);
    await second.units.close();
  },
);

test("reopening a kept code answer only starts grading after rollback", async () => {
  const first = await start([[{ text: "Teaching." }]]);
  const course = join(dir, "courses", COURSE);
  const environment = join(course, "workspace", ".venv");
  const journal = join(course, ".package-install.tmp");
  const previous = join(journal, "running", "previous");
  await mkdir(previous, { recursive: true });
  await writeFile(join(previous, "old"), "previous environment");
  await mkdir(environment);
  await writeFile(join(environment, "candidate"), "interrupted candidate");
  const id = "kept-code";
  await first.root.writePosition(COURSE, "loops", {
    phase: "check",
    segment: 0,
    checkFrom: 0,
    openQuestion: {
      id,
      number: 1,
      objective: "loop-count",
      postedAt: NOW,
      question: {
        kind: "code",
        prompt: "Count three items.",
        files: ["loop.py"],
        tests: [{ path: "test_loop.py", content: "assert count() == 3" }],
        solution: [{ path: "loop.py", content: "def count(): return 3" }],
        command: [".venv/bin/python", "-m", "pytest"],
        inputs: [],
      },
      answer: {
        kind: "code",
        questionId: id,
        confidence: "90",
        files: [{ path: "loop.py", content: "def count(): return 2" }],
      },
    },
  });
  await first.units.close();

  const observed: string[][] = [];
  const second = await start([[{ text: "Feedback." }]], undefined, "loops", {
    withoutInstaller: true,
    codeRunner: {
      check: async () => ({ refused: "Expected only a kept answer." }),
      async run(_question, files, workspace) {
        observed.push([
          await readFile(join(workspace, ".venv", "old"), "utf8"),
          String(existsSync(join(workspace, ".venv", "candidate"))),
          files[0]?.content ?? "",
        ]);
        return { result: "failed", exitCode: 1, output: "Expected 3; got 2." };
      },
    },
  });
  expect(observed).toEqual([
    ["previous environment", "false", "def count(): return 2"],
  ]);
  expect(second.chat.events()).toContainEqual(
    expect.objectContaining({ type: "graded", questionId: id, verdict: "incorrect" }),
  );
  expect(existsSync(journal)).toBe(false);
  await second.units.close();
});

test("a saved receipt whose cleanup failed cannot obstruct a different install after cleanup is possible", async () => {
  const fake = fakeRun([ok("First install"), ok("Second install")]);
  const { root, chat, units } = await start(
    [
      [{ text: "Teaching." }, ask([{ name: "pytest" }])],
      [{ text: "One more." }, ask([{ name: "numpy" }])],
      [{ text: "Done." }],
    ],
    fake.run,
  );
  const id = requestId(chat.events());
  const course = join(dir, "courses", COURSE);
  const journal = join(course, ".package-install.tmp");
  const behind = join(course, "blocked-journal");
  const writePosition = root.writePosition;
  const intercept = vi.spyOn(root, "writePosition").mockImplementation(
    async (...args) => {
      const saved = await writePosition(...args);
      if (args[3]?.request.id === id) {
        await rename(journal, behind);
        await writeFile(journal, "blocks journal cleanup");
      }
      return saved;
    },
  );
  expect(await chat.installPackages(id)).toEqual({ ok: true });
  await chat.settled();
  intercept.mockRestore();

  expect((await root.readState(COURSE)).packageCompletions?.loops?.[id]).toMatchObject({
    outcome: "installed",
    output: "First install",
  });
  expect(existsSync(join(behind, "committed", "receipt.json"))).toBe(true);
  const next = requestId(chat.events());
  expect(next).not.toBe(id);
  expect(await chat.installPackages(next)).toMatchObject({ ok: false, status: 409 });
  expect(fake.commands).toHaveLength(1);

  await rm(journal);
  await rename(behind, journal);
  expect(await chat.installPackages(next)).toEqual({ ok: true });
  await chat.settled();
  expect(fake.commands).toHaveLength(2);
  expect(cards(chat.events()).at(-1)).toEqual({
    type: "packages_answered",
    requestId: next,
    outcome: "installed",
    output: "Second install",
  });
  expect(existsSync(journal)).toBe(false);
  await units.close();
});
