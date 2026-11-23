// Decides the dispute judge's hand-judged set (`scripts/dispute-set.ts`)
// through `createDisputeJudge` and the Claude backend's `oneShot`, as the app
// does, and prints each outcome beside the hand outcome (plan task 3.9). It
// calls a real model and spends plan usage: run only an authorized check
// (AGENTS.md), never from a test.
//
//   mise exec -- pnpm check:live node scripts/decide-set.ts --runs 2
//
// The prompt defaults to `prompts/dispute-judge.md`; `--only` picks disputes by id.
//
// An outcome agrees when its verdict is the hand verdict, a choice
// question's right letter is the hand key, and a math question's expected
// answer is corrected exactly when the hand outcome corrects it. Whether a
// corrected expected answer is right, and whether the reason says what is
// wrong, is for the reader to judge, so both are printed.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  createClaudeBackend,
  LIVE_CHECK_OPTIONS,
} from "../src/server/backends/claude.ts";
import {
  createDisputeJudge,
  type DisputeDecision,
} from "../src/server/engine/dispute-judge.ts";
import type { DisputeOutcome } from "../src/shared/dispute.ts";
import { DISPUTE_SET, type HandJudgedDispute } from "./dispute-set.ts";

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
const malformed = DISPUTE_SET.filter(
  ({ entry: { question }, key, expected }) =>
    (question.kind === "choice") !== (key !== undefined) ||
    (question.kind !== "math" && expected !== undefined),
);
if (malformed.length > 0) {
  throw new Error(
    `A hand outcome gives a key exactly for a choice question, and an expected answer only for a math one: ${malformed.map((d) => d.id).join(", ")}`,
  );
}
const only = values.only?.split(",");
const unknown = only?.filter((id) => !DISPUTE_SET.some((d) => d.id === id));
if (unknown !== undefined && unknown.length > 0) {
  throw new Error(`No dispute in the set has the id ${unknown.join(", ")}`);
}
const items =
  only === undefined
    ? DISPUTE_SET
    : DISPUTE_SET.filter((item) => only.includes(item.id));
const promptFile =
  values.prompt ??
  fileURLToPath(new URL("../prompts/dispute-judge.md", import.meta.url));
const systemPrompt = await readFile(promptFile, "utf8");
const model = `${LIVE_CHECK_OPTIONS.model}, ${LIVE_CHECK_OPTIONS.effort} effort`;
const judge = createDisputeJudge({
  backend: createClaudeBackend(),
  systemPrompt,
});

/** How many disputes are decided at once: each is a Claude Code process. */
const AT_ONCE = 4;

/** The outcome as one line: the verdict, and the key or expected answer it sets. */
function summary(
  item: HandJudgedDispute,
  outcome: Pick<DisputeOutcome, "verdict" | "key" | "expected">,
): string {
  const { question } = item.entry;
  const parts: string[] = [outcome.verdict];
  if (question.kind === "choice") {
    parts.push(`key ${outcome.key ?? question.answer}`);
  }
  if (question.kind === "math") {
    parts.push(
      outcome.expected === undefined
        ? "expected kept"
        : `expected ${outcome.expected}`,
    );
  }
  return parts.join(", ");
}

function agrees(item: HandJudgedDispute, decision: DisputeDecision): boolean {
  if (!decision.ok) return false;
  const { outcome } = decision;
  const { question } = item.entry;
  return (
    outcome.verdict === item.verdict &&
    (question.kind !== "choice" ||
      (outcome.key ?? question.answer) === item.key) &&
    (question.kind !== "math" ||
      (outcome.expected === undefined) === (item.expected === undefined))
  );
}

for (let run = 1; run <= runs; run++) {
  const results: {
    item: HandJudgedDispute;
    decision: DisputeDecision;
    seconds: number;
  }[] = [];
  for (let i = 0; i < items.length; i += AT_ONCE) {
    const batch = items.slice(i, i + AT_ONCE);
    results.push(
      ...(await Promise.all(
        batch.map(async (item) => {
          const start = performance.now();
          const decision = await judge.decide(item.entry, item.reason);
          return {
            item,
            decision,
            seconds: (performance.now() - start) / 1000,
          };
        }),
      )),
    );
  }

  let agree = 0;
  process.stdout.write(
    `\n=== Run ${run} of ${runs} (${model}, ${promptFile}) ===\n`,
  );
  for (const { item, decision, seconds } of results) {
    const same = agrees(item, decision);
    if (same) agree++;
    process.stdout.write(
      `\n${item.id} (${item.tests}): first grade ${item.entry.verdict}` +
        ` ${same ? "AGREE" : "DISAGREE"}, ${seconds.toFixed(1)} s\n` +
        `  hand:  ${summary(item, item)}\n` +
        (decision.ok
          ? `  judge: ${summary(item, decision.outcome)}\n` +
            `  reason: ${decision.outcome.reason}\n`
          : `  error: ${decision.error}\n`),
    );
  }
  process.stdout.write(
    `\nRun ${run}: ${agree} of ${results.length} outcomes agree\n`,
  );
}
