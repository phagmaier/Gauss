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
import { codexUnavailable } from "./backends/codex.ts";
import { resolveDataRoot } from "./record/data-root.ts";
import { serve } from "./serve.ts";

// GAUSS_CLAUDE_MODEL overrides the model for all roles in the normal app.
// Otherwise, the tutor uses the login's default and each helper has its own.
const model = process.env.GAUSS_CLAUDE_MODEL;

await serve({
  // Codex has no adapter yet (plan task 6.14), so a Codex course's units
  // fail to open with the reason.
  sessionBackends: {
    claude: createClaudeBackend(model === undefined ? {} : { model }),
  },
  graderBackend: createClaudeBackend({ model: model ?? GRADER_MODEL }),
  judgeBackend: createClaudeBackend({ model: model ?? JUDGE_MODEL }),
  disputeBackend: createClaudeBackend({ model: model ?? DISPUTE_MODEL }),
  handoffBackend: createClaudeBackend({ model: model ?? HANDOFF_MODEL }),
  notesBackend: createClaudeBackend({ model: model ?? NOTES_MODEL }),
  // Asked when an intake's learner picks Codex: the pinned CLI and Gauss's
  // Codex home signed in. No model is called.
  codexUnavailable: () => codexUnavailable(),
  // GAUSS_DATA_ROOT moves the course record away from ~/gauss (AGENTS.md).
  dataRootPath: resolveDataRoot(),
  port: Number(process.env.GAUSS_PORT ?? 4320),
  // The record's git history (task 2.25); GAUSS_BACKUP=off turns it off.
  backup: process.env.GAUSS_BACKUP !== "off",
});
