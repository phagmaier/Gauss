import { expect, test } from "vitest";
import type { Unit } from "../shared/curriculum.ts";
import type { PageEvent } from "../shared/events.ts";
import type { CourseWithProgress } from "../shared/library.ts";
import type { Plan } from "../shared/plan.ts";
import type { ObjectiveStatus } from "../shared/status.ts";
import {
  closingCard,
  divided,
  helpNotice,
  judgmentSays,
  nextStep,
  openQuestion,
  outline,
  phaseMarker,
  placement,
  whereInUnit,
} from "./session.ts";
import {
  emptyTimeline,
  type Item,
  type JudgmentItem,
  type Position,
  reduce,
  type Timeline,
} from "./timeline.ts";

const PLAN: Plan = {
  objectives: [
    { id: "power-rule", statement: "Differentiate a power of x." },
    { id: "product-rule", statement: "Apply the product rule." },
    { id: "chain-rule", statement: "Apply the chain rule." },
  ],
  segments: [
    { title: "Powers", objectives: ["power-rule"] },
    { title: "Products", objectives: ["product-rule"] },
    { title: "The chain rule", objectives: ["chain-rule"] },
  ],
};

function play(events: PageEvent[]): Timeline {
  return events.reduce(
    (state, event, index) => reduce(state, { type: "event", index, event }),
    reduce(emptyTimeline, { type: "hello", chatId: "chat-1" }),
  );
}

const planned: PageEvent = { type: "unit_plan", plan: PLAN };
const phase = (
  segment: number,
  p: "teach" | "discuss" | "check" | "closed",
  again?: string[],
): PageEvent => ({
  type: "phase",
  segment,
  phase: p,
  ...(again === undefined ? {} : { again }),
});

// --- The top line and the outline ------------------------------------------

test.each<
  [
    string,
    Position | null,
    Timeline["finished"],
    ReturnType<typeof whereInUnit>,
  ]
>([
  [
    "the first segment",
    { segment: 0, phase: "teach" },
    null,
    { label: "Segment 1 of 3", ticks: ["now", "", ""] },
  ],
  [
    "a middle segment, closed",
    { segment: 1, phase: "closed" },
    null,
    { label: "Segment 2 of 3", ticks: ["past", "now", ""] },
  ],
  [
    "the segment that goes over objectives again",
    { segment: 3, phase: "discuss", again: ["chain-rule"] },
    null,
    { label: "Going over again", ticks: ["past", "past", "now"] },
  ],
  [
    "a finished unit",
    { segment: 2, phase: "closed" },
    "passed",
    { label: "Finished", ticks: ["past", "past", "past"] },
  ],
  [
    "a finished unit opened again, with no position",
    null,
    "overridden",
    { label: "Finished", ticks: ["past", "past", "past"] },
  ],
])("the top line for %s", (_, position, finished, expected) => {
  expect(whereInUnit(PLAN, position, finished)).toEqual(expected);
});

test("before the unit is open the top line says nothing", () => {
  expect(whereInUnit(PLAN, null, null)).toBeNull();
});

test("the outline marks the segments done and the one in progress, and adds the segment that goes over objectives again", () => {
  expect(outline(PLAN, { segment: 1, phase: "check" }, null)).toEqual([
    { title: "Powers", state: "past" },
    { title: "Products", state: "now" },
    { title: "The chain rule", state: "" },
  ]);
  expect(
    outline(PLAN, { segment: 3, phase: "teach", again: ["chain-rule"] }, null),
  ).toEqual([
    { title: "Powers", state: "past" },
    { title: "Products", state: "past" },
    { title: "The chain rule", state: "past" },
    { title: "Going over again", state: "now" },
  ]);
  expect(outline(PLAN, null, "passed")).toEqual([
    { title: "Powers", state: "past" },
    { title: "Products", state: "past" },
    { title: "The chain rule", state: "past" },
  ]);
});

test("each phase but teaching has a marker; a segment's teaching starts clear of the one before, and going over again says how many", () => {
  expect(phaseMarker({ segment: 0, phase: "teach" }, true)).toBeNull();
  expect(phaseMarker({ segment: 1, phase: "teach" }, false)).toBe(
    "new-segment",
  );
  expect(
    phaseMarker(
      { segment: 3, phase: "teach", again: ["product-rule", "chain-rule"] },
      false,
    ),
  ).toEqual({ name: "Teach", says: "Going over two objectives again." });
  expect(
    phaseMarker({ segment: 3, phase: "teach", again: ["chain-rule"] }, true),
  ).toEqual({ name: "Teach", says: "Going over one objective again." });
  expect(phaseMarker({ segment: 0, phase: "discuss" }, true)).toEqual({
    name: "Discuss",
    says: "Ask anything. Nothing here is graded.",
  });
  expect(phaseMarker({ segment: 0, phase: "check" }, false)).toMatchObject({
    name: "Check",
  });
  expect(phaseMarker({ segment: 0, phase: "closed" }, false)).toEqual({
    name: "Done",
  });
});

// --- The next-step control ---------------------------------------------------

const CHOICE = {
  kind: "choice" as const,
  id: "q1",
  number: 1,
  prompt: "What is the derivative of $x^3$?",
  choices: ["$3x^2$", "$x^2$"],
};
const WRITTEN = {
  kind: "written" as const,
  id: "q2",
  number: 2,
  prompt: "Prove the product rule.",
};
const PROOF = {
  kind: "written" as const,
  questionId: "q2",
  text: "Add and subtract.",
  confidence: "50" as const,
};
const MISS: PageEvent = {
  type: "graded",
  questionId: "q1",
  verdict: "incorrect",
  answer: { kind: "choice", questionId: "q1", choice: "B", confidence: "90" },
  correctChoice: "A",
  assisted: false,
};

test.each<[string, PageEvent[], ReturnType<typeof nextStep>]>([
  ["while the unit opens", [], null],
  ["while it is planned", [{ type: "unit_planning" }], null],
  [
    "after it failed to open",
    [{ type: "unit_failed", error: "No plan." }],
    "try-again",
  ],
  ["in teach", [planned, phase(0, "teach")], null],
  ["in discuss", [planned, phase(0, "discuss")], "ready"],
  ["in the check", [planned, phase(0, "check")], "move-on"],
  [
    "in the check with a question open",
    [planned, phase(0, "check"), { type: "question", question: CHOICE }],
    "move-on",
  ],
  [
    "while a written answer is graded",
    [
      planned,
      phase(0, "check"),
      { type: "question", question: WRITTEN },
      { type: "grading", questionId: "q2", answer: PROOF },
    ],
    null,
  ],
  [
    "while an answer waits for a reply to be judged",
    [
      planned,
      phase(0, "check"),
      { type: "question", question: CHOICE },
      {
        type: "answer_waiting",
        questionId: "q1",
        answer: {
          kind: "choice",
          questionId: "q1",
          choice: "A",
          confidence: "90",
        },
      },
    ],
    null,
  ],
  [
    "after its grading failed",
    [
      planned,
      phase(0, "check"),
      { type: "question", question: WRITTEN },
      { type: "grading", questionId: "q2", answer: PROOF },
      { type: "grading_failed", questionId: "q2", error: "Timed out." },
    ],
    null,
  ],
  [
    "once it is graded",
    [
      planned,
      phase(0, "check"),
      { type: "question", question: WRITTEN },
      { type: "grading", questionId: "q2", answer: PROOF },
      {
        type: "graded",
        questionId: "q2",
        verdict: "correct",
        answer: PROOF,
        assisted: false,
      },
    ],
    "move-on",
  ],
  [
    "in a detour after a miss",
    [
      planned,
      phase(0, "check"),
      { type: "question", question: CHOICE },
      MISS,
      { type: "detour", questionId: "q1", number: 1 },
    ],
    "detour",
  ],
  [
    "once the learner asked for another question",
    [
      planned,
      phase(0, "check"),
      { type: "question", question: CHOICE },
      MISS,
      { type: "detour", questionId: "q1", number: 1 },
      { type: "detour_end" },
    ],
    "move-on",
  ],
  [
    "a segment closed before the last",
    [planned, phase(1, "closed")],
    "next-segment",
  ],
  // The closing card holds the steps.
  ["the last segment closed", [planned, phase(2, "closed")], null],
  [
    "the extra segment closed",
    [planned, phase(3, "closed", ["chain-rule"])],
    null,
  ],
  [
    "a unit passed at its closing card",
    [
      planned,
      phase(2, "closed"),
      { type: "unit_end", passed: true, objectives: {} },
      { type: "unit_closed", status: "passed" },
    ],
    null,
  ],
  [
    "a unit moved on from at its closing card",
    [
      planned,
      phase(2, "closed"),
      { type: "unit_end", passed: false, objectives: {} },
      { type: "unit_closed", status: "overridden" },
    ],
    "leave",
  ],
  [
    "a finished unit opened again",
    [planned, { type: "unit_closed", status: "passed" }],
    "leave",
  ],
])("the next step %s", (_, events, step) => {
  expect(nextStep(play(events))).toBe(step);
});

// --- The thread ---------------------------------------------------------------

const said = (text: string): PageEvent[] => [
  { type: "turn_start" },
  { type: "tutor_text", text },
  { type: "turn_end", outcome: "done" },
];
const asked = (question: typeof CHOICE | typeof WRITTEN): PageEvent[] => [
  { type: "turn_start" },
  { type: "tutor_text", text: "Now one on powers." },
  { type: "question", question },
  { type: "turn_end", outcome: "done" },
];
const right: PageEvent = {
  type: "graded",
  questionId: "q1",
  verdict: "correct",
  answer: { kind: "choice", questionId: "q1", choice: "A", confidence: "90" },
  correctChoice: "A",
  assisted: false,
};

test.each<[string, PageEvent[], string | undefined]>([
  ["a question being answered", [...asked(CHOICE)], "q1"],
  [
    "a written answer waiting for its grade",
    [
      ...asked(WRITTEN),
      { type: "grading", questionId: "q2", answer: PROOF },
      { type: "grading_failed", questionId: "q2", error: "Timed out." },
    ],
    "q2",
  ],
  ["no question once the last is graded", [...asked(CHOICE), right], undefined],
  [
    "the next question after a graded one",
    [...asked(CHOICE), right, ...said("Right."), ...asked(WRITTEN)],
    "q2",
  ],
  [
    "no question once it is withdrawn",
    [
      ...asked(CHOICE),
      {
        type: "overridden",
        segment: 0,
        objectives: ["power-rule"],
        withdrawnQuestionId: "q1",
      },
    ],
    undefined,
  ],
  // A question is open only in a check, whatever the thread kept.
  [
    "no question once the segment closed",
    [...asked(CHOICE), phase(0, "closed")],
    undefined,
  ],
])("the open question: %s", (_, events, id) => {
  const timeline = play([planned, phase(0, "check"), ...events]);
  expect(openQuestion(timeline)?.question.id).toBe(id);
});

test("lines divide the messages of a thread, but not the parts of one exchange", () => {
  const timeline = play([
    planned,
    phase(0, "teach"),
    ...said("A power of $x$ comes down."),
    phase(0, "discuss"),
    { type: "learner", text: "Why does the power drop?" },
    { type: "learner", text: "And for $x^0$?" },
    ...said("Because each factor contributes one."),
    phase(0, "check"),
    ...asked(CHOICE),
    right,
    ...said("Right: $3x^2$."),
    ...asked(WRITTEN),
    { type: "learner", text: "What may I assume?" },
    { type: "turn_start" },
    { type: "tutor_text", text: "The limit laws" },
    { type: "turn_end", outcome: "interrupted" },
    { type: "learner", text: "Thanks." },
  ]);
  const lines = timeline.items.map((item, i) => {
    const line = divided(timeline.items[i - 1], item) ? "-- " : "";
    return `${line}${item.kind}`;
  });
  expect(lines).toEqual([
    "phase", // teach, at the top: no marker
    "tutor", // the teaching, at the top
    "phase", // Discuss
    "learner", // after a marker
    "learner", // the learner's second message in a row
    "-- tutor",
    "phase", // Check
    "tutor", // the lead-in, after a marker
    "question", // with its lead-in
    "tutor", // the feedback, with its question
    "-- tutor", // the next lead-in
    "question",
    "-- learner",
    "-- tutor",
    "note", // "Stopped." belongs to the reply it stopped
    "-- learner",
  ]);
});

test("the judge's call belongs to the reply it judged: no line above it, and one between it and the next message", () => {
  const timeline = play([
    planned,
    phase(0, "check"),
    ...asked(CHOICE),
    { type: "learner", id: "m1", text: "What does the cube mean?" },
    ...said("The third power."),
    { type: "judging", learnerId: "m1", number: 1 },
    { type: "learner", id: "m2", text: "Thanks." },
  ]);
  const lines = timeline.items.map((item, i) => {
    const line = divided(timeline.items[i - 1], item) ? "-- " : "";
    return `${line}${item.kind}`;
  });

  expect(lines.slice(-4)).toEqual([
    "-- learner",
    "-- tutor",
    "judgment",
    "-- learner",
  ]);
});

test("the line for each file the tutor wrote, and the reference to each artifact it showed, stand where it wrote or showed them, in its reply: no line around them inside the reply, one before the learner's next message", () => {
  const timeline = play([
    planned,
    phase(0, "check"),
    { type: "turn_start" },
    { type: "tutor_text", text: "A starter file for you." },
    { type: "file_written", path: "bpe.py" },
    { type: "tutor_text", text: "Fill in `merge`." },
    { type: "file_written", path: "data/words.txt" },
    { type: "question", question: CHOICE },
    { type: "turn_end", outcome: "done" },
    { type: "learner", text: "Which file?" },
    { type: "turn_start" },
    { type: "tutor_text", text: "This one, with a comment." },
    { type: "file_written", path: "bpe.py" },
    { type: "turn_end", outcome: "done" },
    { type: "learner", text: "Thanks." },
    { type: "turn_start" },
    { type: "tutor_text", text: "A picture of a merge." },
    { type: "artifact", file: "1-a-merge.html", title: "A merge" },
    { type: "tutor_text", text: "Try another pair." },
    { type: "turn_end", outcome: "done" },
    { type: "learner", text: "Done." },
  ]);
  const lines = timeline.items.map((item, i) => {
    const line = divided(timeline.items[i - 1], item) ? "-- " : "";
    const said =
      item.kind === "file"
        ? item.path
        : item.kind === "artifact"
          ? item.title
          : item.kind === "tutor" || item.kind === "learner"
            ? item.text
            : item.kind;
    return `${line}${said}`;
  });

  expect(lines.slice(1)).toEqual([
    "A starter file for you.",
    "bpe.py",
    "Fill in `merge`.",
    "data/words.txt",
    "question",
    "-- Which file?",
    "-- This one, with a comment.",
    "bpe.py",
    "-- Thanks.",
    "-- A picture of a merge.",
    "A merge",
    "Try another pair.",
    "-- Done.",
  ]);
});

test.each<[string, PageEvent[], string | undefined]>([
  [
    "while a question is being answered",
    [...asked(CHOICE)],
    "Asking what question 1 means is free. If the tutor's reply helps you toward the answer, your answer counts as given with help and not toward passing.",
  ],
  [
    "not while a written answer is graded, since a message then is not help",
    [...asked(WRITTEN), { type: "grading", questionId: "q2", answer: PROOF }],
    undefined,
  ],
  [
    "not while an answer waits for the judge",
    [
      ...asked(WRITTEN),
      { type: "answer_waiting", questionId: "q2", answer: PROOF },
    ],
    undefined,
  ],
  ["not once the question is graded", [...asked(CHOICE), right], undefined],
  [
    "not in a detour",
    [...asked(CHOICE), MISS, { type: "detour", questionId: "q1", number: 1 }],
    undefined,
  ],
])("the message box's notice: %s", (_, events, notice) => {
  expect(helpNotice(play([planned, phase(0, "check"), ...events]))).toBe(
    notice,
  );
});

test.each<
  [string, Partial<Pick<JudgmentItem, "verdict" | "unjudged">>, string, string]
>([
  [
    "being judged",
    {},
    "Checking whether this reply helped with question 3",
    "judging",
  ],
  [
    "help",
    { verdict: "help" },
    "Judged help: your answer to question 3 will not count toward passing.",
    "help",
  ],
  [
    "a failed call",
    { verdict: "help", unjudged: "failed" },
    "This reply could not be judged, so it counts as help: your answer to question 3 will not count toward passing.",
    "help",
  ],
  [
    "a call a restart cut off",
    { verdict: "help", unjudged: "restart" },
    "The server stopped before this reply was judged, so it counts as help: your answer to question 3 will not count toward passing.",
    "help",
  ],
])("the line under a reply %s", (_, call, text, tone) => {
  expect(
    judgmentSays({
      kind: "judgment",
      key: 1,
      learnerId: "m1",
      number: 3,
      ...call,
    }),
  ).toEqual({ text, tone });
});

test("a clarification after help describes only that reply, without promising the answer still counts", () => {
  const timeline = play([
    planned,
    phase(0, "check"),
    ...asked(CHOICE),
    { type: "learner", id: "m1", text: "How do I start?" },
    ...said("Bring the exponent down."),
    { type: "judged", learnerId: "m1", number: 1, verdict: "help" },
    { type: "learner", id: "m2", text: "Thanks." },
    ...said("You're welcome."),
    { type: "judged", learnerId: "m2", number: 1, verdict: "clarification" },
  ]);
  const judgments = timeline.items
    .filter((item) => item.kind === "judgment")
    .map(judgmentSays);

  expect(judgments.map((item) => item.tone)).toEqual(["help", "free"]);
  expect(judgments[1]?.text).toMatch(/clarification/i);
  expect(judgments[1]?.text).toMatch(/reply/i);
  expect(judgments[1]?.text).not.toMatch(
    /your answer|still counts|toward passing/i,
  );
});

test("a question answered below where it was posted begins an exchange there, and the line where it was posted goes with its lead-in", () => {
  const timeline = play([
    planned,
    phase(0, "check"),
    ...asked(CHOICE),
    { type: "learner", text: "Is it 1 + 1?" },
    ...said("Yes, the sum."),
    right,
    ...said("Right: 2."),
  ]);
  const lines = timeline.items.map((item, i) => {
    const line = divided(timeline.items[i - 1], item) ? "-- " : "";
    return `${line}${item.kind}`;
  });
  expect(lines).toEqual([
    "phase",
    "tutor",
    "answered-below",
    "-- learner",
    "-- tutor",
    "-- question",
    "tutor",
  ]);
});

test("a detour's marker stands between a missed question and the tutor's reply, with no line on either side, and the detour is not a question left open", () => {
  const timeline = play([
    planned,
    phase(0, "check"),
    ...asked(CHOICE),
    MISS,
    { type: "detour", questionId: "q1", number: 1 },
    ...said("It is $3x^2$: the exponent comes down."),
  ]);
  const kinds = timeline.items.map((i) => i.kind);
  const lines = timeline.items.map((item, i) =>
    divided(timeline.items[i - 1], item),
  );

  expect(kinds.slice(-3)).toEqual(["question", "detour", "tutor"]);
  expect(lines.slice(-2)).toEqual([false, false]);
  expect(openQuestion(timeline)).toBeUndefined();
});

test("a line goes between the closing card and the messages around it, never at the top", () => {
  const card: Item = {
    kind: "unit_end",
    key: 1,
    passed: true,
    objectives: {},
  };
  const tutor: Item = { kind: "tutor", key: 2, text: "Done." };
  expect(divided(undefined, tutor)).toBe(false);
  expect(divided(tutor, card)).toBe(true);
  expect(divided(card, tutor)).toBe(true);
  expect(divided({ kind: "fresh", key: 3, reason: "learner" }, tutor)).toBe(
    false,
  );
});

// --- The closing card --------------------------------------------------------

const all = (status: ObjectiveStatus) => ({
  "power-rule": status,
  "product-rule": status,
  "chain-rule": status,
});

test("a closing card when every objective passed", () => {
  expect(
    closingCard(PLAN, { passed: true, objectives: all("passed") }),
  ).toMatchObject({
    verdict: { text: "Passed", className: "ok" },
    summary: "All three objectives passed.",
    rows: [
      {
        id: "power-rule",
        statement: "Differentiate a power of x.",
        passed: true,
      },
      {
        id: "product-rule",
        statement: "Apply the product rule.",
        passed: true,
      },
      { id: "chain-rule", statement: "Apply the chain rule.", passed: true },
    ],
    notPassed: 0,
  });
});

test("a closing card when some did not pass says why for each, and how many", () => {
  const card = closingCard(PLAN, {
    passed: false,
    objectives: {
      "power-rule": "passed",
      "product-rule": "attempted",
      "chain-rule": "overridden",
    },
  });

  expect(card.verdict).toEqual({ text: "Two not passed", className: "warn" });
  expect(card.summary).toBe("One of three objectives passed.");
  expect(card.rows).toEqual([
    {
      id: "power-rule",
      statement: "Differentiate a power of x.",
      passed: true,
    },
    {
      id: "product-rule",
      statement: "Apply the product rule.",
      passed: false,
      why: "Its check ended before it passed",
    },
    {
      id: "chain-rule",
      statement: "Apply the chain rule.",
      passed: false,
      why: "You moved on before it passed",
    },
  ]);
  expect(card.notPassed).toBe(2);
  expect(card.again).toBe("Go over the two again");
  expect(card.movedOn).toBe(
    "You moved on. The unit is recorded as overridden, and the two objectives stay not passed.",
  );
});

test("once moved on from, the card's verdict is overridden", () => {
  expect(
    closingCard(PLAN, {
      passed: false,
      objectives: all("overridden"),
      stepTaken: "moved-on",
    }),
  ).toMatchObject({
    verdict: { text: "Overridden", className: "warn" },
    summary: "None of the three objectives passed.",
  });
});

test("a unit of one objective, not passed, is spoken of in the singular", () => {
  const one: Plan = {
    objectives: [{ id: "bayes", statement: "Apply Bayes' theorem." }],
    segments: [{ title: "Bayes", objectives: ["bayes"] }],
  };

  expect(
    closingCard(one, { passed: false, objectives: { bayes: "attempted" } }),
  ).toMatchObject({
    verdict: { text: "One not passed", className: "warn" },
    summary: "Its one objective did not pass.",
    again: "Go over it again",
    movedOn:
      "You moved on. The unit is recorded as overridden, and its objective stays not passed.",
  });
  expect(
    closingCard(one, { passed: true, objectives: { bayes: "passed" } }).summary,
  ).toBe("Its one objective passed.");
});

test("more objectives than there are number words are counted in digits", () => {
  const ids = Array.from({ length: 12 }, (_, i) => `o${i + 1}`);
  const big: Plan = {
    objectives: ids.map((id) => ({ id, statement: `Objective ${id}.` })),
    segments: ids.map((id) => ({ title: id, objectives: [id] })),
  };
  const objectives = Object.fromEntries(
    ids.map((id, i) => [id, i < 11 ? "attempted" : "passed"] as const),
  );

  expect(closingCard(big, { passed: false, objectives })).toMatchObject({
    verdict: { text: "11 not passed" },
    summary: "One of 12 objectives passed.",
    again: "Go over the 11 again",
  });
});

// --- Where the unit sits in its course ---------------------------------------

const unit = (id: string, title: string, prerequisites: string[]): Unit => ({
  id,
  title,
  goal: `The goal of ${title}.`,
  prerequisites,
});
// Units 2 and 3 both build on unit 1 only.
const UNITS = [
  unit("limits", "Limits", []),
  unit("derivatives", "Derivatives", ["limits"]),
  unit("integrals", "Integrals", ["limits"]),
];
const course = (
  progress: CourseWithProgress["progress"] = {},
): CourseWithProgress => ({
  id: "calculus",
  course: {
    title: "Calculus I",
    backend: "claude",
    settings: { webSearch: false },
    createdAt: "2026-11-14T09:00:00.000Z",
    lastOpenedAt: "2026-11-15T09:00:00.000Z",
  },
  curriculum: {
    approval: { status: "approved", approvedAt: "2026-11-14T10:00:00.000Z" },
    units: UNITS,
  },
  progress,
});
const IN_PROGRESS = { status: "in-progress", segment: 0 } as const;

// The unit to start next is the one the course view's card would lead to
// once this unit is finished: the first not started whose prerequisites are
// finished, counting this one finished (progress.ts).
test("a unit's place in its course: its number, the course's size, and the unit to start next", () => {
  expect(placement(course({ limits: IN_PROGRESS }), "limits")).toEqual({
    courseTitle: "Calculus I",
    title: "Limits",
    number: 1,
    count: 3,
    next: { number: 2, unit: UNITS[1] },
    finishesCourse: false,
  });
  // Unit 2 is started already, so it is passed over.
  expect(
    placement(course({ derivatives: IN_PROGRESS }), "limits")?.next,
  ).toEqual({ number: 3, unit: UNITS[2] });
  // Unit 2 was started before the unit it builds on: unit 1 comes next.
  expect(placement(course(), "derivatives")?.next).toEqual({
    number: 1,
    unit: UNITS[0],
  });
});

test("with no unit left to start, a unit finishes the course only if every other one is finished", () => {
  expect(
    placement(
      course({
        limits: { status: "passed" },
        integrals: { status: "overridden" },
      }),
      "derivatives",
    ),
  ).toMatchObject({ number: 2, next: null, finishesCourse: true });
  expect(
    placement(
      course({ limits: { status: "passed" }, integrals: IN_PROGRESS }),
      "derivatives",
    ),
  ).toMatchObject({ next: null, finishesCourse: false });
});

test("a course not loaded, or a unit not in it, has no place: never taken for the course's last unit", () => {
  // Not loaded yet, or its load failed.
  expect(placement(undefined, "limits")).toBeUndefined();
  // No such course.
  expect(placement(null, "limits")).toBeUndefined();
  expect(
    placement({ ...course(), curriculum: null }, "limits"),
  ).toBeUndefined();
  expect(placement(course(), "elsewhere")).toBeUndefined();
});
