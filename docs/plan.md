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
- From 5.11's Haiku run (asked for shorter explanations): the proposal kept
  the unchanged sentence word for word and the replies after Apply were
  short; but its text before the card said "I've proposed a style change"
  before the call was made, and its text after the card said so again.
- From 5.12's Haiku run (asked for a unit on related rates before
  optimisation): the proposal kept every other unit as it was and put the
  new one between the two, building on the unit taught; after Apply the
  tutor named the new order from its header. Untried: a change the tutor
  proposes by itself from slipping objectives or a detour, which
  `tutor.md` asks for.
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
