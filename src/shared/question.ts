// Check questions: what the tutor posts, what the record keeps, what the page
// shows, and what the learner sends back. Four answer kinds: multiple choice,
// graded by the engine; math, an expression compared with the expected one by
// the symbolic check (task 3.5); written answers (proofs, derivations,
// explanations), graded against a rubric by a separate model call (task 2.8);
// and code, files in the course's workspace the learner edits, graded by
// running the tutor's tests on them (task 3.7).

import { z } from "zod";
import { Slug } from "./course.ts";

/** Choices are labelled by position, and the tutor names them the same way. */
export const CHOICE_LETTERS = ["A", "B", "C", "D", "E", "F"] as const;
export const ChoiceLetter = z.enum(CHOICE_LETTERS);
export type ChoiceLetter = z.infer<typeof ChoiceLetter>;

/**
 * How sure the learner is, in the five levels of brief.md, lowest first.
 * Use this list for their order: the enum's `options` puts "under-50" last,
 * since an object lists keys such as "50" before the others.
 */
export const CONFIDENCE_LEVELS = ["under-50", "50", "75", "90", "100"] as const;
export const Confidence = z.enum(CONFIDENCE_LEVELS);
export type Confidence = z.infer<typeof Confidence>;

export function confidenceLabel(confidence: Confidence): string {
  return confidence === "under-50" ? "under 50%" : `${confidence}%`;
}

/** "Confident" means 90% or 100% (brief.md, "Confidence"). */
export function isConfident(confidence: Confidence): boolean {
  return confidence === "90" || confidence === "100";
}

// --- The fields, described for the tutor -------------------------------------

const prompt = z
  .string()
  .min(1)
  .describe(
    "The question, in Markdown, with LaTeX math between $ signs. For a choice question, do not list the choices here.",
  );
const choices = z
  .array(z.string().min(1))
  .min(2)
  .max(CHOICE_LETTERS.length)
  .describe(
    "Choice questions only: the choices, each one line of Markdown with LaTeX math between $ signs. The app shuffles them before the learner sees them, labelled A, B, C and so on, and its reply gives the order shown.",
  );
const answer = ChoiceLetter.describe(
  "Choice questions only: the letter of the correct choice, in the order given here; the app moves it with the choice when it shuffles them. Never shown to the learner.",
);
const rubric = z
  .string()
  .min(1)
  .describe(
    "Written questions only: how to grade the answer, for a grader who sees only the question, this rubric and the answer. Say what a complete, correct answer must establish, step by step, and the errors or gaps that make it wrong. Never shown to the learner.",
  );

const expected = z
  .string()
  .trim()
  .min(1)
  .max(1000)
  .describe(
    "Math questions only: the expected answer, in LaTeX without $ signs, shown once graded. With symbolic grading, use one expression, one equation or values separated by commas (`3x^2`, `\\frac{1}{2}`, `x = 2`). With grader grading, give the answer that meets all conditions in the prompt.",
  );

const mathGrading = z
  .enum(["symbolic", "grader"])
  .describe(
    'Required for math questions. Use "symbolic" only if any equivalent form is correct under the app’s defaults (including correctly rounded decimals with at least three significant figures and unordered sets), with no special precision, exactness, form, order, domain or variable assumptions. Use "grader" if any of these restrictions applies, if the notation is unsupported, or if in doubt. State all restrictions in the prompt.',
  );

// --- Code questions (task 3.7) -----------------------------------------------

/** The longest file of a code question: a test, the solution, a learner's file as run. */
export const CODE_FILE_LIMIT = 100_000;

/** The workspace's folders where no file of a question can be. */
const RESERVED_FOLDERS = new Set([".venv", ".claude", ".git"]);
const PATH_WORD = /^[A-Za-z0-9._-]+$/;

/**
 * A file's path in the course's workspace, relative to it: words of
 * letters, digits, ".", "_" and "-" separated by "/", never "." or "..",
 * and not in the workspace's environment or Claude Code's folder.
 */
export const WorkspacePath = z
  .string()
  .min(1)
  .max(200)
  .superRefine((path, ctx) => {
    const words = path.split("/");
    if (words.some((w) => !PATH_WORD.test(w) || w === "." || w === "..")) {
      ctx.addIssue({
        code: "custom",
        message: `"${path}" is not a path in the workspace: write it relative to the workspace, as words of letters, digits, ".", "_" and "-" separated by "/" (\`bpe.py\`, \`tests/test_bpe.py\`).`,
      });
    } else if (RESERVED_FOLDERS.has(words[0] ?? "")) {
      ctx.addIssue({
        code: "custom",
        message: `"${path}" is in ${words[0]}, where no file of a question can be.`,
      });
    }
  });

/** A file of a code question, with its whole text. */
export const CodeFile = z.object({
  path: WorkspacePath.describe("Its path in the workspace, relative to it."),
  content: z.string().max(CODE_FILE_LIMIT).describe("Its whole text."),
});
export type CodeFile = z.infer<typeof CodeFile>;

export const SavedCodeInput = CodeFile.extend({
  executable: z.literal(true).optional(),
});
export type SavedCodeInput = z.infer<typeof SavedCodeInput>;

const files = z
  .array(WorkspacePath)
  .min(1)
  .max(5)
  .describe(
    "Code questions only: the files the learner edits, by their paths in the course's workspace, your working folder (`bpe.py`). Write the starter version of each there with your Write tool before you post: what the learner starts from, which the tests must fail on. The card shows each with its full path.",
  );
const tests = z
  .array(CodeFile)
  .min(1)
  .max(5)
  .describe(
    "Code questions only: the test files, each with its path and whole text. Never write them in the workspace: the app keeps them and runs them, and the learner sees only their output, once the answer is graded.",
  );
const dependencies = z
  .array(WorkspacePath)
  .max(5)
  .describe(
    "Code questions only: paths of workspace files the tests or solution need besides the learner's files, such as helpers, data and launchers. Write these first as plain UTF-8 files. The app saves their contents and whether they are executable when you post, and runs use that copy. Do not list installed packages in `.venv`.",
  );
const solution = z
  .array(CodeFile)
  .min(1)
  .max(5)
  .describe(
    "Code questions only: your solution, each file of `files` by the same path, as a correct answer would leave it. The tests must pass on it. Never shown to the learner.",
  );
const command = z
  .array(z.string().max(1000))
  .min(1)
  .max(40)
  .refine((words) => (words[0] ?? "").trim() !== "", {
    message: "The command's first word is the program to run.",
  })
  .describe(
    'Code questions only: the command that runs the tests, as its words, with no shell: [".venv/bin/python", "-m", "pytest", "-q", "test_bpe.py"]. It runs in a folder containing only the learner files, tests, saved dependencies and a read-only link to the workspace\'s `.venv` if present. Exit status 0 means correct. It must finish within 60 seconds.',
  );

/** The fields a code question must have. */
const REQUIRED_CODE_FIELDS = ["files", "tests", "solution", "command"] as const;
const CODE_FIELDS = [...REQUIRED_CODE_FIELDS, "dependencies"] as const;

/**
 * What is wrong with a code question's files: the solution gives each file
 * the learner edits once, and no two files share a path or sit inside each
 * other.
 */
function codeIssues(
  q: {
    files: string[];
    tests: CodeFile[];
    solution: CodeFile[];
    dependencies?: string[] | undefined;
    inputs?: CodeFile[] | undefined;
  },
  issue: (path: string, message: string) => void,
): void {
  if (new Set(q.files).size !== q.files.length) {
    issue("files", "Each file the learner edits is named once.");
  }
  const solved = q.solution.map((f) => f.path);
  if (
    new Set(solved).size !== solved.length ||
    solved.length !== new Set(q.files).size ||
    solved.some((path) => !q.files.includes(path))
  ) {
    issue(
      "solution",
      "The solution gives each file of `files` once, by the same path, and no other file.",
    );
  }
  const tested = q.tests.map((f) => f.path);
  if (new Set(tested).size !== tested.length) {
    issue("tests", "Each test file has a path of its own.");
  }
  if (tested.some((path) => q.files.includes(path))) {
    issue("tests", "A test file cannot be one of the files the learner edits.");
  }
  const all = [...new Set([...q.files, ...tested])];
  const extra = q.dependencies ?? q.inputs?.map((f) => f.path) ?? [];
  const extraField = q.inputs === undefined ? "dependencies" : "inputs";
  if (new Set(extra).size !== extra.length) {
    issue(extraField, "Each dependency has a path of its own.");
  }
  if (extra.some((path) => all.includes(path))) {
    issue(
      extraField,
      "A dependency cannot be a file the learner edits or a test file.",
    );
  }
  all.push(...extra);
  const nested = all.find((a) => all.some((b) => b.startsWith(`${a}/`)));
  if (nested !== undefined) {
    issue(
      extra.some((path) => path === nested || path.startsWith(`${nested}/`))
        ? extraField
        : "tests",
      `"${nested}" cannot be a file and a folder of files at once.`,
    );
  }
}

function answerIsAChoice(q: {
  choices: string[];
  answer: ChoiceLetter;
}): boolean {
  return CHOICE_LETTERS.indexOf(q.answer) < q.choices.length;
}
const NOT_A_CHOICE = "The answer must be the letter of one of the choices.";

// --- What the tutor posts ----------------------------------------------------

/**
 * A question as the tutor posts it with ask_question, grading material
 * included. One object for both kinds, because a tool's input is described
 * by its fields; which fields a kind takes is checked here.
 */
export const QuestionInput = z
  .object({
    objective: Slug.describe(
      "The id of the objective the question checks: one of the segment's objectives, as the header lists them",
    ),
    kind: z
      .enum(["choice", "math", "written", "code"])
      .describe(
        '"choice": the learner picks one of the choices, graded against `answer`. "math": the learner types an expression, graded against `expected` according to `mathGrading`. "written": the learner writes the answer (a proof, a derivation, an explanation), graded against `rubric` by a separate grader. "code": the learner edits `files` in the workspace, graded by running `tests` with `command`.',
      ),
    prompt,
    choices: choices.optional(),
    answer: answer.optional(),
    expected: expected.optional(),
    mathGrading: mathGrading.optional(),
    rubric: rubric.optional(),
    files: files.optional(),
    tests: tests.optional(),
    dependencies: dependencies.optional(),
    solution: solution.optional(),
    command: command.optional(),
  })
  .superRefine((q, ctx) => {
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: "custom", path: [path], message });
    if (q.kind !== "math" && q.mathGrading !== undefined) {
      issue("mathGrading", "Only a math question has a math grading policy.");
    }
    if (q.kind === "code") {
      for (const field of REQUIRED_CODE_FIELDS) {
        if (q[field] === undefined) {
          issue(
            field,
            "A code question needs the files the learner edits, the tests, your solution and the command that runs the tests.",
          );
        }
      }
      for (const field of [
        "choices",
        "answer",
        "expected",
        "rubric",
      ] as const) {
        if (q[field] !== undefined) {
          issue(
            field,
            "A code question has no choices, answer letter, expected expression or rubric: its tests grade it.",
          );
        }
      }
      const { files, tests, solution, dependencies } = q;
      if (
        files !== undefined &&
        tests !== undefined &&
        solution !== undefined
      ) {
        codeIssues({ files, tests, solution, dependencies }, issue);
      }
      return;
    }
    const code = CODE_FIELDS.find((field) => q[field] !== undefined);
    if (code !== undefined) {
      issue(
        code,
        "Only a code question has files, tests, a solution, a command and dependencies.",
      );
    }
    if (q.kind === "choice") {
      if (q.choices === undefined) {
        issue("choices", "A choice question needs its choices.");
      }
      if (q.answer === undefined) {
        issue("answer", "A choice question needs the letter of its answer.");
      }
      if (
        q.choices !== undefined &&
        q.answer !== undefined &&
        !answerIsAChoice({ choices: q.choices, answer: q.answer })
      ) {
        issue("answer", NOT_A_CHOICE);
      }
      if (q.rubric !== undefined || q.expected !== undefined) {
        issue(
          q.rubric !== undefined ? "rubric" : "expected",
          "A choice question has no rubric and no expected expression: its answer letter grades it.",
        );
      }
    } else if (q.kind === "math") {
      if (q.expected === undefined) {
        issue(
          "expected",
          "A math question needs the expected answer to compare with.",
        );
      }
      if (q.mathGrading === undefined) {
        issue(
          "mathGrading",
          'A math question must choose "symbolic" or "grader" grading.',
        );
      }
      if (q.choices !== undefined || q.answer !== undefined) {
        issue(
          q.choices !== undefined ? "choices" : "answer",
          "A math question has no choices and no answer letter: the learner types the answer.",
        );
      }
      if (q.rubric !== undefined) {
        issue(
          "rubric",
          "A math question has no rubric: its expected answer grades it.",
        );
      }
    } else {
      if (q.rubric === undefined) {
        issue("rubric", "A written question needs a rubric to be graded by.");
      }
      if (q.choices !== undefined || q.answer !== undefined) {
        issue(
          q.choices !== undefined ? "choices" : "answer",
          "A written question has no choices and no answer letter: the learner writes the answer.",
        );
      }
      if (q.expected !== undefined) {
        issue(
          "expected",
          "A written question has no expected expression: its rubric grades it.",
        );
      }
    }
  });
export type QuestionInput = z.infer<typeof QuestionInput>;

// --- What the record keeps ---------------------------------------------------

/**
 * A posted question as the record keeps it, in `state.json` while it is open
 * and in the evidence once answered: what the learner saw and the grading
 * material. The objective it checks is kept beside it, by id.
 */
export const ChoiceQuestion = z
  .object({ kind: z.literal("choice"), prompt, choices, answer })
  .refine(answerIsAChoice, { message: NOT_A_CHOICE, path: ["answer"] });
export type ChoiceQuestion = z.infer<typeof ChoiceQuestion>;

export const MathQuestion = z.object({
  kind: z.literal("math"),
  prompt,
  expected,
  // Older questions did not declare that symbolic grading was applicable.
  mathGrading: mathGrading.optional(),
});
export type MathQuestion = z.infer<typeof MathQuestion>;

export const WrittenQuestion = z.object({
  kind: z.literal("written"),
  prompt,
  rubric,
});
export type WrittenQuestion = z.infer<typeof WrittenQuestion>;

/**
 * A code question (task 3.7): the files the learner edits in the workspace,
 * and the grading material, kept here and never in the workspace: the
 * tests, the tutor's solution, the captured dependency files and the command
 * that runs the tests.
 */
export const CodeQuestion = z
  .object({
    kind: z.literal("code"),
    prompt,
    files,
    tests,
    solution,
    command,
    /** Missing only from questions stored before dependency snapshots. */
    inputs: z.array(SavedCodeInput).max(5).optional(),
  })
  .superRefine((q, ctx) =>
    codeIssues(q, (path, message) =>
      ctx.addIssue({ code: "custom", path: [path], message }),
    ),
  );
export type CodeQuestion = z.infer<typeof CodeQuestion>;

export const Question = z.discriminatedUnion("kind", [
  ChoiceQuestion,
  MathQuestion,
  WrittenQuestion,
  CodeQuestion,
]);
export type Question = z.infer<typeof Question>;

/**
 * The question a checked input describes, as the record keeps it: the
 * fields of its kind, the objective left beside it.
 */
export function postedQuestion({
  objective: _,
  ...fields
}: QuestionInput): Question {
  return Question.parse(fields);
}

// --- What the page sees and sends --------------------------------------------

/**
 * Where a question of an assessment stands in it, for its card's head
 * (piece 15): in a review or a gate its `number` is its objective's place
 * among the `of` it asks about; in a test (piece 16) the number counts the
 * test's questions, and `objective` gives its objective's place.
 */
export const AssessmentHead = z.object({
  of: z.number().int().positive(),
  /** In a test: its objective's place among the `of`, from 1. */
  objective: z.number().int().positive().optional(),
  /** The second question on its objective: after a miss, or in a test after a correct answer that does not pass alone. */
  second: z.literal(true).optional(),
  /** The unit whose objective it is, when that is another unit. */
  from: z
    .object({ number: z.number().int().positive(), title: z.string() })
    .optional(),
});
export type AssessmentHead = z.infer<typeof AssessmentHead>;

/** What every question the page sees has. */
const ViewBase = {
  id: z.string(),
  number: z.number().int().positive(),
  prompt: z.string(),
  /** Set for a question of an assessment, and only there. */
  assessment: AssessmentHead.optional(),
};

/**
 * A posted question as the page sees it: never the answer letter, the
 * expected expression, the rubric, or a code question's tests, solution,
 * captured dependencies or command.
 */
export const QuestionView = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("choice"),
    ...ViewBase,
    choices: z.array(z.string()),
  }),
  z.object({ kind: z.literal("math"), ...ViewBase }),
  z.object({ kind: z.literal("written"), ...ViewBase }),
  z.object({
    kind: z.literal("code"),
    ...ViewBase,
    /** The files the learner edits, by their full paths. */
    files: z.array(z.string()),
  }),
]);
export type QuestionView = z.infer<typeof QuestionView>;

/**
 * The learner's thinking sent with an answer, optional on every kind but
 * "I don't know". Never graded: the grader and a code question's tests see
 * only the answer, so a false start written here is no flaw of it. The
 * tutor, the handoff writer, the dispute judge and the learner's record
 * see it.
 */
const reasoning = z.string().max(10_000).optional();

/** A written answer as the learner sends it. */
export const WrittenAnswer = z.object({
  kind: z.literal("written"),
  questionId: z.string(),
  text: z.string().trim().min(1).max(20_000),
  confidence: Confidence,
  reasoning,
});
export type WrittenAnswer = z.infer<typeof WrittenAnswer>;

/**
 * An answer to a math question: an expression as typed in the math field,
 * LaTeX or plain, which the symbolic check reads (task 3.5).
 */
export const MathAnswer = z.object({
  kind: z.literal("math"),
  questionId: z.string(),
  expression: z.string().trim().min(1).max(1000),
  confidence: Confidence,
  reasoning,
});
export type MathAnswer = z.infer<typeof MathAnswer>;

/**
 * "Run the tests" on a code question, as the page sends it (task 3.7). The
 * engine reads the learner's files from the workspace then.
 */
export const CodeRun = z.object({
  kind: z.literal("code"),
  questionId: z.string(),
  confidence: Confidence,
  reasoning,
});
export type CodeRun = z.infer<typeof CodeRun>;

/**
 * A code answer as the record keeps it: the learner's files as they were
 * when "Run the tests" was pressed, which the tests run on.
 */
export const CodeAnswer = CodeRun.extend({
  files: z.array(CodeFile).min(1),
});
export type CodeAnswer = z.infer<typeof CodeAnswer>;

/** An answer graded outside the chat's queue: a written, math or code one. */
export const GradedAnswer = z.discriminatedUnion("kind", [
  WrittenAnswer,
  MathAnswer,
  CodeAnswer,
]);
export type GradedAnswer = z.infer<typeof GradedAnswer>;

const ChoiceAnswer = z.object({
  kind: z.literal("choice"),
  questionId: z.string(),
  choice: ChoiceLetter,
  confidence: Confidence,
  reasoning,
});

/** "I don't know", which asks no confidence and can say where the learner got stuck (task 2.20). */
const UnknownAnswer = z.object({
  kind: z.literal("unknown"),
  questionId: z.string(),
  /** Where the learner got stuck, in their words; the tutor is given it. */
  stuck: z.string().trim().min(1).max(10_000).optional(),
});

/** The learner's answer as the record keeps it, or "I don't know". */
export const AnswerSubmission = z.discriminatedUnion("kind", [
  ChoiceAnswer,
  MathAnswer,
  WrittenAnswer,
  CodeAnswer,
  UnknownAnswer,
]);
export type AnswerSubmission = z.infer<typeof AnswerSubmission>;

/**
 * The learner's answer as the page sends it: as the record keeps it, except
 * that a code answer is only "Run the tests", whose files the engine reads.
 */
export const AnswerPost = z.discriminatedUnion("kind", [
  ChoiceAnswer,
  MathAnswer,
  WrittenAnswer,
  CodeRun,
  UnknownAnswer,
]);
export type AnswerPost = z.infer<typeof AnswerPost>;

/**
 * "Open" on a code question's card (task 3.22): which of the question's
 * files, by its place in the card's list. Never a path, so the server opens
 * only a file the question lists.
 */
export const OpenFilePost = z.object({
  file: z.number().int().nonnegative(),
});
export type OpenFilePost = z.infer<typeof OpenFilePost>;

/** "unknown" is the learner's "I don't know": a miss, never a confident one. */
export const Verdict = z.enum(["correct", "incorrect", "unknown"]);
export type Verdict = z.infer<typeof Verdict>;

/**
 * Why the symbolic check did not settle a math answer, which the grader then
 * graded against a rubric made from the expected expression (task 3.5): it
 * was not used, could not read the answer, could not decide within its limits,
 * or failed. The reason says why.
 */
export const Unsettled = z.object({
  result: z.enum(["unparsable", "undecided", "failed", "skipped"]),
  reason: z.string().min(1),
});
export type Unsettled = z.infer<typeof Unsettled>;

// --- What the grader returns -------------------------------------------------

/**
 * The grader's reply on a written answer (architecture.md section 6), asked
 * of the model as JSON in this shape and checked against it. A flaw named on
 * a correct answer is not kept.
 */
export const WrittenGrade = z
  .object({
    verdict: z
      .enum(["correct", "incorrect"])
      .describe(
        '"correct" only if the answer establishes everything the question asks, with every step valid; otherwise "incorrect".',
      ),
    flaw: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe(
        "Required when the verdict is incorrect: the first flawed step or the first missing element, pointed at so the learner can find it, and what is wrong with it, in one or two sentences. Not how to repair it, and nothing about later steps. Leave it out when the answer is correct.",
      ),
  })
  .refine((g) => g.verdict === "correct" || g.flaw !== undefined, {
    message:
      "An incorrect verdict must name the first flawed step or missing element.",
    path: ["flaw"],
  });
export type WrittenGrade = z.infer<typeof WrittenGrade>;

// --- What the help judge returns ---------------------------------------------

/**
 * Whether the tutor's reply to a message the learner sent while a question
 * was open helped toward its answer (task 2.21; architecture.md section 4).
 * The judge sees the question with its answer key or rubric, the message
 * and the reply, and nothing else.
 */
export const HelpJudgment = z.object({
  reason: z
    .string()
    .trim()
    .min(1)
    .describe(
      "One or two sentences: what the reply gave the learner that bears on the answer, if anything. Written before the verdict, and never shown to the learner.",
    ),
  verdict: z
    .enum(["clarification", "help"])
    .describe(
      '"help" if the reply gave anything toward the answer: a method, a step, a value, a similar worked example, a mistake to avoid, or a hint that an answer the learner proposed is right or wrong. "clarification" if it only explained what the question asks (its wording, its notation, the form of answer wanted), or gave nothing that bears on the answer.',
    ),
});
export type HelpJudgment = z.infer<typeof HelpJudgment>;
