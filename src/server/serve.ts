// Serves Gauss on one local port: the API on Hono and the page through Vite.
// The engine is wired here once (`wireEngine`), for `main.ts` on the real
// backends and for `scripts/dev-fake.ts` on the scripted one (task 2.12b),
// so both run the same server and differ only in the backends and the data
// root.

import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { getRequestListener } from "@hono/node-server";
import { createServer as createViteServer } from "vite";
import type {
  SessionBackend,
  SessionBackends,
  TutorBackend,
} from "./backends/backend.ts";
import { createCodeRunner } from "./engine/code-run.ts";
import { createCoursePlannings } from "./engine/course-planning.ts";
import { createDisputeJudge } from "./engine/dispute-judge.ts";
import { createDisputes } from "./engine/disputes.ts";
import { createGrader } from "./engine/grading.ts";
import { createHandoffWriter } from "./engine/handoff.ts";
import { createHelpJudge } from "./engine/help-judge.ts";
import { createIntakes } from "./engine/intake.ts";
import { createMathCheck } from "./engine/math-check.ts";
import { createNotes } from "./engine/notes.ts";
import { createPackageInstaller } from "./engine/packages.ts";
import { type Sandbox, startSandbox } from "./engine/sandbox.ts";
import { createSourceConverter } from "./engine/source-convert.ts";
import { splitTutorPrompt } from "./engine/teaching.ts";
import { createUnitChats } from "./engine/unit-chat.ts";
import { createUnitPlanner } from "./engine/unit-planning.ts";
import { createApp } from "./http/app.ts";
import { systemOpener } from "./open-file.ts";
import { type Backup, noBackup, startBackup } from "./record/backup.ts";
import { type DataRoot, openDataRoot } from "./record/data-root.ts";
import { projectPython } from "./sandbox-command.ts";

const root = new URL("../../", import.meta.url);
const host = "127.0.0.1";

/** What runs each model role, and how the engine checks Codex availability. */
export interface EngineBackends {
  /**
   * The session backends by name (`Course.backend`). A course's tutors and
   * unit planner run on its own; the intakes and the courses' planning
   * conversations on Claude (brief.md, "Backends and stack"). A course whose
   * backend is absent does not open its units.
   */
  sessionBackends: SessionBackends & { claude: SessionBackend };
  /** Grades written answers, and math answers the symbolic check does not settle. */
  graderBackend: TutorBackend;
  /** Judges whether a reply during an open question was help (task 2.21). */
  judgeBackend: TutorBackend;
  /** Decides disputes of answers' grades (task 3.8). */
  disputeBackend: TutorBackend;
  /** Writes handoff notes and finds misconceptions (task 5.7). */
  handoffBackend: TutorBackend;
  /** Writes the learner's standalone unit notes. */
  notesBackend: TutorBackend;
  /**
   * Why a course cannot run on Codex now, or undefined when it can; the
   * engine asks when the learner picks Codex or loads a Codex unit.
   */
  codexUnavailable: () => Promise<string | undefined>;
}

/**
 * Starts the server and says where it runs and where its record is. It runs
 * until the process is interrupted, and then closes every session.
 */
export async function serve(
  options: EngineBackends & {
    dataRootPath: string;
    port: number;
    /** Keeps the record's history in git (task 2.25). */
    backup: boolean;
  },
): Promise<void> {
  const { dataRootPath, port } = options;
  const dataRoot = openDataRoot({ path: dataRootPath });
  // The first use of the record, before the recovery below writes and
  // before any chat or route exists, so no write of this server is running.
  await dataRoot.clearInterruptedWrites((line) =>
    process.stdout.write(`${line}\n`),
  );
  // Recover a first proposal before taking the startup snapshot. An intake
  // that had not made a proposal ends with the server, along with its uploads.
  await dataRoot.clearUploads();
  // The engine's commands run in it (task 3.2); it says once if it cannot,
  // and tutors then get no file and shell tools, and math and code
  // questions are refused with the reason. Its commands read nothing in
  // the data root but what they are given.
  const sandbox = await startSandbox({
    log: (line) => process.stdout.write(`${line}\n`),
    dataRoot: dataRootPath,
  });
  const backup = options.backup
    ? await startBackup({
        path: dataRootPath,
        stageSnapshot: dataRoot.withConsistentSnapshot,
        log: (line) => process.stdout.write(`${line}\n`),
      })
    : noBackup;
  const { converter, intakes, plannings, units, disputes, notes } =
    await wireEngine({ ...options, dataRoot, sandbox, backup });
  const api = getRequestListener(
    createApp({
      dataRoot,
      converter,
      intakes,
      plannings,
      units,
      disputes,
      notes,
      openFile: systemOpener(),
      backup,
    }).fetch,
  );

  const server = createServer();
  const vite = await createViteServer({
    configFile: new URL("vite.config.ts", root).pathname,
    server: { middlewareMode: { server }, hmr: { server } },
  });
  server.on("request", (req, res) => {
    if (req.url?.startsWith("/api/")) {
      void api(req, res);
    } else {
      vite.middlewares(req, res);
    }
  });
  server.listen(port, host, () => {
    process.stdout.write(
      `Gauss is running at http://localhost:${port}/ with its record in ${dataRootPath}\n`,
    );
  });

  async function shutDown(): Promise<void> {
    server.closeAllConnections();
    await Promise.allSettled([
      intakes.close(),
      plannings.close(),
      units.close(),
      notes.close(),
      vite.close(),
    ]);
    await Promise.allSettled([backup.settled(), sandbox.close()]);
    server.close();
    process.exit(0);
  }
  process.once("SIGINT", () => void shutDown());
  process.once("SIGTERM", () => void shutDown());
}

/**
 * The engine on an open record, each role on its backend and given its
 * prompt from `prompts/`; what the routes take.
 */
export async function wireEngine(
  options: EngineBackends & {
    dataRoot: DataRoot;
    dataRootPath: string;
    sandbox: Sandbox;
    backup: Backup;
  },
) {
  const { sessionBackends, dataRoot, dataRootPath, sandbox, backup } = options;
  const prompt = (name: string) =>
    readFile(new URL(`prompts/${name}`, root), "utf8");
  const [
    plannerPrompt,
    unitPlannerPrompt,
    tutorPrompt,
    graderPrompt,
    judgePrompt,
    disputePrompt,
    handoffPrompt,
    notesPrompt,
    coursePlannerPrompt,
  ] = await Promise.all([
    prompt("planner.md"),
    prompt("unit-planner.md"),
    prompt("tutor.md"),
    prompt("grader.md"),
    prompt("help-judge.md"),
    prompt("dispute-judge.md"),
    prompt("handoff.md"),
    prompt("notes.md"),
    prompt("course-planner.md"),
  ]);
  // The learner's teaching instructions replace the paragraph between the
  // tutor prompt's marks; without them there would be nothing to replace.
  if (splitTutorPrompt(tutorPrompt).shipped === undefined) {
    throw new Error(
      "prompts/tutor.md has lost the marks around the learner's paragraph.",
    );
  }
  // Without the sandbox, attaching a source and rendering a page for
  // view_page are refused with the reason.
  const converter = createSourceConverter({ sandbox });
  const intakes = createIntakes({
    backend: sessionBackends.claude,
    systemPrompt: plannerPrompt,
    dataRoot,
    backup,
    converter,
    codexUnavailable: options.codexUnavailable,
  });
  const planner = createUnitPlanner({
    backends: sessionBackends,
    systemPrompt: unitPlannerPrompt,
    dataRoot,
  });
  const units = createUnitChats({
    backends: sessionBackends,
    codexUnavailable: options.codexUnavailable,
    systemPrompt: tutorPrompt,
    dataRoot,
    backup,
    planner,
    grader: createGrader({
      backend: options.graderBackend,
      systemPrompt: graderPrompt,
    }),
    judge: createHelpJudge({
      backend: options.judgeBackend,
      systemPrompt: judgePrompt,
    }),
    handoff: createHandoffWriter({
      backend: options.handoffBackend,
      systemPrompt: handoffPrompt,
    }),
    mathCheck: createMathCheck({ sandbox }),
    codeRunner: createCodeRunner({ sandbox }),
    converter,
    // Tutors run commands only where the sandbox runs (task 3.3), reading
    // as its commands do (a Codex tutor's commands run in it), and ask for
    // packages only where they can be installed. The install cache is
    // separate from the old workspace-based installer's cache and the backup.
    ...(sandbox.available
      ? {
          workspaceTools: { reads: sandbox.reads, run: sandbox.run },
          installer: createPackageInstaller({
            dataRoot,
            run: sandbox.run,
            cacheFolder: resolve(dataRootPath, "cache", "package-uv"),
            python: await projectPython(),
          }),
        }
      : {}),
  });
  const plannings = createCoursePlannings({
    backend: sessionBackends.claude,
    systemPrompt: coursePlannerPrompt,
    dataRoot,
    units,
    backup,
  });
  const disputes = createDisputes({
    dataRoot,
    units,
    judge: createDisputeJudge({
      backend: options.disputeBackend,
      systemPrompt: disputePrompt,
    }),
  });
  const notes = createNotes({
    dataRoot,
    backend: options.notesBackend,
    systemPrompt: notesPrompt,
    ready: (courseId, unitId) =>
      units.get(courseId, unitId)?.settleNotesContext(),
    backup,
  });
  return { converter, intakes, plannings, units, disputes, notes };
}
