# Gauss: architecture

How the system works now. `brief.md` defines the terms used here (course,
unit, objective, segment, session, evidence, detour) and what the product
must do; `decisions.md` holds why things are as they are. Where this
document and the code disagree, the code is right and this document is
out of date: fix it.

## 1. Shape of the system

One local Node process serves a web page and drives an agent backend.

```
browser (React)  <--SSE / POST-->  server (Node, TypeScript)
                                     |-- session engine   phase rules, grading dispatch
                                     |-- course record    files under the data root
                                     |-- teaching tools   the only way the tutor changes the record
                                     |-- backend adapter  Claude Agent SDK now, Codex later
                                     '-- Python helpers   document conversion, symbolic math (via uv)
```

Three rules hold the design together:

1. **The record is the source of truth.** Chats are rebuilt from it. Nothing
   that matters lives only in a model's context.
2. **The tutor changes the record only through teaching tools.** The server
   validates every call against the current phase, so the teaching rhythm is
   enforced by code and not by the prompt.
3. **The backend is replaceable.** The engine talks to an adapter interface
   and never imports an SDK directly.

## 2. Repository layout

A single package. The server and the page share type definitions, which is
the reason for using one language.

```
Gauss/
  docs/                 brief.md, architecture.md, decisions.md, plan.md; prototype/ (the page mocks)
  prompts/              tutor.md, planner.md, unit-planner.md, grader.md, help-judge.md, dispute-judge.md; later handoff.md, notes.md
  src/
    shared/             zod schemas: record files, questions, events, route bodies
    server/
      main.ts, serve.ts the real server's start, and the wiring it shares with the dev server
      open-file.ts      the system's opener, for "Open" on a code question's files
      record/           read/write course files; derive status, progress, "what I know"; the backup
      engine/           the chats, phase and check rules, turn texts, grading, help-judge and dispute dispatch, the sandbox for commands
      tools/            teaching tool definitions (transport-free functions)
      backends/         adapter interface, claude.ts, fake.ts (tests), scripted.ts (the dev server with no model)
      http/             routes, event stream
      sources/          (stage 4) ingestion, quote verification
    web/                React app: library, intake, course, session, "what I know"
  pytools/              sandbox_exec.py (Linux workload filter), mathcheck.py; (stage 4) convert.py
  scripts/              dev-fake.ts (no model); grade-set.ts, judge-set.ts and decide-set.ts with their sets (real model)
  mise.toml             pinned node, pnpm, python, uv
```

Dependencies, kept few: `@anthropic-ai/claude-agent-sdk`, `zod` (the SDK's
tool helper requires it), Hono with `@hono/node-server`, React with Vite,
KaTeX, react-markdown with remark-gfm, remark-math and rehype-katex, Vitest,
Biome; `@anthropic-ai/sandbox-runtime`, the runtime developed for Claude
Code's sandbox, which runs the engine's commands and on Linux needs `bwrap`,
`socat` and `rg` on the machine. Python side:
SymPy, with `antlr4-python3-runtime` 4.11 for its LaTeX parser, and a PDF
and an EPUB converter chosen in stage 4. The curriculum diagram is laid out
by the page itself (`src/web/diagram.ts`), not by a diagram library.

## 3. Data on disk

Course data lives outside the repository so the code can be published
without books, transcripts or progress. The data root is `GAUSS_DATA_ROOT`,
or `~/gauss/`; only `main.ts` reads the environment, and the record module
(`src/server/record/`) takes the root as an argument.

```
<data root>/
  .git/, .gitignore               the record's history: commits after each segment close, unit end and approval
  profile.md                      (stage 5) learner profile: free text the learner approves
  intake/                         where intakes' sessions run, so they can be kept; Gauss writes nothing in it
  cache/package-uv/               uv's install cache; outside the record and its history
  courses/<course-id>/
    course.json                   title, backend, settings, dates, when each unit was last opened
    style.md                      the course's style note, proposed and approved with the curriculum
    background.md                 the background note: what the learner told the planner, approved with the curriculum
    curriculum.json               units, prerequisites, goals; each unit's plan (objectives, segments) once it starts
    state.json                    a position for each unit in progress
    evidence.jsonl                append-only: answers (with the assessment each was given in), grades, confidence, overrides, disputes with their outcomes
    misconceptions.jsonl          (stage 5) append-only: findings from detours and discussions
    units/<unit-id>/handoff.md    (stage 5) the unit's handoff note, rewritten when a segment closes
    sessions/<unit-id>.<n>.jsonl  transcript of a unit's session n: its page events
    sources/<source-id>/          (stage 4) original file, outline.json, sections/*.md, pages/
    artifacts/                    HTML aids the tutor shows, written by the engine: <n>-<title>.html, never overwritten
    notes/                        (stage 5) each unit's notes: the HTML page the notes writer wrote, as the engine finished it
    packages/                     Gauss's uv project and lockfile; never taken from the workspace
    .package-install.tmp/         pending environment rollback or a committed install receipt
    workspace/                    the tutor's working folder: starter code, the learner's work and the installed .venv/
```

The shapes are the schemas in `src/shared/`: `course.ts`, `curriculum.ts`
(a unit's plan in `plan.ts`), `state.ts`, `evidence.ts`. A course id is its
folder's name, made from its title; unit and objective ids are slugs, and
objective ids are unique in the course, because the evidence names an
objective by its id alone. A curriculum is a draft until the learner
approves it. A course exists from its first proposal. No file has a schema
version: a field added later must be optional.

- **Derived, never stored**: objective status (not started, attempted,
  passed, retained, slipping, overridden), from `evidence.jsonl` by the
  pure functions in `record/status.ts`; a unit's status from its
  objectives', where a unit with a position in `state.json` is in
  progress; where a course stands and whether it is a one-off (a course
  of one unit); each unit's progress for the library, with how many of a
  finished unit's objectives are retained and slipping
  (`record/progress.ts`); and "what I know" with its calibration counts
  (`record/what-i-know.ts`, `record/calibration.ts`). The rules for passing
  and help are in section 4; the reasons in `decisions.md`, "Objective
  status". A disputed answer counts with its dispute's verdict, where the
  answer stands in the log; its own line keeps the first grade
  (`record/disputes.ts`, which status, the check rules and calibration
  read the log through).
- **`state.json`** holds a position for each unit in progress, not one
  current unit: several units can be in progress at once. A position
  holds the segment, the phase, where the check began (`checkFrom`), the
  open question (with its kept answer and the exchanges awaiting the help
  judge), an open detour, the extra segment that goes over objectives
  again, the tutor's session id, and the tutor's request to install
  packages while it waits for the learner. Completed package cards are
  kept separately from positions in the same file, so their outcomes
  survive even if a transcript line is lost or a unit finishes. Before
  the first unit exposes the workspace, the course rolls back an
  interrupted install or saves its committed receipt without rerunning uv.
  The journal is kept until the result is saved. Changes are written
  before the page hears of them.
- **Writes.** Every file but the logs is written whole: to a temporary file
  in its folder, flushed, then renamed over it. The logs (evidence,
  misconceptions, transcripts) are appended a line at a time; an entry
  counts once its line ends, reading skips an unfinished last line, and the
  next append clears it first. Each read-and-write-back and each append
  waits for the work on that file before it (`record/file-lock.ts`). A file
  that cannot be read is an error naming the file, except that the library
  lists such a course with the reason, and a transcript line that cannot be
  read is left out. Transcripts are not flushed to disk.
- **Backup.** The data root is a git repository (`record/backup.ts`), made
  on the first start if it is not one, with a `.gitignore` that keeps
  `courses/` and `profile.md`, the learner's files in workspaces with
  them, and leaves out `.venv/` and Python's caches. The engine asks for a commit once a
  segment's close, a unit's end or an approval is written; commits run in
  the background, one at a time, by "Gauss", and a failure is logged and
  never fails the engine. On for `pnpm dev` unless `GAUSS_BACKUP=off`; off
  for `pnpm dev:fake` unless `=on`; tests pass it in.

## 4. Session engine

### Chats and resume

Every chat is built on `engine/conversation.ts`: an event log the page
replays, and a turn queue that sends one turn at a time. A turn's text is
composed when it is sent, so its header says how things stand then; a
turn can run work when it ends, and a queued turn can be skipped when its
time comes. Stop applies to the turn in progress from the moment it starts,
also before it reaches the backend.

- **The intake chat** (`engine/intake.ts`) has no unit. The page asks the
  opening question, so the session starts with the learner's answer.
  `propose_curriculum` is refused in the turn that delivers the learner's
  first message, so the learner answers the planner once before a card
  appears. The first proposal creates the course; each proposal replaces the
  draft with its style note and background note, and a reply to one is a
  change request. Approval is refused while a turn is queued or running,
  and names the proposal the card shows; the record refuses it
  (`DraftMismatch`) unless the files on disk are that proposal. Approval
  ends the intake and closes its session; the planner is not told. Intakes are kept in memory: a restart
  loses one in progress, and its draft is reviewed in a new intake that
  starts from the stored draft (`POST /api/courses/<id>/review`).
- **Unit planning** (`engine/unit-planning.ts`). A unit without a plan is
  planned when it is opened, in a session of its own: one turn with the
  background note, the curriculum and the status of every objective planned
  so far, the `plan_unit` tool, then it closes. A session that ends without
  a plan is tried once more, told why; then the unit reports that it could
  not be planned.
- **The unit chat** (`engine/unit-chat.ts`), one per unit, kept in memory
  until the server stops. It holds the phase rules, the teaching tools and
  the learner's actions, and owns the unit's one queue, through which every
  change to the unit goes. It coordinates `engine/unit-record.ts`, which
  keeps the position and evidence and writes each change before the page
  hears of it, and `engine/unit-agents.ts`, which runs the tutor, the grader
  and the help judge. Opening a unit not in progress plans it if needed,
  writes its position (segment 1, teach) and sends the teaching turn;
  opening one in progress picks it up where `state.json` has it. Opening a
  unit marks it opened in `course.json`. A unit reopened in teach is taught
  again.
- **Kept sessions and resume.** A tutor's session and an intake's are kept
  by the backend and resumed by id, in the folder they ran in (the course's
  `workspace/`, made when a unit first opens, or the data root's
  `intake/`); the tutor's id is in the unit's position.
  Opening a unit only asks the backend whether the session is still there
  (`hasSession`); the first turn resumes it. The system prompt is sent
  afresh on every request, so a resumed session gets the current prompt.
- **Idle sessions.** A kept session is closed after ten minutes (`IDLE_MS`)
  with no turn queued or running and nothing waiting to send it a turn (a
  grading); the next turn resumes it.
- **Start fresh.** The learner can start a new tutor session from the unit's
  outline: the old one is closed and its id taken out of the position, and
  the new session gets one turn to pick up where the unit stands. A session
  the backend cannot find (a deleted file, or Claude Code's 30-day sweep)
  falls back the same way, but sends nothing until the learner acts. Either
  way the new session's system prompt is the seed from the record (section
  9), its first header says it is new, and the page shows a "Fresh start"
  marker and dims the conversation before it, except a card that still
  waits (an open question, the closing card). A resume that fails another
  way fails that turn, and the next turn tries again.
- **Sessions and transcripts** (`engine/transcript.ts`). A session is one
  sitting in a unit. One starts when the unit's chat opens (once per server
  run) and when something happens after an hour quiet, never inside a
  tutor's turn. Each session's page events go to its transcript. A unit
  chat's log starts with its earlier sessions' transcripts, so the thread
  survives restarts; the page marks each later session, and does not show
  twice what the reopened chat repeats. Intakes have no transcripts.

### Phases

Per segment: `teach -> discuss -> check -> closed`. Inside the check, every
miss opens a detour: a pause in which the tutor finds the learner's
confusion and works through it with them, until the learner asks for
another question. The check's next question is the detour's re-check.

| Transition | Triggered by | Engine rule |
| --- | --- | --- |
| teach to discuss | the teaching turn ends, however it ends | automatic |
| discuss to check | the learner presses "ready" | `ask_question` is refused before this |
| check to detour | a miss: a wrong answer or "I don't know" | the missed question closes into a detour in the same write |
| detour to check | the learner presses "Ready for another question" | the engine asks the tutor for the next question |
| check to closed | the feedback on the answer that leaves every objective done ends | automatic, also when the feedback is stopped or fails |
| discuss, check or detour to closed | the learner moves on | an override of the segment's objectives; an open question is withdrawn |
| closed to the next segment's teach | the learner starts it | none after the unit's last segment |
| last segment closed to the unit's end | automatic | the closing card; when every objective passed, the unit is passed and leaves `state.json` |
| unit's end to one more segment | the learner goes over the objectives not passed | a segment after the plan's last, on those objectives, kept in the position |
| unit's end to finished | the learner moves on without them | an override of the objectives not passed; the unit leaves `state.json` |

The rules:

- **Passing** (`record/status.ts`). Since its last miss, an objective
  passes with unassisted correct answers to two different questions, at
  any confidence, or with one at 90% or 100% if it was never missed. A
  miss clears the correct answers before it. An answer given with help
  counts for nothing and clears nothing. Questions differ when what the
  learner saw differs. An override marks an objective overridden but never
  takes away a pass, and a later answer takes the override's place. The
  log's order decides, not timestamps.
- **Retained and slipping** (`record/status.ts`). An answer given in an
  assessment names it (`review`, `gate` or `test-out`, and the unit whose
  thread held it); an answer in a segment's check names none. A passed objective
  is retained once, since its last miss, it has an unassisted correct
  answer given in a review or a gate. A passed objective missed in a
  review or a gate is slipping until it passes again; slipping is not
  passed, so a check or the closing card treats it as an objective not
  passed, but a finished unit with slipping objectives stays finished.
  An override marks a slipping objective overridden. A miss while testing
  out is no miss: it counts as an answer and clears nothing.
- **How many questions** (`engine/check-rules.ts`). Each objective of the
  segment gets at least one question in the check, and is done only once
  it has passed; there is no limit. The check's answers come from the
  evidence after `checkFrom`, excluding answers given in an assessment.
  The tutor's header says, for each objective, why another question is
  needed (`missed`, `assisted`, `second`) and how many were asked.
- **The tutor's tools are refused out of phase**, with a reason it can act
  on: `ask_question` outside the check, in a detour, while feedback is
  pending, while a question is open, on an objective not in the segment
  or already done in this check, and once the unit is finished. Its file
  writes and commands (section 5) are refused while a question is open;
  `show_artifact` is refused while a question of its unit is open or its
  unit is finished;
  `install_packages` while a question of the course is open or another
  request of the course waits. A refusal does not
  end the turn; a posted question does.
- **Feedback, then the next question.** The turn after a graded correct
  answer is for feedback alone; no tool may be called in it, and
  questions are refused from when it is queued until it ends. When it
  ends, the segment closes if every objective is done; otherwise the
  engine sends a turn asking for a lead-in and the next question
  (`nextQuestionTurn` in `unit-turns.ts`). That turn is skipped if a
  reply to a learner message has posted a question meanwhile, or the
  learner pressed Stop.
- **Detours.** The detour is kept in the position, so a restart reopens it.
  Its first turn takes the feedback's place: the right answer and why, then
  where the confusion is (from the choice picked, the grader's flaw, the
  learner's reasoning or where they said they got stuck, or else by asking),
  worked through with the learner; from the objective's second miss in the
  check, the objective taught again another way. In a detour no question is
  posted and messages are not help. "I don't know" can carry a line on
  where the learner got stuck (`stuck`).
- **Help** (`engine/help-judge.ts`). A learner message the tutor receives
  while a question waits for its answer starts an exchange, kept on the
  open question. When the tutor's reply ends, a separate one-shot call, the
  help judge (section 6), decides clarification (only what the question
  asks: its wording, notation, the form of answer wanted, or nothing toward
  the answer) or help (anything toward the answer). Help, or a call that
  fails, marks the question assisted; the tutor's header then says the
  answer will not count. A reply with no text is not judged. An answer sent
  while an exchange is unjudged is kept and graded once the calls are in; a
  restart counts unjudged exchanges as help.
- **Written, math and code answers.** A written, math or code answer is
  final once sent. A code answer is the learner's files as they are when
  "Run the tests" is pressed, read from the workspace; a file missing, a
  link, over 100 KB or not UTF-8 refuses the press, and nothing is
  recorded. The answer is kept on the open question, then graded outside
  the chat's queue (section 6), so messages and turns go on meanwhile;
  until its grade is recorded, another answer and moving on are refused. A
  failed grading is shown, and the answer is graded again as sent when the
  learner asks or the unit reopens. A choice is graded, and "I don't know"
  recorded, at once.
- **A question has one answer.** An open question whose answer the evidence
  already holds (by `questionId`) is closed with that answer, never graded
  or recorded again.
- **Disputes** (section 6) change no phase. Where the check rules would
  decide next, they decide with the corrected verdict: ending a detour
  closes the segment if nothing is left to ask, a check with no question
  open, no detour and no feedback to come closes if nothing is left, and
  the closing card is shown again with the statuses as they now are (the
  unit finishes if every objective passed). A dispute that takes the pass
  from an objective of a finished unit records that objective as
  overridden with it, so the unit stays finished. The tutor of a unit in
  progress is told the outcome in its next header (`disputeNote` in
  `unit-turns.ts`).
- **The learner's steps wait for the tutor**: "ready", moving on, the next
  segment, "another question", Start fresh and the closing card's steps are
  refused while the tutor is writing; Stop is always there. Answers and
  messages are taken at any time.
- **Moving on sends the tutor nothing.** The next turn's header says the
  learner moved on, and which question was withdrawn.
- **A finished unit is not started again.** Opening one shows it finished;
  one reopened at its closing card shows the card again.
- **Order of writes.** Every change is written to `state.json` before the
  page hears of it; an answer is appended to the evidence before its
  question is closed, so a crash between the two leaves the question open
  with its answer kept.

### Turn protocol

The engine composes every message the tutor receives: a short header (unit,
segment, phase, what is allowed now, what happened that the tutor has not
been told, and in a source course the segment's sections), followed by the
learner's text or an event. An answer's turn repeats the question with its
choices, the learner's answer, confidence, reasoning and the grade. A turn
that allows a question lists, for each objective it may be on, the
questions the evidence holds on it, the latest six, so a question is
fresh even in a new tutor session. The
wording is in `engine/unit-turns.ts` for unit chats, `engine/intake.ts` and
`engine/unit-planning.ts`; the scripted backend reads it, so rewording a
header can break `pnpm dev:fake`, and its tests then fail.

### Question flow

Questions do not block a tool call while the learner thinks, because tool
calls have time limits and a learner may take twenty minutes or close the
tab.

1. The tutor calls `ask_question` with the objective, the prompt, the
   answer kind, and the grading material: an answer letter, an expected
   expression with a math grading policy, or a rubric. For symbolic grading,
   the expected expression must read or the question is refused. For code,
   the tutor supplies the files the learner edits (with starter versions
   already in the workspace), the tests, solution, command, and any
   workspace dependencies the tests or learner's code need. The engine runs the
   tests on the starter files and on the solution, and refuses the question
   unless they fail on the first and pass on the second (section 6).
   Stop cancels posting during validation; for code it also stops the runs
   before releasing the course workspace queue.
2. The engine stores the open question in `state.json` and the page shows
   it. A choice question's choices are shuffled first and the answer letter
   moved with them (`engine/choice-order.ts`); the tool's reply lists them
   as shown. Grading material never reaches the page. The engine ends the
   tutor's turn itself.
3. The learner submits an answer (a choice, an expression typed in the math
   field, a written answer, or "Run the tests" on a code question's files),
   a confidence level and, for a choice or an expression, optional
   reasoning, or "I don't know".
4. The engine grades it (section 6) and appends the evidence.
5. The tutor gets the result as the next turn: feedback, or a detour's
   first turn after a miss (above).

Assessments (the unit gate, testing out of a unit, and the review questions
that open a sitting; stage 5) reuse this flow in the unit's thread, asked
by the unit's tutor over objectives the engine selects (`decisions.md`,
"Mastery loop"). Which ones review asks, and the gate asks of other units,
is `pickForReview` in `record/review.ts`: passed, retained and slipping
objectives not answered within the hour, slipping first.

## 5. Teaching tools

Defined once as plain functions over the record and engine
(`src/server/tools/`), then bound to each backend: for Claude an in-process
tool server, for Codex an MCP server.

| Tool | Effect |
| --- | --- |
| `propose_curriculum` | Stores a draft curriculum with its style note and background note and shows them for review; approval covers all three. Refused in the intake's first turn |
| `plan_unit` | Sets the unit's objectives and segments, in its planning session |
| `ask_question` | Posts a question on an objective of the segment, in the check: `choice` with an answer letter, `math` with an expected expression and grading policy, `written` with a rubric, or `code` with the files the learner edits, the tests, the solution and the command (`QuestionInput` in `src/shared/question.ts`) |
| `amend_curriculum` | (stage 5) Proposes a change; applied only after the learner confirms |
| `quote_source` | (stage 4) Returns a verified quote block, or an error if the text is not in the source |
| `install_packages` | Asks the learner to approve Python packages with optional version ranges (`PackagesInput` in `src/shared/packages.ts`). Install runs the command on the card in the engine's sandbox, with access to PyPI and a fresh workspace `.venv`; the previous environment is restored if the install fails. The course's workspace is closed to tutor mutations and new questions while it runs. Refused while a question of the course is open or another request waits. Does not end the turn |
| `show_artifact` | Shows an HTML aid, given whole in the call (`ArtifactInput` in `src/shared/artifact.ts`), in the side pane; the engine writes it to `artifacts/` under a new number, and the thread keeps a reference to it. Refused over 100 KB and for a document that names an address on the web. Does not end the turn |
| `propose_style` | (stage 5) Proposes a change to `style.md`; applied only after the learner confirms |

The learner starts segments and the engine closes them, so there is no tool
for either; detours are opened by the engine and ended by the learner.

The tutor also has Claude Code's file and shell tools (`Read`, `Glob`,
`Grep`, `Write`, `Edit`, `Bash`) when the engine's sandbox can run (the
check `serve.ts` makes at start; otherwise it has no built-in tools), with
the course's `workspace/` as its working folder. Its file tools write only
there, its commands run in a sandbox with no network that writes only there
and in a temporary folder of the course's, and the record, outside the
workspace, is closed to its writes (`decisions.md`, "Confinement"). An open
question in any unit of a course blocks every tutor's workspace changes,
including after restart. Commands run in the foreground, and posting a
question is refused while a write or command still runs. Reads stay allowed.
Web search, where a course allows it, comes
with sources (stage 4).

## 6. Grading

| Answer kind | Method | Notes |
| --- | --- | --- |
| Multiple choice | Exact match in the engine | Reasoning is passed to the tutor for feedback |
| Computational math | The symbolic check (`pytools/mathcheck.py`) for questions declared unrestricted; otherwise the grader | An unreadable or undecided answer, failed check, or time-out also goes to the grader. The evidence keeps why (`unsettled`) |
| Code | Runs the question's tests with their command on the learner's files as sent, in the engine's sandbox; exit status 0 is correct | The tests must fail on the starter files and pass on the solution for the question to be posted. The learner sees the end of their output once graded, never the tests |
| Proof, explanation, reconstruction | A separate one-shot model call, `prompts/grader.md` with the question's rubric | Names the first flawed step or missing element; never sees the tutor's conversation |

- **The grader** (`engine/grading.ts`) is one `oneShot` request (section 7):
  system prompt `grader.md`, and a message holding the question as the
  learner saw it, the rubric and the answer, each between tags, and nothing
  else. For a math answer the rubric uses the expected expression and
  gives priority to the prompt's constraints. The answer is the expression
  without the learner's reasoning. `WrittenGrade` (`src/shared/question.ts`)
  gives a correct or incorrect verdict with no partial credit, and the
  flaw when incorrect, which the evidence keeps. A reply out of shape,
  a failed request or one past three
  minutes is a failed grading. It runs on Claude Sonnet 5.5 (`GRADER_MODEL`
  in `backends/claude.ts`).
- **The help judge** (`engine/help-judge.ts`) is a one-shot request of the
  same kind: `help-judge.md`, and a message holding the question with its
  correct choice, expected answer, rubric, or tests and solution, the
  learner's message and the tutor's reply.
  The reply is `HelpJudgment`: a reason, never shown, then clarification or
  help. A reply out of shape, a failed request or one past two minutes
  counts as help. It runs on Claude Haiku 5.5 (`JUDGE_MODEL`).
- `GAUSS_CLAUDE_MODEL`, when set, replaces the grader's and the judges'
  models. Each was chosen on a hand-made set: re-run
  `node scripts/grade-set.ts --runs 2` when `grader.md`, `WrittenGrade` or
  `GRADER_MODEL` changes, `node scripts/judge-set.ts --runs 2` when
  `help-judge.md`, `HelpJudgment` or `JUDGE_MODEL` changes, and
  `node scripts/decide-set.ts --runs 2` when `dispute-judge.md`,
  `disputeRequest`, `DisputeJudgment` or `DISPUTE_MODEL` changes.
- **The symbolic check** (`pytools/mathcheck.py`; its header says what it
  reads, writes and counts as equal, and `decisions.md`, "Symbolic check",
  why) takes the expected expression and the answer as JSON, LaTeX or
  plain, and writes equivalent, different, unparsable (which side, and
  why), or undecided (read, but not proved within its limits). Sampling can
  find a counterexample but never certify equivalence. It reads plain
  input by rewriting it to LaTeX for SymPy's parser, so no input is
  evaluated as Python. Without an answer it only reads the expected side.
  It runs with the venv's own Python (`pytools/.venv/bin/python -I`), so
  a sandboxed run needs no uv cache. A comparison has an eight-second
  limit; the engine (`engine/math-check.ts`) gives the whole process,
  including parsing, 12 seconds, in the sandbox with nothing writable:
  it reads the expected expression before posting a question declared
  symbolic, and compares the expressions when grading it. Questions
  declared for the grader, or saved without a policy, skip the check.
  Without a sandbox, a new question must choose the grader.
- **Code questions** (`engine/code-run.ts`; why, `decisions.md`, "Code
  questions"). The engine saves the declared workspace dependencies in the
  question at posting. Each run uses a scratch folder containing the
  files under test (starter, solution, or the learner's saved answer), the
  tests, the frozen dependencies, and a read-only link to `.venv`. It does
  not link other workspace files. Both posting runs use the same inputs
  while holding the workspace queue.
  The sandbox distinguishes a test command's exit status from a launch or
  sandbox failure; the latter records no grade. A learner cannot submit
  without a sandbox; after an infrastructure failure the learner can retry
  a kept answer or move on with an override. Shutdown cancels runs and a kept
  answer is graded when the unit reopens. Each run has 60 seconds. The end of
  both output streams is evidence. A run past its limit fails the grading;
  past it again on the same files, the answer is a miss.
- **The engine's commands** (the symbolic check, a code question's tests)
  run text a model or the learner wrote, so each runs through
  `engine/sandbox.ts`, on `@anthropic-ai/sandbox-runtime`: no network,
  writes only to the folders the caller names and to the command's own
  `$TMPDIR`, removed when it ends, a time limit that stops the command with
  everything it started, and each decoded output stream kept within its byte
  limit. The sandbox and built-in tutor tools are Linux-only: the runtime
  contains descendants in a PID namespace. `pytools/sandbox_exec.py` adds
  an inherited seccomp filter to commands (engine and tutor), using the
  project's venv Python, closing the runtime's Unix-socket route to host
  services. Reads and the server's
  environment are not confined (`decisions.md`, "Confinement"). The server
  starts the sandbox once (`serve.ts`) and probes both Unix-socket creation
  routes; when it cannot run safely, it says once what is missing, and
  nothing that needs it
  runs. Installing packages (section 5) runs there too, with the network
  open to the package index.
- **Disputes** (`engine/disputes.ts`; why, `decisions.md`, "Disputes").
  Any graded answer of the course can be disputed once, from its graded
  card in the session or from "What I know", in a finished unit too; not
  "I don't know". While disputing, the learner sees what the answer was
  graded by (`GradedBy` in `src/shared/dispute.ts`) and writes a reason,
  which is required. The dispute judge decides, outside every queue, and
  one dispute of an answer is decided at a time. Its outcome (`DisputeEvidence`
  in `src/shared/evidence.ts`) names the answer by `questionId` and holds
  the verdict the answer now counts with, the judge's reason, and a
  corrected choice key or expected expression, which shows wherever the
  first one did. It is written through the unit's chat when that is open,
  in its queue; otherwise directly, and the chat shows it, and tells the
  tutor, when it opens. The record refuses a second dispute of an answer
  as it appends (`appendDispute` in `record/data-root.ts`).
- **The dispute judge** (`engine/dispute-judge.ts`) is a one-shot request:
  `dispute-judge.md`, and a message holding the question as the learner saw
  it with its choices, how it was graded and what graded it (the key; the
  expected expression, with the rubric `mathRubric` makes when the evidence
  has `unsettled`; the rubric; the tests, frozen workspace inputs and
  command, not the solution), the answer with its reasoning, the grade with
  the flaw or the tests' output, and the learner's reason, each between
  tags; never the confidence or the conversation. `DisputeJudgment` gives
  a reason shown to the learner, the verdict, and for a choice question the
  right letter, from which its verdict must follow. A reply out of shape,
  a failed request or one past three minutes fails as the grader's does:
  nothing is recorded, the page shows why, and the learner can send the
  dispute again. It runs on Claude Sonnet 5.5 (`DISPUTE_MODEL`).

## 7. Backends

### Adapter

The code is the reference: `src/server/backends/backend.ts` and
`src/server/tools/tool.ts`.

```ts
interface TutorBackend {
  startSession(opts: SessionOptions): Promise<TutorSession>;  // system prompt, tools, cwd, workspace tools, resumeId, title; rejects with SessionNotFound
  hasSession(id: string, cwd: string): Promise<boolean>;      // a kept session is there, found without starting it
  oneShot<T>(req: OneShotRequest<T>): Promise<OneShotResult<T>>;  // system prompt, prompt, zod schema, signal
}
interface TutorSession {
  readonly backendSessionId: string;  // known from the start, before the first turn
  send(turn: EngineTurn): AsyncIterable<BackendEvent>;  // text pieces, tool calls, then one turn_end
  interrupt(): Promise<void>;
  close(): Promise<void>;
}
interface TeachingTool {
  name: string; description: string;
  inputShape: ZodRawShape;
  run(input: unknown): Promise<ToolResult>;  // validates, then runs; never throws
}
type ToolResult =
  | { status: "done"; text: string; endTurn?: boolean }
  | { status: "refused"; text: string };  // the reason goes back to the model
```

- A `done` result with `endTurn` ends the tutor's turn; a refused call never
  does, so the model sees why and can try again.
- `send` handles one turn at a time and never throws: a failure is a
  `turn_end` whose outcome is `error`. The outcomes are `done`,
  `ended_by_tool`, `interrupted` and `error`.
- `oneShot` is one request with its own system prompt, no tools, nothing
  before it and nothing kept after it. The reply is checked against the zod
  schema, so a reply not in shape is a failure. It never throws.
- A session given a working directory is kept and can be resumed by id in
  the same directory; one without (a unit's planning) is not kept. A kept
  session gets a `title`. `startSession` with a `resumeId` the backend
  cannot find rejects with `SessionNotFound`, the only failure the engine
  answers by starting fresh.
- The fake backend (`backends/fake.ts`) runs the real teaching tools and
  gives one-shot requests scripted replies, checked as the real backend
  checks its own; it keeps sessions in a set that backends can share, so a
  test's restart resumes them. The scripted backend (`backends/scripted.ts`)
  is the fake driven by the turn headers, for `pnpm dev:fake`.

### Claude

`backends/claude.ts`, on the Claude Agent SDK, signed in with the learner's
plan. The findings behind each option are in `decisions.md`, "Claude
backend".

- **Plan login, never an API key.** The SDK is given an environment without
  any `ANTHROPIC_` or `CLAUDE` variable: a key, a base URL or a token, or a
  cloud-provider switch, would take the session off the plan.
- **Isolation from the learner's own Claude Code**: `settingSources: []`,
  `skills: []`, `strictMcpConfig: true`, and
  `settings: { autoMemoryEnabled: false, disableClaudeAiConnectors: true }`.
  The account's email address still reaches every session; no option
  removes it.
- **Tools**: built-in tools named with `tools`, never `ToolSearch`: none,
  except for a session given workspace tools (a tutor's), which gets the
  file and shell tools with the options of `workspaceOptions` (`dontAsk`,
  one `Edit` allow rule for the working folder,
  `blockWritesOutsideWorkingDirectories`, the sandbox required with no
  network, and `CLAUDE_CODE_TMPDIR` a private folder per course under
  `/tmp`, made `0700` and checked; `decisions.md`, "Confinement"). A
  `PreToolUse` hook asks the engine before each `Write`, `Edit` and
  `Bash`, and its reason denies the call. A write is reported
  (`file_written`) once its tool result says it succeeded. The teaching
  tools are an in-process MCP server with `alwaysLoad: true`.
- **Ending the turn**: a `PostToolUse` hook stops the turn when a teaching
  tool returned `endTurn`, since the model does not reliably stop by
  itself.
- **Stop**: `interrupt()`, plus a `UserPromptSubmit` hook that stops a
  cancelled turn the SDK picks up later, and a second interrupt at the
  response's start for one that slipped past the hook. A stopped request
  may still have spent tokens.
- **Sessions**: one long-lived `query()` per session with a streamed prompt;
  the id is chosen up front (`sessionId`); resume passes `resume` alone, in
  the same `cwd`; the system prompt is
  `{ type: "custom", prompt, snapshot: false }`, so a resumed session uses
  the current one; `hasSession` reads the session file with
  `getSessionInfo`, starting no process.
- **One-shot**: a `query()` with a string prompt, no tools, the isolation
  options, and the SDK's structured output (`outputFormat` with a draft-7
  JSON Schema from `z.toJSONSchema`).

### Codex (stage 6)

Not built. The stage 0 spike showed it can run on the ChatGPT login with
teaching tools served over MCP, but the SDK does not stream text, reports
the thread id only with the first turn, and cannot keep the learner's own
Codex setup out (`decisions.md`, "Codex").

## 8. Sources

Planned for stage 4, not yet implemented (`decisions.md`, "Sources").

1. **Ingest** (`pytools/convert.py`): copy the original; convert to
   Markdown; build an outline from the headings or the table of contents;
   write one file per section, and `outline.json`, whose schema is written
   in stage 4.
   - The outline nests as the source does, to any depth. A **section** is a
     leaf of the outline and the only kind of entry with a file. Text
     between a heading and its first subheading is a section of its own.
   - Each section records where it sits in the original (a page range, or a
     paragraph range for formats without pages), for citations and page
     images.
   - A section has a size limit, below what one file read returns. A
     stretch over the limit with no headings is cut at paragraph boundaries
     into parts of roughly equal size, titled from its parent and position.
   - The same file and converter always give the same sections and ids.
2. **Map**: during curriculum planning each unit lists the sections it
   teaches. When the unit is planned, each segment names the sections it
   draws on.
3. **Plan**: the unit's planning session reads the unit's whole text, so
   the tutor's session starts from the stored plan rather than carrying the
   text from its first turn.
4. **Teach**: the engine names the current segment's sections in the turn
   header, and the tutor reads those files. It may read other sections when
   the discussion needs them, and requests a page image for a page whose
   text lost equations or figures.
5. **Quote**: `quote_source` checks the text against the source's whole
   text, its sections in order, after normalising whitespace and
   punctuation, so a quote across a cut still verifies. It returns the
   section and the page or paragraph, and the page links the quote to its
   place.

Scanned PDFs are detected and reported as needing text recognition; that
step is not in the first version.

## 9. Prompts

Kept as files in `prompts/`, each revised against real runs.

- `tutor.md` is the start of the tutor's system prompt, which
  `engine/unit-turns.ts` assembles: `tutor.md`, the course's units with
  their goals, the unit taught and its plan, "# The learner" with
  `background.md` (or a line saying none was recorded), then `style.md` (or
  a line saying to use `tutor.md`'s default style). Stage 5 adds the
  profile, the handoff notes of the unit's prerequisites and the open
  misconceptions on other units' objectives; the unit's own handoff note
  goes into a new session's first turn.
- `planner.md` drives the intake: its questions, asking to go ahead, and the
  proposal with its style and background notes.
- `unit-planner.md` drives a unit's planning session.
- `grader.md`, `help-judge.md` and `dispute-judge.md` are the one-shot
  calls of section 6.
- Later (stage 5): `handoff.md` for the call that writes handoff notes and
  finds misconceptions, and `notes.md` for unit notes. Assessments get a
  section of `tutor.md`, not a prompt of their own.

Model text is Markdown with `$` math: `$...$` inline, `$$` for display,
`\$` for a dollar sign; no `\(...\)`, HTML or images (section 10). Every
prompt that writes for the page must say so.

## 10. Page

`src/web/`, React built by Vite. Each view's logic sits in a tested pure
module beside it (`session.ts`, `timeline.ts`, `progress.ts`, `library.ts`,
`what-i-know.ts`, `diagram.ts`, `route.ts`); the components themselves have
no automated tests.

- **Library** (`/`): every course and one-off, with where it stands, a tick
  per unit, and when it was last opened; finished courses grouped at the
  bottom. Every row opens its course view.
- **Intake** (`/intakes/<id>`): the conversation, with each proposal as a
  card (units, "How I would teach it", "What the tutor will know about
  you", the diagram, Approve); a revision marks what changed.
- **Course** (`/courses/<id>`): a card at the top that leads to the unit in
  progress most recently opened, or else the next unit in order (the first
  not started whose prerequisites are finished); the unit list with each
  unit's status (under a finished unit's word, how many of its objectives
  are retained, in teal, and how many slipping, in peach, if any), Start
  (which asks first when a prerequisite is not finished) or Continue; the
  diagram in the side pane; "What I know".
- **What I know** (`/courses/<id>/what-i-know`): each started unit's
  objectives with their status ("Retained" in teal, "Slipping" in peach)
  and, under each, its evidence in log order (question, answer,
  confidence, help, the assessment it was given in, grade with the
  grader's flaw, the right choice or expected answer of a question missed,
  why the grader graded a math answer, a code answer's files as run and
  its tests' output, date) and overrides; a rubric or a code question's tests and frozen
  inputs only while that answer is disputed. Each graded answer has
  "Dispute this grade" (piece 13; `src/web/Dispute.tsx`), and a disputed
  one shows the verdict it now counts with, marked "after your dispute"
  when changed, with its first grade, the reason and the outcome. Once an
  outcome is in, the view is loaded again. Under the summary, the course's
  calibration shows, for each
  confidence level, how many unassisted answers were correct, "I don't
  know" apart.
- **Session** (`/courses/<id>/units/<unit>`): the thread with rendered
  Markdown and math; phase markers; one next-step control where the thread
  has reached; the open question pinned above the message box until it is
  graded or withdrawn, then moved to where it was answered, with Hide,
  which shrinks it to one line with Show until the next question; the help
  notice above the message box and the judge's call under each reply; a
  line for each file the tutor writes with its file tools, once a reply,
  with its path in the workspace (piece 14); a package request's card
  (piece 14) with its packages, Install and "Not now", and its commands
  and folder under a closed "Show the command"; then the outcome, with
  the output's end under "Show the output", open only when the install
  failed. If saving fails, the
  card offers Retry saving without another install. The thread also has
  the detour marker and "Ready for another question", and the closing card.
  The top line shows the unit's position and its outline has Start fresh.
  A math question is answered in a one-line field whose expression is shown as
  math beneath it as it is typed (piece 2). A code question's card names
  each file to edit by its full path, with "Copy path" and "Open", and says
  the tests are not shown. "Open" has the server open the file in the
  system's default app for it (`xdg-open` on Linux, `open` on macOS),
  outside the sandbox, and leave the app running. Why it could not shows
  under the button, including that a server started outside the desktop
  session has no display to open it on. "Run the tests", with how sure, is
  the answer, and the graded card shows the end of the tests' output
  (piece 14). A graded card
  can be disputed in place, as in "What I know" (piece 13); its outcome
  also comes over the event stream (`disputed`), so a dispute raised in
  either view shows in the other. Keys: A to F pick a choice, 1
  to 5 how sure, Enter submits; Enter in the math field submits, or moves
  to how sure if that is not picked. A confidence shortcut there returns
  focus to the math field. The view posts `open`, follows `events`, and
  opens the unit again if the stream answers 404 (the chat was lost).
- **Rendering** (`src/web/prose.tsx`): model text and the learner's answers
  become React elements, never HTML. Raw HTML shows as text, images are
  never fetched, unsafe links lose their address, KaTeX runs untrusted.
- **Artifacts** open in the side pane beside the session's thread (piece
  5), one at a time. A new artifact since the page opened opens at once,
  even before its event stream connects; restored transcript references
  do not. Esc, Close or the thread reference closes it. Only same-origin
  iframe requests get HTML; a direct URL shows inert text. The frame and
  the response policy sandbox HTML to its own origin with scripts allowed.
  The parent page's `frame-src 'self'` prevents the frame from navigating
  away. WebRTC is not blocked (`decisions.md`, "Confinement").

The look and layout were settled with static mocks in `docs/prototype/`
(start at `index.html`; the shared look is `base.css`, copied into
`src/web/styles.css`); the picks are in `decisions.md`, "Page design".

**Routes** (`src/server/http/app.ts`; bodies are schemas in `src/shared/`,
mainly `events.ts`, `library.ts` and `what-i-know.ts`):

- `GET /api/courses`, `GET /api/courses/<id>` (with each unit's progress),
  `GET /api/courses/<id>/what-i-know`, `GET
  /api/courses/<id>/artifacts/<file>`, `POST /api/courses/<id>/review`
  (the intake for a draft).
- `POST /api/courses/<id>/questions/<question id>/open` with `{ file }`,
  the file's place in the list of an open code question of the course:
  opens it if it is a plain file in the workspace (502 with the opener's
  reason when it fails).
- Under `/api/courses/<id>/answers/<question id>/`, for a recorded answer:
  `GET graded-by` (what graded it, for its dispute), and `POST dispute`
  with the reason, which answers once the outcome is recorded (502 when
  the judge failed and nothing was recorded).
- `POST /api/intakes`, then under `/api/intakes/<id>/`: `events`,
  `messages`, `approval`, `interrupt`. An intake is addressed by an id of
  its own, since the course exists only from the first proposal.
- Under `/api/courses/<id>/units/<unit>/`: `open` first, then `events`,
  `messages`, `ready`, `answers`, `grade-again`, `another-question`,
  `packages/install`, `packages/not-now` and `packages/retry-saving`
  (with the request's id),
  `override`, `next-segment`, `go-over-again`, `finish`, `start-fresh`,
  `interrupt`. A unit not opened since the server started answers 404 on
  all but `open`.
- An event stream replays its chat's log with ids `<log id>.<index>`, so a
  page that reconnects gets only what it missed. It starts with `hello`,
  outside the log: the chat's id and the index of the log's last event,
  so the page knows which events happened while it was open. Refusals and failures
  answer with the reason as `error`.
- The server listens on `127.0.0.1` only, refuses host names other than
  `localhost`, and refuses a POST whose `Origin` is not its own page.

## 11. Testing

- **Automated (Vitest)**: tests sit beside the code. Expected results come
  from worked examples written by hand. Engine flows run on the fake
  backend; idle closing runs on a fake timer (`engine/fake-timer.ts`) that
  the test moves on; choice order is fixed with `order: givenOrder`. The
  sandbox's tests, those of math questions, which run the real symbolic
  check, and those of code questions, which run pytest from
  `pytools/.venv`, run real commands in it, so they need what it needs and
  fail where it cannot run.
- **Python helpers (pytest via uv)**: equivalent and non-equivalent
  expression pairs worked by hand, and `mathcheck.py` run on the venv's
  own Python; (stage 4) conversion of small fixture files.
- **Browser checks with no model**: `pnpm dev:fake`, the real server on the
  scripted backend and a seeded scratch data root.
- **Real-model runs**: by hand, short, on Haiku 5.5 unless the result
  depends on the model's judgment. A run's turns as sent, with headers,
  tool inputs, tool results and thinking, are in Claude Code's session log
  under `~/.claude/projects/<the course's workspace folder, every character
  but letters and digits made "-">/`; the page events are in the course's
  `sessions/`.

## 12. Build stages

Stage scope is listed here; task status and user checks live in the
[plan](plan.md).

| Stage | Scope |
| --- | --- |
| 0. Spike and skeleton | Toolchain; a page that streams a Claude reply on the plan login and round-trips a question; a Codex spike |
| 1. Record and library | Data root, course creation by intake, review and approval, diagram, library |
| 2. Session engine | Unit planning, phases, choice and rubric-graded questions, confidence, evidence, derived status, override, detours, help judging, resume, transcripts, math rendering, backup, "What I know", calibration |
| 3. Checked grading and aids | SymPy check, workspace and code tests, installing a course's packages, artifacts pane, disputes, the tutor's built-in tools |
| 5. Mastery loop (before 4) | Unit gate with earlier objectives, testing out of a unit, review questions at the start of each sitting, retained and slipping status, the misconception record, handoff notes, the learner profile, HTML notes, transcript export, style and curriculum changes |
| 4. Sources (after 5) | Ingestion for the four formats, outline, unit mapping, `quote_source`, citation view, page images, web search setting |
| 6. Later | Codex backend, self-test, cheat sheets, photo input; starred messages for the notes, if the generated notes miss what the learner wants kept |

## 13. Risks

- **Plan terms change.** Mitigation: the adapter; an API key would also work
  with the same code, at metered cost.
- **The tutor ignores the protocol** (keeps lecturing, hints at answers).
  Mitigation: engine-side refusal of out-of-phase calls, the help judge, and
  prompt revision from transcripts. Hints in free text cannot be fully
  prevented.
- **Lenient rubric grading.** Mitigation: a separate grader call, a required
  pointer to the flaw, disputes. Proof grades remain a model's judgment.
- **Poor PDF conversion.** Mitigation: page-image fallback; scanned files
  flagged at ingestion.
- **Cutting a long stretch can split an argument.** Mitigation: cuts fall
  only at paragraph boundaries, and the tutor can read the neighbouring
  sections.
- **The tutor's shell, and the tests and expressions it writes, run on
  the learner's machine.** Mitigation: the sandbox, with no network but
  for installing packages the learner approved, and the permission
  settings confine the tutor's writes to the course's workspace; the
  engine runs tests and the symbolic check in a sandbox too. Reads are
  not confined, which matters once the tutor has web access.
- **The tutor's artifacts run scripts in the learner's browser.**
  Mitigation: a sandboxed frame with an origin of its own, and a policy
  that loads and fetches nothing. WebRTC still reaches the network, which
  matters once the tutor reads text from outside the machine.
