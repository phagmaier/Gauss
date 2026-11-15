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
