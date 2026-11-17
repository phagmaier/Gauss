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

Still to see from the user's check of 2.23 to 2.29: an objective passed by
two unsure correct answers.

## Stage 3: checked grading and aids

The scope is `architecture.md` section 12's: the symbolic check, code
questions graded by tests in the course's workspace, artifacts, disputes,
and the tutor's file and shell tools. The choices behind this breakdown are
in `decisions.md`, "Confinement" and "Disputes". Not in this stage: web
access and confining what sandboxed commands read (4.0), notes (5.0).

**User check:** a coding unit and a computational math unit are graded by
tests and the symbolic check, an artifact appears in the side pane, and a
dispute of one grade, raised in the session or from "What I know", shows
its outcome.

### 3.1 Designs the stage needs

- Status: todo
- Depends on: stage 2
- Why: disputes have no design, and piece 2's code card (2026-11-13) came
  before detours: after a failing run it has the learner fix the same
  exercise and run the tests again.
- Do: mocks in `docs/prototype/`, built as the earlier pieces were, each
  with the agent's recommendation marked and the rest shown as the agent
  would build it.
  - Piece 13, disputes. Ask who decides a dispute: a separate model call
    that weighs the learner's reason against the question and what it was
    graded by, seeing nothing of the conversation (recommended), the
    learner's own word, or the tutor. Show: "Dispute" on the graded card in
    the session and on each answer in "What I know"; a required reason;
    the rubric (or the choice key, expression or tests) beside the answer
    while disputing; the outcome with its reason on the card and in "What
    I know".
  - Piece 14, code questions. Ask: whether the tests are hidden, the
    prompt and starter file saying what the code must do and the first run
    being the answer, as for every other kind (recommended), or in the
    workspace, where the learner can run them before submitting; whether
    a failing run is followed by a detour and then a new exercise
    (recommended, as for every kind) or by the same exercise again; and
    who installs a course's packages: the learner, in their own terminal,
    from the tutor's instructions (recommended: nothing to build, and
    nothing installed that the learner has not seen), or Gauss, once the
    learner approves a card. Show: the card naming the file to edit by its
    full path; the test output on the graded card; a line in the thread
    for each file the tutor writes.
- Done when: the user has picked an answer to each question; the picks are
  in `decisions.md` ("Page design", and "Product decisions" for who
  decides a dispute); `docs/prototype/index.html` lists the new pieces;
  the tasks below are revised where a pick differs from the
  recommendation.

### 3.2 Sandboxed commands for the engine

- Status: todo
- Depends on: stage 2
- Why: grading will run text a model wrote: a code question's tests, and
  the expected expression the symbolic check parses (SymPy's parser
  evaluates its input). Run by the server as it is, either could do
  anything the learner can.
- Do: one module through which the engine runs every command whose input
  a model or the learner wrote, on `@anthropic-ai/sandbox-runtime` (look
  its API up with context7; it is pre-1.0; add it, and check pnpm's build
  script and release-age rules): no network, writes only to the folders
  the caller names, a time limit after which the command and everything
  it started are stopped, output cut to a limit, and the exit status
  returned. A check the server runs at start, that the sandbox can run
  (on Linux it needs `bwrap`, `socat` and `rg`), which says once what is
  missing; without the sandbox, nothing that needs it runs.
- Done when: tests that run real commands in the sandbox, no model: a
  command's output and exit status; a write outside the named folders
  refused and one inside them allowed; a network connection refused; a
  command over its time limit stopped, with a child it started; output
  over the limit cut. `mise run check` passes.

### 3.3 The tutor's file and shell tools

- Status: todo
- Depends on: 3.2
- Why: the tutor must write starter code and read the learner's work, and
  its shell runs on the learner's machine. The option set in
  `decisions.md`, "Confinement", confined writes in throwaway runs but has
  never run in Gauss.
- Do: every tutor session gets `Read`, `Glob`, `Grep`, `Write`, `Edit` and
  `Bash` (the planner, the unit planner and one-shot calls get none), with
  the course's `workspace/` (made when first needed) as its working
  directory, the confinement options with an `Edit` allow rule for the
  workspace only, and `CLAUDE_CODE_TMPDIR` a private folder per course
  under `/tmp` that fits Claude Code's 44-byte limit ("Confinement"). Only
  when 3.2's start check passes; otherwise tutors get no built-in tools.
  The engine refuses built-in calls by phase, as it refuses teaching
  tools: `Write`, `Edit` and `Bash` while a question is open, with a
  reason the tutor can act on (asked through a hook in the backend; the
  engine stays free of the SDK). The thread shows a line for each file
  the tutor writes, with its path in the workspace. Try
  `blockReadsOutsideWorkingDirectories`: keep it if `python` and `uv run`
  still work in the workspace, otherwise record why and leave reads to
  4.0; either way update 4.0's item on reads.
- Done when: unit tests cover the options a tutor session gets (working
  folder, allow rule, temporary folder within the limit) and those the
  other sessions get, the refusal while a question is open, and the
  thread's line. A throwaway script on Haiku 5.5 and a scratch data root
  starts a tutor session through the backend with a probe prompt, and
  shows: a file written in the workspace; `state.json` and
  `evidence.jsonl` left unchanged by `Write` and by a shell command;
  writes to the home folder and `/tmp` refused; `$TMPDIR` in a command is
  the private folder; `python -c 'print(1)'` runs in the workspace.
  `mise run check` passes.
- Note: a unit in progress has its kept session in the course folder, and
  a session resumes only in the folder it ran in, so each such unit
  starts fresh once (the fallback in `architecture.md` section 4); say so
  in the report. Update section 11's path to the session logs. See what
  Claude Code leaves in the workspace (a `.claude/` folder was seen in
  stage 0) and decide whether the learner should see it.

### 3.4 The symbolic check

- Status: todo
- Depends on: none
- Why: a computation's answer is graded by a model today, which is slow
  and can be wrong; whether two expressions are equal is a computation.
- Do: `pytools/mathcheck.py`, which reads the expected expression and the
  learner's answer as JSON, as typed in the page's math field (LaTeX or
  plain: `3x^2`, `\frac{1}{2}`, `sqrt(x)`), and writes whether they are
  equivalent, different, or which side could not be parsed. Settle on
  worked pairs: expressions; equations, equal up to a non-zero factor;
  lists of values as sets; numbers within a tolerance; how equivalence is
  decided (simplification, then evaluation at sample points when that
  does not settle it); the time limit. SymPy and the package its LaTeX
  parser needs (look both up with context7; `uv add --directory
  pytools`). Plain input never reaches an evaluator with names or
  attributes it was not given. It runs with the venv's own Python, so a
  sandboxed run needs no uv cache.
- Done when: pytest pairs worked by hand pass: equivalent forms (expanded
  and factored, `\frac{a}{b}` and `a/b`, implicit multiplication, `e^x`
  and `\exp(x)`, a trigonometric identity), near misses (a sign, the
  chain rule's missing factor, `x^2` against `2x`), equations, lists, an
  unparsable answer and an unparsable expected expression, and an input
  meant to run code (`__import__('os').getcwd()`), which is reported
  unparsable and not run. `mise run check` passes.

### 3.5 Math questions

- Status: todo
- Depends on: 3.2, 3.4
- Why: the symbolic check needs a question kind the tutor can post and the
  learner can answer.
- Do: a `math` kind for `ask_question` with the expected expression, which
  the engine parses when the question is posted, refusing it with the
  reason if it does not parse. The learner answers in piece 2's math field
  with its live preview, with confidence and optional reasoning. Grading
  runs `mathcheck.py` in the sandbox (3.2); an answer that does not parse,
  or a check that errors or runs out of time, goes to the grader with a
  rubric made from the expression ("correct if mathematically equivalent
  to ..."). The graded card, the answer turn, "What I know" and the help
  judge's message carry the expression as they carry a choice key; re-run
  the judge's set if `help-judge.md` changes. `tutor.md` gets the lines
  the tutor needs to use the kind; the scripted backend posts one.
- Done when: fake-backend tests cover an equivalent and a different
  answer, an expression refused when posted, an unparsable answer graded
  by the grader, and the evidence and "What I know" for each; `mise run
  check` passes; on `pnpm dev:fake` a math question is answered with the
  preview and graded, and the browser closed before the server stops; one
  short run on Haiku 5.5 posts a math question that the check grades.

### 3.6 Artifacts

- Status: todo
- Depends on: stage 2
- Why: the brief's visual and interactive aids. Piece 5 settled where they
  show: a pane beside the thread, and a reference in the thread that
  opens and closes it.
- Do: `show_artifact` takes a title and a self-contained HTML document;
  the engine writes it to `artifacts/`, numbered and never overwritten, and
  the session page opens it in piece 5's pane. The frame runs scripts but
  has no same-origin access, and the artifact is served with a policy
  that allows no network, so it can reach neither the app nor anything
  else; decide whether it may load the app's KaTeX. Refused while a
  question is open (an aid could help with the answer, and the help judge
  sees only text), and over a size limit, with the reason. Transcripts and
  replay keep the reference. `tutor.md` gets the lines the tutor needs:
  when an aid helps, self-contained, the page's colours. The scripted
  backend shows one.
- Done when: tests cover the tool (stored, numbered, refused while a
  question is open and when too large) and the route's headers; `mise run
  check` passes; on `pnpm dev:fake` an artifact opens beside the thread,
  runs its script, is refused a fetch, and reopens from its reference
  after a reload, and the browser is closed before the server stops; one
  short run on Haiku 5.5 shows an artifact the tutor made.

### 3.7 Code questions

- Status: todo
- Depends on: 3.1, 3.2, 3.3
- Why: a coding course's exercises are graded by running tests (brief,
  "Mastery and evidence").
- Do: as 3.1 settles; with its recommendations, a `code` kind for
  `ask_question` naming the files the learner edits (the tutor writes
  their starter versions first), the tests, kept as grading material, the
  tutor's solution, and the command. When the question is posted, the
  engine runs the tests against the starter files, refusing the question
  if they pass, and against the solution, refusing it if they fail: a
  test that cannot tell right from wrong is the code question's wrong
  key. "Run the tests", with a confidence level, submits: the command runs
  in the sandbox with the workspace writable; exit status 0 is correct; a
  run past its time limit is a failed grading the learner can retry; any
  other failure is a miss, the output's end saying why. The evidence keeps
  the learner's files as run and the output's end. The graded card, "What
  I know", the answer turn and the help judge's message as for the other
  kinds. `tutor.md` gets the lines the tutor needs; the scripted backend
  posts one, writing its starter file itself.
- Done when: tests that run real commands in the sandbox, no model: a
  passing and a failing submission recorded; a question refused because
  its tests pass on the starter, and one because they fail on the
  solution; a run past its limit; a file changed after it was submitted
  leaving the record as it was. `mise run check` passes; on `pnpm
  dev:fake` a code question is answered both ways, and the browser closed
  before the server stops; one short run on Haiku 5.5 where the tutor
  writes starter code and posts a question that passes the checks, and a
  submission is graded.
- Note: the solution has to sit where the tests look for the learner's
  files without touching the workspace. One way: a scratch folder holding
  the solution, as the folder the command runs in, with the workspace's
  environment (for Python, `python -m pytest` puts the folder it runs in
  on the import path, and `uv run --project <workspace>` uses the
  workspace's environment). Settle the command's placeholders with it.

### 3.8 Disputes

- Status: todo
- Depends on: 3.1, 3.5, 3.7
- Why: a grade can be wrong (a wrong choice key, a grader too harsh or too
  lenient, a wrong test), and a dispute is the only way to correct one.
- Do: as 3.1 settles, under the rules in `decisions.md`, "Disputes": a
  dispute names an answer by its `questionId` (on the evidence and in
  "What I know" already) and carries the learner's reason; it is appended
  to the evidence with its outcome. It is raised from the graded card in
  the session and from each answer in "What I know" (a route under
  `/api/courses/<id>/`). Status, the check rules, calibration and "What I
  know" read the corrected verdict; a corrected choice key shows wherever
  the key did; the tutor of a unit in progress is told in its next turn's
  header. If a model decides: a one-shot call that fails as the grader's
  does (shown, and tried again on request), its prompt
  `prompts/dispute-judge.md` drafted here and finished in 3.9. The
  scripted backend decides disputes both ways.
- Done when: tests on hand-worked records cover an overturned miss that
  passes an objective, an overturned pass that takes one away, a
  corrected key, calibration counting the corrected verdict, a second
  dispute on one answer refused, an "I don't know" refused, and the
  tutor's header; route tests pass; `mise run check` passes; on `pnpm
  dev:fake` a dispute raised in the session and one from "What I know"
  show their outcomes, and the browser is closed before the server stops.

### 3.9 The dispute judge

- Status: todo
- Depends on: 3.8; dropped if 3.1 does not pick a model to decide
- Why: a judge that gives way to a confident argument would make a dispute
  a way to pass, and one that never does would make disputes pointless.
- Do: a hand-judged set of disputes, run as the grader's and the help
  judge's are: a wrong choice key, a correct proof graded incorrect, a
  correct answer in another valid form, a test that rejects a right
  solution, and wrong answers with persuasive reasons (effort, a claim
  that the rubric was unfair, the error restated with confidence).
  Revise `dispute-judge.md` until two runs agree with every outcome; choose
  the model.
- Done when: two runs agree with every hand outcome; the set, the results
  and the model are in `decisions.md`, "Disputes". The check depends on
  the model's judgment, so it may use Sonnet or Opus.

### 3.10 Prompts for the stage

- Status: todo
- Depends on: 3.5, 3.6, 3.7, 3.8
- Why: the tutor must pick the kind of question that fits an objective and
  use its tools well; `planner.md` still promises only teaching in a chat
  (explanations, choice and written questions).
- Do: revise `tutor.md` as a whole for the stage: the kind of question for
  an objective (an expression for a computation, code for a coding skill,
  written for an argument); the workspace (starter code there, scratch
  work in its temporary folder, the learner's files left alone); when to
  show an artifact; a dispute's outcome reported in a header. Widen
  `planner.md`'s promise to what is built: computations checked
  symbolically, coding exercises in a workspace graded by tests, visual
  aids beside the chat, and packages as 3.1 settled. `unit-planner.md`
  only if objectives need to say how they are checked.
- Done when: one run on Sonnet 5.5 (the result depends on the model's
  judgment), kept short, on a scratch data root: an intake for a short
  coding course whose proposal promises only what is built, then a segment
  of its first unit with a code question that passes the posting checks;
  and a segment of a computational unit with a math question. The
  findings are in `decisions.md`, "Prompts"; `mise run check` passes.

## Stage 5: mastery loop (built before stage 4)

### 5.0 Break down the stage

- Status: todo
- Depends on: stage 3
- The breakdown must settle:
  - review questions at the start of each sitting: two or three on
    objectives passed in earlier sittings, those passed with the least
    confidence first, fresh questions each time, on by default and
    skippable in any sitting. They and the unit gate share one mechanism,
    questions without teaching over objectives the engine picks
    (`architecture.md` section 4, the examiner prompt);
  - retained and slipping status, from review and the gate;
  - testing out of a unit, which replaces the baseline: the unit's gate
    taken before it is taught, once the unit is planned (objectives exist
    only then), and how a partial result shortens the unit;
  - the misconception record (`misconceptions.jsonl`) from detours, and
    what reads it;
  - the learner profile (`profile.md`, `architecture.md` section 3): what
    it holds beside the background note, and who writes it when;
  - handoff notes, written "at the end of each session": a session ends
    when the server stops or after an hour quiet, and one that holds only
    a unit's opening has nothing to summarise. A new tutor session in a
    check repeats problems the check already asked, since its header does
    not list them; handoff notes or the header should fix that;
  - notes and export: a finished unit keeps "Open" in the course view
    until it has notes; a new one-shot request (notes) needs
    `scriptedReply` in `scripted.ts` extended, or it fails its schema on
    `pnpm dev:fake`.

**User check:** one course runs from intake to a closed second unit: a unit
tested out of or started, review questions at the start of a later sitting,
a detour, a unit gate, generated notes and an exported transcript.

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
  - reads are not confined, so sandboxed commands can read most of the
    machine: settle it before the tutor gets web access;
  - the account's email address reaches every Claude session
    (`decisions.md`, "Claude backend"): with web access, a request could
    carry it, as it could anything else in the context;
  - source page images stay out of the backup (`record/backup.ts`);
  - the grader's and the help judge's hand-made sets are math only, and
    need explanation answers from a source course.

**User check:** a lecture on one chapter of the _Phenomenology_ with verified
quotes, and one unit taught from a paper.

## Stage 6: later

Codex backend (`decisions.md`, "Codex"), self-test, cheat sheets, photo
input; starred messages for the notes, if the generated notes miss what the
learner wants kept. Each is planned when chosen.
