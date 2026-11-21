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
- Stage 5, mastery loop: passed on 2026-11-19. The user's notes from the
  check, and the comparisons with LearnHarness and DeepTutor the same day,
  added tasks 5.14 to 5.29 (`decisions.md`, "Product decisions").

## Stage 5: follow-ups from the check (built before stage 4)

The tasks the stage's check and the two comparisons added. The stage's
views are laid out in the mocks, pieces 15 to 18 of `docs/prototype/`, and
the redesign in pieces 19 to 21 (`decisions.md`, "Page design"), whose
look the app has. Every view must still read at 30 units: `pnpm dev:fake` seeds
"Calculus 1 to 3" with thirty, and its scripted planner proposes thirty
for "/large". Not in this stage: sources and web access (4.0), self-test
and cheat sheets (stage 6).

### 5.29a A shorter planner prompt

- Status: todo
- Depends on: 5.29
- Split from 5.29, whose method worked on `tutor.md` (`decisions.md`,
  "Prompts", "The prompt says only what the app does not"):
  `prompts/planner.md` (214 lines) gets the same pass. List every rule
  with its fate (kept, merged, left to the engine because the intake's
  tool descriptions, refusals or turn text already say it, or dropped,
  with why); a rule from a failure seen in a real run stays unless the
  engine now prevents it. Keep the example or the reason a finding
  depended on: cutting those was what lost rules in 5.29.
- Done when: the rule list is in the commit message; the tests pass; and
  Sonnet intakes with the old prompt and the new, on the same profile and
  the same learner messages (a small course, then a large topic planned
  in stretches), show no rule lost. `decisions.md`, "Prompts", keeps what
  the pass found.

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
  - quote matching also ignores what extraction adds: margin line
    numbers on lines of their own, and a word split by a hyphen at a
    line's end (from the DeepTutor comparison;
    `deeptutor/reading/_grounding.py` in that project);
  - a link that opens a section without claiming a quote, for what the
    tutor paraphrases (a lecture on Hegel paraphrases more than it
    quotes), beside verified quotes: how the tutor makes one and how the
    page shows it (the user's pick from the DeepTutor comparison);
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
learner wants kept; a model chosen in the app's settings, which the user
wants eventually (2026-11-19); teaching instructions the learner can add
to or edit (below). Each is planned when chosen.

Self-test, as the user described it on 2026-11-19 (optional, after
everything else): the learner picks the scope (a segment, a unit, the
course, or a random mix of what they have passed) and the kinds of
question. They found "playground" the wrong name; the brief's term is
self-test.

For self-test, LearnHarness's practice prompt
(`src/agent/prompts/practice/10-doctrine.md` in that project) is input:
mix objectives rather than ask several problems on one in a row; a retry
after feedback is a fresh problem; before posing, fix the model solution
and look for a shortcut that skips the target; give the smallest hint
that unblocks, one per request.

Teaching instructions the learner can change (the user's request,
2026-11-19): add to or edit the tutor's instructions on how it teaches,
app-wide, beyond a course's style note. What the app relies on stays
fixed (the tools, the assessment and help rules, the question formats);
the shipped prompt is kept, and the learner can revert to it. Where the
line between fixed and editable falls in `prompts/tutor.md` is for that
task.
