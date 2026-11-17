# Gauss: finished plan entries (archive)

The full text of finished tasks, moved out of `plan.md` so agents do not load
it every time. Nothing here is current: `plan.md` holds the status table and
the open tasks, and `decisions.md` holds the findings. Read an entry here only
to see exactly what a finished task asked for and how it was checked.

## Stage 0: spike and skeleton

Purpose: answer the open "to verify" items in `architecture.md` section 7
before anything depends on them. Spike code may be thrown away; findings may
not.

### 0.1 Toolchain

- Status: done
- Depends on: none
- Do: `git init` and `.gitignore`; `mise.toml` pinning node, pnpm, python, uv;
  `package.json` with TypeScript, Vitest, and one linter/formatter; a `pytools/`
  uv project with pytest. Fill in the Commands section of `AGENTS.md`.
- Done when: install, test, lint and type-check commands all run clean on the
  empty project, and `AGENTS.md` lists them.
- Note: done on 2026-11-13. `mise run check` runs everything. The choices and
  two things later tasks will meet (TypeScript 7 and pnpm 12 are newer than
  most written guidance; the web side still needs `jsx` and the DOM library
  in `tsconfig.json`) are in `docs/decisions.md` under "Toolchain".

### 0.2 Claude on the plan login

- Status: done
- Depends on: 0.1
- Do: a script that sends one prompt through `@anthropic-ai/claude-agent-sdk`
  with a custom `systemPrompt`, `settingSources: []`, and partial-message
  streaming, and prints the stream.
- Done when: `docs/decisions.md` records, from observed runs: whether it works
  with no API key; what happens when `ANTHROPIC_API_KEY` is set; whether the
  user's personal Claude Code instructions and skills are absent from the
  session; which built-in tools the session reports.
- Note: done on 2026-11-14 with `spike/claude-login.ts`; findings in
  `docs/decisions.md` under "Claude on the plan login". For task 1.3: leave
  `ANTHROPIC_API_KEY` out of the SDK's `env` (a set key overrides the plan
  login), and pass `skills: []` and `settings: { autoMemoryEnabled: false }`
  as well as `settingSources: []` (the auto-memory loads without them). The
  default tool set is large and mostly unsuitable; tasks 0.3 and 0.4 narrow
  it with `tools`. Task 0.3 adds two more isolation options; its entry in
  `docs/decisions.md` has the full set.

### 0.3 Question round trip

- Status: done
- Depends on: 0.2
- Do: an in-process `ask_question` tool that stores a question and returns
  "posted; end your turn". Feed the learner's answer back as the next turn.
- Done when: `docs/decisions.md` records whether the model reliably stops after
  the tool call, whether `alwaysLoad` is needed for the tool to be called
  without a search step, and the working option set.
- Note: done on 2026-11-14 with `spike/question-round-trip.ts`; findings and
  the working option set are in `docs/decisions.md` under "Question round
  trip". The model does not reliably stop after `ask_question`, so a
  `PostToolUse` hook ends the turn: task 0.5 needs a way in the adapter for a
  teaching tool to end the turn. `alwaysLoad` matters only if `ToolSearch` is
  among the tools. The learner's claude.ai connectors join the session unless
  `strictMcpConfig` and `disableClaudeAiConnectors` are set, which corrects
  task 0.2.

### 0.4 Resume and confinement

- Status: done
- Depends on: 0.2
- Do: resume a session by id after restarting the process. Find the `sandbox`
  and permission options that let the agent run a test command and write files
  inside one directory and nowhere else.
- Done when: `docs/decisions.md` records the exact options, plus an observed
  refusal when the agent is asked to write outside the directory.
- Note: done on 2026-11-14 with `spike/resume.ts` and
  `spike/confinement.ts`; options and refusals are in `docs/decisions.md`
  under "Resume and confinement". For later tasks: resume with the course
  folder as `cwd`; a resumed session keeps its first system prompt; `dontAsk`
  needs an allow rule for `Bash`; `CLAUDE_CODE_TMPDIR` must point inside the
  course folder, or sandboxed commands can write to Claude Code's shared temp
  directory. Which course folders the tutor may write is still open.

### 0.5 Minimal page

- Status: done
- Depends on: 0.3
- Do: a Hono server and a React page. Stream one tutor reply to the page over
  an event stream; render one multiple-choice question from `ask_question`;
  post the answer back.
- Done when: the round trip works in a browser, and the adapter interface in
  `architecture.md` section 7 is confirmed or revised to match what the spike
  needed.
- Note: done on 2026-11-15. `pnpm dev` serves the page at
  http://localhost:4320; findings in `docs/decisions.md` under "Minimal
  page", and the revised adapter in `architecture.md` section 7. This is
  kept code, not spike code: the adapter, the fake backend and the Claude
  backend in `src/server/backends/` are task 1.3's starting point, which
  adds resume, the working directory, built-in tools and `oneShot`. The
  chat in `src/server/engine/chat.ts` and `prompts/demo-tutor.md` are a
  stand-in for the stage 2 engine and tutor prompt; task 0.7 or stage 1
  decides what replaces them.

### 0.6 Codex spike (limit: about one hour of work)

- Status: done
- Depends on: 0.1
- Do: run one prompt through `@openai/codex-sdk` on the ChatGPT login. Find how
  a custom tool server is configured for it and how text is streamed.
- Done when: `docs/decisions.md` records what worked, what did not, and whether
  the adapter interface would need to change for Codex.
- Note: done on 2026-11-15 with `spike/codex.ts`; findings in
  `docs/decisions.md` under "Codex spike". It works on the ChatGPT login,
  and the real `ask_question` ran over an in-process MCP server and ended
  the turn. Three things for stage 6: the SDK does not stream text (the app
  server would); the thread id arrives only with the first turn, so
  `backendSessionId` would change; and the learner's global `AGENTS.md`
  and skills could not be kept out by config overrides. For task 0.7:
  `@openai/codex-sdk` was added as a dev dependency for this spike only.

### 0.7 Close the stage

- Status: done
- Depends on: 0.2, 0.3, 0.4, 0.5, 0.6
- Do: move each "to verify" item in `architecture.md` section 7 to verified or
  changed. Delete spike code that will not be kept.
- Done when: no "to verify" items remain, or each remaining one names the stage
  that will resolve it.
- Note: done on 2026-11-15. Every original "to verify" item is answered in
  section 7; what stage 0 left open is the table "Open after stage 0" at
  the end of that section, each row naming its stage. All of `spike/` was
  deleted and `@openai/codex-sdk` removed; the scripts the findings name are
  in the history (`git show 349c399:spike/<file>`). The minimal page from
  task 0.5 is kept and stays runnable for this stage's user check. Stage 1
  was revised: 1.3 was already met by task 0.5, and 1.4 to 1.6 note what
  they build on. Details in `docs/decisions.md` under "Stage 0 closed".

### 0.8 Review fixes

- Status: done
- Depends on: 0.5
- Do: stop a turn even when the SDK has not started it yet; preserve drafts
  edited during a pending send and prevent duplicate submissions.
- Done when: regression checks cover stopping before and after prompt pickup,
  a subsequent turn still works, and a browser check with the fake backend
  covers delayed successful and refused sends without losing edited drafts.
- Note: done on 2026-11-15. `mise run check` passed (31 TypeScript tests,
  one Python test). The SDK-boundary regressions cover both pending-turn
  windows, active interruption, late tools/output and a subsequent turn;
  browser checks with the fake backend cover pending-send edits, duplicate
  submits, refusal, network failure and retry. No real model calls.

**User check:** open the page, watch a reply stream in, answer the
multiple-choice question, and see the tutor respond to the answer.

Passed: the user tried it on 2026-11-15 ("everything seemed to work well").
Stage 0 is finished.

## Stage 1: record and library

Tasks may be revised by 0.7 (revised on 2026-11-15; see 0.7's note).

### 1.0 Page layout

- Status: done
- Depends on: none (pulled ahead of stage 0 at the user's request on
  2026-11-13; it is a static mock and needs no code from stage 0)
- Do: a static mock of the three views (library, course, session) for the user
  to react to before any real page work.
- Done when: the user has approved a layout, and it is saved under `docs/`.
- Note: restarted on 2026-11-13. The user disliked the earlier whole-app mocks
  (`look.html`, deleted); do not reuse them or their findings. The mock is now
  built one piece at a time, dark theme first, one file per piece in
  `docs/prototype/`, with the chosen look in `docs/prototype/base.css`. Picks
  are recorded in `docs/decisions.md`.
  - Piece 1, reading and chat (`01-reading-chat.html`): settled.
  - Piece 2, check question (`02-check-question.html`): settled. A card in
    the thread, percentage confidence, "I don't know" on every question.
  - Piece 3, phases (`03-phases.html`): settled. Marker lines in the thread,
    with the "ready" and override controls where the conversation has got to.
  - Piece 4, session navigation (`04-session-nav.html`): settled. One line
    across the top: the path out on the left, the position in the unit on the
    right, which opens the unit's outline.
  - Piece 5, artifacts and source passages (`05-side-pane.html`): settled. A
    pane beside the thread, as the brief says.
  - Piece 6, library (`06-library.html`): settled. One plain list, newest
    first; "New course" in the top line.
  - Piece 7, course view (`07-course.html`): settled. The page is the unit
    list; the diagram opens in the side pane.
  - Piece 8, starting a course (`08-intake.html`): settled. Intake is a
    conversation; the proposed curriculum is a card in the thread.
  - All eight pieces are settled and `docs/prototype/index.html` lists them.
    The user approved the layout as a whole on 2026-11-13. What was not
    designed is listed at the end of the page design entry in
    `docs/decisions.md`; settle each when its stage needs it, the same way
    (one mock per question, the user picks).
  - For the real frontend: `docs/prototype/base.css` holds every settled
    style, grouped by piece, and each mock's header comment says what it
    decided. The mocks are references for look and behaviour, not code to
    reuse.

### 1.1 Course and curriculum schemas

- Status: done
- Depends on: stage 0
- Do: zod schemas in `src/shared/` for `course.json` and `curriculum.json`
  (units, prerequisites, goals, approval state).
- Done when: tests parse hand-written valid examples and reject examples with a
  missing goal, a prerequisite pointing at an unknown unit, and a prerequisite
  cycle.
- Note: done on 2026-11-15 (`src/shared/course.ts`, `curriculum.ts`); the
  choices are in `docs/decisions.md` under "Course and curriculum schemas".
  For task 1.2: the course id is the folder name and is not stored in
  `course.json`, so the record module makes it (a `Slug`, from the title,
  unique under `courses/`). For task 1.4: `propose_curriculum` can take
  `{ units: Units }` as its input, since the prerequisite checks travel
  with `Units` and their messages are written for the tutor.

### 1.2 Record module

- Status: done
- Depends on: 1.1
- Do: resolve the data root (default `~/gauss/`, environment override); create,
  list and read courses; write files atomically.
- Done when: tests against a temporary data root cover create, list, read, and
  a reload after a simulated crash mid-write.
- Note: done on 2026-11-15 (`src/server/record/`); details in
  `docs/decisions.md` under "Record module". The crash is a file size limit
  that stops a child process's write partway, which is deterministic. For
  task 1.4: store the draft curriculum with `writeFileAtomic` and the
  `Curriculum` schema, beside `createCourse` in `data-root.ts`. For task
  1.5: `main.ts` should call `resolveDataRoot()` and pass the result to
  `openDataRoot`, and `AGENTS.md` should list `GAUSS_DATA_ROOT` with the
  other variables. Writes to one file are not ordered against each other;
  stage 2 must wait for each `state.json` write before the next.

### 1.3 Backend adapter

- Status: done (by task 0.5)
- Depends on: stage 0
- Do: the adapter interface, the scripted fake backend, and the Claude backend
  built from the stage 0 findings.
- Done when: an engine-level test drives a two-turn exchange with one tool call
  through the fake backend, and a manual run does the same through Claude.
- Note: task 0.5 built all three (`src/server/backends/`). The test "a correct
  answer is graded by exact match and sent to the tutor as its next turn" in
  `src/server/engine/chat.test.ts` drives that exchange through the fake
  backend, and the 0.5 browser run did it through Claude. What the adapter
  still lacks goes to the stage that first needs it (`architecture.md`
  section 7): resume and `oneShot` in stage 2, the working directory and
  built-in tools in stage 3.

### 1.4 Intake and curriculum proposal

- Status: done
- Depends on: 1.2, 1.3
- Do: `prompts/planner.md`; the intake chat; the `propose_curriculum` tool,
  which validates against the schema and stores a draft; approval and
  change-request handling.
- Done when: fake-backend tests cover a valid proposal, a rejected invalid
  proposal (the tutor receives the reason), a change request followed by a
  revised proposal, and approval.
- Note: build the intake chat from `src/server/engine/chat.ts` (task 0.5),
  whose turn queue, event log and tool wiring carry over;
  `src/server/tools/ask-question.ts` shows the tool pattern, including a
  refusal the tutor can read. When the intake chat replaces the demo, delete
  the demo's turn texts and `prompts/demo-tutor.md`.
- Note: done on 2026-11-15 (`src/server/engine/intake.ts`,
  `src/server/tools/propose-curriculum.ts`, `prompts/planner.md`); details
  in `docs/decisions.md` under "Intake and curriculum proposal". The first
  proposal creates the course and names it; approval names the revision.
  The demo still runs: its event log and turn queue moved to
  `src/server/engine/conversation.ts`, which both chats use. Not yet run
  against a real model; an offline probe of the SDK's tool server showed
  the schema and refusals work there.

### 1.5 Routes and event stream

- Status: done
- Depends on: 1.4
- Do: HTTP routes for the library, course creation, chat turns and curriculum
  approval; the server-to-page event stream.
- Done when: route tests pass against the fake backend.
- Note: the event stream exists (task 0.5, `src/server/http/app.ts`): a log
  replayed with resumable ids, and the guard that only Gauss's own page may
  use the API. This task adds the library, course and approval routes
  around it.
- Note from 1.4: this task replaces the demo. `main.ts` loads
  `prompts/planner.md`, calls `resolveDataRoot()` and passes the result to
  `openDataRoot`; `AGENTS.md` then lists `GAUSS_DATA_ROOT`. Delete
  `src/server/engine/chat.ts`, its tests, `prompts/demo-tutor.md` and the
  demo's routes; the shared core and its tests stay. "New course" starts an
  intake (`createIntake`), which has no course id until its first
  proposal, so the routes need an id of their own for an intake in
  progress. Approval posts the revision number (`intake.approve`), and its
  refusals are 404 and 409.
- Note: done on 2026-11-15 (`src/server/http/app.ts`, `createIntakes` in
  `src/server/engine/intake.ts`, `src/shared/library.ts`); the routes and
  choices are in `docs/decisions.md` under "Routes and event stream".
  `mise run check` passed with 10 route tests against the fake backend. The
  demo is deleted. `src/web/App.tsx` was changed only enough to keep the
  running app working as an intake chat; it does not show proposals yet.

### 1.6 Library and course views

- Status: done
- Depends on: 1.0, 1.5
- Do: the library view, the intake chat, the curriculum review screen, and the
  diagram generated from `curriculum.json`.
- Done when: the stage's user check passes in a browser.
- Note: replaces the demo page (`src/web/App.tsx`), keeping its thread, the
  question card and the message box, and `src/web/styles.css`.
- Note from 1.4: the intake view shows the opening question itself
  ("What do you want to learn? ..."); the tutor's session starts with the
  answer. Proposals arrive as `curriculum_proposed` events, which
  `src/web/timeline.ts` ignores for now. Mark a revision's changed units by
  comparing unit ids with the revision before, and approve with the
  revision number shown on the card.
- Note from 1.5: the routes are listed in `docs/decisions.md` under
  "Routes and event stream". `App.tsx` is now a bare intake chat: it shows
  the opening question, starts an intake (`POST /api/intakes`) with the
  first message and keeps its id in the address. Three things are open
  for this task. A draft whose intake ended in a restart is listed but
  cannot be approved, since approval goes through the intake; decide what
  the library offers for it. Close an intake's tutor session when the
  learner leaves it, or each abandoned intake keeps a Claude Code process
  until the server stops. And show the restart note (an intake route
  answering 404) in the new views.
- Note: done on 2026-11-15 (`src/web/`); details in `docs/decisions.md`
  under "Library and course views". The user check was run in a browser
  with the fake backend, and the intake once on Haiku 5.5; the user has
  not tried it yet. On the three open items: a draft opens for review in
  its running intake, or after a restart in a new one that starts from
  the stored draft; abandoned intakes are kept, as mock 8 says leaving
  keeps the conversation, and stage 2 should close idle ones once resume
  exists; the intake view shows the restart note.

### 1.7 Review fixes

- Status: done
- Depends on: 1.5, 1.6
- Do: keep one intake per course when review overlaps approval, and keep
  diagram edges attached to units with many prerequisites or dependents.
- Done when: regression tests cover concurrent review and bounded, distinct
  diagram ports; the high-degree diagram is checked in a browser.
- Note: done on 2026-11-15. `mise run check` passed (144 TypeScript tests,
  one Python test). Regression checks failed before the fixes; a scratch
  fake-backend browser check confirmed attached, distinct high-degree ports.
  The intake ownership and port-spacing rules are in `docs/decisions.md`
  under "Library review fixes".

**User check:** create a course, push back on the proposed curriculum once,
approve the revision, see the diagram, restart the server, and find the course
still there.

Passed: the user tried it on 2026-11-15 ("it works great from what I
tested"). Stage 1 is finished.


### 2.0 Break down the stage

- Status: done
- Depends on: stage 1
- Do: write this stage's tasks here in the same format, covering the scope in
  `architecture.md` section 12. Draft `prompts/tutor.md` and `prompts/grader.md`
  as tasks of their own.
- Done when: the user has read the task list.
- Note from 1.4: the brief has the tutor propose the course's style note at
  intake, approved with the curriculum. `propose_curriculum` does not
  carry it yet; decide here whether it should, or how `style.md` is made.
- Note from 1.6: the views leave room for this stage. Unit status goes in
  the course view's list and diagram (the classes are in
  `docs/prototype/base.css`), the library's ticks and "where" line, and its
  "Finished" group. Continue goes at the right of the course view's top
  line, and "Open the course" after approval becomes "Start unit 1".
  Nothing updates `lastOpenedAt` yet. Each intake sent a message keeps a
  Claude Code process until the server stops; once sessions resume, close
  idle ones.
- Note: for a source course, planning a unit needs the whole unit's text.
  When designing `plan_unit`, decide where that reading happens or leave it
  to 4.0 in writing (`architecture.md` section 8, "Open").
- Note: where the notes above went. The style note comes with the proposal
  (2.10). Unit status, Continue and the library's lines are 2.12; "Start
  unit 1" is 2.11; `lastOpenedAt` is 2.6; idle sessions are 2.15. A unit is
  planned in a session of its own, which is where a source course's unit
  text will be read (2.5; `architecture.md` section 8 updated).
- Note: done on 2026-11-15. The user read the task list and went on to
  2.1 without changes. The choices are in `docs/decisions.md` under "Stage
  2 breakdown".

### 2.1 Designs the stage needs

- Status: done
- Depends on: none
- Do: mocks in `docs/prototype/`, one question each and built as in task
  1.0, for what this stage shows that task 1.0 did not design: where the
  style note sits on the proposal card; how a unit ends without its gate,
  when every objective passed and when some did not; where "Start fresh"
  sits in a session; and whether a unit can be started before the units it
  builds on are finished (left open by mock 7).
- Done when: the user has picked an answer to each question, the picks are
  in `docs/decisions.md`, and `docs/prototype/index.html` lists the new
  mocks.
- Note: pieces 9 to 12 in `docs/prototype/`; picks in `docs/decisions.md`
  under "Stage 2 designs".
  - Piece 9, the style note (`09-style-note.html`): settled. A section of
    the proposal card, under the units.
  - Piece 10, the end of a unit (`10-unit-end.html`): settled. A closing
    card with a row per objective; "Go over the N again" or "Move on
    without them".
  - Piece 11, starting fresh (`11-start-fresh.html`): settled. In the
    unit's outline; the old conversation stays above, dimmed.
  - Piece 12, which units can be started (`12-unit-order.html`): settled.
    Any unit, any time; a card at the top of the course view leads to the
    unit in progress, or else the next one in order.
- Note: done on 2026-11-15; the user picked all four, piece 12 in two
  rounds. The picks change piece 7: the card replaces Continue in the top
  line. The later tasks that use each pick are listed at the end of the
  entry in `docs/decisions.md`.

### 2.2 Plan, state and evidence records

- Status: done
- Depends on: stage 1
- Do: zod schemas in `src/shared/` for a unit's plan (objectives with ids,
  and segments of one or two objectives each, in order), `state.json` (the
  unit in progress, its segment and phase, the open question with its
  grading material, and the tutor's backend session id), and an evidence
  entry (brief, "Evidence"), overrides included. Record operations: store a
  unit's plan in `curriculum.json`, write `state.json`, append to
  `evidence.jsonl` and read it back.
- Done when: tests parse hand-written valid examples and reject a segment
  that names an objective not in the plan, an objective in no segment, a
  segment of three objectives and a repeated objective id; tests against a
  temporary data root cover storing a plan, two `state.json` writes issued
  together landing in the order issued, and an evidence log whose last line
  a crash cut short.
- Note: the plan cannot go on `Unit`, which is `propose_curriculum`'s input
  (task 1.1). A stored unit extends it with an optional plan, so stage 1's
  files still parse. `state.json` writes must wait for each other (task
  1.2). Evidence is appended, not written whole, so a crash can cut the
  last line; reading skips it. Evidence names objectives by id, so
  objective ids must be unique across the course.
- Note from 2.1: several units can be in progress at once, each keeping its
  place (piece 12), so `state.json` holds a position per unit in progress
  rather than one current unit. Revise `architecture.md` section 3, which
  says "current unit".
- Note: done on 2026-11-15. The choices and checks are in
  `docs/decisions.md` under "Plan, state and evidence records";
  `architecture.md` section 3 now says `state.json` holds a position per
  unit in progress, and how the logs are appended and read.

### 2.3 Objective status

- Status: done
- Depends on: 2.2
- Do: the pure function that derives each objective's status from the
  evidence log, and a unit's from its objectives' (`architecture.md`
  section 3). Settle the rules: what passes an objective ("unassisted
  correct answers on varied problems"), what counts as help, how "I don't
  know" and an override count, and what to call an objective that has
  evidence but has not passed (section 3's list has no such status).
  Retained and slipping depend on the unit gate and wait for stage 5.
- Done when: tests built from hand-worked evidence logs cover every status
  this stage can produce, and the rules are in `docs/decisions.md`.
- Note: a proposal for "help", to test against the worked examples: an
  answer is assisted when the learner wrote to the tutor while its question
  was open. The engine sees that itself, without the tutor's word.
- Note: done on 2026-11-15. The rules, the worked cases for help and the
  checks are in `docs/decisions.md` under "Objective status";
  `architecture.md` section 3 lists the statuses this stage produces.

### 2.4 Markdown and math

- Status: done
- Depends on: stage 1
- Do: render the tutor's text, question prompts and choices as Markdown
  with KaTeX math, and preview typed LaTeX in the written answer field, as
  mock 2 does for its math answers. Text from a model is never run as
  HTML. Choose the Markdown renderer (`architecture.md` section 2 names one
  without choosing), and lift the plain-text rule in `prompts/planner.md`.
- Done when: tests of the rendering cover lists, emphasis, inline and
  display math, a formula that fails to parse, and raw HTML and a script
  tag shown inert; a browser check with the fake backend shows each in the
  thread.
- Note: done on 2026-11-15. The choices, checks and browser run are in
  `docs/decisions.md` under "Markdown and math"; `architecture.md`
  sections 2 and 10 name the renderer. The preview is built but not
  mounted, since the written answer field comes with 2.8 and 2.11.

### 2.5 Unit planning

- Status: done
- Depends on: 2.2
- Do: the `plan_unit` tool, `prompts/unit-planner.md`, and the planning
  session the engine runs when a unit without a plan starts: a backend
  session of its own, given the course, its curriculum and the unit, which
  stores the plan through `plan_unit` and then closes. A refused plan goes
  back with its reason, as with `propose_curriculum`. A session that ends
  without a plan is tried once more, then reported to the learner.
- Done when: fake-backend tests cover a stored plan, a refused plan
  corrected on the next call, a session that ends without a plan, a unit
  that already has one (no session is started), and a curriculum that is
  not approved; one run on Haiku 5.5, on a scratch data root, plans a unit
  of a course made through the intake.
- Note: update `architecture.md` section 9 for the new prompt file.
- Note: done on 2026-11-15. The choices, checks and the Haiku run are in
  `docs/decisions.md` under "Unit planning"; `architecture.md` sections 4,
  5 and 9 name the planning session and its prompt.

### 2.6 Unit chat and phases

- Status: done
- Depends on: 2.2, 2.5
- Do: the unit chat, built from `src/server/engine/conversation.ts` as the
  intake is. Starting a unit plans it (2.5), then sends segment 1's teach
  turn. The engine enforces `architecture.md` section 4's phases: the end
  of the teaching turn, or Stop during it, moves to discuss; the learner's
  "ready" moves to check; in check the tutor posts questions with
  `ask_question`, now naming an objective of the segment, and each answer
  is graded, appended to the evidence and sent to the tutor; the tutor's
  `close_segment` is refused until every objective of the segment has an
  answer from this check; the learner's override closes the segment and is
  recorded as evidence; the learner starts the next segment. Tools called
  out of phase are refused with a reason the tutor can act on. The engine
  composes every turn's header and writes `state.json` after every change,
  so an open question survives a restart. The tutor's system prompt is
  assembled from `prompts/tutor.md`, `style.md` and the course context
  (section 9); a short first `tutor.md` will do until 2.16. Routes and page
  events for all of it; opening a unit updates `lastOpenedAt`.
- Done when: fake-backend tests cover each transition, `ask_question` and
  `close_segment` refused out of phase with the reason reaching the tutor,
  an override, and a new engine over the same data root reopening a unit
  mid-check from `state.json` (the tutor's own session resumes from 2.14);
  route tests cover the new routes.
- Note: mock 3 gives "Start the next segment" to the learner, so starting
  a segment is the learner's action and not a teaching tool. If that
  holds, revise the tool list in `architecture.md` section 5.
- Note: done on 2026-11-15. The choices and checks are in
  `docs/decisions.md` under "Unit chat and phases"; `architecture.md`
  sections 3, 4, 5, 9 and 10 describe the unit chat, its rules, the tool
  list without `start_segment`, the system prompt and the routes.

### 2.7 Check rules and unit close

- Status: done
- Depends on: 2.1, 2.3, 2.6
- Do: the rules 2.6 leaves simple. The number of questions adapts within
  limits (brief, "Teaching style"): after a miss on an objective another
  question on it is required before the segment closes, up to a limit, and
  fewer after confident correct answers. Answers record help as 2.3
  settles. The unit closes when its last segment does, passed when every
  objective passed and otherwise in the form 2.1 settles; stage 5 adds the
  gate and notes before it. Page events carry each objective's and the
  unit's derived status.
- Done when: fake-backend tests cover a miss that requires another
  question, the limit that lets the segment close anyway, a confident
  correct answer that shortens the check, an assisted answer, and a unit
  closing passed and not passed.
- Note from 2.1: when some objectives did not pass, the closing card
  (piece 10) offers "Go over the N again", one more segment on those
  objectives after the plan's last, or "Move on without them", which
  records the unit as overridden.
- Note: done on 2026-11-15. The choices, the limit and the checks are in
  `docs/decisions.md` under "Check rules and unit close";
  `architecture.md` sections 3, 4 and 10 describe the rules, the extra
  segment and the routes.

### 2.8 Rubric grading

- Status: done
- Depends on: 2.6
- Do: `oneShot` in the adapter (`architecture.md` section 7) for the
  Claude and fake backends: one request with its own system prompt, no
  tools and no stored session, whose output is checked against a zod
  schema. A written answer kind for `ask_question`, carrying a rubric that
  never reaches the page. Grading dispatch (section 6) gives the grader the
  question, the rubric and the answer, never the tutor's conversation, and
  records the verdict and the first flawed step or missing element in the
  evidence and on the graded card. A failed grading call is shown, and the
  answer can be graded again. A short first `prompts/grader.md` will do
  until 2.9. Settle section 7's open row on other variables that may
  redirect the SDK: drop them from its environment, or try them.
- Done when: fake-backend tests cover a correct and an incorrect written
  answer recorded as evidence, a grader reply that fails the schema, and a
  grader request that holds nothing of the tutor's conversation; one run on
  Haiku 5.5 grades an answer through `oneShot`.
- Note: done on 2026-11-15. The choices, the Haiku run and the checks are
  in `docs/decisions.md` under "Rubric grading"; `architecture.md`
  sections 3 to 7, 9 and 10 describe `oneShot`, the written kind, the
  grading rules, the environment and the route.

### 2.8a Review fixes

- Status: done
- Depends on: 2.8
- Do: fix the seven findings of the user's review of 2.6 to 2.8
  (2026-11-15). Moving on is refused while a written answer waits for its
  grade, also after a failed grading. A question has one answer: one
  already recorded for it is kept, and a unit reopened with it closes the
  question rather than grading or recording another. An evidence line is
  written whole before the append returns. A unit whose id is an inherited
  property name (`constructor`) opens. Stop while a turn's text is being
  composed stops that turn. An override is written to `state.json` before
  the page hears of it. The fake backend's one-shot request fails once it
  is stopped, as Claude's does.
- Done when: a regression test for each finding fails before its fix and
  passes after it, and `mise run check` passes.
- Note: done on 2026-11-15. `mise run check` passed (381 TypeScript tests,
  one Python test); each new regression check failed before its fix. The
  choices and checks are in `docs/decisions.md` under "Review fixes
  (plan task 2.8a)"; `architecture.md` section 4 has the rules on one
  answer per question and Stop before a turn is sent. The review's split
  of `unit-chat.ts` is task 2.8b.

### 2.8b Split the unit chat

- Status: done
- Depends on: 2.8a
- Do: split `engine/unit-chat.ts` before 2.13 to 2.15 add transcript
  writes, resume and idle closing to it (the review's recommendation,
  2026-11-15). Recording an answer and reconciling it with the evidence go
  in one module, starting, stopping and closing the tutor's and the
  grader's work in another, and `UnitChat` stays the coordinator. It keeps
  the one serial queue (`exclusive`), which the extracted modules are
  given rather than keeping queues of their own. No change in behaviour.
- Done when: `mise run check` passes with `unit-chat.test.ts` unchanged
  apart from its imports.
- Note: done on 2026-11-15. `mise run check` passed (381 TypeScript tests,
  one Python test) with no test changed. The parts and the one queue are
  in `docs/decisions.md` under "Unit chat split"; `architecture.md`
  section 4 names the files.

### 2.9 Grader prompt

- Status: done
- Depends on: 2.8
- Do: draft `prompts/grader.md`. Write a small set of math answers with
  grades worked by hand: a correct proof, a proof with a flawed middle
  step, one that misses a case, a correct answer in unusual words, and a
  near miss. Grade the set through `oneShot` on the model the grader will
  use, and revise until the grades agree. Choose that model and record why.
- Done when: in two runs the grader agrees with the hand grades on the set
  and names the flawed step or missing element where there is one; the
  set, the results and the model choice are in `docs/decisions.md`.
- Note: this check depends on the grader's judgment, so it may use Sonnet
  or Opus (`AGENTS.md`).
- Note: done on 2026-11-15. Sonnet 5.5 agreed with every hand grade in
  two runs of the final prompt (and in all eight of its runs), naming the
  first flaw each time; Haiku 5.5 failed a correct answer in plain words.
  The set is `scripts/grader-set.ts`, its runner `scripts/grade-set.ts`;
  the set, the runs, the prompt's rules and the model choice are in
  `docs/decisions.md` under "Grader prompt". `mise run check` passed (381
  TypeScript tests, one Python test).

### 2.10 Style note at intake

- Status: done
- Depends on: 2.1
- Do: `propose_curriculum` carries a short style note (brief, "Teaching
  style"), and `prompts/planner.md` asks for one. The proposal card shows
  it where 2.1 settles. It is stored as `style.md` with the draft and
  approved with it, and a reopened draft carries it. A course without one
  uses the default style in `prompts/tutor.md`.
- Done when: fake-backend tests cover a proposal's note stored, a revision
  replacing it, approval keeping it, and a reopened draft showing it; a
  browser check shows it on the card.
- Note: done on 2026-11-15. `mise run check` passed (387 TypeScript
  tests, one Python test); a browser run with the fake backend showed the
  note on the first card, marked "Changed" on a revision, and on a draft
  reopened after a restart. The choices and checks are in
  `docs/decisions.md` under "Style note at intake".

### 2.11 Session view

- Status: done
- Depends on: 2.4, 2.7, 2.8
- Do: the session page from mocks 1 to 4: the thread with its phase
  markers and next-step control ("ready", the override confirmed once, the
  next segment), the question card for multiple-choice and written
  answers, the top line with the path and "Segment n of m", which opens the
  unit's outline, and the unit's end as 2.1 settles. "Start unit 1" after
  approval (mock 8), and starting or continuing a unit from the course
  view.
- Done when: a browser check with the fake backend covers starting a unit,
  a whole segment with a multiple-choice and a written answer, an
  override, the outline, the unit's end, and a reload mid-check.
- Note from 2.4 and 2.8: the written card is this task's. Mount
  `AnswerPreview` (`src/web/prose.tsx`) under its text field; show
  "Grading" on `grading`, the reason and "Grade again"
  (`POST .../grade-again`) on `grading_failed`, and on the graded card the
  answer with `Prose` and the `flaw`. `QuestionCard` takes choice
  questions only so far, and the timeline ignores the grading events.
- Note: done on 2026-11-15. `mise run check` passed (435 TypeScript
  tests, one Python test). A browser run with the fake backend covered
  starting a unit after approval and from the course view, a whole
  segment with a multiple-choice and a written answer (a failed grading
  and "Grade again" included), an override, the outline, both ways out of
  the unit's end, and a reload mid-check. The choices and checks are in
  `docs/decisions.md` under "Session view".

### 2.12 Course and library progress

- Status: done
- Depends on: 2.1, 2.7
- Do: unit status in the course view's list and diagram, the card at the
  top that leads to the unit in progress or the next one, Start on every
  unit not started (asking first when its prerequisites are not
  finished), and the library's ticks, "where" line and Finished group
  (mocks 6, 7 and 12; the classes are in `docs/prototype/base.css`), all
  derived from the record.
- Done when: tests of the page's pure modules cover each status, the
  library's line for each, and which unit the card leads to (in progress,
  several in progress, none); a browser check with the fake backend shows
  a unit in progress, a passed unit and an overridden one.
- Note: done on 2026-11-15. `mise run check` passed (465 TypeScript
  tests, one Python test). A browser run with the fake backend showed
  units passed, overridden and in progress in the library, the course
  view's list, card and diagram, Start asking first and starting a unit,
  and a unit passed live. The choices and checks are in
  `docs/decisions.md` under "Course and library progress".

### 2.12b Dev server on the fake backend

- Status: done
- Depends on: 2.12
- Do: a kept way to run the whole app with no model, for browser checks.
  Tasks 2.11 and 2.12 each built a scratch server for theirs (like
  `main.ts`, on a scripted tutor that reads each turn's header, with a
  seeded scratch data root) and threw it away, so neither check can be
  run again (the user's review of `32b7478`). A script under `scripts/`
  starts the server as `main.ts` does, on a scripted backend that
  proposes a curriculum at intake, plans a unit, teaches, asks, closes
  segments and grades written answers, and can seed its data root with
  courses in each state (a draft, not started, units in progress, passed
  and overridden, a finished course, a one-off). It refuses the real data
  root. Add the command to `AGENTS.md`, with the rule that a browser run
  ends by closing the browser before the server stops: a session page
  left open keeps opening its unit on whatever server next comes up on
  its port (found in the same review, where it started a unit on a
  real-backend scratch server).
- Done when: the command runs with no call to a real model; a test takes
  the scripted tutor through one segment, from teaching to closed, by way
  of the engine, so a change that breaks the script fails a test; a
  browser run goes from the seeded library through one unit to its
  closing card.
- Note: done on 2026-11-15. `mise run check` passed (474 TypeScript
  tests, one Python test). A browser run on `pnpm dev:fake` went from the
  seeded library through one unit, planned and taught by the scripted
  backend, to its closing card, with no model called. The choices and
  checks are in `docs/decisions.md` under "Dev server on the fake
  backend".

### 2.13 Transcripts

- Status: done
- Depends on: 2.6, 2.11
- Do: each unit chat appends its page events to
  `sessions/<session-id>.jsonl` (`architecture.md` section 3) as they
  happen, and a unit reopened after a restart shows its thread from them.
  Settle what starts a new session (the brief's "one sitting") and record
  it.
- Done when: tests against a temporary data root cover a thread rebuilt
  after a simulated restart, a transcript whose last line a crash cut
  short, and two sessions of one unit shown in order; a browser check
  after a restart.
- Note: done on 2026-11-16. A session starts when a unit's chat opens and
  after the unit has been quiet for an hour; its transcript is
  `sessions/<unit id>.<n>.jsonl`. `mise run check` passed (487 TypeScript
  tests, one Python test), with fake-backend tests of each case in "Done
  when". A browser run on `pnpm dev:fake` showed the thread rebuilt after
  a Ctrl-C restart and after a `kill -9` mid-reply. The choices and checks
  are in `docs/decisions.md` under "Transcripts".

### 2.14 Resume and start fresh

- Status: done
- Depends on: 2.13
- Do: `resumeId` in the adapter. The Claude backend keeps its sessions
  (`persistSession`), runs them in the course folder, resumes by id, and
  reports a session it cannot find as a failure of its own. Reopening a
  unit after a restart resumes its tutor session; if that fails, the unit
  starts fresh, seeded from the record (section 4), and the thread says
  so. "Start fresh" for the learner, where 2.1 put it. Settle section 7's
  open row on resume: try `snapshot: false`, and check that the 30-day
  cleanup ends in the fallback.
- Done when: fake-backend tests cover resuming by the stored id, a session
  not found that starts fresh with the seed, and the learner's "Start
  fresh"; one run on Haiku 5.5 stops the server mid-segment, restarts it,
  and the tutor carries on from where it was.
- Note: watch for the slow reply after a stop (section 7, open since 0.5).
- Note: done on 2026-11-16. The tutor's session runs in the course folder,
  is kept, and its id is in the unit's position; a reopened unit resumes
  it as it opens, and a session not found starts fresh with a marker.
  `snapshot: false` gives a resumed session the current system prompt; the
  30-day sweep ends in the fallback. `mise run check` passed (504
  TypeScript tests, one Python test), with fake-backend tests of each case
  in "Done when". A browser run on `pnpm dev:fake` showed Start fresh, a
  resume and the fallback; a Haiku 5.5 run stopped the server
  mid-segment, and after the restart the tutor recalled what the learner
  had told it before. The choices and checks are in `docs/decisions.md`
  under "Resume and start fresh".

### 2.15 Close idle tutor sessions

- Status: done
- Depends on: 2.14
- Do: close a chat's tutor session, an intake's or a unit's, once it has
  been idle for a while, and resume it with the next message. Each one is
  a Claude Code process until the server stops (notes from 1.5 and 1.6).
  An intake's session must then be kept, as a unit's is.
- Done when: fake-backend tests with a fake clock cover closing after the
  idle time, resuming with the next message, and a session never closed
  while a turn is queued or running.
- Note from 2.14's review: settle on one way to resume. A unit resumes as
  it opens today; after an idle close it must resume at the next message,
  where the fallback then comes after the learner's message. The SDK's
  `getSessionInfo(id, { dir })` says whether a session is there without a
  process, so the opening could show the marker and leave resuming to the
  first message (`docs/decisions.md`, "Resume and start fresh", the review
  fixes).
- Note from 2.14's review: a session that fails to start fails every later
  turn of its conversation (`createConversation` keeps the rejected start).
  A resume at the next message that fails once must be tried again by the
  message after it, and one that is not found must fall back.
- Note: done on 2026-11-16. Every chat's conversation closes a kept
  session (a unit's tutor, and now an intake, kept in the data root's
  `intake/` folder) after ten minutes with no turn queued or running and
  no grading waiting, and the next turn resumes it; a failed start or
  resume fails that turn and the next tries again. One way to resume:
  opening a unit only asks the backend (`hasSession`, `getSessionInfo`),
  and the first turn resumes; a session lost at a turn falls back there.
  `resumeFailed` and "Start fresh instead" are gone. `mise run check`
  passed (518 TypeScript tests, one Python test), with fake-timer tests of
  each case in "Done when"; 13 faults put in by hand each failed a test; a
  browser run on `pnpm dev:fake` showed a broken resume, Start fresh and a
  resume after a restart. No real-backend run. The choices and checks are
  in `docs/decisions.md` under "Idle sessions".

### 2.15a Idle-session review fixes

- Status: done
- Depends on: 2.15
- Do: keep Claude session lookup on the same configuration root as its
  sanitized subprocesses; preserve a reopened intake's draft when its first
  startup fails; associate a lost-session fallback with its actual learner
  message, including queued messages and transcript replay.
- Done when: focused regressions cover all three failures, `mise run check`
  passes, and the fallback conversation boundary is checked in the browser
  on the fake backend.
- Note: done on 2026-11-16. Lookup preserves the existing sanitized login
  and storage root; only an inherited configuration override needs a short
  Node lookup subprocess. Intake initialization waits for delivery, and
  fallback markers explicitly identify their learner message. Regressions
  cover SDK lookup on scratch files, failed/stopped intake startup,
  concurrent messages during resume and transcript replay. `mise run check`
  passed lint, types, 527 TypeScript tests and one Python test. The session
  page on `pnpm dev:fake` replayed the queued-message transcript with both
  messages in the new conversation and only earlier content dimmed.
  No model calls. Findings and limits: `decisions.md`, "Idle-session
  review fixes".

### 2.16a Feedback turn after an answer

- Status: done
- Depends on: 2.15a
- Why: 2.16's run found that the tutor, on Claude with adaptive thinking,
  wrote its feedback in its thinking (never shown) and posted the next
  question with no text in 7 of 8 answer turns, and neither the prompt,
  turning thinking off (Claude Code ignores it for Sonnet 5.5) nor the
  thinking display fixed it (`docs/decisions.md`, "Tutor prompt"). The
  working tree holds 2.16's uncommitted changes: `prompts/tutor.md`, and a
  rule in `engine/unit-chat.ts` (`feedbackMissing`, with its tests) that
  refuses both tools after an answer until the tutor has written text. It
  guarantees the order but the check stalls: refused, the tutor asked the
  learner to send a message in 3 of 4 turns.
- Do: make the turn after a graded answer a feedback turn: its header
  allows feedback only, and `ask_question` and `close_segment` are refused
  in it. When it ends, unless it was stopped, the engine sends the next
  check turn, which asks for a question on the objectives still open, or
  for `close_segment` when all are done (or the engine closes the segment
  itself; decide, and record why). Skip that turn if a learner message
  queued meanwhile has already led to a question or a close. Replace the
  refuse-until-text rule, or keep it for the follow-up turn only if a run
  shows it is needed. Update the headers (`unit-turns.ts`),
  `backends/scripted.ts` (its answer turns post at once), the tests, and
  `tutor.md`'s section "Posting a question ends your turn".
- Done when: fake-backend tests show, after an answer, the feedback turn's
  text before the next question or the close, both tools refused during
  the feedback turn, no follow-up after Stop, and no follow-up after a
  message turn that posted a question; and a real check on Sonnet 5.5
  (where the failure was seen, so not Haiku) of at least three answers shows feedback text before each next question,
  no refusal, and no request for the learner to send a message.
- Note: done on 2026-11-16. The turn after an answer allows feedback
  only and refuses `ask_question`; when it ends, the engine asks for the
  next question in a turn of its own (`nextQuestionTurn`), skipped if a
  reply to a message has posted one, and not sent after a Stop. The
  engine closes the segment when the feedback on the check's last answer
  ends, so `close_segment` is removed (decided here: the check rules
  already say when a check is done, and the tool was a second way to
  stall). The refuse-until-text rule is removed. `mise run check` passed
  (534 TypeScript tests, one Python test); six faults put in by hand each
  failed a test; `pnpm dev:fake` showed feedback, then the next question,
  then the close. Real run on Sonnet 5.5, three answers in one segment:
  feedback written before question 2, question 3 and the close each time,
  no refusal, no request for a message, and no thinking in any of the 7
  requests. Committed with 2.16's prompt rewrite and run record, which
  this task changes. Findings: `decisions.md`, "Feedback turn".

### 2.16 Tutor prompt

- Status: done
- Depends on: 2.9, 2.10, 2.12, 2.15, 2.15a, 2.16a
- Do: draft `prompts/tutor.md`: the teaching rhythm and what each header
  allows, the cap on teaching length, that posting a question ends the
  turn so feedback and lead-in come first (task 0.3), Markdown with `$`
  math, and the default style that a course's `style.md` adjusts. Teach
  segments of a math course in the browser, read the transcripts, and
  revise.
- Done when: in a real run of at least two segments, the transcripts show
  teaching within the cap, no hint in a question's lead-in, feedback
  before the next question, `close_segment` only after the check, and
  math that renders; what was revised, and why, is in `docs/decisions.md`.
- Note: the result depends on how well the tutor teaches, so this run may
  use Sonnet or Opus; checks of the flow alone stay on Haiku 5.5
  (`AGENTS.md`).
- Note from 2.4: say how math is written (`$...$`, `$$` on a line of its
  own, `\$` for a dollar sign), as `prompts/planner.md` does, and that
  images are not shown.
- Note from 2.9: the grader accepts any valid method and reads what may be
  assumed without proof from the rubric, so ask rubrics to say what may be
  assumed and not to depend on one method (`docs/decisions.md`, "Grader
  prompt").
- Note: done on 2026-11-16. A first run of three segments found the
  feedback going into the tutor's thinking (fixed by 2.16a); the rerun of
  two segments on Sonnet 5.5 met the whole "done when": teaching 328 and
  327 words, no hint in six lead-ins, feedback written before every next
  question and close, segments closed only after their checks, no KaTeX
  error in 174 formulas. Revised: feedback under 100 words, about the
  answer given (from 2.16a's run); the answer letter checked against the
  choices, replacing "a letter picked at random", which gave a wrong
  answer key. Choice order goes to 2.17. Findings: `decisions.md`, "Tutor
  prompt".

### 2.17 Shuffle the choices

- Status: done
- Depends on: 2.16
- Why: the tutor puts the correct choice at A in most questions, so a
  learner could learn the letter; asked to place it at random, it wrote a
  wrong answer key (`docs/decisions.md`, "Tutor prompt").
- Do: when a choice question is posted, the engine shuffles its choices
  and moves the answer letter with the correct one before the question is
  stored, so the page, the evidence and the tutor's later turns all have
  the stored order. Keep the tests' order fixed where they read posted
  choices (an injected shuffle). Update `scripted.ts`, whose tutor says A
  is always correct, and the note on it in `AGENTS.md`.
- Done when: tests show a posted question's choices are a permutation of
  the tutor's, with the answer letter on the same text, and the answer
  turn listing the stored order; a browser check on `pnpm dev:fake` still
  lets the right choice be picked.
- Note: done on 2026-11-16. `engine/choice-order.ts` shuffles a choice
  question's choices when it is posted (uniformly, from `node:crypto`) and
  moves the answer letter with the correct one; the question is stored in
  that order, and `ask_question`'s reply lists it for the tutor. Tests
  inject the tutor's own order (`givenOrder`). The scripted tutor's right
  choice is the sum it asks for. `mise run check` passed (540 TypeScript
  tests, one Python test); leaving the answer letter unmoved failed two
  tests; on `pnpm dev:fake` a shuffled question's right choice, at B, was
  graded correct. No real-model run. Findings: `decisions.md`, "Choice
  order".

### 2.17a Feedback queue review fixes

- Status: done
- Depends on: 2.16a, 2.17
- Do: keep questions blocked while feedback is queued as well as while it
  runs, and cancel a queued automatic next-question turn when the learner
  presses Stop during an intervening reply.
- Done when: fake-backend regression tests fail on the reviewed commits
  and pass with the fixes, showing feedback before the next question even
  with earlier messages queued, no automatic question after Stop during
  an intervening reply, and recovery through a later learner message;
  `mise run check` passes.
- Note: done on 2026-11-16. Feedback blocks questions as soon as it is
  queued; messages ahead of it get a header and refusal that say to wait
  for its separate turn. A Stop count cancels the automatic next-question
  turn after Stop in any intervening reply. Three new regression cases
  failed before their respective fixes and pass now, including recovery
  through a later message. `mise run check` passed: lint, types, 543
  TypeScript tests and one Python test. No real-model run. Findings:
  `decisions.md`, "Feedback queue review fixes".

### 2.18 Thread separators and the pinned question

- Status: done
- Depends on: stage 2's tasks above
- Why: the thread has no visible break between turns, and an open
  question scrolls out of view once the learner and tutor write below it
  (the user's notes 3 and 4).
- Do: a thin dividing line and more space between turns in the session
  thread: each tutor reply, learner message, question card and marker.
  While a question is open, it sits above the message box, where it can
  be answered, until it is answered; its graded record then sits in the
  thread where it was posted. Match the look of `docs/prototype/base.css`.
- Done when: a browser check on `pnpm dev:fake` shows turns separated, and
  a question that stays visible and answerable above the message box while
  several messages are exchanged; screenshots go in the report for the
  user to judge the look.
- Note: done on 2026-11-16. Lines between messages but not inside one
  exchange (lead-in, card, feedback); the open question above the message
  box with the move-on control under it, compact and at most half the
  window high; the latest question, answered after the conversation went
  on below it, moved to where it was answered. `mise run check` passed
  (554 TypeScript tests, one Python test); each of thirteen injected
  faults failed a test. Browser run on `pnpm dev:fake`, with screenshots
  for the user. Findings: `decisions.md`, "Thread separators and the
  pinned question".

### 2.19 Strict passing and no question limit

- Status: done
- Depends on: stage 2's tasks above
- Why: segments closed at the three-question limit with objectives not
  passed and no override recorded; the user wants passing strict by
  default (`decisions.md`, "Stage 2 user check").
- Do: the passing rule in `record/status.ts` becomes: since its last miss,
  an unassisted correct answer at 90% or 100%, and for an objective ever
  missed, a second unassisted correct answer to a different question.
  Remove the limit in `engine/check-rules.ts`: an objective is done in a
  check only once it passes, and the segment closes when all have passed
  or the learner moves on (an override, as now). The closing card's rows
  lose "the limit". Update the check headers, `tutor.md` (the check, and
  a rule against promising what the app does not do, such as "we'll come
  back to it"), `scripted.ts` if its answers no longer close a check, and
  architecture section 4.
- Done when: hand-worked status tests pass, including the user's real
  sequences (an "I don't know", then correct at 75%, then correct with
  help: not passed; three "I don't know"s: not passed), one confident
  first answer passing, two unconfident ones not, and a miss then a
  confident and another correct answer passing; check-rule tests show no
  limit; `mise run check` passes; on `pnpm dev:fake` a check with misses
  keeps asking until the objective passes or the learner moves on.
- Note: done on 2026-11-16. The passing rule and no limit as asked; a
  fourth reason, `confirm`, for a confident answer that is not enough
  after a miss; the header's count is "(N asked)", and the scripted tutor
  reads it (it looped on one question before); the closing card's
  reasons reworded; `tutor.md` gained the two sentences. `mise run check`
  passed (563 TypeScript tests, one Python test); six injected faults
  each failed tests. Browser run on `pnpm dev:fake`. Findings:
  `decisions.md`, "Strict passing".

### 2.20 Detour after a miss

- Status: done
- Depends on: 2.19
- Why: after a miss the next question came at once, with no room to find
  or fix the confusion (notes 2, 5 and 6).
- Do: a miss (wrong or "I don't know") in a check starts a detour. Its
  first turn replaces the feedback turn: the header asks the tutor to give
  the right answer and why, then find where the confusion is (from the
  choice picked, the grader's flaw, the learner's reasoning or stuck line,
  or by asking one question) and work through it; at the second miss on
  the objective in this check, to teach the objective again another way.
  The engine posts no next question during a detour; the learner presses
  "Ready for another question" (the tutor may suggest it), which sends
  `nextQuestionTurn`. A correct answer keeps the automatic next question.
  Messages in a detour are not help. Moving on stays open in a detour.
  The position holds the open detour, so a restart reopens it. "I don't
  know" takes an optional line on where the learner got stuck, kept with
  the answer and given to the tutor. Update `tutor.md`'s feedback
  section, `scripted.ts`, the page (the button, the detour's marker) and
  architecture section 4 (the detour replaces its `start_detour` design;
  the misconception record stays in stage 5).
- Done when: fake-backend tests show a miss opens a detour with no
  question until "ready", a correct answer still leads to the next
  question, "ready" asks for one on an open objective, a message in a
  detour is not help, a restart reopens a detour, moving on from one
  records the override, and the stuck line reaches the tutor's turn; a
  browser check on `pnpm dev:fake`; one real segment on Sonnet 5.5 with a
  wrong answer and an "I don't know", its transcript read against what
  the headers ask (the confusion found, no question until ready, teaching
  again after a second miss).
- Note: done on 2026-11-16. As asked; the agent's choices: the detour
  opens in the write that closes the missed question; the page hears
  `detour` and `detour_end`; teaching again from the second miss on,
  counted in this check; "I don't know" hides the answer fields while it
  asks where the learner got stuck (found in the browser run). `mise run
  check` passed (578 TypeScript tests, one Python test); six injected
  faults each failed tests. Browser run on `pnpm dev:fake`; one real
  segment on Sonnet 5.5, whose turns matched the headers. Findings:
  `decisions.md`, "Detour after a miss".

### 2.20a Detour queue review fix

- Status: done
- Depends on: 2.20
- Why: a learner message received while "Ready for another question"
  writes the position can post a question before that action's queued
  next-question turn, which then runs even after a new miss.
- Do: use the guarded next-question queue for ending a detour too. Skip
  the request if an intervening reply posts a question or Stop cancels it.
- Done when: deterministic fake-backend regression tests cover a newer
  open question, a newer miss and Stop; `mise run check` passes.
- Note: all three regressions failed against the original code, then
  passed with the shared queue guard. `mise run check` passed: lint,
  type-checking, 581 TypeScript tests and one Python test. No real model
  calls. Findings: `decisions.md`, "Detour queue review fix".

### 2.21 Clarification or help

- Status: done
- Depends on: 2.18
- Why: asking what a question means is charged as help, the same as
  asking for the method (note 4).
- Do: after the tutor replies to a message sent while a question is open,
  a separate judging call (`oneShot`, a prompt in `prompts/`) reads the
  question with its answer key or rubric, the message and the reply, and
  returns clarification (only what the question asks: its wording, its
  notation, the form of answer wanted) or help (anything toward the
  answer: a method, a step, a value, a similar worked example, a mistake
  to avoid). The answer is assisted if any such exchange was judged help;
  a failed call counts as help; an answer sent before the call returns
  waits for it. The page shows the call under the reply, and the message
  box, while a question is open, says that asking what it means is free
  and anything else counts as help. Pick the judge's model from a small
  hand-judged set of exchanges, as task 2.9 did for the grader. Update
  section 4's help rule and `tutor.md`'s.
- Done when: fake-backend tests cover clarification (the answer still
  counts), help, a failed call and an answer waiting on the call; the
  hand-judged set run twice on the real model, with each disagreement
  reported; a browser check on `pnpm dev:fake` shows the call and the
  notice.
- Note: done on 2026-11-16. As asked, except the notice's wording: it says
  a reply that helps toward the answer makes the answer given with help,
  since the tutor declines what it may not give and asking for more is
  then free. The agent's choices: the exchange begins when the tutor
  receives the message; a reply with no text is not judged; a written
  answer that waits is graded after the judging; a restart counts cut-off
  calls as help; the Stop count is taken when an answer is sent, keeping
  2.17a's rule. Haiku 5.5 agreed with every hand verdict in four runs (16
  exchanges twice, then 19 twice). `mise run check` passed; five injected
  faults each failed tests. Browser run on `pnpm dev:fake`. Findings:
  `decisions.md`, "Help judge".
