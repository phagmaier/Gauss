import type { Parent, Root } from "hast";
import rehypeKatex from "rehype-katex";
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import {
  assessmentCard,
  assessmentEndMarker,
  assessmentMarker,
  type ResultRow,
  testResultCard,
} from "../../shared/assessment-view.ts";
import type { StoredUnit } from "../../shared/curriculum.ts";
import { compareUnits } from "../../shared/curriculum-change.ts";
import { displayMathLines } from "../../shared/display-math-lines.ts";
import {
  AFTER_DISPUTE,
  disputeWords,
  type FirstGrade,
  firstGradeFeedback,
  outcomeHead,
  standing,
  verdictWord,
} from "../../shared/dispute-view.ts";
import { htmlAsText } from "../../shared/html-as-text.ts";
import { requirement } from "../../shared/packages.ts";
import type { Plan } from "../../shared/plan.ts";
import {
  CHOICE_LETTERS,
  type ChoiceLetter,
  confidenceLabel,
} from "../../shared/question.ts";
import { messageParts } from "../../shared/quote.ts";
import {
  emptyTimeline,
  type Item,
  type QuestionItem,
  reduce,
} from "../../shared/timeline.ts";
import type { Transcript } from "../record/data-root.ts";
import { embeddedKatexCss, STANDALONE_HTML_POLICY } from "./standalone-html.ts";

function markdownProcessor(keepLiteralHtml: boolean) {
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath)
    .use(displayMathLines);
  if (keepLiteralHtml) processor.use(htmlAsText);
  return processor
    .use(remarkRehype) // Drops raw HTML, including any not converted to text.
    .use(inertReferences)
    .use(rehypeKatex, { trust: false, maxExpand: 200, maxSize: 25 })
    .use(rehypeStringify)
    .freeze();
}

const markdown = markdownProcessor(false);
const learnerMarkdown = markdownProcessor(true);

function inertReferences() {
  return (tree: Root) => {
    function visit(parent: Parent): void {
      for (const [i, node] of parent.children.entries()) {
        if (node.type !== "element") continue;
        // Keep the labels, not even a relative path or a navigation target.
        if (node.tagName === "img") {
          parent.children[i] = {
            type: "text",
            value: String(node.properties.alt ?? ""),
          };
          continue;
        }
        if (node.tagName === "a") {
          node.tagName = "span";
          node.properties = {};
        }
        // GFM footnotes may use the same generated ids in separate replies.
        delete node.properties.id;
        visit(node);
      }
    }
    visit(tree);
  };
}

const dateTime = new Intl.DateTimeFormat(undefined, {
  dateStyle: "long",
  timeStyle: "short",
});
const date = new Intl.DateTimeFormat(undefined, { dateStyle: "long" });

/** Replay across sessions first: later events can update earlier cards. */
export function renderTranscript(
  course: string,
  unit: StoredUnit,
  unitNumber: number,
  transcripts: readonly Transcript[],
): string {
  let thread = emptyTimeline;
  let index = 0;
  let finished = false;
  const sessions = transcripts.map(({ session, events, unreadable }) => {
    const first = events[0];
    const startedAt = first?.type === "session" ? first.startedAt : undefined;
    const cutOff = thread.busy;
    if (startedAt === undefined) {
      // The session's first line may be damaged. Keep its surviving text and
      // end the previous reply, just as the missing session event would.
      thread = { ...thread, inSession: true, busy: false, tutorOpen: false };
    }
    let closed: typeof thread.finished = null;
    for (const event of events) {
      thread = reduce(thread, { type: "event", index: index++, event });
      if (!finished && thread.finished !== null) {
        closed = thread.finished;
        finished = true;
      }
    }
    return {
      session,
      startedAt,
      cutOff,
      closed,
      end: index,
      incomplete: unreadable.length > 0,
    };
  });

  const plan = thread.plan ?? unit.plan;
  const objectives = new Map(
    plan?.objectives.map(({ id, statement }) => [id, statement]),
  );
  const title = escapeHtml(unit.title);
  const count = sessions.length;
  const exported = new Date();
  const html = [
    `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${STANDALONE_HTML_POLICY}">
<title>${title} — Transcript</title>
<style>${embeddedKatexCss()}</style><style>${TRANSCRIPT_CSS}</style>
</head><body><main>
<header><h1>${title}</h1><p class="meta">${escapeHtml(course)}, unit ${unitNumber}. Transcript of ${count} ${count === 1 ? "session" : "sessions"}, exported <time datetime="${exported.toISOString()}">${date.format(exported)}</time>.</p></header>`,
  ];
  if (count === 0)
    html.push("<p>No sessions have been recorded for this unit.</p>");
  let at = 0;
  for (const session of sessions) {
    const { startedAt } = session;
    const heading =
      startedAt === undefined
        ? `Session ${session.session}`
        : `<time datetime="${escapeHtml(startedAt)}">${dateTime.format(new Date(startedAt))}</time>`;
    html.push(`<section class="session"><h2>${heading}</h2>`);
    if (session.cutOff)
      html.push(
        '<p class="note">The server stopped before the tutor finished.</p>',
      );
    if (session.incomplete)
      html.push('<p class="note">Some lines could not be read.</p>');
    while (at < thread.items.length) {
      const item = thread.items[at];
      if (item === undefined || item.key >= session.end) break;
      html.push(renderItem(item, plan, objectives));
      at += 1;
    }
    if (session.closed !== null) {
      html.push(
        marker(
          "Unit finished",
          session.closed === "overridden"
            ? "Moved on without passing every objective."
            : "",
        ),
      );
    }
    html.push("</section>");
  }
  html.push("</main></body></html>");
  return html.join("\n");
}

const phase = {
  teach: "Teach",
  discuss: "Discuss",
  check: "Check",
  closed: "Done",
};

function renderItem(
  item: Item,
  plan: Plan | undefined,
  objectives: ReadonlyMap<string, string>,
): string {
  switch (item.kind) {
    case "learner":
      return `<div class="learner" aria-label="Learner">${messageParts(
        item.text,
      )
        .map((part) =>
          part.quote
            ? `<blockquote>${String(learnerMarkdown.processSync(part.text))}</blockquote>`
            : escapeHtml(part.text),
        )
        .join("")}</div>`;
    case "tutor":
      return `<div class="tutor" aria-label="Tutor">${prose(item.text)}</div>`;
    case "phase":
      return marker(
        phase[item.phase],
        item.again === undefined
          ? `Segment ${item.segment + 1}`
          : "Going over objectives again.",
      );
    case "fresh":
      return marker(
        "Fresh start",
        item.reason === "learner"
          ? "The tutor has your progress, not the conversation above."
          : "The earlier conversation could not be resumed, so the tutor started a new one from your progress.",
      );
    case "detour":
      return marker(
        "Detour",
        `Working through question ${item.number}. Nothing here is graded or counts as help.`,
      );
    case "assessment": {
      if (item.stage === "offered") {
        const card = assessmentCard(item);
        return marker(
          card.title,
          `Offered: ${card.questions}. ${card.says.join(" ")}`,
        );
      }
      const { name, says } = assessmentMarker(item);
      return marker(name, says);
    }
    case "assessment_end": {
      const { name, says } = assessmentEndMarker(item);
      return marker(name, says);
    }
    case "question":
      return renderQuestion(item);
    case "answered-below":
      return `<p class="note">Question ${item.number} was answered further down.</p>`;
    case "file":
      return `<p class="note">The tutor wrote <code>${escapeHtml(item.path)}</code></p>`;
    case "artifact":
      return `<p class="note">Aid shown: ${escapeHtml(item.title)}</p>`;
    case "note":
      return `<p class="note">${escapeHtml(item.text)}</p>`;
    case "judgment":
      return `<p class="note">Question ${item.number}: ${item.verdict === "help" ? "counts as help" : item.verdict === "clarification" ? "clarification, not help" : "awaiting a help judgment"}.</p>`;
    case "packages": {
      const outcome = {
        installed: "Installed",
        failed: "Installation failed",
        declined: "Not now",
        withdrawn: "Withdrawn",
      };
      const state =
        item.outcome !== undefined
          ? outcome[item.outcome]
          : item.status === "installing"
            ? "Installing"
            : "No decision recorded";
      return `<div class="card"><p><b>Packages requested</b>: ${escapeHtml(item.packages.map(requirement).join(", "))}. ${state}.</p>${item.output === undefined ? "" : `<pre>${escapeHtml(item.output)}</pre>`}</div>`;
    }
    case "style": {
      const outcome = {
        applied: "Applied",
        kept: "Kept the current one",
        withdrawn: "Not applied: the unit ended first",
      };
      const state =
        item.outcome === undefined
          ? "No decision recorded"
          : outcome[item.outcome];
      return `<div class="card"><p><b>Style change proposed</b>: ${escapeHtml(item.why)} ${state}.</p><p>${escapeHtml(item.note)}</p></div>`;
    }
    case "curriculum": {
      const outcome = {
        applied: "Applied",
        kept: "Kept the current one",
        withdrawn: "Not applied: the unit ended first",
        replaced: "Replaced by a later proposal",
      };
      const state =
        item.outcome === undefined
          ? "No decision recorded"
          : outcome[item.outcome];
      const { marks, dropped } = compareUnits(item.was, item.units);
      const rows = item.units
        .map((unit) => {
          const mark = marks.get(unit.id);
          return `<li>${escapeHtml(unit.title)}${mark === undefined ? "" : ` (${mark})`}: ${escapeHtml(unit.goal)}</li>`;
        })
        .join("");
      const gone =
        dropped.length === 0
          ? ""
          : `<p>Dropped: ${escapeHtml(dropped.map((u) => u.title).join(", "))}</p>`;
      return `<div class="card"><p><b>Curriculum change proposed</b>: ${escapeHtml(item.why)} ${state}.</p><ol>${rows}</ol>${gone}</div>`;
    }
    case "test_result": {
      const card = testResultCard(plan, item);
      const segments =
        card.answered === undefined && card.segments !== null
          ? `<p>${escapeHtml(card.segmentsSay)}</p>${resultRows(card.segments, true)}`
          : "";
      return `<div class="card"><p><b>Test result</b> ${escapeHtml(card.says.text)}</p>${resultRows(card.objectives)}${segments}${optionalParagraph(card.answered)}${optionalParagraph(card.startsAt)}</div>`;
    }
    case "unit_end": {
      const rows = Object.entries(item.objectives).map(
        ([id, status]) =>
          `<li>${prose(objectives.get(id) ?? id)} ${escapeHtml(status.replaceAll("-", " "))}</li>`,
      );
      for (const { statement, unit, status, unanswered } of item.gate?.others ??
        []) {
        rows.push(
          `<li>Unit ${unit.number}: ${escapeHtml(unit.title)}. ${prose(statement)} ${unanswered ? "Unanswered" : escapeHtml(status.replaceAll("-", " "))}</li>`,
        );
      }
      const step =
        item.stepTaken === "again"
          ? "<p>Went over objectives again.</p>"
          : item.stepTaken === "moved-on"
            ? "<p>Moved on.</p>"
            : "";
      return `<div class="card"><b>${item.gate === undefined ? "Unit results" : "Unit results after the gate"}</b><ul>${rows.join("")}</ul>${step}</div>`;
    }
    // Session headings come from the files, including the first sitting.
    // A curriculum proposal belongs to intake, which has no transcript.
    case "session":
    case "proposal":
      return "";
  }
}

function resultRows(rows: readonly ResultRow[], plain = false): string {
  return `<ul>${rows.map(({ text, word, why }) => `<li>${plain ? escapeHtml(text) : prose(text, true)} — ${escapeHtml(word.text)}${why === undefined ? "" : `: ${prose(why, true)}`}</li>`).join("")}</ul>`;
}

function optionalParagraph(text: string | undefined): string {
  return text === undefined ? "" : `<p>${escapeHtml(text)}</p>`;
}

function marker(label: string, detail: string): string {
  return `<p class="marker"><b>${escapeHtml(label)}</b>${detail === "" ? "" : ` ${escapeHtml(detail)}`}</p>`;
}

function renderQuestion({
  question,
  graded,
  dispute,
  withdrawn,
  waiting,
  grading,
  gradingFailed,
}: QuestionItem): string {
  const first: FirstGrade | undefined =
    graded === undefined
      ? undefined
      : {
          kind: question.kind,
          verdict: graded.verdict,
          key: graded.correctChoice,
          expected: graded.expected,
          flaw: graded.flaw,
          dispute,
        };
  const now = first === undefined ? undefined : standing(first);
  const verdict = now?.verdict;
  const status =
    verdict === undefined
      ? withdrawn
        ? "Withdrawn"
        : gradingFailed !== undefined
          ? "Not graded"
          : grading !== undefined
            ? "Grading"
            : waiting !== undefined
              ? "Waiting"
              : "Unanswered"
      : verdictWord(verdict).text;
  const head = question.assessment;
  const number =
    head === undefined || head.objective !== undefined
      ? `${question.number}`
      : `${question.number} of ${head.of}`;
  const key = now?.key;
  const expected = now?.expected;
  const answer = graded?.answer ?? grading ?? waiting;
  const html = [
    `<div class="card question"><div class="question-head"><b>Question ${number}</b> <strong class="${verdict ?? ""}">${status}</strong>${now?.changed ? ` ${AFTER_DISPUTE}` : ""}${graded?.assisted ? " · With help" : ""}</div>`,
  ];
  if (head?.objective !== undefined)
    html.push(`<p class="meta">Objective ${head.objective} of ${head.of}</p>`);
  if (head?.from !== undefined)
    html.push(
      `<p class="meta">Unit ${head.from.number}: ${escapeHtml(head.from.title)}</p>`,
    );
  if (head?.second)
    html.push('<p class="meta">Second question on this objective</p>');
  html.push(prose(question.prompt));
  if (answer === undefined) {
    if (question.kind === "choice") {
      html.push(
        `<ul class="choices">${question.choices.map((choice, i) => `<li>${CHOICE_LETTERS[i] ?? ""}. ${prose(choice)}</li>`).join("")}</ul>`,
      );
    } else if (question.kind === "code") {
      html.push(
        `<p>${question.files.map((file) => `<code>${escapeHtml(file)}</code>`).join(", ")}</p>`,
      );
    }
  } else {
    let said: string;
    switch (answer.kind) {
      case "choice":
        said = choiceText(question, answer.choice);
        break;
      case "math":
        said = math(answer.expression);
        break;
      case "written":
        said = String(learnerMarkdown.processSync(answer.text));
        break;
      case "code":
        said = answer.files
          .map(({ path }) => `<code>${escapeHtml(path)}</code>`)
          .join(", ");
        break;
      case "unknown":
        said = "I don't know";
        break;
    }
    const confidence =
      answer.kind === "unknown"
        ? ""
        : ` <span class="confidence">${confidenceLabel(answer.confidence)} sure</span>`;
    html.push(
      `<div class="answer"><b>Your answer</b><div>${said}${confidence}</div></div>`,
    );
    if (answer.kind === "unknown") {
      if (answer.stuck !== undefined)
        html.push(`<p><b>Stuck on:</b> ${escapeHtml(answer.stuck)}</p>`);
    } else if (answer.reasoning?.trim()) {
      html.push(
        `<div><b>Your thinking</b>${String(learnerMarkdown.processSync(answer.reasoning))}</div>`,
      );
    }
  }
  if (verdict !== undefined && verdict !== "correct") {
    const right =
      question.kind === "choice" && key !== undefined
        ? choiceText(question, key)
        : question.kind === "math" && expected !== undefined
          ? math(expected)
          : undefined;
    if (right !== undefined)
      html.push(
        `<div class="answer"><b>Correct answer</b><div>${right}</div></div>`,
      );
  }
  // Test diagnostics can include the hidden tests, even in old transcripts.
  if (question.kind === "code") {
    if (gradingFailed !== undefined)
      html.push("<p>The code could not be graded.</p>");
    if (graded?.verdict === "correct") html.push("<p>Tests passed.</p>");
    else if (graded?.verdict === "incorrect")
      html.push("<p>Tests did not pass.</p>");
  } else if (gradingFailed !== undefined) {
    html.push(`<p>The grading failed: ${escapeHtml(gradingFailed)}</p>`);
  }
  if (first?.flaw !== undefined && !now?.changed)
    html.push(`<div><b>The first flaw</b>${prose(first.flaw)}</div>`);
  const words = first === undefined ? undefined : disputeWords(first);
  if (first !== undefined && dispute !== undefined && words !== undefined) {
    if (now?.corrected)
      html.push(
        `<div><b>${words.first}</b> ${renderFirstGrade(first, question)}</div>`,
      );
    html.push(
      `<div><b>${words.said}</b><p>${escapeHtml(dispute.reason)}</p><b>Outcome</b> ${outcomeHead(first)} ${prose(dispute.outcome.reason, true)}</div>`,
    );
  }
  html.push("</div>");
  return html.join("\n");
}

function renderFirstGrade(
  first: FirstGrade,
  question: QuestionItem["question"],
): string {
  const feedback = firstGradeFeedback(first);
  const detail =
    "flaw" in feedback
      ? prose(feedback.flaw, true)
      : "key" in feedback
        ? choiceText(question, feedback.key)
        : "expected" in feedback
          ? math(feedback.expected)
          : "";
  return detail === "" ? feedback.label : `${feedback.label} ${detail}`;
}

function choiceText(
  question: QuestionItem["question"],
  letter: ChoiceLetter,
): string {
  const choice =
    question.kind === "choice"
      ? question.choices[CHOICE_LETTERS.indexOf(letter)]
      : undefined;
  return choice === undefined ? letter : `${letter}. ${prose(choice, true)}`;
}

function math(source: string): string {
  const formula = source.replaceAll("$", "").replace(/\s+/g, " ").trim();
  return prose(`$\\displaystyle ${formula}$`, true);
}

function prose(text: string, inline = false): string {
  const html = String(markdown.processSync(text));
  return inline &&
    html.startsWith("<p>") &&
    html.indexOf("</p>") === html.length - 4
    ? html.slice(3, -4)
    : html;
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

// Catppuccin Frappé, as in the thread. Print overrides the same roles.
const TRANSCRIPT_CSS = `
:root{color-scheme:dark;--paper:#303446;--card:#292c3c;--ink:#c6d0f5;--soft:#a5adce;--line:#51576d;--accent:#ca9ee6;--ok:#a6d189;--miss:#e78284}
body{margin:0;background:var(--paper);color:var(--ink);font:17px/1.65 system-ui,sans-serif;overflow-wrap:anywhere}
main{max-width:39em;margin-inline:auto;padding:3rem 1.5rem 5rem}
header h1{font-size:2em;line-height:1.15;margin:0 0 .3em;font-weight:600}
.session>h2{font-size:1em;line-height:1.4;margin:0 0 1.35em;padding-top:.75em;border-top:1px solid var(--line);color:var(--accent)}
.session{margin-top:2.5em}
.meta,.note,.confidence{color:var(--soft);font-size:.88em}
.marker{color:var(--soft);border-left:2px solid var(--line);padding-left:.8em;font-size:.92em;margin:1.45em 0}
.marker b,.question-head b{color:var(--ink)}
.learner{width:fit-content;max-width:82%;margin:1.65em 0 1.65em auto;padding:.55em 1em;border-radius:18px 18px 5px 18px;background:color-mix(in srgb,var(--accent) 15%,var(--paper));white-space:pre-wrap}
.learner blockquote{white-space:normal;margin-block:.15em .5em}
.learner blockquote p{margin:0 0 .5em}
.learner blockquote p:last-child{margin-bottom:0}
.tutor{margin:1em 0}
.tutor :is(h1,h2,h3,h4,h5,h6){color:var(--accent);font-size:1.2em;line-height:1.3;border:0;padding:0}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;margin:1.4em 0;padding:1em 1.2em}
.card p{margin:.5em 0}
.question-head,.answer>b{font-size:.86em;color:var(--soft)}
.question-head strong{margin-left:.5em}
.correct{color:var(--ok)}
.incorrect{color:var(--miss)}
.answer{display:grid;grid-template-columns:7em minmax(0,1fr);gap:.75em;margin:.55em 0;align-items:baseline}
.answer p:first-child{margin-top:0}
.confidence{white-space:nowrap}
.choices{list-style:none;padding:0}
.choices p{display:inline}
pre{white-space:pre-wrap;overflow-wrap:anywhere;padding:.6em 1em;border:1px solid var(--line);border-radius:6px;font-size:.89em}
blockquote{margin-inline:0;padding-left:1em;border-left:2px solid var(--line);color:var(--soft)}
table{border-collapse:collapse;font-size:.94em}
th,td{border:1px solid var(--line);padding:.32em .65em;text-align:left}
.katex-display{overflow:auto hidden;padding-block:.25em}
@media(max-width:460px){.answer{grid-template-columns:1fr;gap:.15em}.learner{max-width:90%}}
@media print{
  :root{color-scheme:light;--paper:#fff;--card:#fff;--ink:#111;--soft:#333;--line:#aaa;--accent:#222;--ok:#222;--miss:#222}
  body{font-size:11pt}
  main{max-width:none;padding:0}
  h2,.marker,.question-head{break-after:avoid}
  .learner{background:transparent;border:1px solid var(--line)}
  .katex-error{color:var(--ink)!important}
}
`;
