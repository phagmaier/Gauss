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
  docs/                 brief.md, architecture.md, decisions.md, plan.md; prototype/ (the page mocks, a file per piece)
  prompts/              tutor.md, planner.md, course-planner.md, unit-planner.md, grader.md, help-judge.md, dispute-judge.md, handoff.md, notes.md
  src/
    shared/             zod schemas: record files, questions, events, route bodies; pure helpers both sides use
    server/
      main.ts, serve.ts the real server's start, and the wiring it shares with the dev server
      open-file.ts      the system's opener, for a code question's files and a unit's notes
      sandbox-command.ts  wraps a sandboxed command in the Linux workload filter
      record/           read/write course files; derive status, progress, "what I know"; the backup; the dev server's seed
      engine/           chats and check rules, model calls, document finishing, the sandbox for commands
      tools/            teaching tool definitions (transport-free functions)
      backends/         adapter interface, claude.ts, fake.ts (tests), scripted.ts (the dev server with no model)
      http/             routes, event stream
    web/                React app: library, profile, intake, course, its planning conversation, session, "what I know", notes
  pytools/              mathcheck.py; sandbox_exec.py (the workload filter) and sandbox_verify.py (a sandboxed command's exit status apart from its output); tests/
  scripts/              dev-fake.ts (no model); faults.ts (injects faults, runs the tests); grade-set.ts, judge-set.ts and decide-set.ts, which run grader-set.ts, help-set.ts and dispute-set.ts on a real model
  mise.toml             pinned node, pnpm, python, uv; `mise run setup` and `mise run check`
```

Dependencies, kept few (`package.json`, `pytools/pyproject.toml`):

- Server: `@anthropic-ai/claude-agent-sdk`; `zod` (the SDK's tool helper
  requires it); `hono` with `@hono/node-server`;
  `@anthropic-ai/sandbox-runtime`, the runtime developed for Claude
  Code's sandbox, which runs the engine's commands and on Linux needs
  `bwrap`, `socat` and `rg` on the machine.
- Page: `react` and `react-dom`; `react-markdown` with `remark-gfm`,
  `remark-math`, `rehype-katex` and `katex`.
- Documents the server writes (unit notes, transcript export): `unified`
  with `remark-parse`, `remark-rehype`, `rehype-parse` and
  `rehype-stringify`, beside `remark-gfm`, `remark-math`, `rehype-katex`
  and `katex`.
- Development: `typescript`, `vite` with `@vitejs/plugin-react`,
  `vitest`, `happy-dom` (a DOM for the tests of code that reads the
  page), `@biomejs/biome`, and the types `@types/node`, `@types/react`,
  `@types/react-dom` and `@types/hast` (document trees).
- Python: `sympy`, with `antlr4-python3-runtime` 4.11 for its LaTeX
  parser; `pytest` for development. Stage 4 adds a PDF and an EPUB
  converter.

The curriculum diagram is laid out by the page itself
(`src/web/diagram.ts`), not by a diagram library.

## 3. Data on disk

Course data lives outside the repository so the code can be published
without books, transcripts or progress. The data root is `GAUSS_DATA_ROOT`,
or `~/gauss/` (`resolveDataRoot` in `record/data-root.ts`, called by the
server's start); the rest of the record takes the root as an argument.
The server listens on `GAUSS_PORT`, or 4320 (`pnpm dev:fake`: 4330).

```
<data root>/
  .git/, .gitignore               the record's history (below, "Backup")
  profile.md                      the learner profile: plain text that holds across courses, at most 2,000 characters; written by an approval that proposes it, or the Profile page
  .profile-approval.json          recovery journal present only during a curriculum approval that changes the profile, or until recovery
  .notes-write.json               recovery journal present only during publication of unit notes, or until recovery
  intake/                         where intakes' sessions run, so they can be kept; Gauss writes nothing in it
  cache/package-uv/               uv's install cache; outside the record and its history
  courses/<course-id>/
    course.json                   title, backend, settings, dates, when each unit was last opened, when review was last offered
    style.md                      the course's style note, proposed and approved with the curriculum; replaced when the learner applies a tutor's proposed change
    background.md                 the background note: what the learner told the planner, approved with the curriculum
    curriculum.json               units, prerequisites, goals; each unit's plan (objectives, segments) once it starts; a draft's profile and its original comparison; replaced, each kept unit with its plan, when the learner applies a tutor's proposed change
    state.json                    a position for each unit in progress
    evidence.jsonl                append-only: answers (with the assessment each was given in), grades, confidence, overrides, disputes with their outcomes
    misconceptions.jsonl          append-only: what the handoff writer found the learner believed, from detours and discussions
    units/<unit-id>/handoff.md    the unit's handoff note, rewritten whole when a segment closes or the unit finishes
    units/<unit-id>/handoff.json  how far into the unit's transcripts that note reads
    sessions/<unit-id>.<n>.jsonl  transcript of a unit's session n: its page events
    sources/<source-id>/          (stage 4) original file, outline.json, sections/*.md, pages/
    artifacts/                    HTML aids the tutor shows, written by the engine: <n>-<title>.html, never overwritten
    notes/<unit-id>.html          each unit's standalone notes, as the engine finished them
    notes/<unit-id>.json          the writer's original document, kept as data, with the instructions and date
    packages/                     Gauss's uv project and lockfile; never taken from the workspace
    .package-install.tmp/         pending environment rollback or a committed install receipt
    workspace/                    the tutor's working folder: starter code, the learner's work and the installed .venv/
```

The shapes are the schemas in `src/shared/`: `course.ts`, `curriculum.ts`
(a unit's plan in `plan.ts`), `state.ts`, `evidence.ts`, `misconception.ts`,
`handoff.ts` for `handoff.json`, `notes.ts` for the notes' source, and
`profile.ts` for `profile.md`. A course id is its folder's name, made from
its title; unit and objective ids are slugs, and
objective ids are unique in the course, because the evidence names an
objective by its id alone. A curriculum is a draft until the learner
approves it. A course exists from its first proposal. No file has a schema
version: a field added later must be optional.

- **Derived, never stored**: objective status (not started, attempted,
  passed, retained, slipping, overridden), from `evidence.jsonl` by the
  pure functions in `record/status.ts`; a unit's status from its
  objectives', where a unit with a position in `state.json` is in
  progress; where a course stands and whether it is a one-off (a course
  of one unit); each unit's progress for the library and the course view,
  with each started unit's objective statuses and, for a unit in progress,
  what of its position `currentObjective` reads (`record/progress.ts`,
  `UnitProgress` in `src/shared/library.ts`), and which courses are
  finished, every unit of
  an approved curriculum passed or overridden, omitting unreadable records
  (`finishedCourses`), a list for new planners and the Profile page;
  and "what I know" with its calibration counts (`record/what-i-know.ts`,
  `record/calibration.ts`). The rules for passing and help are in
  section 4; the reasons in `decisions.md`, "Objective status". A
  disputed answer counts with its dispute's verdict, where the
  answer stands in the log; its own line keeps the first grade
  (`record/disputes.ts`, which status, the check rules and calibration
  read the log through). A misconception is open while its objective is
  not passed, slipping and overridden ones included (`isOpen` in
  `src/shared/misconception.ts`).
- **`state.json`** holds a position for each unit in progress, not one
  current unit: several units can be in progress at once (`UnitPosition`
  in `src/shared/state.ts`). Besides positions it keeps the outcomes that
  must survive a lost transcript line: completed package cards, units
  finished by testing out, and the learner's style and curriculum answers
  not yet told to the tutor. Before the first unit exposes the workspace,
  the course rolls back an interrupted install or saves its committed
  receipt without rerunning uv; the journal is kept until the result is
  saved.
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
  them, and leaves out `.venv/` and Python's caches. A commit is asked for
  once a segment's close, a unit's end, an approval, an applied style or
  curriculum change, a handoff note, unit notes or the end of an
  assessment that recorded answers is written, once the Profile page's
  save is, at each start, and for course deletion. Commits run one at a
  time by "Gauss"; a failure is logged and never fails the engine. On for
  `pnpm dev` unless `GAUSS_BACKUP=off`; off for `pnpm dev:fake` unless
  `=on`; tests pass it in.
- **Deleting a course** (`engine/course-deletion.ts`) holds it exclusively:
  course requests hold it until their work is registered or done; the
  engine refuses deletion while a chat is being read, a unit has work
  queued, or any of the course's jobs are running. The engine drops what
  its `CourseHolder`s keep and closes their sessions. It waits for a
  backup snapshot of the final record, renames the folder to a hidden
  `.tmp` name, removes it, and asks for a commit of the deletion. A title
  is required for an approved course with evidence, an opened or started
  unit, or unreadable progress (`deletionAsksTitle`). Confirmation is
  bound to the course instance so a stale page cannot delete a new
  course that reused its slug.

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
  appears. Each session's first turn gives the planner, in
  `<about_the_learner>` after the header, the learner profile and the
  titles of the finished courses; later turns give the profile again if
  it has changed since the last turn sent to the backend. The first
  proposal creates the course; each proposal replaces the draft with its
  style note, background note and the profile's whole text, and a reply
  to one is a change request. A card compares its profile with `profile.md`
  as it was when the proposal was made, even after reopening a draft.
  Approval is refused while a turn is queued or running; it checks that
  the files still match the card (`DraftMismatch`) and the profile still
  matches the original comparison (`ProfileChanged`). A draft that
  proposes a profile but has no saved comparison must be proposed again.
  A profile-changing approval journals the draft before writing the
  approved curriculum and publishes the profile last. If interrupted
  before publication, recovery restores the draft; if publication
  completed, both changes stand. Reads, further writes to either file
  and backup staging resolve an interrupted approval before proceeding.
  Approval ends the intake and closes its session; the planner is not
  told. Intakes are kept in memory: a restart loses one in progress, and
  its draft is reviewed in a new intake from the stored draft
  (`POST /api/courses/<id>/review`).
- **The planning conversation** (`engine/course-planning.ts`), one per
  approved course at a time, opened by "Change the curriculum" or "Plan
  what comes next" in the course view and run as the intake is: the page
  asks the opening question, which says whether every unit is finished,
  and the session starts with the answer. The session's first turn gives
  the planner, after the header, the course in `<course>` (each unit with
  its status, each started unit's objectives with theirs, the style note
  and the background note) and the profile in `<about_the_learner>`; a
  later turn gives them again if any has changed since the last turn sent.
  It proposes with its own `amend_curriculum`, whose card is the unit
  tutor's; posting ends its turn, and a new proposal replaces the one
  waiting. The proposal is checked as a unit tutor's is (nothing changed,
  a started unit dropped) and goes through the course's queue with the
  unit tutors' (`CourseDesk`): it is refused while a style or curriculum
  proposal waits in a unit, and while it waits theirs are refused. It is
  kept in memory only. Apply is refused while a turn is queued or running;
  it writes `curriculum.json` through `changeCurriculum` in
  `record/data-root.ts`, which checks again under the state and curriculum
  locks that no started unit is dropped, then asks for a backup, tells the
  course's open unit chats as another unit's Apply does, closes the
  session, and ends the conversation; until the write succeeds, opening
  planning again returns the same conversation. "Keep the current one" is
  said in the planner's next header. If the backend cannot resume an idle
  session, its replacement gets the earlier messages, proposals and their
  outcomes. A server restart loses any conversation and proposal still
  waiting, without applying it. Planning conversations have no transcripts.
- **Unit planning** (`engine/unit-planning.ts`). A unit without a plan is
  planned when it is opened, in a session of its own: one turn with "#
  The learner" (the profile, when there is one, then the background
  note), the curriculum and the status of every objective planned so far,
  and what earlier units showed (section 4, "Handoff notes"), the
  `plan_unit` tool, then it closes. A session that ends without
  a plan is tried once more, told why; then the unit reports that it could
  not be planned.
- **The unit chat** (`engine/unit-chat.ts`), one per unit, kept in memory
  until the server stops or its course is deleted. It holds the phase
  rules, the teaching tools and the learner's actions, and owns the unit's
  one queue, through which every
  change to the unit goes. It coordinates `engine/unit-record.ts`, which
  keeps the position and evidence, and `engine/unit-agents.ts`, which runs
  the tutor, the grader and the help judge. Opening a unit not in
  progress plans it if needed,
  writes its position (segment 1, teach) and sends the teaching turn, or
  opened for its test, starts the test in its place; opening one in
  progress picks it up where `state.json` has it. Either can first offer
  review, which holds the teaching turn or the test ("Assessments" below).
  Opening a unit marks it opened in `course.json`. A unit reopened in teach
  is taught again.
- **Kept sessions and resume.** A tutor's session, an intake's and a
  planning conversation's are kept by the backend and resumed by id, in
  the folder they ran in (the course's `workspace/`, made when a unit
  first opens, or the data root's `intake/` for the other two); the
  tutor's id is in the unit's position.
  Opening a unit only asks the backend whether the session is still there
  (`hasSession`); the first turn resumes it. The system prompt is built
  when a session starts or resumes, from the record as it is then (the
  style note and curriculum last applied), and sent afresh on every
  request, so a resumed session gets the current prompt; a running
  session keeps the one it started with.
- **Idle sessions.** A kept session is closed after ten minutes (`IDLE_MS`)
  with no turn queued or running and nothing waiting to send it a turn (a
  grading); the next turn resumes it.
- **Start fresh.** The learner can start a new tutor session from the unit's
  outline: the old one is closed and its id taken out of the position, and
  the new session gets one turn to pick up where the unit stands. A session
  the backend cannot find (a deleted file, or Claude Code's 30-day sweep)
  falls back the same way, but sends nothing until the learner acts. Either
  way the new session's system prompt is the seed from the record (section
  9), its first header says it is new and is followed by the unit's
  handoff note and the open misconceptions on its objectives (below,
  "Handoff notes"), and the page shows a "Fresh start"
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
  **Export transcript** in the outline downloads the unit's recorded thread,
  including for a finished unit. The read-only route waits for pending
  transcript writes but does not open a chat or wait for a tutor turn.
  The document replays the page events through `src/shared/timeline.ts`
  and groups them by sitting. The live thread and the export share assessment
  summaries and dispute feedback, including the first grade after a
  correction. The file embeds KaTeX styles and fonts, names artifacts without
  embedding them, and keeps link labels but not targets. Raw tutor HTML is
  dropped; literal HTML in learner answers is escaped as text. Exported code
  cards give the recorded test result, not the raw test output or diagnostics.

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
| closed to the next segment's teach | the learner starts it | none after the unit's last segment; segments the test let the learner skip are passed over |
| last segment closed to the unit's end | automatic | the closing card when objectives did not pass; when every one passed, the gate's card ("Assessments") |
| unit's end to one more segment | the learner goes over the objectives not passed | a segment after the plan's last, on those objectives, kept in the position |
| unit's end to the gate | the learner moves on without them | an override of the objectives not passed; the gate's card |
| the gate to finished | it ends or is skipped | the closing card again, with the other units' objectives it asked; the unit leaves `state.json` unless the gate left objectives of it not passed, which the card offers to go over again (with no second gate) or to move on without |

The rules:

- **Passing** (`record/status.ts`). Since its last miss, an objective
  passes with unassisted correct answers to two different questions, at
  any confidence, or with one at 90% or 100% if it was never missed. A
  miss clears the correct answers before it. A correct answer given with
  help counts for nothing; a wrong one is a miss. Questions differ when what the
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
  or already done in this check, and once the unit is finished. In an
  assessment it is allowed in any phase, on the objective the assessment
  asks next only, and refused while its card waits. Its file writes and
  commands are refused as section 5 says; `show_artifact` is refused
  while a question of its unit is open or its unit is finished;
  `install_packages` while a question of the course is open or another
  request of the course waits; `propose_style` and `amend_curriculum` in
  feedback-only turns, while a question of its unit is open, while
  another proposal of the course waits, or for a change to nothing. A
  refusal does not end the turn; a posted question does.
- **Feedback, then the next question.** The turn after a graded correct
  answer is for feedback alone; no tool may be called in it, and
  questions are refused from when it is queued until it ends. When it
  ends, the segment closes if every objective is done; otherwise the
  engine sends a turn asking for a lead-in and the next question
  (`nextQuestionTurn` in `unit-turns.ts`). That turn is skipped if a
  reply to a learner message has posted a question meanwhile, or the
  learner pressed Stop.
- **Style changes** (`StyleDesk` in `unit-chat.ts`). `propose_style` keeps
  the whole proposed note, the note it would replace and why in the unit's
  position (`styleProposal`), shows its card, and lets the turn go on; each
  header says it waits until it is answered, and a restart shows the card
  again. One proposal waits in a course at a time. Apply commits the new
  `style.md` and the decision together before asking for a backup. An
  interrupted Apply restores the old file and leaves the proposal waiting.
  "Keep the current one" records a decision without changing the file.
  Either is taken while the tutor writes. The decision goes in the tutor's
  next header, with an applied note's text, and stays in the record until
  a turn carrying it completes. Other open unit chats are told the new
  note in their next headers, and every session started after Apply has
  it in its prompt. A proposal still waiting when its unit finishes is
  withdrawn. If the transcript lost the decision and the record no longer
  holds it, the card says "No longer waiting" rather than guess.
- **Curriculum changes** (`CurriculumDesk` in `unit-chat.ts`).
  `amend_curriculum` works as `propose_style` does, with the same
  proposal and feedback rules: the whole proposed unit list, the list it
  would replace and why are kept in the position (`curriculumChange`), its
  card shows, each header says it waits, a restart shows the card again,
  and the unit finishing withdraws it. One proposal of either kind waits
  in a course, the course's planning conversation's included
  (`CourseDesk` in `unit-chat.ts`). It is refused if it changes nothing, or drops a unit that
  has started (it has a plan, a position, or was tested out of; a changed
  id drops the unit), and checked again on Apply (`droppedStarted` in
  `src/shared/curriculum-change.ts`). Apply writes `curriculum.json`,
  each kept unit with its plan, then the decision to `state.json`, under
  the snapshot lock, and asks for a backup. A curriculum that holds a
  waiting change's units commits it: reading or writing the state records
  such a change as applied. A later position write in the proposing chat
  publishes a recovered Apply as it would an ordinary one. The decision
  goes in the tutor's next header with the units as they now are; other
  open unit chats get the revised list in theirs, and new sessions have
  it in their prompt. A live notice tells every open unit page of the
  course to refetch its details; the course view reads them when it opens.
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
  the closing card is shown again with the statuses as they now are (with
  every objective passed, the gate's card follows, or the unit finishes
  when it has nothing to ask). A dispute that takes the pass
  from an objective of a finished unit records that objective as
  overridden with it, so the unit stays finished. The tutor of a unit in
  progress is told the outcome in its next header (`disputeNote` in
  `unit-turns.ts`).
- **The learner's steps wait for the tutor**: "ready", moving on, the next
  segment, "another question", Start fresh, an assessment's Start and Skip,
  the test's result card's steps and the closing card's steps are refused
  while the tutor is writing; Stop is always there. The unit's own steps
  also wait for an assessment offered or under way, and for the test's
  result card. Answers and messages are taken at any time.
- **Moving on sends the tutor nothing.** The next turn's header says the
  learner moved on, and which question was withdrawn.
- **A finished unit is not started again.** Opening one shows it finished;
  one reopened at its closing card shows the card again.
- **Order of writes.** Every change is written to `state.json` before the
  page hears of it; an answer is appended to the evidence before its
  question is closed, so a crash between the two leaves the question open
  with its answer kept.
  Reopening reconciles transcript questions with the position and evidence:
  a lost grade is restored, and a question no longer open with no answer
  is shown as withdrawn. Moving on from the closing card keeps a pending
  override in the position until the gate or finish is saved. If interrupted,
  reopening completes the move-on without recording the override twice.

### Turn protocol

The engine composes every message the tutor receives: a short header (unit,
segment, phase, what is allowed now, what happened that the tutor has not
been told, and in a source course the segment's sections), followed by the
learner's text or an event. An answer's turn repeats the question with its
choices, the learner's answer, confidence, reasoning and the grade. A turn
that allows a question adds a separate “Questions asked before” section to
the header: the latest six recorded prompts for each objective it may ask
about. This gives a new tutor session examples to avoid repeating. In an
assessment the header also names the objective's unit and statement, which
the tutor's plan lacks when it is another unit's, and in a review or a gate,
after the questions asked before, the misconceptions recorded on the
objective, each one line, open or cleared. A new session's first turn
carries the unit's handoff note and open misconceptions after the header,
before its body. The scripted backend
reads the instructions before that section, and of the section only how
many questions it lists, to number its next question past them, never the
recorded prompts. Header wording lives in `engine/unit-turns.ts` for unit
chats, `engine/intake.ts` and `engine/unit-planning.ts`; changing the
wording the script reads can break `pnpm dev:fake`.

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
   a confidence level and optional reasoning ("Your thinking" on the page),
   or "I don't know". The thinking, and where the learner got stuck, have
   one limit (`REASONING_LIMIT` in `src/shared/question.ts`); over it, the
   page keeps the draft, says so under the field and will not send it
   until it is shortened. Nothing grades the reasoning: the grader and the
   tests see the answer alone. The tutor, the handoff writer, the dispute
   judge, "What I know" and the exported transcript show it.
4. The engine grades it (section 6) and appends the evidence.
5. The tutor gets the result as the next turn: feedback, or a detour's
   first turn after a miss (above).

### Assessments

An assessment is a run of questions without teaching, asked by the unit's
tutor in the unit's thread over objectives the engine picks (`decisions.md`,
"Mastery loop"). Review opens a sitting, the unit gate closes a unit, and
the test before a unit lets the learner skip what they know.

- **Kept in the position**, beside the phase, which it leaves alone
  (`AssessmentRun` in `state.ts`): its mode, its objectives with their
  units, whether its card is offered or it is under way, and where it began
  in the evidence. While it is under way, the position's open question and
  detour are its own, the question flow above is reused unchanged (help is
  judged as in a check), and each answer is recorded with its
  `assessment`, the mode and this unit. A restart reopens it: its card, its
  open question or detour, or, with nothing open, the turn that asks for
  its next question. The unit's record keeps the evidence on its plan's
  objectives, on its assessment's, and on those of every answer given in
  its thread, and reads it again when the assessment ends, since other
  units' chats write on those objectives too. An answer on another unit's
  objective is told to that unit's chat if it is open, and a dispute of it
  to both chats (section 6).
- **Its rules** (`engine/assessment-rules.ts`): each objective gets one
  question, in order; `ask_question` is refused on any other objective. In
  a review and a gate, a correct answer gets a feedback turn, then the
  next objective's question in a turn of its own. A miss opens a detour as
  in a check; when the learner ends it, the objective is asked once more,
  and after that the assessment moves on whatever the answer: a second
  miss has its detour, and no third question follows. A question's number
  is its objective's place in the assessment. The test's rules are its
  own (below).
- **Review is offered on a card** when a unit not finished is opened in a
  new sitting (the chat is new, or `quiet()` in `engine/transcript.ts`:
  nothing has happened for `SESSION_GAP_MS`), and nothing waits on the
  learner or the tutor: no assessment, open question, detour, package
  request or install, style or curriculum proposal, test result card,
  closing card, feedback or other turn to come, and the unit's last
  segment is not closed. It asks about up to three objectives of the
  whole course that are due (`pickForReview` in `record/review.ts`): a
  slipping one at once; a passed or retained one 1, 3, 7, 21 or 60 days
  after its last correct answer without help, by how many correct answers
  without help it has had in a row in reviews and gates since its last
  miss. Slipping ones come first, then the most overdue for their
  interval, and none answered within the hour; with nothing due there is
  no card. `course.json` keeps when review was last offered, and no card
  comes within the hour of it, so two units opened together get one
  (`markReviewOffered` in `record/data-root.ts`). Showing the card sends
  the tutor nothing; a teaching turn that is due and the unit's own steps
  ("ready", moving on, the next segment, the closing card's steps) wait
  until it is answered. Start asks the tutor for the first question. A
  message sent while the card waits, or while it is being offered, skips
  it.
- **"Skip review"** ends it on the card or partway, withdrawing an open
  question with nothing recorded; it is refused while an answer is kept
  for grading, as moving on is. When it ends or is skipped, the page is
  told what it did (each answered objective's status) and the unit goes on
  where it was: a teaching turn that waited is sent, a check takes up again
  with a turn asking for its question (or closes if nothing is left), and
  the discussion and a closed segment send nothing. The tutor that asked is
  told in its next header (`runEndNote` in `unit-turns.ts`).
- **The gate** (`endUnit` and what follows it in `unit-chat.ts`) is offered
  once per unit, on a card, when its last segment has closed and every
  objective has passed or been moved on from at the closing card. It asks
  `pickForGate`'s objectives (`record/review.ts`): the unit's own that are
  passed and not retained, leaving out those whose pass rests on an answer
  given while testing out, in the plan's order; then up to three of other
  units' by review's pick, so only those due. With nothing to ask there is
  no card, and the unit finishes. With every objective passed as the
  segment closed, the card comes with no closing card before it; one
  standing (a dispute or another unit's answer passed the rest) is shown
  again with the statuses as they are. The card says how many questions
  and on what, holds the unit's steps, sends the tutor nothing, and waits
  across sittings: a message leaves it waiting. Its rules are review's.
  When it ends or is skipped (on the card or partway, with an open
  question withdrawn), the closing card comes again (`closeAfterGate`),
  with the other units' objectives the gate asked and their statuses,
  including one whose open question was withdrawn without an answer. Its
  two steps cover only what the gate left not passed (`toGoOver` in
  `check-rules.ts`),
  not what the learner moved on from before it, and the unit finishes
  when that is nothing. `gated` in the position keeps the gate from being
  offered again, across going over objectives again and restarts.
- **The test before a unit** is chosen on the course view for a unit not
  started (`POST .../test-out`, refused if another open has already
  started loading the unit). The unit is planned as any unit is; its
  position is written with the test due, which starts in place of the
  teaching turn, after a review that is due, on every objective of the
  plan in its order. It has no feedback turn and no detour: the turn that
  brings a grade asks for the
  next question, numbered on from the test's questions, whose head names
  its objective's place. A correct answer that passes its objective alone
  (at 90% or 100%, without help) ends its questions; any other correct
  answer gets a second question at once; a miss ends them, and as the
  status rules have it counts as no miss afterwards. When it ends, or the
  learner presses "Start learning instead" (Skip, refused while an answer
  is kept for grading), the tutor is asked to say in a few sentences what
  it showed, given each objective's outcome, and once that turn ends the
  result card is shown (`test_result`): each objective passed or not, with
  its answers. The position keeps the result waiting, so a restart shows
  the card again (and asks the tutor again first if the card was never
  shown); a dispute or another unit's answer shows it again as it stands.
  If the choice was saved but its transcript event was lost, reopening
  settles the result card from the saved position before resuming teaching.
  Nothing is skipped until the learner answers it (`test-out/skip`,
  `test-out/whole`): a skip request must match the objectives shown on
  the learner's card; if they changed, the learner must choose again.
  Accepting the skip fixes those objectives in the position, and teaching
  starts at the first segment with one not passed (`skipping` in
  `src/shared/plan.ts`). A segment whose objectives all passed is skipped,
  now and when the next segment starts. A segment with a passed objective
  teaches and checks only the other (`segmentOf` in `check-rules.ts`), its
  teaching turn told what was left out; the unit's
  last segment is the last one taught. With every objective passed,
  skipping finishes the unit, with no gate. The other step teaches the
  whole unit as planned, whose checks ask a passed objective once. What
  passed stays passed either way, and the gate leaves out a pass resting
  on a test answer.

### Handoff notes and misconceptions

`engine/handoff.ts`; why, `decisions.md`, "Mastery loop".

- **When.** The unit's record asks for a call once a segment's close
  (by passing or by moving on) or the unit's end is written, where it asks
  for a backup commit. The calls run outside the chat's queue, one at a
  time per unit (`createHandoffs`): a close while one runs is read by one
  more call after it. Closing the chat stops a call, which records
  nothing. A stretch with no tutor text, learner message or answer (a unit
  that finishes as its last segment closes) gets no call.
- **What it reads.** The unit's transcripts on disk, once the thread's
  events so far are written, from the mark in `handoff.json` on
  (`since`): written out by `readStretch` with the tutor's text joined,
  the learner's messages, each question with its answer, reasoning,
  confidence and grade (a confident wrong answer named as one), detours
  numbered in order, and the thread's markers; at most `STRETCH_LIMIT`
  characters, its start left out beyond that. With it, the unit, its
  objectives and those of other units that the stretch's questions asked,
  the note before, and the misconceptions recorded on those objectives
  (`handoffRequest`).
- **What it writes.** `HandoffReply` (`src/shared/handoff.ts`): the note,
  whole, and the misconceptions found, each naming an objective given and,
  if it showed in a detour, the detour's number, which the engine turns
  into its question's id and number; one naming anything else is left
  out. The misconceptions are appended, then the note replaces the one
  before, then the mark moves to the stretch's end, and a backup commit is
  asked for. A failed call, a reply out of shape or one past
  `HANDOFF_TIME_LIMIT_MS` records nothing, so the next call reads its
  stretch too. It runs on Claude Sonnet 5.5 (`HANDOFF_MODEL`).
- **Who reads them.** The chat holds the unit's note and the course's
  misconceptions, read when it opens and again when an assessment is
  offered, with what its own calls write. A new session's first turn gets
  the note and the open misconceptions on the unit's objectives; a
  review's or a gate's question turn, those on its objective, open or not.
  For a question on another unit's objective, that turn also gets the
  assessed unit's handoff note if it exists, even when it is not a
  prerequisite. The chat reads those notes when the assessment starts
  or resumes so the tutor can avoid reusing teaching examples.
  The tutor's system prompt and the unit's planning turn get, as the
  record stands when the chat opens or the unit is planned, the last notes
  of the unit's direct prerequisites and the open misconceptions on other
  units' objectives (`readEarlier`), in a section left out when it is
  empty. "What I know" shows each under its objective.

### Unit notes

`engine/notes.ts` accepts an explicit request for a finished unit, including
one tested out of whole. The writer is a one-shot on Claude Sonnet 5.5
(`NOTES_MODEL`), outside the chat queue. It reads the unit's goal and
plan, the whole transcript
with other units' assessment work left out, missed answers with their
corrections, the handoff note, the unit's misconceptions and optional
instructions. The plan is not evidence that a topic was taught. The first
write requires no saved notes; a rewrite names the revision it replaces.
Stale requests do not call the writer. The backup takes the previous revision
before it is replaced. Renaming the new HTML commits the revision: the record
uses its revision marker to settle an interrupted write before serving or
backing up the HTML and its matching source.

`engine/standalone-html.ts` finishes the authored document for direct
opening from disk. It allows static HTML and SVG, rejects web addresses
and oversized input, and removes scripts, event handlers and non-fragment
navigation. It renders marked TeX and dollar-delimited prose math with
KaTeX, and embeds the stylesheet and WOFF2 fonts. A CSP meta permits inline
styles and `data:` images and fonts, not scripts or external resources.

## 5. Teaching tools

Defined once as plain functions over the record and engine
(`src/server/tools/`), then bound to each backend: for Claude an in-process
tool server, for Codex an MCP server.

| Tool | Effect |
| --- | --- |
| `propose_curriculum` | Stores a draft curriculum with its style note, background note and the learner profile's whole text, and shows them for review; approval covers all four. Refused in the intake's first turn |
| `plan_unit` | Sets the unit's objectives and segments, in its planning session |
| `ask_question` | Posts a question on an objective of the segment, in the check, or on the one an assessment asks next: `choice` with an answer letter, `math` with an expected expression and grading policy, `written` with a rubric, or `code` with the files the learner edits, the tests, the solution and the command (`QuestionInput` in `src/shared/question.ts`) |
| `amend_curriculum` | Proposes the whole revised unit list with a line on why (`CurriculumChangeInput` in `src/shared/curriculum-change.ts`), shown on a card; Apply writes `curriculum.json`, each kept unit with its plan. A tutor's uses the proposal and feedback rules in section 4 and does not end the turn. The course planner's (`planCurriculumChangeTool`) ends its turn and replaces the proposal waiting (section 4, "The planning conversation") |
| `quote_source` | (stage 4) Returns a verified quote block, or an error if the text is not in the source |
| `install_packages` | Asks the learner to approve Python packages with optional version ranges (`PackagesInput` in `src/shared/packages.ts`). Install runs the command on the card in the engine's sandbox, with access to PyPI and a fresh workspace `.venv`; the previous environment is restored if the install fails. The course's workspace is closed to tutor mutations and new questions while it runs. Does not end the turn |
| `show_artifact` | Shows an HTML aid, given whole in the call (`ArtifactInput` in `src/shared/artifact.ts`), in the side pane; the engine writes it to `artifacts/` under a new number, and the thread keeps a reference to it. Refused over 100 KB and for a document that names an address on the web. Does not end the turn |
| `propose_style` | Proposes the whole revised style note with a line on why (`StyleInput` in `src/shared/style.ts`), shown on a card; Apply writes `style.md`. Uses the proposal and feedback rules in section 4. Does not end the turn |

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
| Multiple choice | Exact match in the engine | |
| Computational math | The symbolic check (`pytools/mathcheck.py`) for questions declared unrestricted; otherwise the grader | An unreadable or undecided answer, failed check, or time-out also goes to the grader. The evidence keeps why (`unsettled`) |
| Code | Runs the question's tests with their command on the learner's files as sent, in the engine's sandbox; exit status 0 is correct | The tests must fail on the starter files and pass on the solution for the question to be posted. The learner sees the end of their output once graded, never the tests |
| Proof, explanation, reconstruction | A separate one-shot model call, `prompts/grader.md` with the question's rubric | Names the first flawed step or missing element; never sees the tutor's conversation |

- **The grader** (`engine/grading.ts`) is one `oneShot` request (section 7):
  system prompt `grader.md`, and a message holding the question as the
  learner saw it, the rubric and the answer, each between tags, and nothing
  else. For a math answer the rubric uses the expected expression and
  gives priority to the prompt's constraints. The answer is the expression
  or the written text, never the learner's reasoning. `WrittenGrade` (`src/shared/question.ts`)
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
- `GAUSS_CLAUDE_MODEL`, when set, replaces every model: the tutor's
  sessions (otherwise the learner's Claude Code default) and each one-shot
  call's (`main.ts`). The grader's and the judges' models were each
  chosen on a hand-made set: re-run
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
  including parsing, 12 seconds, in the sandbox writing only its own
  `$TMPDIR`:
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
  its output, standard error merged into standard output, is evidence. A
  run past its limit fails the grading;
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
  tutor, when it opens. An answer given in another unit's assessment is
  that unit's too: its chat, if open, learns the dispute, so the
  assessment goes on with the corrected verdict and its tutor is told. The
  record refuses a second dispute of an answer as it appends
  (`appendDispute` in `record/data-root.ts`).
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

Not built. What its SDK can and cannot do, from the stage 0 spike, is in
`decisions.md`, "Codex".

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
  their goals and prerequisites, the unit taught and its plan, "# The learner" with
  `profile.md` when there is one, then `background.md` (or a line saying
  none was recorded), "# Earlier units"
  when it has anything (the last handoff notes of the unit's
  prerequisites and the open misconceptions on other units' objectives),
  then `style.md` (or a line saying to use `tutor.md`'s default style), as
  it stands when the session starts or resumes.
  The unit's own handoff note goes into a new session's first turn
  (section 4, "Handoff notes").
- `planner.md` drives the intake: its questions, asking to go ahead, and the
  proposal with its style and background notes and the learner profile,
  with what belongs in the profile (what holds in any course) and what in
  the background note (this course). A topic of more than about 15 units
  is one course planned in stretches: the planner proposes the first, and
  names what follows before posting the proposal and in the style note.
  The tutor is instructed to offer each next stretch with
  `amend_curriculum` in the first teaching turn of the last unit or the
  one before, before any check starts.
- `course-planner.md` drives the planning conversation of a course
  (section 4): what it is given and what the statuses mean, asking what
  the learner wants, offering the next stretch the style or background
  note names, the rules of a change, and proposing with
  `amend_curriculum`.
- `unit-planner.md` drives a unit's planning session.
- `grader.md`, `help-judge.md` and `dispute-judge.md` are the one-shot
  calls of section 6; `handoff.md` is the one-shot call that writes
  handoff notes and finds misconceptions (section 4). Assessments have a
  section of `tutor.md`, not a prompt of their own.
- `notes.md` is the unit notes writer's prompt (section 4). It asks for
  standalone HTML rather than Markdown.

Thread text is Markdown with `$` math: `$...$` inline, `$$` for display,
`\$` for a dollar sign; no `\(...\)`, HTML or images (section 10).

## 10. Page

`src/web/`, React built by Vite. Each view's logic sits in a tested pure
module beside it (`session.ts`, `progress.ts`, `library.ts`,
`what-i-know.ts`, `diagram.ts`, `route.ts`, `profile.ts`, `units.ts`,
`calibration.ts`, `api.ts`; the thread's timeline is
`src/shared/timeline.ts`). Of the components, only `PackagesCard.tsx` and
`prose.tsx` have tests; `quote.ts`, which reads the page, is tested on
the HTML `Prose` renders.

An objective's or a unit's status shows as a form beside its word
(`StatusForm.tsx`; `decisions.md`, "Page design"): in the course view's
unit headings and objective rows, its diagram and the diagram's numbered
fallback, "What I know", the closing card's rows, and the library's rows,
one form per unit with no word. The current unit, the one the course
view's card leads to, takes the accent's ringed form; other units in
progress take the outline.

- **Library** (`/`): the courses in three groups, in progress, drafts (no
  approved curriculum) and finished, each with its count and most recently
  opened first, an empty group left out (`libraryGroups`). A row has the
  title, "One-off" for a course of one unit, where it stands, when it was
  last opened, and a form per unit for a course of more than one
  (`standing` in `library.ts`); the right of its second line is left for
  the due count. Every row opens its course view. The top line has
  "Gauss", and "Profile" and "New course" at its right.
- **Intake** (`/intakes/<id>`): the conversation, with each proposal as a
  card (units, "How I would teach it", "What the tutor will know about
  you", "What I would remember about you", the diagram, Approve); a
  revision marks what changed. The last section is the profile approval
  would save, marked "New" when there was none, "not changed", or
  "Changed" with each new sentence marked and each dropped one listed
  under the text (`compareSentences` in `src/shared/profile.ts`).
- **Profile** (`/profile`): what the profile is for, its text in
  one box with its length against the limit, "Undo my changes" and Save,
  then the finished courses a new planner is given. A save names the text
  the page loaded and is refused if the profile changed since.
- **Course** (`/courses/<id>`): the top line has "Course map" and "What I
  know" (a draft has "Review the curriculum" instead of the latter). Under
  the title, a line counts the units, the finished ones, and the started
  units' objectives passed (passed or retained) out of how many
  (`courseCounts` in `progress.ts`). A card leads to the unit in progress
  most recently opened, or else the next unit in order (the first not
  started whose prerequisites are finished); on a finished course it reads
  "Every unit is finished", with "Plan what comes next", which opens the
  course's planning conversation. Each unit is a heading with
  "Unit N", its title, "k of n
  passed" once started, and its form, the card's unit in the accent; it
  opens and folds, only units in progress open at first, and the view
  keeps what the learner opened or folded while the course map opens and
  closes (`unitRows`). Open, a started unit lists its objectives with
  their forms and words, "Next" in the accent with the ringed form on the
  current objective of the card's unit (`currentObjective` in
  `src/shared/plan.ts`); a unit not started shows its goal, "Its
  objectives are set when it starts", Start (which asks first when a
  prerequisite is not finished) and "Test out"; one in progress has
  Continue; a finished one has Open and "Write notes", or "Notes" once
  saved. "Test out", there and under the card's "Start unit N", asks once,
  saying what the test is, then opens the unit with its test. A draft
  lists its units with their goals. "Course map" opens the diagram in the
  side pane; selecting a unit there lights its lines and scrolls the list
  to it. A crowded diagram (more than three lines across one row, `layOut`
  in `diagram.ts`) draws the lines between adjacent rows, and a unit's
  row-skipping lines only while it is selected, routed apart from the
  rest, with a line above saying so. If the pane is too narrow to keep the
  lines drawn at once apart, it lists prerequisites by unit number;
  selecting a unit still scrolls to it. The proposal and curriculum-change
  cards use the same diagram and fallback; when crowded, their nodes can
  be selected too. "Change the curriculum" at the right of the Units
  heading of an approved course opens its planning conversation. At the
  foot, "Delete this course" (or "draft") asks in place: plainly, or with
  what goes and a box for the title, the button off until the title
  matches; a refusal shows the server's reason there, and a deletion
  leads back to the library.
  If state or evidence cannot be read, the view shows the problem instead
  of progress and still offers deletion with a typed title.
- **Planning** (`/courses/<id>/planning`): the course's planning
  conversation in the thread's layout, opened or picked up when the view
  loads (`POST /api/courses/<id>/planning`). A heading reads "What comes
  next" on a finished course, otherwise "Changing the curriculum", with
  the number of units and that nothing changes until a proposal is
  applied; the page's opening question follows. Each proposal is the
  curriculum change card, its diagram in the side pane; a replaced one
  says so. Apply returns to the course view. After a restart the view
  says the conversation ended and nothing changed.
- **What I know** (`/courses/<id>/what-i-know`): each started unit's
  objectives with their status ("Retained" in teal, "Slipping" in peach)
  and, under each, its evidence in log order (question, answer,
  confidence, help, the assessment it was given in, grade with the
  grader's flaw, the right choice or expected answer of a question missed,
  why the grader graded a math answer, a code answer's files as run and
  its tests' output, date) and overrides, and above it each misconception
  found on it: what the learner believed, what is so, where it
  showed, ruled in peach and "Open" while the objective is not passed, grey
  and "Cleared" once it is; a rubric or a code question's tests and frozen
  inputs only while that answer is disputed. Each graded answer has
  "Dispute this grade" (`src/web/Dispute.tsx`), and a disputed
  one shows the verdict it now counts with, marked "after your dispute"
  when changed, with its first grade, the reason and the outcome. Once an
  outcome is in, the view is loaded again. Under the summary, the course's
  calibration shows, for each
  confidence level, how many unassisted answers were correct, "I don't
  know" apart.
- **Session** (`/courses/<id>/units/<unit>`): the top line has the path,
  ending in "Unit N" and the unit's title; the position, which opens the
  outline; and "Course map". On narrow screens the
  controls move below the path and the outline opens below both. The
  position (`whereInUnit` in `session.ts`) is "Segment N of M" with the
  segment's title, "Going over again", "Review" once a review is started,
  "Unit gate" from its card through the closing decision, "Testing out"
  through the questions, summary and result, or "Finished", with a tick
  per segment. While asking questions, a review and the gate show the
  question ("Question 2 of 4") and a test shows the objective ("Objective
  2 of 3"). The outline (`outline` in `session.ts`) lists the segments,
  numbered, with their objectives' forms: the current one "You are here",
  a past one how many of its objectives passed, one
  the test skipped struck through with "Passed in the test" (in one taught
  in part, the skipped objectives struck through); then "Going over
  again" once the unit has, and the gate, to come, here, taken or
  skipped. A past or current segment with a heading in the thread scrolls
  only the thread to it, focuses it and lights it briefly; no smooth
  scroll or fade under reduced motion. "Going over again" jumps to the
  latest time. The outline ends with "Export transcript" and "Start
  fresh". The thread renders
  Markdown and math; a heading where each segment begins, with "Segment N
  of M" (or "Going over again" for the extra segment), its title and its
  objectives' status forms as they stand now, the current objective
  ringed and marked for assistive technology in the latest heading only;
  each heading has an id the outline jumps to (`PhaseItem` in `timeline.ts`).
  Earlier sessions have headings too: a phase begins a segment when the
  previous phase was in another segment or closed its own. A chat that
  opens where the thread is, as after a fresh start, adds no phase and no
  heading. The test before a unit, and any review before that test, come
  before the first segment heading. The first segment taught begins where
  the learner answers the result; a skipped segment has no heading.
  Teach, discuss, check and done are hairlines with a label, as are the
  other markers. A graded card's verdict is one line under a hairline:
  the word coloured, then how sure, help taken and the expected answer
  of a miss, and "Dispute this grade" at its end. One next-step control
  where the thread
  has reached; the open question pinned above the message box until it is
  graded or withdrawn (only a question of what is under way: a review's
  while it runs, the check's otherwise), then moved to where it was
  answered, with Hide,
  which shrinks it to one line with Show until the next question. When
  these controls are tall, they scroll separately so the thread stays
  visible. The thread shows the help notice above the message box and
  the judge's call under each reply; a line for each file the tutor
  writes with its file tools, once a reply, with its path in the
  workspace; a package request's card
  with its packages, Install and "Not now", and its commands
  and folder under a closed "Show the command"; then the outcome, with
  the output's end under "Show the output", open only when the install
  failed. If saving fails, the
  card offers Retry saving without another install. A proposed style
  note's card (`StyleCard.tsx`) gives the tutor's line on why and the
  whole note, each new sentence marked and each dropped one listed as the
  intake card marks a changed profile, with Apply and "Keep the current
  one"; then the answer. A proposed curriculum change's card
  (`CurriculumCard.tsx`) gives the line on why and the units as they
  would be, with additions, edits and moves marked in the list and
  diagram. It lists dropped units below the list. "Show the diagram"
  opens the proposed diagram in the side pane. Apply and "Keep the
  current one" decide the proposal, and the card records the decision.
  The thread also has the detour marker, "Ready for another question" and
  the closing card.
  Selecting text within one of the tutor's replies or one question's
  prompt offers "Quote" over it (`QuoteOffer.tsx`, `quote.ts`), which puts
  the passage after the draft as Markdown quote lines
  (`src/shared/quote.ts`) and focuses the box at its end. Each formula
  comes back as its TeX, with whitespace intact and the formula whole
  when the selection starts or ends inside it. Code, lists and tables
  keep their structure; emphasis does not. The thread and transcript
  export render `> ` lines outside the learner's fenced code as a quote
  and the rest as typed. The tutor gets the message as sent.
  Review is a card in the thread, with how many questions,
  Skip and "Start the review", which holds the unit's own control until
  it is answered and becomes a marker once started or skipped; a review
  question's head says which of how many it is, "second question" after a
  miss, and the unit of another unit's objective; "Skip review" sits
  beside its question or detour, whose control after a second miss reads
  "Go on with the review", or "Finish the review" at the last; its end is
  a marker with how many objectives are retained and slipping and where
  the unit goes on. The gate is the same parts: its card names
  the unit and says how many questions are on its objectives and how many
  on which other units', with "Skip the gate", which asks once before it
  skips there and beside its questions (partway, with the answers given so
  far and that leaving instead keeps the gate for the next sitting,
  `skipGatePartway` in `src/web/session.ts`), and "Start the gate"; while it
  runs the top line reads "Unit gate". The closing card after it has a
  section, "Also asked, from other units", of those objectives with their
  units and statuses. Only the closing card standing at the thread's end,
  with no phase or assessment after it, offers its steps. The test
  is a marker, then question cards whose head reads "Objective 2 of 5",
  and "second question" after an unsure correct answer, with "Start
  learning instead" as the control. Its result card has a
  row per objective with why ("Right, 90% sure", "Right once, 50% sure,
  then missed"), then what skipping would do to each segment (skipped,
  taught in part with what it still teaches, taught), and "Teach me the
  whole unit" and "Skip what I passed" ("Finish the unit" when everything
  passed; "Start the unit" alone when nothing did); once answered it is
  one line, with where teaching starts. A skipped segment's tick in the
  top line is hollow.
  A math question is answered in a one-line field whose expression is shown as
  math beneath it as it is typed. A code question's card names
  each file to edit by its full path, with "Copy path" and "Open", and says
  the tests are not shown. "Open" has the server open the file in the
  system's default app for it (`xdg-open` on Linux, `open` on macOS),
  outside the sandbox, and leave the app running. Why it could not shows
  under the button, including that a server started outside the desktop
  session has no display to open it on. "Run the tests", with how sure, is
  the answer, and the graded card shows the end of the tests' output.
  A graded card can be disputed in place, as in "What I know"; its outcome
  also comes over the event stream (`disputed`), so a dispute raised in
  either view shows in the other. Keys: A to F pick a choice, 1
  to 5 how sure, Enter submits; Enter in the math field submits, or moves
  to how sure if that is not picked. A confidence shortcut there returns
  focus to the math field. The view posts `open`, follows `events`, and
  opens the unit again if the stream answers 404 (the chat was lost).
- **Rendering** (`src/web/prose.tsx`): model text and the learner's answers
  become React elements, never HTML. Raw HTML shows as text, images are
  never fetched, unsafe links lose their address, and KaTeX runs with its
  `trust` option off.
- **Artifacts** open in the side pane beside the session's thread, one at
  a time. A new artifact since the page opened opens at once,
  even before its event stream connects; restored transcript references
  do not. Esc, Close or the thread reference closes it. The pane holds one
  thing: an artifact, a proposed curriculum's diagram, or the course map,
  each replacing the one before. "Course map" in the top line opens and
  closes the course's diagram, with its fallback list (as in the course
  view), each unit's status form and word, and this unit alone in the
  accent, ringed, "You are here", scrolled into view (`mapMark` in
  `progress.ts`); its lines are lit, and in a crowded diagram shown, until
  another unit is selected, which opens nothing. Only same-origin
  iframe requests get HTML; a direct URL shows inert text. The frame and
  the response policy sandbox HTML to its own origin with scripts allowed.
  The parent page's `frame-src 'self'` prevents the frame from navigating
  away. WebRTC is not blocked (`decisions.md`, "Confinement").
  The HTML served to the frame starts with a one-line script
  (`withReporter` in `http/artifact-frame.ts`) that posts the aid's first
  uncaught error or unhandled rejection to the page (`ArtifactReport` in
  `src/shared/artifact.ts`); the record keeps the document as written. The
  page takes a report only from the frame it shows (`frameReport` in
  `src/web/artifact.ts`), shows the error above the aid, and offers "Send
  the error to the tutor", which posts it once as the learner's message
  (`errorMessage`), not while the tutor is writing. In WebKit the error
  reaches the page only as "Script error." (`decisions.md`,
  "Confinement").
- **Notes** (`/courses/<id>/units/<unit>/notes`): a finished
  unit offers notes on its closing card, or on the result card when it
  tested out of whole. The reader shows the saved HTML in a sandboxed
  frame with no scripts, with its date, instructions and file path above.
  "Open in browser" uses the system file opener. A write can be followed
  after leaving and returning; "Try again" uses the failed attempt's
  instructions, and "Write again" takes new instructions.

The look and layout were settled with static mocks in `docs/prototype/`,
a file per piece (start at `index.html`); the picks are in `decisions.md`,
"Page design". `src/web/styles.css` has the redesign's look
(`prototype/look.css`): every colour is a named role in one block, and
the type registers are rule groups near its top. CMU Serif is served from
`src/web/fonts/` with its licence; IBM Plex Sans and Mono come from Google
Fonts (`src/web/index.html`).

**Routes** (`src/server/http/app.ts`; bodies are schemas in `src/shared/`,
mainly `events.ts`, `library.ts`, `what-i-know.ts`, `profile.ts` and `notes.ts`):

- `GET /api/profile` (the text and the finished courses) and `POST
  /api/profile` with the new text and the one it replaces (409 if that is
  no longer the profile).
- `GET /api/courses`, `GET /api/courses/<id>` (with each unit's progress),
  `GET /api/courses/<id>/what-i-know`, `GET
  /api/courses/<id>/artifacts/<file>`, `POST /api/courses/<id>/review`
  (the intake for a draft), `POST /api/courses/<id>/delete` with the
  course `instance` and the typed `title` when required (409 with the
  reason when refused).
- `POST /api/courses/<id>/questions/<question id>/open` with `{ file }`,
  the file's place in the list of an open code question of the course:
  opens it if it is a plain file in the workspace (409 when it is not;
  502 with the opener's reason when the opener fails).
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
  (with the request's id), `style/apply`, `style/keep`,
  `curriculum/apply` and `curriculum/keep` (with the proposal's id),
  `override`, `next-segment`, `go-over-again`, `finish`, `start-fresh`,
  `interrupt`, `assessment/start` and `assessment/skip` (which is the
  test's "Start learning instead"), `test-out/skip` and `test-out/whole`.
  `test-out` opens a unit not started with its test, in place of `open`.
  A unit not opened since the server started answers 404 on these chat
  routes except `open` and `test-out`.
- `GET /api/courses/<id>/units/<unit>/transcript` downloads the unit's
  recorded thread as one HTML file (section 4, "Sessions and
  transcripts"); it needs no open chat.
- Under `/api/courses/<id>/units/<unit>/notes`: `GET` reads metadata and
  the current attempt, `POST` starts a write (202), `GET /html` serves the
  finished document as HTML only to a same-origin iframe (inert text
  otherwise), and `POST /open` opens the saved file on disk. None opens
  or requires the unit's chat.
- An event stream replays its chat's log with ids `<log id>.<index>`, so a
  page that reconnects gets only what it missed. It starts with `hello`,
  outside the log: the chat's id and the index of the log's last event,
  so the page knows which events happened while it was open.
- A refusal or failure answers with `{ error }`, the reason, and a 4xx or
  5xx status.
- The server listens on `127.0.0.1` only, refuses host names other than
  `localhost`, `127.0.0.1` and `[::1]`, and refuses a POST whose `Origin`
  is not its own page.

## 11. Testing

- **Automated (Vitest)**: tests sit beside the code. Expected results come
  from worked examples written by hand. Engine flows run on the fake
  backend; idle closing runs on a fake timer (`engine/fake-timer.ts`) that
  the test moves on; choice order is fixed with `order: givenOrder`. The
  sandbox's tests, those of math questions, which run the real symbolic
  check, and those of code questions, which run pytest with
  `pytools/.venv` standing in for a workspace's, run real commands in it,
  so they need what it needs and fail where it cannot run. A test of code
  that reads the page's DOM, such as a selection's, runs in happy-dom,
  named in its file's first line (`// @vitest-environment happy-dom`).
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
[plan](plan.md). Stages 0 to 3 and 5 are finished; stage 4 comes next,
after the follow-up tasks stage 5's check added.

| Stage | Scope |
| --- | --- |
| 0. Spike and skeleton | Toolchain; a page that streams a Claude reply on the plan login and round-trips a question; a Codex spike |
| 1. Record and library | Data root, course creation by intake, review and approval, diagram, library |
| 2. Session engine | Unit planning, phases, choice and rubric-graded questions, confidence, evidence, derived status, override, detours, help judging, resume, transcripts, math rendering, backup, "What I know", calibration |
| 3. Checked grading and aids | SymPy check, workspace and code tests, installing a course's packages, artifacts pane, disputes, the tutor's built-in tools |
| 5. Mastery loop (before 4) | Unit gate with earlier objectives, testing out of a unit, review questions at the start of each sitting, retained and slipping status, the misconception record, handoff notes, the learner profile, HTML notes, transcript export, style and curriculum changes |
| 4. Sources (after 5) | Ingestion for the four formats, outline, unit mapping, `quote_source`, citation view, page images, web search setting |
| 6. Later | Codex backend; a model chosen in the app's settings; self-test, on a scope the learner picks (a segment, a unit, the course, or a random mix of what they have passed) and the kinds of question they pick; teaching instructions the learner can add to or edit, app-wide, with what the app relies on fixed and the shipped prompt kept to revert to; cheat sheets; photo input; starred messages for the notes, if the generated notes miss what the learner wants kept |

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
