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

## Stage 3 follow-up: the check's notes

Built before 5.0. Each task is the user's note from the stage 3 check
(`decisions.md`, "Product decisions", 2026-11-18).

### 3.19 Prompts: starters and intuition questions

- Status: todo
- **Starters hold what the question gives.** In the check, Opus 5.5 asked
  the learner to type four given values into `order.py`, whose starter was
  a comment and `raise NotImplementedError`. The objective was "stores
  values of the basic types in variables", and `tutor.md`'s starter rule
  ("nothing that does the exercise") let the tutor count typing the values
  as the exercise. The starter holds the values, names, data, imports and
  signatures the prompt gives; the learner writes only what the objective
  checks, and is never asked to copy text from the prompt into a file.
  `unit-planner.md`: no objective whose only check is copying.
- **Intuition questions.** For a segment with an idea to grasp, the
  teaching turn ends with one question on the learner's intuition (explain
  why, predict, what if), never "does that make sense?". In the
  discussion the tutor says what is right in the answer, corrects what is
  off, and follows up once only if the picture is still shaky; the
  exercise comes after. Skipped for rules and conventions (the signs of
  Python's `//` and `%`), where the exercise stays as it is. Ungraded, no
  card, no evidence, and "ready" stays the learner's at any time.
  `planner.md`: the style note can turn it off. The brief's "Session
  rhythm" already says so.
- Done when: one real run on Sonnet 5.5 on a scratch data root, with
  plans seeded:
  - the user's Python course plan, whose first segment covers
    `script-basic-types` and `python-numeric-division`: its code question's
    starter holds the given values and passes the posting checks, and the
    segment has no intuition question;
  - a math segment with an idea to grasp: its teaching ends with an
    intuition question, and the tutor's reply to a half-right answer
    corrects it before the exercise.

  Findings in `decisions.md`, "Prompts"; `mise run check` passes.

### 3.20 The install card folds its command and output

- Status: todo
- The packages stay in view. The commands and their folder go behind a
  closed "Show the command"; once answered, the output goes behind "Show
  the output", closed after an install and open after a failed one. The
  user needs the command and output only when something fails. A closed
  disclosure keeps the command there to check before pressing Install.
- Done when: `packages-card.test.ts` covers a waiting, an installed and a
  failed card; in the browser on `pnpm dev:fake`, a waiting card shows the
  packages with the command closed, and an installed card shows "Installed"
  with the output closed; `mise run check` passes.

### 3.21 Hide the pinned question

- Status: todo
- A "Hide" control on the pinned question card shrinks it to one line above
  the message box, with the question's number and "Show". The card stays
  mounted while hidden, so a half-written answer, a picked choice and a
  confidence level survive (`decisions.md`, "Page behaviour", the pinned
  question). A newly posted question shows. The card, up to half the
  window high, got in the way of rereading the teaching.
- Done when: in the browser on `pnpm dev:fake`, with a question pinned and
  an answer half written, Hide frees the space, Show brings the card back
  with the answer intact, and the next question posted shows;
  `mise run check` passes.

### 3.22 Open a code question's files

- Status: todo
- An "Open" button beside "Copy path" on a code question's card opens the
  file in the system's default app (`xdg-open` on Linux, `open` on macOS),
  started by the server and left running. The request names the question
  and the file, never a path: the server opens only a file the question
  lists, in the course's workspace, behind the Origin check every POST
  has. A failure to start it shows by the button. It runs outside the
  sandbox, as the learner's own click would. The user chose the system
  default over a set command. On their machine it is now Neovim in Tern
  (set in their NixOS config, 2026-11-18), and `xdg-open` there exits 0
  once Tern has started it. Without `WAYLAND_DISPLAY` or `DISPLAY`,
  `xdg-open` fails with "no method available" (exit 3): a server started
  outside a desktop shell has neither, and the button must say so.
- Done when: route tests with a stub opener: a listed file opens; another
  path, another course's question and an unknown question are refused. In
  the browser on `pnpm dev:fake`, the button opens a starter file in the
  default app. `mise run check` passes.

## Stage 5: mastery loop (built before stage 4)

### 5.0 Break down the stage

- Status: todo
- Depends on: 3.19 to 3.22
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
  - the misconception record (`misconceptions.jsonl`) from detours and
    from what intuition questions show (3.19), and what reads it;
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
  - an artifact can send data out through WebRTC, which its policy cannot
    block in Chromium (`decisions.md`, "Confinement"); with unconfined
    reads that is a channel out for a tutor misled by a source or a web
    page. Settle it with reads; DNS prefetch from an artifact is untried;
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
