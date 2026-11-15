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

## Toolchain (plan task 0.1)

Set up on 2026-11-13. Every command in `AGENTS.md` was run and passed.

- **Pinned runtimes** (`mise.toml`): Node 24.22.2, pnpm 12.18.0, Python
  3.14.10, uv 0.13.7. These were the versions already installed on the
  user's machine.
- **TypeScript 7.0.2, Vitest 5.1.0, Biome 2.6.7.** All three are recent major
  versions, so check their documentation before relying on remembered
  behaviour. `tsconfig.json` started from what `tsc --init` writes for
  version 7.
- **Type-checking only, no build step.** `tsc` never emits. Imports carry the
  `.ts` extension and `erasableSyntaxOnly` is on, so the same source can run
  under Node directly, under Vite and under Vitest. How the server is started
  is still task 0.5's decision; this only keeps the simplest option open.
- **`tsconfig.json` covers the server side only so far.** The page needs
  `jsx` and the DOM library added when task 0.5 creates it.
- **Biome is the one linter and formatter.** Version 2.6 also formats
  Markdown, which would rewrite every table in the documents, so Markdown and
  `docs/` are excluded.
- **`@types/node` was added** though `architecture.md` section 2 does not
  list it: TypeScript needs it to type-check Node's own modules. It is pinned
  to major 24 to match the runtime.
- **pnpm settings** (`pnpm-workspace.yaml`): a release must be a day old
  before it installs. No dependency needed a build script. If one does,
  pnpm 12 fails the install until it is named under `allowBuilds`.
- **`pytools/` uses mise's Python only** (`python-preference = "only-system"`),
  so uv never downloads a second interpreter.
- **One test on each side checks the runtime pin**: the suite fails if it
  runs on a Node or Python other than the one in `mise.toml`, which is what
  happens when a command is run outside mise.

## Claude on the plan login (plan task 0.2)

Observed on 2026-11-14 in four short runs of `spike/claude-login.ts`, with
Agent SDK 0.3.325. The SDK runs the Claude Code binary (2.1.325) that ships
in its platform package, `@anthropic-ai/claude-agent-sdk-linux-x64`, not the
`claude` command on the PATH. The spike passes a custom `systemPrompt`,
`settingSources: []` and `includePartialMessages: true`, then asks one probe
question. The runs started from the repository root with the Claude Code
session's own environment variables removed, so the SDK saw what it would see
when started from a plain terminal.

- **It works on the plan login with no API key.** The init message reports
  `apiKeySource: "none"` and the model `claude-opus-5-5`. A
  `rate_limit_event` message reports the plan's five-hour and seven-day usage
  windows. The result's `total_cost_usd` is a list-price figure, not a
  charge. Each successful run also made one small `claude-haiku-5-5` call of
  its own (about 1,300 input tokens).
- **The custom system prompt replaces Claude Code's.** The model repeated a
  passphrase that only the custom prompt contained.
- **Streaming works.** The reply arrives as `stream_event` messages carrying
  the Messages API stream events (`message_start`, then `content_block_delta`
  with `text_delta` pieces, through `message_stop`). The first text arrived
  after 2.5 to 4.3 seconds.
- **A set `ANTHROPIC_API_KEY` takes precedence over the plan login.** With an
  invalid key in the environment, init reported
  `apiKeySource: "ANTHROPIC_API_KEY"` and the request failed with 401
  ("Invalid API key · Fix external API key"). It did not fall back to the
  plan, and `query()` threw after yielding the error result. A valid key
  would therefore be billed as API usage. Leaving the variable out of the
  `env` option restored the plan login, though the key was still set in the
  server's own environment. **Decision:** the Claude backend gives the SDK an
  environment without `ANTHROPIC_API_KEY`. Not tried: `ANTHROPIC_AUTH_TOKEN`,
  `ANTHROPIC_BASE_URL` and the cloud-provider switches, which may redirect
  requests the same way.
- **`settingSources: []` keeps out almost everything personal, but not the
  auto-memory.** The model quoted, word for word, a line from this
  repository's auto-memory index (`~/.claude/projects/<folder>/memory/`). The
  rest stayed out: `~/.claude/CLAUDE.md` and the file it imports, the
  repository's `CLAUDE.md` and `AGENTS.md`, the skills in `~/.claude/skills`,
  the user's MCP servers and plugins, and the user settings' default
  permission mode (`bypassPermissions`; the session ran in `default`).
  Adding `settings: { autoMemoryEnabled: false }` kept the memory out too.
  (Task 0.3 found that the user's claude.ai connectors do join the session a
  few seconds in; see "Question round trip".)
- **Claude Code's bundled skills and built-in plugins load regardless.**
  Init listed 19 bundled skills (`claude-api`, `loop`, `schedule`,
  `code-review` and others) and built-in plugins such as
  `cc-plugin-telemetry`. With `skills: []` the model said it saw no skills,
  although init still lists them as discovered.
- **Decision:** the Claude backend passes `settingSources: []`, `skills: []`
  and `settings: { autoMemoryEnabled: false }`. This corrects
  `architecture.md` section 7, which said `settingSources: []` alone was
  enough.
- **The comparison run shows the probe would have caught a leak.** With
  `settingSources: ["user", "project", "local"]` the model quoted all three
  markers (from `coding.md`, `AGENTS.md` and the memory index), and init
  listed 65 skills, the user's three MCP servers, a synced plugin, and the
  permission mode `bypassPermissions`. Loading user settings would let the
  tutor run any tool without asking.
- **Built-in tools the session reports** when no `tools` option is given:
  `Task`, `Bash`, `CronCreate`, `CronDelete`, `CronList`, `DesignSync`,
  `Edit`, `EnterWorktree`, `ExitWorktree`, `ListAgents`, `Monitor`,
  `NotebookEdit`, `PushNotification`, `Read`, `RemoteTrigger`,
  `ReportFindings`, `ScheduleWakeup`, `SendMessage`, `Skill`, `TaskStop`,
  `ToolSearch`, `WebFetch`, `WebSearch`, `Workflow`, `Write`. There is no
  `Glob` or `Grep`. Five subagent types come with them (`claude`, `Explore`,
  `general-purpose`, `Plan`, `statusline-setup`). Most of these have no place
  in a tutor (scheduling, remote triggers, worktrees, messaging), so the
  backend should name its tools with the `tools` option, which tasks 0.3 and
  0.4 try. In the isolated runs, with the default tool set, the first request
  was 15,000 to 19,000 input tokens.
- **For later tasks.** `persistSession: false` kept the spike's sessions out
  of `~/.claude/projects/`. Resume (task 0.4) needs persistence on, and the
  SDK documents that sessions are then saved there. The SDK's
  settings type also has `blockWritesOutsideWorkingDirectories` and
  `blockReadsOutsideWorkingDirectories`, not tried, which are candidates for
  task 0.4. The runs removed every inherited variable whose name starts with
  `CLAUDE` (`CLAUDECODE`, `CLAUDE_CODE_SESSION_ID` and others); a server
  started from inside a Claude Code session would pass them on, with effects
  not tested.

## Question round trip (plan task 0.3)

Observed on 2026-11-14 with `spike/question-round-trip.ts`, Agent SDK
0.3.325, model `claude-opus-5-5`. The spike keeps one session open by passing
the prompt as a stream of user messages, defines `ask_question` in an
in-process tool server (`createSdkMcpServer`), and plays a scripted learner
who misses the first question and gets the second right. Each answer goes
back as the next user message, under a header like the one the engine will
compose. Four runs used the model, with two questions each. Tool deferral was
read from `getContextUsage({ detail: "summary" })`, which makes no model
request: a deferred tool is counted under `mcp_tools_deferred`, a loaded one
under `mcp_tools`.

- **The model does not reliably stop after posting a question.** With only
  the system prompt and the tool result telling it to end its turn, all four
  calls in two runs were followed by more output. Three times it was one more
  sentence ("The question is posted above..."), and in one of those a hint:
  "remember to subtract 1 from the exponent". Once it was a second
  `ask_question` call, a separate model request, that posted the same
  question again, followed by a note apologising for the duplicate.
- **A `PostToolUse` hook ends the turn reliably.** A hook on
  `mcp__gauss__ask_question` returning `{ continue: false, stopReason }`
  ended the turn at the tool result in all four calls of two runs
  (`terminal_reason: "hook_stopped"`, `stop_reason: "tool_use"`). The
  session stayed open, and the answer sent as the next user message
  continued it normally. The tutor can no longer write anything after
  posting. In one of the two follow-up turns it posted the next question
  without first giving feedback on the last answer, and the feedback came a
  turn later. The tutor prompt must say that posting a question ends the
  turn, so any lead-in and feedback come before the call.
- **Decision:** the engine ends the turn itself once a question is posted,
  instead of trusting the model to stop. The Claude backend does it with the
  hook, so the adapter needs a way for a teaching tool to end the turn (task
  0.5 confirms or revises the interface). `ask_question` also refuses a call
  while a question is open, which covers two calls in one response; no run
  triggered that refusal. The stop applies only to a question actually
  posted: a call the tool refuses must return its reason to the model so it
  can try again. Not tested: whether a refused call (an error result) fires
  `PostToolUse` as well.
- **`alwaysLoad` matters only when `ToolSearch` is among the session's
  tools.** Read without a model request:

  | Built-in tools in the session | `alwaysLoad` | `ask_question` |
  | --- | --- | --- |
  | none (`tools: []`) | off or on | loaded |
  | `Read`, `Bash` | off | loaded |
  | `Read`, `Bash`, `ToolSearch` | off | deferred |
  | `Read`, `Bash`, `ToolSearch` | on | loaded |
  | the default set (`tools` left out) | off | deferred |
  | the default set | on | loaded |

  In the model run whose tools included `ToolSearch` without `alwaysLoad`,
  the tutor called `ToolSearch` before `ask_question`, one model request
  more. **Decision:** name the built-in tools without `ToolSearch`, and set
  `alwaysLoad: true` on the teaching tool server anyway, so the teaching
  tools stay loaded if `ToolSearch` is ever added.
- **Correction to task 0.2: the user's claude.ai connectors join the
  session.** With `settingSources: []`, the user's claude.ai connector
  ("Claude Docs") appeared in `mcpServerStatus()` and connected within a few
  seconds. It added about 1,900 tokens of tool definitions and 631 tokens of
  server instructions to the tutor's context. Task 0.2 missed it: the init
  message listed no MCP servers, and each of its runs was one short reply. `strictMcpConfig: true` and
  `settings: { disableClaudeAiConnectors: true }` each kept it out.
  **Decision:** pass both. The first is documented to ignore every MCP
  configuration except the servers passed in; the second is the documented
  switch for claude.ai connectors.
- **Working option set** for a tutor session on Claude, as used in the
  enforced runs:

  ```ts
  query({
    prompt: inbox, // AsyncIterable<SDKUserMessage>: one message per engine turn
    options: {
      systemPrompt,
      settingSources: [],
      skills: [],
      settings: { autoMemoryEnabled: false, disableClaudeAiConnectors: true },
      strictMcpConfig: true,
      env, // process.env without ANTHROPIC_API_KEY
      tools: [], // built-in tools by name, never ToolSearch
      mcpServers: {
        gauss: createSdkMcpServer({ name: "gauss", tools, alwaysLoad: true }),
      },
      allowedTools: ["mcp__gauss__ask_question"],
      hooks: {
        PostToolUse: [{ matcher: "mcp__gauss__ask_question", hooks: [endTurn] }],
      },
      includePartialMessages: true,
    },
  });
  // endTurn returns { continue: false, stopReason: "Question posted; waiting for the learner." }
  ```

  The spike also passed `persistSession: false`; resume needs persistence
  (task 0.4). Which built-in tools the tutor gets, and how they are confined,
  is task 0.4's question.
- **Runs**, for repeating them: prompt only,
  `--always-load --strict-mcp --no-connectors` and
  `--builtin=Read,Bash,ToolSearch --strict-mcp --no-connectors`; enforced,
  `--always-load --strict-mcp --no-connectors --enforce-stop --one-open`,
  twice; probes, `--probe-only` with the tool options in the table.
