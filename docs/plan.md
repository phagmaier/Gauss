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

Still to observe from stage 2: an objective passed by two unsure correct
answers. The stage 3 check did not show one.

## Stage 5: mastery loop (built before stage 4)

The scope is `architecture.md` section 12's: review questions, the unit
gate, testing out of a unit, retained and slipping status, handoff notes,
the misconception record, the learner profile, unit notes, transcript
export, and style and curriculum changes. The choices behind this
breakdown are in `decisions.md`, "Mastery loop": the agent's, but for the
user's picks of 2026-11-18 ("Product decisions"), which the tasks below
follow. The stage's views are laid out in the mocks, pieces 15 to 18 of
`docs/prototype/` (`decisions.md`, "Page design"): a task that names a
piece builds what it shows. Not in this stage: sources and web access (4.0), self-test and
cheat sheets (stage 6).

**User check:** one course runs from intake to a closed second unit: a unit
tested out of or started, review questions at the start of a later sitting,
a detour, a unit gate, generated notes and an exported transcript.

Every task of the stage is done; the user's check is under way. The
user's notes from it, discussed on 2026-11-19, add tasks
5.14 to 5.18; the comparison with LearnHarness the same day adds 5.19,
5.20 and directions for 5.17's mocks, and the comparison with DeepTutor
adds 5.21 to 5.24, more directions for 5.17 and two items for 4.0
(`decisions.md`, "Product decisions"). They wait until the check is
over.

### 5.14 Vague written answers

- Status: todo
- Depends on: the user's stage 5 check
- The user's decision (2026-11-19): a written answer that is mostly right
  but vague stays a miss. No grade held back for follow-up questions: a
  question aimed at the vague part tells the learner what was missing,
  which is help, and pass or fail is what the passing rules read. Instead,
  two rules in `prompts/tutor.md`:
  - a written question names each part its rubric requires, not only how
    long to write: today a question can be failed for leaving out a part
    it never asked for;
  - in the detour, when the grader's flaw is something left unsaid rather
    than something false, say what was right and what was missing, and
    diagnose no misconception (the detour's step 2 now asks the tutor to
    name one, which the handoff writer may then record).
- Done when: a short real-model run (Haiku is enough) shows a written
  question naming its required parts, and a detour after an incomplete
  answer that says what was missing without naming a misconception.
  Record the user's decision in `decisions.md`, "Product decisions".

### 5.15 Working on written and code answers

- Status: todo
- Depends on: the user's stage 5 check
- The user's decision (2026-11-19): written and code answers get the
  optional field that choice and math answers have, so the learner's
  thinking stays apart from what is graded. A false start written into a
  written answer can now be graded as its first flaw. As with math, the
  grader and the tests never see it; the tutor (feedback and detour), the
  handoff writer, the dispute judge, "What I know" and the exported
  transcript do, as they do for a choice's reasoning. Its label says only
  the answer is graded, e.g. "Your thinking (optional, not graded: only
  the answer above is graded)". `WrittenAnswer`'s comment in
  `src/shared/question.ts` records the old choice (mock 2); replace it.
- Done when: on `pnpm dev:fake`, a written and a code answer sent with
  working show it on the graded card, in "What I know" and in the
  exported transcript; tests show the tutor's turn carries it and the
  grader's call does not. Record the user's decision in `decisions.md`,
  "Product decisions".

### 5.16 Large courses planned in stretches

- Status: todo
- Depends on: the user's stage 5 check
- The user's decision (2026-11-19, the course shape the agent's, which
  the user left to it): a large topic ("Calculus 1 to 3") is one course,
  planned in stretches, not split into courses. Review and the gate pick
  only within a course, and a later stretch must review the earlier ones;
  units planned far ahead are guesses made before anything is known of
  the learner. Calculus 1 alone (about 15 units) is one stretch.
  - `prompts/planner.md`: when the topic needs more than about 15 units,
    propose the first stretch, and say in the reply and the style note
    what comes after and that it is added as the course goes.
  - `prompts/tutor.md`: as the course nears the end of its planned units
    and the learner's stated scope goes further, offer the next stretch
    with `amend_curriculum`.
  - The curriculum diagram, its proposal card and the course view must
    still read at 30 units or more; check them with a seeded course of
    that size and fix what does not.
- Done when: a short real-model intake (Haiku) for "Calculus 1 to 3"
  proposes a first stretch and names what follows; a 30-unit course reads
  in the browser on `pnpm dev:fake`. Record the decision in
  `decisions.md`, "Product decisions".

### 5.17 Page redesign: break it down

- Status: todo
- Depends on: the user's stage 5 check. The comparisons with two other
  open-source tutoring projects, LearnHarness and DeepTutor, are done;
  their directions are below
- To be broken down with the user, starting from new mocks in
  `docs/prototype/`. What it must answer, from the user's notes of
  2026-11-19, with the directions the user chose from the two
  comparisons the same day:
  - the app looks amateur; it should look professional and sleek, all
    over. The mocks keep Catppuccin Frappé and try: a type register of
    its own for the app's labels (small capitals, a monospace or Plex
    Mono); a Computer Modern serif for titles, to match the math; the
    tutor's text and a question's prompt in a serif that matches KaTeX
    (Latin Modern or CMU Serif), so that inline math reads as part of the
    sentence, the controls staying sans (DeepTutor sets learning text in
    a serif, `web/app/layout.tsx` in that project); the
    accent on fewer things (headings and key terms in the text colour,
    mauve for the next step and "you are here"); the colours as a small
    set of named tokens, so that a light theme is cheap later. Once the
    mocks are accepted, `decisions.md`, "Page design", "Look", changes
    with them;
  - an objective's status shown by form as well as colour (filled when
    passed, ringed when current, outlined when started, faint when not;
    retained and slipping keep teal and peach and their words), in the
    outline, the course map and the course view, so that it also reads
    in a light theme (DeepTutor's `StudyOutline.tsx`);
  - a graded card's verdict as one line under a hairline, the verdict
    word coloured and the rest neutral, not a coloured panel;
  - the course view goes down to objectives: each unit a heading with
    its count ("2 of 5"), each objective a row with its status word and
    "Next" on the one to do, so that every row names its level
    (DeepTutor's path page, `assets/figs/web-dev/mastery-detail.png`);
  - the unit page's top line and its outline are confusing (segments and
    units are easily mixed up), and ugly;
  - where each segment starts, a heading in the thread: a rule, "Segment
    N of M", its title, and its objectives in small text; under it,
    lighter phase markers (a hairline with a small label) for teach,
    discuss and check;
  - a segment, current or past, picked in the outline jumps to its
    heading in the thread and highlights it briefly;
  - the course's whole path is reachable at any time from a unit: a
    "Course map" button in the unit's top line opens the curriculum
    diagram in the side pane, the current unit marked;
  - selecting text in the thread offers "Quote", which puts the passage
    into the message box as a quote; the learner then asks in the thread
    as usual. No side thread;
  - a visible way to ask for a curriculum change from the course view
    (today one is asked for in a unit's chat, and nothing says so).
    Segments stay fixed within a unit: the user agreed, 2026-11-19.
  - "Skip the gate" partway through asks with `SKIP_GATE_ASKS`
    (`src/web/session.ts`), which is written for the gate's card: it does
    not say that the answers so far count, that the open question is
    dropped, or that leaving instead lets the gate resume later. Give it
    a second text for partway through.
  - the library grouped by where each course stands (in progress,
    finished, drafts), so finished courses need no archive: the user
    chose deleting without archiving (5.18). Each row, and the course
    view, shows how many objectives are due for review (5.24).

### 5.18 Deleting a course

- Status: todo
- Depends on: the user's stage 5 check
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
- Depends on: the user's stage 5 check
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
- Depends on: the user's stage 5 check
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
- Depends on: the user's stage 5 check
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
- Depends on: the user's stage 5 check
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
- Depends on: 5.19, which gives each objective a due time, and 5.17's
  mocks, which place the count
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
wants eventually (2026-11-19). Each is planned when chosen.

For self-test, LearnHarness's practice prompt
(`src/agent/prompts/practice/10-doctrine.md` in that project) is input:
mix objectives rather than ask several problems on one in a row; a retry
after feedback is a fresh problem; before posing, fix the model solution
and look for a shortcut that skips the target; give the smallest hint
that unblocks, one per request.
