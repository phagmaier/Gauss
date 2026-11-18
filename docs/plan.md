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
breakdown are in `decisions.md`, "Mastery loop": the agent's, but for the
user's picks of 2026-11-18 ("Product decisions"), which the tasks below
follow. The stage's views are laid out in the mocks, pieces 15 to 18 of
`docs/prototype/` (`decisions.md`, "Page design"): a task that names a
piece builds what it shows. Not in this stage: sources and web access (4.0), self-test and
cheat sheets (stage 6).

**User check:** one course runs from intake to a closed second unit: a unit
tested out of or started, review questions at the start of a later sitting,
a detour, a unit gate, generated notes and an exported transcript.

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
- Depends on: 5.3
- Why: the brief's review at the start of each sitting, and the mechanism
  the gate and testing out share: questions without teaching, on
  objectives the engine picks.
- Do: laid out as piece 15 shows (`docs/prototype/15-review.html`):
  - An assessment runs in the unit's thread, asked by the unit's tutor.
    It is kept in the unit's position beside the phase, which it leaves
    alone (its mode, its objectives, where it began in the evidence), so
    a restart reopens it and the unit goes on where it was once it ends.
    In it `ask_question` is allowed on its objectives only, in any phase;
    answers are recorded with its `assessment` (its mode and the unit
    whose thread holds it, `Assessment` in `evidence.ts`); help is judged
    as in a check;
    "ready", the next segment and moving on are refused until it ends or
    is skipped.
  - Its rules, in a module of their own beside `check-rules.ts`: each
    objective gets one question. A correct answer gets feedback of a
    sentence or two, then the next objective. A miss opens a detour as in
    a check; when the learner ends it, the objective is asked once more,
    and the assessment then moves on whatever the answer (a second miss
    opens its detour, and no third question follows).
  - Review is offered, on a card, when a unit not finished is opened (the
    `open` route) and all of these hold: the chat is new or has been
    quiet for an hour; nothing waits on the learner (no open question,
    detour, kept answer, package request or closing card); the course
    has been offered no review in the last hour (kept in `course.json`);
    and 5.3's pick of three, over the whole course, is not empty. The
    card says how many questions, with Start and Skip, and is kept in
    the position; showing it sends the tutor nothing. The unit's steps
    and a teaching turn that waits hold until it is answered, and a
    message sent meanwhile skips it. Start puts a marker in the thread
    and asks the tutor for the first question. "Skip review" ends a
    review at any point, withdrawing an open question with nothing
    recorded for it. When it ends or is skipped, a marker says what it
    did to the record (how many retained, how many slipping) and where
    the unit goes on, and the teaching turn that waited is sent.
  - The turns' wording in `unit-turns.ts`; a section of `tutor.md` on
    assessments, drafted here and finished in 5.13: no teaching, one
    question per turn, each unlike those listed as asked, feedback of a
    sentence or two; the page's card, markers and "Skip review", and a
    question's head (which of how many, "second question", the unit of
    another unit's objective); the routes;
    the scripted backend, which reads the new headers; a seeded course
    with objectives passed more than an hour before.
- Done when: fake-backend tests cover: the card shown when a review is
  due, and not when each condition fails, with no turn sent; Start; Skip
  on the card, and by a message; one question per objective; a miss,
  its detour, the second question and moving on after it; a skip with a
  question open; a restart at the card and in the middle; an answer on
  another unit's
  objective recorded on that objective with the mode; the unit going on
  from each phase, the teaching turn sent after a review that came
  first; two units opened within the hour getting one card. Route tests
  pass; `mise run check` passes; on `pnpm dev:fake` a review is started
  and answered, skipped in another sitting, and missed once, and the
  browser
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
    - Then the gate's card, once per unit and kept in the position, as
    piece 16 shows: how many questions and on what, that it waits for
    another sitting, Start and "Skip the gate", which asks once before
    it skips, on the card and in the gate, since the gate is offered
    once. The gate is an assessment
    (5.4) over the unit's objectives that are passed and not yet
    retained, leaving out those passed by testing out, and up to three
    from the course's other units by 5.3's pick. A unit with nothing to ask gets no card. "Skip the
    gate", on the card or in the gate, goes to the last step; what was
    passed stays passed, not retained.
    - Last, the closing card with the statuses as they now are, and under
    them the other units' objectives the gate asked, with theirs. If the
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
- Do: "Test out" beside Start on a unit not started, laid out as piece
  16 shows: on the unit's row and under the card's "Start unit N". It
  asks once before it starts, saying what the test is and that
  what is passed can then be skipped; Start teaches the unit as before.
  It opens the unit, which is planned as any unit is (objectives exist
  only then), and starts an assessment over all its objectives in place
  of the teaching turn; a review that is due is offered first.
    - Its rules differ from 5.4's: no feedback turn and no detour; the turn
    that brings a grade asks for the next question. A graded card shows
    its verdict and the right answer as in a check, and a question's
    head says which objective it is on. A correct answer at
    90% or 100% passes the objective and ends its questions; a correct
    answer below that gets a second question; a miss ends its questions.
  - When it ends, or the learner presses "Start learning instead", the
    tutor says in a few sentences what the test showed, and a result
    card names what was passed and what that would skip: a row per
    objective with why, then each segment as skipped, taught in part or
    taught. Nothing is
    skipped until the learner answers it: one step skips what was
    passed, the other has the whole unit taught, and what was passed
    stays passed either way. With every objective passed, the first
    step finishes the unit, with no gate.
  - Skipping: teaching starts at the first segment with an objective not
    passed. A segment whose objectives all passed is skipped, and one
    with a passed objective teaches and checks only the other, the tutor
    told what the learner showed. Which objectives a segment leaves out
    is fixed when it starts and kept in the position, as `again` is. The
    page shows the skipped segments as skipped, in the outline and in
    the top line's ticks.
  - `tutor.md`'s section covers the test; the scripted backend and the
    seed reach one.
- Done when: fake-backend tests cover: every objective passed and the
  unit finished untaught once the learner agrees, and taught in full when
  they choose that; a partial result, with a segment skipped and a
  segment of two objectives teaching one; nothing skipped while the
  result card waits, across a restart too; a second question after an
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
    for, what made an idea click (the example or the wording after which
    they had it), and what was left open.
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
    - Shown in "What I know", under the objective and above its answers,
    as piece 18 has it: what the learner believed, what is so, where it
    showed, and "Open" or "Cleared".
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
- Depends on: stage 3
- Why: each intake asks for the learner's background again, and what
  holds across courses (what they know, how they like to be taught) has
  no place to live.
- Do: laid out as piece 18 shows: `profile.md` in the data
  root, plain text of at most 2,000 characters. The planner is given it, with
  the titles of the finished courses (derived from the record, not kept
  in the file), and is told not to ask what it already answers.
  `propose_curriculum` takes the profile's whole text, changed or not;
  the proposal card shows it as a section, marked "New" or "Changed",
  with each new sentence marked and each dropped one listed under the
  text (compared sentence by sentence, with no new dependency); approval
  writes it with the rest, and refuses with the reason if `profile.md`
  changed since the proposal was made. A Profile page, reached from the
  library's top line, shows the text and lets the learner edit it, with
  the finished courses listed under it. The tutor's and
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
- Depends on: 5.5, 5.7
- Why: the brief's notes per finished unit, kept where the learner can
  open them without the app. They are HTML so that each can be a designed
  page with figures (the user, 2026-11-18), not text in one fixed layout.
- Do: a finished unit offers notes; none are written unasked. Laid out as
  piece 17 shows (`docs/prototype/17-notes-and-export.html`): the closing
  card of a unit that finishes has "Write notes" with a line for the
  learner's own instructions, which may be left empty; the course view
  has the same on a finished unit without notes (one tested out of, or
  finished before notes existed, too).
  - The notes writer is a one-shot call (`prompts/notes.md`; Sonnet 5.5,
    since the notes are kept), outside the chat's queue. It is given the
    unit's goal and plan, the tutor's teaching and the discussion from
    the transcripts, the questions missed with their right answers, the
    handoff note and the unit's misconceptions, and the learner's
    instructions between tags. It writes one whole HTML document within
    a size limit: its own layout and styles, figures as inline SVG, and
    math as TeX in elements the engine draws. No script, and no address
    on the web.
  - `notes.md` says what every unit's notes hold: what each objective
    taught, with an example from the sessions; more room for what the
    learner struggled with (the misses, the detours, the misconceptions)
    and its correction; what made an idea click, from the handoff note.
    And how they are made: a page designed for this unit, with a figure
    wherever a picture explains better than a sentence, the app's dark
    colours unless the learner asks otherwise, and styles for print.
    The learner's instructions add to that or change its form (a focus,
    a layout, a length); they do not replace what the unit taught, and
    nothing is included that was not taught.
    `docs/prototype/17-notes-example.html` is the kind of page meant.
  - The engine finishes the writer's document, in a module of its own on
    unified with rehype-parse and rehype-stringify. It draws the math
    with rehype-katex, which renders elements classed `math-inline` and
    `math-display`, and writes KaTeX's stylesheet into the file with its
    fonts as `data:` addresses. It drops scripts and `on...` attributes.
    It refuses a document that names an address on the web, as an
    artifact is refused, and one over the limit. It writes a
    `Content-Security-Policy` meta that allows inline styles, and images
    and fonts from `data:` only. The file is `notes/<unit-id>.html`; the
    writer's document and the instructions are kept beside it.
  - The reader is a page of the app: the file in a sandboxed frame under
    the top line, served as artifacts are but with no script allowed,
    with when the notes were written, the instructions, the file's path
    with "Copy path", and "Open in browser", which opens the file as a
    code question's "Open" does. The card says the notes are being
    written, then offers them, or says why not, with "Try again".
    "Write again", in the reader, takes new instructions and replaces
    the notes; the backup keeps the earlier ones. In the course view a
    finished unit with notes shows "Notes" and "Open".
  - `scriptedReply` answers the new request with a small page that has a
    figure and math and repeats the instructions, so a browser check
    shows they arrived.
- Done when: tests cover the engine's step (math drawn, inline and
  displayed; KaTeX's styles and fonts in the file, and no address to
  load; a script and an `onclick` dropped; a web address and an oversize
  document refused; the policy's meta); no call when a unit finishes;
  the call on "Write notes" and what the writer is given, with
  instructions and without; a failed call and "Try again"; "Write again"
  replacing the notes; a unit tested out of whole; and the route's
  headers. `mise run check` passes; on `pnpm dev:fake` a unit's notes
  are written from the closing card with instructions and from the
  course view without, the file opens from the folder in a browser with
  its math and figure shown, and the browser is closed before the server
  stops; one run on Haiku 5.5 to see the flow (5.13 reads notes written
  by Sonnet).
- Note: rehype-parse and rehype-stringify are new direct dependencies
  (unified and rehype-katex are installed; rehype-katex 7 was seen to
  read the two classes). Look each up with context7, and name them in
  the report and in `architecture.md` section 2. The notes have no
  script because the file is opened straight from its folder, where no
  frame confines it (`decisions.md`, "Mastery loop"). Models wrote `$`
  math into artifacts against the prompt (`decisions.md`, "Prompts"):
  see what the writer does with the two classes, and have the engine's
  step read `$` in text too if it must. Math inside an SVG is not
  drawn; figures label in plain text. The file's text is set in the
  reader's own font unless the app's is written into it: the app loads
  IBM Plex Sans from the web, which the file must not.

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
  move what both sides need to `src/shared/`). The tutor's Markdown is
  rendered on the server (unified with remark-parse, remark-gfm,
  remark-math, remark-rehype, rehype-katex and rehype-stringify; raw
  HTML in the text is dropped), and KaTeX's styles and fonts are written
  into the file by 5.9's step, so the document has no script and loads
  nothing. It carries the page's colours, is set in the reader's own
  font, and prints in dark text on white, as piece 17 shows.
  "Export transcript" in the unit's outline downloads it, in a finished
  unit too.
- Done when: tests cover the Markdown's rendering (math drawn, a table,
  raw HTML and a script dropped, no address to load in the output); a
  transcript holding each kind of event against the document's parts,
  two sessions, a fresh start, and the route.
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
  their detours, and none invented; notes that are a page designed for their unit, with
  figures that explain and math the engine can draw, that hold what was
  taught and nothing that was not, give their room to what the learner missed, name
  what made an idea click as the sessions show it, and follow the
  learner's instructions without dropping the rest. Run the handoff writer on the same stretches on
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
