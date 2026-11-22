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

For each stage 4 task, `mise run check` must pass in addition to its
specific “Done when” checks.

### 4.12 The prompts in a source course

- Status: todo
- Depends on: 4.10, 4.11
- Why: until this stage a course quotes nothing verbatim from memory
  (`tutor.md`, "Quotations"); with a source, `quote_source` verifies quotes
  and the rule changes. Sources are taught lecture-style (`brief.md`,
  "Session rhythm").
- Do: `tutor.md`'s "Quotations": in a course with a source, quote it only
  through `quote_source`, from a section read, and link the section of a
  passage paraphrased, in the form the page opens
  (`source:<source id>/<section id>`, optionally `/p<printed label>`;
  `resolveSourceLink` in `src/web/source-target.ts`): a page by its printed
  label, which its marker gives, else by its number. Until the prompt says
  so only the scripted tutor writes a link. Another work, or the web, is
  paraphrased and attributed, as in a course with no source. Teaching from
  a source: go through the segment's passages in order, quoting the
  sentences that carry the argument and explaining them, within the
  teaching limit; use `view_page` where a page marker says equations or
  figures were lost. Revise 4.7's drafts of the planners' prompts. The
  method is `findings.md`, "Comparing prompt versions": old against new on
  the same moves, the agent's judgment. "Quotations" still says the tutor
  has no text of the works it teaches from; in 4.8's Haiku run the tutor,
  having read the section, quoted short phrases from it in its own text,
  and in 4.9's, asked for a passage, it called `quote_source` with the
  section named and then quoted a further sentence in its own text.
- Done when: Sonnet or Opus runs, since how well it teaches is what is
  checked, of a lecture on "Force and Understanding" in the Inwood
  _Phenomenology_ (4 parts) and of a unit on the Attention paper show
  verified quotes, section links, no verbatim quote outside
  `quote_source`, and a page viewed for the paper's equations. What the
  runs show that justifies the wording goes in `findings.md`, "Tutor".

### 4.13 Notes and the transcript in a source course

- Status: todo
- Depends on: 4.9
- Why: a unit's notes cite the source, and the exported transcript keeps
  the quotes.
- Do: the notes writer's request gains the unit's sections (titles and
  places) and the verified quotes in its transcripts with their
  citations; `notes.md` says to cite them as text, since the notes stand
  alone. The transcript export shows a section link as its words with the
  section's title and page: `resolveSourceLink`
  (`src/web/source-target.ts`) reads a link's address and names its
  place, and the export is the server's, so it moves to `src/shared/`
  rather than the address being read twice. The export shows a quote as a
  block quote with its citation already (`quoteCitation` in
  `src/shared/source-lines.ts`).
- Done when: tests on a seeded source course cover the request and the
  export. One notes call on Sonnet 5.5 for a
  source unit cites a quote by its place.

### 4.14 The grader's and help judge's sets in a source course

- Status: todo
- Depends on: 4.12
- Why: the grader's hand-graded set is math proofs, and the help judge's
  set math exchanges; neither has an explanation answer from a source
  course.
- Do: hand-graded written answers on the _Phenomenology_ and the Attention
  paper in `scripts/grader-set.ts`: correct; wrong, with the flaw; mostly
  right but vague (`brief.md`, "Mastery and evidence"); and one that
  quotes the text without explaining it. Hand-judged exchanges in
  `scripts/help-set.ts` while a question is open in a source course: what
  a term of the passage means, where in the text the answer lies, a
  section link given in reply, and the learner asking to see the passage.
  Run `grade-set.ts` and `judge-set.ts` with `--runs 2` on their default
  models; where they disagree with the hand grades, revise `grader.md` or
  `help-judge.md` as `findings.md`, "Comparing prompt versions", says.
- Done when: both sets run, with their agreement and any prompt change in
  `findings.md`, "Grader" and "Help judge".

## Stage 6: later

Codex backend (`findings.md`, "Codex"), self-test, cheat sheets, photo
input; starred messages for the notes, if the generated notes miss what the
learner wants kept; a model chosen in the app's settings, which the user
wants eventually (2026-11-19); teaching instructions the learner can add
to or edit (below); a source added to a course after its intake, text
recognition for scanned PDFs, and questions on a source's figure (left out
of stage 4). Each is planned when chosen.

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
- One Sonnet 5.5 notes call exceeded the 3-minute limit; cause unknown.
- Once, after a Stop mid-sentence, the next one-sentence reply took 10 to
  30 seconds. Not seen again, and not investigated.
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
  printed heading lands at the top of its page.
- Sandboxed commands and artifact scripts have no budgets for peak disk,
  memory or CPU; the command deadline and output cap do not supply them.
