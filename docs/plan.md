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
quotes, and one unit taught from a paper.

### 4.22 Breakage the rehearsal of the user check found

- Status: todo
- Why: walking the check's path on Opus 5.5 (the _Phenomenology_'s Force
  and Understanding unit 1, the Attention paper's unit 1) and on
  `dev:fake` found these. None blocks the user's check.
  - Page: the segment headings' status words for screen readers (`.sr` in
    `SegmentHead`, `src/web/Session.tsx`) are absolutely positioned with
    no positioned ancestor inside the thread's scroller (`.th` is
    positioned, `.th-scroll` is not). In a thread longer than the window
    they sit far below it and the document itself scrolls (15,849 px in a
    900 px window): a second scrollbar at the window's edge, and a click
    can scroll the top bar away. `.cv-u` and `.vq figcaption` already
    contain theirs.
  - Reader: footnote references whose note is not in the section show
    raw, "[^1]" and "[^1-2]" to "[^1-9]" in Force and Understanding
    (Inwood's superscripts point at his commentary at the back). The page
    view reads "Page 57 of 543", a printed label beside the PDF's count.
  - Conversion: a line-end hyphen after a part that is already hyphenated
    ("Being-for-|other") is dropped when the whole compound appears
    nowhere else in the book (`_join` in `pytools/convert.py`;
    `findings.md`, "Hyphens are joined by the document's own usage"):
    "Being-forother" (p. 57), in a verified quote of the lecture too.
- Do: fix the three, with a test where behaviour changes.
- Done when: the reader and conversion fixes have tests, and all three are
  seen on the page.

### 4.23 Question rules the rehearsal saw broken

- Status: todo
- Why: in the _Phenomenology_ unit on Opus, after a written miss on an
  "explain" objective the next question was a choice whose right answer
  restated the detour's summary (`tutor.md`: a choice never stands in for
  another kind), and a check question asked what the lecture's ungraded
  try had asked (`tutor.md`: a question is new). Three of its four
  questions and the Attention unit's first asked for numbered parts
  ("explain (1) ..., (2) ..., (3) ..."), against "asks one thing", though
  `tutor.md` also has a question name each part its rubric requires.
  Decide whether source questions should name the paragraphs they are
  built on: it lets the learner reread while the question is open, though
  the tutor otherwise refuses to say where to read the answer.
- Do: fix and evaluate the teaching items without waiting for the user's
  stage check. Try questions with and without paragraph references on Opus
  before deciding, considering close reading and what the grader and help
  judge already do. Compare prompt versions as `findings.md` describes.
- Done when: the teaching items are fixed and the citation decision is
  made and explained in the commit, with the Opus comparison.

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

## Known gaps

Known and accepted for now; a task that closes one deletes it here.

**Engine and record**

- A finished unit opened after a restart starts a new tutor session
  without the note saying the conversation is new. Restarting a finished
  unit is not designed.
- A restart between an answer and the next question leaves the check
  waiting for a learner message, and a feedback turn cut off is lost. A
  Stop or move-on note waiting for the tutor's next header is lost on
  restart too.
- The next-question turn after a failed feedback turn does not say the
  feedback failed.
- A crash between an override's evidence line and its position write
  (`overrideSegment` in `engine/unit-record.ts`) leaves the segment in its
  check with the question open, and the objectives read overridden until
  an answer or a second override. Seen in the code, not reproduced.
- A crash after the first proposal but before the sources move out of
  `uploads/` loses them, and the next start empties `uploads/`.
- Atomic-write temporary files left by a crash are never cleaned up.
- Deleting a course leaves Claude Code's sessions for its workspace,
  outside the data root.
- The test before a unit: the course view's card ticks a skipped segment
  done; while a review holds the test, the top line reads "Segment 1" and
  the review card misstates where the unit resumes. Its skip is fixed at
  the result card, so an objective missed in another unit's review before
  its segment is still skipped.
- A misconception found in a test answer is recorded with no detour, and
  "What I know" says it showed "in the discussion".
- A tutor refused while a planner's proposal waits is not told when it is
  answered.
- No limit on refused `plan_unit` calls within one planning turn. The unit
  planner still splits contexts into objectives ("a setting is not a
  skill" is unsettled) and names implementations ("using zip").
- The fake backend's `hasSession` ignores the folder.
- Under load (a full run beside other test runs), the notes tests in
  `http/app.test.ts` can miss their `expect.poll` deadline; they pass
  alone.

**Tutor, grading and judging**

- The tutor can hint at an answer in free text outside a help exchange
  (teaching, feedback); only replies during an open question are judged.
  The help judge sees one exchange at a time, so a hint split over two
  replies passes.
- Nothing refuses a code question whose tests or solution are in the
  workspace, and nothing stops the tutor writing tests there; only
  `tutor.md` forbids it. The engine does not check the arithmetic of the
  tutor's answer keys.
- An old open code question without saved inputs cannot be graded
  reliably. "Copy path" goes stale after the data root moves; only "What I
  know" shows submitted files; the tutor's copy of a file drops trailing
  whitespace; the scripted backend can take grading feedback for a
  command.
- The grader has no hand-graded set for math answers the symbolic check
  does not settle. The dispute set has no case where a learner disputes a
  grade of correct, and does not separate Sonnet from Haiku.
- One Sonnet 5.5 notes call, and one grading in the grader's set (P2,
  usually 3 s), exceeded the 3-minute limit; cause unknown.
- Once, after a Stop mid-sentence, the next one-sentence reply took 10 to
  30 seconds. Not seen again, and not investigated.
- In a source course the tutor still writes runs of the source's words
  into its own sentences, unquoted and unchecked (18 of eight words or
  more over six Opus runs, two of them titles), and Sonnet quotes clauses
  outright. Nothing checks the tutor's text against the source, nor a
  written answer: copied without quotation marks, the source's sentences
  read to the grader as the learner's own.
- Untried on a real model: a learner who keeps asking in a detour or
  presses "Ready" at once; idle closing and resuming end to end; the tutor
  offering a large course's next stretch; scratch work in `$TMPDIR`; a
  dispute outcome in the header; `uv run` in the tutor's sandbox; `Glob`
  and `Grep` on record files under `dontAsk`. Stop with queued input is
  tested against a simulated SDK only.

**Page**

- Opening a unit with a long history draws the whole thread at once
  (about 3 s at 1,200 formulas); folding earlier sessions waits on the
  user's design.
- Stop during an artifact write can still open the aid when the write
  finishes. The math field's Enter can submit while an input method is
  still composing (the message box checks for it).
- After sending a message, keys go to the message box, not the pinned
  card. After a dispute overturns a detour's opening miss, the control
  still reads "Ready for another question".
- WebKit gives an aid's errors without their text; wrapping callbacks in
  the reporter would recover those from timers and handlers (not built).
  The DNS-prefetch header is untested in WebKit.

**Sources and sandbox**

- An EPUB's spine items marked `linear="no"` are written inside the entry
  before; whether such material gets an entry of its own is the user's to
  decide. Markdown front matter is not recognised, and its closing `---`
  can become a setext heading.
- PDF: tables become short-line paragraphs; figure labels outside forms
  stay in the text; PDFium's reading order is trusted; notes continuing on
  the next page read as body; a bookmark title that differs from the
  printed heading lands at the top of its page; PDFium drops a few spaces
  in tightly set lines (the Inwood introduction's "whereaswith",
  "clearwhat").
- `tutor.md` sends the tutor to a page whose math reads garbled; Sonnet
  looked at it only when asked.
- The notes writer's `<sections>` lists only the unit's sections: a
  tutor's link to another unit's section reaches it as a bare address.
  Nothing checks the notes against the source: the one live run kept, in
  quotation marks, three of the source's words that the tutor's text had
  quoted unverified.
- Sandboxed commands and artifact scripts have no budgets for peak disk,
  memory or CPU; the command deadline and output cap do not supply them.
