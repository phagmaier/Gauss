import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import type { CurriculumProposal } from "../../shared/curriculum.ts";
import type { AnswerEvidence } from "../../shared/evidence.ts";
import { CHOICE_LETTERS } from "../../shared/question.ts";
import { type CodeRunner, createCodeRunner } from "../engine/code-run.ts";
import { createDisputeJudge } from "../engine/dispute-judge.ts";
import { createGrader } from "../engine/grading.ts";
import { createHandoffWriter } from "../engine/handoff.ts";
import { createHelpJudge } from "../engine/help-judge.ts";
import { createIntakes } from "../engine/intake.ts";
import { createMathCheck, type MathCheck } from "../engine/math-check.ts";
import {
  createPackageInstaller,
  type PackageInstaller,
} from "../engine/packages.ts";
import { startSandbox } from "../engine/sandbox.ts";
import { createUnitChats, type UnitChat } from "../engine/unit-chat.ts";
import { createUnitPlanner } from "../engine/unit-planning.ts";
import { openDataRoot } from "../record/data-root.ts";
import { withProgress } from "../record/progress.ts";
import {
  BROKEN_SESSION,
  createScriptedBackend,
  scriptedPlan,
} from "./scripted.ts";

// The scripted backend runs the dev server with no model (scripts/dev-fake.ts).
// These tests take it through the engine, as the server wires it, so a change
// to the engine's headers or rules that the script cannot follow fails here.
// What is expected comes from the engine's rules (docs/decisions.md,
// "Objective status"), not from the script: a correct answer at 90% passes an
// objective, a miss needs another question, and a unit whose objectives all
// passed is finished.

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "gauss-scripted-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const COURSE = "calculus-i";
const CURRICULUM: CurriculumProposal = {
  title: "Calculus I",
  units: [
    {
      id: "limits",
      title: "Limits",
      goal: "Compute limits.",
      prerequisites: [],
    },
    {
      id: "derivative",
      title: "The derivative",
      goal: "Differentiate.",
      prerequisites: ["limits"],
    },
  ],
  style: "Short.",
  background: "The learner knows algebra.",
};

function setUp(
  given: {
    mathCheck?: MathCheck;
    codeRunner?: CodeRunner;
    installer?: PackageInstaller;
    /** The clock of the record and the chats; the real one if not given. */
    now?: () => Date;
  } = {},
) {
  const backend = createScriptedBackend();
  const clock = given.now === undefined ? {} : { now: given.now };
  const dataRoot = openDataRoot({ path: dir, ...clock });
  const units = createUnitChats({
    ...clock,
    backend,
    systemPrompt: "Tutor.",
    dataRoot,
    planner: createUnitPlanner({ backend, systemPrompt: "Plan.", dataRoot }),
    grader: createGrader({ backend, systemPrompt: "Grade." }),
    judge: createHelpJudge({ backend, systemPrompt: "Judge." }),
    handoff: createHandoffWriter({ backend, systemPrompt: "Handoff." }),
    // As the server has it where the sandbox runs (serve.ts).
    ...(given.mathCheck === undefined
      ? {}
      : { mathCheck: given.mathCheck, workspaceTools: true }),
    ...(given.codeRunner === undefined
      ? {}
      : { codeRunner: given.codeRunner, workspaceTools: true }),
    ...(given.installer === undefined ? {} : { installer: given.installer }),
  });
  const intakes = createIntakes({ backend, systemPrompt: "Intake.", dataRoot });
  return { backend, dataRoot, units, intakes };
}

async function approvedCourse(dataRoot: ReturnType<typeof openDataRoot>) {
  const { id } = await dataRoot.createCourse({ title: CURRICULUM.title });
  await dataRoot.saveProposal(id, CURRICULUM);
  await dataRoot.approveCurriculum(id, CURRICULUM);
}

/**
 * The time this test may take. It writes and flushes the record after every
 * step of a whole unit, and under a full parallel run it took 3.4 to 5 seconds,
 * past Vitest's 5-second default now and then, before task 2.14 as after.
 */
const WHOLE_UNIT_MS = 15_000;

test(
  "a unit not yet planned runs to its end: planned, each segment taught, checked and closed, a written answer graded, its gate taken, and a handoff note written at each close",
  async () => {
    const { dataRoot, units } = setUp();
    await approvedCourse(dataRoot);
    const position = async () =>
      (await dataRoot.readState(COURSE)).units.limits;
    const openQuestion = async () => {
      const open = (await position())?.openQuestion;
      if (open === undefined) throw new Error("No question is open.");
      return open;
    };

    const opened = await units.open(COURSE, "limits");
    if (!opened.ok) throw new Error(opened.error);
    const chat: UnitChat = opened.chat;
    await chat.settled();

    // Planned, and the first segment taught.
    const stored = await dataRoot.readCourse(COURSE);
    const plan = stored?.curriculum?.units[0]?.plan;
    expect(plan?.segments.length).toBeGreaterThanOrEqual(2);
    expect(await position()).toMatchObject({ segment: 0, phase: "discuss" });
    expect(chat.events().some((e) => e.type === "tutor_text")).toBe(true);

    // Each segment: ready, then answers until the segment closes. A written
    // answer saying "wrong" is graded incorrect, so that objective then needs
    // two correct answers to different questions (task 2.19), and no
    // question may repeat another.
    const prompts: string[] = [];
    const kinds = new Set<string>();
    const segments = plan?.segments.length ?? 0;
    for (let segment = 0; segment < segments; segment += 1) {
      if (segment > 0) {
        expect(await chat.nextSegment()).toEqual({ ok: true });
        await chat.settled();
      }
      expect(await chat.ready()).toEqual({ ok: true });
      await chat.settled();
      let missed = false;
      for (
        let at = await position();
        at !== undefined && at.phase === "check";
        at = await position()
      ) {
        if (at.detour !== undefined) {
          // A miss opens a detour, which the learner ends (task 2.20).
          expect(await chat.anotherQuestion()).toEqual({ ok: true });
          await chat.settled();
          continue;
        }
        const open = await openQuestion();
        prompts.push(open.question.prompt);
        kinds.add(open.question.kind);
        const answered =
          open.question.kind === "choice"
            ? await chat.answer({
                kind: "choice",
                questionId: open.id,
                choice: open.question.answer,
                confidence: "90",
              })
            : await chat.answer({
                kind: "written",
                questionId: open.id,
                text: missed ? "Because it is so." : "This is wrong.",
                confidence: "90",
              });
        expect(answered).toEqual({ ok: true });
        if (open.question.kind === "written") missed = true;
        await chat.settled();
      }
    }

    // The last segment's close offers the unit's gate (task 5.5), which the
    // scripted tutor asks: a question on each objective, answered right.
    expect(await position()).toMatchObject({
      phase: "closed",
      assessment: { mode: "gate", stage: "offered" },
    });
    expect(await chat.startAssessment()).toEqual({ ok: true });
    await chat.settled();
    let asked = 0;
    for (
      let at = await position();
      at?.assessment?.stage === "on";
      at = await position()
    ) {
      const open = await openQuestion();
      prompts.push(open.question.prompt);
      asked += 1;
      expect(
        open.question.kind === "choice"
          ? await chat.answer({
              kind: "choice",
              questionId: open.id,
              choice: open.question.answer,
              confidence: "90",
            })
          : await chat.answer({
              kind: "written",
              questionId: open.id,
              text: "Because it is so.",
              confidence: "90",
            }),
      ).toEqual({ ok: true });
      await chat.settled();
    }
    expect(asked).toBe(plan?.objectives.length);

    // Both kinds of question were asked, and no question twice.
    expect(kinds).toEqual(new Set(["choice", "written"]));
    expect(new Set(prompts).size).toBe(prompts.length);
    // One miss, on the written question; every other answer correct.
    const verdicts = (await dataRoot.readEvidence(COURSE)).map((e) =>
      e.kind === "answer" ? e.verdict : e.kind,
    );
    expect(verdicts.filter((v) => v === "incorrect")).toHaveLength(1);
    // The miss opened a detour, which the scripted tutor answered as one.
    expect(chat.events().filter((e) => e.type === "detour")).toHaveLength(1);
    expect(
      chat
        .events()
        .some(
          (e) =>
            e.type === "tutor_text" && e.text.startsWith("**Scripted detour**"),
        ),
    ).toBe(true);
    expect(verdicts.filter((v) => v === "correct")).toHaveLength(
      verdicts.length - 1,
    );
    // Every objective passed, and the gate retained them: the unit is
    // finished and out of state.json.
    expect(await position()).toBeUndefined();
    const course = await dataRoot.readCourse(COURSE);
    if (course === undefined) throw new Error("The course is gone.");
    expect((await withProgress(dataRoot, course)).progress).toEqual({
      limits: { status: "passed", retained: 2, slipping: 0 },
      derivative: { status: "not-started" },
    });
    expect(chat.events().at(-1)).not.toMatchObject({ type: "unit_failed" });
    // A call as each segment closed and as the unit finished after its gate,
    // each note numbered on from the one before; the written miss's detour
    // found as a misconception on its objective.
    expect(await dataRoot.readHandoff(COURSE, "limits")).toMatchObject({
      note: expect.stringMatching(/^\*\*Scripted note 3\.\*\* /),
    });
    const detour = chat.events().find((e) => e.type === "detour");
    expect(await dataRoot.readMisconceptions(COURSE)).toEqual([
      expect.objectContaining({
        unit: "limits",
        objective: "limits-proof",
        where: {
          in: "detour",
          questionId: detour?.type === "detour" ? detour.questionId : "",
          number: detour?.type === "detour" ? detour.number : 0,
        },
      }),
    ]);
  },
  WHOLE_UNIT_MS,
);

test("in a review, unit 2's scripted tutor asks about unit 1's objective, numbered past the question asked on it before, and the review ends before the teaching", async () => {
  const { dataRoot, units } = setUp();
  await approvedCourse(dataRoot);
  await dataRoot.storePlan(COURSE, "limits", scriptedPlan("limits"));
  // Passed long before, at 90%: review is due on it.
  await dataRoot.appendEvidence(COURSE, {
    kind: "answer",
    recordedAt: "2026-11-01T10:00:00.000Z",
    objective: "limits-idea",
    question: {
      kind: "choice",
      prompt: 'Choice question 1 on "limits-idea": what is $1 + 1$?',
      choices: ["$2$", "$3$", "$1$"],
      answer: "A",
    },
    answer: {
      kind: "choice",
      questionId: "earlier",
      choice: "A",
      confidence: "90",
    },
    assisted: false,
    verdict: "correct",
  });
  const opened = await units.open(COURSE, "derivative");
  if (!opened.ok) throw new Error(opened.error);
  const chat = opened.chat;
  await chat.settled();
  expect(chat.events()).toContainEqual({
    type: "assessment",
    mode: "review",
    stage: "offered",
    count: 1,
  });

  expect(await chat.startAssessment()).toEqual({ ok: true });
  await chat.settled();
  const posted = chat.events().findLast((e) => e.type === "question");
  if (posted?.type !== "question" || posted.question.kind !== "choice") {
    throw new Error("No choice question was posted.");
  }
  expect(posted.question).toMatchObject({
    number: 1,
    prompt: expect.stringContaining('Choice question 2 on "limits-idea"'),
    assessment: { of: 1, from: { number: 1, title: "Limits" } },
  });
  const right = posted.question.choices.indexOf("$4$");
  expect(
    await chat.answer({
      kind: "choice",
      questionId: posted.question.id,
      choice: CHOICE_LETTERS[right] ?? "A",
      confidence: "75",
    }),
  ).toEqual({ ok: true });
  await chat.settled();

  expect(chat.events()).toContainEqual({
    type: "assessment_end",
    mode: "review",
    skipped: false,
    statuses: { "limits-idea": "retained" },
  });
  expect(
    chat
      .events()
      .some(
        (e) =>
          e.type === "tutor_text" &&
          e.text.startsWith("**Scripted teaching.**"),
      ),
  ).toBe(true);
  expect((await dataRoot.readState(COURSE)).units.derivative).toMatchObject({
    segment: 0,
    phase: "discuss",
  });
});

test(
  "testing out of unit 1, the scripted tutor asks each objective with no feedback between, says what the test showed, and teaching starts at the segment not passed",
  async () => {
    const { dataRoot, units } = setUp();
    await approvedCourse(dataRoot);
    const opened = await units.open(COURSE, "limits", { testOut: true });
    if (!opened.ok) throw new Error(opened.error);
    const chat = opened.chat;
    await chat.settled();
    const posted = () => {
      const event = chat.events().findLast((e) => e.type === "question");
      if (event?.type !== "question") throw new Error("No question posted.");
      return event.question;
    };

    const first = posted();
    if (first.kind !== "choice") throw new Error("Not a choice question.");
    expect(first).toMatchObject({
      number: 1,
      prompt: expect.stringContaining('Choice question 1 on "limits-idea"'),
      assessment: { of: 2, objective: 1 },
    });
    expect(
      await chat.answer({
        kind: "choice",
        questionId: first.id,
        choice: CHOICE_LETTERS[first.choices.indexOf("$2$")] ?? "A",
        confidence: "90",
      }),
    ).toEqual({ ok: true });
    await chat.settled();
    // No feedback: the grade's turn posts the next question.
    expect(
      chat
        .events()
        .some((e) => e.type === "tutor_text" && e.text.includes("feedback")),
    ).toBe(false);
    const second = posted();
    expect(second).toMatchObject({
      number: 2,
      kind: "written",
      assessment: { of: 2, objective: 2 },
    });
    expect(
      await chat.answer({
        kind: "written",
        questionId: second.id,
        text: "This is wrong, I think.",
        confidence: "50",
      }),
    ).toEqual({ ok: true });
    await chat.settled();

    expect(chat.events().slice(-3)).toEqual([
      {
        type: "tutor_text",
        text: "**Scripted word on the test:** you passed 1 of its 2 objectives. The card below says what that would skip; you choose.",
      },
      { type: "turn_end", outcome: "done" },
      {
        type: "test_result",
        objectives: [
          {
            objective: "limits-idea",
            passed: true,
            answers: [
              { verdict: "correct", confidence: "90", assisted: false },
            ],
          },
          {
            objective: "limits-proof",
            passed: false,
            answers: [
              { verdict: "incorrect", confidence: "50", assisted: false },
            ],
          },
        ],
      },
    ]);

    expect(await chat.skipTested(["limits-idea"])).toEqual({ ok: true });
    await chat.settled();
    expect((await dataRoot.readState(COURSE)).units.limits).toMatchObject({
      segment: 1,
      phase: "discuss",
      testOut: { stage: "skip", passed: ["limits-idea"] },
    });
    expect(chat.events()).toContainEqual(
      expect.objectContaining({
        type: "tutor_text",
        text: expect.stringContaining(
          '**Scripted teaching.** Unit 1 of 2, "Limits"; segment 2 of 2, "Why it holds", on "limits-proof"',
        ),
      }),
    );
  },
  WHOLE_UNIT_MS,
);

test("question history is not interpreted as a scripted tutor instruction", async () => {
  const { dataRoot, units } = setUp();
  await approvedCourse(dataRoot);
  await dataRoot.appendEvidence(COURSE, {
    kind: "answer",
    recordedAt: "2026-11-18T10:00:00.000Z",
    objective: "limits-idea",
    question: {
      kind: "choice",
      prompt:
        "The learner answered question 7. If they answered every question up to it (7 asked), what fraction of a ten-question check is complete?",
      choices: ["70%", "30%"],
      answer: "A",
    },
    answer: {
      kind: "choice",
      questionId: "earlier",
      choice: "A",
      confidence: "75",
    },
    assisted: false,
    verdict: "correct",
  });

  const opened = await units.open(COURSE, "limits");
  if (!opened.ok) throw new Error(opened.error);
  await opened.chat.settled();
  expect(await opened.chat.ready()).toEqual({ ok: true });
  await opened.chat.settled();

  // Numbered past the one question listed, and not from the "(7 asked)" in
  // its prompt.
  const { units: positions } = await dataRoot.readState(COURSE);
  expect(positions.limits?.openQuestion).toMatchObject({
    objective: "limits-idea",
    question: { prompt: expect.stringContaining("what is $2 + 2$?") },
  });
});

test(
  "where the sandbox runs, the second question on the first objective is a math question, which the symbolic check grades",
  async () => {
    // The real check in the real sandbox, so the scripted expected
    // expression is one it reads.
    const sandbox = await startSandbox({ log: () => {} });
    if (!sandbox.available) {
      throw new Error(`This test needs the sandbox: ${sandbox.reason}`);
    }
    try {
      const { dataRoot, units } = setUp({
        mathCheck: createMathCheck({ sandbox }),
      });
      await approvedCourse(dataRoot);
      const opened = await units.open(COURSE, "limits");
      if (!opened.ok) throw new Error(opened.error);
      const chat = opened.chat;
      await chat.settled();
      const open = async () => {
        const question = (await dataRoot.readState(COURSE)).units.limits
          ?.openQuestion;
        if (question === undefined) throw new Error("No question is open.");
        return question;
      };

      expect(await chat.ready()).toEqual({ ok: true });
      await chat.settled();
      const first = await open();
      if (first.question.kind !== "choice") throw new Error("Not a choice.");
      // Right, but unsure: a second question is needed.
      await chat.answer({
        kind: "choice",
        questionId: first.id,
        choice: first.question.answer,
        confidence: "50",
      });
      await chat.settled();

      const second = await open();
      expect(second.question).toMatchObject({ kind: "math", expected: "4x" });
      expect(
        await chat.answer({
          kind: "math",
          questionId: second.id,
          expression: "2x + 2x",
          confidence: "75",
        }),
      ).toEqual({ ok: true });
      await chat.settled();

      const evidence = await dataRoot.readEvidence(COURSE);
      expect(evidence.at(-1)).toMatchObject({
        question: { kind: "math" },
        verdict: "correct",
      });
      // Two right answers to different questions pass the objective, and
      // the segment closes.
      expect((await dataRoot.readState(COURSE)).units.limits).toMatchObject({
        segment: 0,
        phase: "closed",
      });
    } finally {
      await sandbox.close();
    }
  },
  WHOLE_UNIT_MS,
);

test(
  "in a course whose title says code, the first objective's questions are code questions: the tutor writes the starter, which fails, and a fixed file passes",
  async () => {
    const sandbox = await startSandbox({ log: () => {} });
    if (!sandbox.available) {
      throw new Error(`This test needs the sandbox: ${sandbox.reason}`);
    }
    try {
      const { dataRoot, units } = setUp({
        codeRunner: createCodeRunner({ sandbox }),
      });
      const coding = { ...CURRICULUM, title: "Python code" };
      const { id } = await dataRoot.createCourse({ title: coding.title });
      await dataRoot.saveProposal(id, coding);
      await dataRoot.approveCurriculum(id, coding);
      const workspace = await dataRoot.workspaceFolder(id);
      const opened = await units.open(id, "limits");
      if (!opened.ok) throw new Error(opened.error);
      const chat = opened.chat;
      await chat.settled();
      const open = async () => {
        const question = (await dataRoot.readState(id)).units.limits
          ?.openQuestion;
        if (question === undefined) throw new Error("No question is open.");
        return question;
      };

      expect(await chat.ready()).toEqual({ ok: true });
      await chat.settled();
      const first = await open();
      expect(first.question).toMatchObject({
        kind: "code",
        files: ["exercise_limits_idea_1.py"],
      });
      expect(
        await readFile(join(workspace, "exercise_limits_idea_1.py"), "utf8"),
      ).toBe("def times(x):\n    return 0\n");
      // The starter as it is: a miss, and a detour.
      await chat.answer({
        kind: "code",
        questionId: first.id,
        confidence: "50",
      });
      await chat.settled();
      expect((await dataRoot.readEvidence(id)).at(-1)).toMatchObject({
        verdict: "incorrect",
        output: expect.stringContaining("times(1) gave 0, not 1"),
      });
      expect(await chat.anotherQuestion()).toEqual({ ok: true });
      await chat.settled();

      const second = await open();
      expect(second.question).toMatchObject({
        files: ["exercise_limits_idea_2.py"],
      });
      await writeFile(
        join(workspace, "exercise_limits_idea_2.py"),
        "def times(x):\n    return x + x\n",
      );
      await chat.answer({
        kind: "code",
        questionId: second.id,
        confidence: "90",
      });
      await chat.settled();
      expect((await dataRoot.readEvidence(id)).at(-1)).toMatchObject({
        verdict: "correct",
        output: "Scripted: all 4 checks passed.",
      });
    } finally {
      await sandbox.close();
    }
  },
  WHOLE_UNIT_MS,
);

test(
  "in a code course, a review's code exercise skipped with a draft in its file is not written over: the next review's exercise has a file of its own",
  async () => {
    const sandbox = await startSandbox({ log: () => {} });
    if (!sandbox.available) {
      throw new Error(`This test needs the sandbox: ${sandbox.reason}`);
    }
    try {
      let clock = new Date("2026-11-18T12:00:00.000Z");
      const given = {
        codeRunner: createCodeRunner({ sandbox }),
        now: () => clock,
      };
      const first = setUp(given);
      const { dataRoot } = first;
      const coding = { ...CURRICULUM, title: "Python code" };
      const { id } = await dataRoot.createCourse({ title: coding.title });
      await dataRoot.saveProposal(id, coding);
      await dataRoot.approveCurriculum(id, coding);
      await dataRoot.storePlan(id, "limits", scriptedPlan("limits"));
      // Passed long before, at 90%: review is due on it.
      await dataRoot.appendEvidence(id, {
        kind: "answer",
        recordedAt: "2026-11-01T10:00:00.000Z",
        objective: "limits-idea",
        question: {
          kind: "choice",
          prompt: 'Choice question 1 on "limits-idea": what is $1 + 1$?',
          choices: ["$2$", "$3$", "$1$"],
          answer: "A",
        },
        answer: {
          kind: "choice",
          questionId: "earlier",
          choice: "A",
          confidence: "90",
        },
        assisted: false,
        verdict: "correct",
      });
      const workspace = await dataRoot.workspaceFolder(id);
      const review = async (units: typeof first.units) => {
        const opened = await units.open(id, "derivative");
        if (!opened.ok) throw new Error(opened.error);
        const chat = opened.chat;
        await chat.settled();
        expect(await chat.startAssessment()).toEqual({ ok: true });
        await chat.settled();
        const open = (await dataRoot.readState(id)).units.derivative
          ?.openQuestion;
        if (open === undefined) throw new Error("No question is open.");
        return { chat, question: open.question };
      };

      const before = await review(first.units);
      expect(before.question).toMatchObject({
        kind: "code",
        files: ["exercise_limits_idea_2.py"],
      });
      const draft = "def times(x):\n    return x  # not done yet\n";
      await writeFile(join(workspace, "exercise_limits_idea_2.py"), draft);
      expect(await before.chat.skipAssessment()).toEqual({ ok: true });
      await before.chat.settled();
      await first.units.close();

      // Two hours on, the next sitting reviews the same objective.
      clock = new Date(clock.getTime() + 2 * 60 * 60 * 1000);
      const second = setUp(given);
      const after = await review(second.units);
      expect(after.question).toMatchObject({
        kind: "code",
        files: ["exercise_limits_idea_3.py"],
      });
      expect(
        await readFile(join(workspace, "exercise_limits_idea_2.py"), "utf8"),
      ).toBe(draft);
      await second.units.close();
    } finally {
      await sandbox.close();
    }
  },
  WHOLE_UNIT_MS,
);

test("an intake asks first, proposes a curriculum titled from the learner's first message with their reply as its background, revises it when asked, and the revision can be approved", async () => {
  const { dataRoot, intakes } = setUp();
  const intake = intakes.start();

  expect(intake.say("Topology for analysts")).toEqual({ ok: true });
  await intake.settled();
  expect(intake.courseId()).toBeUndefined();
  expect(intake.events().at(-2)).toMatchObject({ type: "tutor_text" });

  expect(intake.say("I know metric spaces.")).toEqual({ ok: true });
  await intake.settled();

  const id = intake.courseId();
  if (id === undefined) throw new Error("No course was proposed.");
  const first = await dataRoot.readCourse(id);
  expect(first?.course.title).toBe("Topology for analysts");
  expect(first?.curriculum?.approval.status).toBe("draft");
  expect(await dataRoot.readBackground(id)).toContain("I know metric spaces.");
  const firstUnits = first?.curriculum?.units.map((u) => u.id) ?? [];
  expect(firstUnits.length).toBeGreaterThan(1);

  // An ordinary message is answered without a new proposal.
  expect(intake.say("Why this order?")).toEqual({ ok: true });
  await intake.settled();
  expect(
    intake.events().filter((e) => e.type === "curriculum_proposed"),
  ).toHaveLength(1);

  expect(intake.say("/revise")).toEqual({ ok: true });
  await intake.settled();
  const revised = await dataRoot.readCourse(id);
  expect(revised?.curriculum?.units.map((u) => u.id)).not.toEqual(firstUnits);

  expect(await intake.approve(2)).toEqual({ ok: true });
  expect((await dataRoot.readCourse(id))?.curriculum?.approval.status).toBe(
    "approved",
  );
});

test("/one-off proposes a course of one unit", async () => {
  const { dataRoot, intakes } = setUp();
  const intake = intakes.start();

  intake.say("What is a group? /one-off");
  await intake.settled();
  intake.say("None at all.");
  await intake.settled();

  const stored = await dataRoot.readCourse(intake.courseId() ?? "");
  expect(stored?.course.title).toBe("What is a group?");
  expect(stored?.curriculum?.units).toHaveLength(1);
});

test("the teaching of a unit's first segment shows the scripted artifact, and /artifact shows it again; the second segment's teaching shows none", async () => {
  const { dataRoot, units } = setUp();
  await approvedCourse(dataRoot);
  const opened = await units.open(COURSE, "limits");
  if (!opened.ok) throw new Error(opened.error);
  const { chat } = opened;
  await chat.settled();
  const shown = () =>
    chat.events().flatMap((e) => (e.type === "artifact" ? [e.file] : []));

  expect(shown()).toEqual(["1-the-tangent-to-y-x2.html"]);
  const html = await dataRoot.readArtifact(
    COURSE,
    "1-the-tangent-to-y-x2.html",
  );
  expect(html).toContain('<input id="x" type="range"');
  expect(html).toContain("fetch(url)");

  expect(chat.say("Again, please. /artifact")).toEqual({ ok: true });
  await chat.settled();
  expect(shown()).toEqual([
    "1-the-tangent-to-y-x2.html",
    "2-the-tangent-to-y-x2.html",
  ]);

  expect(await chat.override()).toEqual({ ok: true });
  expect(await chat.nextSegment()).toEqual({ ok: true });
  await chat.settled();
  expect(shown()).toHaveLength(2);
});

test("/hold keeps the tutor's turn open until it is stopped, and /fail in a written answer fails its grading", async () => {
  const { dataRoot, units, backend } = setUp();
  await approvedCourse(dataRoot);
  const opened = await units.open(COURSE, "limits");
  if (!opened.ok) throw new Error(opened.error);
  const { chat } = opened;
  await chat.settled();

  expect(chat.say("Wait. /hold")).toEqual({ ok: true });
  // The turn has started and does not end by itself.
  await expect
    .poll(() => chat.events().at(-1)?.type, { timeout: 2000 })
    .toBe("tutor_text");
  await chat.interrupt();
  await chat.settled();
  expect(chat.events().at(-1)).toMatchObject({ type: "turn_end" });

  const grader = createGrader({ backend, systemPrompt: "Grade." });
  const question = {
    kind: "written" as const,
    prompt: "Why?",
    rubric: "Says why.",
  };
  expect((await grader.grade(question, "Please /fail now")).ok).toBe(false);
  expect(await grader.grade(question, "Because.")).toEqual({
    ok: true,
    verdict: "correct",
  });
});

test('a reply to a message during an open question is judged clarification when the message has "mean" in it, help otherwise, and help when "/fail" fails the judging', async () => {
  const { dataRoot, units } = setUp();
  await approvedCourse(dataRoot);
  const opened = await units.open(COURSE, "limits");
  if (!opened.ok) throw new Error(opened.error);
  const { chat } = opened;
  await chat.settled();
  expect(await chat.ready()).toEqual({ ok: true });
  await chat.settled();
  const judged = () =>
    chat
      .events()
      .filter((e) => e.type === "judged")
      .map((e) => (e.type === "judged" ? [e.verdict, e.unjudged] : []));
  const answerOpen = async () => {
    const open = (await dataRoot.readState(COURSE)).units.limits?.openQuestion;
    if (open?.question.kind !== "choice") throw new Error("No choice open.");
    expect(
      await chat.answer({
        kind: "choice",
        questionId: open.id,
        choice: open.question.answer,
        confidence: "100",
      }),
    ).toEqual({ ok: true });
    await chat.settled();
  };

  chat.say("What does the plus sign mean here?");
  await chat.settled();
  expect(judged()).toEqual([["clarification", undefined]]);
  await answerOpen();
  // Clarification is free: the confident correct answer passes the objective.
  expect((await dataRoot.readEvidence(COURSE)).at(-1)).toMatchObject({
    verdict: "correct",
    assisted: false,
  });

  // The first segment passed; the second checks with written questions.
  expect(await chat.nextSegment()).toEqual({ ok: true });
  await chat.settled();
  expect(await chat.ready()).toEqual({ ok: true });
  await chat.settled();
  for (const message of ["Is the answer four?", "Please /fail this"]) {
    chat.say(message);
    await chat.settled();
  }
  expect(judged()).toEqual([
    ["clarification", undefined],
    ["help", undefined],
    ["help", "failed"],
  ]);
  expect(
    (await dataRoot.readState(COURSE)).units.limits?.openQuestion?.assisted,
  ).toBe(true);
});

test("a unit reopened after a restart resumes its scripted tutor; one whose session is not the script's starts fresh, and so does the learner's Start fresh", async () => {
  const before = setUp();
  await approvedCourse(before.dataRoot);
  const first = await before.units.open(COURSE, "limits");
  if (!first.ok) throw new Error(first.error);
  await first.chat.settled();
  await before.units.close();
  const fresh = (chat: UnitChat) =>
    chat.events().filter((e) => e.type === "fresh_start");

  const resumed = await setUp().units.open(COURSE, "limits");
  if (!resumed.ok) throw new Error(resumed.error);
  await resumed.chat.settled();
  expect(fresh(resumed.chat)).toEqual([]);

  const position = (await before.dataRoot.readState(COURSE)).units.limits;
  if (position === undefined) throw new Error("No position.");
  await before.dataRoot.writePosition(COURSE, "limits", {
    ...position,
    tutorSessionId: "lost",
  });
  const after = setUp();
  const lost = await after.units.open(COURSE, "limits");
  if (!lost.ok) throw new Error(lost.error);
  await lost.chat.settled();
  expect(fresh(lost.chat)).toEqual([
    { type: "fresh_start", reason: "not-resumed" },
  ]);

  expect(await lost.chat.startFresh()).toEqual({ ok: true });
  await lost.chat.settled();
  expect(lost.chat.events().at(-2)).toEqual({
    type: "tutor_text",
    text: '**Scripted fresh start.** Unit 1 of 2, "Limits"; segment 1 of 2, "The idea", on "limits-idea". Phase: discuss.',
  });
  await after.units.close();
});

test("a unit whose session is the script's broken one opens, and every message fails to resume it, until the learner starts fresh", async () => {
  const before = setUp();
  await approvedCourse(before.dataRoot);
  const first = await before.units.open(COURSE, "limits");
  if (!first.ok) throw new Error(first.error);
  await first.chat.settled();
  await before.units.close();
  const position = (await before.dataRoot.readState(COURSE)).units.limits;
  if (position === undefined) throw new Error("No position.");
  await before.dataRoot.writePosition(COURSE, "limits", {
    ...position,
    tutorSessionId: BROKEN_SESSION,
  });

  const after = setUp();
  const opened = await after.units.open(COURSE, "limits");
  if (!opened.ok) throw new Error(opened.error);
  const { chat } = opened;
  await chat.settled();
  expect(chat.events().at(-1)).toEqual({
    type: "phase",
    segment: 0,
    phase: "discuss",
  });
  for (const text of ["Hello?", "Hello again?"]) {
    chat.say(text);
    await chat.settled();
    expect(chat.events().at(-1)).toMatchObject({
      type: "turn_end",
      outcome: "error",
      error: expect.stringMatching(
        /^The conversation with the tutor could not be resumed: /,
      ),
    });
  }

  expect(await chat.startFresh()).toEqual({ ok: true });
  await chat.settled();
  expect(chat.events().at(-2)).toEqual({
    type: "tutor_text",
    text: '**Scripted fresh start.** Unit 1 of 2, "Limits"; segment 1 of 2, "The idea", on "limits-idea". Phase: discuss.',
  });
  await after.units.close();
});

test("/packages asks to install the names after it, pytest if none; the turn with the answer says how it ended", async () => {
  const installed: (readonly string[])[] = [];
  const { dataRoot, units } = setUp({
    installer: createPackageInstaller({
      run: async (command) => {
        installed.push(command.argv);
        return {
          exitCode: 0,
          timedOut: false,
          stdout: "",
          stderr: "",
          cut: false,
        };
      },
      cacheFolder: join(dir, "cache"),
      python: "/opt/python/bin/python3",
    }),
  });
  await approvedCourse(dataRoot);
  const opened = await units.open(COURSE, "limits");
  if (!opened.ok) throw new Error(opened.error);
  const { chat } = opened;
  await chat.settled();
  const request = () => {
    const card = chat.events().findLast((e) => e.type === "packages_requested");
    if (card?.type !== "packages_requested") throw new Error("no request");
    return card;
  };
  const lastText = () => chat.events().findLast((e) => e.type === "tutor_text");

  expect(chat.say("Set up the tests. /packages")).toEqual({ ok: true });
  await chat.settled();
  expect(request().packages).toEqual([{ name: "pytest" }]);
  expect(await chat.installPackages(request().requestId)).toEqual({ ok: true });
  await chat.settled();
  expect(installed).toEqual([expect.arrayContaining(["uv", "add", "pytest"])]);
  expect(lastText()).toEqual({
    type: "tutor_text",
    text: "**Scripted:** the packages: they are installed.",
  });

  expect(chat.say("/packages numpy sympy")).toEqual({ ok: true });
  await chat.settled();
  expect(request().packages).toEqual([{ name: "numpy" }, { name: "sympy" }]);
  expect(await chat.declinePackages(request().requestId)).toEqual({ ok: true });
  await chat.settled();
  expect(installed).toHaveLength(1);
  expect(lastText()).toEqual({
    type: "tutor_text",
    text: '**Scripted:** the packages: you said "Not now", so they are not installed.',
  });
});

test('the scripted dispute judge keeps a grade unless the reason has "/change", changes it both ways with the key following, and fails on "/fail"', async () => {
  const judge = createDisputeJudge({
    backend: createScriptedBackend(),
    systemPrompt: "Decide.",
  });
  const choice = (picked: "A" | "B"): AnswerEvidence => ({
    kind: "answer",
    recordedAt: "2026-11-17T10:00:00.000Z",
    objective: "limits-idea",
    question: {
      kind: "choice",
      prompt: "What is $1 + 1$?",
      choices: ["$2$", "$3$", "$1$"],
      answer: "A",
    },
    answer: {
      kind: "choice",
      questionId: "q",
      choice: picked,
      confidence: "75",
    },
    assisted: false,
    verdict: picked === "A" ? "correct" : "incorrect",
  });
  const written: AnswerEvidence = {
    kind: "answer",
    recordedAt: "2026-11-17T10:00:00.000Z",
    objective: "limits-proof",
    question: { kind: "written", prompt: "Why?", rubric: "Because." },
    answer: {
      kind: "written",
      questionId: "w",
      text: "Because.",
      confidence: "50",
    },
    assisted: false,
    verdict: "correct",
  };

  // The grade stands, and with it the key: no correction is kept.
  expect(await judge.decide(choice("B"), "B is right.")).toEqual({
    ok: true,
    outcome: {
      verdict: "incorrect",
      reason:
        'Scripted: the grade stands, since the reason does not have "/change" in it.',
    },
  });
  expect(await judge.decide(choice("B"), "/change: B is right.")).toEqual({
    ok: true,
    outcome: {
      verdict: "correct",
      reason:
        'Scripted: the reason has "/change" in it, so the grade is changed.',
      key: "B",
    },
  });
  expect(await judge.decide(choice("A"), "/change I guessed.")).toMatchObject({
    ok: true,
    outcome: { verdict: "incorrect", key: "B" },
  });
  expect(
    await judge.decide(written, "/change It proves nothing."),
  ).toMatchObject({
    ok: true,
    outcome: { verdict: "incorrect" },
  });
  expect(await judge.decide(written, "/fail")).toEqual({
    ok: false,
    error: "The scripted dispute judge was told to fail.",
  });
});
