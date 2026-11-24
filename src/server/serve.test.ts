// Which backend runs each role, as `wireEngine` wires the server (brief.md,
// "Backends and stack"): a course's tutor and unit planner run on the
// backend the course was made for; the course's planning, the grader, the
// judges and the writers always on Claude. Two scripted backends stand for
// Claude and Codex, and each call is told apart by its role's prompt.

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, expect, test } from "vitest";
import type { BackendName } from "../shared/course.ts";
import type { CurriculumProposal } from "../shared/curriculum.ts";
import type { SessionBackends, TutorBackend } from "./backends/backend.ts";
import { createScriptedBackend, scriptedPlan } from "./backends/scripted.ts";
import type { Sandbox } from "./engine/sandbox.ts";
import type { UnitChat } from "./engine/unit-chat.ts";
import { createUnitPlanner } from "./engine/unit-planning.ts";
import { noBackup } from "./record/backup.ts";
import { type DataRoot, openDataRoot } from "./record/data-root.ts";
import { wireEngine } from "./serve.ts";

// Each test gets its own data root; none touches ~/gauss (AGENTS.md).
let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "gauss-serve-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const ROLES = [
  "tutor",
  "unit-planner",
  "course-planner",
  "planner",
  "grader",
  "help-judge",
  "dispute-judge",
  "handoff",
  "notes",
] as const;
let prompts: [string, string][];
beforeAll(async () => {
  prompts = await Promise.all(
    ROLES.map(
      async (role) =>
        [
          role,
          await readFile(new URL(`../../prompts/${role}.md`, import.meta.url), {
            encoding: "utf8",
          }),
        ] as [string, string],
    ),
  );
});

/** The role whose prompt begins the system prompt: a tutor's has more after it. */
function role(systemPrompt: string): string {
  return (
    prompts.find(([, text]) => systemPrompt.startsWith(text))?.[0] ?? "unknown"
  );
}

/** A scripted backend that notes each call, by the role making it. */
function recorded(calls: string[]): TutorBackend {
  const backend = createScriptedBackend();
  return {
    startSession(options) {
      const kind = options.resumeId === undefined ? "start" : "resume";
      calls.push(`${kind} ${role(options.systemPrompt)}`);
      return backend.startSession(options);
    },
    hasSession(id, cwd) {
      calls.push("has");
      return backend.hasSession(id, cwd);
    },
    oneShot(request) {
      calls.push(`oneShot ${role(request.systemPrompt)}`);
      return backend.oneShot(request);
    },
  };
}

const NO_SANDBOX: Sandbox = {
  available: false,
  reason: "no sandbox in this test",
  close: () => Promise.resolve(),
};

function wire(
  dataRoot: DataRoot,
  claude: TutorBackend,
  sessionBackends: SessionBackends,
  codexUnavailable: () => Promise<string | undefined> = async () => undefined,
) {
  return wireEngine({
    sessionBackends: { ...sessionBackends, claude },
    graderBackend: claude,
    judgeBackend: claude,
    disputeBackend: claude,
    handoffBackend: claude,
    notesBackend: claude,
    codexUnavailable,
    dataRoot,
    dataRootPath: dir,
    sandbox: NO_SANDBOX,
    backup: noBackup,
  });
}

type Engine = Awaited<ReturnType<typeof wire>>;

async function close(engine: Engine) {
  await Promise.all([
    engine.units.close(),
    engine.plannings.close(),
    engine.notes.close(),
    engine.intakes.close(),
  ]);
}

const CURRICULUM: CurriculumProposal = {
  title: "Calculus I",
  units: [
    {
      id: "limits",
      title: "Limits",
      goal: "Compute limits.",
      prerequisites: [],
    },
  ],
  style: "Short.",
  background: "The learner knows algebra.",
};

async function makeCourse(dataRoot: DataRoot, backend: BackendName) {
  const { id } = await dataRoot.createCourse({
    title: CURRICULUM.title,
    backend,
  });
  await dataRoot.saveProposal(id, CURRICULUM);
  await dataRoot.approveCurriculum(id, CURRICULUM);
  return id;
}

async function opened(engine: Engine, courseId: string): Promise<UnitChat> {
  const result = await engine.units.open(courseId, "limits");
  if (!result.ok) throw new Error(result.error);
  await result.chat.settled();
  return result.chat;
}

/**
 * Answers the segment's check, every answer right: a message first while
 * the first question is open, which the help judge judges. Returns the id
 * of the last written question answered.
 */
async function check(dataRoot: DataRoot, courseId: string, chat: UnitChat) {
  const position = async () =>
    (await dataRoot.readState(courseId)).units.limits;
  let asked = false;
  let written: string | undefined;
  for (
    let at = await position();
    at?.phase === "check" || at?.assessment?.stage === "on";
    at = await position()
  ) {
    const open = at.openQuestion;
    if (open === undefined) throw new Error("No question is open.");
    if (!asked) {
      expect(chat.say("What does $h$ mean?")).toEqual({ ok: true });
      await chat.settled();
      asked = true;
    }
    if (open.question.kind === "written") written = open.id;
    expect(
      await chat.answer(
        open.question.kind === "choice"
          ? {
              kind: "choice",
              questionId: open.id,
              choice: open.question.answer,
              confidence: "90",
            }
          : {
              kind: "written",
              questionId: open.id,
              text: "Because it is so.",
              confidence: "90",
            },
      ),
    ).toEqual({ ok: true });
    await chat.settled();
  }
  return written;
}

/**
 * Every role of a course on the server, with a restart between its unit's
 * segments: the unit planned and taught, its checks answered, its gate
 * taken, a grade disputed, its notes written, and the course's planning
 * conversation.
 */
async function walk(
  backend: BackendName,
  claude: TutorBackend,
  sessionBackends: SessionBackends,
) {
  let dataRoot = openDataRoot({ path: dir });
  const courseId = await makeCourse(dataRoot, backend);
  let engine = await wire(dataRoot, claude, sessionBackends);
  let chat = await opened(engine, courseId);
  expect(await chat.ready()).toEqual({ ok: true });
  await chat.settled();
  await check(dataRoot, courseId, chat);
  expect((await dataRoot.readState(courseId)).units.limits?.phase).toBe(
    "closed",
  );

  // A restart: the reopened unit resumes its tutor's session.
  await close(engine);
  dataRoot = openDataRoot({ path: dir });
  engine = await wire(dataRoot, claude, sessionBackends);
  chat = await opened(engine, courseId);
  expect(await chat.nextSegment()).toEqual({ ok: true });
  await chat.settled();
  expect(await chat.ready()).toEqual({ ok: true });
  await chat.settled();
  const written = await check(dataRoot, courseId, chat);
  if (written === undefined) throw new Error("No written question was asked.");
  expect(await chat.startAssessment()).toEqual({ ok: true });
  await chat.settled();
  await check(dataRoot, courseId, chat);
  expect((await dataRoot.readState(courseId)).units.limits).toBeUndefined();

  expect(
    await engine.disputes.raise(courseId, written, "I think it was right."),
  ).toMatchObject({ ok: true });
  expect(
    await engine.notes.start(courseId, "limits", "", undefined),
  ).toMatchObject({ ok: true });
  await engine.notes.settled();
  const planning = await engine.plannings.open(courseId);
  if (!planning.ok) throw new Error(planning.error);
  expect(planning.planning.say("What comes next?")).toEqual({ ok: true });
  await planning.planning.settled();
  await close(engine);
}

/** Each kind of call made, once. */
const kinds = (calls: readonly string[]) => new Set(calls);

const SESSIONS = ["start unit-planner", "start tutor", "has", "resume tutor"];
const OTHERS = [
  "oneShot help-judge",
  "oneShot grader",
  "oneShot handoff",
  "oneShot dispute-judge",
  "oneShot notes",
  "start course-planner",
];

test("a Codex course's tutor sessions, resumes and unit planning run on Codex, and every other role on Claude", async () => {
  const claudeCalls: string[] = [];
  const codexCalls: string[] = [];
  const claude = recorded(claudeCalls);
  // No oneShot: no role but the tutor and the unit planner may reach it.
  const { startSession, hasSession } = recorded(codexCalls);
  await walk("codex", claude, { codex: { startSession, hasSession } });

  expect(kinds(codexCalls)).toEqual(new Set(SESSIONS));
  expect(kinds(claudeCalls)).toEqual(new Set(OTHERS));
});

test("a Claude course runs every role on Claude and never reaches Codex", async () => {
  const claudeCalls: string[] = [];
  const codexCalls: string[] = [];
  const claude = recorded(claudeCalls);
  await walk("claude", claude, { codex: recorded(codexCalls) });

  expect(codexCalls).toEqual([]);
  expect(kinds(claudeCalls)).toEqual(new Set([...SESSIONS, ...OTHERS]));
});

test("a unit of a course whose backend the server lacks fails to open with the reason, and starts no session", async () => {
  const claudeCalls: string[] = [];
  const claude = recorded(claudeCalls);
  const dataRoot = openDataRoot({ path: dir });
  const courseId = await makeCourse(dataRoot, "codex");
  const engine = await wire(dataRoot, claude, {}, async () => {
    throw new Error("No availability check is needed without a backend.");
  });

  const chat = await opened(engine, courseId);
  const reason = "This course runs on Codex, which this server cannot run.";
  expect(chat.events().at(-1)).toEqual({ type: "unit_failed", error: reason });
  // Refused by the chat before planning, as a planned unit would be too.
  expect(chat.events().map((e) => e.type)).not.toContain("unit_planning");
  // The planner, given the course alone, says the same.
  const planner = createUnitPlanner({
    backends: { claude },
    systemPrompt: "Plan.",
    dataRoot,
  });
  expect(await planner.plan(courseId, "limits")).toEqual({
    ok: false,
    problem: "no-backend",
    error: reason,
  });
  expect(claudeCalls).toEqual([]);
  await close(engine);
});

test.each(["unplanned", "planned"] as const)(
  "a Codex course's %s unit can be opened after signing in without restarting",
  async (kind) => {
    const claudeCalls: string[] = [];
    const codexCalls: string[] = [];
    const { startSession, hasSession } = recorded(codexCalls);
    const dataRoot = openDataRoot({ path: dir });
    const courseId = await makeCourse(dataRoot, "codex");
    if (kind === "planned") {
      await dataRoot.storePlan(courseId, "limits", scriptedPlan("limits"));
    }
    const reason =
      "Gauss's Codex home is not signed in.\n" +
      "Run `CODEX_HOME=~/.local/state/gauss/codex mise exec -- codex login`.";
    let unavailable: string | undefined = reason;
    const engine = await wire(
      dataRoot,
      recorded(claudeCalls),
      { codex: { startSession, hasSession } },
      async () => unavailable,
    );

    expect(await engine.units.open(courseId, "limits")).toEqual({
      ok: false,
      status: 409,
      error: `This course runs on Codex. ${reason} After signing in, open the unit again.`,
    });
    expect(engine.units.get(courseId, "limits")).toBeUndefined();
    expect(codexCalls).toEqual([]);
    expect(claudeCalls).toEqual([]);

    unavailable = undefined;
    const reopened = await opened(engine, courseId);
    expect(reopened.events()).toContainEqual(
      expect.objectContaining({ type: "unit_plan" }),
    );
    expect(reopened.events()).toContainEqual(
      expect.objectContaining({ type: "phase", phase: "discuss" }),
    );
    expect(codexCalls).toEqual(
      kind === "planned"
        ? ["start tutor"]
        : ["start unit-planner", "start tutor"],
    );

    unavailable = reason;
    const refusedReopen = await engine.units.open(courseId, "limits");
    expect(refusedReopen).toMatchObject({
      ok: false,
      status: 409,
      error: expect.stringContaining(reason),
    });
    unavailable = undefined;
    expect(await opened(engine, courseId)).toBe(reopened);
    expect(claudeCalls).toEqual([]);
    await close(engine);
  },
);

test("Review now reports why a Codex unit cannot open", async () => {
  const dataRoot = openDataRoot({ path: dir });
  const courseId = await makeCourse(dataRoot, "codex");
  const plan = scriptedPlan("limits");
  await dataRoot.storePlan(courseId, "limits", plan);
  for (const { id: objective } of plan.objectives) {
    await dataRoot.appendEvidence(courseId, {
      kind: "answer",
      recordedAt: "2020-01-01T00:00:00.000Z",
      objective,
      question: {
        kind: "choice",
        prompt: "What is two plus two?",
        choices: ["Four", "Five"],
        answer: "A",
      },
      answer: {
        kind: "choice",
        questionId: objective,
        choice: "A",
        confidence: "90",
      },
      assisted: false,
      verdict: "correct",
    });
  }
  const reason =
    "Sign in with `CODEX_HOME=~/.local/state/gauss/codex mise exec -- codex login`.";
  const calls: string[] = [];
  const engine = await wire(
    dataRoot,
    recorded(calls),
    { codex: recorded(calls) },
    async () => reason,
  );
  try {
    expect(await engine.units.reviewNow(courseId)).toEqual({
      ok: false,
      status: 409,
      error: `This course runs on Codex. ${reason} After signing in, open the unit again.`,
    });
    expect(calls).toEqual([]);
  } finally {
    await close(engine);
  }
});
