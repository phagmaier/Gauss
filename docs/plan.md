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

## Stage 6

Cheat sheets, photo input; starred messages for the notes, if the
generated notes miss what the learner wants kept; text recognition for
scanned PDFs, and questions on a source's figure (left out of stage 4);
ranking passage matches with a cheap model, if the learner's use shows
local search leaves too many plausible matches. Each is planned when
chosen.

Self-test (6.23 to 6.26): `brief.md`, "Assessment modes" and "Page";
piece 27, direction A. It is a fourth assessment mode, run in a unit's
thread by its tutor, as review is (a separate examiner session is a
rejected design, `findings.md`). No shipped prompt text is moved or
reworded: what a self-test asks of the tutor is said in the header of its
turns, and in the new pass-over tool's description and fields, all of it
model-facing and new. LearnHarness's practice prompt
(`src/agent/prompts/practice/10-doctrine.md` there, AGPL: ideas only, no
text) is the input for that header: mix objectives; a retry after
feedback is a fresh problem; before posing, fix the model solution and
look for a shortcut that skips the target; give the smallest hint that
unblocks, one per request. The new text is tried on a real model only in
the user check (the user's choice, 2026-11-25).

### 6.23 Self-test in the record — todo

**Needs:** nothing open.
**Why:** The record knows three assessment modes (`AssessmentMode` in `shared/evidence.ts`). Status counts only review and gate answers as cold (`collectStandings` in `record/status.ts`), and only review and the gate pick objectives (`record/review.ts`). A self-test's answers count as review answers do, and it picks from a scope the learner chose.
**Do:** Add `"self-test"` to `AssessmentMode`. `AssessmentRun` (`shared/state.ts`) gets optional `kinds` (the question kinds picked) and `passedOver` (each objective with the tutor's reason), allowed only in a self-test. A self-test request (scope: a unit's segment, a unit, the course or a mix; the kinds, at least one; the count, 5, 10 or 20) is a zod schema in `shared/`, for the routes. In `status.ts` a self-test answer counts as a review answer: retained, slipping, the review schedule's row, and an override left in place. In `record/review.ts`, `pickForSelfTest` returns the objectives to ask, with how many the scope holds and how many the hour left out (for the setup's line). The scope holds its objectives with an answer or an override, and a mix only those passed at least once. It leaves out those answered within review's hour. When the scope holds more than the count, the weakest come first: slipping, then attempted or overridden, then passed or retained by the oldest last correct answer. A mix picks at random. The picked ones come in random order, through an injected source of randomness.
**Done when:** unit tests with picks and statuses worked out by hand show the following. A self-test miss on a passed objective makes it slipping. A correct answer marks it retained and lengthens its review interval. Each scope holds the objectives it should, and the hour rule leaves out the right ones, with its count. When the count cuts the scope, the weakest come first, and a seeded mix draws only objectives passed at least once. `mise run check` passes.

### 6.24 Running a self-test — todo

**Needs:** 6.23.
**Why:** An assessment runs in a unit's thread, offered on a card or started by "Review now" (`reviewThread` and `reviewCourse` in `engine/unit-chat.ts`, `engine/review-admission.ts`). Its rules are in `engine/assessment-rules.ts` (`runObjective`, `nextInRun`), and its header words in `engine/unit-turns.ts` (`runName` and the assessment header). A review in a finished unit is kept in `finishedReviews` (`shared/state.ts`, `engine/unit-record.ts`). A self-test starts at once from the course view, on the learner's scope, and asks a missed objective again only after another.
**Do:** `UnitChats.selfTest`, and two routes under `/api/courses/:id/self-test`: one starts it, the other answers the setup's counts for a request. Thread choice: a segment or unit scope runs in that unit's thread, and the course or a mix where "Review now" would (`reviewThread`, made general). It is refused for Review now's reasons and when there is nothing to ask. In a finished unit it runs as a review does there, with `finishedReviews` made general to any assessment kept for a finished unit. In a self-test, `nextInRun` holds a missed objective's second question back until another objective has been asked since the miss, when one is still undone. Ending is the existing skip partway (`skipAssessment`). The header of a self-test turn is new model-facing text. It says what is under way and where it stands, and gives the lead-in rule: say only that a question follows, or the unit it comes from, never its subject. Before posing, fix the model solution and look for a shortcut that skips the target. When the learner writes while a question is open, give the smallest hint that unblocks, one per request. Feedback and the detour are as in review. `handoff.ts` names a self-test (`runWords`). The scripted backend runs a self-test, for `pnpm dev:fake`.
**Done when:** engine tests on the fake backend with a temporary root show the following. A unit-scope self-test starts in that unit's thread, and a course one where Review now would. It is refused with a question or detour open, and with nothing to ask. After a miss, the next question is on another objective and the missed one comes back later; with one objective left, its second question follows the detour. Ending partway keeps what was answered and leaves the unit where it was. In a finished unit, the unit stays finished. A restart mid-run resumes it. The header's new lines arrive where they apply. `mise run check` passes.

### 6.25 The kinds picked, and passing over — todo

**Needs:** 6.24.
**Why:** The learner picks the kinds of question. The tutor asks only those, and passes over an objective none of them fits, saying why, which records nothing.
**Do:** In a self-test, `ask_question` refuses a kind not picked. The refusal names the kinds picked and the pass-over tool. A new teaching tool in `src/server/tools/` passes over the objective asked next, with a reason. Its description and fields are new model-facing text. It is accepted only in a self-test, with no question or detour open. It adds the objective and reason to the run's `passedOver` and an event to the thread, and the run moves on. The header names the kinds picked. Both backends get the tool. A Codex thread begun before this task lacks it until a new conversation (`findings.md`, "Codex"); add that to the Known gap on a Codex thread's tools. Outside a coding course, the scripted backend passes over every objective of a self-test whose only kind picked is code.
**Done when:** fake-backend tests show the following. A question of a kind not picked is refused with that reason. Passing over is refused outside a self-test and with a question open. Once accepted, it writes no evidence, the run asks the next objective, and the end counts the objective as passed over. Reopening the unit shows its line again. `mise run check` passes.

### 6.26 The page for a self-test — todo

**Needs:** 6.24 and 6.25.
**Why:** Piece 27, direction A. The course view has only "Review now" (`DueCount` in `web/Course.tsx`, shown only when something is due). The thread's assessment words know review, the gate and the test (`shared/assessment-view.ts`; `skipLabel`, `assessmentDetourStep` and `WHY` in `web/session.ts`).
**Do:** In `Course.tsx`, "Self-test" beside "Review now", shown whether or not anything is due. It opens the panel in place: the scope (a segment and a unit by their lists, the course, a mix), the kinds (at least one), 5, 10 or 20, the line from the counts route, Cancel, and "Start the self-test", which opens the unit's page with the run started. In the thread:
- the start marker, and the end marker with what the run did and how many it passed over;
- "End the self-test" beside the question or the detour's control, with its confirmation;
- the head of a missed objective's second question ("A second question, after question N's miss");
- the passed-over line;
- the top line's position.
"What I know" and the exported transcript name a self-test answer; the slipping reason reads "missed in a review, a gate or a self-test".
**Done when:** in Chromium on `pnpm dev:fake` with a fresh root, on "Calculus I": a self-test of unit 1 with choice questions runs in unit 1's thread, through a miss, its detour, the other objective, the second question and the end marker. The panel then leaves unit 1's objectives out for the hour, and its counts match the record. A self-test of unit 2 with only code passes over each objective, each with its line. A course self-test starts where Review now would, and ending it partway works. The pages read as piece 27, direction A shows. `mise run check` passes.

User check for the self-test, after 6.26. First, with `pnpm dev:fake`
on a fresh root, open "Calculus I" and press "Self-test" beside "Review
now". Pick unit 1 with only choice questions: the panel says how many
objectives it will ask. Start it. Answer the first question wrong: a
detour follows, and after "Ready for another question" the next question
is on unit 1's other objective; the missed one comes back after it. Read
the end marker. Back on the course view, pick unit 1 again: the panel
says its objectives were answered within the hour and are left out.
Self-test unit 2 with only code questions: the scripted tutor passes
over each objective with its reason, and the end marker counts them.
Then self-test the whole course: it runs in unit 5, where "Review now"
would; end it after one answer and read its end marker. Then, with
`pnpm dev` on your own logins, in a Claude course with a unit you passed
more than an hour ago, self-test that unit with choice and written
questions. The lead-ins name no subject, and a missed objective's fresh
question comes after another objective. A message asking for a hint
gets the smallest one, and the answer is marked as helped. Self-test
again with only math or only code, on a scope where some objective fits
neither: the tutor passes it over and says why. The self-test's header
lines and the pass-over tool have not run on a real model before this
check.

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

- **B:** A Codex tutor's thread that began in a course with no source
  keeps lacking the source tools after the course gains one. Once a
  restart resumes it, its instructions and headers offer the source and
  the tools it lacks, and a line saying it cannot read the source, not yet
  delivered, is lost. Decide whether Gauss should record which tools a
  thread began with, or start a new one.
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
- **B:** A tutor's command can make git or editor settings (`.git` and
  its hooks, `.vscode`, `.bashrc` and the like) where none exist, which
  the learner's git or editor may then run: a Codex tutor's at the
  workspace's top too, either tutor's deeper down. Gauss's file tools
  refuse them everywhere (`PROTECTED` in `tools/workspace.ts`). Decide
  whether Gauss should refuse or remove such files after a command.
