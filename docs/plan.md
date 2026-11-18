# Gauss: build plan

Open work only. Status values: `todo`, `in progress`, `blocked` (say why).
`AGENTS.md` says how to work a task. A finished task is deleted from this
file; its text and its checks are in its commit (`git log --grep='^2\.13'`).

Each stage is broken down by its first task (`N.0`) when it starts, because
each finished stage changes the details. Stage scope comes from
`architecture.md` section 12. Stage 5 is built before stage 4, by the
user's choice; the numbers are kept because code and documents use them.

## Finished

- Stage 0, spike and skeleton: the user's check passed on 2026-11-15.
- Stage 1, record and library: passed on 2026-11-15.
- Stage 2, session engine: passed on 2026-11-17, at the second try (the
  first added tasks 2.18 to 2.22). A review of the record then added tasks
  2.23 to 2.29 (`decisions.md`, "Product decisions").
- Stage 3, checked grading and aids: passed on 2026-11-18. The user's
  notes from the check added tasks 3.19 to 3.22 (`decisions.md`, "Product
  decisions").

Still to observe from stage 2: an objective passed by two unsure correct
answers. The stage 3 check did not show one.

## Stage 5: mastery loop (built before stage 4)

The scope is `architecture.md` section 12's: review questions, the unit
gate, testing out of a unit, retained and slipping status, handoff notes,
the misconception record, the learner profile, unit notes, transcript
export, and style and curriculum changes. The choices behind this
breakdown are in `decisions.md`, "Mastery loop". They are the agent's; 5.1
puts those that change the experience to the user, and a pick that differs
revises the tasks after it. Not in this stage: sources and web access
(4.0), self-test and cheat sheets (stage 6).

**User check:** one course runs from intake to a closed second unit: a unit
tested out of or started, review questions at the start of a later sitting,
a detour, a unit gate, generated notes and an exported transcript.

### 5.1 Designs the stage needs

- Status: todo
- Depends on: stage 3
- Why: review, the gate, testing out, the notes and the profile have no
  page design (`decisions.md`, "Page design"), and each holds a choice
  that is the learner's to make.
- Do: mocks in `docs/prototype/`, built as the earlier pieces were, each
  with the agent's recommendation marked and the rest shown as the agent
  would build it.
  - Piece 15, review questions. Ask: whether review starts by itself when
    a unit is opened in a new sitting, with "Skip review" beside it
    (recommended: it is the user's "on by default"; it spends a tutor's
    turn at each such opening), or waits behind a card with Start and
    Skip; and whether a miss opens a detour and one more question on the
    objective (recommended, as the brief has it for the gate) or only
    shows the right answer. Show: the marker that opens the review and
    the one that returns to the segment, a question card as in a check,
    feedback of a sentence or two.
  - Piece 16, testing out and the gate. Ask where testing out is offered:
    beside Start on a unit not started, in the course view (recommended:
    Start stays one click), or on a card each time a unit first opens.
    Show: the test, with no feedback between questions, and what it ends
    in (segments skipped, or the unit finished); the gate's card once the
    unit's teaching is over, with how many questions it has, Start and
    "Skip the gate"; the closing card after it; retained and slipping on
    the closing card, in "What I know" and on the course view's unit
    rows, with their words and colours.
  - Piece 17, notes and export. Ask: notes written when a unit finishes
    (recommended) or only on request. Show: a unit's notes in a reader,
    with their parts (each objective's idea, a worked example from the
    sessions, what the learner got wrong and its correction); a finished
    unit's row in the course view with "Notes" and "Open"; "Export
    transcript" in the unit's outline, and the exported document.
  - Piece 18, the profile. Ask who writes it: the planner proposes its
    text on the proposal card, approved with the curriculum, and a
    Profile page lets the learner edit it at any time (recommended); the
    learner alone, on that page; or Gauss without asking. Show: the
    card's section, marked when changed; the page; a recorded
    misconception under its objective in "What I know".
  - The brief's wording, to confirm with the picks: a handoff note is
    written when a segment closes, not at a session's end; review asks
    slipping objectives before the least confident passes; a miss while
    testing out does not count against the objective afterwards.
- Done when: the user has picked an answer to each question; the picks are
  in `decisions.md` ("Page design", and "Product decisions" for the
  rules); `docs/prototype/index.html` lists the new pieces; `brief.md`
  has the wording the user agreed to; the tasks below are revised where a
  pick differs from the recommendation.

### 5.2 Retained and slipping

- Status: todo
- Depends on: 5.1
- Why: "passed" is evidence from minutes after the teaching. The brief's
  second tier needs to know where an answer was given, and a miss after a
  pass must not turn a finished unit into one half-written.
- Do: an answer's evidence says which assessment it was given in
  (`review`, `gate` or `test-out`; absent for a segment's check, and in
  every record so far). `record/status.ts`, as `decisions.md`, "Mastery
  loop" defines them: retained is passed with, since the last miss, an
  unassisted correct answer given in a review or a gate; slipping is an
  objective that had passed, was then missed, and has not passed again;
  a miss while testing out counts as an answer but not as a miss. A
  finished unit stays finished with slipping objectives. Everything that
  switches on a status takes the two new ones: the closing card's list
  of objectives not passed (slipping is not passed), unit progress, the
  unit planner's status list, "What I know" (which also says where each
  answer was given) and the course view, worded and coloured as 5.1
  settled. The dev seed gets a course with a retained and a slipping
  objective.
- Done when: tests on hand-worked logs pass: retained by a review answer
  and by a gate answer, not by one given testing out or with help;
  slipping after a miss that follows a pass, then passed again after two
  correct answers, and retained when one of them was in a review; a miss
  while testing out followed by one confident correct answer passes; a
  disputed review answer counts with its dispute's verdict; a finished
  unit with a slipping objective stays finished; a record with no
  assessment named reads as before. `mise run check` passes; on `pnpm
  dev:fake` "What I know" and the course view show both statuses, and
  the browser is closed before the server stops.
- Note: the rule that an overturned pass in a finished unit records an
  override stays (`decisions.md`, "Disputes"): that objective never
  passed, so it is not slipping.

### 5.3 What review asks, and what was asked before

- Status: todo
- Depends on: 5.2
- Why: review and the gate ask about objectives the engine picks, and the
  tutor asked for a question has to know the ones already asked: a new
  tutor session repeats a check's problems today, since nothing lists
  them, and review must ask a fresh question each sitting.
- Do: a pure function in `record/` that picks objectives for review from
  the course's plans and evidence at a given time. Only objectives that
  are passed, retained or slipping, and whose last answer is more than an
  hour old (`SESSION_GAP_MS`); slipping first, then passed ones by the
  lowest confidence among the answers that passed them, the longest
  unanswered first among equals, then retained ones, the longest
  unanswered first; up to a count, and without the objectives the caller
  leaves out. Every turn that allows a question lists, for each
  objective it may be on, the questions the evidence holds on it: the
  latest six, each on one line and shortened as `disputeNote` shortens a
  prompt.
- Done when: tests on hand-worked records cover each rule of the order
  and its ties, the hour, the count and the objectives left out; tests
  cover the turn's list (none, several, more than six, a prompt with
  line breaks and a "]", which must not end the header for the scripted
  backend); `mise run check` passes.

### 5.4 Review questions

- Status: todo
- Depends on: 5.1, 5.3
- Why: the brief's review at the start of each sitting, and the mechanism
  the gate and testing out share: questions without teaching, on
  objectives the engine picks.
- Do: as 5.1 settles; with its recommendations:
  - An assessment runs in the unit's thread, asked by the unit's tutor.
    It is kept in the unit's position beside the phase, which it leaves
    alone (its mode, its objectives, where it began in the evidence), so
    a restart reopens it and the unit goes on where it was once it ends.
    In it `ask_question` is allowed on its objectives only, in any phase;
    answers are recorded with its mode; help is judged as in a check;
    "ready", the next segment and moving on are refused until it ends or
    is skipped.
  - Its rules, in a module of their own beside `check-rules.ts`: each
    objective gets one question. A correct answer gets feedback of a
    sentence or two, then the next objective. A miss opens a detour as in
    a check; when the learner ends it, the objective is asked once more,
    and the assessment then moves on whatever the answer (a second miss
    opens its detour, and no third question follows).
  - Review starts when a unit not finished is opened (the `open` route)
    and all of these hold: the chat is new or has been quiet for an hour;
    nothing waits on the learner (no open question, detour, kept answer,
    package request or closing card); the course has had no review in
    the last hour, started or skipped (kept in `course.json`); and 5.3's
    pick of three, over the whole course, is not empty. A marker opens
    it and the tutor is asked for the first question. "Skip review" ends
    it at any point, withdrawing an open question with nothing recorded
    for it. When it ends, a marker says the unit goes on, and a teaching
    turn that waited is sent.
  - The turns' wording in `unit-turns.ts`; a section of `tutor.md` on
    assessments, drafted here and finished in 5.13: no teaching, one
    question per turn, each unlike those listed as asked, feedback of a
    sentence or two; the page's markers and "Skip review"; the route;
    the scripted backend, which reads the new headers; a seeded course
    with objectives passed more than an hour before.
- Done when: fake-backend tests cover: review starting when it is due,
  and not when each condition fails; one question per objective; a miss,
  its detour, the second question and moving on after it; a skip with a
  question open; a restart in the middle; an answer on another unit's
  objective recorded on that objective with the mode; the unit going on
  from each phase, the teaching turn sent after a review that came
  first; two units opened within the hour getting one review. Route
  tests pass; `mise run check` passes; on `pnpm dev:fake` a review is
  answered, skipped in another sitting, and missed once, and the browser
  is closed before the server stops; one short run on Haiku 5.5 where
  unit 2's tutor asks a review question on a unit 1 objective that
  differs from the ones listed.
- Note: an assessment reopened with no question open and no detour asks
  for its next question; do not carry over the check's gap, where a
  restart leaves it waiting for a message (`decisions.md`, "Known gaps").
  The scripted backend's file names collide across units ("Known gaps"):
  fix that here, since review has one unit's tutor ask about another's
  objective.

### 5.5 The unit gate

- Status: todo
- Depends on: 5.4
- Why: the check that closes a unit, and with review the only source of
  retained (brief, "Mastery and evidence").
- Do: the unit's end, in three steps:
  - First, as now: the last segment closes, and with objectives not
    passed the closing card offers to go over them again or to move on
    without them, which records the override.
  - Then the gate's card, once per unit and kept in the position: how
    many questions, Start and "Skip the gate". The gate is an assessment
    (5.4) over the unit's objectives that are passed and not yet
    retained, leaving out those passed by testing out, and up to three
    from the course's other units by 5.3's pick. A unit with nothing to ask gets no card. "Skip the
    gate", on the card or in the gate, goes to the last step; what was
    passed stays passed, not retained.
  - Last, the closing card with the statuses as they now are. If the
    gate left objectives of the unit not passed, it offers the same two
    steps, and going over them again does not bring a second gate.
    Otherwise the unit is finished, as it is today.
  - `tutor.md`'s section on assessments covers the gate; the scripted
    backend and the seed reach one.
- Done when: fake-backend tests cover: the card after the last segment
  when everything passed, and after moving on without the rest; a gate
  answered correctly leaving its objectives retained and the unit
  finished; a skip finishing the unit with nothing retained; a miss on
  the unit's own objective (detour, second question, the closing card
  listing it, going over it again, no second gate); a miss on another
  unit's objective leaving it slipping and that unit finished; a restart
  at the card and in the gate; no card when nothing can be asked. `mise
  run check` passes; on `pnpm dev:fake` a second unit is closed through
  its gate with an objective of the first in it, and the browser is
  closed before the server stops; one short run on Haiku 5.5 through a
  gate.

### 5.6 Testing out of a unit

- Status: todo
- Depends on: 5.4
- Why: the brief's replacement for the baseline quiz: a learner who knows
  a unit's material should not sit through it.
- Do: as 5.1 settles; with its recommendation, "Test out" beside Start on
  a unit not started. It opens the unit, which is planned as any unit is
  (objectives exist only then), and starts an assessment over all its
  objectives in place of the teaching turn; a review that is due comes
  first. Its rules differ from 5.4's: no feedback turn and no detour;
  the turn that brings a grade asks for the next question. A correct answer at 90% or 100% passes the
  objective and ends its questions; a correct answer below that gets a
  second question; a miss ends its questions. When it ends, or the
  learner presses "Start learning instead", the tutor says in a few
  sentences what the test showed. If every objective passed, the unit is
  finished, with no gate. Otherwise teaching starts at the first segment
  with an objective not passed: a segment whose objectives all passed is
  skipped, and one with a passed objective teaches and checks only the
  other, the tutor told what the learner showed. Which objectives a
  segment leaves out is fixed when it starts and kept in the position,
  as `again` is. The page shows the skipped segments as skipped.
  `tutor.md`'s section covers the test; the scripted backend and the
  seed reach one.
- Done when: fake-backend tests cover: every objective passed and the
  unit finished untaught; a partial result, with a segment skipped and a
  segment of two objectives teaching one; a second question after an
  unsure correct answer; a miss with no detour, after which one
  confident correct answer in the segment's check passes; "Start
  learning instead" partway; a restart in the test; the unit's gate
  later leaving out what the test passed. `mise run check` passes; on
  `pnpm dev:fake` a unit is tested out of in part and its first taught
  segment starts, and the browser is closed before the server stops;
  one short run on Haiku 5.5 through a test.

### 5.7 Handoff notes and the misconception record

- Status: todo
- Depends on: 5.4
- Why: a new tutor session knows the position and the evidence but
  nothing of how the unit was taught, and what a detour uncovers is lost
  once its conversation is. A session's end is no event the engine sees
  (the server stops, or an hour passes), so the note is written when a
  segment closes.
- Do: a one-shot call, the handoff writer (`prompts/handoff.md`, its
  reply's schema in `src/shared/`), when a segment closes, by passing or
  by moving on, and when a unit finishes; outside the chat's queue, as
  the help judge runs. It reads the unit's thread since the call before
  (the tutor's text, the learner's messages, the questions with their
  answers, confidence and grades), the note before and the unit's
  objectives. `scriptedReply` in `scripted.ts` answers the new request.
  - It writes the unit's handoff note, whole, in place of the one before
    (`units/<unit-id>/handoff.md`), within about 250 words: what was
    taught and with which examples, what the learner found hard or asked
    for, what was left open.
  - It writes the misconceptions it finds, appended to
    `misconceptions.jsonl` (schema in `src/shared/`): the objective, what
    the learner believed, what is so, and where it showed (a detour's
    question by id, or the discussion, where the intuition question is).
    A confident wrong answer is named as one in what it reads.
  - A call that fails records nothing, and the next one covers its
    stretch. A misconception is open while its objective is not passed,
    which is derived, not stored. The call runs on Haiku 5.5 until 5.13
    has compared.
  - Read by a new tutor session's first turn, with the note that it is
    new: the unit's handoff note and its open misconceptions.
  - Read by the tutor's system prompt and the unit planner's turn, as
    they stand when the chat opens or the unit is planned: the last
    handoff notes of the unit's prerequisites, and the open
    misconceptions on other units' objectives.
  - Read by the turn that asks for a review or gate question: the
    misconceptions recorded on its objective, open or not.
  - Shown in "What I know", under the objective, as 5.1 has it.
- Done when: fake-backend tests cover: a call at a segment's close and at
  the unit's end with the stretch it is given; a note replacing the one
  before; misconceptions appended, and open or not by the objective's
  status; a failed call, and the next one covering both stretches; a
  fresh start's first turn carrying the note; the planner's turn and the
  system prompt of a later unit; the review turn naming a misconception.
  `mise run check` passes; on `pnpm dev:fake` a detour's misconception
  shows in "What I know" after its segment closes, and the browser is
  closed before the server stops; one short run on Haiku 5.5 with a
  detour, then Start fresh, the note and the misconception read by eye.
- Note: the tutor's system prompt is sent with every request, and a
  change to it costs the session's cache. So what changes while a unit
  runs (its own note and misconceptions) goes into a new session's first
  turn, never into the system prompt.

### 5.8 The learner profile

- Status: todo
- Depends on: 5.1
- Why: each intake asks for the learner's background again, and what
  holds across courses (what they know, how they like to be taught) has
  no place to live.
- Do: as 5.1 settles; with its recommendation: `profile.md` in the data
  root, plain text with a length limit. The planner is given it, with
  the titles of the finished courses (derived from the record, not kept
  in the file), and is told not to ask what it already answers.
  `propose_curriculum` takes the profile's whole text, changed or not;
  the proposal card shows it as a section, marked when changed; approval
  writes it with the rest, and refuses with the reason if `profile.md`
  changed since the proposal was made. A Profile page, reached from the
  library, shows the text and lets the learner edit it. The tutor's and
  the unit planner's prompts get it under "The learner", before the
  course's background note. `planner.md` gets the lines the planner
  needs: what belongs in the profile (what holds across courses) and
  what in the background note (this course). The scripted backend
  proposes one.
- Done when: tests cover: the planner's turn with a profile and without;
  a proposal's profile shown, revised and written on approval; an
  approval refused after the file changed; the page's route reading and
  saving it, with the length limit; the tutor's system prompt with it.
  `mise run check` passes; on `pnpm dev:fake` a second intake's card
  shows a changed profile, it is approved and then edited on the page,
  and the browser is closed before the server stops; one short intake
  on Haiku 5.5 with a profile, which is not asked what it answers.

### 5.9 Unit notes

- Status: todo
- Depends on: 5.1, 5.5, 5.7
- Why: the brief's notes per finished unit, kept where the learner can
  open them without the app.
- Do: as 5.1 settles; with its recommendation: a one-shot call, the notes
  writer (`prompts/notes.md`; Sonnet 5.5, since the notes are kept), when
  a unit that was taught finishes, outside the chat's queue. It is given
  the unit's goal and plan, the tutor's teaching and the discussion from
  the transcripts, the questions missed with their right answers, the
  handoff note and the unit's misconceptions, and writes Markdown with
  `$` math within a length limit. The engine keeps the Markdown and
  renders it to `notes/<unit-id>.html`, a document with no script that
  loads nothing: a renderer on the server that 5.10 shares, on unified
  with remark-parse, remark-gfm, remark-math, remark-rehype, rehype-katex
  set to write MathML, and rehype-stringify, with the page's colours
  inline. Raw HTML in the text is dropped. The notes open in the reader
  5.1 shows, served as artifacts are. The closing card says the notes
  are being written, then offers them, or says why not, with "Try
  again". In the course view a finished unit with notes shows "Notes"
  and "Open"; one without shows "Write notes", which also serves a unit
  tested out of and one finished before notes existed. `scriptedReply`
  answers the new request.
- Done when: tests cover the renderer (math as MathML, a table, raw HTML
  and a script dropped, no address to load in the output), the notes
  written at a unit's finish and what the writer is given, a failed
  call and "Try again", no call for a unit tested out of whole, and the
  route's headers. `mise run check` passes; on `pnpm dev:fake` a unit's
  notes open from the closing card and from the course view, the file
  opens from the folder with its math shown, and the browser is closed
  before the server stops; one run on Haiku 5.5 to see the flow (5.13
  reads notes written by Sonnet).
- Note: the renderer's packages are new direct dependencies; all but
  rehype-stringify are installed already under react-markdown. Look each
  up with context7, and name them in the report and in `architecture.md`
  section 2. KaTeX's HTML output needs its stylesheet and fonts, which a
  standalone file cannot load; MathML needs neither (`decisions.md`,
  "Confinement", made the same choice for artifacts).

### 5.10 Transcript export

- Status: todo
- Depends on: 5.9
- Why: the brief's "every session can be exported as a document".
- Do: a route that answers with one standalone HTML document of a unit's
  whole thread, each session under its date: the tutor's text, the
  learner's messages, each question with its answer, confidence, grade
  and, on a miss, the right answer, the markers (phases, detours,
  review, the gate, a fresh start), artifacts by their titles, and the
  files the tutor wrote. Transcripts hold no grading material, so
  neither does the document. It is built from the sessions' page events
  with the thread logic the page uses (`src/web/timeline.ts` is pure;
  move what both sides need to `src/shared/`), and 5.9's renderer.
  "Export transcript" in the unit's outline downloads it, in a finished
  unit too.
- Done when: tests cover a transcript holding each kind of event against
  the document's parts, two sessions, a fresh start, and the route.
  `mise run check` passes; on `pnpm dev:fake` the exported file of a
  unit with math, a missed question and a detour opens from the folder
  and reads as the thread does, and the browser is closed before the
  server stops.

### 5.11 Style changes

- Status: todo
- Depends on: stage 3
- Why: the brief lets the learner change the style by saying so, and the
  tutor suggest a change, but nothing can write `style.md` after
  approval.
- Do: `propose_style` takes the whole revised note and a line on why.
  It shows a card in the thread with the changes marked, Apply and "Keep
  the current one", kept in the position as a package request is, and
  does not end the turn. Refused while a question is open or another
  proposal waits. Apply writes `style.md` and asks for a backup commit.
  The tutor is told the answer in its next header, with the new note's
  text, since a running session keeps the system prompt it was opened
  with. `tutor.md` gets the lines: when the learner asks for a change,
  propose the note that makes it; a change the tutor wants is proposed
  the same way; never teach to a note the learner has not applied. The
  scripted backend proposes one on "/style".
- Done when: fake-backend tests cover a proposal applied (the file, the
  header, the system prompt of a session started after it) and kept,
  the refusals, and a restart with a card waiting. `mise run check`
  passes; on `pnpm dev:fake` a proposal is applied and one kept, and the
  browser is closed before the server stops; one short run on Haiku 5.5
  where the learner asks for shorter explanations and applies the card.

### 5.12 Curriculum changes

- Status: todo
- Depends on: 5.11
- Why: the brief's changes mid-course (a remedial unit, a unit the
  learner asks for); a course's units cannot change after approval
  today.
- Do: `amend_curriculum` takes the whole unit list, as
  `propose_curriculum` does, and a line on why. Refused, with the
  reason, if it drops a unit that is started or finished, changes such a
  unit's id, or breaks the curriculum's own rules (prerequisites, ids);
  and while a question is open or another proposal waits. It shows a
  card in the thread, built from the intake card's parts: the units with
  what changed marked, the diagram, Apply and "Keep the current one".
  Apply writes `curriculum.json`, keeping every kept unit's plan, and
  asks for a backup commit; the course view and the diagram follow. The
  tutor is told the answer in its next header. `tutor.md` gets the
  lines: propose a change when the learner asks for one, or when
  slipping objectives or a detour show a missing prerequisite; say why.
  The scripted backend proposes one on "/amend".
- Done when: fake-backend tests cover a unit added and applied, one
  kept, each refusal, plans surviving a change, and a restart with a
  card waiting. `mise run check` passes; on `pnpm dev:fake` a unit is
  added from a session and started from the course view, and the
  browser is closed before the server stops; one short run on Haiku 5.5
  where the learner asks for a unit and applies the card.

### 5.13 Prompts for the stage

- Status: todo
- Depends on: 5.2 to 5.12
- Why: each prompt above was drafted to make its task's checks pass; how
  well the tutor examines, and what the handoff and notes writers keep,
  shows only on a model whose judgment is the point.
- Do: one course of two units on Sonnet 5.5 and a scratch data root, run
  through a review, a detour in it, a test, a gate, Start fresh after a
  closed segment, and a unit's notes. Read the session logs and the
  record, and revise `tutor.md` (assessments, style and curriculum
  proposals), `handoff.md`, `notes.md`, `planner.md` and
  `unit-planner.md` for what they show: review and gate questions that
  are on their objective and unlike those listed; no teaching in an
  assessment; a handoff note from which the fresh session picks up
  without asking the learner what was covered; misconceptions true to
  their detours, and none invented; notes that hold what was taught and
  nothing that was not. Run the handoff writer on the same stretches on
  Haiku 5.5 and Sonnet 5.5 and keep the cheaper if it holds up.
- Done when: the findings and the model choice are in `decisions.md`,
  "Prompts" and "Mastery loop"; `mise run check` passes, and the
  scripted backend's tests with it, since it reads the headers; the
  graders' and judges' sets are re-run only if their prompts changed.

## Stage 4: sources (built after stage 5)

### 4.0 Break down the stage

- Status: todo
- Depends on: stage 5
- The breakdown must settle (`decisions.md`, "Sources"):
  - the section size limit, by trying candidates on real files: a long
    stretch with no headings (the _Phenomenology_'s Preface, if the user's
    edition has none), an arXiv paper and an EPUB;
  - the `outline.json` schema in `src/shared/`;
  - how the unit's planning session is given the unit's whole text;
  - fixture tests for the cut: the same ids on a second run, cuts only at
    paragraph boundaries, and a quote across a cut that still verifies;
  - quotes: until this stage a course quotes nothing verbatim from memory
    (`tutor.md`, "Quotations"); with a source, `quote_source` verifies
    them, and the rule changes;
  - reads are not confined: sandboxed commands, the tutor's and the
    engine's, can read most of the machine. `blockReadsOutsideWorkingDirectories`
    hides the home folder, where mise keeps `python` and `uv`, and let a
    command read beside the workspace (`decisions.md`, "Confinement");
    the sandbox's own read rules are untried. Settle it before the tutor
    gets web access;
  - an artifact can send data out through WebRTC, which its policy cannot
    block in Chromium (`decisions.md`, "Confinement"); with unconfined
    reads that is a channel out for a tutor misled by a source or a web
    page. Settle it with reads; DNS prefetch from an artifact is untried;
  - the account's email address reaches every Claude session
    (`decisions.md`, "Claude backend"): with web access, a request could
    carry it, as it could anything else in the context;
  - source page images stay out of the backup (`record/backup.ts`);
  - the grader's and the help judge's hand-made sets are math only, and
    need explanation answers from a source course;
  - stage 5 in a source course: the turn that asks a review or gate
    question on another unit's objective names that unit's sections, and
    a unit's notes cite the source.

**User check:** a lecture on one chapter of the _Phenomenology_ with verified
quotes, and one unit taught from a paper.

## Stage 6: later

Codex backend (`decisions.md`, "Codex"), self-test, cheat sheets, photo
input; starred messages for the notes, if the generated notes miss what the
learner wants kept. Each is planned when chosen.
