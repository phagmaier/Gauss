// Starts Gauss on the real backend. Run with `pnpm dev` inside mise. The
// server itself is in `serve.ts`.

import {
  createClaudeBackend,
  DISPUTE_MODEL,
  GRADER_MODEL,
  JUDGE_MODEL,
} from "./backends/claude.ts";
import { resolveDataRoot } from "./record/data-root.ts";
import { serve } from "./serve.ts";

// GAUSS_CLAUDE_MODEL picks a cheap model for development runs (AGENTS.md),
// for every session, the grader's and the judges' included. Left unset, the
// sessions use the learner's Claude Code default, and the grader, the help
// judge and the dispute judge their own models (tasks 2.9, 2.21 and 3.8).
const model = process.env.GAUSS_CLAUDE_MODEL;

await serve({
  backend: createClaudeBackend(model === undefined ? {} : { model }),
  graderBackend: createClaudeBackend({ model: model ?? GRADER_MODEL }),
  judgeBackend: createClaudeBackend({ model: model ?? JUDGE_MODEL }),
  disputeBackend: createClaudeBackend({ model: model ?? DISPUTE_MODEL }),
  // GAUSS_DATA_ROOT moves the course record away from ~/gauss (AGENTS.md).
  dataRootPath: resolveDataRoot(),
  port: Number(process.env.GAUSS_PORT ?? 4320),
  // The record's git history (task 2.25); GAUSS_BACKUP=off turns it off.
  backup: process.env.GAUSS_BACKUP !== "off",
});
