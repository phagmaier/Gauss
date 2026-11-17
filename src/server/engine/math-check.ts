// The symbolic check as the engine runs it (architecture.md section 6; task
// 3.5): `pytools/mathcheck.py`, run in the engine's sandbox (sandbox.ts),
// since the expressions it reads were written by the tutor and the learner.
// It is run with the venv's own Python, isolated, so it needs no uv cache
// and writes nothing. Its header says what it reads and writes; this module
// turns a run into a result, and a run that fails, runs out of time or
// writes something out of shape into a failure, never an exception.

import { fileURLToPath } from "node:url";
import { z } from "zod";
import { sandboxPython } from "../sandbox-command.ts";
import { duration } from "./grading.ts";
import type { Sandbox } from "./sandbox.ts";

/** What the check made of an answer, or why it made nothing of it. */
export type MathResult =
  | { result: "equivalent" }
  | { result: "different" }
  | { result: "unparsable" | "undecided" | "failed"; reason: string };

export interface MathCheck {
  /**
   * Whether the expected expression reads, as posting a math question
   * needs: nothing, or the reason it cannot be used.
   */
  read(expected: string): Promise<{ refused: string } | undefined>;
  /** Compares an answer with the expected expression. Never throws. */
  compare(expected: string, answer: string): Promise<MathResult>;
}

/**
 * A check that cannot run: math questions are refused when posted, and an
 * answer to one posted earlier goes to the grader.
 */
export const noMathCheck: MathCheck = {
  read: async () => ({
    refused:
      "The symbolic check that grades math questions is not available. Ask a written question instead.",
  }),
  compare: async () => ({
    result: "failed",
    reason: "the symbolic check is not available",
  }),
};

/**
 * The check's own limit is 8 seconds for the comparison, after start-up and
 * reading, which take about a second (decisions.md, "Symbolic check").
 */
export const MATH_CHECK_TIME_LIMIT_MS = 12_000;

const script = fileURLToPath(
  new URL("../../../pytools/mathcheck.py", import.meta.url),
);

/** What mathcheck.py writes on standard output. */
const Output = z.discriminatedUnion("result", [
  z.object({ result: z.enum(["equivalent", "different", "parsed"]) }),
  z.object({
    result: z.literal("unparsable"),
    side: z.enum(["expected", "answer"]),
    reason: z.string().min(1),
  }),
  z.object({ result: z.literal("undecided"), reason: z.string().min(1) }),
]);
type Output = z.infer<typeof Output>;

export function createMathCheck(options: {
  sandbox: Sandbox;
  timeLimitMs?: number;
}): MathCheck {
  const { sandbox } = options;
  const timeLimitMs = options.timeLimitMs ?? MATH_CHECK_TIME_LIMIT_MS;

  /** One run of the check, or why it gave no result. */
  async function run(request: {
    expected: string;
    answer?: string;
  }): Promise<Output | { failed: string }> {
    if (!sandbox.available) {
      return { failed: `there is no sandbox to run it in (${sandbox.reason})` };
    }
    let ran: Awaited<ReturnType<typeof sandbox.run>>;
    try {
      ran = await sandbox.run({
        argv: [sandboxPython, "-I", script],
        cwd: "/",
        writable: [],
        input: JSON.stringify(request),
        timeLimitMs,
        outputLimit: 16 * 1024,
      });
    } catch (error) {
      return { failed: error instanceof Error ? error.message : String(error) };
    }
    if (ran.timedOut) {
      return { failed: `it took longer than ${duration(timeLimitMs)}` };
    }
    if (ran.exitCode !== 0) {
      const said = ran.stderr.trim().split("\n").at(-1)?.trim();
      return {
        failed: `it stopped with exit status ${ran.exitCode}${said ? `: ${said}` : ""}`,
      };
    }
    try {
      return Output.parse(JSON.parse(ran.stdout));
    } catch {
      return { failed: "its output could not be read" };
    }
  }

  return {
    async read(expected) {
      const out = await run({ expected });
      if ("failed" in out) {
        return {
          refused: `The symbolic check could not read the expected answer: ${out.failed}. Ask a written question instead.`,
        };
      }
      if (out.result === "parsed") return undefined;
      if (out.result === "unparsable") {
        return {
          refused: `The symbolic check cannot read the expected answer: ${out.reason}. Write it as one expression, one equation or values separated by commas, without derivative notation, inequalities, intervals, sums, integrals or limits; or ask a written question instead.`,
        };
      }
      return {
        refused: `The symbolic check gave no reading of the expected answer (${out.result}). Ask a written question instead.`,
      };
    },

    async compare(expected, answer) {
      const out = await run({ expected, answer });
      if ("failed" in out) return { result: "failed", reason: out.failed };
      switch (out.result) {
        case "equivalent":
          return { result: "equivalent" };
        case "different":
          return { result: "different" };
        case "undecided":
          return { result: "undecided", reason: out.reason };
        case "unparsable":
          // The expected side read when the question was posted.
          return out.side === "answer"
            ? { result: "unparsable", reason: out.reason }
            : {
                result: "failed",
                reason: `the expected answer did not read: ${out.reason}`,
              };
        case "parsed":
          return { result: "failed", reason: "it did not compare the answer" };
      }
    },
  };
}
