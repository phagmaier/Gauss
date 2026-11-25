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

## Stage 6

Self-test, cheat sheets, photo input; starred messages for the notes, if
the generated notes miss what the learner wants kept; a source added to a
course after its intake, text recognition for scanned PDFs, and questions
on a source's figure (left out of stage 4); ranking passage matches with a
cheap model, if the learner's use shows local search leaves too many
plausible matches. Each is planned when chosen.

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

The tutor's model and teaching instructions (6.17 to 6.19): `brief.md`,
"Teaching style", "Backends and stack" and "Page"; piece 25, direction A.
Every task keeps one order of precedence for a model: under
`GAUSS_LIVE_CHECK=1`, `LIVE_CHECK_OPTIONS` and `CODEX_LIVE_CHECK_OPTIONS`
override everything; otherwise `GAUSS_CLAUDE_MODEL` and `GAUSS_CODEX_MODEL`
override the setting, and the setting overrides the default. Settings
live in the data root only, never in a Codex home or `~/.claude`.

### 6.18 Teaching instructions the learner can edit — todo

**Needs:** 6.17 (the settings record, and renewing open units on a save).
**Why:** The learner can rewrite or add to the tutor's default style app-wide, while the rules the app relies on stay fixed and Gauss's text is kept to revert to.
**Do:** Mark the first paragraph of "Default style" in `prompts/tutor.md` as the editable part. The loader splits the prompt there, refuses to start if the marks are missing, and never sends them to a model. The learner's text is `teaching.md` in the data root, with its schema and length limit in `src/shared/settings.ts` as the profile's are, and the backup keeps it. Saving text identical to Gauss's removes the file. A save is refused if the file changed since the page read it, as the Profile page's `was` does. `tutorSystemPrompt` puts the learner's text in place of Gauss's paragraph, for Claude and Codex courses alike. A save renews every open unit.
**Done when:** tests show that with no edit the tutor's system prompt holds `tutor.md`'s text unchanged, without the marks; that an edit replaces only that paragraph, with the fixed paragraph and every other section unchanged; that a Codex course's tutor session receives the edited prompt; that after a save an open unit's next message resumes on the new prompt; that saving Gauss's text removes the edit; and that a stale `was` is refused. `mise run check` passes.

### 6.19 The Settings page — todo

**Needs:** 6.17, 6.18.
**Why:** The learner reaches both settings from one page (piece 25, direction A).
**Do:** Routes to read the settings (each backend's chosen and offered models with their descriptions; the learner's text if any, Gauss's text, the fixed paragraph and the limit), to save a model and to save the instructions. The page at `/settings`, opened by "Settings" beside "Profile" in the library's top line, as piece 25's direction A shows it. Remove the pair from `brief.md`'s "Later".
**Done when:** in Chromium on `pnpm dev:fake` with a fresh root: Settings opens from the library. Picking Sonnet 5.5 and gpt-6.2-sol saves them: `settings.json` holds them and a reload shows them. An edited text saves, shows "Your edit" and Gauss's text in its fold, survives a reload, and `teaching.md` holds it. "Restore Gauss's text" then Save removes `teaching.md`. Text over the limit cannot be saved. `mise run check` passes.

User check for the tutor's model and teaching instructions, after 6.19:
with `pnpm dev:fake`, open Settings from the library, pick each model,
edit the instructions, reload, and restore Gauss's text; the page reads
as piece 25 shows. Then with `pnpm dev` on your own logins (not
`check:live`, which pins the model): in a Claude course's unit in
progress, switch to Sonnet 5.5, add a line to the instructions (say,
"Use British spelling"), and send a message. The tutor goes on with the
conversation and follows the line, and Claude Code's session log for the
course's workspace shows the new model. The same in a Codex course with
gpt-6.2-sol, if you want to spend the turns: its rollout's
`turn_context` shows the model. A conversation switching model
mid-unit has never run in Gauss, and no automated or live check can try
it.

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
