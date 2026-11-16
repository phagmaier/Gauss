// A backend that needs no model and no script written ahead: it reads each
// turn's header and does what the header allows (task 2.12b). It runs the dev
// server of scripts/dev-fake.ts, for browser checks that spend no plan usage,
// on the fake backend's machinery (fake.ts), so tool calls run the real
// teaching tools and a turn can be stopped.
//
// What it does, by the tools its session has:
//
// - An intake (propose_curriculum): proposes four units, titled from the
//   learner's first message. "/one-off" in that message proposes one unit.
//   Later messages are answered in text; "/revise" proposes a revision with
//   one unit fewer.
// - A unit's planning (plan_unit): two segments of one objective each. The
//   first objective is checked by choice questions, the second by written
//   ones.
// - A unit's tutor (ask_question, close_segment): teaches in the teach
//   phase, posts a question when the header allows one, closes the segment
//   when the header says every objective is done, and otherwise replies in
//   text, which after a fresh start says where the unit stands. The correct
//   choice is always A.
// - "/hold" in any message from the learner keeps the turn open until it is
//   stopped.
//
// A written answer is graded correct unless it has the word "wrong" in it;
// "/fail" in it fails the grading.
//
// Every tutor session it starts is kept, across restarts too, so a unit
// reopened after a restart resumes its tutor (task 2.14). A session id it
// did not make cannot be found: put another in a unit's `tutorSessionId` in
// state.json, with the server stopped, to see a unit start fresh because its
// conversation could not be resumed.

import type { CurriculumProposal } from "../../shared/curriculum.ts";
import type { Plan } from "../../shared/plan.ts";
import type { EngineTurn, OneShotRequest, SessionOptions } from "./backend.ts";
import {
  createFakeBackend,
  FAKE_SESSION,
  type FakeBackend,
  type FakeReply,
  type FakeStep,
} from "./fake.ts";

export function createScriptedBackend(): FakeBackend {
  return createFakeBackend(scriptedTurn, scriptedReply, {
    kept: { has: (id) => id.startsWith(FAKE_SESSION), add: () => {} },
  });
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
  if (has("propose_curriculum")) return intake(header, body);
  return teaching(header, body);
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

function proposal(
  title: string,
  kind: "first" | "revised" | "one-off",
): CurriculumProposal {
  const unit = (id: string, name: string, prerequisites: string[]) => ({
    id,
    title: name,
    goal: `Use ${name.toLowerCase()} in a small example.`,
    prerequisites,
  });
  if (kind === "one-off") {
    return { title, units: [unit("basics", "The basics", [])], style: STYLE };
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
  return { title, units, style: STYLE };
}

function intake(header: string, body: string): FakeStep[] {
  const propose = (kind: "first" | "revised" | "one-off", title: string) => [
    { text: "Here is a scripted curriculum." },
    { call: "propose_curriculum", input: proposal(title, kind) },
  ];
  const said = (command: string) =>
    body.replace(command, "").replace(/\s+/g, " ").trim().slice(0, 80);
  // Nothing proposed yet: the opening turn, or a message before a proposal.
  if (
    header.startsWith("[Start of the intake") ||
    header.includes("reply, or propose")
  ) {
    return body.includes("/one-off")
      ? propose("one-off", said("/one-off") || "Scripted one-off")
      : propose("first", said("") || "Scripted course");
  }
  if (body.includes("/revise")) {
    return propose("revised", said("/revise") || "Scripted course, revised");
  }
  return [
    {
      text: "A scripted reply. Say /revise for a revised curriculum, or approve the proposal.",
    },
  ];
}

// --- Teaching a unit -------------------------------------------------------

function teaching(header: string, body: string): FakeStep[] {
  if (header.includes("Phase: teach.")) {
    // "Unit 1 of 6, "Limits"; segment 1 of 2, "The idea", on "limits-idea"."
    const where = header.slice(1, header.indexOf(" Phase:"));
    return [
      {
        text:
          `**Scripted teaching.** ${where}\n\n` +
          "Inline math reads $e^{i\\pi} + 1 = 0$, and display math:\n\n" +
          "$$\\int_0^1 x\\,dx = \\tfrac{1}{2}$$\n\n" +
          'Ask anything, or press "ready" for the check.',
      },
    ];
  }
  const objective = /post a question on "([^"]+)"/.exec(header)?.[1];
  if (objective !== undefined) {
    return [
      { text: "Scripted feedback, then a question." },
      {
        call: "ask_question",
        input: question(objective, asked(header, objective) + 1),
      },
    ];
  }
  if (header.includes("Every objective is done.")) {
    return [
      { text: "Scripted feedback. That closes the segment." },
      { call: "close_segment", input: {} },
    ];
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

/** How many questions this check has asked on the objective, as the header says. */
function asked(header: string, objective: string): number {
  const said = new RegExp(`"${objective}": [^;]*?\\((\\d+) of at most`).exec(
    header,
  );
  return said === null ? 0 : Number(said[1]);
}

/** The objective's question, different for each number, so none is asked twice in a check. */
function question(objective: string, number: number): unknown {
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
          `$${number} + ${number}$? (Scripted: A is always correct.)`,
        choices: [`$${2 * number}$`, `$${2 * number + 1}$`, `$${number}$`],
        answer: "A",
      };
}

// --- Grading ---------------------------------------------------------------

function scriptedReply(request: OneShotRequest<unknown>): FakeReply {
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
