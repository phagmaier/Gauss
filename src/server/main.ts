// Starts Gauss on the real backend. Run with `pnpm dev` inside mise. The
// server itself is in `serve.ts`.

import { createClaudeBackend, GRADER_MODEL } from "./backends/claude.ts";
import { resolveDataRoot } from "./record/data-root.ts";
import { serve } from "./serve.ts";

// GAUSS_CLAUDE_MODEL picks a cheap model for development runs (AGENTS.md),
// for every session, the grader's included. Left unset, the sessions use the
// learner's Claude Code default, and the grader its own model (task 2.9).
const model = process.env.GAUSS_CLAUDE_MODEL;

await serve({
  backend: createClaudeBackend(model === undefined ? {} : { model }),
  graderBackend: createClaudeBackend({ model: model ?? GRADER_MODEL }),
  // GAUSS_DATA_ROOT moves the course record away from ~/gauss (AGENTS.md).
  dataRootPath: resolveDataRoot(),
  port: Number(process.env.GAUSS_PORT ?? 4320),
});
