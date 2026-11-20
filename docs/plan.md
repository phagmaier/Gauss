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
  added tasks 5.14 to 5.29 (`decisions.md`, "Product decisions").

## Stage 5: follow-ups from the check (built before stage 4)

The tasks the stage's check and the two comparisons added. The stage's
views are laid out in the mocks, pieces 15 to 18 of `docs/prototype/`, and
the redesign in pieces 19 to 21 (`decisions.md`, "Page design"), which
tasks 5.31 to 5.39 build in the redesign's look, which the app has. Every
view must still read at 30 units: `pnpm dev:fake` seeds
"Calculus 1 to 3" with thirty, and its scripted planner proposes thirty
for "/large". Not in this stage: sources and web access (4.0), self-test
and cheat sheets (stage 6).

### 5.35 Quote

- Status: todo
- Depends on: 5.30
- As piece 19. Selecting text in the tutor's text or a question's prompt
  offers "Quote" over the selection. It puts the passage in the message
  box as a Markdown quote (each line `> `, then a blank line), after any
  draft, and focuses the box at its end. Math comes back as its LaTeX
  source between `$`, not KaTeX's doubled text; the source is in KaTeX's
  MathML annotation. The learner's message shows a quote as a quote:
  today a learner's message is plain text (`th-you` in `Session.tsx`).
  The tutor gets the text as sent, and the help judge judges it as any
  message. No side thread. To settle in the task: how the conversion is
  tested without a browser.
- Done when: a test turns a selection across inline and display math into
  its source. On `pnpm dev:fake`, Quote fills the box, the sent message
  shows the quote, and the scripted tutor answers it.

### 5.36 Skipping the gate partway

- Status: todo
- Depends on: nothing
- `SKIP_GATE_ASKS` (`src/web/session.ts`) is written for the gate's card.
  Partway, "Skip the gate" asks with a second text, settled in piece 19:
  "Skip the rest of the gate? Your N answers so far count. Any open
  question is dropped. Nothing more is marked retained, and the gate
  is not offered again. To stop for now instead, just leave: the gate
  picks up where you left off when you come back." Its buttons read
  "Skip the rest of the gate" and "Keep going". The wording covers an
  open question and a detour: the engine restores whichever was waiting
  (`architecture.md` section 4, "Assessments").
- Done when: a test shows the partway text with the answer count (one
  answer, and several), and the card's text unchanged; on `pnpm dev:fake`,
  "Skip the gate" after one gate answer and during a detour shows it.

### 5.37 The course view down to objectives

- Status: todo
- Depends on: 5.31
- As piece 20 (`decisions.md`, "Page design", "The course view is built
  around the unit list, down to objectives"). The view has the title, a
  line with the units, the finished units, and the objectives passed in
  the units started; the place for the due count and "Review now", which
  5.24 and 5.25 fill; and the card. On a finished course the card reads
  "Every unit is finished", with "Plan what comes next". Under "Units"
  is "Change the curriculum"; 5.38 makes both work. Each unit is a heading
  with "Unit N", its title, "k of n passed" and its form. A started unit
  lists its objectives with their forms and words, and "Next" in the
  accent, with the ringed form, marks the current objective (5.31) of
  the unit the card leads to. The course and unit counts include only
  passed and retained objectives, even when finished. A unit not started
  shows its goal, "Its objectives are set when it starts", Start and
  Test out. A finished unit has Open, and Notes or "Write notes". Only
  units in progress open by default. Manual opening and folding survive
  opening and closing the course map. The top line has "Course map",
  which opens the side pane as "Show the diagram" does today, and
  "What I know". The course response gains each started unit's objective
  statuses (`UnitProgress` in `src/shared/library.ts`), derived, never
  stored. The objective rows replace the retained and slipping counts
  under a finished unit. "Next" is `currentObjective` (`src/shared/plan.ts`),
  which needs the position's phase, `again` and the test's skip, which
  `UnitProgress` does not send yet; the forms are `StatusForm.tsx`.
- Done when: tests on hand-made progress give the objective statuses and
  show that "Next" stays in the active segment after an earlier override.
  A finished course with slipping and overridden objectives shows counts
  consistent with its unit rows. On `pnpm dev:fake`, Calculus I and
  Calculus 1 to 3 read as piece 20, retain manual folding across map
  toggles, and Start, Test out and Continue still work.

### 5.38 Planning from the course view

- Status: todo
- Depends on: 5.37
- The user's pick (`decisions.md`, "Page design", "A curriculum change is
  asked for from the course view"). "Change the curriculum", and a
  finished course's "Plan what comes next", open a planning conversation
  of the course, run as the intake is. The planner is given the course,
  its curriculum with each unit's status and its objectives' statuses,
  the style note (with the later stretches it names), and the profile. It
  asks, then proposes with the change tool, and the proposal is the
  curriculum change card (`CurriculumCard.tsx`), with Apply and "Keep the
  current one". A change's rules hold: a started unit cannot be dropped,
  and one proposal waits per course. Applying goes back to the course
  view. This closes the gap in `decisions.md`, "Product decisions", large
  courses: a finished unit's tutor has no tools. To settle in the task:
  the prompt (a section of `planner.md` or a file of its own), the chat's
  route and transcript, whether it is refused while a unit chat of the
  course is open, how open unit chats hear of an applied change (as they
  do for a unit tutor's), and the scripted planner for `pnpm dev:fake`.
  `architecture.md` sections 4 and 10, and `decisions.md`, "Mastery loop",
  "Style and curriculum changes", change with it.
- Done when: fake-backend tests show the conversation proposing and
  applying a change that adds units to a finished course, and refusing
  what a unit tutor's change refuses. On `pnpm dev:fake`, "Plan what comes
  next" on a finished seeded course reaches a card and applies it. A short
  real-model run (Haiku), on a finished course whose style note names the
  next stretch, proposes that stretch.

### 5.39 The library grouped

- Status: todo
- Depends on: 5.31
- As piece 21. Courses are grouped as in progress, drafts (a curriculum
  not approved) and finished, each group with its count and newest first.
  A one-off sits in its group, marked "One-off". A row has the title,
  where it stands, when it was last opened, a status form per unit in
  place of the ticks, and at its right the place for the due count, which
  5.24 fills. The top line has Gauss, Profile and New course.
- Done when: `library.test.ts` shows the grouping, with a draft, a course
  with nothing started, and a finished one-off. On `pnpm dev:fake`, the
  seeded library reads as piece 21.

### 5.18 Deleting a course

- Status: todo
- Depends on: nothing
- The user's decision (2026-11-19): a course or a draft can be deleted
  from its course page; there is no archive. A draft asks a plain
  confirmation; a course with any evidence asks the learner to type its
  title, and says what goes: progress, notes, transcripts and the
  workspace's files. The delete removes `courses/<id>/` and asks for a
  backup commit, so the git history keeps it; the app offers no undo.
  Refused while a chat of the course is open, the tutor or a grading,
  judging or notes call of it is running, or a package install is under
  way. The course leaves the library and "what I know", and the
  finished-courses list, which is derived, drops it.
- Done when: tests on a temporary data root show a draft and a course
  with evidence deleted, the refusal while a unit chat is open, and the
  backup commit asked for; on `pnpm dev:fake` both deletes work from the
  page and the library no longer lists them. Record the decision in
  `decisions.md`, "Product decisions".

### 5.19 Review picks the most overdue

- Status: todo
- Depends on: nothing
- The user's decision (2026-11-19, from the LearnHarness comparison):
  review asks first about the objectives most overdue. Today
  `pickForReview` (`src/server/record/review.ts`) ranks by status, then
  by lowest confidence, and age only breaks ties: a retained objective
  last asked a month ago waits behind a passed one asked the day before,
  and one confirmed five times comes up as often as one confirmed once.
  Instead, an objective is due again some time after its last correct
  answer, and that time grows with each correct answer in a row given in
  a review or a gate; slipping objectives still come first. The due time
  is derived from the evidence log, nothing stored. Not FSRS, which needs
  a rating per answer and many answers per item. To settle in the task:
  the intervals (the agent's example: 1, 3, 7, 21 and 60 days), whether
  review is offered when nothing is due, and whether the gate's pick of
  other units' objectives, which is review's (`pickForGate`), follows.
  `brief.md`, "Assessment modes", already states the new rule.
- Done when: tests on hand-made evidence logs show the order (a slipping
  objective first; a retained one long unasked before a passed one asked
  the day before; the interval growing with correct answers in reviews
  and gates), and `architecture.md` section 4, "Assessments", says how
  review picks.

### 5.20 An aid's errors reach the tutor

- Status: todo
- Depends on: nothing
- The user's decision (2026-11-19, from the LearnHarness comparison):
  when an artifact's script fails, the side pane says so and offers a
  button that sends the error's text to the tutor as the learner's
  message, so the tutor can mend the aid. Today a failing aid shows blank
  or half drawn, and the tutor never learns of it. The frame runs scripts
  in an origin of its own (`architecture.md` section 10, "Artifacts");
  how the error leaves it is the task's to settle, and the page must take
  reports only from the artifact frame it shows. A message sent while a
  question is open is judged for help as any other.
- Done when: on `pnpm dev:fake`, an aid whose script throws shows the
  error and the button, and pressing it sends the error as a message; a
  test shows that a report from anything but the shown frame is ignored.

### 5.21 "I don't know" with a wrong key

- Status: todo
- Depends on: nothing
- The user's decision (2026-11-19, from the DeepTutor comparison): an
  "I don't know" answer's card offers "The answer shown is wrong",
  decided by the dispute judge as a dispute is, once per answer. The
  miss stands; only the key changes, a corrected choice letter or
  expected expression, which then shows wherever the key did: the
  graded card, "What I know", what the notes writer reads, and the
  tutor's next header. Today "I don't know" cannot be disputed
  (`decisions.md`, "Disputes"), so a wrong key on one stays in the
  record, and in task 5.13 it went into the first notes as the right
  value; `prompts/notes.md` asks the writer to work values again, which
  does not reach "What I know". `tutor.md` says about one math key in ten
  was wrong in real runs. Not DeepTutor's way
  (`mastery_repair_question`), where the tutor that wrote the key
  decides. To settle in the task: what the learner writes (a reason, as
  for a dispute), what the judge sees with no answer to grade, and
  whether written and code questions, which show no key, are covered.
- Done when: tests on hand-made evidence show an "I don't know" re-keyed
  by the judge, still a miss for status and calibration, with the
  corrected key in "What I know" and in the tutor's next header; on
  `pnpm dev:fake` the card offers it and shows the outcome. If
  `dispute-judge.md` or `DisputeJudgment` change, re-run
  `node scripts/decide-set.ts --runs 2` with a case of this kind.
  `decisions.md`, "Disputes", changes with it.

### 5.22 Misconceptions in the learner's words

- Status: todo
- Depends on: nothing
- The user's decision (2026-11-19, from the DeepTutor comparison): each
  misconception carries the learner's words that showed it, quoted by
  the handoff writer; the engine checks them against the stretch it sent
  (`readStretch` in `engine/handoff.ts`) and drops a misconception whose
  words are not there. "What I know" shows them under the
  misconception. Today `believed` is the writer's paraphrase and nothing
  checks it (`src/shared/misconception.ts`); `handoff.md` only asks for
  none invented. An answer that only left something out has no false
  statement to quote, which backs 5.14's rule that a gap is no
  misconception. DeepTutor checks the learner quotes behind its teaching
  notes the same way (`deeptutor/learning/teaching.py` in that project).
  The field is optional: misconceptions already recorded have none. To
  settle in the task: how far the check normalises (spacing, math
  markup), and what is logged when one is dropped.
- Done when: tests with the fake backend show a reply whose quoted words
  are in the stretch recorded with them and one whose words are not
  dropped; a short real-model run (Haiku) shows the writer quoting the
  learner; on `pnpm dev:fake`, "What I know" shows the words.

### 5.23 Questions from inside an aid

- Status: todo
- Depends on: 5.20
- The user's decision (2026-11-19, from the DeepTutor comparison): an
  aid can put a question into the message box, such as a button "Ask
  about this" that fills in what the aid shows ("why does the series
  stop converging at $x = 1.2$?"); the learner sends it or not, and the
  page never sends it by itself. It uses the channel 5.20 makes from the
  aid's frame, taking messages only from the frame it shows. A message
  sent while a question is open is judged for help as any other.
  `tutor.md` says when an aid offers one. DeepTutor does this with
  `sendPrompt(text)` and `data-prompt` (`web/lib/iframe-html.ts` in that
  project). To settle in the task: a length limit, and what happens to
  text already in the message box.
- Done when: on `pnpm dev:fake`, an aid's button fills the message box
  and nothing is sent until the learner sends it; a test shows a request
  from anything but the shown frame ignored.

### 5.24 Reviews due, shown before a unit is opened

- Status: todo
- Depends on: 5.19, which gives each objective a due time, and 5.37 and
  5.39, which make the places for the count (pieces 20 and 21)
- The user's decision (2026-11-19, from the DeepTutor comparison): each
  course's row in the library, and its course view, show how many of its
  objectives are due for review, derived from the evidence with 5.19's
  rule; nothing is stored. Today review is met only on the card when a
  unit is opened in a new sitting, so a course left for weeks does not
  show that it needs review. DeepTutor shows due counts across topics
  (`web/components/space/learning/TopicAtlas.tsx` in that project). To
  settle in the task: whether slipping objectives count as due, and what
  a course with none shows.
- Done when: tests on hand-made evidence logs give the counts; on
  `pnpm dev:fake` the library and the course view show them for a
  seeded course with objectives due.

### 5.25 Review when due, between segments, or on request

- Status: todo
- Depends on: 5.19, which says when an objective is due, and 5.24, which
  places the due count
- The user's decision (2026-11-19, from the stage 5 check; the agent's
  recommendation): in the check, the review card came when the unit was
  reopened three hours after segment 1's teaching, and sat between that
  teaching and its check. Today the card is offered whenever a unit not
  finished is opened after `SESSION_GAP_MS` (an hour) away
  (`decisions.md`, "Mastery loop", "Review"). Instead:
  - the card is offered only when an objective of the course is due by
    5.19's rule;
  - only between segments: a sitting that opens mid-segment holds the
    card until that segment closes, and it never stands between a
    segment's teaching and its check;
  - a "Review now" button beside 5.24's due count, in the course view,
    starts a review when something is due. Review runs in a unit's
    thread. In a finished course, use the thread of the unit that owns
    the first objective in review order. Allow the requested review
    there, without offering it automatically or restarting the unit's
    teaching or gate. When several units are in progress, which thread
    to use is the task's to settle.
  The user had first asked for review on request only; they took the
  card, rarer, because a mode one has to open tends not to be opened
  (their own finding of 2026-11-17).
- Done when: tests on hand-made evidence logs show no card when nothing is
  due, and a card held mid-segment offered once the segment closes. A
  review requested from a finished course uses the expected unit's thread,
  records an answer, and leaves the unit finished. On `pnpm dev:fake`,
  "Review now" starts a review from the course view, including for a
  finished course with objectives due. `architecture.md` section 4 and
  `decisions.md`, "Review", change with it.

### 5.26 Moving on from the discussion

- Status: todo
- Depends on: nothing
- The user's decision (2026-11-19, from the stage 5 check): the
  discussion offers "Move on without the check" beside "I'm ready for the
  check", with the same confirmation. Today the page offers it only once
  the check has started (`NextStepControl` in `src/web/Session.tsx`), so a
  skip costs a tutor turn writing a question that is then withdrawn, as
  in segments 3 and 4 of the check's transcript. The server already
  allows it; `decisions.md`, "Moving on is allowed from the discussion on
  the server", says the page does not, and changes with it.
- Done when: on `pnpm dev:fake`, moving on from the discussion records the
  override and offers the next segment, with no question posted.

### 5.27 The closing card says the gate comes next

- Status: todo
- Depends on: nothing
- The user's decision (2026-11-19, from the stage 5 check): before the
  gate, the closing card's "Move on without them" read as skipping the
  unit gate. It does not skip it: the gate follows when `pickForGate` has
  anything to ask, and has its own "Skip the gate". When a gate follows,
  the step reads "Go on to the unit gate", and its confirmation says that
  the objectives not passed stay overridden and that the gate comes next;
  "Go over the four again" stays beside it. Without a gate to follow, the
  text stays as it is. The page needs to know before the step whether a
  gate follows; how is the task's to settle.
- Done when: tests show the card's step and confirmation with a gate to
  follow and without; on `pnpm dev:fake`, a unit with skipped segments
  shows them.

### 5.28 Math only for math, and no echo of the app's markers

- Status: todo
- Depends on: nothing
- From the agent's reading of the check's transcript, accepted by the
  user (2026-11-19). Two rules in `prompts/tutor.md`:
  - a math question only for a mathematical result. Gate question 6 asked
    for two `tool_use_id` values as one: the math box set them as LaTeX
    ("toolu" with "A7" as a subscript), the learner's prose answer lost
    its spaces, and the miss, on format with the reasoning right, made a
    retained objective slipping. A value read off a text (an id, a name,
    a field) is a choice question;
  - do not restate what the app's markers say. After each skipped check
    the tutor repeated the override marker ("Moving on without the check
    is fine; that one is recorded…"), three times in one unit.
- Done when: a short real-model run (Haiku) on an objective about reading
  ids off an API response posts a choice question, and the teaching turn
  after a skipped check does not mention the override.

### 5.29 A shorter tutor prompt

- Status: todo
- Depends on: 5.14, 5.16, 5.23 and 5.28, which add rules to
  `prompts/tutor.md`
- The user's decision (2026-11-19): `prompts/tutor.md` (596 lines, about
  6,000 words) goes to the tutor in every session, before the course and
  the unit; cut it hard, as a task of its own. Its rules grew one finding
  at a time (`decisions.md`, "Prompts"), so the same point is often made
  in several sections, with its reason and examples each time.
  - List every rule first, and give each a fate: kept, merged with
    another, left to the engine (a refusal the tool returns already says
    it, with a reason the tutor can act on), or dropped, with why. A rule
    written after a failure seen in a real run (`decisions.md`,
    "Prompts") stays in some form unless the engine now prevents that
    failure.
  - Say each rule once, where it applies; keep a reason only where the
    model needs it to apply the rule well; one example at most.
  - Read the turn headers (`engine/unit-turns.ts`) and tool descriptions
    (`src/server/tools/`) beside it: what they already tell the tutor
    need not be in the prompt.
  - Guide, not a hard limit: about half its length. `planner.md` (182
    lines) gets the same pass if the method works.
- Done when: the rule list with each fate is in the commit message;
  the tests pass (headers and refusals the prompt relies on unchanged);
  and real-model runs on Sonnet, since the result depends on how well
  the tutor teaches, on the same seeded units with the old prompt and
  the new show no rule lost: a segment through teaching, discussion and
  a check with a miss and its detour, a written and a code question, a
  review and a gate. Short runs; the user reads one pair of transcripts.
  `decisions.md`, "Prompts", keeps what the pass found.

## Stage 4: sources (built after stage 5)

### 4.0 Break down the stage

- Status: todo
- Depends on: stage 5
- The breakdown must settle (`decisions.md`, "Sources"):
  - the section size limit, by trying candidates on real files: a long
    stretch with no headings (the _Phenomenology_'s Preface, if the user's
    edition has none), an arXiv paper and an EPUB;
  - the `outline.json` schema in `src/shared/`;
  - how the unit's planning session is given the unit's whole text;
  - fixture tests for the cut: the same ids on a second run, cuts only at
    paragraph boundaries, and a quote across a cut that still verifies;
  - quotes: until this stage a course quotes nothing verbatim from memory
    (`tutor.md`, "Quotations"); with a source, `quote_source` verifies
    them, and the rule changes;
  - quote matching also ignores what extraction adds: margin line
    numbers on lines of their own, and a word split by a hyphen at a
    line's end (from the DeepTutor comparison;
    `deeptutor/reading/_grounding.py` in that project);
  - a link that opens a section without claiming a quote, for what the
    tutor paraphrases (a lecture on Hegel paraphrases more than it
    quotes), beside verified quotes: how the tutor makes one and how the
    page shows it (the user's pick from the DeepTutor comparison);
  - reads are not confined: sandboxed commands, the tutor's and the
    engine's, can read most of the machine. `blockReadsOutsideWorkingDirectories`
    hides the home folder, where mise keeps `python` and `uv`, and let a
    command read beside the workspace (`decisions.md`, "Confinement");
    the sandbox's own read rules are untried. Settle it before the tutor
    gets web access;
  - an artifact can send data out through WebRTC, which its policy cannot
    block in Chromium (`decisions.md`, "Confinement"); with unconfined
    reads that is a channel out for a tutor misled by a source or a web
    page. Settle it with reads; DNS prefetch from an artifact is untried;
  - the account's email address reaches every Claude session
    (`decisions.md`, "Claude backend"): with web access, a request could
    carry it, as it could anything else in the context;
  - source page images stay out of the backup (`record/backup.ts`);
  - the grader's and the help judge's hand-made sets are math only, and
    need explanation answers from a source course;
  - stage 5 in a source course: the turn that asks a review or gate
    question on another unit's objective names that unit's sections, and
    a unit's notes cite the source.

**User check:** a lecture on one chapter of the _Phenomenology_ with verified
quotes, and one unit taught from a paper.

## Stage 6: later

Codex backend (`decisions.md`, "Codex"), self-test, cheat sheets, photo
input; starred messages for the notes, if the generated notes miss what the
learner wants kept; a model chosen in the app's settings, which the user
wants eventually (2026-11-19); teaching instructions the learner can add
to or edit (below). Each is planned when chosen.

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
