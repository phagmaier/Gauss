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
//   either message proposes one unit. Later messages are answered in text;
//   "/revise" proposes a revision with one unit fewer.
// - A unit's planning (plan_unit): two segments of one objective each. The
//   first objective is checked by choice questions, and every second
//   question on it is a math question (task 3.5) when the session has the
//   file and shell tools, which it has when the sandbox runs, as the
//   symbolic check needs; the second objective is checked by written ones.
// - A unit's tutor (ask_question): teaches in the teach phase, gives
//   feedback alone on a graded answer (the engine then asks for the next
//   question, or closes the segment, task 2.16a), opens the detour a miss
//   starts with a reply that repeats where an "I don't know" got stuck
//   (the learner then asks for another question, task 2.20), posts a
//   question when the header allows one, and otherwise replies in text,
//   which after a fresh start says where the unit stands. A choice question
//   asks for a sum, and the right choice is that sum; the engine shuffles
//   the choices (task 2.17), so its letter varies. A math question asks for
//   a sum of terms in x, and any expression equal to it is right.
// - Artifacts (task 3.6): the teaching of a unit's first segment shows one,
//   a tangent to a parabola that a slider moves, with a button that tries
//   to reach the app and the web and says what was refused; so does a reply
//   to a message with "/artifact" in it, which the engine refuses while a
//   question is open.
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
// Every session it starts in a folder (a unit's tutor, an intake) is kept,
// across restarts too, so a unit reopened after a restart resumes its tutor
// (task 2.14), and an idle session closed is resumed (task 2.15). A session id it
// did not make cannot be found: put another in a unit's `tutorSessionId` in
// state.json, with the server stopped, to see a unit start fresh because its
// conversation could not be resumed. Put BROKEN_SESSION there to see resuming
// fail another way: the unit opens, and every message fails to resume its
// tutor, until the learner starts fresh.

import type { CurriculumProposal } from "../../shared/curriculum.ts";
import type { Plan } from "../../shared/plan.ts";
import { HelpJudgment } from "../../shared/question.ts";
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
  if (/(^|\s)\/hold\b/.test(body)) {
    return [
      { text: "Holding this turn open until you stop it." },
      { hold: true },
    ];
  }
  if (has("plan_unit")) return planning(header);
  const propose = session.tools.find((t) => t.name === "propose_curriculum");
  if (propose !== undefined) return intake(header, body, propose);
  return teaching(header, body, session.workspace !== undefined);
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

function proposal(
  title: string,
  kind: "first" | "revised" | "one-off",
  background: string,
): CurriculumProposal {
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
    };
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
  return { title, units, style: STYLE, background };
}

function intake(header: string, body: string, tool: TeachingTool): FakeStep[] {
  /** The text, without the commands, on one line and short. */
  const plain = (text: string) =>
    text
      .replace(/\/(one-off|revise)\b/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80);
  const background = `Scripted. The learner said: ${plain(body) || "nothing"}`;
  const propose = (kind: "first" | "revised" | "one-off", title: string) => [
    { text: "Here is a scripted curriculum." },
    { call: "propose_curriculum", input: proposal(title, kind, background) },
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
    const kind = `${first} ${body}`.includes("/one-off") ? "one-off" : "first";
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

// --- Teaching a unit -------------------------------------------------------

function teaching(header: string, body: string, math: boolean): FakeStep[] {
  if (header.includes("Phase: teach.")) {
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
  if (answered !== undefined) {
    return [{ text: `Scripted feedback on question ${answered}.` }];
  }
  // A question is allowed: after "ready", after feedback, or in a reply.
  const objective = /a question on "([^"]+)" with ask_question/.exec(
    header,
  )?.[1];
  if (objective !== undefined) {
    return [
      { text: "Scripted lead-in to a question." },
      {
        call: "ask_question",
        input: question(objective, asked(header, objective) + 1, math),
      },
    ];
  }
  if (/(^|\s)\/artifact\b/.test(body)) {
    return [...showArtifact(), { text: "Scripted: that was the aid." }];
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

/** How many questions this check has asked on the objective, as the header says. */
function asked(header: string, objective: string): number {
  const said = new RegExp(`"${objective}": [^;]*?\\((\\d+) asked\\)`).exec(
    header,
  );
  return said === null ? 0 : Number(said[1]);
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

// --- Grading and judging help ---------------------------------------------

function scriptedReply(request: OneShotRequest<unknown>): FakeReply {
  if (request.schema === HelpJudgment) return scriptedJudgment(request);
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
