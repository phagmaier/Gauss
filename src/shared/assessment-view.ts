// Assessment markers and results shared by the live thread and its export.

import { capital, word } from "./display-words.ts";
import type { TestShown } from "./events.ts";
import type { AssessmentMode } from "./evidence.ts";
import { firstTaught, type Plan, skipping } from "./plan.ts";
import { confidenceLabel, type QuestionKind } from "./question.ts";
import type {
  AssessmentEndItem,
  AssessmentItem,
  Position,
  TestResultItem,
} from "./timeline.ts";

/** What an assessment is called on the page, capitalised for a marker's name. */
export function assessmentTitle(mode: AssessmentMode): string {
  switch (mode) {
    case "review":
      return "Review";
    case "gate":
      return "Gate";
    case "test-out":
      return "Test";
    case "self-test":
      return "Self-test";
  }
}

/** "unit 2", or "units 1 and 2", or "other units" when the numbers are not known. */
function unitsNamed(from: readonly number[] | undefined): string {
  if (from === undefined || from.length === 0) return "other units";
  const names = from.map(String);
  return from.length === 1
    ? `unit ${names[0]}`
    : `units ${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/** The gate's questions: how many on the unit's own objectives, and how many on other units'. */
function gateSplit(item: Pick<AssessmentItem, "count" | "own">): {
  own: number;
  others: number;
} {
  const own = item.own ?? item.count;
  return { own, others: item.count - own };
}

/** What a review that holds the test before the unit says comes after it. */
const TEST_NEXT = "The test of this unit comes next.";

/** What an assessment's card says while it waits for Start or Skip. */
export function assessmentCard(
  item: Pick<AssessmentItem, "mode" | "count" | "own" | "from" | "testFollows">,
): {
  title: string;
  questions: string;
  says: string[];
  start: string;
  skip: string;
} {
  const questions = item.count === 1 ? "1 question" : `${item.count} questions`;
  if (item.mode === "gate") {
    const { own, others } = gateSplit(item);
    const mine =
      own === 1
        ? "the one objective you passed in this unit that no review has confirmed"
        : `each of the ${word(own)} objectives you passed in this unit that no review has confirmed`;
    const theirs = `${word(others)} on objectives of ${unitsNamed(item.from)}`;
    const asks =
      own === 0
        ? `${capital(word(others))} questions on objectives of ${unitsNamed(item.from)}`
        : others === 0
          ? `A question on ${mine}`
          : `A question on ${mine}, and ${theirs}`;
    return {
      title: "Unit gate",
      questions,
      says: [
        `${asks}, with nothing taught first. A right answer marks its ` +
          "objective retained; a miss is worked through, as in a check.",
        "It waits here, if you would rather take it in another sitting, " +
          "when the answers say more.",
      ],
      start: "Start the gate",
      skip: "Skip the gate",
    };
  }
  return {
    title: assessmentTitle(item.mode),
    questions,
    says: [
      "Questions on objectives you passed in earlier sittings, to see what " +
        "has stayed. Nothing is taught first, and a right answer marks its " +
        "objective retained.",
      item.testFollows
        ? "The test of this unit follows, before anything is taught."
        : "The unit goes on afterwards, where you left it.",
    ],
    start: "Start the review",
    skip: "Skip",
  };
}

/** The marker a card leaves once started, or skipped on the card. */
export function assessmentMarker(item: AssessmentItem): {
  name: string;
  says: string;
} {
  const title = assessmentTitle(item.mode);
  const gate = item.mode === "gate";
  if (item.mode === "test-out") {
    return {
      name: title,
      says: "Questions on this unit's objectives, before anything is taught. Nothing is explained until it ends; each answer is recorded.",
    };
  }
  if (item.mode === "self-test") {
    const kinds =
      item.kinds === undefined
        ? ""
        : `, ${listed(item.kinds, "and")} questions`;
    return {
      name: title,
      says:
        item.count === 1
          ? `One objective${kinds}. Nothing is taught first; each answer is recorded.`
          : `${capital(word(item.count))} objectives${kinds}, mixed. Nothing is taught first; each answer is recorded.`,
    };
  }
  if (item.stage === "skipped") {
    return {
      name: `${title} skipped`,
      says: gate
        ? "What you passed stays passed. Nothing more is marked retained."
        : item.testFollows
          ? TEST_NEXT
          : "The unit goes on where it was.",
    };
  }
  const count =
    item.count === 1
      ? "One question"
      : `${capital(word(item.count))} questions`;
  if (gate) {
    const { own, others } = gateSplit(item);
    const split =
      own === 0 || others === 0
        ? own === 0
          ? ` on objectives of ${unitsNamed(item.from)}`
          : " on this unit"
        : `: ${word(own)} on this unit and ${word(others)} from ${unitsNamed(item.from)}`;
    return {
      name: "Unit gate",
      says: `${count}${split}. Nothing is taught first; each answer is recorded.`,
    };
  }
  return {
    name: title,
    says: `${count} on objectives you passed before. Nothing is taught first; each answer is recorded.`,
  };
}

/**
 * The marker an assessment leaves once it ends, or is skipped partway: what
 * it did to the record, and where the unit goes on.
 */
export function assessmentEndMarker(item: AssessmentEndItem): {
  name: string;
  says: string;
} {
  const title = assessmentTitle(item.mode);
  const gate = item.mode === "gate";
  // After the gate, the closing card says where the unit stands.
  const where = gate ? "" : ` ${goesOn(item.at)}`;
  const statuses = Object.values(item.statuses);
  if (item.mode === "self-test") {
    const passed =
      item.passedOver === undefined
        ? ""
        : item.passedOver === 1
          ? " One objective passed over."
          : ` ${capital(word(item.passedOver))} objectives passed over.`;
    const said = item.skipped
      ? statuses.length === 0
        ? "Ended before any answer."
        : "Ended partway; what you answered is recorded."
      : statusesSaid(statuses);
    return { name: `${title} over`, says: `${said}${passed}${where}` };
  }
  if (item.skipped) {
    return {
      name: `${title} skipped`,
      says: gate
        ? statuses.length === 0
          ? "What you passed stays passed. Nothing more is marked retained."
          : "What you answered is recorded, and what you passed stays passed."
        : statuses.length === 0
          ? where.trimStart()
          : `What you answered is recorded.${where}`,
    };
  }
  return { name: `${title} over`, says: `${statusesSaid(statuses)}${where}` };
}

/** "Two retained, one slipping.", or "All three retained.": what an assessment's answers left. */
function statusesSaid(
  statuses: readonly AssessmentEndItem["statuses"][string][],
): string {
  const counts: [number, string][] = [
    [statuses.filter((s) => s === "retained").length, "retained"],
    [statuses.filter((s) => s === "slipping").length, "slipping"],
    [statuses.filter((s) => s === "passed").length, "passed, not yet retained"],
    [
      statuses.filter(
        (s) => s !== "retained" && s !== "slipping" && s !== "passed",
      ).length,
      "not passed",
    ],
  ];
  const parts = counts.filter(([n]) => n > 0);
  const [only] = parts;
  if (only === undefined) return "Nothing was answered.";
  if (parts.length === 1 && only[0] === 2) return `Both ${only[1]}.`;
  return parts.length === 1 && only[0] > 1
    ? `All ${word(only[0])} ${only[1]}.`
    : `${capital(parts.map(([n, what]) => `${word(n)} ${what}`).join(", "))}.`;
}

/** "choice", "choice and math", "choice, math or code": the kinds as words, in a list. */
function listed(kinds: readonly QuestionKind[], conjunction: "and" | "or") {
  return kinds.length === 1
    ? kinds.join("")
    : `${kinds.slice(0, -1).join(", ")} ${conjunction} ${kinds.at(-1)}`;
}

/**
 * The line a self-test leaves where it passed over an objective (piece 27),
 * after "Passed over:": its statement, ended as a sentence; then that no
 * kind picked fits it, naming the kinds when known, with the tutor's reason
 * as a sentence, and that nothing is recorded. The thread and the export
 * both say it.
 */
export function passedOverLine(item: {
  objective: string;
  reason: string;
  kinds?: readonly QuestionKind[];
  /** The objective's statement, when known. */
  statement: string | undefined;
}): { statement: string; rest: string } {
  const sentence = (text: string) =>
    /[.?!]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`;
  const fits =
    item.kinds === undefined
      ? "No kind of question picked fits it"
      : `No ${listed(item.kinds, "or")} question fits it`;
  return {
    statement: sentence(item.statement ?? `"${item.objective}"`),
    rest: `${fits}, the tutor says: ${capital(sentence(item.reason))} Nothing is recorded.`,
  };
}

/** Where the unit goes on after an assessment, from the phase it was in. */
function goesOn(at: Position | "finished" | null): string {
  if (at === "finished") return "The unit stays finished.";
  if (at === null) return "The unit goes on where it was.";
  if (at.beforeTest) return TEST_NEXT;
  const segment =
    at.again === undefined
      ? `segment ${at.segment + 1}`
      : "the segment going over objectives again";
  switch (at.phase) {
    case "teach":
      return `${capital(segment)} is taught next.`;
    case "discuss":
      return `Back to ${segment}, in its discussion.`;
    case "check":
      return `Back to ${segment}, in its check.`;
    case "closed":
      return `Back to the end of ${segment}.`;
  }
}
// --- The test's result card (piece 16) -----------------------------------------

/** A row of the result card: an objective or a segment, its word, and why. */
export interface ResultRow {
  key: string;
  text: string;
  word: { text: string; className: string };
  why?: string;
}

export interface TestResultCard {
  /** "Two of five passed", "All three passed", "None passed". */
  says: { text: string; className: "ok" | "dk" };
  /** A row for each objective: passed or not, and why. */
  objectives: ResultRow[];
  /** What skipping would do to each segment; none when nothing passed. */
  segments: ResultRow[] | null;
  /** The heading over the segments. */
  segmentsSay: string;
  /** The steps' labels: the one that skips, and the one that teaches the whole unit. */
  skip: string;
  whole: string;
  /** Once answered, the line the card shrinks to. */
  answered?: string;
  /** Once answered by skipping some: where teaching starts. */
  startsAt?: string;
}

/** Why an objective passed or did not, from the test's answers on it (piece 16). */
function testWhy(shown: TestShown): string {
  const [first, second] = shown.answers;
  const sure = (a: TestShown["answers"][number]) =>
    `${confidenceLabel(a.confidence ?? "under-50")} sure${a.assisted ? ", with help" : ""}`;
  const missed = (a: TestShown["answers"][number]) =>
    a.verdict === "unknown" ? "did not know" : "missed";
  if (first === undefined) return "Not asked";
  if (first.verdict !== "correct") return capital(missed(first));
  if (second === undefined) {
    return shown.passed
      ? `Right, ${sure(first)}`
      : `Right once, ${sure(first)}; its second question was not asked`;
  }
  if (second.verdict === "correct") {
    // "Right twice, 50% and 75% sure", as piece 16 has it.
    return first.assisted || second.assisted
      ? `Right twice, ${sure(first)} and ${sure(second)}`
      : `Right twice, ${confidenceLabel(first.confidence ?? "under-50")} and ${sure(second)}`;
  }
  return `Right once, ${sure(first)}, then ${missed(second)}`;
}

export function testResultCard(
  plan: Plan | undefined,
  item: Pick<TestResultItem, "objectives" | "skipped">,
): TestResultCard {
  const shown = new Map(item.objectives.map((o) => [o.objective, o]));
  // A damaged transcript may have a result but no surviving plan.
  const planned =
    plan?.objectives ??
    item.objectives.map(({ objective }) => ({
      id: objective,
      statement: objective,
    }));
  const passed = planned
    .map((o) => o.id)
    .filter((id) => shown.get(id)?.passed === true);
  const total = planned.length;
  const got = passed.length;
  const all = total > 0 && got === total;
  const says = {
    text: all
      ? total === 1
        ? "Passed"
        : `All ${word(total)} passed`
      : got === 0
        ? "None passed"
        : `${capital(word(got))} of ${word(total)} passed`,
    className: all ? ("ok" as const) : ("dk" as const),
  };
  const objectives = planned.map((o): ResultRow => {
    const row = shown.get(o.id);
    const ok = row?.passed === true;
    return {
      key: o.id,
      text: o.statement,
      word: ok
        ? { text: "Passed", className: "pass" }
        : { text: "Not passed", className: "miss" },
      why: row === undefined ? "Not asked" : testWhy(row),
    };
  });
  const statement = new Map(planned.map((o) => [o.id, o.statement]));
  const segments =
    got === 0 || plan === undefined
      ? null
      : skipping(plan, passed).map((left, i): ResultRow => {
          const text = `${i + 1}. ${plan.segments[i]?.title ?? ""}`;
          if (left.teaches.length === 0) {
            return {
              key: String(i),
              text,
              word: { text: "Skipped", className: "skip" },
            };
          }
          return left.leftOut.length === 0
            ? { key: String(i), text, word: { text: "Taught", className: "" } }
            : {
                key: String(i),
                text,
                word: { text: "Taught in part", className: "" },
                why: `Only: ${left.teaches.map((id) => statement.get(id) ?? id).join(" ")}`,
              };
        });
  const card: TestResultCard = {
    says,
    objectives,
    segments,
    segmentsSay: all
      ? "If you finish the unit here"
      : "If you skip what you passed",
    skip: all ? "Finish the unit" : "Skip what I passed",
    whole:
      got === 0
        ? "Start the unit"
        : all
          ? "Teach me the unit anyway"
          : "Teach me the whole unit",
  };
  const { skipped } = item;
  if (skipped === undefined) return card;
  if (skipped.length === 0)
    return { ...card, answered: "Teaching the whole unit." };
  if (plan === undefined)
    return { ...card, answered: "Skipping what you passed." };
  const first = firstTaught(plan, skipped);
  if (first === undefined)
    return { ...card, answered: "Finished without teaching." };
  const part = (skipping(plan, skipped)[first]?.leftOut.length ?? 0) > 0;
  return {
    ...card,
    answered: "Skipping what you passed.",
    startsAt:
      `Teaching starts at segment ${first + 1}` +
      (part ? ", which leaves out what you passed in it" : "") +
      ".",
  };
}
