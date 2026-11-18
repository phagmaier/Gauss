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

Separate from the Stage 3 check, the Stage 2 follow-up still to observe:
an objective passed by two unsure correct answers.

## Stage 3: checked grading and aids

Implementation is complete. Stage 5 waits for the user's check below.
Scope: [architecture §12](architecture.md#12-build-stages). Rationale:
`decisions.md`, "Confinement" and "Disputes"; designs: pieces 13 and 14 in
the [prototype](prototype/index.html). Not in this stage: web access and
confining sandbox reads (4.0), or notes (5.0).

**User check.** On Linux, run `mise run setup` if dependencies are not
installed, and have `bwrap`, `socat` and `rg` on `PATH`. From the repository,
start the real app with a scratch data root:

```sh
scratch=$(mktemp -d) &&
  GAUSS_DATA_ROOT="$scratch" GAUSS_BACKUP=off mise exec -- pnpm dev
```

Open <http://localhost:4320>. The server prints the scratch root. If it
reports "No sandbox for the engine's commands", resolve that before trying
code or math grading. Opening a unit can spend Claude plan usage without
a message. In the empty library, use "New course" to propose and approve
one short Python course and one short computational math course.

1. **Code:** In a short Python unit, edit the starter file named on a code
   question, pick a confidence level, and press "Run the tests". Confirm
   the graded card shows the test output and the expected verdict.
2. **Math:** In a computational math unit, ask for a question that accepts
   any equivalent expression, and submit a known correct answer. Confirm
   a correct grade. To verify it came from the symbolic check, find the
   answer in `<scratch>/courses/<course-id>/evidence.jsonl`: its
   `question.mathGrading` is `"symbolic"` and it has no `unsettled` field.
   A card that says "The grader, since the symbolic check …" does not
   count for this check.
3. **Artifact:** In discussion, ask for a visual aid. Confirm it renders
   in the side pane, opening it from the thread if needed.
4. **Dispute:** From a graded card or "What I know", choose "Dispute this
   grade" and submit a reason. Confirm the outcome and the judge's reason
   appear on the answer; the verdict does not have to change.

Close the test browser before stopping the server.

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
