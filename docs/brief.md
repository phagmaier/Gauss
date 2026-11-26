# Gauss: product brief

What the product should do, as the user has decided it: every point here
is the user's decision, and changes only when the user changes it. The
[plan](plan.md) tracks implementation and acceptance. "Gauss" is a working
name taken from the project directory.

## Purpose

A personal, local teaching harness for one learner. It teaches large topics
(a whole course) as well as one-off topics, requires demonstrated understanding
before moving on, and keeps a durable record of what the learner knows. It runs
on the learner's own Claude and ChatGPT subscriptions.

It is a general harness. No subject is hardcoded. Three subjects serve as
acceptance cases because together they exercise every grading and content path:

| Acceptance course | What it stresses |
| --- | --- |
| Math (calculus through introductory analysis and discrete math) | Symbolically checkable answers, typed math, model-graded proofs |
| Modern AI / LLMs | Papers as sources, coding exercises in a workspace, material newer than model training data |
| Hegel's *Phenomenology of Spirit*, chapter by chapter | A long source text, lecture-style teaching, answers with no single correct form |

## Terms

- **Course**: a topic the learner is studying, with its own curriculum, record,
  sources, notes and workspace. A one-off topic is a course with one unit.
- **Unit**: a part of a course with one stated goal and a handful of
  objectives. It is sized by content, not by the length of a sitting.
- **Objective**: one specific, testable skill or understanding, such as "apply
  the chain rule to a composite function". Objectives are what mastery is
  tracked on. A unit groups several.
- **Segment**: a stretch of a unit covering one or two objectives, taught in
  one teach / discuss / check cycle.
- **Session**: one sitting in one chat. Sessions are disposable; everything
  durable is written to the course record.
- **Evidence**: a recorded result for an objective: the question, the answer,
  the learner's confidence, whether help was used, the grade, and the date.
- **Assessment**: any run of questions over a chosen set of objectives that
  records evidence without teaching.
- **Detour**: the pause after a miss in a check, in which the tutor traces the
  learner's reasoning to find the misunderstanding and works through it; the
  check goes on when the learner asks for another question.
- **Source**: a document the learner supplies (PDF, EPUB, TXT, Markdown) that a
  course teaches from.
- **Course record**: the files holding the curriculum, objective status,
  evidence, misconceptions found, and handoff notes.
- **Handoff note**: a short summary of how a unit has gone, rewritten each
  time a segment closes, so a new session can start cold.
- **Background note**: what the learner told the planner at intake about what
  they already know and what they want, kept with the course and given to the
  tutor.
- **Workspace**: a folder per course where the tutor writes starter code and
  the learner edits it in their own editor.

## How a course runs

1. **Intake.** The learner states what they want to learn, their background,
   and attaches any sources. The planner asks what it needs to know (their
   background, what they already understand, how far to go), says what it
   means to propose, and proposes only after the learner has replied. What
   it learns is kept as the course's background note.
2. **Curriculum.** The tutor proposes units, the prerequisite relationships
   between them, and one goal per unit. This is shown as a diagram. The learner
   reviews, pushes back, and approves. For a source-based course the source's
   table of contents is the skeleton. A large topic ("Calculus 1 to 3") is
   one course planned in stretches: the planner proposes the first stretch
   (about 15 units at most), titles the course for the whole topic and
   names the stretches after it, and the tutor offers the next stretch near
   the end of the current one. Not the whole topic up front, and not one
   course per stretch.
3. **Unit sessions.** Detailed objectives and segments for a unit are planned
   when the unit starts, using the record as it stands then; they stay fixed
   within the unit. Any unit can be started at any time. Before a unit
   is taught, the learner can choose to test out of it by taking its gate;
   they are shown what they passed and confirm before any of it is
   skipped. When objectives are due for review, a few review questions on
   them are offered between segments, which the learner starts or skips;
   the learner can also start a review from the course.
4. **Unit close.** The unit is marked passed or overridden, a handoff note
   is written, and the learner is offered notes on the unit.

The tutor can propose curriculum changes mid-course (for example a remedial
unit); the learner approves them. The learner can also ask for one from the
course, in a conversation with the planner, which is how a finished course
goes on to its next stretch.

## Session rhythm

Each segment has three phases, enforced by the harness and not left to the
model's discretion:

1. **Teach.** The tutor explains, with a cap on length. For source-based
   courses this is a lecture on the relevant section; reading the text is
   optional for the learner.
2. **Discuss.** The learner asks anything, for as long as they like. Nothing
   is graded. When the segment has an idea to grasp, the tutor first asks
   one question on the learner's intuition of it (why it holds, what
   happens if) and corrects or refines the picture they give, before any
   exercise. It skips this for rules and conventions, and the course's
   style note can turn it off.
3. **Check.** One or more questions. The learner commits an answer and a
   confidence level before seeing any feedback, and can add their reasoning.
   The learner can always answer "I don't know" instead. A correct answer
   leads straight to the next question; a miss starts a detour, and the
   check goes on when the learner says they are ready.

The learner moves from discuss to check with a "ready" control; the tutor may
suggest it. A segment closes only when every one of its objectives has
passed, or when the learner moves on, which is recorded as an override.
Moving on is offered in the discussion, beside "ready", as well as in the
check.

Progress is saved after every segment and every answer, so a session can
stop anywhere and resume at the same segment and phase. A unit reopened
after a restart resumes its tutor's conversation, a finished unit's too
(the user's choice, 2026-11-25); one that cannot be resumed gives way to a
new conversation, which takes over from the learner's progress, and the
thread says so. What the tutor is yet to be told of the record, such as a
dispute's outcome, an assessment's end, the learner's answer to the test's
result card or how a package install ended, it is told in its next turn,
after a restart or a Stop too (the user's choice, 2026-11-25).

## Teaching style

- A global default style, kept in `prompts/tutor.md`. On the Settings page
  the learner can rewrite or add to its first paragraph, app-wide: the
  tone, examples first, terms defined, steps shown. The rest of the tutor's
  instructions stay fixed: the tools, the assessment and help rules, the
  question formats, and the paragraph saying that a course's style note
  adjusts the default style and never lifts the 600-word limit. Gauss's own
  text is kept. "Restore Gauss's text" puts it back in the box, and saving
  text identical to it keeps no edit, so later changes to Gauss's text
  reach the learner. A saved change reaches Claude and Codex tutors alike,
  from the learner's next message in each open unit (the user's choices,
  2026-11-24).
- A per-course style note in plain text: how long explanations run, the mix of
  question kinds (many small exercises for code, written reconstruction for
  philosophy), and pace. The tutor proposes it at intake and the learner
  approves it with the curriculum.
- The learner can change it at any time by saying so ("shorter explanations",
  "more exercises"). The tutor can suggest a change based on results but must
  ask; style never changes silently, and nothing is written to the style
  note or the profile unseen.
- Separately, the number of check questions adapts automatically: more after
  a miss, fewer after a confident correct answer, with no limit until the
  objective passes or the learner moves on. Every objective of a segment
  gets at least one question in each check, even one passed before.

## Mastery and evidence

- **Passed**: since the objective's last miss, two unassisted correct answers
  in a row, to different questions, at any confidence; or one unassisted
  correct answer given confidently, if the objective was never missed.
  "In a row" means no miss between: an answer given with help neither
  counts nor breaks the row. Passing lets the learner move on. The default
  is strict: an objective not passed holds its segment open until it passes
  or the learner overrides. Passing is short-term evidence, given minutes
  after the teaching.
- **Retained**: confirmed by a correct answer after time has passed. Evidence
  for this comes from three places: the unit gate, review and self-test
  (below).
- **Slipping**: an objective that had passed and was then missed, in
  review, a gate or a self-test, until it passes again. A finished unit
  stays finished when one of its objectives slips.
- **Unit gate**: the check that closes a unit. It covers the unit's own
  objectives plus a few objectives from earlier units, which are cold by then.
  A missed earlier objective gets a short refresher and a re-ask. The learner
  can bypass the gate. It is offered on a card, never started by itself, and
  the closing card says when moving on leads to it.
- **Override**: the learner can always move on. It is recorded as an override,
  not as mastery, and covers only the objectives not yet passed. An
  overridden objective that was slipping reads "overridden", and review
  leaves it out.
- **Confidence**: five levels given as percentages (under 50%, 50%, 75%, 90%,
  100%), not words, one keystroke. A confident wrong answer is treated as a
  likely misconception. "Confident" means 90% or 100%.
- **Detour after a miss**: every miss in a check starts one. The tutor gives
  the right answer, finds where the confusion is (from the choice picked, the
  grader's flaw, the learner's reasoning, or by asking), and works through it
  with the learner; from the objective's second miss in the current check,
  and at every later one, it teaches the objective again another way.
  Nothing said in a detour is graded or counts as help. The learner asks
  for the next question when they are ready.
- **"I don't know"**: always available on a question in place of an answer. No
  confidence is asked; the learner can add a line saying where they got stuck.
  It starts a detour like any miss, and is recorded as a miss on the
  objective and never as a confident wrong answer.
- **Reasoning**: every answer except "I don't know" can carry the learner's
  reasoning. It is never graded: the grader and the tests see only the
  answer, so a false start in it never makes an answer wrong. The tutor,
  the handoff writer, the dispute judge, "What I know" and the exported
  transcript see it.
- **Written answers**: one that is mostly right but vague is a miss, and
  so is one that gives a source's words without explaining them; no
  grade is held back for follow-up questions. A written question asks for
  one result or piece of reasoning and states its scope. The rubric
  describes what makes that answer complete; it does not require
  separate work the question did not ask for. When an answer leaves a
  necessary part out, the detour says what was right and what was missing
  and names no misconception.
- **Code answers**: a run whose tests fail is a miss; it starts a detour,
  and the check goes on with a different exercise. A run that times out
  twice on the same files is a miss; the first time-out fails only the
  grading.
- **Math questions** are used only for mathematical results; an answer in
  words goes in a written question.
- **Misconceptions** are recorded only with a quote of the learner's own
  words that showed them, checked against the thread.
- **Help**: a message to the tutor while a question is open. A reply that only
  clarifies what the question asks (its wording, its notation, the form of
  answer wanted) is not help; one that points toward the answer is. A
  separate judging call decides, and the page shows its call. A correct
  answer given with help counts toward nothing; a wrong one is a miss.
  Help is marked when the tutor receives the message, not when it was
  sent, and never by the tutor declaring it. When unsure, the judge says
  help. A help call cannot be disputed, and a clarification never undoes an
  earlier help.
- **Disputes**: the learner can contest any grade once, giving a reason. A
  separate judging call decides, seeing what the answer was graded by and
  nothing of the conversation; the outcome is recorded with the answer.
  Not decided on the learner's word (passing would mean what they say), nor
  by the tutor (it wrote the key). While disputing, the learner sees what
  the answer was graded by (the rubric, key, expected answer or tests);
  elsewhere a rubric stays hidden. After an "I don't know" on a choice or
  math question, the learner can report the answer shown as wrong, with a
  written reason; the same call decides, only the answer shown changes,
  and the miss stays.

Grading method depends on the question, not the subject:

| Answer type | Graded by |
| --- | --- |
| Code | Running tests on the learner's files in the workspace. Grading shows test output; the tests themselves are shown only when disputing the grade |
| Computational math | A symbolic math check |
| Proofs, explanations, philosophical reconstruction | A separate grading call with a rubric, which must point to the first flawed step or missing element |
| Multiple choice | Exact match, plus the learner's stated reasoning if given |

Formal proof checking (Lean or similar) is out of scope.

## Assessment modes

One mechanism, different selections of objectives: segment check, unit gate,
testing out of a unit (its gate, taken before it is taught), review of
what is due, and on-demand self-test.

- **Review** picks objectives passed in earlier sittings: slipping ones
  first, then the ones most overdue. An objective is due again 1, 3, 7, 21,
  then 60 days after its last unassisted correct answer, the step growing
  with each correct answer it gets in a review, a gate or a self-test; a
  slipping one is due at once. It asks fresh questions each time, at most
  three, never on an objective answered within the hour. When something
  is due, a sitting offers it on a card between segments, never between a
  segment's teaching and its check, at most once an hour in a course; the
  course view starts it on request at any time; nobody is made to review.
- **A miss in review or the gate** starts a detour, then one more question
  on the objective.
- **Testing out** is the learner's choice, confirmed before it starts. It
  gives no feedback between questions, and a miss in it does not count
  against the objective afterwards; an answer in it is never evidence of
  retention, and the gate leaves out the objectives it passed. Nothing is
  skipped until the learner has seen what they passed and agreed. When it
  ends, the tutor says what it showed, and its result card follows; if
  that turn never reaches the tutor, fails, or is cut off by a restart,
  the card shows anyway, and the tutor's next turn says it first (the
  user's choice, 2026-11-25). A unit finished by skipping what the test
  passed, every objective, tells its tutor from then on that it was not
  taught: the learner chose to skip the teaching (the user's choice,
  2026-11-25).
- **Self-test** is the learner's to start, from the course view, at any
  time. They pick the scope (a segment, a unit, the whole course, or a
  random mix of what they have passed), the kinds of question (choice,
  math, written, code: at least one) and how many objectives (5, 10 or
  20). A segment, unit or course holds its objectives that have an answer
  or an override, never one not yet reached; a random mix only those
  passed, retained or slipping. Objectives answered within the hour are
  left out, and the setup says how many. When the scope holds more than
  the count, the weakest come first (slipping, then not passed, then
  passed by the oldest correct answer); a mix picks at random. The picked
  objectives are asked in mixed order. A segment or unit scope runs in
  that unit's thread; the course or a mix runs where "Review now" would.
  Its answers count as review answers do. Each objective gets one
  question; a miss starts a short detour, and the fresh question on it
  comes after at least one other objective, when one is left. The tutor
  asks only the kinds picked, and passes over an objective none of them
  fits, saying why; that records nothing. A message while a question is
  open is judged for help as anywhere, and the tutor gives the smallest
  hint that unblocks, one per request. The learner can end it at any
  time; what was answered stays recorded (the user's choices,
  2026-11-25).

## Sources

- Accepted: PDF, EPUB, TXT, Markdown, attached in the intake when a course
  starts, or later in the course's planning conversation ("Change the
  curriculum", "Plan what comes next"). A source attached there waits
  until a change is applied, then joins the course with every other
  source attached in that conversation, whether or not a unit reads it; a
  conversation that applies nothing adds nothing. Until then the learner
  can remove it, except while the proposal waiting reads it. A source in a
  course stays, and open units' tutors get a new one from the learner's
  next message. A Codex tutor whose conversation began in a course with no
  source is told of it then, but reads it only in a new conversation
  ("Start fresh", another unit, or the unit reopened after a restart),
  since a Codex conversation keeps the tools it began with (the user's
  choices, 2026-11-24). A unit reopened after a restart does not resume a
  Codex conversation whose tools differ from a new one's, as when it lacks
  a source's or one Gauss gained since: a new conversation takes over from
  the learner's progress, and the thread says why (the user's choice,
  2026-11-25).
- Converted once into per-section text files with an outline. Units point at
  sections. A segment can narrow its reading to specific pages or paragraphs;
  the tutor starts there and can read surrounding text as needed. In
  discussion or a detour, it can find an unfamiliar passage by searching
  the attached text for a phrase or keywords. Search returns short
  previews for the tutor to follow up, not quotes for the learner.
  No embedding search.
- For pages where text extraction loses content (equations, figures) the tutor
  reads the page image.
- Every passage the tutor quotes, in a lecture or in discussion, is
  verified to appear verbatim in the source, and its citation opens the
  passage. A source lecture puts its quotes beside their explanations,
  in the text's order. Matching ignores what extraction adds: margin line
  numbers and a word split by a hyphen at a line's end. Outside an open
  question, the tutor links a passage it paraphrases in its own sentence;
  a link claims no quote.
- A source question gives the context needed to answer. It may name a
  work or chapter but does not give a location or wording that points
  to where the answer can be read. The learner can reread on their own;
  the tutor does not locate the passage for them while the question is open.
- Unit notes stand alone, so they cite the source as text, never as a
  link, and quote it only in verified quotes' words, each with its
  citation. The exported transcript keeps quote blocks with their
  citations and gives a section link's words with its section and page.
- Scanned PDFs need text recognition first and will contain errors.
- Web search is allowed per course, used only when the tutor needs material it
  lacks, and cited when used. It is search only: the tutor reads the
  results' titles, links and summary and never opens a page, which could
  send what it holds to any address. A change of the setting applies from
  the learner's next message in each unit.
- In a course with no source, the tutor paraphrases and attributes, and does
  not quote verbatim unless it can check the quote.

## Other features

- **Artifacts**: the tutor can generate visual or interactive HTML aids, shown
  in a pane beside the chat. The tutor writes them itself. An aid's errors
  reach the tutor when the learner presses its button, and an aid can put a
  question into the message box, for the learner to send or not. An aid
  loads and fetches nothing, but its scripts can still reach the network
  through WebRTC and DNS lookups, so a tutor misled by a source or a search
  could send the session's context out; this is accepted, rather than aids
  without scripts.
- **Workspace**: the tutor scaffolds starter code, reads the learner's files
  and runs tests. The learner uses their own editor; the app has no code editor.
  Starter files hold everything a question gives, so the learner never
  retypes given values. Gauss installs the packages a course needs once the
  learner approves them: the tutor names them, Gauss builds the command,
  and it is the only command that reaches the network, PyPI alone.
- **Math input**: typed plain text or LaTeX with live preview.
- **Photos**: in a unit's chat, the learner can attach up to four images
  (JPEG, PNG or WebP) to a message, with or without text, whenever a
  message can be sent. That includes while a question is open, where the
  tutor's reply is judged for help as any reply is. Photos go in messages
  only, never in an answer (the user's choices, 2026-11-25). Gauss
  removes a photo's metadata, such as where it was taken, and stores it
  reduced in size with the course. The thread and the exported transcript
  show it. The tutor sees it with the message; a new conversation that
  takes over does not. The handoff and notes writers read only the text
  around it.
- **Transcripts**: every session can be exported as a document.
- **Notes**: HTML notes per finished unit, kept in a course notes folder,
  written when the learner asks for them; a finished unit offers them. They
  cover what the unit taught, give more room to what the learner struggled
  with, and keep what made an idea click. Each is a page designed for its
  unit, with figures where a picture explains, not text set in one fixed
  layout; it opens in the app and in a browser. It has no script, and its
  math is KaTeX's own HTML with styles and fonts embedded, as in the
  exported transcript (not MathML). The learner can add instructions of
  their own (what to focus on, how to lay it out). Cheat sheets on request.
- **Library**: a home view of all courses and one-offs, to stop and resume
  any, with how many objectives each has due for review (all those review
  could ask now, not only the three it would ask).
- **What I know**: per course, every objective with its status and the
  answers behind it (question, answer, confidence, help, grade, date).
- **Calibration**: how often the learner's answers at each confidence level
  were right, per course, as counts ("8 of 10"), on the course's "What I
  know". Only unassisted answers count, whatever passing rule was in force
  when they were given; "I don't know" is counted apart, and overrides are
  not answers.
- **Backup**: the data folder keeps a history of the record, so a wrong
  write can be undone.
  It does not include Claude Code's session transcripts outside the data folder.
- **Deleting**: a course or a draft is deleted from its course view, with no
  archive and no undo but the backup's history. A draft asks a plain
  confirmation; a course that has started asks for its title to be typed.
  Deletion is refused while a page shows one of the course's chats or
  anything of it runs.
  Gauss leaves Claude Code's sessions outside the data folder untouched,
  because it cannot establish that they belong exclusively to the course
  being deleted. Claude Code manages their retention.
- **Curriculum diagram**: generated from the stored curriculum and progress, so
  it cannot drift from the record.

## Memory

- Per course: the course record. Each session is rebuilt from it.
- Across courses: a short learner profile and a one-line index of finished
  courses. Nothing else is shared. The planner proposes the profile's text
  with a curriculum and the learner approves it; the learner can edit it at
  any time.

## Backends and stack

- Both subscriptions are used by driving the official harnesses (Claude Agent
  SDK, Codex) behind one adapter, signed in with the learner's own plans.
- Teaching tools (ask a question, show an artifact, propose a curriculum or
  style change, install packages) are provided once and shared by both
  backends.
- Each course runs on one backend, Claude or Codex, picked when its intake
  makes the course and fixed after. On Codex, only the course's tutor and
  its unit planner run there; the intake, course planning, the grader, the
  judges and the writers stay on Claude, whose evaluations chose them, so a
  Codex course needs both logins. A Codex course has no web search:
  Codex's search opens and reads pages, which a tutor never does here.
- A Codex course's unit planner runs on gpt-6.1-terra, and its tutor on
  the model chosen in Settings, gpt-6.1-terra by default; both run at
  medium effort, always on the standard service tier, never the faster
  priority tier (the user's choice, 2026-11-24, for cost). A Codex tutor
  writes and runs commands in its workspace through Gauss's own file and
  command tools, not Codex's, so that the engine can refuse each one with
  its reason and no command can be granted wider access (the user's
  choice, 2026-11-24).
- The tutor's model is chosen app-wide on the Settings page: one choice for
  Claude courses (Opus 5.5, the default, or Sonnet 5.5) and one for Codex
  courses (gpt-6.1-terra, the default, or gpt-6.2-sol). Effort and tier
  are not offered. The planners, the grader, the judges and the writers
  keep their own models. A change applies from the learner's next message
  in each open unit (the user's choices, 2026-11-24).
- If Codex is unavailable when the learner opens a unit of a Codex
  course, the unit does not open. Gauss shows why and how to sign in to
  Gauss's Codex home. After signing in, the learner can open the unit
  again without restarting Gauss.
- Local web app. TypeScript for server and interface, with small Python helper
  scripts (run through `uv`) for document conversion and symbolic math. The
  language choice was delegated to the agent by the learner.

Risk: Anthropic announced and then paused (June 2026) a move of Agent SDK usage
on plans to separate metered credits. Terms may change again; the adapter
keeps the backend replaceable. Codex runs on a ChatGPT plan login (seen in
the stage 0 spike), though its documentation does not address SDK use on one.

## Page

The page follows the selected mocks in
[`docs/prototype/index.html`](prototype/index.html); each mock's header says
what it tried and what was turned down. Beyond them:

- **Look**: Catppuccin Frappé, dark first, colours only through named roles
  so that a theme is one block. Reading text (titles, the tutor's text,
  questions) is CMU Serif with math at the same size; labels are IBM Plex
  Mono small capitals. Not designed yet: a light theme, narrow screens.
- **Status** shows by form as well as colour, with its word beside it where
  there is room.
- **Names**: segments and units are named by kind ("Segment 2 of 3",
  "Unit 4"); the extra segment after a unit's end is "Going over again",
  never "Review".
- **Scale**: every view reads at 30 units. The course view folds every unit
  not in progress to one line. A crowded diagram draws the lines between
  adjacent rows, and those skipping rows only for the unit picked; not a
  list in place of the graph, nor pan and zoom.
- **The thread**: a dividing line separates messages. The pinned question
  can be hidden. Each section the tutor reads and page it looks at gets a
  line. A section link has a dotted underline, a small § and a tooltip
  naming the section and page; a page image opens from its number in the
  margin, with "Back to the text" (not a Text / Page switch).
- **Questions**: the reasoning field reads "Your thinking (optional, not
  graded: only your answer is graded)" on the card and "Your thinking" on
  the record. A code question's card names its files by full path with
  "Copy path" and "Open" (the system's default app for the file), and "Run
  the tests" with a confidence level is the answer; the tests are never
  shown, and there is no second try at the same exercise. The help notice
  says asking what a question means is free, and a reply that helps makes
  the answer count as helped.
- **Cards**: the package card shows its command and output only on request
  or when the install failed. The card closing a unit's last segment says
  the gate comes next.
- **Course view**: a library row opens it, drafts too. It lists the
  sources, ending with a line that says a source is added in "Change the
  curriculum", and each unit's sections, with "Review now", "Self-test",
  which opens a panel in place to set one up (piece 27, direction A), and
  "Change the curriculum" ("Plan what comes next" once the course is
  finished). An attached source can be removed until the first proposal;
  a verified quote's citation carries a check.
- **Planning**: a source is attached as in the intake (piece 26, direction
  A). Its card says it joins when a change is applied, and the change card
  lists the sources it adds.
- **Photos**: attached in a unit's message box (piece 28, direction A,
  the user's choice, 2026-11-25), by the clip, a paste or a drop on the
  thread. Each waits as a small square inside the box, above the text,
  with a cross to remove it; a refused one says why under the squares
  and is not sent. In the thread a message's photos sit in its bubble,
  above its text, and one opens over the whole page with the message's
  other photos beside it.
- **Settings**: one app-wide page, opened by "Settings" beside "Profile"
  in the library's top line (piece 25, direction A). Picking a model
  saves it at once. The instructions box works as the Profile page's,
  with "Restore Gauss's text" added, and under an edit Gauss's text in a
  fold. The paragraph that cannot be changed is shown apart from the box,
  in `tutor.md`'s own words (the user's choice, 2026-11-24).

## Scope

First version: one course end to end on the Claude backend. Intake,
curriculum approval and diagram, unit sessions with the three-phase rhythm,
structured questions with confidence, evidence record, the "what I know" view
and calibration, unit gates, testing out of a unit, review of what is due,
detours, source ingestion with verified quotes, artifacts, workspace,
transcripts, unit notes, library view, backup.

Later: on-demand self-test on a scope the learner picks, cheat sheets;
starred messages for the notes, if the generated notes miss what the
learner wants kept. A desktop app only once everything else works, if at
all.

## Dropped

Course finals (unit gates and review cover the same ground), the optional
baseline quiz (replaced by testing out of a unit), and a review mode the
learner has to open (review is offered when something is due). Also left
out: a "not covered" control that withdraws an unfair question (the
detour after a miss teaches what was missing; revisit if unfair questions
appear); a full FSRS schedule (it needs a rating per answer); a prediction
before teaching; a separate model that builds aids; half credit or held-back
grades; several questions on one card; rewriting objectives within a unit;
counting "marked as known" as passed; the tutor voiding or re-keying its own
questions; placement questions before planning (testing out covers it);
intake questions on option cards; questions on a source's figures for now;
flashcards; self-rated practice; embedding search; a knowledge graph of
lessons; notes import; plugins; API keys and a cost meter; dictation; side
threads; compaction.
