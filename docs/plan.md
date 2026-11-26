# Gauss: build plan

Open work only. Status values: `todo`, `in progress`, `blocked` (say why).
Use the [task workflow in AGENTS.md](../AGENTS.md) to work a task or find a
finished one. A finished task is deleted from this file; its text and
checks are in its commit.

Each stage is broken down by its first task (`N.0`) when it starts, because
each finished stage changes the details; its scope is in its section below.
Stage 5 is built before stage 4, by the user's choice; the numbers are kept
because code and documents use them.

## Finished

- Stage 0, spike and skeleton: the user's check passed on 2026-11-15.
- Stage 1, record and library: passed on 2026-11-15.
- Stage 2, session engine: passed on 2026-11-17, at the second try (the
  first added tasks 2.18 to 2.22). A review of the record then added tasks
  2.23 to 2.29.
- Stage 3, checked grading and aids: passed on 2026-11-18. The user's
  notes from the check added tasks 3.19 to 3.22.
- Stage 5, mastery loop: passed on 2026-11-19. The user's notes from the
  check, and the comparisons with LearnHarness and DeepTutor the same day,
  added tasks 5.14 to 5.29, all done on 2026-11-20.
- Stage 4, sources: the user's check passed on 2026-11-22.
- Stage 6, the `unit-chat.ts` split (6.0 to 6.9): its user check passed on
  2026-11-23, walked through in Chromium on `pnpm dev:fake` by the agent at
  the user's direction.
- Stage 6, the Codex backend (6.10 to 6.16): its user check passed on
  2026-11-24, walked through in Chromium on `pnpm check:live` (Codex on
  gpt-6.1-terra, Claude on Sonnet 5.5, both at medium) by the agent at the
  user's direction.
- Stage 6, the tutor's model and teaching instructions (6.17 to 6.19): its
  user check passed on 2026-11-24, walked by the user.
- Stage 6, a source added after the intake (6.20 to 6.22): its user check
  passed on 2026-11-25, walked by the user.
- Stage 6, self-test (6.23 to 6.26): the user confirmed on 2026-11-25
  that both the scripted and live Claude checks passed.
- Known-gap fixes K.31 and K.32 (the test's word and a tested-out unit):
  their user check passed on 2026-11-25, walked through in Chromium on
  `pnpm dev:fake` by the agent at the user's direction.
- Stage 6, photos in messages (6.27 to 6.29): its user check passed on
  2026-11-26, walked by the user.

## Stage 6

Starred messages for the notes, if the generated notes miss what the
learner wants kept; text recognition for scanned PDFs, and questions on a
source's figure (left out of stage 4); ranking passage matches with a
cheap model, if the learner's use shows local search leaves too many
plausible matches. Each is planned when chosen.

Cheat sheets (6.31 and 6.32): `brief.md`, "Other features", "Cheat
sheets"; piece 29, direction A. A cheat sheet is a one-shot writer's
page, as the notes are. It reuses `engine/standalone-html.ts` and the
notes writer's backend (`notesBackend`, Sonnet), whatever the course's
backend. The request leaves the transcripts out: the transcripts of a
course's units would not fit one request, and a one-page sheet needs the
units' plans, the handoff notes and the learner's slips. The prompt is
new model-facing text, which a real model first reads in the user check.

### 6.31 The cheat sheet writer and its record — todo

**Needs:** nothing open.
**Why:** Only `engine/notes.ts` writes a learner's page, and it writes
for one unit, which a new write replaces.
**Do:**
- Put the schemas in `shared/cheat-sheet.ts`:
  - the request: unit ids and instructions, capped as the notes' are;
  - the writer's reply, a schema of its own, so the scripted backend can
    tell it from `NotesReply`;
  - a kept sheet: id, units, instructions, `writtenAt`;
  - the list: the kept sheets, newest first, any attempt (`writing`, or
    `failed` with its reason), and the units that can be picked.
- `prompts/cheat-sheet.md` asks for one printed page (A4 and Letter),
  two at most for many units, with print styles that fit it. It asks
  for reference on what the units taught (definitions, formulas and
  procedures, each with a small example) and a short "watch for" list
  from the learner's slips. It repeats the notes rules it needs, since
  each writer reads only its own prompt: reworking every value, stating
  rules positively with their assumptions, quoting only verified quotes
  with their citations, the SVG and math markup, the colours, and no
  scripts.
- `engine/cheat-sheets.ts` (`createCheatSheets`, a `CourseHolder`)
  writes one sheet at a time per course. A unit that is not finished
  (`isFinished`) or not in the course is refused, as is an empty pick or
  a write while one runs. The picked units go in course order. Each unit
  sends its title, goal, `testedOut`, plan (as `citedPlan` in `notes.ts`
  gives it), its handoff note and its verified quotes (`source_quoted`
  events) with their citations. The course sends one list of misses and
  corrections on those units' objectives, wherever answered, with
  disputes applied (`countedAnswers`, `disputesIn`), and their
  misconceptions. Measure the request for thirty finished units of the
  seed's size, and put the figure in a comment.
  Its time limit and failure handling are the notes writer's.
- Store a sheet in the record as `courses/<id>/cheat-sheets/<sheet
  id>.html`, finished by `finishStandaloneHtml`, and `.json`, with the
  metadata and the writer's document. Write the HTML first, then the JSON.
  The list reads the JSON files, so a crash between the two leaves an
  HTML file that no list shows, and `clearInterruptedWrites` removes it.
  The backup commits after each write and each delete. Add the folder to
  the data root map, and the prompt and the module to `architecture.md`.
- Routes under the course: list (GET), write (POST, answering 202),
  delete, a sheet's HTML (headers and policy as `${notesPath}/html`),
  and "open" (as `${notesPath}/open`).
- The scripted backend answers the reply schema with a small page that
  names the units and echoes the instructions, so `pnpm dev:fake` writes
  a sheet.
**Done when:** fake-backend tests in a temporary root show the following.
- A write for two finished units answers 202 and lists a `writing`
  attempt. Once settled, the list holds one sheet with the units in
  course order, its instructions and date, and its HTML has KaTeX's math
  and no script.
- The request the fake backend received holds both units' plans and
  handoff notes, a miss on one of their objectives answered in another
  unit's review, and their misconceptions. It holds no objective of an
  unpicked unit and no miss that a dispute overturned.
- An unfinished unit, an unknown unit, an empty pick and a second write
  while one runs are each refused, and nothing is written.
- A writer failure and the time limit each leave a `failed` attempt with
  its reason and no file.
- Delete removes both files. An unknown sheet's id is refused with 404,
  as is an id that would reach outside the folder.
- On a new server on the same root, the sheet is still listed, and a
  lone HTML file from an interrupted write is gone.
- Deleting the course is refused while a sheet is being written.

`mise run check` passes.

### 6.32 Cheat sheets on the page — todo

**Needs:** 6.31.
**Why:** Nothing on the page asks for, lists or opens a cheat sheet.
**Do:** Build piece 29's direction A in the course view, on 6.31's
routes, and a reader page for a sheet, at its own route in `web/route.ts`,
as `NotesReader` is for notes. A write in progress survives leaving the
course view and coming back, as a notes write does.
**Done when:** in Chromium on `pnpm dev:fake` with a fresh root, in
"Calculus 1 to 3":
- units 5 and later cannot be picked;
- a sheet for units 2 and 3, written with an instruction, shows as
  writing, then is listed with its units and date;
- "Open" shows the scripted sheet naming both units, and its HTML route
  serves the same page;
- "all finished units" writes a second sheet, listed above the first;
- deleting the first, confirmed, removes it from the list, and after a
  server restart only the second is listed.

"Linear algebra for PCA" shows the mock's state for a course with no
finished unit. The page reads as the picked direction. `mise run check`
passes.

User check for cheat sheets. First, on `pnpm dev:fake` with a fresh root,
open "Calculus 1 to 3". Units 5 and later cannot be picked. Pick units 1
to 3, add an instruction, and write a sheet. Leave the course view and
come back: the sheet is listed with its units and date.
Open it in the app and then in your browser. Write another for all
finished units: both are listed, the newer first. Delete the first.
Restart the server: only the second is listed. Then, on `pnpm check:live`
with a fresh root (a real model, run when you do this check), start a
small course and finish two units, missing at least one check question
on purpose. Write a cheat sheet for both units. See whether it covers
what the units taught, its values are right, and its "watch for" list
names your miss correctly. Print preview in the browser should show one
page, dark text on white. If you have a course taught from a source with
a finished unit, write one there too: any quote should be in the
source's words, with its citation.

## Known gaps

**A:** ready for a focused code fix (task above). **B:** product or design
decision needed. **C:** model behaviour or live evaluation. **D:** larger
work for Stage 6. A task that closes a gap deletes it here.

**Engine and record**

- **B:** Legacy parked courses and remnants whose deletion receipts cannot
  be verified stay in `courses/`. Cleanup requires manual inspection:
  neither the directory name nor its contents prove Gauss parked it.
- **B:** A test skip is fixed at confirmation: a later miss in another
  unit's review can leave a still-upcoming objective skipped. Decide whether
  and when to reopen confirmed skips.
- **B:** A misconception quoting the learner in a review or a gate outside
  its detours, or between the test's end and the teaching (a reply to the
  tutor's word on it, a message while its result card waits), appears in
  “What I know” as found “in the discussion”. Decide whether those get
  places of their own.
- **C:** The unit planner splits contexts into objectives (“a setting is
  not a skill” is unsettled) and names implementations (“using zip”).

**Tutor, grading and judging**

- A check question on a one-claim explanation objective can ask for
  reasoning the lesson or detour already gave (`findings.md`, "Tutor";
  a Codex tutor too, "Codex"),
  and a rubric can reject an answer the card's premises allow (a zero
  weight, in the 4.23 runs). Accepted by the user on 2026-11-22: such an
  objective may leave nothing new to ask. If the user check shows a
  question after a detour answered by repeating the detour, the proposed
  fix is to ask again later, after other material, which changes
  "Session rhythm" in `brief.md`.
- **B:** Only replies during an open question are judged. Decide what
  counts as help in teaching and feedback, and whether the judge should
  consider earlier exchanges when a hint is split across replies.
- **B:** The engine does not enforce the workspace prohibition on writing
  or posting a question with its tests or solution there, and does not
  verify answer-key arithmetic. Define what counts as exposed material
  and which kinds of answer keys must be mechanically checkable.
- **B:** After the data root moves, a code question's file whose stored
  path splits into a workspace path two ways (the old root's path, or the
  file's own, holds `courses/<id>/workspace/` again) keeps its old path
  (`currentPath` in `record/data-root.ts`): in the export of a withdrawn
  question and for the handoff and notes writers. An open question takes
  the record's. Decide whether to resolve answered ones from the evidence.
- **B:** Only “What I know” shows the contents of submitted files.
  Decide whether to show them on the question card as well.
- **C:** There is no hand-graded set for math answers the symbolic check
  does not settle. The dispute set lacks disputes of a correct grade and
  does not separate Sonnet from Haiku.
- **C:** One Sonnet 5.5 notes call and one grading (P2, usually 3 s)
  exceeded the 3-minute limit; the cause is unknown.
- **C:** Once after Stop mid-sentence, the next one-sentence reply took
  10 to 30 seconds. Not seen again.
- **C:** A Codex tutor (gpt-6.1-terra) declined, without calling a tool,
  to write a workspace file the learner asked for in a discussion (a line
  in their notes, which `tutor.md` allows, and a script to run; 2 of 2 in
  one run), saying it could not write "during this discussion". A refused
  write's reason, and any command (`run_command` or an `exec` script),
  are untried on a Codex tutor live (`findings.md`, "Codex").
- **C:** A Codex tutor's code-question tests passed a wrong answer
  (distinct partners counted, not handshakes; 1 of 3 code questions), so
  the record holds a correct grade for it, and the tutor's feedback then
  called the answer wrong (`findings.md`, "Codex"; mechanically checked
  keys are the B gap above).
- **B:** The engine does not check tutor prose or written answers for
  unattributed copying from course sources. Decide how to treat ordinary
  phrasing, titles, attribution, and copied answers that also explain.
- **C:** The tutor has copied source wording unquoted (18 runs of at
  least eight words over six Opus trials, two titles; Sonnet also quoted
  clauses outright). The grader can treat unmarked source sentences as
  the learner's own.
- **C:** Untried on a real model: continued discussion in a detour or
  pressing Ready at once; idle close/resume; a large course's next
  stretch; `$TMPDIR` scratch work; dispute outcomes in headers; sandbox
  `uv run`; record-file `Glob` and `Grep` under `dontAsk`. Stop with
  queued input has only simulated SDK coverage.

**Page**

- **B:** Opening a long history renders the whole thread (about 3 s at
  1,200 formulas). Decide how earlier sessions should fold.
- **B:** After sending a message, keys go to the message box, not the
  pinned card. Decide where focus should go after sending.
- **B:** In a check's detour, a dispute that overturns the miss and
  leaves the check done keeps “Ready for another question”, which then
  closes the segment; the tutor's header and refusals name the same
  label. Decide what the control should say there.
- **D:** WebKit reports opaque aid errors; recovering callback errors
  needs a reporter design and WebKit checks. DNS-prefetch is also untested
  in WebKit.
- **D:** Safari is reported to send the Enter that ends an IME
  composition after the composition ends, with `isComposing` false, which
  the message box's and question card's guard would let submit. Untested
  in WebKit.

**Sources and sandbox**

- **B:** EPUB spine items marked `linear="no"` are written inside the
  preceding entry. Decide whether they should get an entry of their own.
- **B:** The source reader can still render a Markdown metadata field as a
  heading in the section body (found by review). Decide how to display it.
- **D:** PDF fidelity: tables become short-line paragraphs; figure labels
  outside forms stay in the text; reading order comes from PDFium; tightly
  set lines can lose spaces (Inwood's “whereaswith”, “clearwhat”).
- **B:** Continued PDF footnotes can become body text; a bookmark with a
  title different from the printed heading can land at the top of the
  page. Decide how much uncertain layout inference is acceptable.
- **C:** `tutor.md` sends the tutor to a page whose math reads garbled;
  Sonnet looked at it only when asked.
- **C:** Notes are not checked against the source; one live run kept, in
  quotation marks, three of the source's words quoted unverified by the tutor.
- **D:** Sandboxed commands and artifact scripts have no peak disk,
  memory or CPU budgets; deadlines and output caps do not supply them.
- **B:** A tutor's command can make git or editor settings (`.git` and
  its hooks, `.vscode`, `.bashrc` and the like) where none exist, which
  the learner's git or editor may then run: a Codex tutor's at the
  workspace's top too, either tutor's deeper down. Gauss's file tools
  refuse them everywhere (`PROTECTED` in `tools/workspace.ts`). Decide
  whether Gauss should refuse or remove such files after a command.
