// Runs the whole app with no model, for browser checks (plan task 2.12b):
// the same server as `pnpm dev` (`src/server/serve.ts`), on the scripted
// backend (`src/server/backends/scripted.ts`, which says what its tutor does
// and the commands it takes: /hold, /revise, /one-off, /fail) and a scratch
// data root. It never calls a real model and spends no plan usage.
//
//   node scripts/dev-fake.ts [--empty]      (pnpm dev:fake)
//
// The data root is `GAUSS_DATA_ROOT`, or `gauss-fake` in the temporary
// folder; the real data root is refused. A data root with no course in it is
// seeded with courses in each state (`src/server/record/dev-seed.ts`) unless
// `--empty` is given; one that has courses is used as it is, so a restart
// keeps the record. For a fresh seed, point `GAUSS_DATA_ROOT` at a new
// folder. The port is `GAUSS_PORT`, or 4330: not the real server's, so a
// page left open on one never reaches the other.
//
// Close the browser before stopping this server (AGENTS.md).

import { parseArgs } from "node:util";
import {
  createScriptedBackend,
  scriptedPlan,
} from "../src/server/backends/scripted.ts";
import { scratchDataRoot, seedCourses } from "../src/server/record/dev-seed.ts";
import { serve } from "../src/server/serve.ts";

const { values } = parseArgs({ options: { empty: { type: "boolean" } } });

let dataRootPath: string;
try {
  dataRootPath = scratchDataRoot();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
  process.exit(1);
}

if (values.empty !== true) {
  const seeded = await seedCourses({ path: dataRootPath, plan: scriptedPlan });
  process.stdout.write(
    seeded === undefined
      ? "The data root has courses already; they are used as they are.\n"
      : `Seeded ${seeded.length} courses: ${seeded.join(", ")}.\n`,
  );
}

const backend = createScriptedBackend();
process.stdout.write("Scripted backend: no model is called.\n");
await serve({
  // A Codex course's tutor and unit planner run here too, as on Claude.
  sessionBackends: { claude: backend, codex: backend },
  graderBackend: backend,
  judgeBackend: backend,
  disputeBackend: backend,
  handoffBackend: backend,
  notesBackend: backend,
  // A Codex course needs no Codex here: every role runs on the scripted backend.
  codexUnavailable: async () => undefined,
  dataRootPath,
  port: Number(process.env.GAUSS_PORT ?? 4330),
  // Off unless asked for with GAUSS_BACKUP=on (task 2.25).
  backup: process.env.GAUSS_BACKUP === "on",
});
