// The options that keep the learner's own Claude Code setup out of a tutor
// session and keep it on the plan login, as found in plan tasks 0.2 and 0.3.
// Throwaway spike code; task 1.3 builds the real backend from the findings in
// docs/decisions.md.

import type { Options } from "@anthropic-ai/claude-agent-sdk";

export function isolatedOptions(): Options {
  const env: Record<string, string | undefined> = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  return {
    settingSources: [],
    skills: [],
    settings: { autoMemoryEnabled: false, disableClaudeAiConnectors: true },
    strictMcpConfig: true,
    env,
  };
}

export function note(label: string, value?: unknown): void {
  const body = value === undefined ? "" : ` ${JSON.stringify(value, null, 2)}`;
  process.stdout.write(`\n[${label}]${body}\n`);
}
