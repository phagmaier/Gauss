// A backend that needs no model and no script written ahead: it reads each
// turn's header and does what the header allows (task 2.12b). It runs the dev
// server of scripts/dev-fake.ts, for browser checks that spend no plan usage,
// on the fake backend's machinery (fake.ts), so tool calls run the real
// teaching tools and a turn can be stopped.
//
// What it does, by the tools its session has:
//
// - An intake (propose_curriculum): asks a question in reply to the
//   learner's first message, where the engine refuses a proposal (task
//   2.22), and proposes four units in reply to the next, titled from the
//   first message, with that reply as the background note. "/one-off" in
//   either message proposes one unit, and "/large" thirty, for checking
//   how a large course reads. Later messages are answered in text;
//   "/revise" proposes a revision with one unit fewer. Its learner profile
//   (task 5.8) is the one it was given, with its sentence saying what was
//   asked for last replaced by one for this course, and a first sentence
//   of its own when there was none. A turn that tells it of the sources
//   (`<sources>`, task 4.6) starts its reply with what it was told: the
//   title and number of sections of each source attached, each removed,
//   and each file refused. Its units read the sections of the sources it
//   was told of, in order, each unit the next ones up to an even share and
//   the most a unit reads.
// - A unit's planning (plan_unit): two segments of one objective each,
//   which split the unit's sections between them when it has any. The
//   first objective is checked by choice questions, and every second
//   question on it is a math question (task 3.5) when the session has the
//   file and shell tools, which it has when the sandbox runs, as the
//   symbolic check needs; the second objective is checked by written ones.
//   In a course whose title has the word "code" or "coding" in it, every
//   question on the first objective is a code question (task 3.7), where
//   the sandbox runs: the tutor writes its starter file,
//   `exercise_<objective>_<n>.py` in the workspace, whose `times(x)`
//   returns 0, and the tests pass once it returns n times x. It never
//   writes over a file there: n goes on past one, such as the draft a
//   skipped question left.
// - A unit's tutor (ask_question): gives feedback alone on a graded answer
//   (the engine then asks for the next question, or closes the segment,
//   task 2.16a), opens the detour a miss starts with a reply that repeats
//   where an "I don't know" got stuck (the learner then asks for another
//   question, task 2.20), posts a question when the header allows one, in a
//   check or an assessment (task 5.4: review, a gate or a self-test, where
//   it asks as in a review, except that in a self-test with only code
//   picked it passes over, with pass_over_objective and a reason, each
//   objective it would not ask with code: every one outside a coding
//   course, and a "-proof" one in it),
//   teaches in the teach phase, first reading with read_section each
//   section the header says the segment draws on (task 4.8) and, in a
//   source segment, presenting a lecture with
//   present_lecture, quoting counting.md's s3 twice when it reads that
//   section, and otherwise replies in text, which after a fresh start says
//   where the unit stands. In the test before a unit (task 5.6),
//   the turn with an answer's grade posts the next question with no
//   feedback, and the turn that ends the test says in a line what it showed;
//   a later turn whose header says that word is owed gives it first (after
//   a fresh start's greeting), then replies to the learner's message, if
//   there is one. A message with photos is answered first by saying how
//   many it sees.
//   Its questions on an objective are numbered past those the header lists
//   as asked before, so none repeats one, whichever unit's thread asked it.
//   A choice question asks for a sum, and the right choice is that sum; the
//   engine shuffles the choices (task 2.17), so its letter varies. A math
//   question asks for a sum of terms in x, and any expression equal to it
//   is right.
// - Artifacts (task 3.6): the teaching of a unit's first segment shows one,
//   a tangent to a parabola that a slider moves, with a button that tries
//   to reach the app and the web and says what was refused, and "Ask about
//   this", which puts a question on the point shown into the message box
//   (task 5.23); so does a reply to a message with "/artifact" in it, which
//   the engine refuses while a question is open. "/broken-aid" shows one
//   whose script throws as it loads (task 5.20).
// - Quotes (task 4.9): a message with "/quote" in it quotes the rest of its
//   line with quote_source, as the tutor of a course with a source can; the
//   engine refuses it while a question is open, or when the sources lack it.
// - Web search (task 4.11): a message with "/search" in it searches the web
//   for the rest of its line, finding five pages, and cites the first, in a
//   course that allows web search; in another, it says that it cannot. The
//   engine refuses it while a question is open.
// - Packages (task 3.11): a message with "/packages" in it asks to install
//   the names that follow it on its line, `pytest` if none, which the
//   engine refuses while a question is open; Install really installs them,
//   from PyPI. The turn with the learner's answer says how it ended.
// - Style (task 5.11): a message with "/style" in it proposes a style note:
//   the course's own, as the session's system prompt has it, with its last
//   sentence dropped when it has more than one and a sentence on shorter
//   explanations added. The engine refuses it while a question is open.
// - Curriculum (task 5.12): a message with "/amend" in it proposes the
//   course's latest units, with a practice unit added at the end that
//   builds on the unit taught. The engine refuses it while a question is open.
// - Planning from the course view (task 5.38; amend_curriculum without
//   ask_question): asks a question in reply to the learner's first message,
//   and in reply to the next proposes the course's units with two more
//   after the last, "Next stretch, part 1" and "part 2". While that
//   proposal waits, messages are answered in text; "/revise" proposes one
//   unit more instead of two. "/drop" in any message proposes the units
//   without the first, which the engine refuses once that unit has started.
//   "/read" proposes the units with one more that reads the first section
//   of the newest source attached in the conversation and not removed
//   (piece 26).
// - "/hold" in any message from the learner keeps the turn open until it is
//   stopped.
//
// A written answer is graded correct unless it has the word "wrong" in it;
// "/fail" in it fails the grading. The symbolic check grades a math answer;
// one it cannot read (`2x \oops`) goes to the scripted grader, which grades
// it the same way (`2x \wrong` is incorrect, `/fail` fails). The tutor's reply to a message sent while
// a question is open (task 2.21) is judged clarification if the message has
// the word "mean" in it ("What does $h$ mean?"), and help otherwise; "/fail"
// in the message fails the judging, which counts as help. A message with
// "/hold" keeps its reply open, so an answer sent meanwhile waits for the
// judging, which comes once the reply is stopped.
//
// The handoff writer (task 5.7), called when a segment closes or a unit
// finishes, writes a note that counts what it read, numbered on from the
// note before, and finds a misconception on each detour's objective when
// it can quote a short excerpt of the missed answer's first line. After
// "I don't know" the engine leaves the misconception out. "/nohandoff"
// in a learner's message fails the call, which records nothing: the next
// one reads that stretch too.
//
// The notes writer (task 5.9) supplies a small standalone page with a
// figure and math, repeating any instructions from the learner. The cheat
// sheet writer supplies a page that names each unit it was given, in
// order, with math, and repeats the instructions.
//
// A dispute of a grade (task 3.8) is decided by the scripted judge: the
// grade stands unless the learner's reason has "/change" in it, which
// changes it; for a choice question changed to correct, the key becomes the
// choice picked, and changed to incorrect, the first other choice. After an
// "I don't know", "/change" in the reason corrects the answer shown: a
// choice's key becomes the first other choice, and a math question's
// expected answer gains "+ 1". "/fail" in the reason fails the call, which
// records nothing.
//
// Every session it starts in a folder (a unit's tutor, an intake) is kept,
// across restarts too, so a unit reopened after a restart resumes its tutor
// (task 2.14), and an idle session closed is resumed (task 2.15). Replace a
// unit's `tutorSessionId` in state.json with an unknown id, with the server
// stopped, to see it start fresh. Replace the trailing UUID with `broken`
// to see another failure: the unit opens, but messages fail to resume its
// tutor until the learner starts fresh.

import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { CheatSheetReply } from "../../shared/cheat-sheet.ts";
import type { PlannerProposal, Unit } from "../../shared/curriculum.ts";
import { DisputeJudgment } from "../../shared/dispute.ts";
import { HandoffReply } from "../../shared/handoff.ts";
import { MISCONCEPTION_WORDS_LIMIT } from "../../shared/misconception.ts";
import { NotesReply } from "../../shared/notes.ts";
import { photoCount } from "../../shared/photo.ts";
import type { Plan } from "../../shared/plan.ts";
import { sentences } from "../../shared/profile.ts";
import { CHOICE_LETTERS, HelpJudgment } from "../../shared/question.ts";
import {
  type PresentLectureInput,
  UNIT_TEXT_LIMIT,
} from "../../shared/source.ts";
import {
  LATE_TEST_SUMMARY,
  QUESTION_HISTORY_START,
  SEGMENT_SECTION_REFS,
} from "../engine/unit-turns.ts";
import { sandboxPython } from "../sandbox-command.ts";
import type { TeachingTool } from "../tools/tool.ts";
import type { EngineTurn, OneShotRequest, SessionOptions } from "./backend.ts";
import {
  createFakeBackend,
  FAKE_SESSION,
  type FakeBackend,
  type FakeReply,
  type FakeStep,
} from "./fake.ts";

// Dev restarts need no separate session log: the id carries its folder's
// fingerprint and a unique suffix. Same-folder lookup survives a restart.
function sessionPrefix(cwd: string): string {
  return `${FAKE_SESSION}${createHash("sha256").update(cwd).digest("hex")}-`;
}

/** A session id found in this folder that always fails to resume. */
export function brokenSessionId(cwd: string): string {
  return `${sessionPrefix(cwd)}broken`;
}

/** The scripted backend; with `keepsTools`, a Codex course's, whose sessions keep their tools. */
export function createScriptedBackend(
  options: { keepsTools?: boolean } = {},
): FakeBackend {
  const backend = createFakeBackend(scriptedTurn, scriptedReply, {
    kept: {
      create: (cwd) => `${sessionPrefix(cwd)}${randomUUID()}`,
      has: (id, cwd) => id.startsWith(sessionPrefix(cwd)),
    },
    keepsTools: options.keepsTools === true,
  });
  return {
    ...backend,
    async startSession(options) {
      if (
        options.resumeId?.endsWith("-broken") &&
        options.cwd !== undefined &&
        options.resumeId === brokenSessionId(options.cwd)
      ) {
        throw new Error("The scripted backend cannot resume this session.");
      }
      return backend.startSession(options);
    },
  };
}

/** The id of the objective a unit's plan checks with written questions ends so. */
const WRITTEN = "-proof";

/**
 * The plan the scripted planning gives a unit, and the seed gives its units.
 * Its two segments split the unit's sections, when it has any, in order:
 * the first half to the first, the rest to the second, and a lone section
 * to both.
 */
export function scriptedPlan(
  unitId: string,
  sections: readonly string[] = [],
): Plan {
  // Room for the suffix within an id's 60 characters, and no hyphen doubled.
  const stem = unitId.slice(0, 50).replace(/-+$/, "");
  const idea = `${stem}-idea`;
  const proof = `${stem}${WRITTEN}`;
  const half = Math.ceil(sections.length / 2);
  const reads = (part: readonly string[]) =>
    sections.length === 0
      ? {}
      : { sections: part.length === 0 ? [...sections] : [...part] };
  return {
    objectives: [
      {
        id: idea,
        statement: `State the main idea of "${unitId}": $a^2 + b^2 = c^2$.`,
      },
      {
        id: proof,
        statement: `Explain why the main idea of "${unitId}" holds.`,
      },
    ],
    segments: [
      {
        title: "The idea",
        objectives: [idea],
        ...reads(sections.slice(0, half)),
      },
      {
        title: "Why it holds",
        objectives: [proof],
        ...reads(sections.slice(half)),
      },
    ],
  };
}

function scriptedTurn(
  { text, learnerMessage = "", images = [] }: EngineTurn,
  session: SessionOptions,
): FakeStep[] {
  const { header, body } = parts(text);
  const has = (tool: string) => session.tools.some((t) => t.name === tool);
  if (has("plan_unit")) return planning(body);
  const course =
    has("amend_curriculum") && has("ask_question")
      ? listedCourse(session, header)
      : undefined;
  // A message's photos are counted first, whatever the reply goes on to do.
  const sees: FakeStep[] =
    images.length === 0
      ? []
      : [{ text: `**Scripted:** I see ${photoCount(images.length)}.` }];
  // A composed body can include files, test output or other engine context.
  if (/(^|\s)\/hold\b/.test(learnerMessage)) {
    return [
      ...sees,
      { text: "Holding this turn open until you stop it." },
      { hold: true },
    ];
  }
  // The course's planner has the change tool, and no questions to ask.
  const amend = session.tools.find((t) => t.name === "amend_curriculum");
  if (amend !== undefined && !has("ask_question")) {
    return coursePlanning(header, body, learnerMessage, amend);
  }
  const propose = session.tools.find((t) => t.name === "propose_curriculum");
  if (propose !== undefined) {
    return intake(header, body, learnerMessage, propose);
  }
  const tools = session.workspace !== undefined;
  const coding =
    tools &&
    /^The course is "[^"\n]*\bcod(e|ing)\b/im.test(session.systemPrompt);
  const historyAt = header.lastIndexOf(QUESTION_HISTORY_START);
  const controls = historyAt === -1 ? header : header.slice(0, historyAt);
  const history = historyAt === -1 ? "" : header.slice(historyAt);
  // A word on the test owed since its turn failed comes first, after a
  // fresh start's greeting, then the reply to what the learner wrote,
  // whatever it asks for.
  if (header.includes(LATE_TEST_SUMMARY)) {
    const said = learnerMessage.trim();
    const fresh = header.indexOf(" The learner started a fresh conversation");
    return [
      ...sees,
      ...(fresh === -1
        ? []
        : [{ text: `**Scripted fresh start.** ${header.slice(1, fresh)}` }]),
      testWord(header, "above"),
      ...(said === ""
        ? []
        : [{ text: `A scripted reply to "${said.slice(0, 200)}".` }]),
    ];
  }
  const searching = /(?:^|\s)\/search\b(.*)$/m.exec(learnerMessage);
  if (searching !== null) {
    return [
      ...sees,
      ...webSearch(searching[1] ?? "", session.webSearch === true),
    ];
  }
  return [
    ...sees,
    ...teaching(
      controls,
      history,
      body,
      learnerMessage,
      tools ? (coding ? "code" : "math") : "none",
      session.cwd,
      courseStyle(session.systemPrompt),
      course,
    ),
  ];
}

/** The tutor's word on the test before a unit, from what its header says it showed. */
function testWord(header: string, card: "above" | "below"): FakeStep {
  const passed = (header.match(/" passed \(/g) ?? []).length;
  const asked = (header.match(/" (not )?passed \(/g) ?? []).length;
  return {
    text:
      `**Scripted word on the test:** you passed ${passed} of its ${asked} ` +
      `objectives. The card ${card} says what that would skip; you choose.`,
  };
}

/** "/search" in a tutor's session (task 4.11): five pages found, the first cited. */
function webSearch(line: string, allowed: boolean): FakeStep[] {
  if (!allowed) {
    return [{ text: "Scripted: this course does not allow web search." }];
  }
  const query = line.trim() || "the true is the whole";
  const results = [1, 2, 3, 4, 5].map((n) => ({
    title: `Scripted page ${n} on ${query}`,
    url: `https://example.org/scripted/${n}`,
  }));
  return [
    { search: query, results },
    {
      text: `Scripted: from the search, [the first page](${results[0]?.url}).`,
    },
  ];
}

/** A turn's header, between its brackets, and what follows it. */
function parts(text: string): { header: string; body: string } {
  const end = text.indexOf("]\n");
  return end === -1
    ? { header: text, body: "" }
    : { header: text.slice(0, end + 1), body: text.slice(end + 2) };
}

// --- Planning a unit -------------------------------------------------------

function planning(body: string): FakeStep[] {
  // The curriculum's JSON line precedes the source text.
  const context = /^The curriculum, in order, as JSON\.[^\n]*\n(\{[^\n]*\})$/m;
  const json = context.exec(body)?.[1];
  if (json !== undefined) {
    const { unitToPlan, units } = JSON.parse(json) as {
      unitToPlan: string;
      units: Pick<Unit, "id" | "sections">[];
    };
    const unit = units.find((u) => u.id === unitToPlan);
    if (unit !== undefined) {
      return [
        { call: "plan_unit", input: scriptedPlan(unit.id, unit.sections) },
      ];
    }
  }
  return [
    { text: "The scripted planner could not find the unit in its turn." },
  ];
}

// --- The intake ------------------------------------------------------------

const STYLE = "Scripted: a short explanation, then one question at a time.";

/**
 * Each intake's first message, by its propose_curriculum tool, which is the
 * same across the intake's sessions (a resumed one too) and no other's.
 */
const firstMessages = new WeakMap<TeachingTool, string>();

/** The profile each intake's planner was last given, by its tool; none when it had none. */
const profiles = new WeakMap<TeachingTool, { text: string | undefined }>();

/** The sentence of a scripted profile that says what was asked for last. */
const ASKED_LAST = "Scripted: asked last for ";

/** The profile proposed: the one given, with what was asked for last said anew. */
function scriptedProfile(given: string | undefined, title: string): string {
  const kept = sentences(given ?? "").filter((s) => !s.startsWith(ASKED_LAST));
  return [
    ...(kept.length === 0
      ? ["Scripted: a learner of the scripted backend."]
      : kept),
    `${ASKED_LAST}${JSON.stringify(title)}.`,
  ].join(" ");
}

/** The profile and source blocks that can precede an intake message. */
function intakeContext(body: string): {
  profile?: { text: string | undefined };
  sources?: string;
} {
  const learner = leadingBlock(body, "about_the_learner");
  const rest = learner?.after ?? body;
  const sources = leadingBlock(rest, "sources");
  const given =
    learner === undefined
      ? undefined
      : /<profile>\n([\s\S]*)\n<\/profile>/.exec(learner.block)?.[1];
  return {
    ...(learner === undefined ? {} : { profile: { text: given } }),
    ...(sources === undefined ? {} : { sources: sources.block }),
  };
}

/** The block of this tag at the text's start, and what follows it. */
function leadingBlock(
  text: string,
  tag: string,
): { block: string; after: string } | undefined {
  const open = `<${tag}>\n`;
  const close = `\n</${tag}>\n\n`;
  const end = text.indexOf(close);
  if (!text.startsWith(open) || end === -1) return undefined;
  return {
    block: text.slice(open.length, end),
    after: text.slice(end + close.length),
  };
}

/** A JSON string at the start of a match: a title or a file's name, quoted. */
const QUOTED = String.raw`("(?:[^"\\]|\\.)*")`;

/** What the planner says it was told by a sources block; nothing for none. */
function sourcesSaid(block: string): string | undefined {
  const said = block.split("\n\n").flatMap((item) => {
    const attached = new RegExp(`^Attached: ${QUOTED}`).exec(item);
    if (attached !== null) {
      const sections = item
        .split("\n")
        .filter((line) => /^\s*- s\d+: /.test(line)).length;
      return [
        `Scripted: I have the outline of ${attached[1]}, ${sections} section${sections === 1 ? "" : "s"}.`,
      ];
    }
    const removed = new RegExp(`^Removed by the learner: ${QUOTED}`).exec(item);
    if (removed !== null)
      return [`Scripted: I will not plan from ${removed[1]}.`];
    const refused = new RegExp(
      `^Not attached: the learner's file ${QUOTED}`,
    ).exec(item);
    if (refused !== null)
      return [`Scripted: ${refused[1]} did not come through.`];
    return [];
  });
  return said.length === 0 ? undefined : said.join(" ");
}

/** A section a planner was told of: how the course names it, and its size. */
interface ToldSection {
  ref: string;
  size: number;
}

/** The sections each intake's planner was told of, by its tool, by source id. */
const toldSections = new WeakMap<TeachingTool, Map<string, ToldSection[]>>();

/** Notes the sources a sources block attaches, with their sections, and those it removes. */
function noteSources(tool: TeachingTool, block: string): void {
  const known = toldSections.get(tool) ?? new Map<string, ToldSection[]>();
  for (const item of block.split("\n\n")) {
    const id = /\(source id "([^"]+)"\)/.exec(item)?.[1];
    if (id === undefined) continue;
    if (item.startsWith("Attached: ")) {
      const lines = item.matchAll(/^\s*- (s\d+): .*, ([\d,]+) characters$/gm);
      known.set(
        id,
        [...lines].map((m) => ({
          ref: `${id}/${m[1]}`,
          size: Number((m[2] ?? "").replaceAll(",", "")),
        })),
      );
    } else if (item.startsWith("Removed by the learner: ")) {
      known.delete(id);
    }
  }
  toldSections.set(tool, known);
}

/**
 * The units, each reading the next of the sections told, in order, as many
 * as an even share and the most a unit reads allow; the sections left over
 * are read by none.
 */
function withSections(
  units: readonly Unit[],
  told: readonly ToldSection[],
): Unit[] {
  const each = Math.ceil(told.length / units.length);
  let next = 0;
  return units.map((unit) => {
    const sections: string[] = [];
    let size = 0;
    for (
      let section = told[next];
      section !== undefined;
      section = told[next]
    ) {
      if (sections.length === each) break;
      if (sections.length > 0 && size + section.size > UNIT_TEXT_LIMIT) break;
      sections.push(section.ref);
      size += section.size;
      next += 1;
    }
    return sections.length === 0 ? unit : { ...unit, sections };
  });
}

function proposal(
  title: string,
  kind: "first" | "revised" | "one-off" | "large",
  background: string,
  profile: string,
): PlannerProposal {
  const unit = (id: string, name: string, prerequisites: string[]) => ({
    id,
    title: name,
    goal: `Use ${name.toLowerCase()} in a small example.`,
    prerequisites,
  });
  if (kind === "one-off") {
    return {
      title,
      units: [unit("basics", "The basics", [])],
      style: STYLE,
      background,
      profile,
    };
  }
  if (kind === "large") {
    // Thirty units in a chain; from the tenth, every fifth also builds on
    // the unit six above it, and from the eighth, every fourth on unit 2,
    // so that long lines crowd the diagram as in a course with stretches.
    const part = (n: number) => `part-${n}`;
    const units = Array.from({ length: 30 }, (_, i) => {
      const n = i + 1;
      const builds = n === 1 ? [] : [part(n - 1)];
      if (n >= 10 && n % 5 === 0) builds.push(part(n - 6));
      if (n >= 8 && n % 4 === 0) builds.push(part(2));
      return unit(part(n), `Part ${n} of the course`, builds);
    });
    return { title, units, style: STYLE, background, profile };
  }
  const units =
    kind === "first"
      ? [
          unit("basics", "The basics", []),
          unit("methods", "Methods", ["basics"]),
          unit("examples", "Worked examples", ["basics"]),
          unit("synthesis", "Putting it together", ["methods", "examples"]),
        ]
      : [
          unit("basics", "The basics", []),
          unit("methods", "Methods", ["basics"]),
          unit("synthesis", "Putting it together", ["methods"]),
        ];
  return { title, units, style: STYLE, background, profile };
}

function intake(
  header: string,
  turnBody: string,
  message: string,
  tool: TeachingTool,
): FakeStep[] {
  const { profile: given, sources } = intakeContext(turnBody);
  if (given !== undefined) profiles.set(tool, given);
  if (sources !== undefined) noteSources(tool, sources);
  const said = sources === undefined ? undefined : sourcesSaid(sources);
  const steps = intakeSteps(header, message, tool);
  return said === undefined ? steps : [{ text: `${said}\n\n` }, ...steps];
}

function intakeSteps(
  header: string,
  body: string,
  tool: TeachingTool,
): FakeStep[] {
  /** The text, without the commands, on one line and short. */
  const plain = (text: string) =>
    text
      .replace(/\/(one-off|revise|large)\b/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80);
  const background = `Scripted. The learner said: ${plain(body) || "nothing"}`;
  const propose = (
    kind: "first" | "revised" | "one-off" | "large",
    title: string,
  ) => {
    const made = proposal(
      title,
      kind,
      background,
      scriptedProfile(profiles.get(tool)?.text, title),
    );
    const told = [...(toldSections.get(tool)?.values() ?? [])].flat();
    return [
      { text: "Here is a scripted curriculum." },
      {
        call: "propose_curriculum",
        input: { ...made, units: withSections(made.units, told) },
      },
    ];
  };
  if (header.startsWith("[Start of the intake")) {
    firstMessages.set(tool, body);
    return [
      {
        text:
          "A scripted question: what do you know about this already, and " +
          "how far should the course go? When you reply, I will propose a " +
          "curriculum: a card with its units, how I would teach them and " +
          "what you told me, which you can push back on or approve.",
      },
    ];
  }
  // Nothing proposed yet: the reply to the question, or a message to a new
  // session that lost the conversation before a proposal.
  if (header.includes("reply, or propose")) {
    const first = firstMessages.get(tool) ?? body;
    const both = `${first} ${body}`;
    const kind = both.includes("/one-off")
      ? "one-off"
      : both.includes("/large")
        ? "large"
        : "first";
    return propose(
      kind,
      plain(first) ||
        (kind === "one-off" ? "Scripted one-off" : "Scripted course"),
    );
  }
  if (body.includes("/revise")) {
    return propose("revised", plain(body) || "Scripted course, revised");
  }
  return [
    {
      text: "A scripted reply. Say /revise for a revised curriculum, or approve the proposal.",
    },
  ];
}

// --- Planning from the course view ----------------------------------------

/**
 * Each planning conversation's latest units, from the last turn that gave
 * the course, by its amend_curriculum tool, which its sessions share.
 */
const plannedUnits = new WeakMap<TeachingTool, Unit[]>();

/** Each planning conversation's waiting sources, each with its first section. */
const attachedSources = new WeakMap<
  TeachingTool,
  { id: string; title: string; section: string }[]
>();

function coursePlanning(
  header: string,
  body: string,
  message: string,
  tool: TeachingTool,
): FakeStep[] {
  const given = /<course>\n[^\n]*\n(\[.*\])\n/.exec(body)?.[1];
  if (given !== undefined) {
    plannedUnits.set(
      tool,
      (JSON.parse(given) as Unit[]).map(
        ({ id, title, goal, prerequisites, sections }) => ({
          id,
          title,
          goal,
          prerequisites,
          ...(sections === undefined ? {} : { sections }),
        }),
      ),
    );
  }
  const attached = /<attached_sources>\n([\s\S]*?)\n<\/attached_sources>/.exec(
    body,
  )?.[1];
  if (attached !== undefined) {
    // The block lists removals, then attachments, then refusals.
    let waiting = attachedSources.get(tool) ?? [];
    for (const [, id] of attached.matchAll(
      /^Removed by the learner: "(?:[^"\\]|\\.)*" \(source id "([^"]+)"\)/gm,
    )) {
      waiting = waiting.filter((source) => source.id !== id);
    }
    for (const [, title = '""', id = "", rest = ""] of attached.matchAll(
      /^Attached: ("(?:[^"\\]|\\.)*") \(source id "([^"]+)"\)[^\n]*\n((?:[ -][^\n]*\n?)*)/gm,
    )) {
      const section = /- (s\d+): /.exec(rest)?.[1];
      if (section !== undefined) {
        waiting = [
          ...waiting.filter((source) => source.id !== id),
          { id, title: JSON.parse(title) as string, section },
        ];
      }
    }
    attachedSources.set(tool, waiting);
  }
  const units = plannedUnits.get(tool) ?? [];
  const last = units.at(-1)?.id;
  const added = (count: number) => {
    const ids = new Set(units.map((unit) => unit.id));
    const made: Unit[] = [];
    for (let n = 1; made.length < count; n += 1) {
      const id = `next-${n}`;
      if (ids.has(id)) continue;
      made.push({
        id,
        title: `Next stretch, part ${made.length + 1}`,
        goal: "Go on from where the course ended, in a small example.",
        prerequisites: [made.at(-1)?.id ?? last].filter((p) => p !== undefined),
      });
    }
    return made;
  };
  const amend = (proposed: Unit[], why: string): FakeStep[] => [
    { text: "Here is a scripted change to the course's units." },
    { call: "amend_curriculum", input: { units: proposed, why } },
  ];
  if (/(^|\s)\/drop\b/.test(message)) {
    return amend(units.slice(1), "You asked to drop the first unit.");
  }
  const newest = attachedSources.get(tool)?.at(-1);
  if (/(^|\s)\/read\b/.test(message) && newest !== undefined) {
    const ids = new Set(units.map((unit) => unit.id));
    let id = "reading";
    for (let n = 2; ids.has(id); n += 1) id = `reading-${n}`;
    return amend(
      [
        ...units,
        {
          id,
          title: `Reading ${newest.title}`,
          goal: "Say what the new source's first section argues.",
          prerequisites: last === undefined ? [] : [last],
          sections: [`${newest.id}/${newest.section}`],
        },
      ],
      "You asked for a unit on the source you attached.",
    );
  }
  if (header.startsWith("[Start of a planning conversation")) {
    return [
      {
        text:
          "A scripted question: shall I add the next stretch, two units " +
          "after the last? When you reply, I will propose it on a card, " +
          'which you can apply or answer with "Keep the current one".',
      },
    ];
  }
  if (/(^|\s)\/revise\b/.test(message)) {
    return amend([...units, ...added(1)], "You asked for a shorter stretch.");
  }
  if (header.includes("Your last proposal waits on its card")) {
    return [
      {
        text: "A scripted reply. Say /revise for another proposal, or answer the card.",
      },
    ];
  }
  return amend(
    [...units, ...added(2)],
    "You asked for the next stretch of the course.",
  );
}

// --- Teaching a unit -------------------------------------------------------

/** What the first objective's questions are besides choices, by the session's tools and course. */
type Checked = "none" | "math" | "code";

function teaching(
  header: string,
  history: string,
  body: string,
  message: string,
  kinds: Checked,
  /** The session's folder, the course's workspace. */
  cwd: string | undefined,
  /** The course's style note, as the session's system prompt has it. */
  style: string,
  /** The latest course units and the one taught. */
  course: ListedCourse | undefined,
): FakeStep[] {
  // A review can be under way in any phase, teach too: what it allows comes
  // before the phase.
  if (header.includes("Allowed now: teach")) {
    // Only the dedicated second line carries refs; prose titles and places
    // may themselves contain anything that looks like a ref or delimiter.
    const firstBreak = header.indexOf("\n");
    const refsAt = firstBreak + 1;
    const hasRefs =
      firstBreak !== -1 && header.startsWith(SEGMENT_SECTION_REFS, refsAt);
    const where = header.slice(
      1,
      hasRefs
        ? firstBreak
        : header.lastIndexOf(
            " Phase: teach.",
            header.indexOf("Allowed now: teach"),
          ),
    );
    const sections = hasRefs
      ? header
          .slice(
            refsAt + SEGMENT_SECTION_REFS.length,
            header.indexOf("\n", refsAt) - 1,
          )
          .split(", ")
      : [];
    const prose =
      `**Scripted teaching.** ${where}\n\n` +
      "Inline math reads $e^{i\\pi} + 1 = 0$, and display math:\n\n" +
      "$$\\int_0^1 x\\,dx = \\tfrac{1}{2}$$\n\n" +
      (sections[0] ? `See [the section](source:${sections[0]}).\n\n` : "");
    const aid = where.includes("; segment 1 of ");
    const invite = 'Ask anything, or press "ready" for the check.';
    if (hasRefs) {
      const blocks: PresentLectureInput["blocks"] = [
        { kind: "prose", text: prose },
      ];
      // The dev seed's counting.md: two passages for exercising quote navigation.
      const section = "three-ways-of-counting/s3";
      if (sections.includes(section)) {
        blocks.push(
          {
            kind: "quote",
            section,
            text: "Count one collection in two different ways, and the two counts must agree.",
          },
          {
            kind: "prose",
            text: "The two methods count the same objects. Only the way we group them changes.",
          },
          {
            kind: "quote",
            section,
            text: "Every handshake is counted twice in that sum, once for each of its two people",
          },
          {
            kind: "prose",
            text: "Summing by person counts both ends of each handshake. For an ungraded try, count the handshakes when three people each shake hands with both others.",
          },
        );
      }
      blocks.push({ kind: "prose", text: invite });
      return [
        ...sections.map((section) => ({
          call: "read_section",
          input: { section },
        })),
        ...(aid ? showArtifact(false) : []),
        { call: "present_lecture", input: { blocks } },
      ];
    }
    return [{ text: prose }, ...(aid ? showArtifact() : []), { text: invite }];
  }
  const answered = /The learner answered question (\d+)\./.exec(header)?.[1];
  if (answered !== undefined && header.includes("The miss opens a detour")) {
    const stuck = /^Where they got stuck, in their words: (.*)$/m.exec(body);
    return [
      {
        text:
          `**Scripted detour** on question ${answered}: the right answer, ` +
          "and where the confusion is." +
          (stuck === null
            ? " You did not say where you got stuck."
            : ` You got stuck at: "${stuck[1]?.slice(0, 200)}".`) +
          ' Press "Ready for another question" when you are.',
      },
    ];
  }
  // A question is allowed: after "ready", after feedback, in a reply, or in
  // the test with the grade of the answer before.
  const objective = /a question on "([^"]+)" with ask_question/.exec(
    header,
  )?.[1];
  if (header.includes("What it showed: ")) {
    return [testWord(header, "below")];
  }
  if (answered !== undefined && objective === undefined) {
    return [{ text: `Scripted feedback on question ${answered}.` }];
  }
  if (objective !== undefined) {
    // In a self-test the header names the kinds picked: the kind it would
    // post (code on a non-"-proof" objective in a coding course, written on
    // a "-proof" one, math every second question with math tools, else
    // choice) is posted if picked; if not, choice, written, or math, the
    // first picked; and if none of those is picked either (only code,
    // outside a coding course or on a "-proof" objective), it passes over
    // the objective. No kinds in the header: not a self-test, any kind.
    const picked = / asked with (.+?) questions,/
      .exec(header)?.[1]
      ?.split(/, | or /);
    const number = askedBefore(history, objective) + 1;
    const proof = objective.endsWith(WRITTEN);
    const wanted: Kind =
      kinds === "code" && !proof
        ? "code"
        : proof
          ? "written"
          : kinds === "math" && number % 2 === 0
            ? "math"
            : "choice";
    const kind =
      picked === undefined || picked.includes(wanted)
        ? wanted
        : (["choice", "written", "math"] as const).find((k) =>
            picked.includes(k),
          );
    if (kind === undefined) {
      return [
        {
          call: "pass_over_objective",
          input: {
            objective,
            reason: `Scripted: "${objective}" is not checked with code here, and only code questions were picked.`,
          },
        },
      ];
    }
    if (kind === "code") return codeQuestion(objective, number, cwd);
    const posting: FakeStep = {
      call: "ask_question",
      input: question(objective, number, kind),
    };
    // A test's question comes with no lead-in.
    return header.includes("no lead-in")
      ? [posting]
      : [{ text: "Scripted lead-in to a question." }, posting];
  }
  if (/(^|\s)\/artifact\b/.test(message)) {
    return [...showArtifact(), { text: "Scripted: that was the aid." }];
  }
  if (/(^|\s)\/broken-aid\b/.test(message)) {
    return [
      {
        call: "show_artifact",
        input: { title: "A plot that fails", html: BROKEN_ARTIFACT },
      },
      { text: "Scripted: that aid's script throws." },
    ];
  }
  const quoting = /(?:^|\s)\/quote\b(.*)$/m.exec(message);
  if (quoting !== null) {
    return [
      { text: "Scripted: the passage, from the source." },
      { call: "quote_source", input: { text: (quoting[1] ?? "").trim() } },
      { text: "Scripted: that was the passage." },
    ];
  }
  const packages = /(?:^|\s)\/packages\b(.*)$/m.exec(message);
  if (packages !== null) {
    const names = (packages[1] ?? "").trim().split(/\s+/).filter(Boolean);
    return [
      { text: "Scripted: this unit's code needs packages." },
      {
        call: "install_packages",
        input: {
          packages: (names.length > 0 ? names : ["pytest"]).map((name) => ({
            name,
          })),
        },
      },
    ];
  }
  if (/(^|\s)\/style\b/.test(message)) {
    const kept = sentences(style);
    if (kept.length > 1) kept.pop();
    return [
      { text: "Scripted: a change to how this course is taught." },
      {
        call: "propose_style",
        input: {
          note: [...kept, SHORTER].join(" "),
          why: "You asked for shorter explanations.",
        },
      },
    ];
  }
  if (course !== undefined && /(^|\s)\/amend\b/.test(message)) {
    const { units, taught } = course;
    let n = units.length + 1;
    const ids = new Set(units.map((unit) => unit.id));
    while (ids.has(`practice-${n}`)) n += 1;
    return [
      { text: "Scripted: a change to the course's units." },
      {
        call: "amend_curriculum",
        input: {
          units: [
            ...units,
            {
              id: `practice-${n}`,
              title: `Practice ${n}`,
              goal: "Practise what the course has covered so far.",
              prerequisites: taught === undefined ? [] : [taught],
            },
          ],
          why: "You asked for more practice.",
        },
      },
    ];
  }
  if (
    header.includes("The learner answered your request to install packages")
  ) {
    const said = header.includes("The learner installed")
      ? "they are installed"
      : header.includes('"Not now"')
        ? 'you said "Not now", so they are not installed'
        : "the install failed, so they are not installed";
    return [{ text: `**Scripted:** the packages: ${said}.` }];
  }
  if (header.includes("The learner started a fresh conversation")) {
    const where = header.slice(1, header.indexOf(" The learner started"));
    return [{ text: `**Scripted fresh start.** ${where}` }];
  }
  return [
    {
      text:
        body.trim() === ""
          ? "A scripted reply."
          : `A scripted reply to "${body.trim().slice(0, 200)}".`,
    },
  ];
}

/** The sentence the scripted tutor's style proposal adds. */
const SHORTER =
  "Explanations run shorter: one worked example and two or three short paragraphs.";

/** The style section the system prompt ends with (tutorSystemPrompt), or none. */
function courseStyle(systemPrompt: string): string {
  const at = systemPrompt.lastIndexOf("# This course's style\n");
  const text =
    at === -1
      ? ""
      : systemPrompt.slice(at).split("\n").slice(2).join("\n").trim();
  return text.startsWith("This course has no style note of its own")
    ? ""
    : text;
}

interface ListedCourse {
  units: Unit[];
  taught: string | undefined;
}

/** Each tutor session starts with its prompt and learns revisions from headers. */
const listedUnits = new WeakMap<SessionOptions, Unit[]>();

function listedCourse(session: SessionOptions, header: string): ListedCourse {
  const open = "\n<curriculum>\n";
  const end = header.lastIndexOf("\n</curriculum>\n");
  const start = end === -1 ? -1 : header.lastIndexOf(open, end);
  let units = listedUnits.get(session);
  if (start !== -1 || units === undefined) {
    units = parseUnitLines(
      start === -1
        ? session.systemPrompt
        : header.slice(start + open.length, end),
    );
    listedUnits.set(session, units);
  }
  const at = Number(/^\[Unit (\d+) of /.exec(header)?.[1]);
  return { units, taught: units[at - 1]?.id };
}

/** Reads the numbered unit lines from a prompt or a curriculum update. */
function parseUnitLines(text: string): Unit[] {
  const units: Unit[] = [];
  const ids = (listed: string | undefined) =>
    [...(listed ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1] ?? "");
  for (const line of text.split("\n")) {
    const unit =
      /^\d+\. (.*) \(id "([^"]+)"\): (.*?)(?: Builds on ((?:"[^"]+"(?:, )?)+)\.)?(?: Reads ((?:"[^"]+"(?:, )?)+)\.)?$/.exec(
        line,
      );
    if (unit === null) continue;
    const sections = ids(unit[5]);
    units.push({
      id: unit[2] ?? "",
      title: unit[1] ?? "",
      goal: unit[3] ?? "",
      prerequisites: ids(unit[4]),
      ...(sections.length === 0 ? {} : { sections }),
    });
  }
  return units;
}

/** Shows the scripted artifact, with an introduction when writing ordinary text. */
function showArtifact(introduce = true): FakeStep[] {
  return [
    ...(introduce
      ? [
          {
            text: "A scripted aid opens beside the conversation: drag the slider.",
          },
        ]
      : []),
    {
      call: "show_artifact",
      input: { title: "The tangent to y = x²", html: SCRIPTED_ARTIFACT },
    },
  ];
}

/**
 * The scripted artifact, in the page's colours: a slider moves a point on
 * y = x² and its tangent, and a button tries what the pane must refuse.
 */
const SCRIPTED_ARTIFACT = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<style>
  :root { color-scheme: dark; }
  body { margin: 0; padding: 18px 20px; background: #292c3c; color: #c6d0f5;
    font: 15px/1.5 "IBM Plex Sans", system-ui, sans-serif; }
  svg { display: block; width: 100%; height: auto; }
  .axis { stroke: #51576d; }
  .curve { fill: none; stroke: #ca9ee6; stroke-width: 2; }
  .tan { stroke: #e5c890; stroke-width: 2; }
  label { display: flex; gap: 12px; align-items: center; margin: 10px 0; color: #a5adce; }
  input { flex: 1; accent-color: #ca9ee6; }
  output, b { font-variant-numeric: tabular-nums; }
  button { font: inherit; color: #c6d0f5; background: #414559; border: 1px solid #51576d;
    border-radius: 8px; padding: 4px 12px; cursor: pointer; }
  ul { padding-left: 1.2em; color: #a5adce; }
</style>
</head>
<body>
<svg viewBox="0 0 400 220" role="img" aria-label="The parabola y = x squared and its tangent">
  <line class="axis" x1="0" y1="200" x2="400" y2="200"/>
  <line class="axis" x1="200" y1="0" x2="200" y2="220"/>
  <path class="curve" id="curve"/>
  <line class="tan" id="tan"/>
  <circle id="pt" r="4.5" fill="#e5c890"/>
</svg>
<label>x <input id="x" type="range" min="-2" max="2" step="0.01" value="1"><output id="xv"></output></label>
<p>Slope of the tangent, 2x: <b id="slope"></b> <button id="ask" type="button">Ask about this</button></p>
<p><button id="check" type="button">Try to reach the app and the web</button></p>
<ul id="results"></ul>
<script>
  var sx = function (x) { return 200 + x * 90; };
  var sy = function (y) { return 200 - y * 45; };
  var d = "";
  for (var i = 0; i <= 200; i++) {
    var x = -2.2 + 4.4 * i / 200;
    d += (i ? "L" : "M") + sx(x).toFixed(1) + " " + sy(x * x).toFixed(1);
  }
  document.getElementById("curve").setAttribute("d", d);
  function draw() {
    var a = Number(document.getElementById("x").value), m = 2 * a;
    var tan = document.getElementById("tan");
    tan.setAttribute("x1", sx(a - 1)); tan.setAttribute("y1", sy(a * a - m));
    tan.setAttribute("x2", sx(a + 1)); tan.setAttribute("y2", sy(a * a + m));
    var pt = document.getElementById("pt");
    pt.setAttribute("cx", sx(a)); pt.setAttribute("cy", sy(a * a));
    document.getElementById("xv").textContent = a.toFixed(2);
    document.getElementById("slope").textContent = m.toFixed(2);
  }
  document.getElementById("x").addEventListener("input", draw);
  draw();
  document.getElementById("ask").addEventListener("click", function () {
    var a = Number(document.getElementById("x").value);
    askTutor("Why is the tangent's slope " + (2 * a).toFixed(2) + " at x = " + a.toFixed(2) + "?");
  });
  function say(what, outcome) {
    var li = document.createElement("li");
    li.textContent = what + ": " + outcome;
    document.getElementById("results").appendChild(li);
  }
  function attempt(what, url) {
    fetch(url).then(
      function (r) { say(what, "reached (" + r.status + ")"); },
      function (e) { say(what, "refused (" + e.name + ")"); }
    );
  }
  document.getElementById("check").addEventListener("click", function () {
    document.getElementById("results").textContent = "";
    attempt("The app's courses", "/api/courses");
    attempt("A site on the web", "https://example.com/");
    try { say("The page around it", "read (" + parent.document.title + ")"); }
    catch (e) { say("The page around it", "refused (" + e.name + ")"); }
  });
</script>
</body>
</html>
`;

/** An aid whose script throws as it loads, on its line 6. */
const BROKEN_ARTIFACT = `<!doctype html>
<meta charset="utf-8">
<style>body { margin: 0; padding: 16px 20px; background: #292c3c; color: #c6d0f5; }</style>
<p>A plot of the points should appear here.</p>
<script>
  document.body.append(points.length + " points");
</script>
`;

/**
 * How many questions the header lists as asked on the objective before, in
 * any check or review, so the next is numbered past them: a question asked
 * again would count as the same problem.
 */
function askedBefore(history: string, objective: string): number {
  const lines = history.split("\n");
  const latest = new RegExp(
    `^The latest \\d+ of the (\\d+) questions asked on "${objective}" before`,
  );
  for (const [i, line] of lines.entries()) {
    const many = latest.exec(line);
    if (many !== null) return Number(many[1]);
    if (line.startsWith(`Asked on "${objective}" before`)) {
      const listed = lines.slice(i + 1);
      const end = listed.findIndex((l) => !l.startsWith('- "'));
      return end === -1 ? listed.length : end;
    }
  }
  return 0;
}

/** A kind of question the scripted tutor posts. */
type Kind = "choice" | "written" | "math" | "code";

/**
 * The objective's question of `kind`, different for each number, so none is
 * asked twice in a check.
 */
function question(
  objective: string,
  number: number,
  kind: Exclude<Kind, "code">,
): unknown {
  if (kind === "math") {
    return {
      objective,
      kind: "math",
      mathGrading: "symbolic",
      prompt:
        `Math question ${number} on "${objective}": what is ` +
        `$${number}x + ${number}x$? (Scripted: the symbolic check grades it, ` +
        `and any expression equal to $${2 * number}x$ is correct.)`,
      expected: `${2 * number}x`,
    };
  }
  return kind === "written"
    ? {
        objective,
        kind: "written",
        prompt:
          `Written question ${number} on "${objective}": explain why ` +
          `$${number} + ${number} = ${2 * number}$. (Scripted: any answer is ` +
          'correct unless it has the word "wrong" in it.)',
        rubric: 'Correct unless the answer has the word "wrong" in it.',
      }
    : {
        objective,
        kind: "choice",
        prompt:
          `Choice question ${number} on "${objective}": what is ` +
          `$${number} + ${number}$? (Scripted: the right choice is the sum.)`,
        choices: [`$${2 * number}$`, `$${2 * number + 1}$`, `$${number}$`],
        answer: "A",
      };
}

/**
 * The objective's code question `number`, or the first after it whose
 * starter file is not in the workspace: the tutor writes the starter file,
 * whose function returns 0, then posts the question, whose tests pass once
 * it returns `number` times x. Plain Python, so no package is needed.
 */
function codeQuestion(
  objective: string,
  first: number,
  cwd: string | undefined,
): FakeStep[] {
  // The objective in the name: units share the course's workspace. A file
  // there already, the learner's draft of a question withdrawn unanswered,
  // which no history lists, is never written over.
  const stem = `exercise_${objective.replaceAll("-", "_")}`;
  let number = first;
  while (cwd !== undefined && existsSync(join(cwd, `${stem}_${number}.py`))) {
    number += 1;
  }
  const module = `${stem}_${number}`;
  const file = `${module}.py`;
  const test = `test_${module}.py`;
  return [
    { text: "Scripted: the starter file for a code exercise." },
    {
      builtIn: "Write",
      path: file,
      content: "def times(x):\n    return 0\n",
    },
    { text: "Scripted lead-in to a code question." },
    {
      call: "ask_question",
      input: {
        objective,
        kind: "code",
        prompt:
          `Code question ${number} on "${objective}": finish \`times(x)\` in ` +
          `\`${file}\` so that it returns ${number} times \`x\`. (Scripted: ` +
          `the starter returns 0, which fails; \`return ${number} * x\` passes.)`,
        files: [file],
        tests: [
          {
            path: test,
            content:
              `from ${module} import times\n\n` +
              "for x in (0, 1, 2, 5):\n" +
              "    got = times(x)\n" +
              `    assert got == ${number} * x, f"times({x}) gave {got!r}, not {${number} * x}"\n` +
              'print("Scripted: all 4 checks passed.")\n',
          },
        ],
        solution: [
          { path: file, content: `def times(x):\n    return ${number} * x\n` },
        ],
        command: [sandboxPython, test],
      },
    },
  ];
}

// --- Grading and judging help ---------------------------------------------

function scriptedReply(request: OneShotRequest<unknown>): FakeReply {
  if (request.schema === HelpJudgment) return scriptedJudgment(request);
  if (request.schema === DisputeJudgment) return scriptedDispute(request);
  if (request.schema === HandoffReply) return scriptedHandoff(request);
  if (request.schema === NotesReply) return scriptedNotes(request);
  if (request.schema === CheatSheetReply) return scriptedCheatSheet(request);
  const answer =
    /<answer>\n([\s\S]*)\n<\/answer>/.exec(request.prompt)?.[1] ?? "";
  if (answer.includes("/fail")) {
    return { fail: "The scripted grader was told to fail." };
  }
  return /\bwrong\b/i.test(answer)
    ? {
        output: {
          verdict: "incorrect",
          flaw: 'The answer has the word "wrong" in it.',
        },
      }
    : { output: { verdict: "correct" } };
}

function scriptedNotes(request: OneShotRequest<unknown>): FakeReply {
  // The request has already escaped the instructions for inclusion in HTML.
  const instructions =
    /<instructions>\n([\s\S]*?)\n<\/instructions>$/.exec(request.prompt)?.[1] ||
    "None";
  return {
    output: {
      html: String.raw`<!doctype html>
<html lang="en"><head><title>Scripted unit notes</title><meta name="viewport" content="width=device-width, initial-scale=1">
<style>
body { background: #303446; color: #c6d0f5; font: 17px/1.6 system-ui, sans-serif; }
main { max-width: 38em; margin: 3em auto; padding: 0 1em; }
figure { margin: 1em 0; color: #ca9ee6; }
svg { display: block; width: 10em; }
@media print { body { background: white; color: black; } figure { color: black; } }
</style></head><body><main><h1>Scripted unit notes</h1>
<p>Instructions: ${instructions}</p>
<p>One square on each side gives <span class="math-inline">a^2 + b^2</span>.</p>
<div class="math-display">\frac{a^2+b^2}{c^2}=1</div>
<figure><svg viewBox="0 0 100 70" role="img" aria-label="A right triangle">
<path d="M10 60H90L10 10Z" fill="none" stroke="currentColor" stroke-width="2"/>
<path d="M10 50H20V60" fill="none" stroke="currentColor"/>
</svg><figcaption>A right triangle</figcaption></figure>
</main></body></html>`,
    },
  };
}

function scriptedCheatSheet(request: OneShotRequest<unknown>): FakeReply {
  // The request escapes `&` and `<` in what it tags; the page escapes again.
  const tagged = (name: string) =>
    new RegExp(`<${name}>\n([\\s\\S]*?)\n</${name}>`)
      .exec(request.prompt)?.[1]
      ?.replaceAll("&lt;", "<")
      .replaceAll("&amp;", "&") ?? "";
  const html = (text: string) =>
    text.replaceAll("&", "&amp;").replaceAll("<", "&lt;");
  // The engine wrote this JSON (engine/cheat-sheets.ts, `request`).
  const units = JSON.parse(tagged("units") || "[]") as {
    number: number;
    title: string;
  }[];
  const instructions = tagged("instructions") || "None";
  return {
    output: {
      html: `<!doctype html>
<html lang="en"><head><title>Scripted cheat sheet</title>
<style>
body { background: #303446; color: #c6d0f5; font: 15px/1.5 system-ui, sans-serif; }
main { max-width: 60em; margin: 2em auto; padding: 0 1em; columns: 2; }
section { break-inside: avoid; background: #292c3c; padding: .5em 1em; margin: 0 0 1em; }
@page { margin: 9mm; }
@media print { body { background: white; color: black; } section { background: white; } }
</style></head><body><h1>Scripted cheat sheet</h1>
<p>Instructions: ${html(instructions)}</p><main>
${units.map((unit) => `<section><h2>Unit ${unit.number}: ${html(unit.title)}</h2><p>The main idea: <span class="math-inline">a^2 + b^2 = c^2</span>.</p></section>`).join("\n")}
</main></body></html>`,
    },
  };
}

/**
 * The dispute judge's call: the grade stands, unless the reason has
 * "/change" in it. A choice question's key follows the verdict. After an
 * "I don't know", which has no grade, "/change" corrects the answer shown.
 */
function scriptedDispute(request: OneShotRequest<unknown>): FakeReply {
  const tagged = (name: string) =>
    new RegExp(`<${name}>\n([\\s\\S]*?)\n</${name}>`).exec(request.prompt)?.[1];
  const reason = tagged("reason") ?? "";
  if (reason.includes("/fail")) {
    return { fail: "The scripted dispute judge was told to fail." };
  }
  const change = reason.includes("/change");
  const choices = tagged("choices")?.split("\n").length;
  const key = /^([A-F])\./.exec(tagged("key") ?? "")?.[1];
  if (tagged("grade") === undefined) {
    const expected = tagged("expected_answer");
    return {
      output: {
        reason: change
          ? 'Scripted: the reason has "/change" in it, so the answer shown is corrected.'
          : 'Scripted: the answer shown stands, since the reason does not have "/change" in it.',
        verdict: "incorrect",
        ...(choices === undefined
          ? {}
          : {
              key: change
                ? CHOICE_LETTERS.slice(0, choices).find((l) => l !== key)
                : key,
            }),
        ...(change && expected !== undefined
          ? { expected: `${expected} + 1` }
          : {}),
      },
    };
  }
  const graded = tagged("grade") === "correct" ? "correct" : "incorrect";
  const verdict = change
    ? graded === "correct"
      ? "incorrect"
      : "correct"
    : graded;
  const picked = /^([A-F])\./.exec(tagged("answer") ?? "")?.[1];
  const other = CHOICE_LETTERS.slice(0, choices).find((l) => l !== picked);
  return {
    output: {
      reason: change
        ? 'Scripted: the reason has "/change" in it, so the grade is changed.'
        : 'Scripted: the grade stands, since the reason does not have "/change" in it.',
      verdict,
      ...(choices === undefined
        ? {}
        : { key: !change ? key : verdict === "correct" ? picked : other }),
    },
  };
}

/**
 * The handoff writer's call: a note numbered on from the one before, which
 * counts what it read, and misconceptions quoting the start of the missed
 * answer before each detour.
 */
function scriptedHandoff(request: OneShotRequest<unknown>): FakeReply {
  const stretch =
    /<stretch>\n([\s\S]*)\n<\/stretch>$/.exec(request.prompt)?.[1] ?? "";
  if (stretch.includes("/nohandoff")) {
    return { fail: "The scripted handoff writer was told to fail." };
  }
  const before = /<note_before>\n[\s\S]*?Scripted note (\d+)\b/.exec(
    request.prompt,
  )?.[1];
  const number = before === undefined ? 1 : Number(before) + 1;
  const count = (pattern: RegExp) => (stretch.match(pattern) ?? []).length;
  const detours = [
    ...stretch.matchAll(
      /^\[Detour (\d+) opens, after the miss on question (\d+), on "([^"]+)"\.\]$/gm,
    ),
  ];
  const answerBefore = (question: string, at: number) => {
    const line = [
      ...stretch
        .slice(0, at)
        .matchAll(
          new RegExp(
            `^\\[The learner's answer to question ${question}:\\]\\n(.+)$`,
            "gm",
          ),
        ),
    ]
      .at(-1)?.[1]
      ?.trim();
    if (line === undefined || line.length <= MISCONCEPTION_WORDS_LIMIT) {
      return line;
    }
    // Include the next character to see whether the last word fits whole.
    return line
      .slice(0, MISCONCEPTION_WORDS_LIMIT + 1)
      .replace(/\S+$/u, "")
      .trimEnd();
  };
  return {
    output: {
      note:
        `**Scripted note ${number}.** Since the note before, it read ` +
        `${count(/^Tutor:$/gm)} of the tutor's replies, ` +
        `${count(/^Learner:$/gm)} of the learner's messages, ` +
        `${count(/^\[The learner's answer to /gm)} answers and ` +
        `${detours.length} detours.`,
      misconceptions: detours.flatMap((match) => {
        const [, detour, question, objective] = match;
        const words = answerBefore(question ?? "", match.index);
        if (!words) return [];
        return [
          {
            objective,
            believed: `Scripted: what the answer to question ${question} showed, that $a^2 + b^2 = c$.`,
            actually: "Scripted: it is $a^2 + b^2 = c^2$.",
            words,
            detour: Number(detour),
          },
        ];
      }),
    },
  };
}

/** The help judge's call: clarification if the message asks what something means. */
function scriptedJudgment(request: OneShotRequest<unknown>): FakeReply {
  const message =
    /<message>\n([\s\S]*)\n<\/message>/.exec(request.prompt)?.[1] ?? "";
  if (message.includes("/fail")) {
    return { fail: "The scripted judge was told to fail." };
  }
  return /\bmean\b/i.test(message)
    ? {
        output: {
          reason: 'Scripted: the message asks what something means ("mean").',
          verdict: "clarification",
        },
      }
    : {
        output: {
          reason: 'Scripted: the message does not have the word "mean".',
          verdict: "help",
        },
      };
}
