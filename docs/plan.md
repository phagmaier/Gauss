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

- Status: todo
- Depends on: none
- Do: `git init` and `.gitignore`; `mise.toml` pinning node, pnpm, python, uv;
  `package.json` with TypeScript, Vitest, and one linter/formatter; a `pytools/`
  uv project with pytest. Fill in the Commands section of `AGENTS.md`.
- Done when: install, test, lint and type-check commands all run clean on the
  empty project, and `AGENTS.md` lists them.

### 0.2 Claude on the plan login

- Status: todo
- Depends on: 0.1
- Do: a script that sends one prompt through `@anthropic-ai/claude-agent-sdk`
  with a custom `systemPrompt`, `settingSources: []`, and partial-message
  streaming, and prints the stream.
- Done when: `docs/decisions.md` records, from observed runs: whether it works
  with no API key; what happens when `ANTHROPIC_API_KEY` is set; whether the
  user's personal Claude Code instructions and skills are absent from the
  session; which built-in tools the session reports.

### 0.3 Question round trip

- Status: todo
- Depends on: 0.2
- Do: an in-process `ask_question` tool that stores a question and returns
  "posted; end your turn". Feed the learner's answer back as the next turn.
- Done when: `docs/decisions.md` records whether the model reliably stops after
  the tool call, whether `alwaysLoad` is needed for the tool to be called
  without a search step, and the working option set.

### 0.4 Resume and confinement

- Status: todo
- Depends on: 0.2
- Do: resume a session by id after restarting the process. Find the `sandbox`
  and permission options that let the agent run a test command and write files
  inside one directory and nowhere else.
- Done when: `docs/decisions.md` records the exact options, plus an observed
  refusal when the agent is asked to write outside the directory.

### 0.5 Minimal page

- Status: todo
- Depends on: 0.3
- Do: a Hono server and a React page. Stream one tutor reply to the page over
  an event stream; render one multiple-choice question from `ask_question`;
  post the answer back.
- Done when: the round trip works in a browser, and the adapter interface in
  `architecture.md` section 7 is confirmed or revised to match what the spike
  needed.

### 0.6 Codex spike (limit: about one hour of work)

- Status: todo
- Depends on: 0.1
- Do: run one prompt through `@openai/codex-sdk` on the ChatGPT login. Find how
  a custom tool server is configured for it and how text is streamed.
- Done when: `docs/decisions.md` records what worked, what did not, and whether
  the adapter interface would need to change for Codex.

### 0.7 Close the stage

- Status: todo
- Depends on: 0.2, 0.3, 0.4, 0.5, 0.6
- Do: move each "to verify" item in `architecture.md` section 7 to verified or
  changed. Delete spike code that will not be kept.
- Done when: no "to verify" items remain, or each remaining one names the stage
  that will resolve it.

**User check:** open the page, watch a reply stream in, answer the
multiple-choice question, and see the tutor respond to the answer.

## Stage 1: record and library

Tasks may be revised by 0.7.

### 1.0 Page layout

- Status: in progress
- Depends on: none (pulled ahead of stage 0 at the user's request on
  2026-11-13; it is a static mock and needs no code from stage 0)
- Do: a static mock of the three views (library, course, session) for the user
  to react to before any real page work.
- Done when: the user has approved a layout, and it is saved under `docs/`.

### 1.1 Course and curriculum schemas

- Status: todo
- Depends on: stage 0
- Do: zod schemas in `src/shared/` for `course.json` and `curriculum.json`
  (units, prerequisites, goals, approval state).
- Done when: tests parse hand-written valid examples and reject examples with a
  missing goal, a prerequisite pointing at an unknown unit, and a prerequisite
  cycle.

### 1.2 Record module

- Status: todo
- Depends on: 1.1
- Do: resolve the data root (default `~/gauss/`, environment override); create,
  list and read courses; write files atomically.
- Done when: tests against a temporary data root cover create, list, read, and
  a reload after a simulated crash mid-write.

### 1.3 Backend adapter

- Status: todo
- Depends on: stage 0
- Do: the adapter interface, the scripted fake backend, and the Claude backend
  built from the stage 0 findings.
- Done when: an engine-level test drives a two-turn exchange with one tool call
  through the fake backend, and a manual run does the same through Claude.

### 1.4 Intake and curriculum proposal

- Status: todo
- Depends on: 1.2, 1.3
- Do: `prompts/planner.md`; the intake chat; the `propose_curriculum` tool,
  which validates against the schema and stores a draft; approval and
  change-request handling.
- Done when: fake-backend tests cover a valid proposal, a rejected invalid
  proposal (the tutor receives the reason), a change request followed by a
  revised proposal, and approval.

### 1.5 Routes and event stream

- Status: todo
- Depends on: 1.4
- Do: HTTP routes for the library, course creation, chat turns and curriculum
  approval; the server-to-page event stream.
- Done when: route tests pass against the fake backend.

### 1.6 Library and course views

- Status: todo
- Depends on: 1.0, 1.5
- Do: the library view, the intake chat, the curriculum review screen, and the
  diagram generated from `curriculum.json`.
- Done when: the stage's user check passes in a browser.

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
