// Grades the hand-graded set (`scripts/grader-set.ts`) through `createGrader`
// and the Claude backend's `oneShot`, as the app does, and prints each grade
// beside the hand grade (plan task 2.9). It calls a real model and spends
// plan usage: run only an authorized check (AGENTS.md), never from a test.
//
//   mise exec -- pnpm check:live node scripts/grade-set.ts --runs 2
//
// The prompt defaults to `prompts/grader.md`; `--only` picks answers by id.
//
// Whether the verdicts agree is counted here. Whether a flaw names the right
// step is for the reader to judge, so the hand-written flaw is printed with
// the grader's.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  createClaudeBackend,
  LIVE_CHECK_OPTIONS,
} from "../src/server/backends/claude.ts";
import {
  createGrader,
  type WrittenOutcome,
} from "../src/server/engine/grading.ts";
import { GRADER_SET, type HandGradedAnswer } from "./grader-set.ts";

const { values } = parseArgs({
  options: {
    runs: { type: "string", default: "1" },
    prompt: { type: "string" },
    only: { type: "string" },
  },
});
// Only the launcher's pinned model and effort may run here (AGENTS.md).
if (process.env.GAUSS_LIVE_CHECK !== "1") {
  throw new Error(
    "Run this through `mise exec -- pnpm check:live` (AGENTS.md).",
  );
}
const runs = Number(values.runs);
if (!Number.isInteger(runs) || runs < 1) {
  throw new Error(`--runs takes a whole number from 1: ${values.runs}`);
}
const only = values.only?.split(",");
const unknown = only?.filter((id) => !GRADER_SET.some((a) => a.id === id));
if (unknown !== undefined && unknown.length > 0) {
  throw new Error(`No answer in the set has the id ${unknown.join(", ")}`);
}
const items =
  only === undefined
    ? GRADER_SET
    : GRADER_SET.filter((item) => only.includes(item.id));
const promptFile =
  values.prompt ??
  fileURLToPath(new URL("../prompts/grader.md", import.meta.url));
const systemPrompt = await readFile(promptFile, "utf8");
const model = `${LIVE_CHECK_OPTIONS.model}, ${LIVE_CHECK_OPTIONS.effort} effort`;
const grader = createGrader({
  backend: createClaudeBackend(),
  systemPrompt,
});

/** How many gradings run at once: each is a Claude Code process. */
const AT_ONCE = 4;

for (let run = 1; run <= runs; run++) {
  const results: {
    item: HandGradedAnswer;
    outcome: WrittenOutcome;
    seconds: number;
  }[] = [];
  for (let i = 0; i < items.length; i += AT_ONCE) {
    const batch = items.slice(i, i + AT_ONCE);
    results.push(
      ...(await Promise.all(
        batch.map(async (item) => {
          const start = performance.now();
          const outcome = await grader.grade(item.question, item.answer);
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
    const same = verdict === item.grade;
    if (same) agree++;
    process.stdout.write(
      `\n${item.id} (${item.tests}): hand ${item.grade}, grader ${verdict}` +
        ` ${same ? "AGREE" : "DISAGREE"}, ${seconds.toFixed(1)} s\n`,
    );
    if (!outcome.ok) process.stdout.write(`  error: ${outcome.error}\n`);
    if (item.flaw !== undefined)
      process.stdout.write(`  hand flaw:   ${item.flaw}\n`);
    if (outcome.ok && outcome.flaw !== undefined) {
      process.stdout.write(`  grader flaw: ${outcome.flaw}\n`);
    }
  }
  process.stdout.write(
    `\nRun ${run}: ${agree} of ${results.length} verdicts agree\n`,
  );
}
