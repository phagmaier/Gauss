// Starts Gauss: the API on Hono and the page through Vite, on one local port.
// Run with `pnpm dev` inside mise.

import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { getRequestListener } from "@hono/node-server";
import { createServer as createViteServer } from "vite";
import { createClaudeBackend, GRADER_MODEL } from "./backends/claude.ts";
import { createGrader } from "./engine/grading.ts";
import { createIntakes } from "./engine/intake.ts";
import { createUnitChats } from "./engine/unit-chat.ts";
import { createUnitPlanner } from "./engine/unit-planning.ts";
import { createApp } from "./http/app.ts";
import { openDataRoot, resolveDataRoot } from "./record/data-root.ts";

const root = new URL("../../", import.meta.url);
const port = Number(process.env.GAUSS_PORT ?? 4320);
const host = "127.0.0.1";

const prompt = (name: string) =>
  readFile(new URL(`prompts/${name}`, root), "utf8");
const [plannerPrompt, unitPlannerPrompt, tutorPrompt, graderPrompt] =
  await Promise.all([
    prompt("planner.md"),
    prompt("unit-planner.md"),
    prompt("tutor.md"),
    prompt("grader.md"),
  ]);
// GAUSS_DATA_ROOT moves the course record away from ~/gauss (AGENTS.md).
const dataRootPath = resolveDataRoot();
const dataRoot = openDataRoot({ path: dataRootPath });
// GAUSS_CLAUDE_MODEL picks a cheap model for development runs (AGENTS.md),
// for every session, the grader's included. Left unset, the sessions use the
// learner's Claude Code default, and the grader its own model (task 2.9).
const model = process.env.GAUSS_CLAUDE_MODEL;
const backend = createClaudeBackend(model === undefined ? {} : { model });
const graderBackend = createClaudeBackend({ model: model ?? GRADER_MODEL });
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
  grader: createGrader({ backend: graderBackend, systemPrompt: graderPrompt }),
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
