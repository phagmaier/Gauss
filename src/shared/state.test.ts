import { describe, expect, test } from "vitest";
import { State } from "./state.ts";

// A hand-written state.json with two units in progress at once, each keeping
// its place: one mid-check with a question open and no tutor session id yet
// (the backend reports it with the first turn), and one whose first segment
// has closed, waiting for the learner to start the next.
const STATE = {
  units: {
    derivative: {
      segment: 1,
      phase: "check",
      checkFrom: 3,
      openQuestion: {
        id: "q4",
        number: 2,
        objective: "tangent-line",
        postedAt: "2026-11-15T10:12:00.000Z",
        question: {
          kind: "choice",
          prompt: "What is the slope of the tangent to $y = x^2$ at $x = 3$?",
          choices: ["3", "6", "9"],
          answer: "B",
        },
      },
    },
    integral: {
      segment: 0,
      phase: "closed",
      tutorSessionId: "5d0c2c4e-8a51-4f7e-9a7e-2f1b6c1e0a93",
    },
  },
};

test("a hand-written state with two units in progress parses unchanged", () => {
  expect(State.parse(STATE)).toEqual(STATE);
});

// A written answer kept while it is graded, after the learner had help.
const WRITTEN_OPEN = {
  id: "q5",
  number: 3,
  objective: "tangent-line",
  postedAt: "2026-11-15T10:14:00.000Z",
  question: {
    kind: "written",
    prompt: "Find the tangent to $y = x^2$ at $x = 3$, and explain each step.",
    rubric: "Slope $6$ from $y' = 2x$; the line $y - 9 = 6(x - 3)$.",
  },
  assisted: true,
  answer: {
    kind: "written",
    questionId: "q5",
    text: "The slope is $6$, so $y - 9 = 6(x - 3)$.",
    confidence: "90",
  },
};

test("a written answer kept while it is graded parses unchanged", () => {
  const state = {
    units: {
      derivative: { ...STATE.units.derivative, openQuestion: WRITTEN_OPEN },
    },
  };

  expect(State.parse(state)).toEqual(state);
});

// A detour open after question 2 was missed (task 2.20): no question is open.
const DETOUR = { questionId: "q4", number: 2, objective: "tangent-line" };

test("a detour open in the check parses unchanged", () => {
  const { openQuestion: _, ...derivative } = STATE.units.derivative;
  const state = { units: { derivative: { ...derivative, detour: DETOUR } } };

  expect(State.parse(state)).toEqual(state);
});

test("a course with no unit in progress has an empty state", () => {
  expect(State.parse({ units: {} })).toEqual({ units: {} });
});

describe("rejects", () => {
  const derivative = STATE.units.derivative;
  test.each([
    {
      name: "an open question outside the check",
      input: {
        units: {
          ...STATE.units,
          derivative: { ...derivative, phase: "discuss", checkFrom: undefined },
        },
      },
      path: ["units", "derivative", "openQuestion"],
      message: /only in the check/,
    },
    {
      name: "a check without where it began in the evidence",
      input: {
        units: {
          ...STATE.units,
          derivative: { ...derivative, checkFrom: undefined },
        },
      },
      path: ["units", "derivative", "checkFrom"],
      message: /kept in the check/,
    },
    {
      name: "where a check began, kept outside the check",
      input: {
        units: {
          ...STATE.units,
          integral: { ...STATE.units.integral, checkFrom: 0 },
        },
      },
      path: ["units", "integral", "checkFrom"],
      message: /only there/,
    },
    {
      name: "a question whose answer is not one of its choices",
      input: {
        units: {
          ...STATE.units,
          derivative: {
            ...derivative,
            openQuestion: {
              ...derivative.openQuestion,
              question: { ...derivative.openQuestion.question, answer: "D" },
            },
          },
        },
      },
      path: ["units", "derivative", "openQuestion", "question", "answer"],
      message: /one of the choices/,
    },
    {
      name: "a written answer kept on a choice question",
      input: {
        units: {
          derivative: {
            ...derivative,
            openQuestion: {
              ...derivative.openQuestion,
              answer: { ...WRITTEN_OPEN.answer, questionId: "q4" },
            },
          },
        },
      },
      path: ["units", "derivative", "openQuestion", "answer"],
      message: /Only a written question/,
    },
    {
      name: "a kept answer to another question",
      input: {
        units: {
          derivative: {
            ...derivative,
            openQuestion: {
              ...WRITTEN_OPEN,
              answer: { ...WRITTEN_OPEN.answer, questionId: "q4" },
            },
          },
        },
      },
      path: ["units", "derivative", "openQuestion", "answer", "questionId"],
      message: /another question/,
    },
    {
      name: "a detour with a question open",
      input: { units: { derivative: { ...derivative, detour: DETOUR } } },
      path: ["units", "derivative", "detour"],
      message: /never with a question open/,
    },
    {
      name: "a detour outside the check",
      input: {
        units: {
          integral: { ...STATE.units.integral, detour: DETOUR },
        },
      },
      path: ["units", "integral", "detour"],
      message: /only in the check/,
    },
  ])("$name", ({ input, path, message }) => {
    const result = State.safeParse(input);

    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual([
      expect.objectContaining({
        path,
        message: expect.stringMatching(message),
      }),
    ]);
  });
});
