# Gauss: build plan and task tracker

This file is the tracker. Status values: `todo`, `in progress`, `done`,
`blocked` (say why). See `AGENTS.md` for how to work a task.

Only open work is written out here. Finished tasks are one row in the table
below; their full text is in `archive/plan-done.md` (read it only to see
exactly what a task asked for), and their findings are in `decisions.md`.
When you finish a task, replace its entry with a row in the table, move the
entry's text to the end of `archive/plan-done.md`, and keep any note a later
task needs in the row.

Later stages are broken down by their first task (`N.0`) when the stage
starts, because each finished stage changes the details. Stage scope comes
from `architecture.md` section 12.

## Finished

Stage 0 (spike and skeleton) and stage 1 (record and library): both passed
the user's check on 2026-11-15. Stage 2 is under way.

| Task | What | Still matters to later tasks |
| --- | --- | --- |
| 0.1 | Toolchain | TypeScript 7 and pnpm 12 are newer than most guidance (`decisions.md`, "Toolchain"). |
| 0.2 | Claude on the plan login | Leave `ANTHROPIC_API_KEY` out of the SDK `env`; isolation options are in "Claude on the plan login" and "Question round trip". |
| 0.3 | Question round trip | The model does not reliably stop after a teaching tool, so a `PostToolUse` hook ends the turn. |
| 0.4 | Resume and confinement | Resume with the course folder as `cwd`; a resumed session keeps its first system prompt; `dontAsk` needs an allow rule for `Bash`; `CLAUDE_CODE_TMPDIR` must be inside the course folder. Which course folders the tutor may write is open (stage 3). |
| 0.5 | Minimal page | Kept code: adapter, fake backend and Claude backend in `src/server/backends/`. |
| 0.6 | Codex spike | For stage 6: the SDK does not stream text; the thread id arrives with the first turn; the learner's global `AGENTS.md` and skills cannot be kept out. |
| 0.7 | Close stage 0 | Open items are the table "Open after stage 0" in `architecture.md` section 7. `spike/` is deleted (`git show 349c399:spike/<file>`). |
| 0.8 | Review fixes | Stopping a turn before and after SDK pickup; drafts kept during a pending send. |
| 1.0 | Page layout | Mocks in `docs/prototype/`; styles in `base.css`; mocks are references for look, not code to reuse. |
| 1.1 | Course and curriculum schemas | `src/shared/course.ts`, `curriculum.ts`. The course id is the folder name, not stored in `course.json`. |
| 1.2 | Record module | `src/server/record/`. Writes to one file are not ordered against each other: wait for each `state.json` write before the next. |
| 1.3 | Backend adapter | Done by 0.5. Resume and `oneShot` come in stage 2; working directory and built-in tools in stage 3 (`architecture.md` section 7). |
| 1.4 | Intake and curriculum proposal | `src/server/engine/intake.ts`, `tools/propose-curriculum.ts`, `prompts/planner.md`; the shared turn queue is `engine/conversation.ts`. |
| 1.5 | Routes and event stream | `src/server/http/app.ts`; routes listed in "Routes and event stream". |
| 1.6 | Library and course views | `src/web/`. Abandoned intakes keep a Claude Code process until the server stops; 2.15 closes idle ones. |
| 1.7 | Review fixes | One intake per course when review overlaps approval; bounded, distinct diagram ports. |
| 2.0 | Break down stage 2 | The choices behind the breakdown: "Stage 2 breakdown". |
| 2.1 | Designs for stage 2 | Mocks 9 to 12 (style note, unit end, start fresh, unit order); picks and the tasks that use each are in "Stage 2 designs". |

## Stage 2: session engine

Broken down in task 2.0. The scope is `architecture.md` section 12's: unit
planning, segment phases, multiple-choice and rubric-graded questions,
confidence, evidence, derived status, override, resume, transcripts and
math rendering. The choices behind the breakdown are in `docs/decisions.md`
under "Stage 2 breakdown". Not in this stage: the symbolic math check, code
questions, artifacts and disputes (stage 3); sources (stage 4); the
baseline, detours, the unit gate, handoff notes, unit notes, transcript
export and style changes (stage 5). A unit in this stage closes without a
gate or notes.


### 2.2 Plan, state and evidence records

- Status: todo
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

### 2.3 Objective status

- Status: todo
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

### 2.4 Markdown and math

- Status: todo
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

### 2.5 Unit planning

- Status: todo
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

### 2.6 Unit chat and phases

- Status: todo
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

### 2.7 Check rules and unit close

- Status: todo
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

### 2.8 Rubric grading

- Status: todo
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

### 2.9 Grader prompt

- Status: todo
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

### 2.10 Style note at intake

- Status: todo
- Depends on: 2.1
- Do: `propose_curriculum` carries a short style note (brief, "Teaching
  style"), and `prompts/planner.md` asks for one. The proposal card shows
  it where 2.1 settles. It is stored as `style.md` with the draft and
  approved with it, and a reopened draft carries it. A course without one
  uses the default style in `prompts/tutor.md`.
- Done when: fake-backend tests cover a proposal's note stored, a revision
  replacing it, approval keeping it, and a reopened draft showing it; a
  browser check shows it on the card.

### 2.11 Session view

- Status: todo
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

### 2.12 Course and library progress

- Status: todo
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

### 2.13 Transcripts

- Status: todo
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

### 2.14 Resume and start fresh

- Status: todo
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

### 2.15 Close idle tutor sessions

- Status: todo
- Depends on: 2.14
- Do: close a chat's tutor session, an intake's or a unit's, once it has
  been idle for a while, and resume it with the next message. Each one is
  a Claude Code process until the server stops (notes from 1.5 and 1.6).
  An intake's session must then be kept, as a unit's is.
- Done when: fake-backend tests with a fake clock cover closing after the
  idle time, resuming with the next message, and a session never closed
  while a turn is queued or running.

### 2.16 Tutor prompt

- Status: todo
- Depends on: 2.9, 2.10, 2.12, 2.15
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
  - how the unit's planning session (task 2.5) is given the unit's whole
    text, which task 2.0 put there;
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
