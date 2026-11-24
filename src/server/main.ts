// Starts Gauss on the real backend. Run with `pnpm dev` inside mise. The
// server itself is in `serve.ts`.

import {
  createClaudeBackend,
  DISPUTE_MODEL,
  GRADER_MODEL,
  HANDOFF_MODEL,
  JUDGE_MODEL,
  NOTES_MODEL,
} from "./backends/claude.ts";
import { codexUnavailable, createCodexBackend } from "./backends/codex.ts";
import { resolveDataRoot } from "./record/data-root.ts";
import { serve } from "./serve.ts";

// GAUSS_CLAUDE_MODEL overrides the model for all roles in the normal app.
// Otherwise, the tutor uses the login's default and each helper has its own.
const model = process.env.GAUSS_CLAUDE_MODEL;

await serve({
  sessionBackends: {
    claude: createClaudeBackend(model === undefined ? {} : { model }),
    codex: createCodexBackend(),
  },
  graderBackend: createClaudeBackend({ model: model ?? GRADER_MODEL }),
  judgeBackend: createClaudeBackend({ model: model ?? JUDGE_MODEL }),
  disputeBackend: createClaudeBackend({ model: model ?? DISPUTE_MODEL }),
  handoffBackend: createClaudeBackend({ model: model ?? HANDOFF_MODEL }),
  notesBackend: createClaudeBackend({ model: model ?? NOTES_MODEL }),
  codexUnavailable,
  // GAUSS_DATA_ROOT moves the course record away from ~/gauss (AGENTS.md).
  dataRootPath: resolveDataRoot(),
  port: Number(process.env.GAUSS_PORT ?? 4320),
  // The record's git history (task 2.25); GAUSS_BACKUP=off turns it off.
  backup: process.env.GAUSS_BACKUP !== "off",
});
