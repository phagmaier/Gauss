# Gauss: decisions and findings

Findings and choices made during the build, newest last. Each entry says what
was decided, on what evidence, and where to look.

## Page design (plan task 1.0)

Chosen by the user from the prototypes in `docs/prototype/`, 2026-11-13.

- **Reading and chat use the Thread layout**: one centred column, the tutor's
  text unframed, the learner's messages set apart on the right, one message
  box fixed at the bottom. Rejected: Page (document with questions marked in
  the margin) and Split (lesson left, conversation right).
- **Look: Catppuccin Frappé, mauve accent, IBM Plex Sans, dark theme first.**
  Section headings take the accent, key terms take yellow, and the learner's
  messages get a faint accent wash ("tinted"). The tokens are in
  `docs/prototype/base.css`. Rejected: the Mocha and Macchiato flavours, the
  other accents, uncoloured text, and two earlier looks, Slate (blackboard
  green with a textbook serif, which the user found the ugliest) and Lamp
  (warm dark with a book serif).
- **A check question is a card in the thread.** The learner answers inside the
  card and the message box stays available. Once graded, the card shrinks to a
  record: the verdict, the learner's answer and confidence, the correct answer
  when they missed, and a link to dispute. The tutor's feedback follows as
  ordinary text. Reference: `docs/prototype/02-check-question.html`, which
  shows all four answer kinds. Rejected: the message box turning into the
  answer box, and a full-screen one-question view.
- **Confidence is five percentages** (under 50%, 50%, 75%, 90%, 100%), and
  **"I don't know" is on every question.** Both were the user's requests and
  changed `docs/brief.md`. "Confident" means 90% or 100%; "I don't know" is a
  miss but never a confident wrong answer. The user later offered to drop the
  percentages and left the choice to the agent, which kept them: they make
  the "confident" rule concrete and allow calibration feedback later.
- **Phases are marked in the thread.** A marker line appears where each phase
  begins ("Discuss: Ask anything. Nothing here is graded."), and the one
  next-step control sits at the point the conversation has reached: "I'm
  ready for the check" in discuss, "Move on without the check" (confirmed
  once, recorded as an override) in check, "Start the next segment" when the
  segment is closed. While the tutor is writing, the send button is a stop
  button. Nothing is fixed to the screen except the message box. Reference:
  `docs/prototype/03-phases.html`. Rejected: a strip across the top with the
  three phases and the control, and a line attached to the message box.
- **Session navigation is one line across the top.** The path (library,
  course, unit) is on the left; the position ("Segment 3 of 5", with one tick
  per segment) is on the right and opens the unit's outline: its segments and
  the unit gate. Leaving a session never asks for confirmation, because
  progress is saved after every answer. Reference:
  `docs/prototype/04-session-nav.html`. Rejected: a rail down the left that
  always shows the outline, and a corner button with a position line in the
  thread at each segment start.
- **Learner-facing copy says "segment"**, the brief's term, not "part" (the
  agent's change while settling piece 3; the user has not objected).
- **Artifacts and source passages open in a pane beside the thread**, which
  narrows to make room, as the brief already said. The thread keeps a small
  reference to the artifact that closes and reopens the pane, and each quote
  carries a citation that opens the passage with the quoted sentence
  highlighted. One thing shows at a time. Reference:
  `docs/prototype/05-side-pane.html`. Rejected: placing them in the thread
  itself, and a sheet over the thread.
- **The library is one plain list**, newest first, with finished courses
  grouped at the bottom. Each row gives the title (one-offs are marked),
  where the course stands, one tick per unit, and when it was last opened.
  A course whose curriculum awaits review says so in its row. "New course" is
  a button at the right of the top line, which every page outside a session
  shares with the session. Reference: `docs/prototype/06-library.html`.
  Rejected: leading with the place the learner stopped, and leading with a
  "What do you want to learn?" message box.
- **The course view is built around the unit list.** Each unit gives its
  goal, what it builds on and its status (passed, overridden, in progress),
  with a Notes link once it is finished. The curriculum diagram is one click
  away and opens in the side pane. Continue is at the right of the top line,
  and sources are listed below the units. Reference:
  `docs/prototype/07-course.html`. Rejected: building the page around the
  diagram, and showing the diagram and the list in one scroll. Left open:
  whether a unit whose prerequisites are unfinished can be started; the brief
  does not say, and the mock does not lock anything.
- **A course starts in the thread.** Intake is a conversation in the Thread
  layout. The proposed curriculum arrives as a card in it, built like the
  check question card: the units with their goals and what each builds on,
  "Show the diagram" (side pane) and Approve. Pushing back is replying; a
  revision arrives as a new card with what changed marked, and the earlier
  card shrinks to one line. Reference: `docs/prototype/08-intake.html`.
  Rejected: keeping the proposal in the side pane, and a separate page laid
  out like the course view.

Not designed in task 1.0, to be settled when their stage needs them: a light
theme, detours, the baseline questions, the unit gate and unit close, the
notes and source readers, review mode, settings, and narrow screens.
`docs/prototype/index.html` lists the eight mocks in the order a learner
meets them.
