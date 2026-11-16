// Serves Gauss on one local port: the API on Hono and the page through Vite.
// The engine is wired here once, for `main.ts` on the real backend and for
// `scripts/dev-fake.ts` on the scripted one (task 2.12b), so both run the
// same server and differ only in the backend and the data root.

import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { getRequestListener } from "@hono/node-server";
import { createServer as createViteServer } from "vite";
import type { TutorBackend } from "./backends/backend.ts";
import { createGrader } from "./engine/grading.ts";
import { createIntakes } from "./engine/intake.ts";
import { createUnitChats } from "./engine/unit-chat.ts";
import { createUnitPlanner } from "./engine/unit-planning.ts";
import { createApp } from "./http/app.ts";
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
  /** Grades written answers. */
  graderBackend: TutorBackend;
  dataRootPath: string;
  port: number;
}): Promise<void> {
  const { backend, dataRootPath, port } = options;
  const prompt = (name: string) =>
    readFile(new URL(`prompts/${name}`, root), "utf8");
  const [plannerPrompt, unitPlannerPrompt, tutorPrompt, graderPrompt] =
    await Promise.all([
      prompt("planner.md"),
      prompt("unit-planner.md"),
      prompt("tutor.md"),
      prompt("grader.md"),
    ]);
  const dataRoot = openDataRoot({ path: dataRootPath });
  const intakes = createIntakes({
    backend,
    systemPrompt: plannerPrompt,
    dataRoot,
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
    planner,
    grader: createGrader({
      backend: options.graderBackend,
      systemPrompt: graderPrompt,
    }),
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
    server.close();
    process.exit(0);
  }
  process.once("SIGINT", () => void shutDown());
  process.once("SIGTERM", () => void shutDown());
}
