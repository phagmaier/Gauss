import { describe, expect, test } from "vitest";
import { EvidenceEntry } from "../../shared/evidence.ts";
import type { Plan } from "../../shared/plan.ts";
import type { UnitPosition } from "../../shared/state.ts";
import type { ObjectiveCheck } from "./check-rules.ts";
import {
  messageTurn,
  nextQuestionTurn,
  readyTurn,
  type UnitContext,
  type Where,
} from "./unit-turns.ts";

// The list of questions asked before, in a turn that allows a question
// (docs/decisions.md, "Mastery loop": fresh questions come from a list).
// The chat's own tests see it in the turns it sends; these cover its form.

const PLAN: Plan = {
  objectives: [
    { id: "chain", statement: "Differentiate a composition." },
    { id: "product", statement: "Differentiate a product." },
  ],
  segments: [{ title: "Rules", objectives: ["chain", "product"] }],
};

const CONTEXT: UnitContext = {
  courseTitle: "Calculus",
  units: [
    {
      id: "rules",
      title: "Rules",
      goal: "Differentiate.",
      prerequisites: [],
    },
  ],
  unitId: "rules",
  plan: PLAN,
  sources: [],
};

const CHECK: UnitPosition = { segment: 0, phase: "check", checkFrom: 0 };

function where(
  evidence: EvidenceEntry[],
  given: {
    position?: UnitPosition;
    checks?: [string, ObjectiveCheck][];
  } = {},
): Where {
  return {
    context: CONTEXT,
    position: given.position ?? CHECK,
    checks: new Map(given.checks ?? []),
    notPassed: ["chain", "product"],
    slipping: [],
    goOver: ["chain", "product"],
    notes: [],
    evidence,
  };
}

let asked = 0;

/** A recorded answer to a question with this prompt. */
function answered(objective: string, prompt: string): EvidenceEntry {
  asked += 1;
  return EvidenceEntry.parse({
    kind: "answer",
    recordedAt: "2026-11-18T10:00:00.000Z",
    objective,
    question: { kind: "written", prompt, rubric: "Right." },
    answer: {
      kind: "written",
      questionId: `q${asked}`,
      text: "Because.",
      confidence: "75",
    },
    assisted: false,
    verdict: "correct",
  });
}

/** The lines in the question history section of a turn. */
function list(text: string): string[] {
  const end = text.indexOf("]\n");
  const header = end === -1 ? text.slice(1, -1) : text.slice(1, end);
  return header.split("\n").slice(2);
}

describe("a turn that allows a question lists those asked before", () => {
  test("none asked on either objective", () => {
    const text = readyTurn(where([]));
    expect(text).toMatch(
      /then a one-sentence lead-in\.\nQuestions asked before:\n/,
    );
    expect(list(text)).toEqual([
      'No question has been asked on "chain" before.',
      'No question has been asked on "product" before.',
    ]);
  });

  test("several, by objective and in the log's order, from the whole log on them", () => {
    const evidence = [
      answered("chain", "Differentiate $\\sin(x^2)$."),
      answered("product", "Differentiate $x e^x$."),
      EvidenceEntry.parse({
        kind: "override",
        recordedAt: "2026-11-18T10:00:00.000Z",
        objectives: ["chain"],
      }),
      answered("quotient", "Differentiate $1/x$."),
      answered("chain", "Differentiate $e^{3x}$."),
    ];
    expect(list(nextQuestionTurn(where(evidence), 2))).toEqual([
      'Asked on "chain" before, the oldest first:',
      '- "Differentiate $\\sin(x^2)$."',
      '- "Differentiate $e^{3x}$."',
      'Asked on "product" before, the oldest first:',
      '- "Differentiate $x e^x$."',
    ]);
  });

  test("only the objectives the question may be on", () => {
    const evidence = [
      answered("chain", "Differentiate $\\sin(x^2)$."),
      answered("product", "Differentiate $x e^x$."),
    ];
    const text = messageTurn(
      where(evidence, { checks: [["chain", { state: "done", asked: 1 }]] }),
      "Go on.",
    );
    expect(list(text)).toEqual([
      'Asked on "product" before, the oldest first:',
      '- "Differentiate $x e^x$."',
    ]);
  });

  test("more than six: the latest six, and how many there were", () => {
    const evidence = Array.from({ length: 8 }, (_, i) =>
      answered("chain", `Chain question ${i + 1}.`),
    );
    expect(list(readyTurn(where(evidence)))).toEqual([
      'The latest 6 of the 8 questions asked on "chain" before, the oldest first:',
      '- "Chain question 3."',
      '- "Chain question 4."',
      '- "Chain question 5."',
      '- "Chain question 6."',
      '- "Chain question 7."',
      '- "Chain question 8."',
      'No question has been asked on "product" before.',
    ]);
  });

  test('each prompt on one line, cut as a dispute\'s note cuts it, and a "]" in one does not end the header', () => {
    const long = `Prove it. ${"x".repeat(240)}`;
    const evidence = [
      answered("chain", "Is $f$ continuous on $[0, 1]$?\n\nSay why."),
      answered("chain", "  Differentiate $g$ on [a, b]\n"),
      answered("chain", long),
    ];
    const text = messageTurn(where(evidence), "Why [this]?\nAnd that.");

    // The scripted backend reads the header up to the first "]" that ends a
    // line, and the learner's text after it.
    const end = text.indexOf("]\n");
    expect(text.slice(end + 2)).toBe("Why [this]?\nAnd that.");
    expect(list(text)).toEqual([
      'Asked on "chain" before, the oldest first:',
      '- "Is $f$ continuous on $[0, 1]$? Say why."',
      '- "Differentiate $g$ on [a, b]"',
      `- "${long.slice(0, 199)}…"`,
      'No question has been asked on "product" before.',
    ]);
  });

  test("truncates by Unicode code point, keeping a whole astral character at the cutoff", () => {
    const prefix = `${"x".repeat(198)}𝑥`;
    const fits = `${prefix}?`;
    const text = readyTurn(
      where([
        answered("chain", fits),
        answered("chain", `${prefix}, then explain what it denotes.`),
      ]),
    );
    expect(list(text)).toContain(`- "${fits}"`);
    expect(list(text)).toContain(`- "${prefix}…"`);
  });
});

describe("a turn that allows no question lists none", () => {
  const evidence = [answered("chain", "Differentiate $\\sin(x^2)$.")];

  test.each<[string, UnitPosition]>([
    ["the discussion", { segment: 0, phase: "discuss" }],
    [
      "a detour",
      {
        segment: 0,
        phase: "check",
        checkFrom: 0,
        detour: { questionId: "q0", number: 1, objective: "chain" },
      },
    ],
  ])("in %s", (_, position) => {
    const text = messageTurn(where(evidence, { position }), "Hello.");
    expect(text).not.toContain("asked on");
    expect(text).not.toContain("$\\sin(x^2)$");
  });
});
