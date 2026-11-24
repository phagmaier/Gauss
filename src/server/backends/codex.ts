// The model and effort a Codex session runs on, and the live-check pin
// (docs/findings.md, "Codex").

export interface CodexBackendOptions {
  /** The model, such as "gpt-6.2-sol". Left out, the login's default. */
  model?: string;
  /**
   * The reasoning effort, such as "medium". Left out, the model's default.
   * A resume can fall back to the effort the thread saved, or to none, so
   * a caller gives both on every `turn/start` (docs/findings.md, "Codex").
   */
  effort?: string;
}

/** The one model and effort a live check runs Codex on (AGENTS.md). */
export const CODEX_LIVE_CHECK_OPTIONS = {
  model: "gpt-6.2-sol",
  effort: "medium",
} as const satisfies CodexBackendOptions;

/**
 * The model and effort Codex runs on: under the live-check launcher always
 * the pinned ones, whatever the caller asks for, so that a trial or an older
 * harness cannot run another model or effort.
 */
export function codexOptions(
  requested: CodexBackendOptions = {},
): CodexBackendOptions {
  return process.env.GAUSS_LIVE_CHECK === "1"
    ? CODEX_LIVE_CHECK_OPTIONS
    : requested;
}
