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

## Stage 6

Codex backend (`findings.md`, "Codex"), self-test, cheat sheets, photo
input; starred messages for the notes, if the generated notes miss what the
learner wants kept; a model chosen in the app's settings, which the user
wants eventually (2026-11-19); teaching instructions the learner can add
to or edit (below); a source added to a course after its intake, text
recognition for scanned PDFs, and questions on a source's figure (left out
of stage 4); ranking passage matches with a cheap model, if the learner's
use shows local search leaves too many plausible matches. Each is planned
when chosen.

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

The rest of the `src/server/engine/unit-chat.ts` split, broken down by
6.0: separate opening, turns, assessments, help, teaching tools and
learner actions without changing behaviour. The Codex backend and
self-test both reach into this code. Commits 98b4f97 and 75bffef, numbered
6.1 and 6.2 before this breakdown, moved post-answer progression and
review admission out; the numbers below start again.

Each task moves one concern into a module of its own, as those two did: a
`createX({ ... })` factory whose argument names what it takes from the
chat (a `Pick<UnitRecord, ...>`, the chat's queue as `exclusive`, getters
for state that stays, callbacks for closures still in `unit-chat.ts`),
and an interface for what it returns. A module never imports from
`unit-chat.ts`: a text the file shares, such as `UNIT_FINISHED`, is passed
in, as review admission takes `OVERRIDE_PENDING`. A tool's desk is made
with the chat, before `load`, and reads `running` at each call, as
`unit-aids.ts`'s are; code that runs only on a loaded unit is made in
`load` and held on `Running`, as progression and review admission are.
The learner's actions are not a module of their own: the chat object keeps
each action's guard (`act`, its waits for `loading`, its entry into the
queue), and the task that owns an action's concern moves its body. A move
keeps the order of awaits inside queues, when each closure reads what it
captures, every stop-signal check and error path, and every event, tool
name and text; the matching part of the file's header comment moves with
the code.

What stays in `unit-chat.ts`: the course level (`createUnitChats` with its
map of open chats, `reviewThread`, and `courseWorkspace` with the course's
queue and desks); the chat's state that several modules read (`running`,
`folder`, `stopCount`, `closing`, `loading`, `overrideWrite`, `style`,
`sourceLecture`, the queue and the log) and `Running`'s shared fields
(`context`, `plannerContext`, `notes`, `handoff`); `load`'s composition of
the record, source shelf, handoffs, agents and modules, with its error
path; the segment's own steps (`checks`, `checkDone`, `closeSegment`,
`segmentObjectives`, `sendTeaching`, and the actions `ready`, `override`,
`nextSegment` and `startFresh`); and `act`.

User check for the split, after 6.9: with `pnpm dev:fake` on a fresh
`GAUSS_DATA_ROOT`, a full session behaves as it did before. In "Three ways
of counting", take a unit from its source lecture through the discussion
(a message with "/quote", one with "/artifact"), Ready, a question answered
right and one answered "I don't know" with its detour and "Ready for
another question", a message while a question is open, "/style" applied
and "/amend" kept, the segment's close and the next segment, to Move on at
the closing card and the gate. In another course: the test before a unit
and its result card, "Review now", "/packages" installed where the sandbox
runs, and a server restart while an answer waits for the judge ("/hold"
in a message, then answer) followed by reopening the unit.

### 6.7 Assessments: review, gate and test runs — todo

**Why:** Self-test is a new kind of assessment run, and the runs (review, the gate, the test before a unit) are spread over the assessments part, the actions and the header.
**Do:** Move `startTest`, `shownByTest`, `showTestResult`, `sendTestSummary`, `runOn`, `showRun`, `runWhere`, `nextOf`, `goOnInRun`, `startRun`, `endRun`, `runWaits`, `headOf`, `answersResult`, `passedNow`, the bodies of `startAssessment`, `skipAssessment`, `skipTested` and `teachWhole`, and `Running`'s `assessmentHandoffs` into `unit-assessments.ts`, made in `load` and held on `Running`; `readAssessmentHandoffs` is exported on its own, since `load` reads it before `Running` exists. It takes the record, the agents' `send`, `canMoveOn` and `grading`, `emit`, `where`, the progression's `askInRun`, `afterReview` and `feedback`, `stopCount()`, the unit end's `end`, `sendTeaching`, the unit's context and notes, `readHandoff` bound to the course, and `unitId`. It returns those functions to the header, question posting, answers, unit end, review admission, progression and reopening. `unit-questions.ts`, made with the chat before any `Running` exists, takes `runOn`, `runWhere`, `nextOf` and `headOf` for the unit it is given, bound in `unit-chat.ts` as `(r) => runOn(r)` and the like: rebind them to that unit's assessments. Stays: `stopCount`, which a run's start captures as now; `Running`'s `context` and `notes`; `sendTeaching`.
**Done when:** `unit-review.test.ts`, `unit-test-out.test.ts`, `unit-gate.test.ts` and the rest of the existing tests pass with at most import-path changes; `mise run check` passes; the moved code is gone from `unit-chat.ts`.

### 6.8 Turns: the header and what it says once — todo

**Why:** What each turn's header says once (notes, the record's notices, the learner's decisions) is taken in `where` and delivered by the agents' hooks; a note taken twice or lost is what this code guards against, and the Codex backend's turns need the same delivery.
**Do:** Move `where`, `joined`, `takeNotices`, `fallBack`, the agents' `turnSent` and `turnEnded`, and `Running`'s `inHeader` and `noticesTaken` into `unit-header.ts`, made in `load` and held on `Running`. It takes the record (`tutorNotices`, `pendingStyleDecisions`, `pendingCurriculumDecisions`, `deliverNotices`, `deliverDecisions`, `position`, `evidence`, `finished`), the unit's context (the planner's first) and notes, `style()`, `checks`, the progression's `feedback`, `runWhere`, `shownByTest`, the handoff note and misconceptions, `emit` and the queue. It returns `where()`, `joined()`, `takeNotices(ids)`, `fallBack(learnerId?)`, `turnSent()` and `turnEnded(outcome)`. `unit-packages.ts` and `unit-questions.ts`, made with the chat before any `Running` exists, take `where(r)` for the unit they are given, bound in `unit-chat.ts` as `(r) => where(r)`: rebind it to that unit's header. Stays: `Running`'s `notes`, to which nine places in five concerns add and which `where` empties; `style`; `checks` and `sendTeaching` with the segment's steps.
**Done when:** `unit-chat.test.ts`, `unit-handoff.test.ts`, `source-quotes.test.ts`, `backends/scripted.test.ts` and the rest of the existing tests pass with at most import-path changes; `mise run check` passes; the moved code is gone from `unit-chat.ts`.

### 6.9 Opening: picking up where the record left the unit — todo

**Why:** Reopening a unit settles whatever a restart left (questions, judgings and grades, disputes, cards) and resumes the step that waits. It calls into every other part, so it moves last.
**Do:** Move the part of `load` after `running = r` (restoring the thread's questions, disputes and packages, the cards, the status and phase, and resuming the step that waits), `reopenAsked`, `restoreQuestions`, `restoreDisputes`, `tellDispute`, `askedHere`, `disputeKept`, and the bodies of `recordDispute`, `learnDispute` and `learnAnswer` into `unit-opening.ts`, made in `load` and held on `Running`. It takes `emit` and `events`, the record, the queue, the progression and review admission, `folder()`, `checkDone`, `closeSegment`, `sendTeaching`, the unit's notes, and the other modules' functions it calls (`grade`, `settleJudging`, `end`, the assessment functions, the proposals' and packages' replays); it imports `view` from `unit-questions.ts`, which exports it on its own. It returns `resume(recoveringOverride)` for `load` and the three bodies. Stays: `load`'s composition (the record, source shelf, handoffs, agents and modules, the tutor session's resume, the override's recovery, `running = r`), its error path (`failed`, `unit_failed`, closing unused agents) and `loading`.
**Done when:** `unit-chat.test.ts`, `disputes.test.ts`, `unit-handoff.test.ts`, `unit-test-out.test.ts` and the rest of the existing tests pass with at most import-path changes; `mise run check` passes; the moved code is gone from `unit-chat.ts`.

## Known-gap fixes

None open.

## Known gaps

**A:** ready for a focused code fix (task above). **B:** product or design
decision needed. **C:** model behaviour or live evaluation. **D:** larger
work for Stage 6. A task that closes a gap deletes it here.

**Engine and record**

- **B:** A finished unit opened after a restart starts a new tutor session
  without the note saying the conversation is new. Decide what reopening a
  finished unit should do with its conversation.
- **B:** Header notes other than the move-on and unseen-lecture notices
  are kept in memory and taken when a header is composed. A Stop after
  composing, before sending, loses them (with "This conversation is new"
  and its handoff block); a restart before the next turn loses an
  assessment's end, a dispute's outcome and the answer to the test's
  result card. After a restart the test's "Start learning instead" summary
  says only that a restart came. Decide which must survive.
- **B:** A restart ends course planning and clears its proposal block,
  but a resumed tutor session can still remember the refusal. Decide
  whether to clear that stale instruction or recover an undelivered
  planner decision.
- **B:** Nothing stops two servers from opening one data root (on
  different ports): the second's start clears the first's uploads and the
  temporary files of its writes in progress. Decide whether a data root in
  use should be refused.
- **B:** Startup clears only interrupted record writes and uploads. A crash
  while a page image renders leaves its `.render-*` scratch folder in the
  source's `pages/`, and a deleted course whose removal failed stays parked
  in `courses/`; nothing removes either later. Decide whether startup should.
- **B:** Deleting a course leaves Claude Code's sessions outside the data root.
  Decide whether deletion should remove them; identify ownership before doing so.
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
- **B:** A dispute that turns an earlier objective's correct answer into
  a miss, made in the detour after the last objective's second miss,
  leaves the card on “Finish the review” (or the gate) while the engine
  asks that objective again (found by review). Decide whether so rare a
  case needs the card to read the whole run.
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
