# Gauss: build plan

Open work only. Status values: `todo`, `in progress`, `blocked` (say why).
`AGENTS.md` says how to work a task. A finished task is deleted from this
file; its text and its checks are in its commit (`git log --grep='^2\.13'`).

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
decisions". Not in this stage (stage 6's list): a source added to a course
after its intake, text recognition for scanned PDFs, and questions on a
source's figure.

**User check:** a lecture on one chapter of the _Phenomenology_ with verified
quotes, and one unit taught from a paper.

### 4.1 Designs the stage needs

- Status: todo
- Depends on: stage 5
- Why: attaching a source, a section link, a page image, the course's
  sources and the web search setting have no design. Piece 5 settled a
  quote's citation and the passage it opens in the pane; piece 7's list of
  sources predates the course view's redesign (piece 20), which has none.
- Do: mocks in `docs/prototype/`, built as pieces 19 to 21 were, each with
  the agent's recommendation marked and the rest shown as the agent would
  build it.
  - Piece 22, a source in the intake: attaching a file (a button beside
    the message box, and a file dropped on the thread), the conversion
    running, and the card that reports what was found (title, format,
    pages, how many sections, pages with no text, stretches cut) or why it
    was refused (scanned, protected, not a format Gauss reads, too large);
    the proposal card with each unit's sections, folded when long.
  - Piece 23, reading the source: a verified quote as piece 5 has it, with
    the citation's wording for a page ("Preface, p. 19") and for a
    paragraph ("Chapter 1, ¶ 14"); a section link in the tutor's text,
    which claims no quote (recommended: the linked words with a small
    section mark, so that it reads neither as a quote nor as a web link);
    the pane each opens: the section's text with the quoted passage marked,
    or from the link's section or page, page numbers in the margin, the
    previous and next section, and a PDF page as an image on request
    (recommended: from its page number, the text staying the default); a
    web search in the thread, with its query and its links.
  - Piece 24, the course view: the course's sources, each opening the
    pane on its outline (recommended: a row below the units), and the web
    search setting (recommended: a switch, off by default, saying that it
    applies from a unit's next session and that searches leave the
    machine).
- Done when: the user has picked an answer to each; the picks are in
  `decisions.md`, "Page design"; `docs/prototype/index.html` lists the new
  pieces; the tasks below are revised where a pick differs from the
  recommendation.

### 4.2 Confined reads

- Status: todo
- Depends on: stage 5
- Why: a source is text from outside the machine and can carry
  instructions. A sandboxed command, the tutor's or the engine's, can read
  most of the machine and the server's environment (`decisions.md`,
  "Confinement"). The user accepted that an aid can still send data out
  through WebRTC on the ground that only the session's context is then
  exposed (2026-11-21), so reads are confined before the tutor reads a
  source.
- Do:
  - The tutor's commands: `sandbox.filesystem.denyRead` with the home
    folder, the data root and `/run/user/<uid>`, and `allowRead` with the
    course's workspace, `pytools/.venv` and `pytools/sandbox_exec.py`
    (every tutor command starts there on Linux), and the real folders of
    the runtimes the workspace's `.venv` uses (mise's Python, and `uv`).
    `allowRead` takes precedence inside `denyRead` by the SDK's settings
    and runtime 0.0.83's `sandbox-config.js`; untried.
  - The tutor's file tools: `Read`, `Glob` and `Grep` refused outside the
    workspace. `dontAsk` refused `Read` there in task 3.3; `Glob` and
    `Grep` were not tried. If they are not refused, try
    `blockReadsOutsideWorkingDirectories` with `blockReadsExemptPaths`,
    remembering that in 3.3 it also hid the home folder from commands.
  - The engine's commands (`configFor` in `engine/sandbox.ts`): the same
    denial, with each command's reads allowed back: `pytools/.venv` and
    its Python for every command, the workspace for a code question's
    tests, and the source's folder for conversion (4.6).
  - The environment: commands, the tutor's (through `sandbox_exec.py`) and
    the engine's, get a listed set of variables (`PATH`, `HOME`, `LANG` and
    `LC_*`, `TZ`, `TERM`, `TMPDIR`, and those the engine sets), not the
    server's.
  - An artifact's frame response sends `X-DNS-Prefetch-Control: off`. Try
    a DNS prefetch from an aid in Chromium (`<link rel="dns-prefetch">`,
    and an anchor to a host whose lookups can be seen), with and without
    the header.
- Done when: sandbox tests show an engine command reading the workspace
  and running `pytools/.venv`'s Python, refused a file under a scratch
  home folder and a record file beside the workspace, and given no
  variable outside the list. A Haiku tutor run on `pnpm dev` with a scratch
  data root shows `cat` of a scratch file in the home folder and of
  `../state.json` refused, `.venv/bin/python` and a code question's tests
  working, and `Read`, `Glob` and `Grep` outside the workspace refused.
  `decisions.md`, "Confinement", records the findings and what the
  prefetch did, and its "Reads are not confined" entry is rewritten.
  `mise run check` passes.

### 4.3 Conversion: text, Markdown, the outline and the cut

- Status: todo
- Depends on: stage 5
- Why: every format ends in the same outline and section files. The plain
  formats need no layout analysis, so the shared part is built and tested
  on them first.
- Do:
  - `pytools/convert.py ingest <original> <folder> [--limit N]` writes
    `outline.json` and `sections/<id>.md` into the folder and prints one
    line of JSON: the outline's summary, or a refusal with its reason.
    TXT: paragraphs between blank lines, no headings. Markdown: ATX and
    setext headings make the outline; a fenced block is never cut.
  - `Outline` in `src/shared/source.ts`, which the Python side writes: the
    source's id (its folder's name), title, the copy's file name and the
    name the learner gave it, format, SHA-256, the converter's version and
    the limit it cut at; for a PDF, its page count, each page's printed
    label where the PDF defines labels, and the pages with no text; and
    the entries, nesting as the source does: a heading with its entries,
    or a section with its id, title, size in characters, place (first and
    last page for a PDF, first and last paragraph otherwise), and, for a
    part of a cut stretch, its number and how many there are.
  - Section ids are `s1`, `s2`, ... in reading order; a course names a
    section `<source id>/<section id>`. A section file holds the source's
    own text, its heading included, and nothing Gauss adds but page
    markers (4.4) and footnote references, so the sections joined in order
    are the source's whole text. Text between a heading and its first
    subheading is a section of its own, under the heading's title.
  - The cut: a section over the limit (20,000 characters; `decisions.md`,
    "Sources") is cut into `ceil(size / limit)` parts at the paragraph
    boundaries closest to equal shares, with one part more while any part
    is still over the limit, each titled "<title> (part n of m)". A
    paragraph over the limit by itself is cut at the sentence end nearest
    its middle, or else at a space. Paragraphs are numbered within the
    stretch before it is cut, so its parts continue the count.
- Done when: pytest, on fixtures the tests build, covers a second run
  giving byte-identical files; a long stretch cut only at paragraph
  boundaries into parts within the limit whose joined text is the
  stretch; headings three deep; text before a first subheading; a
  paragraph over the limit; a fenced block left whole. A Vitest test
  reads a fixture's `outline.json` with the zod schema. `mise run check`
  passes.

### 4.4 Conversion: PDF

- Status: todo
- Depends on: 4.3
- Why: most sources will be PDFs (the user's _Phenomenology_, papers), and
  a PDF's text has no paragraphs, headings or reading order of its own.
- Do: `pypdfium2`, with Pillow for page images, added to `pytools`
  (`decisions.md`, "Sources").
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
  no text, a scanned file refused, page labels, and a rendered page. On
  the real files, kept out of the repository and read by hand with the
  findings in the commit: the Inwood _Phenomenology_ (its 127 bookmarks as
  the outline; the Preface in 6 parts cut between ¶s; no running head or
  footnote digit left in the text of ten sampled pages) and arXiv
  1706.03762 (bookmarks) and 1512.03385 (none). `mise run check` passes.

### 4.5 Conversion: EPUB

- Status: todo
- Depends on: 4.3
- Why: the fourth format. Its books have chapters, but often no headings
  in the markup.
- Do: the standard library only (`zipfile`, `xml.etree`, `html.parser`):
  EbookLib is AGPL. The outline from the navigation document (EPUB 3) or
  the NCX (EPUB 2); an entry's text runs from its target, a file or an
  anchor in one, to the next entry's, in spine order, and text before the
  first entry is a section of its own. XHTML to Markdown: headings,
  paragraphs, emphasis, lists, block quotes, footnote references, a
  table's rows as lines, an image as its alternative text, MathML as its
  `alttext`. A book whose text documents are encrypted (DRM) is refused;
  obfuscated fonts are not encrypted text.
- Done when: pytest, on EPUBs the tests build, covers an NCX outline, a
  navigation document with anchors into one file, a chapter with no
  heading tags, a long chapter cut, and DRM refused. On the user's Girard
  and Han EPUBs, kept out of the repository and read by hand: Girard's 20
  entries, with chapter 9, which its NCX lacks, inside the entry before
  it. `mise run check` passes.

### 4.6 Sources in the intake and the record

- Status: todo
- Depends on: 4.1, 4.2, 4.4
- Why: a source is attached when a course starts (the user's pick,
  2026-11-21), before the course exists: the first proposal makes it.
- Do:
  - A route that takes a file for an intake: the body is the file, its
    name in a header, at most 100 MB, under the API's rules (`decisions.md`,
    "HTTP and event stream"). The format from the content: `%PDF-`, an
    EPUB's `mimetype` entry, UTF-8 text named `.txt`, `.md` or
    `.markdown`.
  - Conversion runs `convert.py` in the engine's sandbox, as
    `engine/math-check.ts` runs `mathcheck.py`, reading the original and
    writing only the source's folder, with a five-minute limit. Without
    the sandbox, attaching is refused, as a symbolic question is. A
    source waits in `uploads/<intake id>/<source id>/` at the data root
    until the first proposal moves it into `courses/<id>/sources/`; one
    attached later goes there directly. At start, the uploads of intakes
    no longer running are removed. A source's id is a slug of its title,
    unique in the course.
  - The intake's thread shows the source's card (4.1) while it converts
    and when it is done. The planner's next turn gets each new source's
    outline, one line per entry (id, title, place, size); a reopened
    draft's intake gets its course's.
  - `record/backup.ts`: the history keeps each source's original,
    `outline.json` and sections, and leaves out `pages/`, images that can
    be rendered again.
  - The dev seed gains a course with a source made from a fixture text,
    through the record's own operations; the scripted planner answers a
    turn that brings a source's outline.
- Done when: fake-backend and route tests cover an upload converted and
  shown, the planner's turn with the outline, the move at the first
  proposal, a source attached after it, a format refused, a body over the
  limit, a conversion that fails and one that runs out of time, the
  start's clean-up, and `pages/` ignored by the backup (with an earlier
  `.gitignore` brought up to date). `mise run check` passes. On `pnpm
  dev:fake` a TXT and a PDF are attached in an intake that reaches a
  proposal, and the browser is closed before the server stops.

### 4.7 Units and segments name their sections

- Status: todo
- Depends on: 4.6
- Why: units point at sections (`brief.md`, "Sources"), and the unit's
  planning session reads the unit's whole text, so the tutor starts from a
  plan made from the text (`architecture.md` section 8).
- Do:
  - `Unit` (`src/shared/curriculum.ts`) gains the sections it teaches.
    `propose_curriculum` and `amend_curriculum` refuse an unknown section
    and a unit whose sections come to more than 150,000 characters (the
    Preface is 108,000), saying the total, so that the planner splits it.
    A course with no source has none.
  - The course planner gets the outlines as the intake's planner does; the
    proposal and change cards show each unit's sections (4.1).
  - Unit planning: the planning turn adds the unit's sections whole, each
    in a tag with its id, title and place, after the curriculum. `Segment`
    (`src/shared/plan.ts`) gains the sections it draws on: required when
    the unit has sections, each one of the unit's.
  - `planner.md`, `course-planner.md` and `unit-planner.md`: drafted here,
    revised on real runs in 4.12.
- Done when: tests cover a proposal with sections stored and shown, an
  unknown section and a unit over the limit refused, an amended unit
  keeping its sections, a planning turn holding the unit's text, and a
  plan whose segment names a section outside its unit refused. `mise run
  check` passes. One Haiku run on `pnpm dev`, with a scratch data root,
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
  - The scripted backend reads a section its header names.
- Done when: tests cover the header's sections in a segment, in a new
  session's first turn and in an assessment of another unit; `read_section`
  on another unit's section and on an unknown one; `view_page` on a PDF
  page (rendered once, then read from `pages/`), on a page out of range
  and in a source that is not a PDF. `mise run check` passes. A Haiku run
  on a unit of the Inwood _Phenomenology_ reads the segment's sections
  whole and views a page.

### 4.9 Verified quotes

- Status: todo
- Depends on: 4.1, 4.8
- Why: a passage the tutor quotes is verified to appear verbatim in the
  source (`brief.md`, "Sources").
- Do:
  - `quote_source({ text, section? })` searches each of the course's
    sources, its sections joined in order, so that a quote across a cut
    verifies. A match is recorded and shown: a page event with the source,
    the section, the source's own words for the span (not the tutor's),
    and the page or paragraph where it starts, shown as piece 5's quote
    (4.1). A match in the named section comes first, then in the segment's
    sections, then the first in reading order. Refused: text not found
    (saying to copy from a section read with `read_section`), under three
    words, over 1,200 characters, holding an ellipsis (two quotes
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
  restored after a restart. `mise run check` passes. A Haiku run quotes a
  passage from a section it read.

### 4.10 The citation view and section links

- Status: todo
- Depends on: 4.9
- Why: a citation opens the passage (`brief.md`, "Sources"), and a
  paraphrase links its section without claiming a quote (the user's pick,
  from the DeepTutor comparison).
- Do: as 4.1 settles.
  - A section link: the tutor writes `[words](source:<source id>/<section
    id>)`, or `.../p<page label>` for one of its pages. `src/web/prose.tsx`
    lets that address through and shows it as 4.1 settles; a section the
    course does not have shows the words alone. A link is text: no tool,
    nothing recorded.
  - The source pane: the section's text rendered (footnotes by
    `remark-gfm`), a quote's passage marked and scrolled to, a link's
    section from its top or page, page numbers in the margin from the
    page markers, the previous and next section, and a PDF page's image
    on request. Routes for a section's text and a page's image, rendered
    on request as `view_page` does.
  - The course view's sources, each opening the pane on its outline.
- Done when: tests cover the link's forms (a section, a page, an unknown
  section) and the pane's logic, as pure helpers beside `src/web/`'s
  others. `mise run check` passes. On `pnpm dev:fake`, in Chromium, a
  quote's citation, a section link and a page image each open the pane,
  and the browser is closed before the server stops.

### 4.11 Web search

- Status: todo
- Depends on: 4.1, 4.2
- Why: web search is allowed per course, used only for material the tutor
  lacks, and cited when used (`brief.md`, "Sources"). The user chose search
  without reading pages (2026-11-21): what the tutor writes then goes to
  Anthropic's search, not to a site of anyone's choosing.
- Do: the course's setting, in `course.json` and off when absent, with its
  switch (4.1). A tutor session of a course with it on gets Claude Code's
  `WebSearch`, allowed under `dontAsk`, and never `WebFetch`; the setting
  applies from the next session start or resume. Each search shows in the
  thread with its query and result links, taken from the tool's
  structured output. A `PreToolUse` hook refuses a query holding the
  account's email address (`accountInfo()`), the piece of the learner's
  identity every session has (`decisions.md`, "Claude backend").
  `tutor.md`: search only for what the sources and the tutor's own
  knowledge lack, cite what is used by its link, and quote nothing from
  the web verbatim.
- Done when: tests cover the tool given only with the setting on, a
  search's thread entry, and the hook's refusal. `mise run check` passes.
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
  findings are in `decisions.md`, "Prompts". `mise run check` passes.

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
  export. `mise run check` passes. One notes call on Sonnet 5.5 for a
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
  `decisions.md`, "Grader prompt" and "Help judge". `mise run check`
  passes.

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
