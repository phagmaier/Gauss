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
    handoff note and the unit's misconceptions (`readHandoff` and
    `readMisconceptions` in `record/data-root.ts`), and the learner's
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
- Note: a unit finishes at the closing card after its gate
  (`closeAfterGate` in `unit-chat.ts`), or at `gateOrFinish`'s when it
  has none to offer; "Write notes" goes there.
  rehype-parse and rehype-stringify are new direct dependencies
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
- From 5.4's Haiku run: feedback in a review was two sentences of working,
  and a lead-in named what the question would use ("one on the limit
  definition with a square root"), which `tutor.md` does not forbid in a
  review. 5.5's Haiku gate did the same ("a power rule question with a
  different exponent"), and posted a math question with a wrong key: the
  limit of $2x^3 - x + 4$ at $-1$ given as 7, its feedback working
  "$-2 + 1 + 4 = 7$". Nothing checks a key's arithmetic.
- From 5.7's Haiku run (a fractions unit: a confident miss, a message in
  the detour, moving on, Start fresh): the note ran about 280 words,
  opened by restating the unit and its objectives, and once said "the
  stretch does not show", the writer's own word; its one misconception
  was true to the detour and stated as the claim held. The fresh session
  picked up from the note without asking what was covered and offered the
  detour's sum again, but told the learner to "tell me" when ready for the
  next segment, which they start with a button. To run the writer on the
  same stretches, a request can be rebuilt from a unit's transcripts with
  `since`, `readStretch` and `handoffRequest` in `engine/handoff.ts`.
- From 5.6's Haiku test: no lead-ins and nothing said between questions,
  as asked; but the second question after an unsure answer was the same
  problem with new numbers, not the objective asked another way; the word
  on the test went over single answers ("you reduced 36/84 to 3/7"),
  which its header forbids; and a choice question's choices carried
  letters of their own ("A. 3/8 is larger"), which the shuffle then put
  beside other letters. `tutor.md` says nothing against the last.
- From 5.8: `planner.md` still promises "no review of earlier units in
  later sittings, no notes", which stage 5 makes false. Its profile lines
  were seen in one Haiku 5.5 intake (`decisions.md`, "Prompts"), which
  asked nothing the profile answered and kept it word for word; see
  whether a planner changes it only for what the learner said, and keeps
  this course's facts out of it. That intake once said it had proposed
  without calling `propose_curriculum`; nothing in `planner.md` forbids
  it.
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
