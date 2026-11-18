// Serves Gauss on one local port: the API on Hono and the page through Vite.
// The engine is wired here once, for `main.ts` on the real backend and for
// `scripts/dev-fake.ts` on the scripted one (task 2.12b), so both run the
// same server and differ only in the backend and the data root.

import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { getRequestListener } from "@hono/node-server";
import { createServer as createViteServer } from "vite";
import type { TutorBackend } from "./backends/backend.ts";
import { createGrader } from "./engine/grading.ts";
import { createHelpJudge } from "./engine/help-judge.ts";
import { createIntakes } from "./engine/intake.ts";
import { createMathCheck } from "./engine/math-check.ts";
import { createPackageInstaller, projectPython } from "./engine/packages.ts";
import { startSandbox } from "./engine/sandbox.ts";
import { createUnitChats } from "./engine/unit-chat.ts";
import { createUnitPlanner } from "./engine/unit-planning.ts";
import { createApp } from "./http/app.ts";
import { noBackup, startBackup } from "./record/backup.ts";
import { openDataRoot } from "./record/data-root.ts";

const root = new URL("../../", import.meta.url);
const host = "127.0.0.1";

/**
 * Starts the server and says where it runs and where its record is. It runs
 * until the process is interrupted, and then closes every session.
 */
export async function serve(options: {
  /** Runs the intakes, the planning of units and their tutors. */
  backend: TutorBackend;
  /** Grades written answers, and math answers the symbolic check does not settle. */
  graderBackend: TutorBackend;
  /** Judges whether a reply during an open question was help (task 2.21). */
  judgeBackend: TutorBackend;
  dataRootPath: string;
  port: number;
  /** Keeps the record's history in git (task 2.25). */
  backup: boolean;
}): Promise<void> {
  const { backend, dataRootPath, port } = options;
  const prompt = (name: string) =>
    readFile(new URL(`prompts/${name}`, root), "utf8");
  const [
    plannerPrompt,
    unitPlannerPrompt,
    tutorPrompt,
    graderPrompt,
    judgePrompt,
  ] = await Promise.all([
    prompt("planner.md"),
    prompt("unit-planner.md"),
    prompt("tutor.md"),
    prompt("grader.md"),
    prompt("help-judge.md"),
  ]);
  const dataRoot = openDataRoot({ path: dataRootPath });
  // The engine's commands run in it (task 3.2); it says once if it cannot,
  // and tutors then get no file and shell tools, and math questions are
  // refused with the reason.
  const sandbox = await startSandbox({
    log: (line) => process.stdout.write(`${line}\n`),
  });
  const backup = options.backup
    ? await startBackup({
        path: dataRootPath,
        log: (line) => process.stdout.write(`${line}\n`),
      })
    : noBackup;
  const intakes = createIntakes({
    backend,
    systemPrompt: plannerPrompt,
    dataRoot,
    backup,
  });
  const planner = createUnitPlanner({
    backend,
    systemPrompt: unitPlannerPrompt,
    dataRoot,
  });
  const units = createUnitChats({
    backend,
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
    mathCheck: createMathCheck({ sandbox }),
    // Tutors run commands only where the sandbox runs (task 3.3), and ask
    // for packages only where they can be installed. The install cache is
    // separate from the old workspace-based installer's cache and the backup.
    workspaceTools: sandbox.available,
    ...(sandbox.available
      ? {
          installer: createPackageInstaller({
            dataRoot,
            run: sandbox.run,
            cacheFolder: resolve(dataRootPath, "cache", "package-uv"),
            python: await projectPython(),
          }),
        }
      : {}),
  });
  const api = getRequestListener(createApp({ dataRoot, intakes, units }).fetch);

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
    await Promise.allSettled([intakes.close(), units.close(), vite.close()]);
    await Promise.allSettled([backup.settled(), sandbox.close()]);
    server.close();
    process.exit(0);
  }
  process.once("SIGINT", () => void shutDown());
  process.once("SIGTERM", () => void shutDown());
}
