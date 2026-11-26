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

## Stage 6

Cheat sheets; starred messages for the notes, if the generated notes miss
what the learner wants kept; text recognition for scanned PDFs, and
questions on a source's figure (left out of stage 4); ranking passage
matches with a cheap model, if the learner's use shows local search leaves
too many plausible matches. Each is planned when chosen.

Photos in messages (6.27 to 6.29): `brief.md`, "Other features",
"Photos"; piece 28, which 6.29 mocks. A photo goes to the tutor inside
the learner's turn. A tool the tutor would have to call is not used,
because a tutor sent to a page image looked at it only when asked (the C
gap on `tutor.md`'s garbled page, below). Both backends already pass
images in tool results (`view_page` in `claude.ts` and `codex-turn.ts`);
an image in a user turn is new on both. No shipped prompt text is
reworded. The words telling the tutor that a message has photos are new
header text, first read by a real model in the user check.

### 6.28 A message with photos reaches the tutor — todo

**Needs:** nothing open.
**Why:** From the route to the backend, a learner message is text alone:
`LearnerMessage` (the route's body), the `learner` page event
(`shared/events.ts`), `UnitChat.say` and `EngineTurn`
(`backends/backend.ts`). The Claude adapter sends it as a string
(`messages` in `claude.ts`), and the Codex one as a single text item
(`turn/start` in `codex-turn.ts`). A photo is taken in and staged by
`createPhotoTaker` (`engine/photos.ts`), made nowhere yet, and kept or
read by `DataRoot.keepPhotos` and `readPhoto`.
**Do:**
- Make the photo taker in `serve.ts`. A new route under the unit stages
  one photo with it, with the file as the body and its name in a header,
  as `attachFrom` in `http/app.ts` does, and answers with `PhotoStaged`
  (`shared/photo.ts`) or the refusal and its status. The unit message
  route takes 1 to 4 staged photo ids, and its text may then be empty.
  An id that is not staged is refused.
- `say` moves the photos into the course before it logs the message. The
  `learner` event gets optional `photos`, the stored names.
- `EngineTurn` gets optional images. Claude gets image blocks before the
  text. Codex gets image input items as data URLs: check the item's shape
  against the pinned CLI's protocol types (`codex app-server
  generate-ts`). If it differs from a tool result's image, note that in
  `findings.md`, "Codex".
- The turn's header says how many photos the message has. This is new
  model-facing text.
- The help judge's input says the message had that many photos, which
  the judge cannot see.
- In the transcripts the handoff and notes writers read, `[photo]` takes
  each photo's place.
- The fake backend records a turn's images. The scripted backend answers
  a message with photos by saying how many it sees.
- The intake and planning conversations take no photos.
**Done when:** fake-backend tests in a temporary root show the following.
- A message with two photos and no text logs one event with both names,
  and the backend gets one turn with both images' bytes, in order.
- With a question open, the message is taken, and the tutor's reply goes
  to the help judge with the photo line.
- An unknown id, an already-sent id and a fifth photo are each refused,
  and nothing is logged.
- A message queued behind a running turn keeps its photos when its turn
  runs.
- After a restart, reopening the unit replays the event, and nothing is
  sent again.

Unit tests, with no model call, show that each adapter builds its request
with the images: Claude's against the SDK's user message type, Codex's
against the `turn/start` request. `mise run check` passes.

### 6.29 Photos on the page — todo

**Needs:** 6.28, and the user's pick of a direction for piece 28.
**Why:** The composer (`web/Composer.tsx`) sends text alone. Neither the
thread's learner item (`shared/timeline.ts`) nor the exported transcript
(`engine/transcript-html.ts`) shows photos.
**Do:** First mock piece 28 in `docs/prototype/` in two or three
directions, add it to `index.html`, and ask the user to pick one. It
covers attaching in the composer (picker, paste and drop, thumbnails with
Remove, and a refusal), a message with photos in the thread, and a photo
opened at full size. Record the pick in `brief.md`, "Page", and the
rejected directions in the piece's header.

Then build the pick:
- Each photo is staged when attached, and Send waits until staging ends.
  A refusal shows beside its photo. There are at most four photos.
- The thread shows a message's photos, served by a new GET route under
  the unit that serves only that course's photos, and opens one at full
  size.
- The exported transcript embeds them as data URLs: its policy allows
  `img-src data:`.
**Done when:** in Chromium on `pnpm dev:fake` with a fresh root, in
"Calculus I", unit 1:
- attach a photo with the picker and paste a second, remove one, and
  send the message with text: the thread shows the photo, and the
  scripted tutor says it sees one;
- a photo is sent with no text;
- a `.heic` file and a fifth photo are refused with their reasons;
- a photo sent while a question is open is taken;
- after a server restart, the unit shows the photos again;
- the exported transcript, opened from disk, shows them.

The page reads as the picked direction. `mise run check` passes.

User check for photos, after 6.29. First, on `pnpm dev:fake` with a fresh
root, open "Calculus I", unit 1. Attach a photo from disk, paste a
screenshot, remove one, and send with a line of text: the thread shows the
photo, and the scripted tutor says it sees one. Open the photo at full
size. Try a HEIC file and a fifth photo: each is refused with its reason.
Press "Ready", send a photo while the check question is open, then answer
it. Restart the server: the photos are still in the thread. Export the
transcript and open it from disk: the photos are in it. Then, on `pnpm
check:live` with a fresh root (a real model, run when you do this check),
start a small course on Claude and another on Codex. In each, photograph
a page of handwritten working with one deliberate slip, send it with
"Where did I go wrong?", and see whether the tutor reads the working and
finds the slip.

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
