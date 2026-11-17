// Judges the hand-judged set (`scripts/help-set.ts`) through `createHelpJudge`
// and the Claude backend's `oneShot`, as the app does, and prints each call
// beside the hand verdict (plan task 2.21). It calls a real model and spends
// plan usage: run it by hand when `prompts/help-judge.md`, the judgment's
// schema or the judge's model changes, never from a test.
//
//   node scripts/judge-set.ts [--model <id>] [--runs <n>] [--prompt <file>]
//                             [--only <id>,<id>]
//
// The model defaults to the judge's (`JUDGE_MODEL`), the prompt to
// `prompts/help-judge.md`, and `--only` picks exchanges by id.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  createClaudeBackend,
  JUDGE_MODEL,
} from "../src/server/backends/claude.ts";
import {
  createHelpJudge,
  type HelpOutcome,
} from "../src/server/engine/help-judge.ts";
import { type HandJudgedExchange, HELP_SET } from "./help-set.ts";

const { values } = parseArgs({
  options: {
    model: { type: "string" },
    runs: { type: "string", default: "1" },
    prompt: { type: "string" },
    only: { type: "string" },
  },
});
const runs = Number(values.runs);
if (!Number.isInteger(runs) || runs < 1) {
  throw new Error(`--runs takes a whole number from 1: ${values.runs}`);
}
const only = values.only?.split(",");
const unknown = only?.filter((id) => !HELP_SET.some((e) => e.id === id));
if (unknown !== undefined && unknown.length > 0) {
  throw new Error(`No exchange in the set has the id ${unknown.join(", ")}`);
}
const items =
  only === undefined
    ? HELP_SET
    : HELP_SET.filter((item) => only.includes(item.id));
const promptFile =
  values.prompt ??
  fileURLToPath(new URL("../prompts/help-judge.md", import.meta.url));
const systemPrompt = await readFile(promptFile, "utf8");
const model = values.model ?? JUDGE_MODEL;
const judge = createHelpJudge({
  backend: createClaudeBackend({ model }),
  systemPrompt,
});

/** How many judgings run at once: each is a Claude Code process. */
const AT_ONCE = 4;

for (let run = 1; run <= runs; run++) {
  const results: {
    item: HandJudgedExchange;
    outcome: HelpOutcome;
    seconds: number;
  }[] = [];
  for (let i = 0; i < items.length; i += AT_ONCE) {
    const batch = items.slice(i, i + AT_ONCE);
    results.push(
      ...(await Promise.all(
        batch.map(async (item) => {
          const start = performance.now();
          const outcome = await judge.judge(item);
          return { item, outcome, seconds: (performance.now() - start) / 1000 };
        }),
      )),
    );
  }

  let agree = 0;
  process.stdout.write(
    `\n=== Run ${run} of ${runs} (${model}, ${promptFile}) ===\n`,
  );
  for (const { item, outcome, seconds } of results) {
    const verdict = outcome.ok ? outcome.verdict : "failed";
    const same = verdict === item.verdict;
    if (same) agree++;
    process.stdout.write(
      `\n${item.id} (${item.tests}): hand ${item.verdict}, judge ${verdict}` +
        ` ${same ? "AGREE" : "DISAGREE"}, ${seconds.toFixed(1)} s\n`,
    );
    process.stdout.write(
      outcome.ok
        ? `  reason: ${outcome.reason}\n`
        : `  error: ${outcome.error}\n`,
    );
  }
  process.stdout.write(
    `\nRun ${run}: ${agree} of ${results.length} verdicts agree\n`,
  );
}
