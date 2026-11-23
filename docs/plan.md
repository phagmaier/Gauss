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

## Stage 4: sources (built after stage 5)

The scope: ingestion for the four formats, the outline, unit mapping,
`quote_source`, the citation view, page images and the web search setting.
The user's picks are in `brief.md`, "Sources" and "Page"; the trials on the
user's files are in `findings.md`, "Source conversion". The pages are mocks
22 to 24 in `docs/prototype/`. Not in this stage (stage 6's list): a source
added to a course after its intake, text recognition for scanned PDFs, and
questions on a source's figure.

**User check:** a lecture on one chapter of the _Phenomenology_ with verified
quotes, and one unit taught from a paper. Its tasks are done; it waits on
the user's own run. Watch for the question gap under "Known gaps"
("Tutor, grading and judging").

## Stage 6: later

Codex backend (`findings.md`, "Codex"), self-test, cheat sheets, photo
input; starred messages for the notes, if the generated notes miss what the
learner wants kept; a model chosen in the app's settings, which the user
wants eventually (2026-11-19); teaching instructions the learner can add
to or edit (below); a source added to a course after its intake, text
recognition for scanned PDFs, and questions on a source's figure (left out
of stage 4); ranking passage matches with a cheap model, if the learner's
use shows local search leaves too many plausible matches. Each is planned
when chosen.

Stage 6's breakdown starts by splitting `engine/unit-chat.ts` (4,500 lines,
one closure of about 90 functions) along its marked parts (opening, turns,
assessments, help, the teaching tools, the learner's actions) into modules
that share the running chat's state, with no change of behaviour: the
Codex backend and self-test both reach into it.

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

## Known-gap fixes

### K.1 Segment override recovery — todo

**Why:** Evidence and position can disagree after an interrupted override.
**Do:** Make a segment override recoverable and idempotent across the log and position writes.
**Done when:** Reopening at the interrupted write closes the segment, withdraws the question, and leaves one override.

### K.2 First intake proposal recovery — todo

**Why:** An interrupted first proposal can leave a draft with only some of its sources.
**Do:** Recover the interrupted publication before startup discards abandoned uploads.
**Done when:** Restarting after some but not all sources have moved preserves the sources and a reopenable draft; abandoned uploads are still discarded.

### K.3 Resume a check after an answer — todo

**Why:** Reopening an unfinished check can strand it between turns and lose feedback.
**Do:** Recover uncompleted feedback or the next question from the record and distinguish failed feedback in the subsequent turn.
**Done when:** A restart during feedback or before the next question resumes the correct step without regrading, repeating completed feedback, or resuming a detour unasked; a failed feedback turn is identified as such.

### K.4 Keep pending Stop and move-on notices — todo

**Why:** A restart forgets notices not yet delivered to the tutor.
**Do:** Keep the pending notices durably until a turn receives them.
**Done when:** Reopening sends each pending notice in the next applicable header, and another reopen does not resend delivered notices.

### K.5 Record misconceptions at the test — todo

**Why:** “What I know” calls a misconception found in a test answer a discussion finding.
**Do:** Identify findings from test answers by their recorded location without changing extraction or adding a detour.
**Done when:** A scripted handoff from a quoted test answer displays it as found in the test, and discussion findings still say discussion.

### K.6 Resolve historical code paths in the current workspace — todo

**Why:** A historical question card can copy a path from the old data root.
**Do:** Resolve replayed code-file paths against the current course workspace.
**Done when:** After relocating a temporary data root, replay and copying use the new paths, including for a closed question.

### K.7 Clean up interrupted atomic writes — todo

**Why:** Temporary files from interrupted record writes accumulate.
**Do:** Remove only the record's own abandoned atomic-write files at startup, not learner workspace files.
**Done when:** Startup removes seeded crash leftovers while preserving the committed record and unrelated files.

### K.8 Notify a blocked tutor of a planner decision — todo

**Why:** A tutor refused while the planner's proposal waits is not told when that restriction lifts.
**Do:** Deliver the decision in the refused tutor's next header.
**Done when:** A scripted tutor refused during planning receives the correct outcome after Apply or Keep and can propose again.

### K.9 Bound refused unit-planning calls — todo

**Why:** An individual planning turn can keep retrying refused tool calls.
**Do:** End the turn at a finite refusal limit without preventing an ordinary correction.
**Done when:** A scripted planner cannot keep calling after the limit and the existing corrected-plan path still succeeds.

### K.10 Preserve submitted code in tutor feedback — todo

**Why:** The tutor's copy of a submission loses trailing whitespace.
**Do:** Preserve the exact file content when formatting the grading feedback turn.
**Done when:** A submission ending in spaces and blank lines arrives unchanged in the tutor's file block.

### K.11 Keep scripted commands out of grading feedback — todo

**Why:** The scripted backend parses commands in text that never came from the message box.
**Do:** Interpret commands only in learner messages, not grading feedback.
**Done when:** Scripted feedback with command tokens in the submission or result still completes normally, and explicit learner commands work.

### K.12 Show test and skip progress accurately — todo

**Why:** The course card marks skipped work done and a review before a test says teaching resumes next.
**Do:** Render skips and the pending test from the record in the course and session views.
**Done when:** The course distinguishes a skipped segment from a completed one, and a review before the test neither shows “Segment 1” nor says teaching resumes next.

### K.13 Stop an aid from opening after cancellation — todo

**Why:** A Stop while an aid is being saved can still open it.
**Do:** Honor the turn cancellation when the write finishes before presenting the aid.
**Done when:** A controlled write that resolves after Stop opens no aid; a normal write still opens it.

### K.14 Show the right step after a detour dispute — todo

**Why:** A detour card can still promise a question the engine will no longer ask.
**Do:** Render its control from the effective assessment result.
**Done when:** An overturned opening miss shows the actual next step, and an unchanged miss still offers another question.

### K.15 Do not submit a composing answer — todo

**Why:** Enter can submit the question card during IME composition.
**Do:** Apply the message box's composition guard to the card's Enter actions.
**Done when:** A composing Enter neither submits nor advances focus, and an ordinary Enter still works.

### K.16 Give notes the citation details of links they receive — todo

**Why:** The notes writer can see a tutor's link to another unit's section only as an address.
**Do:** Supply citation details for valid section links in the transcript without changing the notes prompt.
**Done when:** A scripted notes request contains citation details for a cross-unit link but not for unrelated sections.

### K.17 Keep Markdown front matter out of the outline — todo

**Why:** A metadata delimiter can be taken as a setext heading.
**Do:** Recognize closed front matter at the start without losing source text or changing ordinary headings.
**Done when:** A conversion fixture keeps the metadata but outlines only the real headings, and an ordinary setext heading still works.

### K.18 Scope fake session lookup to its working folder — todo

**Why:** Tests can accidentally look up a saved session in the wrong workspace.
**Do:** Keep the working folder with fake sessions and use it for lookups.
**Done when:** A fresh fake sharing saved sessions finds an id only in the recorded folder.

### K.19 Make the notes HTTP tests independent of polling deadlines — todo

**Why:** Under load those tests can time out while the expected work is still settling.
**Do:** Replace wall-clock polling of notes completion with deterministic synchronization.
**Done when:** Controlled deferred completions exercise the original deadline dependency and the revised tests verify the same responses and persisted notes without polling.

## Known gaps

**A:** ready for a focused code fix (task above). **B:** product or design
decision needed. **C:** model behaviour or live evaluation. **D:** larger
work for Stage 6. A task that closes a gap deletes it here.

**Engine and record**

- **B:** A finished unit opened after a restart starts a new tutor session
  without the note saying the conversation is new. Decide what reopening a
  finished unit should do with its conversation.
- **A (K.1):** A crash between a segment override's evidence and position
  writes leaves its check and question open. Seen in the code, not reproduced.
- **A (K.2):** The first proposal is saved after the sources move, but the
  course is created before the moves. A crash there leaves a partial draft
  and startup discards the uploads that did not move.
- **A (K.3):** A restart between an answer and the next question can strand
  a check or lose feedback; the next-question turn after failed feedback
  does not say it failed.
- **A (K.4):** A Stop or move-on notice waiting for a tutor header is lost on restart.
- **A (K.7):** Atomic-write temporary files left by a crash are not cleaned up.
- **B:** Deleting a course leaves Claude Code's sessions outside the data root.
  Decide whether deletion should remove them; identify ownership before doing so.
- **A (K.12):** The course card ticks a skipped segment as done; a review
  holding the pre-unit test shows “Segment 1” and misstates what follows.
- **B:** A test skip is fixed at confirmation: a later miss in another
  unit's review can leave a still-upcoming objective skipped. Decide whether
  and when to reopen confirmed skips.
- **A (K.5):** A misconception found in a test answer appears in “What I
  know” as found “in the discussion”. The test deliberately has no detour.
- **A (K.8):** A tutor refused while the planner's proposal waits is not
  told when it is answered.
- **A (K.9):** No limit on refused `plan_unit` calls within one turn.
- **C:** The unit planner splits contexts into objectives (“a setting is
  not a skill” is unsettled) and names implementations (“using zip”).
- **A (K.18):** The fake backend's `hasSession` ignores the working folder.
- **A (K.19):** Under load (a full run beside other test runs), the notes
  tests in `http/app.test.ts` can miss their `expect.poll` deadline; they
  pass alone.

**Tutor, grading and judging**

- A check question on a one-claim explanation objective can ask for
  reasoning the lesson or detour already gave (`findings.md`, "Tutor"),
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
- **A (K.6):** “Copy path” on a historical code question goes stale after
  the data root moves.
- **B:** Only “What I know” shows the contents of submitted files.
  Decide whether to show them on the question card as well.
- **A (K.10):** The tutor's copy of a submitted file drops trailing whitespace.
- **A (K.11):** The scripted backend can take grading feedback for a command.
- **C:** There is no hand-graded set for math answers the symbolic check
  does not settle. The dispute set lacks disputes of a correct grade and
  does not separate Sonnet from Haiku.
- **C:** One Sonnet 5.5 notes call and one grading (P2, usually 3 s)
  exceeded the 3-minute limit; the cause is unknown.
- **C:** Once after Stop mid-sentence, the next one-sentence reply took
  10 to 30 seconds. Not seen again.
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
- **A (K.13):** Stop during an artifact write can still open the aid.
- **A (K.15):** The math field's Enter can submit during IME composition.
- **B:** After sending a message, keys go to the message box, not the
  pinned card. Decide where focus should go after sending.
- **A (K.14):** After a dispute overturns a detour's opening miss,
  its control still reads “Ready for another question”.
- **D:** WebKit reports opaque aid errors; recovering callback errors
  needs a reporter design and WebKit checks. DNS-prefetch is also untested
  in WebKit.

**Sources and sandbox**

- **B:** EPUB spine items marked `linear="no"` are written inside the
  preceding entry. Decide whether they should get an entry of their own.
- **A (K.17):** Markdown front matter is not recognized; the closing
  `---` can produce a setext heading.
- **D:** PDF fidelity: tables become short-line paragraphs; figure labels
  outside forms stay in the text; reading order comes from PDFium; tightly
  set lines can lose spaces (Inwood's “whereaswith”, “clearwhat”).
- **B:** Continued PDF footnotes can become body text; a bookmark with a
  title different from the printed heading can land at the top of the
  page. Decide how much uncertain layout inference is acceptable.
- **C:** `tutor.md` sends the tutor to a page whose math reads garbled;
  Sonnet looked at it only when asked.
- **A (K.16):** A link to another unit's section reaches the notes
  writer as a bare address.
- **C:** Notes are not checked against the source; one live run kept, in
  quotation marks, three of the source's words quoted unverified by the tutor.
- **D:** Sandboxed commands and artifact scripts have no peak disk,
  memory or CPU budgets; deadlines and output caps do not supply them.
