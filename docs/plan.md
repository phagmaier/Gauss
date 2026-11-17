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
questions graded by tests in the course's workspace, installing a course's
packages, artifacts, disputes, and the tutor's file and shell tools. The
choices behind this breakdown are in `decisions.md`, "Confinement" and
"Disputes"; the designs are pieces 13 and 14 in `docs/prototype/`
(`decisions.md`, "Page design"). Not in this stage: web access and
confining what sandboxed commands read (4.0), notes (5.0).

**User check:** a coding unit and a computational math unit are graded by
tests and the symbolic check, an artifact appears in the side pane, and a
dispute of one grade, raised in the session or from "What I know", shows
its outcome.

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
- Note: run `pytools/.venv/bin/python -I pytools/mathcheck.py` with the
  request on standard input (its header), under a time limit above its own
  8 seconds, say 12. `undecided` goes to the grader as an unparsable answer
  does. A request with no answer only reads the expected side, for posting;
  its `reason` is the refusal's. `tutor.md` needs what the check accepts
  (`decisions.md`, "Symbolic check"): `+ C` on an antiderivative, no
  derivative notation or inequalities, decimals to three significant
  figures.

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

### 3.11 Installing a course's packages

- Status: todo
- Depends on: 3.2, 3.3
- Why: the user's pick in piece 14: Gauss installs what a coding course
  needs once the learner approves, where the agent had recommended that
  the learner run the command. A code question's tests cannot run without
  their packages, so this comes before 3.7.
- Do: an `install_packages` tool for the tutor that takes package names,
  each with an optional version range. The engine refuses whatever is not
  a package name (a URL, a path, an option), a call while a question is
  open, and a second request while one waits. The page shows piece 14's
  card (the packages, the command, Install, "Not now"); on Install the
  engine runs the command it built itself through 3.2's module, with the
  workspace writable and the network open to the package index only, and
  the card keeps the end of the output. The tutor is told the outcome,
  "Not now" included, in its next turn's header. Python through uv
  (`uv add`, making the workspace's project when it has none); another
  language's packages when a course needs them. Settle, under the rule in
  `decisions.md`, "Confinement", that no text of the tutor's runs with the
  network open: wheels only, so that no build script runs (look up uv's
  option with context7); which Python the workspace uses without
  downloading one; where uv's cache lies, since the sandbox writes only
  where it is told; how the sandbox runtime allows named hosts
  (`registerCommandNetworkLists`, `decisions.md`, "Confinement";
  `engine/sandbox.ts` has no option for it yet). `tutor.md`
  gets the lines the tutor needs; the scripted backend asks for a package.
  The backup commits `courses/`, and so the workspace (`record/backup.ts`):
  keep the venv out of it, and decide whether the learner's files belong
  in the record's history.
- Done when: tests with the command's run faked cover the tool (a name
  refused, refused while a question is open, the request kept across a
  restart, each answer in the tutor's next header) and the command built
  from the names; a throwaway script on a scratch data root installs
  `pytest` for real through the sandbox, imports it in the workspace's
  Python, and shows a host other than the index refused; `mise run check`
  passes; on `pnpm dev:fake` and a scratch data root one request is
  installed and one answered "Not now", and the browser is closed before
  the server stops.

### 3.7 Code questions

- Status: todo
- Depends on: 3.2, 3.3, 3.11
- Why: a coding course's exercises are graded by running tests (brief,
  "Mastery and evidence").
- Do: piece 14: a `code` kind for `ask_question` naming the files the
  learner edits (the tutor writes their starter versions first), the tests,
  kept as grading material outside the workspace and shown only in the
  graded card's output and in a dispute, the tutor's solution, and the
  command. The card names each file by its full path, with "Copy path", and
  says that the tests are not shown. When the question is posted, the
  engine runs the tests against the starter files, refusing the question if
  they pass, and against the solution, refusing it if they fail: a test
  that cannot tell right from wrong is the code question's wrong key. "Run
  the tests", with a confidence level, submits: the command runs in the
  sandbox with the workspace writable; exit status 0 is correct; a run past
  its time limit is a failed grading the learner can retry; any other
  failure is a miss, the output's end saying why, and starts a detour as
  every miss does, after which the tutor posts a different exercise. The
  evidence keeps the learner's files as run and the output's end. The
  graded card, "What I know", the answer turn and the help judge's message
  as for the other kinds. `tutor.md` gets the lines the tutor needs; the
  scripted backend posts one, writing its starter file itself.
- Done when: tests that run real commands in the sandbox, no model: a
  passing and a failing submission recorded; a question refused because its
  tests pass on the starter, and one because they fail on the solution; a
  run past its limit; a file changed after it was submitted leaving the
  record as it was. `mise run check` passes; on `pnpm dev:fake` a code
  question is answered both ways, and the browser closed before the server
  stops; one short run on Haiku 5.5 where the tutor asks for `pytest`
  through 3.11's card, writes starter code and posts a question that passes
  the checks, and a submission is graded.
- Note: the solution has to sit where the tests look for the learner's
  files without touching the workspace. One way: a scratch folder holding
  the solution, as the folder the command runs in, with the workspace's
  environment (for Python, `python -m pytest` puts the folder it runs in
  on the import path, and `uv run --project <workspace>` uses the
  workspace's environment, though in the sandbox only with `UV_CACHE_DIR`
  somewhere writable: "Confinement"). Settle the command's placeholders
  with it.

### 3.8 Disputes

- Status: todo
- Depends on: 3.5, 3.7
- Why: a grade can be wrong (a wrong choice key, a grader too harsh or too
  lenient, a wrong test), and a dispute is the only way to correct one.
- Do: piece 13, under the rules in `decisions.md`, "Disputes": a dispute
  names an answer by its `questionId` (on the evidence and in "What I know"
  already) and carries the learner's reason; it is appended to the evidence
  with its outcome. It is raised from the graded card in the session and
  from each answer in "What I know" (a route under `/api/courses/<id>/`):
  the card opens in place with what the answer was graded by and a field
  for the reason, and keeps the first grade, the reason and the outcome.
  Status, the check rules, calibration and "What I know" read the corrected
  verdict; a corrected choice key shows wherever the key did; the tutor of
  a unit in progress is told in its next turn's header. A one-shot call
  decides, failing as the grader's does (shown, and tried again on
  request), its prompt `prompts/dispute-judge.md` drafted here and finished
  in 3.9. The scripted backend decides disputes both ways.
- Done when: tests on hand-worked records cover an overturned miss that
  passes an objective, an overturned pass that takes one away, a
  corrected key, calibration counting the corrected verdict, a second
  dispute on one answer refused, an "I don't know" refused, and the
  tutor's header; route tests pass; `mise run check` passes; on `pnpm
  dev:fake` a dispute raised in the session and one from "What I know"
  show their outcomes, and the browser is closed before the server stops.

### 3.9 The dispute judge

- Status: todo
- Depends on: 3.8
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
- Depends on: 3.5, 3.6, 3.7, 3.8, 3.11
- Why: the tutor must pick the kind of question that fits an objective and
  use its tools well; `planner.md` still promises only teaching in a chat
  (explanations, choice and written questions).
- Do: revise `tutor.md` as a whole for the stage: the kind of question for
  an objective (an expression for a computation, code for a coding skill,
  written for an argument); the workspace (starter code there, scratch work
  in its temporary folder, the learner's files left alone); when to show an
  artifact; a dispute's outcome reported in a header. Widen `planner.md`'s
  promise to what is built: computations checked symbolically, coding
  exercises in a workspace graded by tests, visual aids beside the chat,
  and packages installed once the learner approves them. `unit-planner.md`
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
  - reads are not confined: sandboxed commands, the tutor's and the
    engine's, can read most of the machine. `blockReadsOutsideWorkingDirectories`
    hides the home folder, where mise keeps `python` and `uv`, and let a
    command read beside the workspace (`decisions.md`, "Confinement");
    the sandbox's own read rules are untried. Settle it before the tutor
    gets web access;
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
