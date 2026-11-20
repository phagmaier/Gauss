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
//   of its own when there was none.
// - A unit's planning (plan_unit): two segments of one objective each. The
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
//   check or an assessment (task 5.4), teaches in the teach phase, and
//   otherwise replies in text, which after a fresh start says where the unit
//   stands. In the test before a unit (task 5.6), the turn with an answer's
//   grade posts the next question with no feedback, and the turn that ends
//   the test says in a line what it showed.
//   Its questions on an objective are numbered past those the header lists
//   as asked before, so none repeats one, whichever unit's thread asked it.
//   A choice question asks for a sum, and the right choice is that sum; the
//   engine shuffles the choices (task 2.17), so its letter varies. A math
//   question asks for a sum of terms in x, and any expression equal to it
//   is right.
// - Artifacts (task 3.6): the teaching of a unit's first segment shows one,
//   a tangent to a parabola that a slider moves, with a button that tries
//   to reach the app and the web and says what was refused; so does a reply
//   to a message with "/artifact" in it, which the engine refuses while a
//   question is open. "/broken-aid" shows one whose script throws as it
//   loads (task 5.20).
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
// note before, and finds one misconception for each detour in its stretch,
// on the detour's objective. "/nohandoff" in a learner's message in the
// stretch fails the call, which records nothing: the next one reads that
// stretch too.
//
// The notes writer (task 5.9) supplies a small standalone page with a
// figure and math, repeating any instructions from the learner.
//
// A dispute of a grade (task 3.8) is decided by the scripted judge: the
// grade stands unless the learner's reason has "/change" in it, which
// changes it; for a choice question changed to correct, the key becomes the
// choice picked, and changed to incorrect, the first other choice. "/fail"
// in the reason fails the call, which records nothing.
//
// Every session it starts in a folder (a unit's tutor, an intake) is kept,
// across restarts too, so a unit reopened after a restart resumes its tutor
// (task 2.14), and an idle session closed is resumed (task 2.15). A session id it
// did not make cannot be found: put another in a unit's `tutorSessionId` in
// state.json, with the server stopped, to see a unit start fresh because its
// conversation could not be resumed. Put BROKEN_SESSION there to see resuming
// fail another way: the unit opens, and every message fails to resume its
// tutor, until the learner starts fresh.

import { existsSync } from "node:fs";
import { join } from "node:path";
import type { PlannerProposal, Unit } from "../../shared/curriculum.ts";
import { DisputeJudgment } from "../../shared/dispute.ts";
import { HandoffReply } from "../../shared/handoff.ts";
import { NotesReply } from "../../shared/notes.ts";
import type { Plan } from "../../shared/plan.ts";
import { sentences } from "../../shared/profile.ts";
import { CHOICE_LETTERS, HelpJudgment } from "../../shared/question.ts";
import { QUESTION_HISTORY_START } from "../engine/unit-turns.ts";
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

/** A session id that is found and cannot be resumed, however often it is tried. */
export const BROKEN_SESSION = `${FAKE_SESSION}broken`;

export function createScriptedBackend(): FakeBackend {
  const backend = createFakeBackend(scriptedTurn, scriptedReply, {
    kept: { has: (id) => id.startsWith(FAKE_SESSION), add: () => {} },
  });
  return {
    ...backend,
    async startSession(options) {
      if (options.resumeId === BROKEN_SESSION) {
        throw new Error("The scripted backend cannot resume this session.");
      }
      return backend.startSession(options);
    },
  };
}

/** The id of the objective a unit's plan checks with written questions ends so. */
const WRITTEN = "-proof";

/** The plan the scripted planning gives a unit, and the seed gives its units. */
export function scriptedPlan(unitId: string): Plan {
  // Room for the suffix within an id's 60 characters, and no hyphen doubled.
  const stem = unitId.slice(0, 50).replace(/-+$/, "");
  const idea = `${stem}-idea`;
  const proof = `${stem}${WRITTEN}`;
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
      { title: "The idea", objectives: [idea] },
      { title: "Why it holds", objectives: [proof] },
    ],
  };
}

function scriptedTurn(turn: EngineTurn, session: SessionOptions): FakeStep[] {
  const { header, body } = parts(turn.text);
  const has = (tool: string) => session.tools.some((t) => t.name === tool);
  const course =
    has("amend_curriculum") && has("ask_question")
      ? listedCourse(session, header)
      : undefined;
  if (/(^|\s)\/hold\b/.test(body)) {
    return [
      { text: "Holding this turn open until you stop it." },
      { hold: true },
    ];
  }
  if (has("plan_unit")) return planning(header);
  // The course's planner has the change tool, and no questions to ask.
  const amend = session.tools.find((t) => t.name === "amend_curriculum");
  if (amend !== undefined && !has("ask_question")) {
    return coursePlanning(header, body, amend);
  }
  const propose = session.tools.find((t) => t.name === "propose_curriculum");
  if (propose !== undefined) return intake(header, body, propose);
  const tools = session.workspace !== undefined;
  const coding =
    tools &&
    /^The course is "[^"\n]*\bcod(e|ing)\b/im.test(session.systemPrompt);
  const historyAt = header.lastIndexOf(QUESTION_HISTORY_START);
  const controls = historyAt === -1 ? header : header.slice(0, historyAt);
  const history = historyAt === -1 ? "" : header.slice(historyAt);
  return teaching(
    controls,
    history,
    body,
    tools ? (coding ? "code" : "math") : "none",
    session.cwd,
    courseStyle(session.systemPrompt),
    course,
  );
}

/** A turn's header, between its brackets, and what follows it. */
function parts(text: string): { header: string; body: string } {
  const end = text.indexOf("]\n");
  return end === -1
    ? { header: text, body: "" }
    : { header: text.slice(0, end + 1), body: text.slice(end + 2) };
}

// --- Planning a unit -------------------------------------------------------

function planning(header: string): FakeStep[] {
  const unitId = /\(id "([^"]+)"\)/.exec(header)?.[1];
  return unitId === undefined
    ? [{ text: "The scripted planner could not find the unit in its turn." }]
    : [{ call: "plan_unit", input: scriptedPlan(unitId) }];
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

/**
 * The body without the block about the learner that a first turn, or one
 * after the profile changed, puts before the learner's text; and the
 * profile the block gives, if it gives one.
 */
function learnerPart(body: string): {
  text: string;
  profile?: { text: string | undefined };
} {
  const open = "<about_the_learner>\n";
  const close = "\n</about_the_learner>\n\n";
  const end = body.indexOf(close);
  if (!body.startsWith(open) || end === -1) return { text: body };
  const block = body.slice(open.length, end);
  const given = /<profile>\n([\s\S]*)\n<\/profile>/.exec(block)?.[1];
  return {
    text: body.slice(end + close.length),
    profile: { text: given },
  };
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
  tool: TeachingTool,
): FakeStep[] {
  const { text: body, profile: given } = learnerPart(turnBody);
  if (given !== undefined) profiles.set(tool, given);
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
  ) => [
    { text: "Here is a scripted curriculum." },
    {
      call: "propose_curriculum",
      input: proposal(
        title,
        kind,
        background,
        scriptedProfile(profiles.get(tool)?.text, title),
      ),
    },
  ];
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

function coursePlanning(
  header: string,
  body: string,
  tool: TeachingTool,
): FakeStep[] {
  const given = /<course>\n[^\n]*\n(\[.*\])\n/.exec(body)?.[1];
  if (given !== undefined) {
    plannedUnits.set(
      tool,
      (JSON.parse(given) as Unit[]).map(
        ({ id, title, goal, prerequisites }) => ({
          id,
          title,
          goal,
          prerequisites,
        }),
      ),
    );
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
  if (/(^|\s)\/drop\b/.test(body)) {
    return amend(units.slice(1), "You asked to drop the first unit.");
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
  if (/(^|\s)\/revise\b/.test(body)) {
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
    // "Unit 1 of 6, "Limits"; segment 1 of 2, "The idea", on "limits-idea"."
    const where = header.slice(1, header.indexOf(" Phase:"));
    return [
      {
        text:
          `**Scripted teaching.** ${where}\n\n` +
          "Inline math reads $e^{i\\pi} + 1 = 0$, and display math:\n\n" +
          "$$\\int_0^1 x\\,dx = \\tfrac{1}{2}$$\n\n",
      },
      ...(header.includes("; segment 1 of ") ? showArtifact() : []),
      { text: 'Ask anything, or press "ready" for the check.' },
    ];
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
    const passed = (header.match(/" passed \(/g) ?? []).length;
    const asked = (header.match(/" (not )?passed \(/g) ?? []).length;
    return [
      {
        text:
          `**Scripted word on the test:** you passed ${passed} of its ${asked} ` +
          "objectives. The card below says what that would skip; you choose.",
      },
    ];
  }
  if (answered !== undefined && objective === undefined) {
    return [{ text: `Scripted feedback on question ${answered}.` }];
  }
  if (objective !== undefined) {
    const number = askedBefore(history, objective) + 1;
    if (kinds === "code" && !objective.endsWith(WRITTEN)) {
      return codeQuestion(objective, number, cwd);
    }
    const posting: FakeStep = {
      call: "ask_question",
      input: question(objective, number, kinds === "math"),
    };
    // A test's question comes with no lead-in.
    return header.includes("no lead-in")
      ? [posting]
      : [{ text: "Scripted lead-in to a question." }, posting];
  }
  if (/(^|\s)\/artifact\b/.test(body)) {
    return [...showArtifact(), { text: "Scripted: that was the aid." }];
  }
  if (/(^|\s)\/broken-aid\b/.test(body)) {
    return [
      {
        call: "show_artifact",
        input: { title: "A plot that fails", html: BROKEN_ARTIFACT },
      },
      { text: "Scripted: that aid's script throws." },
    ];
  }
  const packages = /(?:^|\s)\/packages\b(.*)$/m.exec(body);
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
  if (/(^|\s)\/style\b/.test(body)) {
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
  if (course !== undefined && /(^|\s)\/amend\b/.test(body)) {
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
  for (const line of text.split("\n")) {
    const unit =
      /^\d+\. (.*) \(id "([^"]+)"\): (.*?)(?: Builds on ((?:"[^"]+"(?:, )?)+)\.)?$/.exec(
        line,
      );
    if (unit === null) continue;
    units.push({
      id: unit[2] ?? "",
      title: unit[1] ?? "",
      goal: unit[3] ?? "",
      prerequisites: [...(unit[4] ?? "").matchAll(/"([^"]+)"/g)].map(
        (m) => m[1] ?? "",
      ),
    });
  }
  return units;
}

/** Shows the scripted artifact, with a line before it. */
function showArtifact(): FakeStep[] {
  return [
    { text: "A scripted aid opens beside the conversation: drag the slider." },
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
<p>Slope of the tangent, 2x: <b id="slope"></b></p>
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

/**
 * The objective's question, different for each number, so none is asked
 * twice in a check: a math one every second question, if `math`.
 */
function question(objective: string, number: number, math: boolean): unknown {
  if (math && !objective.endsWith(WRITTEN) && number % 2 === 0) {
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
  return objective.endsWith(WRITTEN)
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

/**
 * The dispute judge's call: the grade stands, unless the reason has
 * "/change" in it. A choice question's key follows the verdict.
 */
function scriptedDispute(request: OneShotRequest<unknown>): FakeReply {
  const tagged = (name: string) =>
    new RegExp(`<${name}>\n([\\s\\S]*?)\n</${name}>`).exec(request.prompt)?.[1];
  const reason = tagged("reason") ?? "";
  if (reason.includes("/fail")) {
    return { fail: "The scripted dispute judge was told to fail." };
  }
  const graded = tagged("grade") === "correct" ? "correct" : "incorrect";
  const change = reason.includes("/change");
  const verdict = change
    ? graded === "correct"
      ? "incorrect"
      : "correct"
    : graded;
  const choices = tagged("choices")?.split("\n").length;
  const picked = /^([A-F])\./.exec(tagged("answer") ?? "")?.[1];
  const key = /^([A-F])\./.exec(tagged("key") ?? "")?.[1];
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
 * counts what it read, and a misconception for each detour it read.
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
  return {
    output: {
      note:
        `**Scripted note ${number}.** Since the note before, it read ` +
        `${count(/^Tutor:$/gm)} of the tutor's replies, ` +
        `${count(/^Learner:$/gm)} of the learner's messages, ` +
        `${count(/^\[The learner's answer to /gm)} answers and ` +
        `${detours.length} detours.`,
      misconceptions: detours.map(([, detour, question, objective]) => ({
        objective,
        believed: `Scripted: what the answer to question ${question} showed, that $a^2 + b^2 = c$.`,
        actually: "Scripted: it is $a^2 + b^2 = c^2$.",
        detour: Number(detour),
      })),
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
