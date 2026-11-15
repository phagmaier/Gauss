// Starts Gauss: the API on Hono and the page through Vite, on one local port.
// Run with `pnpm dev` inside mise.

import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { getRequestListener } from "@hono/node-server";
import { createServer as createViteServer } from "vite";
import { createClaudeBackend } from "./backends/claude.ts";
import { createIntakes } from "./engine/intake.ts";
import { createApp } from "./http/app.ts";
import { openDataRoot, resolveDataRoot } from "./record/data-root.ts";

const root = new URL("../../", import.meta.url);
const port = Number(process.env.GAUSS_PORT ?? 4320);
const host = "127.0.0.1";

const systemPrompt = await readFile(
  new URL("prompts/planner.md", root),
  "utf8",
);
// GAUSS_DATA_ROOT moves the course record away from ~/gauss (AGENTS.md).
const dataRootPath = resolveDataRoot();
const dataRoot = openDataRoot({ path: dataRootPath });
// GAUSS_CLAUDE_MODEL picks a cheap model for development runs (AGENTS.md).
const model = process.env.GAUSS_CLAUDE_MODEL;
const backend = createClaudeBackend(model === undefined ? {} : { model });
const intakes = createIntakes({ backend, systemPrompt, dataRoot });
const api = getRequestListener(createApp({ dataRoot, intakes }).fetch);

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
  await Promise.allSettled([intakes.close(), vite.close()]);
  server.close();
  process.exit(0);
}
process.once("SIGINT", () => void shutDown());
process.once("SIGTERM", () => void shutDown());
