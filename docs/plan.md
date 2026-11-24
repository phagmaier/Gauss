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

The Codex backend, broken down on 2026-11-24. The user's choices are in
`brief.md`, "Backends and stack": a course runs on Codex or Claude, picked
at its intake and fixed after; on Codex only its tutor and unit planner
run there. The adapter drives Codex's app-server protocol, not the SDK,
which runs each turn as a new `codex exec` with no system prompt, hook or
streamed text (`findings.md`, "Codex"). Unit opening checks Codex
availability, even when the unit's chat is already loaded (`brief.md`,
"Backends and stack"). Live runs use gpt-6.1-terra at medium on the
standard service tier through `check:live` (`codexOptions` in
`backends/codex.ts`), each asked of the user before it runs.

### 6.15 Codex: Gauss's own workspace tools — todo

**Why:** A tutor's file and shell tools are confined and asked about: the engine refuses a write or a command by phase (`WorkspaceTools.acquire`), with its reason reaching the model, and commands run with no network, reading only what the engine allows. Codex's own tools cannot do this safely: an approved escalation cannot be told from an ordinary approval and reaches the home folder, a decline carries no reason, and a command run unasked shows no item (`findings.md`, "Codex"). The user's choice (2026-11-24, `brief.md`, "Backends and stack"): a Codex tutor gets Gauss's own file and command tools instead.
**Do:** First, with no model (`codex debug prompt-input`'s nested tool list): find the settings that remove Codex's `exec_command`, `write_stdin` and `apply_patch` (`features.shell_tool=false` is a candidate; the patch tool's switch is unknown) and add them to `findings.md`'s configuration. If any cannot be removed, stop, record it, and ask the user. Then a Codex session given `workspace` gets, in its direct teaching namespace, workspace tools defined once in `src/server/tools/` (transport-free, as `tool.ts` says): read a file, list and search files, write a file, edit a file, and run a command. Reading, listing and searching stay inside the workspace and take no reservation; writing, editing and a command call `acquire`, are refused with its reason as the tool's result, and release once they finish, fail or are stopped. A path outside the workspace, or reached through a link out of it, is refused. A command runs in the foreground through the engine's sandbox (`engine/sandbox.ts`, with the session's `reads`, no network, a private temporary folder as `workspaceTmpDir`), is ended by the turn's signal, and has the deadline and output cap the engine's other commands have. A write or edit reports `file_written` once it succeeds. In `prompts/tutor.md`, the lines that name Claude's tools ("your Write tool", `WebSearch`) say what holds on either backend, so one prompt serves both; `scripted.test.ts` checks the header and tool wording the scripted backend reads.
**Done when:** tests show each tool refused by phase with its reason and nothing written, reservations acquired and released (also on failure and Stop), `file_written` after a write and an edit, paths and links out of the workspace refused, and a command that cannot read a denied record file or reach the network and can write only in its workspace and temporary folder (the real sandbox); against the scripted peer, a Codex session given `workspace` gets the tools and one without does not; `codex debug prompt-input` with the configuration shows none of Codex's shell or patch tools; `mise run check` passes.

### 6.16 A Codex course, live — todo

**Why:** The scripted peer shows the adapter follows the protocol, not that a Codex tutor teaches within Gauss's rules: prompts, tool descriptions, headers and refusals written for Claude now reach another model.
**Do:** Asked of the user first, through `mise exec -- pnpm check:live` on gpt-6.1-terra at medium: in a Codex course written into the root as `record/dev-seed.ts` does, two runs of a unit from its planning through its lecture (`read_section`, `present_lecture`), a discussion message, Ready, a choice and a written question each ending the turn, a miss and its detour, a code question's starter written in the workspace and its tests run, a Stop mid-reply, and a server restart followed by reopening the unit (a resumed thread). Compare what the tutor did with `prompts/tutor.md`'s rules, and with a Claude tutor's known behaviour (`findings.md`, "Tutor"). The protocol trial ran on gpt-6.2-sol: check that gpt-6.1-terra also ends its turn when a tool's result says so and reads a page image.
**Done when:** `findings.md`, "Codex", records what the runs showed, with evidence from Gauss's Codex home's session logs and the course's `sessions/`; each break of the engine's rules or the adapter's contract becomes a task here, and model behaviour a known gap (C).

User check for the Codex backend, after 6.16: with `pnpm dev` (the
learner's Claude login, and Gauss's Codex home signed in), make a course
on Codex at intake; its course view says so and web search is off. Take a
unit through its planning and lecture, a discussion message, Ready, a
question answered right and one missed with its detour, a code question
in a course about code, a Stop mid-reply, and a server restart followed
by reopening the unit. A Claude course behaves as before.

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
