# Gauss: build plan and task tracker

This file is the tracker. Status values: `todo`, `in progress`, `done`,
`blocked` (say why). See `AGENTS.md` for how to work a task.

Stages 0 and 1 are broken into tasks. Later stages are broken down by their
first task (`N.0`) when the stage starts, because stage 0's findings and each
finished stage change the details. Stage scope comes from
`architecture.md` section 12.

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

- Status: todo
- Depends on: 1.1
- Do: resolve the data root (default `~/gauss/`, environment override); create,
  list and read courses; write files atomically.
- Done when: tests against a temporary data root cover create, list, read, and
  a reload after a simulated crash mid-write.

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

- Status: todo
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

### 1.5 Routes and event stream

- Status: todo
- Depends on: 1.4
- Do: HTTP routes for the library, course creation, chat turns and curriculum
  approval; the server-to-page event stream.
- Done when: route tests pass against the fake backend.
- Note: the event stream exists (task 0.5, `src/server/http/app.ts`): a log
  replayed with resumable ids, and the guard that only Gauss's own page may
  use the API. This task adds the library, course and approval routes
  around it.

### 1.6 Library and course views

- Status: todo
- Depends on: 1.0, 1.5
- Do: the library view, the intake chat, the curriculum review screen, and the
  diagram generated from `curriculum.json`.
- Done when: the stage's user check passes in a browser.
- Note: replaces the demo page (`src/web/App.tsx`), keeping its thread, the
  question card and the message box, and `src/web/styles.css`.

**User check:** create a course, push back on the proposed curriculum once,
approve the revision, see the diagram, restart the server, and find the course
still there.

## Stage 2: session engine

### 2.0 Break down the stage

- Status: todo
- Depends on: stage 1
- Do: write this stage's tasks here in the same format, covering the scope in
  `architecture.md` section 12. Draft `prompts/tutor.md` and `prompts/grader.md`
  as tasks of their own.
- Done when: the user has read the task list.
- Note: for a source course, planning a unit needs the whole unit's text.
  When designing `plan_unit`, decide where that reading happens or leave it
  to 4.0 in writing (`architecture.md` section 8, "Open").

**User check:** complete one unit of a math course across two sittings,
stopping in the middle of a segment.

## Stage 3: checked grading and aids

### 3.0 Break down the stage

- Status: todo
- Depends on: stage 2

**User check:** a coding unit and a computational math unit are graded by
tests and the symbolic check, and an artifact appears in the side pane.

## Stage 4: sources

### 4.0 Break down the stage

- Status: todo
- Depends on: stage 3
- Note: the breakdown must settle these (`docs/decisions.md`, "Source
  sections"):
  - the section size limit, by trying candidates on real files: a long
    stretch with no headings (the _Phenomenology_'s Preface, if the user's
    edition has none), an arXiv paper and an EPUB;
  - the `outline.json` schema in `src/shared/`;
  - where unit planning reads the whole unit's text, unless stage 2 settled
    it;
  - fixture tests for the cut: the same ids on a second run, cuts only at
    paragraph boundaries, and a quote across a cut that still verifies.

**User check:** a lecture on one chapter of the _Phenomenology_ with verified
quotes, and one unit taught from a paper.

## Stage 5: mastery loop

### 5.0 Break down the stage

- Status: todo
- Depends on: stage 4

**User check:** one course runs from intake through a baseline to a closed
second unit, including a detour, a unit gate, generated notes and an exported
transcript.

## Stage 6: later

Codex backend, review mode, finals, self-test, cheat sheets, photo input. Each
is planned when chosen.
