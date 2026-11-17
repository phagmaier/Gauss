# Gauss: product brief

Status: draft for correction, 2026-11-13. Planning only; nothing is built yet.
"Gauss" is a working name taken from the project directory.

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
- **Unit**: a part of a course with one stated goal, sized for one to three
  sittings.
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
- **Detour**: a temporary side-track that traces the learner's reasoning to find
  a misunderstanding, fixes it, then returns to the interrupted segment.
- **Source**: a document the learner supplies (PDF, EPUB, TXT, Markdown) that a
  course teaches from.
- **Course record**: the files holding the curriculum, objective status,
  evidence, misconceptions found, and handoff notes.
- **Handoff note**: a short summary written at the end of a session so the next
  session can start cold.
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
   table of contents is the skeleton.
3. **Unit sessions.** Detailed objectives and segments for a unit are planned
   when the unit starts, using the record as it stands then. Before a unit
   is taught, the learner can test out of it by taking its gate, and skip
   what they pass. Each sitting opens with a few review questions on
   objectives passed in earlier sittings, which the learner can skip.
4. **Unit close.** The unit is marked passed or overridden, HTML notes are
   generated, and a handoff note is written.

The tutor can propose curriculum changes mid-course (for example a remedial
unit); the learner approves them.

## Session rhythm

Each segment has three phases, enforced by the harness and not left to the
model's discretion:

1. **Teach.** The tutor explains, with a cap on length. For source-based
   courses this is a lecture on the relevant section; reading the text is
   optional for the learner.
2. **Discuss.** The learner asks anything, for as long as they like. Nothing
   is graded.
3. **Check.** One or more questions. The learner commits an answer and a
   confidence level before seeing any feedback, and can add their reasoning.
   The learner can always answer "I don't know" instead. A correct answer
   leads straight to the next question; a miss starts a detour, and the
   check goes on when the learner says they are ready.

The learner moves from discuss to check with a "ready" control; the tutor may
suggest it. A segment closes only when every one of its objectives has
passed, or when the learner moves on, which is recorded as an override.

Units are sized by content (a handful of objectives), not by time. Progress is
saved after every segment and every answer, so a session can stop anywhere and
resume at the same segment and phase.

## Teaching style

- A global default style, kept in an editable prompt file.
- A per-course style note in plain text: how long explanations run, the mix of
  question kinds (many small exercises for code, written reconstruction for
  philosophy), and pace. The tutor proposes it at intake and the learner
  approves it with the curriculum.
- The learner can change it at any time by saying so ("shorter explanations",
  "more exercises"). The tutor can suggest a change based on results but must
  ask; style never changes silently.
- Separately, the number and difficulty of check questions adapt automatically
  within limits: more after a miss, fewer after confident correct answers.

## Mastery and evidence

- **Passed**: since the objective's last miss, two unassisted correct answers
  in a row, to different questions, at any confidence; or one unassisted
  correct answer given confidently, if the objective was never missed.
  Passing lets the learner move on. The default is strict: an objective not
  passed holds its segment open until it passes or the learner overrides.
  Passing is short-term evidence, given minutes after the teaching.
- **Retained**: confirmed by a correct answer after time has passed. Evidence
  for this comes from two places: the unit gate and the review questions
  that open each sitting (below).
- **Unit gate**: the check that closes a unit. It covers the unit's own
  objectives plus a few objectives from earlier units, which are cold by then.
  A missed earlier objective gets a short refresher and a re-ask. The learner
  can bypass the gate.
- **Override**: the learner can always move on. It is recorded as an override,
  not as mastery.
- **Confidence**: five levels given as percentages (under 50%, 50%, 75%, 90%,
  100%), one keystroke. A confident wrong answer is treated as a likely
  misconception. "Confident" means 90% or 100%.
- **Detour after a miss**: every miss in a check starts one. The tutor gives
  the right answer, finds where the confusion is (from the choice picked, the
  grader's flaw, the learner's reasoning, or by asking), and works through it
  with the learner; after a second miss on the same objective it teaches the
  objective again another way. Nothing said in a detour is graded or counts
  as help. The learner asks for the next question when they are ready.
- **"I don't know"**: always available on a question in place of an answer. No
  confidence is asked; the learner can add a line saying where they got stuck.
  It starts a detour like any miss, and is recorded as a miss on the
  objective and never as a confident wrong answer.
- **Help**: a message to the tutor while a question is open. A reply that only
  clarifies what the question asks (its wording, its notation, the form of
  answer wanted) is not help; one that points toward the answer is. A
  separate judging call decides, and the page shows its call. An answer
  given with help counts toward nothing.
- **Disputes**: the learner can contest a grade; the dispute is recorded.

Grading method depends on the question, not the subject:

| Answer type | Graded by |
| --- | --- |
| Code | Running tests in the workspace |
| Computational math | A symbolic math check |
| Proofs, explanations, philosophical reconstruction | A separate grading call with a rubric, which must point to the first flawed step or missing element |
| Multiple choice | Exact match, plus the learner's stated reasoning if given |

Formal proof checking (Lean or similar) is out of scope.

## Assessment modes

One mechanism, different selections of objectives: segment check, unit gate,
testing out of a unit (its gate, taken before it is taught), review questions
at the start of each sitting, and on-demand self-test. Review picks objectives
passed in earlier sittings, those passed with the least confidence first, and
asks fresh questions each time. It is on by default, and the learner can skip
it in any sitting.

## Sources

- Accepted: PDF, EPUB, TXT, Markdown.
- Converted once into per-section text files with an outline. Units point at
  sections; the tutor reads those files directly. No embedding search.
- For pages where text extraction loses content (equations, figures) the tutor
  reads the page image.
- Any passage the tutor quotes is verified to appear verbatim in the source,
  and citations open the passage.
- Scanned PDFs need text recognition first and will contain errors.
- Web search is allowed per course, used only when the tutor needs material it
  lacks, and cited when used.
- In a course with no source, the tutor paraphrases and attributes, and does
  not quote verbatim unless it can check the quote.

## Other features

- **Artifacts**: the tutor can generate visual or interactive HTML aids, shown
  in a pane beside the chat.
- **Workspace**: the tutor scaffolds starter code, reads the learner's files
  and runs tests. The learner uses their own editor; the app has no code editor.
- **Math input**: typed plain text or LaTeX with live preview.
- **Transcripts**: every session can be exported as a document.
- **Notes**: HTML notes per completed unit, kept in a course notes folder;
  cheat sheets on request.
- **Library**: a home view of all courses and one-offs, to stop and resume any.
- **What I know**: per course, every objective with its status and the
  answers behind it (question, answer, confidence, help, grade, date).
- **Calibration**: how often the learner's answers at each confidence level
  were right, per course, as counts ("8 of 10"), on the course's "What I
  know".
- **Backup**: the data folder keeps a history of the record, so a wrong
  write can be undone.
- **Curriculum diagram**: generated from the stored curriculum and progress, so
  it cannot drift from the record.

## Memory

- Per course: the course record. Each session is rebuilt from it.
- Across courses: a short learner profile and a one-line index of finished
  courses. Nothing else is shared.

## Backends and stack

- Both subscriptions are used by driving the official harnesses (Claude Agent
  SDK, Codex) behind one adapter, signed in with the learner's own plans.
- Teaching tools (ask a question, record evidence, show an artifact, update
  progress) are provided once and shared by both backends.
- Local web app. TypeScript for server and interface, with small Python helper
  scripts (run through `uv`) for document conversion and symbolic math. The
  language choice was delegated to the agent by the learner.

Risk: Anthropic announced and then paused (June 2026) a move of Agent SDK usage
on plans to separate metered credits. Terms may change again; the adapter
keeps the backend replaceable. Codex's documentation does not explicitly
address SDK use on a ChatGPT plan login; verify before the technical spec.

## Scope

First version: one course end to end on the Claude backend. Intake,
curriculum approval and diagram, unit sessions with the three-phase rhythm,
structured questions with confidence, evidence record, the "what I know" view
and calibration, unit gates, testing out of a unit, review questions at the
start of each sitting, detours, source ingestion with verified quotes,
artifacts, workspace, transcripts, unit notes, library view, backup.

Later: Codex backend, on-demand self-test, cheat sheets, handwritten-work
photos.

## Decision status

Stated by the learner: local web app; courses, units and one-offs; optional
baseline; demonstration before moving on, with manual override; confidence and
reasoning on answers; reasoning-trace detours; artifacts; workspace access;
curriculum diagram with review; sources in the four formats; lecture-style
teaching of sources; no formal proof checking; web search only when needed;
transcripts; HTML notes; both subscriptions.

Proposed by the agent and accepted by the learner on 2026-11-13 without
item-by-item review ("the brief is fine", judgment delegated): objectives as
the unit of tracking; the three-phase segment rhythm; passed / retained tiers;
two-level curriculum planning; verified quotes; grade disputes; Claude backend
first; the first-version scope above.

Settled on 2026-11-13:

- Sitting length is not a design input. Resume works at any point instead.
- Retention is checked at the unit gate (blocking, with bypass) and in an
  opt-in review mode. The learner suggested both; folding earlier objectives
  into the gate was the agent's addition.
- Teaching style is a per-course text note, changed only with the learner's
  agreement. The learner was unsure and delegated this.

Settled on 2026-11-13 from the page prototype (`docs/decisions.md`):

- Confidence is five percentage levels, replacing the earlier three levels.
- "I don't know" is always available on a question, and counts as a miss but
  never as a confident wrong answer (the agent's proposal, accepted).
- "Confident" means 90% or 100%. The learner offered to drop the percentages
  and delegated the choice; the agent kept them because they make this rule
  concrete and allow calibration feedback later.

Settled on 2026-11-16 from the user's first try of stage 2's check
(`docs/decisions.md`, "Stage 2 user check"). The user decided: passing is
strict by default, with override always open; every miss starts a detour,
which the learner ends when ready; the check pauses after misses only;
"I don't know" takes an optional line on where the learner got stuck;
writing during an open question stays allowed, and clarification is not
help; the planner asks what it needs before proposing. The agent chose,
and the user can overturn: one confident answer as part of passing; no
limit on questions; teaching again after a second miss; a separate call
judging help; no proposal in the planner's first turn; the background note.

Settled on 2026-11-17 from a review of the stage 2 record, which the user
brought after the check passed (`docs/decisions.md`, "Stage 2 review"). The
user decided:

- Passing no longer needs a confident answer: two unassisted correct answers
  in a row to different questions pass, or one confident answer if the
  objective was never missed. This overturns the agent's choice of
  2026-11-16; after a miss, one confident answer is still not enough.
- Review questions open each sitting, on by default and skippable, in place
  of the opt-in review mode of 2026-11-13.
- Testing out of a unit replaces the optional baseline, which the learner
  had asked for: the intake now asks about background, and a probe quiz
  pays off only if it lets the learner skip something.
- Course finals are dropped: gates and review cover the same ground.
- A course with no source quotes nothing from the model's memory verbatim.
- The "what I know" view, calibration and a backup of the data folder join
  the first version. Starred messages for the notes wait until the
  generated notes have been used.

Open questions: none at the product level. Technical choices are in
`architecture.md`.
