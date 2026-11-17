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
the user's check on 2026-11-15. Stage 2 (session engine) passed it on
2026-11-17, at the second try: the first (2026-11-16) added tasks 2.18 to
2.22 (`decisions.md`, "Stage 2 user check"). A review of its record then
added tasks 2.23 to 2.27, which come before stage 3, and put stage 5 before
stage 4 (`decisions.md`, "Stage 2 review").

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
| 2.2 | Plan, state and evidence records | Schemas in `src/shared/plan.ts`, `state.ts`, `evidence.ts`; record operations `storePlan`, `readState` and `writePosition` (one unit's position; `null` takes it out), `appendEvidence` and `readEvidence`. An objective is taught in one segment only, so 2.7's extra segment needs a place of its own. Each read-and-write-back and each append goes through `record/file-lock.ts`; `record/json-lines.ts` serves 2.13's transcripts. |
| 2.3 | Objective status | `objectiveStatus` and `unitStatus` in `record/status.ts`. Passed: since the last miss, unassisted correct answers to two different questions, or one at 90% or 100%. Help (2.7 records it): the tutor received a learner message while the question was open. A unit with a position in `state.json` is in progress, so 2.7 takes it out when the unit closes. |
| 2.4 | Markdown and math | `Prose`, `InlineProse` and `AnswerPreview` in `src/web/prose.tsx` (react-markdown, remark-math, rehype-katex): the tutor's text, prompts and choices. `AnswerPreview` is not mounted yet: put it under the written answer field (2.8 or 2.11). Prompts must ask for `$` math, `$$` on a line of its own for display, and `\$` for a dollar sign (2.16); images are never shown. |
| 2.5 | Unit planning | `createUnitPlanner(...).plan(course, unit)` in `engine/unit-planning.ts` returns the stored plan or plans the unit in a session of its own (`prompts/unit-planner.md`, `tools/plan-unit.ts`); problems `not-found`, `not-approved`, `failed` with a message for the learner. Not wired yet: 2.6 reads the prompt in `main.ts` and calls it when a unit starts. Since 2.22 its turn carries the course's background note. |
| 2.6 | Unit chat and phases | `engine/unit-chat.ts` (phases, refusals, routes under `/api/courses/<id>/units/<unit>/`), headers and system prompt in `engine/unit-turns.ts`, `close_segment`; no `start_segment` (the learner starts segments). The check's answers are the evidence after `checkFrom` in the position. For 2.7: help is written `false`, the last segment stays closed in `state.json`, and opening a unit with no position starts it at segment 1. A reopened unit gets a new session (2.14 resumes); a turn's header is composed when it is sent. |
| 2.7 | Check rules and unit close | `engine/check-rules.ts`: an objective is done in a check once passed or after 3 questions, at least one per check. Help is marked on the open question when the tutor receives a message. The unit ends with its last segment: `unit_end` (the closing card), then `unit_closed` when all passed; otherwise `go-over-again` (a segment after the plan's, in the position's `again`) or `finish` (override of the rest). Events carry statuses (`unit_status`, `graded.assisted`). A finished unit opens finished, never restarted. |
| 2.8 | Rubric grading | `oneShot` in the adapter (SDK structured output, checked against a zod schema); `ask_question` takes `kind: "written"` with a rubric; `createGrader` in `engine/grading.ts` grades from the question, rubric and answer only, and returns `WrittenGrade` (verdict, and the flaw when incorrect). A written answer is final once sent, kept in `state.json` until graded, and graded outside the chat's queue; a failure is `grading_failed`, and `grade-again` retries. Page events `grading`, `grading_failed`, and `graded` with the answer and `flaw`; no written card yet (2.11). The grader uses the tutor's model until 2.9 picks one. The backend drops every `ANTHROPIC_` and `CLAUDE` variable. |
| 2.8a | Review fixes | A question has one answer: an open question whose answer the evidence holds (by `questionId`) is closed with it on reopening, never graded or recorded again. Moving on is refused while a written answer waits for its grade. Stop holds on a turn not yet sent. `appendJsonLine` writes whole lines. Look positions up with `Object.hasOwn`. |
| 2.8b | Split the unit chat | `unit-chat.ts` is the coordinator (phase rules, tools, learner actions) and owns the one queue; `unit-record.ts` writes the unit's position and evidence before the page hears of them; `unit-agents.ts` runs the tutor and the grader, where 2.14's resume and 2.15's idle closing go. |
| 2.9 | Grader prompt | The grader runs on Sonnet 5.5 (`GRADER_MODEL` in `backends/claude.ts`), or on `GAUSS_CLAUDE_MODEL` when that is set. `grader.md` accepts any valid method and reads what may be assumed from the rubric, so 2.16's rubric guidance should ask for both. Re-run `node scripts/grade-set.ts --runs 2` when the prompt, `WrittenGrade` or the model changes. Review corrected L1's hand-written flaw; its verdict is unchanged. |
| 2.10 | Style note at intake | `style` in `CurriculumProposal` (`StyleNote`, required, plain text up to 800 characters), stored as `style.md` with each draft and kept on approval. Drafts and courses from before have none: the card says the default style applies, and the tutor uses `tutor.md`'s default. 2.16's default style is what a note adjusts. `planner.md` promises only chat teaching; widen it in stage 3. Review fix: `approveCurriculum(id, shown)` refuses (`DraftMismatch`, 409) unless the record holds the proposal the card shows (`ShownProposal`). |
| 2.11 | Session view | `src/web/Session.tsx` at `/courses/<id>/units/<unit>`; logic in `session.ts` and `timeline.ts`. Every unit of an approved course has "Open" (2.12 makes it Start and Continue); the closing card's "Start unit N" is the next unit in the list. A thread after a restart starts at the record's position (2.13 rebuilds it); "Start fresh" goes in the outline (2.14). Objective statements render `$` math. Review fix: the course's details are asked again until the server answers (`getJsonUntilAnswered` in `api.ts`), and until they load the unit's place (`placement` in `session.ts`) is unknown, never the course's last unit. |
| 2.12 | Course and library progress | The routes send each unit's status and segment (`record/progress.ts`); `course.json` keeps when each unit was last opened (`unitsOpenedAt`). The page's rules are in `src/web/progress.ts`: the card leads to the unit in progress most recently opened, else the next in order; the closing card's "Start unit N" is the next in order too. A library row of a course with a unit in progress opens that unit's session. Finished units keep "Open" until notes (stage 5). Review fix: a course whose `state.json` or evidence cannot be read is still listed, with the reason in `problem` and no progress; its own route answers 500. |
| 2.12b | Dev server on the fake backend | `pnpm dev:fake` (port 4330): the server of `serve.ts` on the scripted backend (`backends/scripted.ts`), which follows the turn headers, on a scratch data root seeded with courses in each state (`record/dev-seed.ts`); a data root with courses is kept across restarts. Use it for browser checks, and close the browser before stopping it (`AGENTS.md`). A reworded header or a new one-shot request needs `scripted.ts` updated; its tests say so. |
| 2.13 | Transcripts | A session is one sitting: it starts when a unit's chat opens (once per server run) and when something happens after an hour quiet (`SESSION_GAP_MS` in `engine/transcript.ts`). Each session's page events go to `sessions/<unit id>.<n>.jsonl`, starting with a `session` event; a unit chat's log starts with its earlier sessions, and the page marks each later one ("New session", its date) and does not repeat the phase, question or closing card a reopened chat repeats. Transcripts are not flushed to disk, and a line that cannot be read is left out. For 2.14: the tutor is still new after a restart and the thread does not say so; the "Fresh start" marker goes after the session's. Review fix: `Prose` is memoized, since the thread now holds every session and was drawn whole on every event; earlier sessions are replayed with each reply's text joined; no session starts inside a tutor's turn; a question whose `graded` line was lost shows the evidence's grade when the unit opens. Left open: a unit with long earlier sessions still takes seconds to draw once when it opens. |
| 2.14 | Resume and start fresh | The tutor's session id is in the unit's position (`keepSession` in `unit-record.ts`); a session given a `cwd` is kept, and `startSession` with `resumeId` rejects with `SessionNotFound` when it cannot be found, the only failure that starts fresh. A reopened unit resumes its tutor as it opens, so each unit in progress holds a Claude Code process until the server stops: 2.15 closes idle ones (`UnitAgents.resume` and `startFresh` in `unit-agents.ts`). Kept sessions are rebuilt with the current system prompt (`snapshot: false`), so a revised `tutor.md` (2.16) reaches units under way. Start fresh sends the tutor one turn (`freshTurn`); the fallback sends nothing until the learner acts. The slow reply after a stop was not exercised (no Stop in the real run). Review fix: a card that still waits (an open question, the closing card) is not dimmed with an earlier conversation; a resume that fails another way is `unit_failed` with `resumeFailed`, and `start-fresh` on that unit gives the conversation up and opens it as one whose session is lost; kept sessions get a `title`; `BROKEN_SESSION` in `scripted.ts` shows the failure on `pnpm dev:fake`; a session stopped mid-reply resumed on Haiku. |
| 2.15 | Close idle tutor sessions | `createConversation` (`engine/conversation.ts`) closes a kept session after `IDLE_MS` (ten minutes) with no turn queued or running and nothing `waiting` (a grading), and the next turn resumes it; a failed start or resume fails only that turn. Intakes are kept too, in `<data root>/intake/`, for this only. Opening a unit asks `hasSession` and starts nothing; the first turn resumes, and a session lost at a turn falls back there, its marker after the learner's message. `resumeFailed` and "Start fresh instead" are gone; the outline's Start fresh leaves a resume that keeps failing. Tests use `createFakeTimer` (`engine/fake-timer.ts`). Idle closing was not run on Claude end to end. |
| 2.15a | Idle-session review fixes | Claude lookup uses the same sanitized configuration root as startup; inherited `CLAUDE_CONFIG_DIR` adds a short Node lookup subprocess, never a model request. Intake initialization survives a failed or stopped startup. Lost-session markers identify their learner message, so queued messages and transcript replay partition correctly; non-message turns move none. |
| 2.16a | Feedback turn after an answer | The turn after a graded answer is for feedback alone (`ask_question` refused); the engine then sends `nextQuestionTurn`, or closes the segment when the check is done: `close_segment` is gone, and a unit reopened in a done check closes it as it opens. A queued turn can `skip()`; `settled()` waits for turns sent from a turn's end. A restart between an answer and the next question still waits on a learner message. |
| 2.16 | Tutor prompt | `prompts/tutor.md`: headers and refusals, the rhythm, teaching 250 to 400 words (never over 600), feedback under 100 words in its own turn, lead-ins that help with nothing, questions and rubrics for the grader, help, the default style that `style.md` adjusts, `$` math. Sonnet 5.5 met the check over two segments. Choice order is 2.17's; a wrong key cannot be undone until disputes (stage 3). |
| 2.17 | Shuffle the choices | The engine shuffles a choice question's choices when it is posted and moves the answer letter with them (`engine/choice-order.ts`); everything after sees the stored order, and `ask_question`'s reply lists it for the tutor. Tests pass `order: givenOrder` to `createUnitChats`. The scripted tutor's right choice is the sum it asks for, at any letter. |
| 2.17a | Feedback queue review fixes | Questions are blocked from when feedback is queued until it ends, including in earlier learner replies; their headers say feedback is pending. Stop cancels the automatic next question across intervening replies, and a later learner message can post one. |
| 2.18 | Thread separators and the pinned question | `divided` and `openQuestion` in `src/web/session.ts`. The open question sits above the message box with the next-step control until graded or withdrawn; the latest question, answered after the thread went on, moves to the end (`moved`), leaving an `answered-below` line (`timeline.ts`). 2.21's notice goes on the message box while `openQuestion` is set. |
| 2.19 | Strict passing and no question limit | Passing needs, since the last miss, an unassisted answer at 90% or 100%, and a second correct one to a different question if ever missed (`record/status.ts`). No limit: an objective is done in a check only once passed (`engine/check-rules.ts`); reasons for another question are `missed`, `assisted`, `unconfident` and `confirm`, and the header counts "(N asked)", which `scripted.ts` reads. Records are not migrated. |
| 2.20 | Detour after a miss | A miss closes its question into a detour kept in the position (`detour` in `state.ts`); its first turn replaces the feedback (`detourOpening` in `unit-turns.ts`), teaching again from the objective's second miss in the check (`missed` in `check-rules.ts`); no question until the learner's "Ready for another question" (`anotherQuestion`, route `another-question`), which sends `nextQuestionTurn`. Page events `detour` and `detour_end`. "I don't know" carries an optional `stuck` line. Messages in a detour are not help, since no question is open: 2.21 judges only messages during an open question. |
| 2.20a | Detour queue review fix | Ending a detour uses `askNext` too: a newer question (open or already answered) or Stop skips its stale queued request. Three deterministic regressions failed before the fix and pass after it. |
| 2.21 | Help judge | After each reply to a message the tutor received while a question waited for its answer, a one-shot call on Haiku 5.5 (`engine/help-judge.ts`, `prompts/help-judge.md`, `JUDGE_MODEL`) returns clarification or help; help or a failed call marks the question `assisted`. Pending calls are `judging` on the open question; an answer sent meanwhile is kept (`OpenQuestion.answer` now takes any answer) and graded once they are in; a restart counts cut-off calls as help. The page shows the call under the reply and a notice above the message box (`helpNotice`, `judgmentSays`). Re-run `node scripts/judge-set.ts --runs 2` when the prompt, `HelpJudgment` or the model changes. |
| 2.21a | Help-judge review fixes | Shutdown leaves unjudged exchanges and waiting answers for reopening; new judging calls and queued results are ignored after close. Clarification labels describe only that reply, never promise the answer still counts after earlier help. Five regression cases failed before the fix and passed after; the fake-backend browser flow and `mise run check` passed. |
| 2.22 | Planning conversation and background note | `propose_curriculum` is refused in the intake's opening turn; asking to go ahead is `planner.md`'s. `BackgroundNote` (`src/shared/curriculum.ts`) is required in the proposal, stored as `background.md` (`readBackground`), checked at approval, shown on the card, and given to the unit planner's turn and the tutor's system prompt ("# The learner"); courses from before have none and both are told so. The scripted intake asks first, so a browser check takes two messages to reach a card. Sonnet 5.5 asked before proposing and proposed one unit in two real runs. Not run on a model: the planner and tutor using the note. |
| 2.22a | Intake review fixes | The review and message headers name both notes. A session lost before any proposal gets the conversation so far (`conversationBefore` in `engine/intake.ts`: the learner's earlier messages and the planner's replies, as JSON). The account's email still reaches every Claude session: `CLAUDE_CODE_DISABLE_ATTACHMENTS` leaves it, and bare mode drops it but is off the plan login; nothing changed in the backend. Look again with stage 3's built-in tools or a newer SDK. |
| 2.23 | Passing without a confident answer | Since the last miss, unassisted correct answers to two different questions pass at any confidence, or one at 90% or 100% if never missed (`record/status.ts`); help neither counts nor breaks the row. Reasons for another question are `missed`, `assisted` and `second` (`engine/check-rules.ts`). Status is derived, so old records take the rule when read. |

## Stage 2: session engine

Broken down in task 2.0. The scope is `architecture.md` section 12's: unit
planning, segment phases, multiple-choice and rubric-graded questions,
confidence, evidence, derived status, override, resume, transcripts and
math rendering. The choices behind the breakdown are in `docs/decisions.md`
under "Stage 2 breakdown". Not in this stage: the symbolic math check, code
questions, artifacts and disputes (stage 3); sources (stage 4); the
misconception record of detours, the unit gate, testing out of a unit,
review questions, handoff notes, unit notes, transcript export and style
changes (stage 5); detours themselves came in task 2.20. A unit in this
stage closes without a gate or notes.

**User check:** complete one unit of a math course across two sittings,
stopping in the middle of a segment. Start a new course, so that the
intake (2.22) is tried too.

Passed: the user tried it again on 2026-11-17, after tasks 2.18 to 2.22
("everything went smoothly"), with nothing to change. Stage 2 is finished.

**Added after the user check**, from a review of the stage 2 record, which
the user brought on 2026-11-17 (`decisions.md`, "Stage 2 review"). These
tasks come before stage 3.

### 2.24 One idea per objective, no quotes from memory

- Status: todo
- Depends on: stage 2
- Why: each theology objective joined three ideas ("explain …, and
  contrast with … and with …"), so every written question was a
  three-part essay graded all or nothing. The teaching quoted Basil,
  Lossky, _Dei Verbum_ and _Lumen Gentium_ from the model's memory, and
  questions built on the quotes. The learner sent no message in either
  sitting, so their first attempt after the teaching was graded.
- Do: `unit-planner.md`: each objective states one idea, and a contrast is
  an objective of its own. `planner.md`: unit goals narrow enough for three
  to six such objectives. `tutor.md`: a question asks for one thing; in a
  course with no source, paraphrase and attribute ("Basil argues that …"),
  quoting nothing verbatim unless it can be checked, and build no question
  on a quote's exact wording; teaching ends by offering one ungraded "try
  this" for the discussion, which the check does not repeat.
- Done when: a real run on Sonnet 5.5 (the result depends on the model's
  judgment), on a scratch data root, kept short: a new course on a topic
  with contrasts, its first unit's plan, the first segment's teaching and
  one check question. Each objective states one idea; the teaching
  attributes without verbatim quotes and ends with an ungraded try; the
  question asks one thing. `mise run check` passes.

### 2.25 Backup of the data root

- Status: todo
- Depends on: stage 2
- Why: everything durable is in the data root, which keeps no history, so
  an engine bug that writes valid but wrong data could not be undone.
- Do: the server makes the data root a git repository if it is not one,
  tracking `courses/` and `profile.md` and ignoring the record's temporary
  files and `intake/`, and commits after each segment close, unit close and
  curriculum approval, once that step's writes have landed, with a message
  naming the course and the step. A failed commit is logged and never fails
  the engine; with no `git` on the path, the server says so once at start.
  On for `pnpm dev`; off in tests and `pnpm dev:fake` unless asked. It runs
  the `git` already installed; no package is added.
- Done when: tests on a temporary data root show a commit after each of
  the three steps, holding the record's files and none of the temporary
  ones, and an engine that keeps working when the commit fails; `mise run
  check` passes; on `pnpm dev:fake` with the backup on and a scratch root,
  `git log` there shows a segment's commit.

### 2.26 What I know

- Status: todo
- Depends on: 2.23
- Why: the record of what the learner has mastered is never shown. The
  course view lists units and the session shows segment ticks; an
  override after three correct answers looks the same as one after none.
- Do: a view per course, reached from the course view: each planned unit's
  objectives with their status, and under each its evidence in log order:
  the question, the answer (or "I don't know" and where the learner got
  stuck), confidence, help, the grade with a written answer's flaw, and
  the date; overrides as lines of their own. A route under
  `/api/courses/<id>/` sends it, its body a schema in `src/shared/`.
  Stage 3's disputes will be raised from past answers here.
- Done when: route tests on a hand-made record covering each kind of entry,
  and page logic tests, pass; `mise run check` passes; on `pnpm dev:fake`
  the view shows a seeded course's objectives and answers, and the browser
  is closed before the server stops.

### 2.27 Calibration

- Status: todo
- Depends on: 2.23, 2.26
- Why: confidence was kept as percentages to allow calibration feedback
  (brief, "Decision status"), and nothing builds it. With 2.23 confidence
  no longer gates passing, so it says how sure the learner really was.
- Do: across all courses, for each confidence level, how many unassisted
  graded answers were correct, as counts ("90%: 8 of 10"), with "I don't
  know" counted apart and answers with help left out; shown on the
  library. Decide whether answers given before 2.23 count, and record why.
- Done when: hand-worked counting tests pass (each level, help left out,
  "I don't know" apart, a course whose evidence cannot be read skipped);
  `mise run check` passes; on `pnpm dev:fake` the library shows the seeded
  courses' counts, and the browser is closed before the server stops.

**User check for 2.23 to 2.27:** open "What I know" on the theology course
and the calibration counts on the library; then start a new unit and see
single-idea objectives, attributed paraphrase instead of quotes, a try
offered in the discussion, and an objective passed by two unsure correct
answers.

## Stage 3: checked grading and aids

### 3.0 Break down the stage

- Status: todo
- Depends on: stage 2, and tasks 2.23 to 2.27 with their user check
- Note: a dispute can be raised on a past answer in "What I know" (2.26) as
  well as in the session.

**User check:** a coding unit and a computational math unit are graded by
tests and the symbolic check, and an artifact appears in the side pane.

## Stage 5: mastery loop (built before stage 4)

### 5.0 Break down the stage

- Status: todo
- Depends on: stage 3
- Note: built before sources, by the user's choice (`decisions.md`,
  "Stage 2 review"). The breakdown must settle:
  - review questions at the start of each sitting: two or three on
    objectives passed in earlier sittings, those passed with the least
    confidence first, fresh questions each time, on by default and
    skippable in any sitting. They and the unit gate share one mechanism,
    questions without teaching over objectives the engine picks
    (architecture section 4's examiner prompt);
  - retained and slipping status, from review and the gate;
  - testing out of a unit, which replaces the baseline: the unit's gate
    taken before it is taught, once the unit is planned (objectives exist
    only then), and how a partial result shortens the unit;
  - the misconception record (`misconceptions.jsonl`) from detours (task
    2.20) and what reads it;
  - the learner profile (`profile.md`, architecture section 3), which no
    stage had listed: what it holds beside the background note (task
    2.22), and who writes it when.

**User check:** one course runs from intake to a closed second unit: a unit
tested out of or started, review questions at the start of a later sitting,
a detour, a unit gate, generated notes and an exported transcript.

## Stage 4: sources (built after stage 5)

### 4.0 Break down the stage

- Status: todo
- Depends on: stage 5
- Note: source page images stay out of the backup (task 2.25). Until this
  stage a course quotes nothing verbatim from memory (task 2.24); with a
  source, `quote_source` verifies quotes.
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

## Stage 6: later

Codex backend, self-test, cheat sheets, photo input; starred messages for
the notes, if the generated notes miss what the learner wants kept. Each is
planned when chosen. Review mode and finals are gone: review opens each
sitting (stage 5), and finals were dropped (`decisions.md`, "Stage 2
review").
