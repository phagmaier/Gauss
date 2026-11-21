# Gauss: decisions and findings

Why things are as they are: the user's decisions (marked as theirs), the
agent's choices (open to change) and what they beat, what the SDKs and
tools were seen to do, and the gaps left open. What the system does now is
in `architecture.md`; how to add to this file is in `AGENTS.md`, "Keeping
the documents".

Read the sections the task needs, not the whole file: `grep -n '^## '
docs/decisions.md` gives their lines. A task id named beside a finding
leads to the runs behind it, in that task's commit (`git log
--grep='^3\.10'`); the build journal through task 2.29 is `git show
a42a409:docs/decisions.md`.

| Section | Holds | Read when |
| --- | --- | --- |
| Product decisions | What the user decided, when, and why | Changing what the product does; breaking down a stage |
| Toolchain | Versions, type-checking, Biome, pnpm and uv settings | Changing tooling or `tsconfig.json` |
| Claude backend | The Agent SDK on the plan login: environment, isolation, ending turns, Stop, sessions and resume, one-shot calls, thinking | Touching `src/server/backends/` |
| Confinement | The tutor's built-in tools and their two layers, its working and temporary folders, the engine's sandbox, package installs, the backup of the workspace, unconfined reads; artifacts' frame and policy, and WebRTC | Changing the tutor's tools or the engine's commands; giving web access (stage 4); changing artifacts |
| Codex | What the Codex SDK can and cannot do | Stage 6 |
| Record | Ids, writes, the file lock, logs, transcripts on disk, the backup | Touching `src/server/record/` or a record file's schema |
| Objective status | The passing rule, misses, help, overrides, no question limit, the check's start | Touching `record/status.ts`, `engine/check-rules.ts`, or what counts as help |
| Calibration | What the counts count | Touching calibration, or what confidence or help mean |
| Session engine | The chats' design choices: phases, the feedback turn, queues, answers, detours, choice order, planning, intake, resume, idle sessions, transcripts | Touching `src/server/engine/` |
| Grader prompt | The hand-graded set, the grader's model and rules | Changing `grader.md`, `WrittenGrade` or the grader's model; disputes |
| Help judge | The judge's rules, failures, model and set | Changing help judging; disputes |
| Symbolic check | `mathcheck.py`: the parser and its traps, what counts as equal, the time limits; math questions in the engine and on the page | Changing `mathcheck.py`, math questions, or what they accept |
| Code questions | Where a code question's tests run, the checks at posting, the learner's files, time-outs, the output kept, "Open" | Changing code questions or how their tests run |
| Disputes | What can be disputed, what an outcome changes, what the learner sees, wrong keys, the answer shown after "I don't know", who decides; the judge's set and model | Building or changing disputes or `dispute-judge.md` |
| Mastery loop | Assessments in the unit's thread, retained and slipping, review, the gate, testing out, handoff notes and misconceptions, the profile, notes, the export, style and curriculum changes | Touching assessments, status, handoff notes, the profile, notes, or style and curriculum changes |
| Prompts | Findings from real runs behind `tutor.md`, `planner.md`, `unit-planner.md`, `handoff.md`, `notes.md`; the writing rules | Revising any prompt |
| Page design | The look and layout picked from the mocks, with what was rejected | Building or changing a view |
| Page behaviour | Rendering, performance, the pinned question, dimming, retries, the artifact pane | Touching `src/web/` |
| HTTP and event stream | Route rules, security, intakes | Adding or changing a route |
| Dev server and tests | `pnpm dev:fake`, the fake backends, test timing, real-model runs | Running checks; touching `scripted.ts`, `dev-seed.ts`, `serve.ts` |
| Sources | Splitting sources into sections | Stage 4 |
| Known gaps | What is known to be wrong or missing and not scheduled | Before calling something a new bug |

## Product decisions

The brief states the result; this is who decided and why.

- **2026-11-13, the brief.** The user accepted the agent's proposals without
  item-by-item review ("the brief is fine", judgment delegated): objectives
  as the unit of tracking, the three-phase rhythm, passed and retained
  tiers, curriculum planned at two levels, verified quotes, disputes,
  Claude first. Also theirs: courses, units and one-offs, override,
  confidence and reasoning on answers, detours, artifacts, workspace,
  sources in four formats, lecture-style teaching of sources, no formal
  proof checking, transcripts, HTML notes, both subscriptions. Delegated to
  the agent: the language (TypeScript with Python helpers), sitting length
  (not a design input; resume works anywhere instead), the style note
  (per course, changed only with the learner's agreement).
- **2026-11-13, from the mocks.** The user asked for five confidence levels
  and "I don't know" on every question. They later offered to drop the
  percentages; the agent kept them, because they make "confident" (90% or
  100%) concrete and allow calibration.
- **2026-11-16, the first stage 2 check** (a chain-rule unit). The record
  showed four units proposed for "a short unit" with nothing asked;
  segments closed by the three-question limit with objectives not passed,
  and a "we'll come back to that skill" that nothing kept; the next
  question straight after feedback on "I don't know"; asking what a
  question meant charged as help; the open card scrolled out of view. The
  user decided:
  - strict by default: an objective is not passed "until the answers seem
    obvious and easy"; override is always open and recorded;
  - every miss starts a detour, which the learner ends; the check pauses
    only after misses; "I don't know" takes an optional line on where the
    learner got stuck;
  - writing during an open question stays allowed; asking what it means is
    clarification, not help, and a model judges which;
  - the planner asks about background, understanding and scope before
    proposing;
  - a dividing line between messages.

  The agent chose, under those: no question limit; teaching again after a
  second miss; a separate judging call; no proposal in the planner's first
  turn; the background note; the tutor promising nothing the app does not
  do. It also chose to require a confident answer to pass, which the user
  overturned the next day.
- **2026-11-17, the stage 2 review.** The check passed on a second try; the
  user then brought a review of a theology course's record: an objective
  answered correctly at 75% and 50%, then missed, then correct at 90%,
  ending overridden; objectives that each joined an explanation and two
  contrasts; teaching that quoted Basil, Lossky and Vatican II from
  memory. The user decided:
  - passing: two correct answers in a row to different questions at any
    confidence, or one at 90% or more if the objective was never missed;
  - review questions open each sitting, on by default and skippable,
    replacing the opt-in review mode ("a mode one has to open tends not to
    be opened"), built with the unit gate in stage 5;
  - testing out of a unit replaces the baseline quiz, whose probe of
    prerequisites the intake's questions now cover;
  - course finals are dropped;
  - a course with no source quotes nothing verbatim from memory;
  - stage 5 before stage 4: the gate and review make "passed" trustworthy
    in every course, and need nothing from sources;
  - the "what I know" view, calibration and a backup before stage 3;
    starred messages wait until the generated notes have been used.

  The agent chose: "in a row" means no miss between, so an answer given
  with help neither counts nor breaks the row; two lucky guesses at 50% on
  four choices (1 in 16) are accepted; stage numbers are kept, with the
  order written beside them.
- **2026-11-17, the check of 2.23 to 2.27.** The user decided calibration
  per course ("it's meaningless in the aggregate": how sure one is in
  theology and in math differ), and that a library row opens the course
  page rather than the last session. The agent applied the second to
  drafts too.
- **2026-11-17, the stage 3 designs** (pieces 13 and 14 of the mocks). The
  user picked: a dispute is decided by a separate model call, not by the
  learner's word or the tutor ("Disputes"); a code question's tests are
  hidden until it is graded, and a failing run starts a detour followed by
  a different exercise, as a miss does for every other kind ("Page
  design"); and Gauss installs a course's packages once the learner
  approves a card, where the agent had recommended that the learner run
  the install command themselves ("Confinement").
- **2026-11-18, the stage 3 check** (a Python course and a numerical
  solvers course, on Opus 5.5). It passed: code graded by tests, a math
  answer graded symbolically, an artifact and a dispute. The user's notes
  became tasks 3.19 to 3.22: starter files that hold what a question gives
  (Opus had them type given values into the file); the install card's
  command and output shown only on request or failure; a pinned question
  that can be hidden; and an "Open" button for a code question's files,
  opening the system's default app rather than a set command (Ghostty
  with nvim). They also suggested questions on the learner's intuition
  before the check. The agent supported it: explaining or predicting
  exposes a picture a correct computation can hide, for one or two
  exchanges a segment. The user chose it on by default, with the tutor
  judging when; the style note can turn it off.
- **2026-11-18, the stage 5 designs**, answered when the stage was broken
  down, before any mock. The user decided:
  - review is offered on a card with Start and Skip at each sitting's
    start, and does not start by itself: "if someone is confident they
    don't need a review we shouldn't force them to have one". This
    replaces "on by default" (2026-11-17); the card still comes unasked,
    so it is not the opt-in mode they dropped;
  - a miss in review opens a detour and one more question, as in the
    gate;
  - testing out is offered beside Start, and nothing is skipped without
    the learner's say: "you have to consent to skipping something". The
    agent read that as two steps, a confirmation before the test and a
    result card whose answer does the skipping;
  - notes are offered when a unit finishes, not written unasked. They
    follow a standard (what the unit taught, more room for what the
    learner struggled with, what made things click), and the learner can
    add instructions of their own on top;
  - the profile is proposed by the planner and approved with the
    curriculum, and the learner can edit it;
  - the brief's wording: a handoff note is written when a segment closes;
    review asks slipping objectives first; a miss while testing out does
    not count afterwards.
- **2026-11-18, the stage 5 mocks** (pieces 15 to 18). The user accepted
  all four as shown, but for the notes. Piece 17 had drawn a unit's notes
  as text the engine rendered from the model's Markdown; they turned it
  down: it "looks like markdown in obsidian", and the notes are HTML so
  that they "can have visuals and be expressive", a page that "looks
  nice", "actual html". The notes need not be shown inside the app if
  that were what held them to plain text: downloading them or opening
  them in the browser would do. They also picked KaTeX's own output, with
  its styles and fonts written into the file, for the math of the notes
  and the exported transcript, over MathML, which the agent had planned
  and then showed drawing badly. The agent's choices under these are in
  "Mastery loop" and "Page design".
- **2026-11-19, notes from the stage 5 check, partway.** No "not
  covered" control on a question. The agent had proposed one that
  withdraws a question with no evidence when it asks what was not taught
  or goes beyond its objective. The user dropped it: a miss is not a
  grade, and its detour teaches what was missing, so an unfair question
  costs one more question; in an hour of testing every question was fair.
  "I don't know" with a line on where they got stuck covers it without a
  confident miss. Revisit if unfair questions show up. The other notes
  became tasks 5.14 to 5.18 in the plan.
- **2026-11-19, the comparison with LearnHarness**, an open-source
  tutoring app (AGPL-3.0: ideas only, no code). It keeps no record of
  mastery, leaves most teaching rules to its prompts, grades choices in
  the browser and sends answer keys to the page; Gauss stays as it is on
  all of those. The user decided:
  - directions for 5.17's mocks ("Page design", pieces 19 to 21): a
    course map from the unit's top line, segment headings that the
    outline jumps to, a quieter look within Frappé, and quoting a
    selected passage;
  - review ordered by how overdue each objective is (5.19), not full
    FSRS;
  - an aid's script errors sent to the tutor when the learner presses a
    button (5.20);
  - no separate model to build aids, not even later: the tutor writes
    them itself (the three made so far were about 2.5 KB each);
  - a prediction before teaching: not now; revisit after the redesign;
  - a model chosen in the app's settings, eventually (stage 6);
  - a desktop app only once everything else is built and working, and
    not a requirement;
  - left out: a knowledge graph of what the lessons said, notes import,
    plugins, API keys and a cost meter, dictation through an outside
    service, side threads, compaction, and questions to place the learner
    before planning (the test before a unit does that).
- **2026-11-19, the comparison with DeepTutor**, an open-source study
  suite (Apache-2.0) whose Mastery Path is the part closest to Gauss. It
  leaves to its prompt what Gauss enforces (when to teach and when to
  test, what counts as help), asks no confidence, keeps no misconceptions
  or handoff notes, and lets the tutor void or re-key its own questions;
  Gauss stays as it is on all of those. Nothing in it beat a settled
  decision. The user decided:
  - an "I don't know" answer's key can be reported wrong, decided by the
    dispute judge, the miss standing (5.21); not DeepTutor's way, where
    the tutor that wrote the key decides;
  - each misconception carries the learner's words that showed it,
    checked against the thread (5.22), as DeepTutor checks the learner
    quotes behind its teaching notes;
  - an aid can put a question into the message box, built on 5.20's
    channel once 5.20 is done (5.23);
  - the library and the course view show how many objectives are due
    for review, once 5.19 gives due times (5.24);
  - four more directions for 5.17's mocks ("Page design"): a serif that
    matches KaTeX for the tutor's text, status by form as well as
    colour, a graded card's verdict under a hairline, and a course view
    that goes down to objectives;
  - two items for 4.0: quote matching that ignores margin line numbers
    and line-end hyphens, and a link to a section that claims no quote;
  - left out: intake questions on a card of options; questions on a
    source figure, for 4.0; a folding outline rail, reading settings,
    narrow windows and motion, for the mocks; and DeepTutor's memory
    layers, learning journal, self-rated practice, flashcards, generated
    books, video and animation, research and solving agents, embedding
    search, partners and plugins, probing each objective before teaching
    it, unsure grades held back and half credit, several questions on
    one card, a recall target with an FSRS-like schedule, rewriting
    objectives within a unit, and "marked as known" counting as passed.
- **2026-11-19, the end of the stage 5 check** (unit 2 of a course on
  coding agent harnesses: review at a later sitting, skipped checks,
  detours, the gate, notes and the exported transcript). The check
  passed. The user decided:
  - review is offered on its card only when something is due, and only
    between segments, with a "Review now" button in the course view
    (5.25). They had asked for review on request only, and took the
    agent's recommendation over it: a mode one has to open tends not to
    be opened (2026-11-17), and 5.19's intervals alone stop a card after
    an hour away;
  - "Move on without the check" offered in the discussion too (5.26), and
    the closing card saying that the gate comes next (5.27);
  - from the agent's reading of the transcript: math questions only for
    mathematical results, and no echo of the app's markers by the tutor
    (5.28);
  - `tutor.md` cut hard, as a task of its own (5.29): at 596 lines it
    goes to the tutor in every session;
  - later, in stage 6: self-test on a scope and kinds of question the
    learner picks (optional), and teaching instructions the learner can
    add to or edit, the app's rules fixed and the original kept to revert
    to.
- **2026-11-19, vague written answers** (from the stage 5 check). A
  written answer that is mostly right but vague stays a miss. No grade is
  held back for follow-up questions: a question aimed at the vague part
  tells the learner what was missing, which is help, and pass or fail is
  what the passing rules read. Instead, a written question names each
  part its rubric requires, and the detour after a part left out says
  what was right and what was missing and names no misconception
  (`tutor.md`; "Prompts").
- **2026-11-19, thinking on written and code answers** (from the stage 5
  check). Every answer but "I don't know" takes the optional reasoning a
  choice and a math answer had; mock 2 had left it off a written answer as
  its own reasoning. Now a false start can stay out of the graded text:
  the grader and the tests see the answer alone, and the tutor, the
  handoff writer, the dispute judge, "What I know" and the exported
  transcript see the reasoning (the user's decision). The agent chose:
  one field for all four kinds; "Your thinking (optional, not graded:
  only your answer is graded)" on the card and "Your thinking" on the
  record, for every kind, while the models' requests keep "reasoning",
  since "thinking" is the model's own there; and a line in
  `dispute-judge.md` that the reasoning is not graded, so a false start
  in it makes no answer wrong (not tried on a real model).
- **2026-11-19, large courses planned in stretches** (from the stage 5
  check). A large topic ("Calculus 1 to 3") is one course, not several:
  review and the gate pick only within a course, and a later stretch must
  review the earlier ones (the user's decision). The course's shape was
  left to the agent, which chose: the planner proposes only the first
  stretch, about 15 units at most (Calculus 1 alone), titles the course
  for the whole topic, and names each later stretch with what it covers
  when asking to go ahead, before the card and in the style note; the
  tutor offers the next stretch with `amend_curriculum` in the first
  teaching turn of the last unit or the one before, when the style note
  or the background note goes further. Closing a segment does not send
  the tutor a turn, and the closed-phase header rules out tools. Units
  planned far ahead would be guesses made before anything is known of
  the learner. Rejected: the whole topic planned up front; one course
  per stretch. A course whose last unit finished before its next stretch
  was added adds it from the course view ("Page design", "A curriculum
  change is asked for from the course view"): the planner there is given
  the style note, and offers the stretch it names.
- **2026-11-19, deleting a course** (task 5.18). A course or a draft is
  deleted from its course view; there is no archive, and the app offers
  no undo, while the backup's history keeps it (the user's decision). A
  draft asks a plain confirmation; a course with evidence asks for its
  title to be typed, saying what goes. Refused while a chat of the course
  is open or anything of it runs. As built (the agent's choices, open to
  change):
  - an approved course asks for its title if it has evidence or a unit
    has opened, including a failed opening that may have left a
    transcript or workspace, or if its progress cannot be read;
  - "open" is a page reading the chat's event stream: a unit's session,
    the curriculum's review, or the planning conversation. Chats stay in
    memory for the whole server run, so refusing every chat ever opened
    would refuse any course used since the start. The page's own course
    view holds no chat;
  - the record is snapshotted before deletion: a new draft or edits in
    the workspace may not have triggered a commit yet. The folder is
    renamed out of the library before it is removed, so the library
    never shows a half-deleted course.

## Toolchain

- **Very new major versions**: TypeScript 7, Vitest 5, Biome 2.6, pnpm 12,
  Vite 8, React 19, Agent SDK 0.3. Check documentation before relying on
  remembered behaviour. The runtimes in `mise.toml` were those already on
  the user's machine.
- **Type-checking only, no build step.** `tsc` never emits; imports carry
  `.ts` and `erasableSyntaxOnly` is on, so the same source runs under Node,
  Vite and Vitest. `pnpm dev` runs `main.ts` under Node directly, with Vite
  in middleware mode on the same port; a production start without Vite is
  not built.
- **Biome excludes Markdown and `docs/`**: version 2.6 would rewrite every
  table in the documents.
- **A lint warning fails the check** (`biome check --error-on-warnings`):
  one false warning stood in every run for weeks, and a new one beside it
  was easy to miss. A false warning gets a `biome-ignore` comment saying
  why, as `styles.css` has for `.box-note p`.
- **`@types/node`** is pinned to major 24, the runtime's.
- **pnpm**: a release must be a day old to install; pnpm 12 fails an install
  whose dependency needs a build script until it is named under
  `allowBuilds`.
- **`pytools/`** uses mise's Python only (`python-preference =
  "only-system"`), so uv never downloads a second interpreter.
- **A test on each side checks the runtime pin**, so a suite run outside
  mise fails.
- **No DOM in the tests.** React components have no automated tests; their
  logic is in pure modules, and rendering is tested to static HTML with
  `react-dom/server`. No DOM library was added for it.

## Claude backend

Observed with Agent SDK 0.3.325, which runs the Claude Code binary bundled
in its platform package (2.1.325), not the `claude` on the path. The
options as built are in `architecture.md` section 7.

**Login and environment**

- **A set `ANTHROPIC_API_KEY` beats the plan login**, which the SDK uses
  when no key is set (`apiKeySource: "none"`): with an invalid key the
  request failed with 401 and did not fall back, so a valid one would be
  billed as API usage. A probe with `ANTHROPIC_BASE_URL` and a bogus
  `ANTHROPIC_AUTH_TOKEN` sent requests to the other server with that
  token. Hence no `ANTHROPIC_` or `CLAUDE` variable reaches the SDK, which
  also drops the cloud-provider switches (`CLAUDE_CODE_USE_BEDROCK` and
  the like). The providers' own credentials stay (inert without a switch),
  and so do proxy variables.
- **Dropping `CLAUDE_CONFIG_DIR`** means the SDK's in-process
  `getSessionInfo` would look under the parent's root while sessions run
  under the default one. When that variable is inherited, `hasSession` runs
  a short Node subprocess with the backend's environment; there is no
  option for the root.
- A `rate_limit_event` reports the plan's usage windows; `total_cost_usd`
  is a list price, not a charge. Each session made one small Haiku request
  of its own (about 1,300 input tokens).

**Isolation from the learner's own Claude Code**

- `settingSources: []` alone kept out the user's `CLAUDE.md`, the
  repository's instructions, user skills, MCP servers, plugins and
  permission mode, but not the auto-memory (the model quoted the memory
  index), not Claude Code's bundled skills, and not the user's claude.ai
  connectors, which joined a few seconds in (about 2,500 tokens). Hence
  `skills: []`, `autoMemoryEnabled: false`, `disableClaudeAiConnectors:
  true` and `strictMcpConfig: true`. Loading the user's settings would also
  bring their `bypassPermissions` mode: never load them.
- **The account's email address reaches every session**, in a
  `session_context` reminder on the first message, built from the login's
  account record. `CLAUDE_CODE_DISABLE_ATTACHMENTS` does not remove it; bare
  mode (`CLAUDE_CODE_SIMPLE`) does, but does not use the plan login. A
  separate configuration folder would need a copy of the login, and
  refreshing one copy can sign the learner out. With no web tool and no
  network in the tutor's sandbox, it can reach only Anthropic, which has it
  as the account's, or a workspace file the model chose to write it in
  (the agent's judgment, task 3.0). Web access (stage 4) would let a
  request carry it, with anything else in the context; 4.0 has the point.
  Look again if an SDK adds a switch.

**Tools and ending a turn**

- With no `tools` option a session gets about 25 built-in tools
  (scheduling, worktrees, messaging, subagents) and its first request was
  15,000 to 19,000 tokens; name the tools. Custom tools are deferred behind
  tool search only when `ToolSearch` is among the session's tools; leave it
  out, and set `alwaysLoad: true` on the teaching tool server anyway.
- **The model does not stop after posting a question.** In four calls it
  went on each time: a sentence, once with a hint, once a second
  `ask_question`. A `PostToolUse` hook returning `continue: false` ended
  the turn every time, and the session continued normally. Not tried: the
  SDK's `_meta['claude/endTurn']`.
- A tool input that fails its schema is refused by the MCP layer before
  the tool runs (`MCP error -32602: Input validation error` with the zod
  issues), so the model gets the schema's messages; write them for the
  model.

**Stop**

- `interrupt()` stops a turn before or during its text. It does not cancel
  input the SDK has queued but not started, and the SDK has no public way
  to: hence the `UserPromptSubmit` hook and the second interrupt at the
  response's `message_start` (`architecture.md` section 7), with late tool
  calls refused and the output drained unseen. A request can start in the
  gap after the hook, so Stop does not promise zero tokens. Tested against
  a simulated SDK boundary, not a live model.

**Sessions and resume**

- The session id is chosen up front (`sessionId`), so it can be stored
  before the first turn. `sessionId` cannot be given with `resume`, which
  keeps the id.
- A session resumes by id in a new process. Resuming from another working
  directory still finds it and moves it there, so always resume in the
  folder it ran in: confinement follows the working directory.
- An unknown id fails before any model request: `initializationResult()`
  rejects with "No conversation found with session ID", which the backend
  maps to `SessionNotFound`. That match is on Claude Code's wording; if an
  SDK rewords it, sessions swept away would fail to resume instead of
  falling back. A session that exists is ready in 0.3 to 0.6 seconds.
- A resumed session keeps its first system prompt, unless it is
  `{ type: "custom", prompt, snapshot: false }`, which sends the current
  one; a changed prompt then costs one prompt-cache miss.
- Kept sessions are files under `~/.claude/projects/` (the path is in
  `architecture.md` section 11). Without `title`, Claude Code writes a
  title of its own, apparently with a small request.
- `getSessionInfo(id, { dir })` reads one session file with no process, in
  4 to 7 ms: undefined for an unknown id, another folder or a missing
  folder, and it never threw.
- Claude Code deletes session files older than the learner's
  `cleanupPeriodDays` (30 by default). A file backdated 31 days was deleted
  within a quarter of an hour by some Claude Code process; resuming it then
  failed as an unknown id does.
- A session whose process stopped while it wrote a reply resumes; its file
  ends with the message it was answering.

**One-shot calls**

- A `query()` with a string prompt, `tools: []` and `outputFormat`
  (draft-7 JSON Schema from `z.toJSONSchema`) returns `structured_output`;
  a grading on Haiku took 3.3 seconds. The SDK retries a reply out of shape
  itself and gives up with `error_max_structured_output_retries`; Gauss
  does not retry. The reply is checked against the zod schema too, which
  says more than JSON Schema.

**Thinking**

- Sonnet 5.5 runs with adaptive thinking, displayed as "updates", a mode in
  which the model writes updates for its user in its thinking, which the
  page never shows. `thinking: { type: "disabled" }` is not sent to a
  model that rejects it, so it changes nothing; `display: "summarized"` did
  not help either. What this did to feedback, and the fix, are in "Session
  engine".
- To read a run: Claude Code's session log holds the turns as sent, tool
  inputs, thinking blocks and each request's parameters (`api-request`).

## Confinement

The tutor's option set is `workspaceOptions` in `backends/claude.ts`;
what it allows is `architecture.md` section 5. The stage 0 runs that
settled it kept every write inside the working directory, and also kept
both layers off one protected file inside it (a `disallowedTools` rule
`Edit(/<file>)` and the sandbox's `filesystem.denyWrite`); the built set
needs neither, since the record lies outside the workspace.

- **Two layers are needed.** The sandbox (bubblewrap on Linux) confines
  shell commands and what they start; `Write` and `Edit` run outside it and
  are confined by `blockWritesOutsideWorkingDirectories` and the `Edit`
  allow rule. Refused in stage 0: `Write` outside, shell writes to `/tmp`
  and the home folder (also with `dangerouslyDisableSandbox`), Python
  writing outside. An `Edit` rule with one leading slash is anchored at
  the working directory; `//` makes it absolute, which `/${dir}` does for
  an absolute `dir`.
- **`dontAsk` needs an allow rule for `Bash`**, or some sandboxed commands
  are refused as a permission matter with no reason given.
- **As built** (task 3.3, Haiku 5.5): writes beside the record were refused
  by both layers, and `curl` by the sandbox's proxy (403). A `Write` over a
  record file is refused first because Claude Code wants a file read
  before it is overwritten, and `dontAsk` refuses `Read` outside the
  working folder (`Glob` and `Grep` not tried). The engine's refusal
  reaches the model as `PreToolUse:Write hook error: <reason>`.
- **A session leaves `.claude/.cc-writes/` in its working directory**, an
  empty folder closed to others. Left there (the agent's choice): Claude
  Code makes it again, it holds nothing, and git keeps no empty folder.
- **The tutor's working directory is the course's `workspace/`** (task 3.0,
  the agent's choice), so the record lies outside it and both layers keep
  it out with no list of paths. Rejected: the course folder as the working
  directory with each record file denied, since every new record file
  would need its own rule, and whether a deny stops a command creating a
  file that does not exist yet was never tried. Artifacts are written by
  the engine, so the tutor needs no second folder. Intakes run in the data
  root's empty `intake/` folder, so a tool given to them later is confined
  to nothing of value.
- **Every tutor gets the tools**, in every course: one way of running, and
  a math tutor can check its own expressions with Python. The planners and
  one-shot calls get none. Only when the engine's sandbox passes its start
  check (the agent's choice): Claude Code's sandbox needs the same `bwrap`,
  `socat` and `rg`, and with `failIfUnavailable` a session whose sandbox
  cannot run would fail at start, so the tutor rather runs without them.
- **`CLAUDE_CODE_TMPDIR` in the course folder is too long.** The sandbox
  leaves Claude Code's per-user temporary folder,
  `<CLAUDE_CODE_TMPDIR or the system's>/claude-<uid>`, writable, and the
  system's one is shared by every Claude Code session of the user. Read in
  Claude Code 2.1.325's code: sandboxed commands get that folder as
  `$TMPDIR` only if its path is at most 44 bytes, for Unix sockets;
  otherwise the shared `/tmp/claude-<uid>`, with a warning. A folder in the
  course is at least 48 bytes, so the tutor's is a private folder per
  course under `/tmp` (31 bytes), checked because `/tmp` is shared.
- **The engine runs model-written text in a sandbox too** (task 3.0, the
  agent's choice): a code question's tests and the symbolic check, whose
  SymPy parser evaluates its input. It uses
  `@anthropic-ai/sandbox-runtime`, the runtime Anthropic developed for
  Claude Code's sandbox (a research preview, version 0.0.x). Rejected: a
  bubblewrap command line written by hand (Linux only, and each protection
  the runtime adds would be ours to get right), and running tests through a
  tutor session, which puts a model between the test and the grade.
- **The engine's sandbox** (`engine/sandbox.ts`, runtime 0.0.83). The
  network namespace and proxy refuse direct TCP connections and proxy
  requests. Without a network section the runtime does not start. A child
  moved to a session of its own stops at the time limit (the PID
  namespace), and a server killed with SIGKILL takes its commands with it
  (`--die-with-parent`). The runtime's unasked writable paths are closed in
  `configFor`.
- **Linux only** (the agent's choice). The macOS runtime can leave
  descendants alive after the direct command exits; the deadline and the
  tutor's workspace reservation cannot rely on that exit. Until there is
  verified process-tree containment, commands and built-in tutor tools stay
  off on other platforms.
- **Linux commands need an extra workload filter** (the agent's choice).
  Runtime 0.0.83 blocks `socket(AF_UNIX)` but permits `socketpair`; a
  datagram endpoint was reconnected to a scratch host socket. So commands
  run `pytools/sandbox_exec.py`, an inherited seccomp filter, inside the
  runtime (the venv's Python, no compiler or vendored binary), and
  startup refuses tools if a route stays open. The filter refuses datagram
  and seqpacket pairs only: uv panicked at start when every pair was
  refused (tokio's signal handling makes a stream pair), and asyncio needs
  one too. A stream pair is connected for good: connecting one end to a
  host socket fails with `EISCONN` (a test in `sandbox.test.ts`).
- **Each engine command has its own `$TMPDIR`** (the agent's choice). The
  runtime points `TMPDIR` at `/tmp/claude`, shared by every sandboxed
  command, which the module closes; with no writable temporary folder,
  Python's `tempfile` falls back to the working folder, and pytest's
  folders would land in the workspace.
- **`uv run` fails in both sandboxes**: its cache, `~/.cache/uv`, is
  read-only there. A venv's own Python runs, and so does `uv run` with
  `UV_CACHE_DIR` in `$TMPDIR`. So the tutor is told to run
  `.venv/bin/python` (`tutor.md`, "Packages").
- **Installing packages is the one command with network access** (the
  user's pick, piece 14). The tutor names the packages and the engine
  builds the command (`engine/packages.ts`; names checked in
  `src/shared/packages.ts`): reads are not confined, so tutor code must
  never run with network access. Python through uv only; add another
  language's package manager when a course needs it.
  - The network is `registerCommandNetworkLists` with `pypi.org` and
    `files.pythonhosted.org` exactly: the runtime matches a host whole.
    Seen: `pypi.org` tunnelled, `example.com` and `github.com` refused with
    403, a command given no hosts refused all.
  - **The installer uses an engine-owned uv project outside the
    workspace** (the agent's choice): `--no-config` and `--no-sources` did
    not stop uv reading the workspace project's dependencies, and
    `--no-build` does not forbid every first-party or editable build.
    Earlier packages are carried forward only from transcripts that
    record the request, approval and successful install (the user's
    choice).
  - **A journal makes rollback and recovery independent of approval** (the
    agent's choice): uv writes the new environment at its final path, so
    its entry points keep their paths, and only committing the journal
    makes it usable. A restart can then finish either the install or its
    rollback without treating it as a new approval.
  - An open question gets no extra tutor turn for an install's outcome: a
    normal reply or later feedback carries the note.
- **The backup keeps the learner's workspace files** (the agent's choice):
  they are the learner's work, small, and the history undoes a tutor's
  overwrite. A `.gitignore` Gauss wrote before is brought up to date, one
  of the learner's own is left alone.
- **An open question locks the course's whole workspace** (the agent's
  choice): another unit shares those files, and the help judge sees only
  the reply's text. A write or command holds the workspace until its
  completion or denial is reported, so a missing report keeps the course
  locked even after the session closes (SDK shutdown is asynchronous); a
  restart is the way out. Background Bash is refused so a running command
  cannot cross a question's posting.
- **Reads are not confined**: sandboxed commands can read most of the
  machine, credential files included, and the engine's commands get the
  server's environment. With no network and no web tool, what the tutor
  reads can reach only Anthropic. `blockReadsOutsideWorkingDirectories`,
  tried in task 3.3, is off: it hid the home folder from sandboxed
  commands (`ls ~` empty), where mise installs `python` and `uv`, which
  were then not found, and it still let a command read `../state.json`
  with the data root in `/tmp`. Settle reads before the tutor gets web
  access.
- **Artifacts.** The frame and response policy give the aid an opaque
  origin and allow inline scripts. CSP has no `navigate-to`: the parent
  page's `frame-src 'self'` stops an external navigation, but a direct
  tab has no parent. The user chose inert text for direct loads, rather
  than refusing them. `'unsafe-eval'` is allowed in the frame so an aid
  can plot a function the learner types.
- **WebRTC gets out of an artifact.** In the frame, an `RTCPeerConnection`
  given a public STUN server gathered a server-reflexive candidate: the
  request reached the server. CSP's `webrtc 'block'` is "Unrecognized" in
  Chromium 157, and removing the constructor in the artifact is undone by
  a nested `srcdoc` frame's own script. So a document the tutor writes can
  send what it holds out, by STUN or TURN. Left open in stage 3, where the
  tutor reads no text from outside the machine; with unconfined reads it
  is a channel out for a tutor misled by a source or a web page, so 4.0
  settles it. DNS prefetch from an artifact was not tried.
- **Artifacts in the record** are named by a hard link, so a file there is
  never replaced; the engine refuses a write when no safe number remains
  rather than repeat one. `show_artifact` is refused while a question of
  the unit is open, not of the course: the help judge sees only that
  unit's replies, and another unit's tutor can say anything in text too.
  At most 100 KB: Haiku's two aids were 3.3 and 3.5 KB, and the limit
  catches a pasted library. A document naming an address on the web is
  refused with the address, since nothing would load in the frame and
  models reach for CDN scripts.
- **No KaTeX in artifacts.** The app's KaTeX would need a route for its
  files and exceptions in the policy naming the server's host and port;
  MathML and Unicode text need neither, so the policy loads nothing.
- **An aid's errors leave its frame by `postMessage`** (the user's
  decision of 2026-11-19 that the tutor hears of them; the channel is the
  agent's choice, open to change). The page cannot read a frame of
  another origin, so the app adds a one-line reporter to the document it
  serves to the frame, on the doctype's line so the aid's line numbers stay
  the tutor's. It sends only the first error, as a drawing loop would
  repeat one many times a second, and posts to `"*"`: the frame's parent
  can only be the app's page (`frame-ancestors 'self'`). The page checks
  `event.source` against the shown frame's window; the origin is `"null"`
  for every sandboxed frame, so it cannot tell them apart.
- **WebKit mutes an aid's errors.** In a frame with an opaque origin,
  WebKit gives the `error` event only "Script error." with no line, for
  errors at the top of an inline script, in a timer, in `eval` and in
  `new Function`; only an error caught in the aid's own code keeps its
  text. Chromium 157 gives each in full, with its line in the document.
  So in WebKit the tutor learns only that the aid failed. Wrapping the
  aid's callbacks in the reporter would get the text through for timers
  and handlers, not for the top of a script; not built.

## Codex

From the stage 0 spike (`@openai/codex-sdk` 0.169.0, ChatGPT login), for
stage 6.

- It runs on the ChatGPT login with no key. Each turn is a new `codex exec`
  process; a thread continues by id. The SDK has no system prompt option,
  no in-process tools and no hooks.
- **Text does not stream**: each message arrives whole. The app server's
  protocol has text deltas (`item/agentMessage/delta`, read from the
  binary, not tried), so a streaming backend would drive `codex
  app-server` instead of the SDK.
- **Teaching tools work over MCP** from Gauss's process, given as a config
  override `mcp_servers.gauss = { url, default_tools_approval_mode =
  "approve" }`; without the approval mode, `approval_policy = "never"`
  refuses the call. A tool ends the turn by having the backend abort it
  (the per-turn `AbortSignal`); the thread resumed normally after.
- **The thread id arrives with the first turn**, not from `startThread()`,
  which the adapter's `backendSessionId` does not allow yet.
- `model_instructions_file` replaces Codex's own instructions.
- **The learner's own setup cannot be kept out.** Overrides removed the
  ChatGPT apps (`features.apps = false`) and named MCP servers, but not the
  global `AGENTS.md`, the skills section, the multi-agent sections or the
  collaboration tools. Candidates: a separate `CODEX_HOME` with its own
  login (copying `auth.json` risks signing the learner's Codex out), or the
  CLI's `--ignore-user-config`, which the SDK cannot pass.
- The SDK saves every thread under `~/.codex/sessions/`, with no option to
  skip it.

## Record

The layout and the rules for writes are `architecture.md` section 3.

- **Ids are slugs** (at most 60 characters), so an id can never be a path.
  A course id is the folder's name, made from the title (cut at a word to
  50 characters, `-2` and so on if taken), and making the folder claims
  it. The planner names the units, so a revision keeps their ids and the
  page can mark what changed.
- **Prerequisites** must name units in the curriculum, once each, with no
  cycle; they need not come earlier in the list. The checks sit on the
  units array, so they travel with that field into `propose_curriculum`'s
  input, and their messages are written for the model.
- **No schema version**: only Gauss writes the files, so a field added
  later is optional and records are never migrated.
- **Atomic writes' crash test** runs the write in a child under `ulimit
  -f`, so the kernel stops it partway every time; a `SIGKILL` landed inside
  the partial-write window only 10 to 20% of the time.
- **A damaged file is a loud error**, since atomic writes cannot make one:
  it means a hand edit or a bug. The library still lists a course it cannot
  read, so one bad course does not hide the others, and a transcript line
  that cannot be read is left out, since page events change shape over
  time and the record does not need them.
- **The file lock** (`record/file-lock.ts`) queues work per absolute path,
  in the module, so two `openDataRoot` calls share it; the record takes it
  when called, before its first `await`. Without it, two writes to one file
  each land whole but the later one can finish first. Another process
  writing the root is not covered; only Gauss writes it.
- **Logs.** Before an append, an unfinished last line is cut away, or the
  next entry would be glued to it and lost. `appendJsonLine` writes until
  the whole line is stored, since one write can store fewer bytes than it
  was given.
- **Positions are read with `Object.hasOwn`**: `constructor` is a valid unit
  id, and `units[id]` found `Object.prototype.constructor`.
- **A plan teaches each objective in exactly one segment**, so "go over
  them again" is a segment kept in the position, not in the plan. Planning
  a unit again is not designed; `storePlan` refuses it. The record does not
  check a position against the plan; the engine's rules do, before
  anything is written.
- **When each unit was last opened is in `course.json`**, not `state.json`:
  the engine writes positions from inside each chat's queue, and a second
  writer there could lose an update.
- **Transcripts are not flushed.** A flushed append took about 38 ms here,
  and flushing each batch made the whole-unit test half as slow again. A
  stopped server loses none of a transcript, a killed one its last moment,
  a stopped machine its last lines. Files are numbered per unit and sorted
  by number, not date, so a clock set back cannot reorder them.
- **The backup** exists because a valid but wrong write by an engine bug
  could not be undone. It runs the installed `git` (no package), as
  "Gauss" with signing off, so the learner's identity and keys are never
  used, and with `GIT_*` variables dropped, so a server started from a git
  command does not commit into another repository. A data root inside
  another repository gets its own; one that is already a repository keeps
  its own rules. Answers are not committed one by one: the segment's close
  takes them.

## Objective status

The rules as built are `architecture.md` section 4, "Phases".

- **The passing rule** is the user's (2026-11-17): since the last miss, two
  unassisted correct answers to different questions at any confidence, or
  one at 90% or 100% if the objective was never missed. It replaced the
  agent's rule of 2026-11-16, which needed a confident answer, so correct
  answers given unsure counted for nothing (the theology record had two,
  at 75% and 50%). Kept from that rule: after a miss, one confident answer
  is not enough.
- **A miss** is a wrong answer or "I don't know", with help or without, and
  clears the correct answers before it; so a miss after a pass takes the
  pass away ("Mastery loop" for slipping). "I don't know" is never a
  confident miss.
- **Different questions** means what the learner saw differs: the prompt
  and the choices, spacing ignored. Code cannot judge variety beyond that;
  `tutor.md` asks for it.
- **Help.** A correct answer given with help counts for nothing and clears
  nothing. Help is marked when the tutor *receives* a message while the
  question is open, not when the learner sends it, so a message written
  during the lead-in and delivered after the question counts. Whether a
  message was help is a judge's call (the user's, 2026-11-16; "Help
  judge"). Rejected: the tutor declaring help with a tool, which rests on
  the model's word.
- **Moving on from the closing card overrides only the objectives not
  passed**, so passed ones keep a clean record.
- **"Attempted"** names an objective with evidence that has not passed; not
  "in progress", which is a unit's word. Learner-facing copy says "Not
  passed yet".
- **Log order decides**, not `recordedAt`: the log is appended under the
  lock, so its order is the order of recording even if the clock jumps.
- **A unit with a position is in progress** whatever its evidence: one just
  started has none. A unit with unfinished objectives and no position is a
  record left half-written, and shows as in progress.
- **No question limit.** The agent's limit of three questions per objective
  per check closed segments with objectives not passed in the user's first
  sitting, against the brief's rule. The learner sets the pace through
  detours and can always move on.
- **Each objective gets at least one question in every check**, even if it
  passed before: the check is the segment's.
- **"This check" is a point in the evidence log** (`checkFrom`). Rejected:
  a list of answers in `state.json`, which copies the evidence, and a start
  time, since log order decides.
- Status is derived, so a rule change applies to old records when they are
  read. At the 2026-11-17 change, the user's courses were re-derived
  read-only and no status changed.

## Calibration

- **What counts**: for each confidence level, the unassisted answers and
  how many were correct. Answers with help are left out ("I don't know"
  included): help says nothing of how sure the learner was alone. "I don't
  know" asks no confidence, so it is counted apart. Overrides are not
  answers. An answer on an objective no plan holds still counts.
- **Per course**, by the user's decision; counts, not percentages, since
  answers are few and a percentage reads as more than it is.
- **Answers from before the 2026-11-17 passing rule count.** The evidence
  holds no rule version, a cut by date is loose (a running server takes a
  new rule only on restart), the incentive to claim 90% exists under both
  rules, and the user's record showed honest answers against it. A cut
  would have left the counts empty.
- **Level order is `CONFIDENCE_LEVELS`** (`src/shared/question.ts`), not
  `Confidence.options`: zod 4 keeps an enum as an object's keys, which
  puts integer-like keys first and "under-50" last.

## Session engine

How the chats work is `architecture.md` section 4; these are the reasons.

**Phases and steps**

- **The learner starts each segment** and **the engine closes it**: there
  is no `start_segment` or `close_segment` tool. The check rules already
  decide when a check is done; a closing tool decided nothing, cost a
  turn, and a tutor that forgot to call it stalled the check.
- **Any end of the teaching turn opens the discussion**, a failure
  included, so the learner can ask for what was missed.
- **The learner's steps are refused while the tutor writes**: taken at
  once, each would put a marker in the middle of a reply still streaming.
- **Moving on is allowed from the discussion on the server**, since the
  brief lets the learner always move on and making them press "ready"
  first would cost a turn; the page offers it only in the check, as mock 3
  does.
- **Moving on sends the tutor nothing**: a turn would cost a reply and a
  wait before the next segment. The next turn's header says it; a restart
  before then loses that note.
- **Headers are composed when the turn is sent**: a message written during
  the teaching reaches the tutor after it, and must say "discuss".

**The feedback turn**

- **Found in the tutor prompt's first run (Sonnet 5.5):** in 7 of the 8
  turns that had to give feedback and then post the next question, the
  feedback went into the tutor's thinking, never shown; all 13 turns with
  no tool to call wrote their text. Telling the tutor its thinking is
  never shown did not help, nor did the thinking settings ("Claude
  backend").
- **Tried and dropped:** refusing the tool until text had been written got
  the order right, but three of four refused turns then stalled, asking
  the learner to "send any short message, such as 'continue'", even when
  told never to. A `feedback` field on the tool would not stream, and a
  tutor that also wrote text would repeat itself.
- **Chosen:** the turn after a correct answer is feedback only, with no
  tool, and the engine then asks for the next question in a turn of its
  own: one more turn per answer. In the rerun all six feedbacks were
  written, and no turn stalled.

**Queues**

- **One queue per unit chat**, in `unit-chat.ts`, which keeps the phase
  rules, the tools and the learner's actions together: apart, each file
  would need the other's checks. Reads of the record are safe outside it.
- **Feedback blocks questions from when it is queued**, not when it
  starts, or a reply already running could post the next question first.
- **The automatic next question is skipped** if a reply has posted a newer
  question since, or the learner pressed Stop since the answer was sent (a
  Stop count captured then). Feedback and the end of a detour share this
  guard (`askNext`); both orders were reproduced as races.
- **Stop is kept on the turn in progress** from the moment it starts: both
  backends cleared their stop flag on sending, so a Stop while the session
  started or the text was composed was lost.

**Answers**

- **A written answer is final once sent**, kept before grading so a restart
  cannot lose a long proof; letting the learner change it after a failed
  grading would mean judging help again. The grader runs outside the
  queue, since it takes seconds or minutes.
- **A question has one answer**: a crash between appending the answer and
  closing the question once let reopening grade it again, which could turn
  a passed objective back.
- **Moving on is refused while a written answer waits for its grade**, also
  after a failed grading, or the override would withdraw the proof. While
  grading keeps failing the learner cannot leave the segment; the tutor
  runs on the same backend, so it is likely down too.

**Detours**

- The user's design (2026-11-16) replaced one in which a detour pushed the
  position and ran its own small cycle through a `start_detour` tool. The
  check's next question is the re-check, so a detour needs no phases of its
  own, and since the engine opens it and the learner ends it, the tutor
  cannot skip it.
- **Teaching again starts at the objective's second miss in this check**
  (misses before the check do not count), and every later miss asks for it
  again: if two ways did not work, a third is wanted.
- A restart that cut the detour's first turn off does not resend it; the
  unit opens in the detour, and the next message gets the detour's header.

**Choice order**

- **The engine shuffles choices when a question is posted**
  (`engine/choice-order.ts`): the tutor put the right choice at A in most
  questions, and told to place it at a random letter, it wrote a wrong key
  in 1 of 4. The tool's reply lists the order, since the tutor may discuss
  the question before the answer turn repeats it. The key is still the
  tutor's, so `tutor.md` still asks it to check the letter.

**Unit planning**

- **A unit is planned in a session of its own**, before the tutor's starts:
  a source unit's whole text is read there once rather than carried through
  every teaching turn, and each prompt has one job. The cost is one more
  model call per unit.
- **`plan_unit` is bound to the unit** being planned, so the session cannot
  plan another.
- **A session that ends without a plan is retried in a new session**,
  since one that failed in the backend may not take another turn, and the
  one turn carries the whole context. A plan failing its field types is
  refused by the SDK before the tool runs, so the retry's header can say
  only that the session ended without a plan.
- **Two openings of one unit share one planning**, or the second would plan
  a unit the record then refuses.

**Intake**

- **The first proposal creates the course**: the intake mock has no title
  step, so the planner proposes the title. The page asks the opening
  question, so no model turn is spent on a greeting.
- **Approval names the proposal the card shows.** A revision whose
  `style.md` write failed had already replaced `curriculum.json`; approving
  the earlier card approved units the learner never saw. Reversing the
  writes would only change which part goes unseen, so approval compares the
  files with the card (`DraftMismatch`, 409).
- **The opening turn cannot propose**, so the learner answers once; whether
  a later reply agrees to a proposal is a judgment on their words, left to
  `planner.md`.
- **A session lost before any proposal is given the conversation so far**,
  as JSON in the header, since the learner's next message usually answers a
  question the new session never saw. The JSON is followed by a space: the
  scripted backend ends a header at "]\n".
- **Intake setup follows delivery, not queueing**: a first turn that failed
  to start, or was stopped, must not use up a reopened draft's context.

**Resume and idle sessions**

- **Opening a unit only asks whether its session is there**: resuming at
  the opening would start a process for a unit opened just to look at it,
  while asking still shows a lost session's marker before the learner
  writes, in the common case of a session swept while the unit sat
  unopened. A session gone between the opening and the turn falls back at
  the turn, the marker after the learner's message (matched by its id).
  A lookup that throws is taken as found, and the turn finds out.
- **Only a session not found falls back.** Any other failure fails that
  turn, and the next turn tries again: a passing fault must not cost the
  conversation. Start fresh is the way out of a fault that stays.
- **The fallback sends nothing**, so opening a unit costs no reply. Start
  fresh takes the old id out of the position first, so a restart in
  between makes a new session rather than resuming the old.
- **Idle sessions close after ten minutes**: a process holds memory while
  it waits, and a resume costs the next turn about half a second.
- **The timer is passed in** (`createFakeTimer` in tests), because Vitest's
  fake timers would also fake the timers the record's writes and the tests
  rely on.

**Sessions and transcripts**

- **A session is a sitting**: it ends after an hour quiet. Rejected: one
  per chat (a server left running for days would be one sitting) and one
  per backend session (resume stretches it over many). The hour is a
  guess.
- **None starts inside a tutor's turn**: a reply the machine slept through
  was split, and the page took the split for a restart.
- **Transcripts hold page events**, not the tutor's headers or rubrics; the
  turns as sent are in Claude Code's session log.
- **Replay joins each reply's text**: a real backend's pieces come further
  apart than a write takes, so a transcript holds a line a piece, and a
  reconnecting page would be sent about 18,400 events instead of 490.

**Finished units** are not started again; starting a unit over is not
designed.

## Grader prompt

- **The set** (`scripts/grader-set.ts`, run by `scripts/grade-set.ts`): 11
  written answers to 4 questions, graded by hand, among them a wrong
  expansion "factored" to the right result, a missing case, a proof in
  words, another valid method, a circular argument, a bound never secured
  and a note asking for a pass.
- **Sonnet 5.5 is the grader's model.** It agreed with every hand grade in
  all eight of its runs over four prompt versions, and named the first flaw
  each time. Haiku 5.5 failed the correct proof in plain words on the
  fourth version and broke the flaw's rules more often. A false pass stands
  for mastery unless disputed, so the grader is where judgment pays. Opus
  was not tried: Sonnet left nothing on the set to improve.
- **What the grader sees**: the question as the learner saw it, the rubric
  and the answer, each between tags, so an answer that reads like
  instructions stays an answer. Not the objective (the rubric covers it),
  not the confidence (it must not sway a grade), nothing of the
  conversation (the brief forbids it).
- **No partial credit**, because the passing rule reads verdicts. A flaw
  named on a correct answer is dropped rather than failing the grading.
- **The rules, each from an answer in the set**: check the answer in its own
  order and redo every computation (a wrong line can reach the right
  result); look for what the argument needs and never secures (a case, a
  direction, a bound's condition, a quantity that must depend on another);
  the conclusion given as a reason is a flaw; what may be assumed is what
  the rubric allows and standard facts below the question's level; any
  valid method is correct; wording does not count; a slip of notation is
  one whose meaning is plain and on which no step depends.
- **The flaw** is the first problem, pointed at, in one or two sentences.
  It never mentions the rubric, which the learner never sees, and never
  gives the repair, which the learner is to find with the tutor. A rule
  quoting "such as ..." invited repairs (4 of 14 flaws); said without the
  quote, and in `WrittenGrade`'s description, 1 of 14, and none with the
  final wording.
- **`WrittenGrade`'s descriptions** say "establishes everything the question
  asks, with every step valid": "meets the rubric in full" contradicted the
  rule on other methods.
- **Left as it is**: one flaw also names the false step after the first, and
  a few run to three sentences. Tightening further would fit the prompt to
  these 11 answers.

## Help judge

- **Definitions** (the user's): clarification is only what the question
  asks (its wording, notation, the form of answer wanted); help is anything
  toward the answer (a method, a step, a value, a similar worked example, a
  mistake to avoid). The judge adds: reacting to a guess ("on the right
  track", "not quite") is help, and a reply that gives nothing toward the
  answer (a refusal, an acknowledgement) is clarification, since the
  verdict is only whether the answer still counts.
- **When unsure, help**: a false clarification lets a helped answer pass; a
  false help costs one more question.
- **One exchange at a time**: the question with its key or rubric, the
  message and the whole reply. Not the objective or the conversation
  before. So a hint spread over two replies, each harmless alone, would
  pass.
- **The reason comes before the verdict**, so the verdict follows from it;
  it is printed by the set's runner but never stored or sent to the page,
  since it can name the correct choice.
- **A failed call counts as help.** Two minutes, shorter than the grader's
  three, since an answer may be waiting on it.
- **An answer sent before the calls are in waits for them**, kept as a
  written answer is while graded. A written answer is graded after the
  judging, not alongside: simpler, and rare.
- **A restart counts unjudged exchanges as help**; judging again from the
  transcript was rejected as complex for a rare case. A judging cut off by
  the server shutting down is not recorded, so the next opening decides.
- **A clarification label is about its reply only**: a later clarification
  does not undo an earlier help.
- **Haiku 5.5 is the judge's model**, 2.5 to 4 seconds a call. The set
  (`scripts/help-set.ts`) grew from 19 exchanges to 25 on seven questions,
  ten clarifications and fifteen helps, among them a refusal with a hint,
  a message telling the judge it is clarification, and a math and a code
  question's three each. At each size one run agreed with every hand
  verdict; the others differed only on C3, judged help (the safe side),
  which C3 alone did not repeat in four runs. Sonnet was not tried: Haiku
  left nothing to improve, an answer can wait on the call, and the call
  follows every message during a question.
- **The page's notice** says asking what a question means is free and a
  reply that helps makes the answer count as given with help. "Anything
  else counts as help" was not used: the tutor declines what it may not
  give, so asking for more is free when the reply gives nothing.

## Symbolic check

The agent's choices (tasks 3.4 and 3.5), open to change.
`pytools/mathcheck.py`'s header states what it reads and counts as
equal; the pairs that settled the rules are its tests. These are the
reasons and traps.

- **SymPy's LaTeX parser on its ANTLR backend** (SymPy 1.14, with
  `antlr4-python3-runtime` 4.11, the version SymPy checks for). Plain input
  is rewritten to LaTeX first, so one parser reads both, and it builds
  SymPy objects without evaluating text. Rejected: the Lark backend, which
  in 1.14 returns ambiguity trees in place of expressions for ordinary input
  (`\sin x + 1`, `2\sin x\cos x`, `\sinh x`) and refuses `\pi`;
  `parse_expr` or `sympify` for plain input, which evaluate it as Python:
  `__import__('os').mkdir(...)` made its folder when a fault put `sympify`
  in the reading.
- **The parser's traps**, each rewritten before or after parsing: with
  `strict=True` it still reads an unknown command as a variable (`\foo x`
  as foo·x, `\mathrm{e}` as e·mathrm), so commands are whitelisted; it
  reads `x(x+1)` as a function call, `d` before a letter as one
  differential symbol (`dn`), and `\pi` and `e` as variables; it refuses
  `\left(`, `\sqrt(x)`, `x^(2n)`, `x^-1` and a number with a leading zero.
- **Refused where the parser would guess**: a product after division,
  ungrouped chained powers, double factorial, indexed roots, a literal zero
  superscript on a function. A comma always separates values (`1,000` is
  two). Derivative notation, inequalities, intervals, sums, integrals and
  limits are not supported. Undefined intermediate values are refused:
  SymPy can otherwise simplify `1/(1/0)` to `0`.
- **Equality requires a symbolic proof**; agreement on samples leaves the
  result undecided for the grader. Six values in [-3, 3] cannot
  distinguish `x+4` from `|x+4|`, and the fixed rational sample lattice
  aliases periodic expressions, so sampling is only a bounded search for a
  counterexample, for equations and constants of integration too.
- **Numbers**: correctly rounded decimals match (0.333 for 1/3, not 0.33
  or 0.334). Compare the exact difference to the exact bound: converting
  the sides to machine floats can erase the difference. No fixed relative
  tolerance may certify equality.
- **Lists match distinct values one to one**, tolerances applying only
  across the lists: one rounded value cannot stand for two nearby
  solutions.
- **`+ C` on both sides** lets the sides differ by a constant, since
  antiderivatives found by different routes do. A `C` that multiplies
  (`Ce^x`) is an ordinary variable.
- **Equations** match through a proven non-zero constant ratio of their
  residuals, tautologies told apart explicitly. An equation with one
  unambiguous isolated variable compares as its value; if both sides
  could name the variable, comparison with a scalar goes to the grader.
- **"Undecided"** (read, but not settled in time or not evaluable) goes to
  the grader, as an unparsable answer does.
- **Time**: an alarm bounds the whole eight-second comparison, and each
  simplification gets at most two seconds. The alarm raises a
  `BaseException` so SymPy's `except Exception` does not catch it. Exact
  arithmetic in C may not return to Python when the alarm fires, so very
  large literals are refused, and the engine kills the process at 12
  seconds.

Math questions in the engine (task 3.5):

- **Symbolic grading is opt-in**: the tutor declares that the default
  equality rules apply, and questions with special precision, exactness,
  domain, order or answer form use the grader. Checking the prompt for
  keywords cannot establish that it has no other constraints.
- **Primes are read, not refused**: `f'(x)` is an unknown function, so an
  expected answer with one posts, and every answer to it is undecided and
  goes to the grader. `tutor.md` tells the tutor to put no derivative
  notation in `expected`.
- **"Grade again" on a symbolic question retries the check too**: a
  failed run may pass.
- **The math rubric follows the question first** (`mathRubric`), using
  symbolic defaults only where the prompt has not specified a rule. The
  learner's reasoning is not sent: the grade is on the expression.
- **The page's math field previews KaTeX's reading, not the check's**,
  through the same Markdown and KaTeX path as all model text (`MathText`
  in `prose.tsx`), never as HTML. An expression KaTeX sets may still be
  unreadable to the check, and then the grader grades it.

## Code questions

The agent's choices, open to change. How the runs work is
`architecture.md` section 6; the card is in "Page design"; the sandbox in
"Confinement".

- **Run in a scratch folder, with declared dependencies saved at posting**
  (`engine/code-run.ts`). Linking other workspace files let edits to a
  helper change the grade of an unchanged answer, and copying the whole
  workspace would include unrelated files, so the tutor names the helpers,
  fixtures or scripts needed. An old open question without saved inputs
  cannot be graded reliably.
- **The learner's files are read when "Run the tests" is pressed** and
  kept with the answer, so a regrade or a restart runs the same files.
- **At posting both runs go at once**, inside the course's workspace
  queue, so no write of the tutor's comes between reading the starter and
  posting.
- **Infrastructure failures are not exercise misses**: a missing launcher
  or a failed sandbox records no answer evidence.
- **60 seconds a run.** A run past it fails the grading, since a slow
  moment can pass. A second run past it on the same files is a miss, with
  the output's end: the answer is final, and code that loops would
  otherwise loop on every retry with no way on. The first time-out is kept
  in memory, so a restart gives one more run. The other way, a time-out a
  miss at once, is the user's to choose.
- **The output kept** is both streams in order (`2>&1` inside the
  sandbox), its last 40 lines and at most 8,000 characters: pytest's
  summary is at the end, and a bare traceback ends with its error.
- **The help judge sees the tests and the solution**, not the command.
  A question's problem, for "different questions", is its prompt and set
  of file paths, regardless of display order.
- **"Open" names the file by its place in an open question's list**,
  never by a path (`OpenFilePost`), and only while the question is open,
  the only time the card has the button. The file must pass the same
  plain-file check as "Run the tests" (`workspaceFile` in `code-run.ts`),
  so a link the tutor left in the workspace cannot point the opener
  elsewhere. Not guarded: the default app is chosen by the file's type,
  which the tutor names, so a learner file named `.html` opens in the
  browser; whether some type's default app runs the file rather than
  showing it was not checked. The system default over a set command is
  the user's ("Product decisions", 2026-11-18): their own click would do
  the same.
- **An opener still running after 3 seconds counts as started.** xdg-open
  with no desktop opener of its own (its generic mode, as on the user's
  Hyprland) runs the app itself and can wait for it, while the failures
  seen came at once. Its errors go to a file, not a pipe: the app inherits
  the stream, and a pipe the server closed could kill it with SIGPIPE. It
  runs in a process group of its own, so Ctrl-C on the server does not
  reach the learner's editor. Without `WAYLAND_DISPLAY` or `DISPLAY`
  xdg-open exits 3 with "no method available", and the button adds that
  the server has no display.

## Disputes

The agent's choices (tasks 3.0 and 3.8), except who decides, which the
user picked from piece 13 of the mocks (2026-11-17). How disputes work is
`architecture.md` section 6; the look is in "Page design".

- **What can be disputed**: any graded answer, of any kind, at any time,
  in a finished unit too. Not "I don't know", which nothing graded (but see
  "The answer shown after "I don't know"" below). Not the help judge's
  call: "when unsure, help" is its rule by design, and a false help costs
  one more question.
- **One dispute per answer.** A second would be another draw from the same
  judge.
- **An outcome replaces the answer's verdict where the answer stands in
  the log**, not where the dispute does: a regraded answer counts as if it
  had been graded so. It is replaced where it is read (`countedEvidence`
  in `record/disputes.ts`), so the log stays append-only.
- **A wrong choice key or expected expression is corrected only by the
  dispute judge**, in a dispute or a report of the answer shown, and the
  correction shows wherever the key did; a corrected expression is shown,
  never graded against. The tutor is told in its
  next header, since its feedback or detour taught from the wrong key; a
  restart before then loses the note, as with moving on.
- **A choice outcome's verdict follows from its key.** The judge names the
  right letter; a verdict that does not follow from it is a failed call,
  not a guess at which the judge meant.
- **An outcome changes no phase**; the check rules decide at their next
  point. An overturned miss leaves its detour open until the learner asks
  for another question.
- **The learner sees what the answer was graded by while disputing**: the
  rubric, the choice key, the expected expression or the tests and frozen
  inputs. The question is over, the detour has already given the right
  answer, and an argument about a grade needs what it was graded against.
  Everywhere else the rubric stays hidden.
- **Who decides** (the user's pick): a one-shot call that sees the
  question, what it was graded by, the answer, the grade and the learner's
  reason, and nothing of the conversation, as the grader does. Rejected:
  the learner's own word, which would make "passed" mean what they say,
  and the tutor, which wrote the key it would judge and which a finished
  unit does not have.
- **The judge sees the tests and frozen workspace inputs, not the tutor's
  solution**: a fixture or launcher can set the verdict even when the
  tests look right, and the solution, already checked to pass, would argue
  for the tests.
- **An overturned pass in a finished unit records an override** of that
  objective with the dispute. A unit with no position and an objective
  neither passed nor overridden reads as a record left half-written, and
  opening it would teach it again from segment 1; the learner did move on
  from the objective when the unit ended. Slipping does not replace this
  ("Mastery loop"): the objective never passed. In a unit in progress
  nothing is added: its closing card offers the objective again.
- **Deciding is not kept**: the route waits for the outcome, since "What I
  know" has no event stream; a failed call, or a server stopped while
  deciding, records nothing, and the learner sends the dispute again.
- **Written in the unit chat's queue when it is open**, so it cannot land
  between the chat's own writes (finishing the unit, for one); otherwise
  directly, as only a chat writes the unit's position.
- **An overturned dispute on a written answer is a candidate for the
  grader's set** (`scripts/grader-set.ts`): added by hand, with its grade
  checked, when `grader.md` is next revised. Nothing is added
  automatically, since the set's grades are hand-checked.

**The answer shown after "I don't know"** (task 5.21; the user's decision of
2026-11-19, from the DeepTutor comparison; the details are the agent's):

- **"The answer shown is wrong" on an "I don't know" card**, decided by the
  dispute judge as a dispute is, once per answer, and recorded as a
  `DisputeEvidence` whose verdict is "unknown": the miss stands for status
  and calibration, and only the key or expected expression changes.
  Without it, a wrong key on an "I don't know" stays in the record and
  reaches the notes as the right value, as in task 5.13's first notes.
  Rejected: DeepTutor's way, where the tutor that wrote the key decides.
- **Choice and math questions only.** Their card shows the key or the
  expected expression; a written or code question's shows neither the
  rubric nor the tests, so the learner has nothing shown to find wrong,
  and an outcome can change only a key or an expected expression.
- **The learner writes a reason, required**, as for a dispute: it points the
  judge at the mistake, and a click alone would spend a Sonnet call on a
  hunch.
- **The judge sees the question, its choices, the key or expected
  expression, the answer as "I don't know" and the reason**: no grade,
  since there is none, and not where the learner got stuck, which says
  nothing of the key. The form shows nothing of what graded it, since the
  card already shows the answer shown. The prompt asks for the verdict
  "incorrect"; the engine does not read it, so a slip cannot turn the miss
  into anything else.

**The judge's set and model** (tasks 3.9 and 5.21):

- **The set** (`scripts/dispute-set.ts`, run by `scripts/decide-set.ts`):
  22 recorded answers with the learner's reasons, decided by hand: eight
  grades that should change, a wrong key beside a wrong choice, nine
  wrong answers disputed to persuade (effort, unfairness, certainty,
  instructions to the judge and the like), and four "I don't know"
  answers whose answer shown is reported wrong, two rightly (a choice key,
  an expected expression) and two with a wrong derivation. Not in it: a
  learner disputing a grade of correct.
- **An outcome agrees** when its verdict, a choice's right letter, and
  whether a math question's expected answer is corrected all match the
  hand outcome. A corrected expected answer is compared by the reader.
- **Sonnet 5.5 is the judge's model.** It agreed with every hand outcome in
  three runs over two prompt versions, 3 to 6 seconds a call, and in two
  more runs of the 22 with the "I don't know" section added (2026-11-20).
  Haiku 5.5
  agreed in its one run too, so the set does not separate them. Sonnet was
  kept: a dispute reviews the grader's Sonnet work, Haiku failed a correct
  proof in plain words on the grader's set, and disputes are too rare for
  cost to count. Opus was not tried. A set that separates the models would
  need longer proofs.
- **Math between dollar signs.** With the rule only at the prompt's end, 3
  of 18 reasons wrote math as plain text (`e^{-x^2}`, a matrix as nested
  brackets), which the page shows raw. Repeated in the `reason` field's
  instructions, with a matrix among its examples: none of the next 36.
- **Left as they are**: a few reasons run to five or six sentences, past
  the prompt's three, and some name the repair (a $\delta$ capped at 1).
  The question is over and the learner has seen what graded it, so neither
  was tightened.

## Mastery loop

Stage 5's design, from its breakdown (task 5.0, 2026-11-18) and the tasks
that built it. The choices are the agent's and open to change, except the
user's ("Product decisions", 2026-11-18), marked here as theirs. How it
works is `architecture.md` section 4.

**Assessments**

- **The unit's tutor asks them, in the unit's thread**, as runs of
  questions kept in the unit's position. Rejected: a separate examiner
  session, the first plan. It would be a second session in each unit chat
  to resume, stop, close when idle and start fresh; a miss needs teaching,
  which an examiner must not do; and the tutor that teaches the rest of a
  unit should know what its test showed. The cost is a section of
  `tutor.md` and questions posed from a long conversation.
- **An answer's evidence names its assessment** (`Assessment` in
  `evidence.ts`): retained needs to know that an answer was given cold,
  which log order alone cannot say.
- **One question per objective; a miss opens a detour and one more
  question**, then the run moves on whatever the answer: the brief's
  "short refresher and a re-ask", for review too (the user's), so every
  miss is worked through and none starts a run without end. After a miss
  an objective still needs two correct answers, so the second comes from a
  later review or from going over the unit's objectives again.
- **Fresh questions come from a list, not from memory**: the turn that
  asks for a question lists those the evidence holds on its objective,
  which also stops a new tutor session repeating a check's problems.
- **The assessment shares the position's question and detour** (task
  5.4), so the question flow, help judging and restarts are reused
  unchanged. Rejected: slots of its own, which every rule reading
  `openQuestion` would have had to learn.
- **The header gives another unit's objective with its unit and
  statement**: the tutor's system prompt holds its own plan only, and is
  not changed mid-session.
- **Another unit's answers reach both chats.** An answer on another unit's
  objective is told to that unit's chat, if open: its record is read once,
  and with a stale one a unit could finish passed with an objective
  slipping. The assessing unit reads the evidence again when the run ends,
  since another chat can have answered meanwhile (the end once said
  retained where the record said attempted). A dispute of such an answer
  goes to both chats: through the objective's unit alone, an overturned
  first miss still brought a second question.
- **The page pins only a question of what is under way**, and reopening
  reconciles the transcript's questions with the position and evidence:
  the transcript can lose its last lines, and clearing the assessment
  alone left an unanswered question active in the thread.

**Status**

- **Retained** needs an unassisted correct answer in a review or a gate
  since the last miss. A gate answer counts even on an objective passed
  minutes before, as the brief has it; a test's answer does not, being one
  answer with nothing before it. Retention does not lapse with time:
  review keeps returning to retained objectives.
- **Slipping is not "attempted"**, which would make a finished unit read
  as half-written and teach it again; a finished unit stays finished.
- **Only a review's or a gate's miss makes an objective slipping**, as the
  brief has it. A check can miss a passed objective too (the theology
  record has one, and a segment taught after a test passed its objective
  still asks it once), and there the objective reads "attempted". With
  the rule, every status of the user's five courses re-derived as before
  (2026-11-18).
- **An override marks a slipping objective overridden**, as it does an
  attempted one: moving on from the closing card is the learner's choice.
  Review then leaves it out.
- **A miss while testing out is not a miss afterwards** (the user's
  wording): it came before any teaching, and counted, it would take away
  the one confident answer that passes an objective never missed.

**Review**

- **Offered on a card** (the user's; the agent had recommended starting
  by itself), at most once an hour per course, so two units opened
  together get one card; an open question or a detour is picked up
  instead. Task 5.25 changes when.
- **Which**: what is due, slipping first, then the most overdue (the
  user's, 2026-11-19, from the LearnHarness comparison); never one
  answered within the hour; three over the whole course
  (`record/review.ts`). Not FSRS, which needs a rating per answer and
  many answers per item (the user's). As built (the agent's choices, open
  to change):
  - due 1, 3, 7, 21, then 60 days after the last correct answer given
    without help, by the row: correct answers without help in reviews and
    gates since the last miss. A check's correct answer restarts the
    clock and keeps the row; a slipping objective is due at once;
  - "most overdue" is the time since that answer over the interval, the
    lowest expected recall: a 1-day objective two days late comes before
    a 60-day one two days late. Days past due would put the long
    intervals first, which are the safest;
  - nothing due, no card. The gate's other units' objectives are review's
    pick, so only those due: asking the rest early spends the gate's
    questions on what is not at risk;
  - dropped: passed before retained and the least confident first. A
    retained objective a month unasked waited behind one passed the day
    before.
- **A message on the card skips it**: the learner has gone on. The turn it
  brings is sent after the teaching the card held, as a message during
  teaching is. One sent while the card is being offered (`offering` in
  `unit-chat.ts`) waits for it in the queue and skips it too: decided
  outside the queue, it reached the tutor while the card stood and the
  teaching waited.
- **Skip is refused while an answer is kept for grading**, as moving on
  is: it would drop an answer the learner sent.

**The gate**

- **Offered on a card, not started by itself**: it is the long one, and an
  answer is colder the next day. Skipping it is the brief's bypass, and
  records no mastery.
- **It asks only what is passed**: not what the learner just moved on
  without, and not what the test passed, which was cold when asked
  (`tested` in `status.ts`: a pass resting even partly on an unsure test
  answer is left out, and stays out after the whole unit is taught).
- **No `close_unit` tool**: the engine ends a unit as it closes a segment.
- **No closing card before it when every objective passed** (task 5.5,
  from piece 16). One standing when a dispute or another unit's answer
  passes the rest is shown again first, as passed: left as it was, it
  offered steps the engine refused while the gate waited.
- **A message leaves its card waiting**, where it skips review's: the gate
  is offered once and its skip asks first.
- **After it, the closing card's steps cover only what it left not
  passed**: what the learner moved on from before it was declined once
  already.
- **Other units, not only earlier ones**: several units can be in
  progress, so the page says "other units" where piece 16 said "earlier".
  The hour rule applies to them and not to the unit's own, passed minutes
  before by design.

**Testing out**

- **Taken before the unit is taught, never partway.** No feedback and no
  detour: a miss there means "teach me this". An unsure correct answer, or
  one with help, gets a second question at once, so the passing rule
  decides what can be skipped.
- **Nothing is skipped without the learner's say** (the user's): a
  confirmation before the test, and a result card whose answer does the
  skipping. What was passed stays passed either way.
- **A segment is skipped whole or taught in part**; the plan is not
  rewritten, so the outline still shows what the unit holds.
- **What is skipped is fixed when the learner answers the result card**
  (task 5.6; `testOut` in the position), not as each segment starts, as
  the breakdown had it: then which segment is last, the outline and the
  page's next step would need the evidence. The cost: a passed objective
  missed in another unit's review before its segment starts is still
  skipped, and the closing card offers it as not passed.
- **The test's state lives beside its run, not in it**: a review offered
  first holds the position's assessment while the test is due.
- **Its questions are counted by their objective's place** ("Objective 2
  of 5", from piece 16), since an objective can have two.
- **The tutor's word comes before the result card** (piece 16), which is
  the test's end marker; a restart before the card was shown asks again.

**Handoff notes and misconceptions**

- **Written by a one-shot call when a segment closes**, and when the unit
  finishes: the brief's "end of a session" is no event (a server stops,
  or an hour passes), and a sitting that closed nothing has little to hand
  on. Rejected: tools for the note and for misconceptions, which rest on
  the tutor remembering to call them (the feedback turn showed text lost
  when a turn also had to call a tool), and a call when the idle session
  closes, which spends one on every break.
- **The same call finds misconceptions**, from detours and the
  discussion, since it reads that stretch anyway. Open means not passed,
  so slipping and overridden ones are open too, as piece 18 draws one
  under "Not passed yet".
- **The unit's own note goes into a new session's first turn**, not the
  system prompt, which is sent with every request: changing it at each
  close would cost the running session its cache.
- **The stretch is read from the transcripts on disk, from a mark in
  `handoff.json`** (task 5.7) that moves only with a note written, so a
  failed call leaves its stretch to the next. Rejected: a marker event in
  the thread, which the page and the export would have to skip, and the
  chat's events in memory, whose text pieces are joined differently from
  the file's lines.
- **One call at a time per unit, and one more after it for a close
  meanwhile**: the last segment's close and the unit's end can come
  seconds apart, and the second needs the first's note.
- **Detours are numbered in the request**, and the engine maps a number
  back to the question's id: question numbers restart in each check and
  assessment, and an id is easy to miscopy. A misconception naming
  something not given is dropped alone, not the whole call.
- **The writer is given the misconceptions already recorded on its
  objectives**, so one shown again is not recorded twice.
- **Misconceptions are appended before the note is written**: a crash
  between leaves the mark, so the next call may record them twice; the
  other order would lose them.
- **Prerequisites' notes are the direct ones'**: they say how the ideas
  this unit builds on were taught. The chat reads the course's
  misconceptions again when an assessment is offered, since other units'
  calls write on its objectives.
- **Review and gate questions probe a recorded misconception without
  naming it** (`tutor.md`): naming it would be teaching in an assessment.
- **The call runs on Sonnet 5.5** (task 5.13): on ten stretches, with each
  revision of `handoff.md`, Haiku put wrong counts in a correction the
  learner reads in two of three runs on one stretch ("1,000 have the
  disease" for 1 in 1,000 of 100,000, so 17% for 2%), listed objectives
  the test passed as taught, and placed a fix in a later segment's
  detour. Sonnet made none of these, but ran to about 280 to 380 words
  against 250 asked; Haiku kept nearer the length but was dropped for the
  errors, which the learner sees in "What I know".

**Profile, notes and export**

- **The profile is free text the learner approves** (the user's),
  proposed with the curriculum and edited on a page of its own; nothing is
  written to it unseen, as with the style note. The index of finished
  courses is derived from the record, not kept in the file.
- **The planner gets the profile in its turns, not its system prompt**,
  which is fixed when the session starts, so an edit on the Profile page
  during an intake reaches the planner.
- **A draft keeps the profile it compared against**, so reopening cannot
  let an old proposal replace a later profile edit; the Profile page's
  save is checked the same way.
- **The draft is journalled and the profile published last**: two atomic
  writes do not make one approval, and writing the profile first leaked
  it to other courses when the curriculum write failed.
- **Sentences are compared whole** (`compareProfiles`), so a reworded
  sentence shows as one new and one dropped; `planner.md` and the tool's
  description ask the planner to keep unchanged sentences word for word.
- **Notes are written when the learner asks** (the user's), to
  `notes.md`'s standard. What clicked is the handoff writer's reading of
  the conversation, kept in the handoff note: a model's judgment, not a
  record.
- **A unit's notes are a page the writer designs and writes whole** (the
  user's): HTML with its own layout and styles, figures as inline SVG.
  Dropped: Markdown rendered by the engine into one fixed look.
- **The engine finishes the writer's document; it does not lay it out.**
  It draws marked TeX with KaTeX and writes KaTeX's stylesheet and fonts
  into the file (the user's pick), so the file loads nothing. MathML was
  dropped for both files: a browser draws it with the machine's math
  font, and in Chromium primes shrank to specks and brackets did not grow
  around a fraction.
- **Dollar-delimited prose math is rendered too**: a Haiku run used the
  requested display class but wrote inline fractions with dollars.
- **Notes have no script**: the file is opened from its folder, where no
  frame confines it, and a script could carry what the page holds to any
  address by navigating. The file's CSP alone cannot stop a link
  navigating away, so the engine removes navigation other than local
  fragments. Moving parts stay with artifacts.
- **The notes are read in the app as well as in the browser** (the user
  allowed the browser alone): the artifact frame already existed.
- **The transcript export is the engine's own document**, built from the
  page events so it reads as the thread does. A code test run is
  summarised by its recorded verdict, since its output can hold hidden
  assertions or expected values and free-form output cannot be redacted
  reliably.

**Style and curriculum changes**

- **Cards the tutor asks for** (`propose_style`, `amend_curriculum`),
  answered as a package request is.
- **The tutor hears a style answer in its next header, not a turn of its
  own** (the plan's): nothing waits on its reply. The applied note's text
  goes in the header because a running session keeps its system prompt;
  other open unit chats are told too, so no tutor teaches to the old note.
- **Refused while a question of the unit is open, not of the course**: the
  card would sit beside the question in that thread. One proposal waits
  per course, so two units cannot propose different notes.
- **The position and style file commit together**: writing the file first
  let Keep accept a changed note after a failed Apply. An undelivered
  decision stays in state until a turn carrying it completes.
- **A curriculum change commits by `curriculum.json`, rolling forward**:
  a change must differ from the curriculum it replaces, so the changed
  file is itself the proof. No undo record is needed, and Keep after a
  cut-short Apply finds the change applied rather than restoring old
  units over one started since.
- **"Started" is a plan, a position or a test-out**: a plan is stored
  when a unit first opens, before any evidence, and the evidence names
  objectives through it. A started unit cannot be dropped, but its title,
  goal and prerequisites may change; making a new unit its prerequisite is
  how a remedial unit goes in.
- **The tutor sees prerequisites in its unit list**: it sends the whole
  list back, and would otherwise change what it could not see.
- **The change card reuses the intake card's list and diagram**; a move
  compares the order of the units that stay, so inserting or dropping one
  does not mark its neighbours moved.
- **The planning conversation's proposal shares the course's one
  waiting place** (task 5.38, the agent's choice). It goes through the
  course's queue with the unit tutors' proposals (`CourseDesk` in
  `unit-chat.ts`), so neither can slip in between the other's check and
  its card. It waits in memory, not in `state.json`: the conversation
  itself is lost on a restart, and a stored proposal would then block the
  tutors with no card left to answer it. A tutor refused meanwhile is not
  told when it is answered.
- **Its Apply checks the started units again under the state and
  curriculum locks** (`changeCurriculum` in `record/data-root.ts`), as a
  unit's Apply does, since a unit can start between the proposal and the
  Apply. If the write reports an error after renaming, the published
  curriculum proves Apply succeeded, as it does for a unit's Apply. The
  planner's card is marked applied rather than left open for a Keep.

## Prompts

Findings from real runs, on Sonnet 5.5 unless a model is named; the task
id leads to the runs in its commit. Wordings are the agent's choices, open
to change.

**`tutor.md`**

- **Teaching** runs 250 to 400 words by default and never over 600,
  whatever the style note says: the brief caps it and lets the style set
  length, and the hard cap keeps a note from removing it.
- **Feedback** is under 100 words: one or two sentences for a confident
  correct answer, up to five otherwise. At 110 to 137 words it read
  correct proofs back and went through choices not picked.
- **Lead-ins help with nothing**, the trap included, and a question after a
  miss does not say how to avoid the mistake: the first run's lead-ins and
  a reply to a request for a hint named the very point missed before.
- **Choice keys**: the tutor checks the letter before calling (the engine
  shuffles; "Session engine"). Choices carry no letters of their own:
  Haiku wrote some (task 5.6).
- **Wrong keys are common enough to name** (task 5.13): three of about 28
  math keys were wrong (3/36 for 2/36, 1/12 for 1/18, 0.269 for 0.187),
  each a case miscounted or a step skipped, two of them seen by the tutor
  only in the detour. The tutor now solves the question again before
  calling, listing cases for a count; none wrong in the next seven, too
  few to say it works. Nothing in the engine checks a key's arithmetic.
- **Rubrics** list the steps a complete answer must establish, what may be
  assumed, that any valid method counts, and the errors that make an
  answer wrong: the grader reads what may be assumed from the rubric. A
  part the rubric requires is one the question names, and a detour after
  a part left out says what was right and what was missing, naming no
  misconception (the user's decision, "Product decisions"). On Haiku
  (task 5.14) the questions named their parts, one with "what work or
  travel" where the rubric needed both; the detour after an answer that
  left out travel said what was right and what was missing, and the
  handoff writer recorded no misconception from it.
- **Help**: clarify what the question asks, never a step, a value or the
  mistake to avoid; point a stuck learner to "I don't know".
- **One thing per question**, and nothing verbatim from memory: paraphrase
  and attribute (stage 4 revises this when quotes can be checked).
- **Promise nothing the app does not do** ("we'll come back to that skill
  later" was said in the user's sitting, and nothing kept it).
- **Refusals** are acted on in the same reply; never ask the learner to
  send a message.
- **The kind of question follows from what the objective has the learner
  do** (task 3.10): compute, math; write code, code; argue or explain,
  written; recognise or choose, a choice. A choice shows recognition, not
  that the learner can produce the answer, so it never stands in for the
  others.
- **The rule against copying sits in the Teach phase**: under "Code
  questions" it did not reach the teaching, and Haiku (task 3.7) and
  Sonnet (3.10) wrote out the very function the first code question then
  asked for. In the Teach phase, the next run taught the technique on one
  case and asked for it on another. An objective that names its
  implementation ("... using zip") leaves little else to teach.
- **Starters hold what the question gives** (task 3.19): an objective
  "stores values of the basic types in variables" got, on Opus and then on
  Sonnet under "leave out only the code the exercise asks for", a
  question that had the learner type four given values. Naming that as
  copying "even when the objective speaks of storing values" put the
  values in the starter in the next two runs. `unit-planner.md` now states
  a coding objective as what the code computes (not run).
- **Tests stay out of the workspace** (task 3.19): one run tried its tests
  before posting by writing them in the workspace and swapping its
  solution in and out by commands, leaving the tests for the learner to
  read and the starter with no line in the thread. `tutor.md` now says the
  posting checks make a trial needless, a trial goes in `$TMPDIR`, and
  starters go through the Write tool. The engine does not enforce it
  ("Known gaps").
- **No test command for the learner**: a first code question told the
  learner to run `python3 test_pairs.py`; the card runs the tests.
- **A package request ends the reply, after the teaching** (task 3.10):
  "say what each is for, then end your reply" had the tutor ask at the
  start of a teaching turn and teach nothing; "the last thing in your
  reply ... never in place of" the teaching fixed it.
- **Artifacts are shown unasked for what is seen or moved**, with
  examples, and open with the exact block `tutor.md` gives. Haiku (task
  3.6) showed none unasked, though the style note asked for "a picture
  before the algebra", and its first aid wrote `color-scheme: dark;`
  outside a CSS rule, which dropped the `body` rule after it (a white
  page in a serif font); both wrote `$` math in labels, one after being
  told not to. With the rule (task 3.10), a style note asking for a
  picture first got a secant slider taught from; units with nothing to
  see got none.
- **A question on intuition** ends a segment's teaching, asked alone; the
  discussion corrects the answer, then offers an exercise (the user's,
  "Product decisions", 2026-11-18). "The exercise waits for the
  discussion" was read as where to try it, and an example on the chain
  rule was reworded into the teaching of the chain rule; an example off
  the subject (a circle's area) and "ask this question alone" fixed both
  (task 3.19).
- **Assessment lead-ins name only where the question comes from** (task
  5.13): lead-ins that named the concept ("a question on joint
  probability") told the learner which denominator. "Only that a question
  follows, or which unit it comes from" fixed it.
- **"Unlike those listed" is defined by the pattern, not the numbers**
  (task 5.13): with the list in the header, the tutor still asked "an X or
  a Y, find P(X)" with new figures four times across a check, a gate, a
  segment going over it again and the next unit's gate, and asked in a
  gate the exercise its teaching had offered (known from the handoff
  note). Told to change what the question gives or asks, and to avoid the
  note's examples, it did; "keep the kind of question the objective calls
  for" was added after, and not run.
- **The word after the test names skills, not answers** (task 5.13): both
  models said what single answers did ("you tended to read the answer off
  P(B given A)") until told never to.
- **Untried in the runs**: scratch work in `$TMPDIR`, the learner's files
  left alone in a detour, and a dispute's outcome in a header.
- **Seen and left**: feedback on a confident correct answer ran three or
  four sentences, and feedback on a choice miss still goes through the
  choices not picked (the user's to judge); a written question asked two
  things; some first code questions and assessment questions had no
  lead-in; a choice's right answer once reused the teaching's phrase;
  Haiku called `ask_question` before writing the starter and, refused,
  posted again in the same turn, so its lead-in showed twice; in one run
  of three, pytest was asked for only once the check was open, holding it
  up until installed; a style change was explained after its card, not
  before; a detour promised "we'll come back to it in a later segment",
  which the plan did hold.

**`handoff.md`** (task 5.13): every note, on both models, reported what the
app already gives the next tutor (where the unit stands, answers, how the
gate went), wrote about the stretch itself ("whether it was tried is not
known"), and listed as open what the plan had still to teach. The prompt
now says what the next tutor is given and forbids restating it; defines
open as excluding the plan; says a tested objective was not taught; and
asks the writer to work again any number in a correction. Sonnet then got
those right but still reported some results and ran long ("Mastery
loop"). About 250 words is a target, not a reason to cut off useful
context or reject the reply and lose its misconceptions; the schema's
character ceiling guards runaway replies. A belief shown in a test
answer's reasoning is a misconception: both models recorded them, though
the prompt had said that something not yet taught is not one.

**`notes.md`** (task 5.13): Sonnet followed the learner's instructions and
gave the misses most of the room. It copied a wrong key in as the correct
value; told to work every value again, it gave the right one and said the
recorded key differed. A figure's labels ran past its `viewBox` and its
boxes did not show the amounts compared; sizing a box from about 0.6 × the
font size per character and drawing compared amounts to scale fixed both.
It wrote "where I went wrong" in the learner's voice; the prompt asks for
"you". Recomputing values did not catch a false generalization (unequal
marginals said to rule out equal reverse conditionals, false for disjoint
events), so the writer checks assumptions and boundary cases and states
each rule positively even in quick-reference boxes: two drafts had turned
the denominator rule into a false "never use the full space".

**`unit-planner.md`**:

- **One idea per objective**, tested by "could a learner know one part and
  not the other", up to eight objectives rather than joining two. The test
  with examples helped; a rule stated as an example pattern ("Name A and
  say B") did not; a last read for one verb and one claim worked best (five
  of six single-idea objectives). A compound objective still slips through
  now and then, which "one thing per question" catches. A length limit in
  `plan_unit` was rejected: a poor proxy for one idea, and long statements
  are normal in mathematics.
- **The verb names the kind of check** (task 3.10): a coding unit got five
  of six objectives as "Write a function that ...". One was "Compute" with
  a list for its result, which the symbolic check compares in any order
  (`tutor.md` now says a list whose order matters is not a math question),
  and one named its implementation ("using zip"); `unit-planner.md`
  addresses neither.
- **A setting is not a skill** (task 5.13): "dice and card problems" got an
  objective each, and Bayes' rule one "with given rates" and one in "a
  medical-test problem", so checks asked one skill twice and assessments
  had less room to vary it. Told that a setting is its own objective only
  when it needs something the others do not, the next run still split a
  spam filter from a witness report. Not settled.

**`planner.md`**:

- **Questions in rounds of at most two**, counting every question in a
  message (the first run asked three under "Two quick questions"); a short
  unit or a narrow question is one unit, and a larger course is
  suggested, not proposed.
- **It promises only what is built**, listed in the prompt with what is
  not; with the list, its proposals and answers ("will I get any review,
  or notes?") matched what is built. Coding exercises are promised in
  Python only (the agent's choice): packages install through uv, and no
  other language's tools were tried in the sandbox.
- **The style note is 1 to 800 characters, required**, so every card has
  the section (the mocks' notes run under 300; the cap stops a lecture
  posing as a note). The background note is required too, and in the
  third person, since the unit planner and the tutor read it as a
  description of someone else; it holds only what the learner said.
- **The profile** (tasks 5.8 and 5.13): the planner asked only what the
  profile did not answer, kept it word for word, and put this course's
  facts in the background note. Once, told to go ahead, Haiku said "I've
  proposed a three-unit course" without calling `propose_curriculum`; the
  prompt now forbids it. Sonnet posted its proposals without the text the
  prompt asks for before the card (left); so did Haiku once in task 5.16.
- **A large topic in stretches** (task 5.16). The posting instructions
  explicitly exempt the preview of later stretches from the rule not to
  repeat the notes. In a Haiku intake for "Calculus 1 to 3", the go-ahead
  reply and style note gave names, topics and timing; the reply that
  posted the card still gave names and timing but omitted topics. The
  tutor's offer of the next stretch has not been tried on a real model.

**`course-planner.md`** (task 5.38): in one Haiku run on a finished
"Calculus 1 to 3" whose style note named Calculus 2 and 3, the planner
named Calculus 2 and its topics in reply to "What comes next?", asked to
go ahead, and then proposed nine units after the five finished, each
building on earlier ones. It posted the card with no text before it, as
the intake's planner has done (left: the card's line on why says it).

**Writing rules for the page**: `$...$` inline and `$$` for display; a
dollar sign that is not math must be `\$`, since "it costs $5 and $10" reads
as math and no rule fixes that reliably (Pandoc's fails on "$5. Then
$x$"); `\(...\)` is not supported, because Markdown reads `\(` as an
escaped bracket. Unit titles and goals are plain text; objective statements
render math.

## Page design

Picked by the user from the mocks in `docs/prototype/` (pieces 1 to 18),
2026-11-13, 2026-11-15, 2026-11-17 and 2026-11-18, and pieces 19 to 21, the
redesign, 2026-11-19 (task 5.17). Each mock's header comment says what was
asked and rejected. Pieces 15 to 18 were shown as the agent would build them
and accepted so, but for the notes ("Product decisions"); as built, they are
`architecture.md` section 10. The redesign is built by tasks 5.30 to 5.39;
the look is built, and until the rest is done, the app has the layouts
pieces 1 to 18 settled, and the entries below say which parts are the
redesign's.

- **Thread layout**: one centred column, the tutor's text unframed, the
  learner's messages on the right, one message box at the bottom. Rejected:
  a document with questions in the margin, and lesson and conversation side
  by side.
- **Look** (the redesign, piece 19; the user found the first look amateur):
  Catppuccin Frappé, dark first, reached only through named colour roles
  (`look.css`), so that a theme is one block of values. Mauve marks only the
  next step and "you are here"; headings and key terms are in the text
  colour, and the learner's messages sit on the raised surface. Type in four
  registers: the app's labels in IBM Plex Mono capitals, small and tracked;
  titles, the tutor's text and a question's prompt and choices in CMU Serif,
  the Computer Modern KaTeX draws math in, with math at 1em so that it
  matches the words; the controls in IBM Plex Sans; code in Plex Mono. The
  user's picks over CMU Concrete or Plex Sans for reading, and Plex Sans
  capitals for labels. Rejected earlier: the other flavours and accents, a
  blackboard look (the user found it the ugliest), a warm book look; and
  the first look's accent headings, yellow key terms and accent-washed
  messages. As built (the agent's choices, open to change): the roles are
  look.css's Frappé block plus `--flag`, the yellow that marks what changed
  and help taken, which the redesign's mocks do not show; a label in a card's
  head or a marker is its `<b>`, and the words after it stay in the
  controls' type. Section and card labels use `--ink-2` rather than the
  mock's `--ink-3` so the small capitals meet 4.5:1 contrast on both the page
  and raised cards. CMU Serif's four faces are the `computer-modern`
  package's WOFF2 files (0.1.3), copied with the OFL; that package declares
  the regular face as weight 500, declared here as 400, the weight body text
  asks for.
- **Status shows by form as well as colour** (the redesign, piece 19, from
  DeepTutor's `StudyOutline.tsx`), so that it reads in a light theme too:
  passed filled; retained filled in teal; slipping half filled in peach;
  answered but not passed an outline; overridden hollow with a bar; not
  started faint and dotted; the current one an accent dot with a ring. A
  unit takes the same forms. The words stay beside them where there is
  room ("Retained" in teal, `#81c8be`, and "Slipping" in peach, `#ef9f76`,
  from piece 16). Shown in the outline, the course map, the course view,
  the library and the closing card. As built (the agent's choices, open to
  change): the form sits just before the status word. The current unit is
  the one the course view's card leads to, up next as well as in progress,
  since the accent marks the next step; other units in progress take the
  outline, and in "What I know" its yellow word, not the accent. The gap
  inside the current form's ring takes the colour
  of the surface under it (`--ring-gap` in `styles.css`), as the mock does.
  The current objective (`currentObjective` in `src/shared/plan.ts`) is
  none while the segment is closed, between segments or at the unit's
  end: after a move-on the first not passed would be an overridden one.
- **A question is a card in the thread**, answered inside the card while the
  message box stays; once graded it shrinks to a record (verdict, answer,
  confidence, the right answer on a miss), the verdict one line under a
  hairline, its word coloured and the rest neutral (the redesign, piece
  19), not a coloured panel. Rejected: the message box turning into the
  answer box, and a full-screen question.
- **Each segment starts with a heading in the thread** (the redesign, piece
  19): a rule, "Segment N of M", its title, and its objectives in small
  text with their status forms. Teach, discuss and check under it are
  hairlines with a small label. One next-step control sits where the
  conversation has reached; while the tutor writes, Send becomes Stop.
  Rejected: a phase strip across the top. As built (the agent's choices,
  open to change): a fresh start does not repeat the heading of the
  segment it goes on with. The heading stays where the segment began, in
  the dimmed conversation that taught it, so each segment has one heading
  for the outline to jump to, and the "Fresh start" marker and the top
  line say where the unit is. The extra segment's heading has no
  "Segment N of M" line; its title is "Going over again", and each time
  the unit goes over objectives again it has a heading of its own. The
  test before a unit sits above the first heading, outside any segment.
  Each objective's status word is in the heading for assistive
  technology only (`.sr`), since the mock shows forms alone. Review, gate
  and test markers stay hairlines, not headings.
- **Session navigation sits at the top**: the path on the left,
  ending in "Unit N" and the unit's title; on the right the position,
  "Segment N of M" with the segment's title and a tick per segment, which
  opens the outline, and "Course map" (the redesign, piece 19). Segments
  and units were easily mixed up when neither was named by kind (the
  user's note, 2026-11-19). The outline lists the unit's segments,
  numbered, each with its objectives, then the gate, then "Export
  transcript" and "Start fresh"; a past or current segment picked there
  scrolls the thread to its heading and lights it briefly. Leaving a
  session never asks. Rejected: a rail always showing the outline. As
  built (the agent's choices, open to change): "Review" shows only once a
  review is started, since its card waits inside a segment; "Unit gate"
  shows from the gate's card on, when every segment is behind. A test
  shows "Objective k of n", not a question count, since one objective can
  take two questions. The outline marks the gate taken or skipped, and
  puts it before a going over again that followed it. A part-taught
  segment strikes through the objectives the test skipped. A jump moves
  focus to the heading so the keyboard goes on from there.
- **Artifacts, source passages and the course map open in a pane beside
  the thread**, one at a time. "Course map" shows the curriculum diagram
  with the unit marked "You are here" (the redesign, piece 19). Rejected:
  inline, and a sheet over the thread.
- **Quote**: selecting the tutor's text offers "Quote", which puts the
  passage in the message box as a quote; the learner asks in the thread as
  usual (the redesign, piece 19). Rejected: a side thread. As built (the
  agent's choices, open to change): a selection is quotable only within
  one tutor reply or one prompt, so a learner's words are never quoted as
  the tutor's. Math comes from KaTeX's TeX annotation, since the
  selection's text has each formula twice; a formula cut by the
  selection is taken whole, as half a formula has no source. In the
  learner's message, quotes use the composer's `> ` prefix outside
  fenced code. A bare `>` between quote lines keeps the paragraph break;
  on its own it stays literal, as do Python's `>>>` prompts. The
  conversion is tested in happy-dom on the HTML `Prose` renders, with
  real KaTeX output; an interface over both the DOM and hast trees would
  not test how the range handles a selection.
- **The library is grouped by where each course stands**: in progress,
  drafts, finished, newest first in each (the redesign, piece 21). A row
  has a status form per unit in place of the ticks, and how many
  objectives are due for review when any are. Finished courses need no
  archive: a course is deleted (task 5.18). Rejected: one plain list with
  finished courses at the bottom (piece 6), leading with where the learner
  stopped, or with a message box. As built (the agent's choices, open to
  change): a course whose intake stopped before any proposal is a draft;
  one whose record cannot be read is in progress, since where it stands is
  not known. A one-off has no forms, as in the mock. A course with no unit
  started reads "Not started. Next: unit 1, ..." as in the mock; the
  status word stays "overridden", not the mock's "moved on from", the
  brief's term. Rows stay buttons, as before, not the mock's links.
- **The course view is built around the unit list, down to objectives**
  (the redesign, piece 20, from DeepTutor's path page): each unit is a
  heading with "Unit N", how many of its objectives have passed, and its
  form; each objective is a row with its form and status word, and "Next"
  marks the one to do. A unit not started shows its goal, since its
  objectives are written when it first opens. Only units in progress are
  open; the others are one line each and open when clicked (the user's
  pick over every unit open, for 30-unit courses). Above the units come
  the due count with "Review now", then the card. "Course map" and "What I
  know" are in the top line. Rejected: built around the diagram. As built
  (the agent's choices, open to change): "Next" stands in the place of the
  status word, which stays for assistive technology, as does a unit's
  word, since the heading shows only its form. Counts take passed and
  retained only: a finished unit with a slipping objective reads "1 of 2
  passed", and the course's line is the units' counts summed, so the two
  agree. A folded unit's objectives and actions are not drawn, so a
  30-unit course asks for the notes of open finished units only. A draft
  keeps the plain list of units and goals: it has no statuses to show.
- **A curriculum change is asked for from the course view** (the user's
  pick, piece 20): "Change the curriculum" above the units, and on a
  finished course the card's "Plan what comes next", open a planning
  conversation of the course, run as the intake is, which ends in the
  curriculum change card. The pick closes the gap where a finished course
  could not add its next stretch, since a finished unit's tutor has no
  tools. Segments stay fixed within a unit (the user, 2026-11-19).
  Rejected: a request box answered by one planner call, with no questions
  back; asking in a unit's chat, the only way before, which nothing on the
  page announced. The agent's choices in building it (task 5.38, open to
  change): the planner's prompt is a file of its own,
  `prompts/course-planner.md`, since its job (changing units of a course
  under way, from what the record shows) shares little with the intake's
  beyond the unit rules, and none of the style, background and profile
  proposals. The page asks the opening question, as the intake's does, so
  opening the view spends nothing until the learner writes. The
  conversation lives at `/courses/<id>/planning`, one per course until a
  change is applied, so leaving and coming back finds the card still
  there; it is kept in memory with no transcript, as an intake is, since
  what it leaves is the changed `curriculum.json` and its backup commit.
  It is not refused while unit chats of the course are open (they stay
  open until the server stops, so that would refuse it nearly always):
  they hear an applied change as they hear another unit's Apply. A new
  proposal replaces the one waiting, as a revision does in the intake,
  so pushing back needs no "Keep the current one" first. Apply ends the
  conversation and goes back to the course view.
- **The diagram at 30 units** (task 5.16, the agent's choice): lines that
  cross a row sit side by side, in the order they came from, instead of
  all through the gap's middle, where long lines merged into one. Diagram
  rows still follow depth, so a unit with no prerequisites late in the
  list sits at the top.
- **A crowded diagram shows a unit's long lines only when it is picked**
  (the user's choice, 2026-11-20). When more than a few lines cross one
  row, lines between adjacent rows are always drawn, and the lines that
  skip rows only for the unit picked, in lanes of their own; in a unit's
  course map that unit starts picked. A diagram with no picking of its
  own (a proposal's) lets its nodes be picked. The list of prerequisites
  by number is left for a pane too narrow for one unit's lines. Evidence:
  in the seeded 30-unit course, 10 of 39 lines skip 4 to 12 rows and
  bundle through the gap, readable by spacing at 571 px but not by eye.
  Rejected: listing large courses at every width, which loses the graph;
  panning and zooming a larger canvas, which keeps the same bundle and
  costs drag, zoom and keyboard handling.
- **A course starts in the thread**: intake is a conversation, the proposal
  a card; a revision is a new card with changes marked, the old one shrunk
  to a line. Rejected: the proposal in the side pane, or on a page of its
  own.
- **The style note is a section of the proposal card**, "How I would teach
  it", always shown and marked when changed. Rejected: folded into a line,
  where two revisions can look the same.
- **A unit ends with a closing card**: a row per objective, and the next
  step ("Start unit N", or "Go over the N again" and "Move on without them").
  Rejected: a marker line, and sending the learner to the course view.
- **"Start fresh" is in the unit's outline**, asks once, and leaves the
  earlier conversation dimmed under a "Fresh start" marker. Rejected: a
  menu in the top line, or a button beside Send, where it is easy to hit.
- **Any unit can be started at any time**; one whose prerequisites are not
  finished asks once. Several can be in progress. The course view's card
  leads to the unit in progress most recently opened, or the next in order.
  Rejected: locking units behind prerequisites, and one unit at a time.
- **A dispute opens the graded card in place**, in the session and in
  "What I know" (piece 13). The user was asked only who decides; the
  layout is the agent's, as shown.
- **A code question's tests are not shown**, and "Run the tests" with a
  confidence level is the answer (the user's pick, piece 14); the card
  names the file to edit by its full path, with "Copy path" and "Open"
  (the user's note from the stage 3 check). In the detour after a failing
  run the tutor may run the tests on the learner's fixed file, which
  records nothing; the next question is a different exercise. Rejected:
  the tests in the workspace, to run before the run that counts (a pass
  would show that known tests can be made to pass, and the confidence
  level would mean little), and a second try at the same exercise (piece
  2's design, from before detours; the passing rule counts answers to
  different questions).
- **Packages are installed from a card** the tutor asks for (the user's
  pick, piece 14). Rejected: the learner running the command in their own
  terminal from the tutor's instructions. The command and the output are
  folded away, the output open only after a failed install: the user needs
  them only when something fails (their note from the stage 3 check).
- **The thread has a line for each file the tutor writes** ("The tutor
  wrote `bpe.py`"); the agent's, as shown in piece 14.
- **Words**: learner-facing copy says "segment", the brief's term; the extra
  segment is "Going over again", not "Review", which names stage 5's review
  questions.
- **Review, the gate and the test** (pieces 15 and 16) are a card in the
  thread, then markers around question cards. "Test out" sits beside Start
  on every unit not started and under the course card's "Start unit N", so
  it is seen before Start is pressed. Skipped segments stay in the outline,
  struck through, and show as hollow ticks in the top line. "Skip the
  gate" partway asks with a text of its own: the answers so far count,
  any open question is dropped, and leaving instead lets the gate pick
  up where the learner left off (the redesign, piece 19). Before the
  first answer the count is left out, not "no answers" (the agent's).
- **Notes are offered in a section of the closing card** (piece 17), drawn
  quieter than the card's next step; the reader is the writer's page in a
  frame under the top line. What a unit's notes look like is the writer's;
  `17-notes-example.html` is the kind of page meant. The exported
  transcript and the notes print in dark text on white.
- **The profile is a section of the proposal card** (piece 18), "What I
  would remember about you", always shown, with new and dropped sentences
  marked since the text reaches every later course. The Profile page was
  built without the mock's dates ("Last changed", when each course
  finished): the record keeps neither (the agent's).
- **The style and curriculum change cards were built without a mock**
  (the agent's): the intake card's style section with the profile's
  sentence marks (`ChangedText.tsx`) and the package card's foot; the
  intake card's list and diagram ("Mastery loop").
- Not designed yet: a light theme (`look.css` has a rough Latte only to
  show that the colour roles and status forms carry over), the source
  reader, settings, narrow screens.

## Page behaviour

- **The renderer is react-markdown with remark-gfm, remark-math and
  rehype-katex**: it makes React elements, so a model's text is never set
  as HTML, and its components will suit stage 4's citations. Rejected:
  markdown-it (an HTML string, so safety rests on its escaping) and marked
  with DOMPurify (cleaning after the fact). The cost is about 118 packages
  and a larger page script, which a local app can carry. `katex` is pinned
  to the 0.16 line rehype-katex requires; 0.19 installed a second copy
  whose stylesheet did not match.
- **Images are never fetched**: a prompt injection in a source could carry
  data out in an image address. KaTeX runs untrusted, so `\href`, `\url`
  and `\includegraphics` are refused.
- **`displayMathLines`** marks a formula alone on a line between `$$` as
  display; remark-math reads it as inline. A single newline is a line
  break, which suits a proof typed line by line.
- **`Prose` is memoized.** A thread holding every earlier session froze for
  17 seconds on each new message, because every reply's Markdown and math
  were rendered again. Opening a unit with a long history still draws the
  whole thread once (about 3 seconds for 1,200 formulas); folding earlier
  sessions would end that, and is the user's design choice.
- **The open question is pinned above the message box**, in one place from
  posting to grade, so its React state (a half-written answer, a picked
  choice) survives messages sent meanwhile; once answered it moves to
  where it was answered, so the verdict sits above the feedback. Rejected:
  a sticky card at the top, which covers the teaching being reread. Hide
  (the user's note from the stage 3 check) keeps the card mounted with its
  keys off, since its window-wide shortcuts would otherwise pick, rate and
  send an answer the learner cannot see.
- **Dividing lines go between messages, not inside an exchange**: none
  between a lead-in and its question, a question and its feedback, or a
  reply and the judge's line under it.
- **Dimming is on items, not the conversation's wrapper**, since a child
  cannot be brighter than a dimmed parent; cards that still wait carry
  `live`. A waiting card is not moved under the marker: remounting it would
  lose a half-written answer.
- **The course's details are asked again until the server answers**
  (`getJsonUntilAnswered`: doubling waits up to 15 seconds, never after a
  4xx). Until then the unit's place is unknown, never "the last unit": a
  failed load once made the closing card say the course was finished.
- **A server restart in development reloads the page** (Vite's client),
  which reopens the unit, so a note saying the server restarted could never
  show.
- **Dates are formatted in two parts**: how a locale joins date and time
  differs between ICU versions.
- **A pending send owns only the draft it sent**: repeated Enter makes one
  POST, and a draft edited meanwhile survives the send's success.
- **Biome's descending-specificity rule** flags selectors like `.cs p` after
  `.prose li > p`; give the element its own class.
- **Only an artifact shown since the page opened the unit opens the pane**
  (the agent's choice): the `open` response carries the index of the log's
  last event, and a replayed artifact is only referred to, so a reload
  does not reopen old aids. The pane matches its reference by file, since
  keys are numbered afresh after a restart. Esc does not reach the page
  while focus is inside the frame; the close button does.

## HTTP and event stream

- **Only Gauss's own page may use the API** (`127.0.0.1`, `localhost` only
  against DNS rebinding, a POST's `Origin` checked): the server drives an
  agent on the learner's login, and a shell.
- **Event ids are `<log id>.<index>`**, so a `Last-Event-ID` from another
  log (a restarted server) replays from the start.
- **An intake has an id of its own** (its log's), since the course exists
  only from the first proposal. A restart ends it, and its routes answer
  404 so the browser's event stream stops retrying. One intake owns a
  course for the server's lifetime, including while approval is written,
  so a review request then gets the same intake rather than a second one.
- **A unit's position is never sent to the page**: an open question holds
  its grading material.

## Dev server and tests

- **`pnpm dev:fake`** runs the real server's wiring (`serve.ts`) on the
  scripted backend, which is stateless and does what each turn's header
  allows; its commands ("/change" for the dispute judge, a code course by
  its title, `BROKEN_SESSION`, and the rest) are in `scripted.ts`'s
  header. A reworded header can break it, and its tests then fail. Port
  4330, so a page left open on it never reaches the real server. The data
  root is never `~/gauss` or a folder inside it. The seed is written
  through the record's own operations, so a schema change the seed does
  not follow fails at once.
- **The scripted tutor numbers a question past those the header lists as
  asked before**: numbered from the check's count, a review or a segment
  going over objectives again repeated a check's "question 1", which
  counts as the same problem. Its code files carry the objective in their
  names, since units share the workspace, and it never writes over a file
  there: a question withdrawn unanswered is in no history, so the next one
  got its number and replaced the learner's draft.
- **The fake backend matches the real one where tests depend on it**: a
  stopped one-shot fails whatever reply comes, as Claude's does; kept
  sessions are shared between backends, so a test's restart resumes.
- **Tests have a 20-second limit** (`vitest.config.ts`), not Vitest's
  5-second default: tests that write and flush the record at every step,
  or run the sandbox, take 1 to 3 seconds alone, and under the full
  parallel run went past 5 seconds now and then, each time costing a rerun
  of the whole check. Every record write calls `sync()`, which may be what
  slows them under load; not measured.
- **Real-model runs**: use a scratch data root, and store a unit's plan in
  the seed when planning is not what is checked, so no planning call is
  spent. Close the browser before stopping a server (`AGENTS.md`): a page
  left open once had a later Haiku server plan and teach its unit.

## Sources

The user brought a proposal for splitting sources (2026-11-14); the
agent's smaller version was accepted. The design is `architecture.md`
section 8.

- **The gap was real**: long stretches without headings exist (from
  memory of the Miller translation of the _Phenomenology_: the Preface,
  about 45 pages, and "Force and the Understanding", about 30). Check the
  user's edition in stage 4.
- **One `Read` call is capped at 25,000 tokens by default**
  (`CLAUDE_CODE_FILE_READ_MAX_OUTPUT_TOKENS` overrides it; read from the
  binary, not observed), so a section must stay below it.
- **Not adopted from the proposal**: new terms ("subsection", "chunk") for
  what the brief calls sections; a field list and two-level file names in
  the architecture (shapes are zod schemas, and the _Phenomenology_'s
  headings go four deep); a required page range (EPUB, TXT and Markdown
  have none); ids stable across converters (sources are converted once);
  "never read the whole chapter" (short chapters read better whole). Kept
  from it: no overlap between sections, which would put quotable text in
  two places.
- **On context size**: what the tutor reads stays in its session, so
  smaller files lower the cost of a unit's early turns, not its end; the
  size of a unit is what bounds the context. 15,000 to 30,000 characters
  is about 6 to 12 dense pages.

## Known gaps

Known and accepted for now; the plan's tasks and stage notes hold the ones
they will close.

- Once, after a Stop mid-sentence, the next one-sentence reply took 10 to
  30 seconds. Not seen again, and not investigated.
- A finished unit opened after a restart starts a new tutor session for any
  message, without the note saying the conversation is new.
- A restart between an answer and the next question leaves the check
  waiting for a learner message, and a feedback turn cut off is lost.
- The next-question turn after a failed feedback turn does not say the
  feedback failed.
- A crash between an override's evidence line and its position write
  (`overrideSegment` in `engine/unit-record.ts`) leaves the segment in its
  check with the question open, and the objectives read overridden until
  an answer or a second override. Seen in the code, not reproduced.
- Stop during an artifact write can still open the aid when the write
  finishes. The math field's Enter shortcut can submit while an input
  method is still composing text (the message box checks for it).
- Sandboxed commands and artifact scripts have no resource budgets for
  peak disk, memory or CPU use. The command deadline and output cap do
  not supply those budgets.
- The test before a unit: the course view's card ticks a skipped segment
  as done, not hollow as the session's top line does; and while a review
  offered first holds the test, the top line reads "Segment 1" and the
  review's card says the unit goes on where it was.
- The help judge sees one exchange at a time ("Help judge").
- The grader's grading of math answers the symbolic check does not settle
  has no hand-graded set: the grade set holds written answers only.
- Code questions: Copy path can be stale after a data-root move; only
  "What I know" shows the submitted file contents, and the tutor's copy
  omits trailing whitespace. In the scripted backend, grading feedback can
  be mistaken for a scripted command.
- Code questions: nothing refuses a question whose tests or solution the
  tutor left in the workspace, where the learner can read them; only
  `tutor.md` forbids it (seen once, task 3.19). The posting check could
  refuse a question whose test files are in the workspace.
- Opening a unit with a long history draws its whole thread once ("Page
  behaviour").
- Keys go to the message box, not the pinned card, after sending a
  message; "b4" was once sent as a message that way.
- After a dispute overturns the miss a detour opened on, the detour's
  control still reads "Ready for another question", though pressing it goes
  on as the corrected verdict has it: to the next objective, or the end.
- No limit on refused `plan_unit` calls within one planning turn.
- The fake backend's `hasSession` ignores the folder.
- Temporary files left by a crash during an atomic write are never cleaned
  up.
- Untried on a real model: a learner who keeps asking in a detour, or
  presses "Ready for another question" at once; idle closing and resuming
  on Claude end to end.
- A misconception the handoff writer finds in a test answer's reasoning
  is recorded with no detour, so "What I know" says it was found "in the
  discussion" (`what-i-know.ts`); the record has no place for the test.
- One notes call on Sonnet 5.5 took longer than the writer's three-minute
  limit (task 5.13) on a unit of five segments; the next two, on both
  units, took 20 and 30 seconds. Cause unknown; pressing write again
  retries.
- Deleting a course does not remove the tutor sessions Claude Code keeps
  for the course's workspace, outside the data root. They stay until its
  own sweep ("Claude backend").
