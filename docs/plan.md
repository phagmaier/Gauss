# Gauss: build plan

Open work only. Status values: `todo`, `in progress`, `blocked` (say why).
Use the [task workflow in AGENTS.md](../AGENTS.md) to work a task or find a
finished one. A finished task is deleted from this file; its text and
checks are in its commit.

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
- Stage 5, mastery loop: passed on 2026-11-19. The user's notes from the
  check, and the comparisons with LearnHarness and DeepTutor the same day,
  added tasks 5.14 to 5.29 (`decisions.md`, "Product decisions"), all
  done on 2026-11-20.

## Stage 4: sources (built after stage 5)

The scope is `architecture.md` section 12's: ingestion for the four
formats, the outline, unit mapping, `quote_source`, the citation view, page
images and the web search setting. The design is `architecture.md` section
8. The choices behind it, with the trials on the user's files, are in
`decisions.md`, "Sources"; the user's picks of 2026-11-21 are in "Product
decisions". The pages are mocks 22 to 24 in `docs/prototype/`, picked the
same day (`decisions.md`, "Page design"). Not in this stage (stage 6's
list): a source added to a course after its intake, text recognition for
scanned PDFs, and questions on a source's figure.

**User check:** a lecture on one chapter of the _Phenomenology_ with verified
quotes, and one unit taught from a paper.

For each stage 4 task, `mise run check` must pass in addition to its
specific “Done when” checks.

### 4.9 Verified quotes

- Status: todo
- Depends on: 4.8
- Why: a passage the tutor quotes is verified to appear verbatim in the
  source (`brief.md`, "Sources").
- Do:
  - `quote_source({ text, section? })` searches each of the course's
    sources, its sections joined in order, so that a quote across a cut
    verifies. A match is recorded and shown: a page event with the source,
    the section, the source's own words for the span (not the tutor's),
    and the page or paragraph where it starts, shown as piece 23's quote,
    whose citation names the stretch where it starts, never Gauss's part
    ("Preface, p. 11"). A match in the named section comes first, then in
    the segment's sections, then the first in reading order. Refused: text
    not found (saying to copy from a section read with `read_section`),
    under three words, over 1,200 characters, holding an ellipsis (two quotes
    instead), and while a question of the unit is open, as `show_artifact`
    is. The result tells the tutor where the quote was found.
  - Matching, with a map back to the text's positions: case folded;
    whitespace, hyphens (U+002D, U+00AD, U+2010, U+2011) and Markdown's
    emphasis marks removed; curly quotes as straight, dashes as one; page
    markers, footnote references and the note definitions a PDF
    paragraph carries after it (`[^label]: ...`) left out, and the
    backslash before a PDF paragraph's leading `#`, `>` or `<`, and an
    EPUB's backslashes (`_ESCAPED`, `_LINE_START` and a `<br>`'s line end
    in `convert.py`) and the indent of a note's later paragraphs; lines that hold only a
    number of up to four digits left out (margin line numbers, as
    DeepTutor's `evidence_key` in `deeptutor/reading/_grounding.py`). A
    quote never matches across two sources.
- Done when: tests on fixture sections cover a quote across a cut, cited
  at its first part's page; a line-end hyphen and a margin line number
  inside a quote; curly quotes typed straight; a footnote reference inside
  the passage; a first letter's case changed; text not found, too short,
  too long, or with an ellipsis; two matches, in reading order and in the
  named section; a refusal while a question is open; the quote shown and
  restored after a restart. A Haiku run quotes a
  passage from a section it read.

### 4.10 The citation view and section links

- Status: todo
- Depends on: 4.9
- Why: a citation opens the passage (`brief.md`, "Sources"), and a
  paraphrase links its section without claiming a quote (the user's pick,
  from the DeepTutor comparison).
- Do: as pieces 23 and 24 show (`decisions.md`, "Page design").
  - A section link: the tutor writes `[words](source:<source id>/<section
    id>)`, or `.../p<page label>` for one of its pages. `src/web/prose.tsx`
    lets that address through and shows the words with a dotted underline
    and a small §, its tooltip naming the section and page; a section the
    course does not have shows the words alone. A link is text: no tool,
    nothing recorded.
  - The source pane: the section's text rendered (footnotes by
    `remark-gfm`; an EPUB's note can be defined in another section, its
    Notes chapter's, under a label unique only in the stretches that
    refer to or define it, so text joined from several stretches needs
    its labels told apart), a quote's passage marked and scrolled to, a link's
    section from its page lit briefly, a "Read" line's from its top; page
    numbers in the margin from the page markers, a dot by a page whose
    text lost math or images; the previous and next section; "Outline".
    A PDF page's image opens from its number in the margin, with "Back to
    the text". Routes for a section's text and a page's image, rendered on
    request as `view_page` does (`DataRoot.pageImage`; `pageMarkers` in
    `src/shared/source.ts` reads a section's page markers).
  - The intake card's "Outline" (piece 22) opens the pane on the source's
    outline. Before the first proposal the source is in
    `uploads/<intake id>/`, so its route goes through the intake.
  - The course view: a Sources section below the units, each source
    opening the pane on its outline (headings folded below the first level
    except where a unit reads, each section with its place and its unit);
    an open unit's "Reads" lines, each opening the outline with the unit's
    sections lit. The thread's "Read" and "Looked at" lines (4.8) open the
    pane there. The cards' "Reads" lines and the outlines' route are in
    place (`UnitList`'s `sources`, `useCourseSources`,
    `GET /api/courses/<id>/sources`).
  - The dev seed's source course gains a small PDF source, written with
    reportlab (a development dependency) and converted as the seed's
    Markdown source is, so that a page image can be opened on
    `pnpm dev:fake`.
- Done when: tests cover the link's forms (a section, a page, an unknown
  section) and the pane's logic, as pure helpers beside `src/web/`'s
  others. On `pnpm dev:fake`, in Chromium, a
  quote's citation, a section link and a page image each open the pane,
  and the browser is closed before the server stops.

### 4.11 Web search

- Status: todo
- Depends on: 4.2
- Why: web search is allowed per course, used only for material the tutor
  lacks, and cited when used (`brief.md`, "Sources"). The user chose search
  without reading pages (2026-11-21): what the tutor writes then goes to
  Anthropic's search, not to a site of anyone's choosing.
- Do: the course's setting, in `course.json` and off when absent, with its
  switch in a section of its own, "The web", below the sources (piece 24).
  A tutor session of a course with it on gets Claude Code's `WebSearch`,
  allowed under `dontAsk`, and never `WebFetch`. The setting applies from
  the learner's next message: moving the switch closes the course's kept
  tutor sessions, each once it is between turns, and the next turn
  resumes it with the setting's tools. Each search shows in the
  thread with its query and result links, taken from the tool's
  structured output. A `PreToolUse` hook refuses a query holding the
  account's email address (`accountInfo()`), the piece of the learner's
  identity every session has (`decisions.md`, "Claude backend").
  `tutor.md`: search only for what the sources and the tutor's own
  knowledge lack, cite what is used by its link, and quote nothing from
  the web verbatim.
- Done when: tests cover the tool given only with the setting on, a
  switch that closes a session between turns and the next turn resuming
  with the tool, a search's thread entry, and the hook's refusal.
  A Haiku run on the plan login, in a course with the setting on, searches,
  shows the entry and cites a link; with it off, the tool is absent. The
  SDK's detached search (a call that "stepped aside for a message the user
  sent", `sdk.d.ts`) is seen or ruled out.

### 4.12 The prompts in a source course

- Status: todo
- Depends on: 4.10, 4.11
- Why: until this stage a course quotes nothing verbatim from memory
  (`tutor.md`, "Quotations"); with a source, `quote_source` verifies quotes
  and the rule changes. Sources are taught lecture-style (the user's
  choice in the brief, `decisions.md`, "Product decisions", 2026-11-13).
- Do: `tutor.md`'s "Quotations": in a course with a source, quote it only
  through `quote_source`, from a section read, and link the section of a
  passage paraphrased; another work, or the web, is paraphrased and
  attributed, as in a course with no source. Teaching from a source: go
  through the segment's passages in order, quoting the sentences that
  carry the argument and explaining them, within the teaching limit; use
  `view_page` where a page marker says equations or figures were lost.
  Revise 4.7's drafts of the planners' prompts. 5.29's method
  (`decisions.md`, "Prompts"): old against new on the same moves, the
  agent's judgment. "Quotations" still says the tutor has no text of the
  works it teaches from; in 4.8's Haiku run the tutor, having read the
  section, quoted short phrases from it in its own text.
- Done when: Sonnet or Opus runs, since how well it teaches is what is
  checked, of a lecture on "Force and Understanding" in the Inwood
  _Phenomenology_ (4 parts) and of a unit on the Attention paper show
  verified quotes, section links, no verbatim quote outside
  `quote_source`, and a page viewed for the paper's equations. The
  findings are in `decisions.md`, "Prompts".

### 4.13 Notes and the transcript in a source course

- Status: todo
- Depends on: 4.9
- Why: a unit's notes cite the source, and the exported transcript keeps
  the quotes.
- Do: the notes writer's request gains the unit's sections (titles and
  places) and the verified quotes in its transcripts with their
  citations; `notes.md` says to cite them as text, since the notes stand
  alone. The transcript export shows a quote as a block quote with its
  citation, and a section link as its words with the section's title and
  page.
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
  right but vague (`decisions.md`, "Product decisions", 2026-11-19); and
  one that quotes the text without explaining it. Hand-judged exchanges
  in `scripts/help-set.ts` while a question is open in a source course:
  what a term of the passage means, where in the text the answer lies, a
  section link given in reply, and the learner asking to see the passage.
  Run `grade-set.ts` and `judge-set.ts` with `--runs 2` on their default
  models; where they disagree with the hand grades, revise `grader.md` or
  `help-judge.md` as their sections of `decisions.md` say.
- Done when: both sets run, with their agreement and any prompt change in
  `decisions.md`, "Grader prompt" and "Help judge".

## Stage 6: later

Codex backend (`decisions.md`, "Codex"), self-test, cheat sheets, photo
input; starred messages for the notes, if the generated notes miss what the
learner wants kept; a model chosen in the app's settings, which the user
wants eventually (2026-11-19); teaching instructions the learner can add
to or edit (below); a source added to a course after its intake, text
recognition for scanned PDFs, and questions on a source's figure (left out
of stage 4, `decisions.md`, "Sources"). Each is planned when chosen.

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
