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

For 4.4 and 4.5, use user-approved local copies of the named real files
and keep them out of the repository. If a required private copy is
unavailable, run the generated fixture checks, ask the user for an
approved local location for the file, and report that real-file sign-off
is still pending. Generated fixtures do not substitute for the real-file
checks.

### 4.4 Conversion: PDF

- Status: todo
- Depends on: 4.3
- Why: most sources will be PDFs (the user's _Phenomenology_, papers), and
  a PDF's text has no paragraphs, headings or reading order of its own.
- Do: `pypdfium2`, with Pillow for page images, added to `pytools`
  (`decisions.md`, "Sources").
  - `convert.py` reads text and Markdown only, and refuses anything else
    as `format` (its tests' `paper.pdf` row changes). The shared part
    (`_outline`, `_cut`) works on the source's text with its headings and
    paragraphs as offsets into it (`Heading`, `Paragraph`), and gives each
    section's place as paragraphs; a PDF's are pages, and its pages fill
    `Outline.pages`.
  - The outline from the PDF's bookmarks. Without them (the ResNet paper),
    headings are lines set larger or bolder than the body, or numbered as
    headings are ("3.2.1 Scaled Dot-Product Attention").
  - Lines from PDFium's characters and boxes, joined into paragraphs (one
    starts at an indented line, a larger gap, or after a line that ends
    short of the margin), across page breaks. A word hyphenated at a
    line's end is joined. Running heads and feet, page numbers and margin
    line numbers (text repeated at one place on most pages, numbers alone
    at the margin) are left out, and so are private-use characters (the
    Inwood edition's running heads are made of them).
  - Superscripts: PDFium's font size is 1 on every character of the
    Inwood PDF, but the loose box's height tells body text (9.6) from a
    superscript (6.4); a ligature (7.2) is not one, and a superscript also
    sits above its line. A marker becomes a footnote reference
    `[^label]`, its label unique in the section; a note at a page's foot
    becomes its definition after the paragraph that refers to it.
  - A page marker at each page's start in the text, with the page's label
    and whether the page has images or math fonts, whose text extraction
    mangles (the Attention paper's `softmax(QKT √ dk )V`), so the tutor
    knows when to look at the page.
  - A PDF most of whose pages have no text is refused as scanned, needing
    text recognition; one that needs a password, as protected.
  - `convert.py page <original> <page> <png>` renders one page at 150 dpi
    (an Inwood page: 0.26 seconds, 414 KB).
- Done when: pytest, on PDFs the tests write (reportlab as a development
  dependency, or a small writer of the tests' own), covers bookmarks and
  type-size headings, a paragraph across a page break, a line-end hyphen,
  a running head, a superscript, a footnote at a page's foot, a page with
  no text, a scanned file refused, page labels, and a rendered page. Read
  the approved real files by hand and record the findings in the commit:
  the Inwood _Phenomenology_ (its 127 bookmarks as the outline; the
  Preface in 6 parts cut between ¶s; no running head or footnote digit
  left in the text of ten sampled pages) and arXiv 1706.03762 (bookmarks)
  and 1512.03385 (none).

### 4.5 Conversion: EPUB

- Status: todo
- Depends on: 4.3
- Why: the fourth format. Its books have chapters, but often no headings
  in the markup.
- Do: the standard library only (`zipfile`, `xml.etree`, `html.parser`):
  EbookLib is AGPL. Read into `convert.py`'s shared part, as 4.4's PDF is.
  The outline from the navigation document (EPUB 3) or
  the NCX (EPUB 2); an entry's text runs from its target, a file or an
  anchor in one, to the next entry's, in spine order, and text before the
  first entry is a section of its own. XHTML to Markdown: headings,
  paragraphs, emphasis, lists, block quotes, footnote references, a
  table's rows as lines, an image as its alternative text, MathML as its
  `alttext`. A book whose text documents are encrypted (DRM) is refused;
  obfuscated fonts are not encrypted text.
- Done when: pytest, on EPUBs the tests build, covers an NCX outline, a
  navigation document with anchors into one file, a chapter with no
  heading tags, a long chapter cut, and DRM refused. Read the user's
  approved Girard and Han EPUBs by hand: Girard's 20 entries, with
  chapter 9, which its NCX lacks, inside the entry before it.

### 4.6 Sources in the intake and the record

- Status: todo
- Depends on: 4.2, 4.4, 4.5
- Why: a source is attached when a course starts (the user's pick,
  2026-11-21), before the course exists: the first proposal makes it.
- Do:
  - A route that takes a file for an intake: the body is the file, its
    name in a header, at most 100 MB, under the API's rules (`decisions.md`,
    "HTTP and event stream"). The format from the content: `%PDF-`, an
    EPUB's `mimetype` entry, UTF-8 text named `.txt`, `.md` or
    `.markdown`.
  - Run `convert.py ingest` into a scratch folder with a valid slug for
    its name. The converter uses that name as the source id and the
    original's basename as the name the learner gave the file. Read its
    JSON line with a schema of its own, as `engine/math-check.ts` does.
    On success, derive the unique final slug from the returned title, set
    the parsed outline's id to that slug, and move the folder into place.
  - Conversion runs `convert.py` in the engine's sandbox, as
    `engine/math-check.ts` runs `mathcheck.py`, reading the original (the
    command's `readable` names its folder, inside the data root, which
    commands cannot otherwise read) and writing only the source's folder,
    with a five-minute limit. Without
    the sandbox, attaching is refused, as a symbolic question is. A
    source waits in `uploads/<intake id>/<source id>/` at the data root
    until the first proposal moves it into `courses/<id>/sources/`; one
    attached later in the intake goes there directly. At start, the uploads
    of intakes no longer running are removed. A source's id is a slug of
    its title, unique in the course.
  - The intake's thread shows the source's card (piece 22) while it
    converts and when it is done, or why it was refused. Send waits while
    a file converts. "Remove" on the card, until the first proposal,
    deletes the upload. The planner's next turn is told of each source
    attached (its outline, one line per entry: id, title, place, size),
    removed or refused; a reopened draft's intake gets its course's.
  - `record/backup.ts`: the history keeps each source's original,
    `outline.json` and sections, and leaves out `pages/`, images that can
    be rendered again.
  - The dev seed gains a course with a source made from a fixture text,
    through the record's own operations; the scripted planner answers a
    turn that brings a source's outline.
- Done when: fake-backend and route tests cover an upload converted and
  shown, the planner's turn with the outline, a source removed before the
  first proposal and refused removal after it, the move at the first
  proposal, a source attached after it, a format refused, a body over the
  limit, a conversion that fails and one that runs out of time, the
  start's clean-up, and `pages/` ignored by the backup (with an earlier
  `.gitignore` brought up to date). In the upload test, run the real
  converter in the engine's sandbox on a small Markdown fixture, using
  the locked `pytools` environment. Check the section text and that the
  parsed outline's id matches the final source folder's name.
  On `pnpm dev:fake` a TXT and a PDF are
  attached in an intake that reaches a proposal, and the browser is
  closed before the server stops.

### 4.7 Units and segments name their sections

- Status: todo
- Depends on: 4.6
- Why: units point at sections (`brief.md`, "Sources"), and the unit's
  planning session reads the unit's whole text, so the tutor starts from a
  plan made from the text (`architecture.md` section 8).
- Do:
  - `Unit` (`src/shared/curriculum.ts`) gains the sections it teaches.
    `propose_curriculum` and `amend_curriculum` refuse an unknown section
    and a unit whose sections' stored sizes sum to more than 150,000
    characters (the Preface is 108,000), saying the total so the planner
    splits it.
    A course with no source has none.
  - The course planner gets the outlines as the intake's planner does; the
    proposal and change cards show each unit's sections as piece 22 does
    ("Reads", consecutive parts of a stretch as one line, folded above two
    lines, and how much of the source the units read).
  - Unit planning: the planning turn adds the unit's sections whole, each
    in a tag with its id, title and place, after the curriculum. `Segment`
    (`src/shared/plan.ts`) gains the sections it draws on: required when
    the unit has sections, each one of the unit's.
  - `planner.md`, `course-planner.md` and `unit-planner.md`: drafted here,
    revised on real runs in 4.12.
- Done when: tests cover a proposal with sections stored and shown, an
  unknown section and a unit over the limit refused, an amended unit
  keeping its sections, a planning turn holding the unit's text, and a
  plan whose segment names a section outside its unit refused. One Haiku
  run on `pnpm dev`, with a scratch data root,
  plans a one-unit course on a chapter of the Inwood _Phenomenology_ and
  then its unit, each segment naming its sections.

### 4.8 Teaching from the sections

- Status: todo
- Depends on: 4.7
- Why: the tutor reads the segment's sections and may read others, and
  reads a PDF page as an image where the text lost equations or figures.
- Do:
  - Teaching tools `read_section` (a section's text, after a line naming
    it with its title and place) and `view_page` (a PDF page's image,
    rendered by `convert.py page` in the sandbox into the source's
    `pages/` and kept there), allowed at any time in a course with a
    source. Teaching tools rather than the tutor's file tools
    (`decisions.md`, "Sources"). `ToolResult` gains an image.
  - The tutor's system prompt gains "# Sources": each source's title and
    outline, one line per entry.
  - A segment's turn header names its sections with their titles and
    places. A review or gate question on another unit's objective names
    that unit's sections.
  - Each `read_section` and `view_page` shows in the thread as a line
    (piece 23: "Read" a section with its place, "Looked at" a page), a
    page event; 4.10 makes it open the pane.
  - The scripted backend reads a section its header names.
- Done when: tests cover the header's sections in a segment, in a new
  session's first turn and in an assessment of another unit; the thread's
  lines for a read and a page view; `read_section` on another unit's
  section and on an unknown one; `view_page` on a PDF
  page (rendered once, then read from `pages/`), on a page out of range
  and in a source that is not a PDF. A Haiku run
  on a unit of the Inwood _Phenomenology_ reads the segment's sections
  whole and views a page.

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
    markers and footnote references left out; lines that hold only a
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
    `remark-gfm`), a quote's passage marked and scrolled to, a link's
    section from its page lit briefly, a "Read" line's from its top; page
    numbers in the margin from the page markers, a dot by a page whose
    text lost math or images; the previous and next section; "Outline".
    A PDF page's image opens from its number in the margin, with "Back to
    the text". Routes for a section's text and a page's image, rendered on
    request as `view_page` does.
  - The course view: a Sources section below the units, each source
    opening the pane on its outline (headings folded below the first level
    except where a unit reads, each section with its place and its unit);
    an open unit's "Reads" lines, each opening the outline with the unit's
    sections lit. The thread's "Read" and "Looked at" lines (4.8) open the
    pane there.
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
  agent's judgment.
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
