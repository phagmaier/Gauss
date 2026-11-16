# Gauss: decisions and findings

Findings and choices made during the build, newest last. Each entry says what
was decided, on what evidence, and where to look.

**Do not read this file whole.** It is large. Find the entry you need in the
index, then read only that section: `grep -n '^## ' docs/decisions.md` gives
the line numbers, and a section runs to the next `## ` line. Where a section
says it was observed with a `spike/` script, the script is deleted; the
findings are the record.

| Section | Holds | Read when |
| --- | --- | --- |
| Page design | Layout and look picked from mocks 1 to 8 | Building or changing a view |
| Toolchain | Pinned versions, linter, test setup, TypeScript 7 and pnpm 12 quirks | Changing tooling or `tsconfig.json` |
| Claude on the plan login | Plan login vs API key, which user settings leak into a session, built-in tools | Touching the Claude backend or its `env` |
| Question round trip | Teaching tools, turn ending, the isolation option set | Adding or changing a teaching tool |
| Resume and confinement | Resume by id, sandbox and permission options, refusals | Resume (stage 2), working directory or built-in tools (stage 3) |
| Source sections | Splitting sources into size-limited sections | Stage 4 |
| Minimal page | Adapter shape, streaming, fake backend, browser run | Touching `src/server/backends/` or the event stream |
| Codex spike | What Codex can and cannot do on the ChatGPT login | Stage 6 |
| Stage 0 closed | Which stage-0 questions were answered | Rarely; `architecture.md` section 7 has the answers |
| Review fixes (0.8) | Stopping a turn, drafts during a pending send | Touching turn stop or the message box |
| Course and curriculum schemas | Schema choices and validation messages | Touching `src/shared/course.ts` or `curriculum.ts` |
| Record module | Data root, atomic writes, crash test | Touching `src/server/record/` |
| Intake and curriculum proposal | Intake chat, `propose_curriculum`, approval | Touching `engine/intake.ts` |
| Routes and event stream | The HTTP routes and their refusals | Adding or changing a route |
| Library and course views | `src/web/` structure and choices | Touching the page |
| Library review fixes | Intake ownership, diagram ports | Touching intakes or the diagram |
| Stage 2 breakdown | Why stage 2's tasks are shaped as they are | Any stage 2 task, before starting |
| Stage 2 designs | Picks from mocks 9 to 12, and which tasks use each | 2.6, 2.11, 2.12, and any stage 2 view |
| Plan, state and evidence records | Plan rules, `state.json` positions, evidence entries, the file lock, cut log lines | Touching a unit's plan, `state.json` or the evidence (2.3, 2.5 to 2.8, 2.13) |
| Objective status | The passing rule, help, "I don't know", overrides, unit status | Recording answers or help (2.7), showing status (2.11, 2.12), stage 5's retained and slipping |
| Markdown and math | The renderer, what happens to a model's HTML, links and images, math delimiters, the answer preview | Showing model or learner text on the page; writing a prompt's formatting rules (2.16) |
| Unit planning | The planning session, `plan_unit`, retries, what the session is given | Starting a unit (2.6), revising `unit-planner.md`, stage 4's sections for planning |
| Unit chat and phases | Opening a unit, phase rules, refusals, "this check", restart, headers, page events | Touching `engine/unit-chat.ts` or `unit-turns.ts`, the check's rules (2.7), the session view (2.11), resume (2.14), `tutor.md` (2.16) |
| Check rules and unit close | How many questions and the limit, help, the unit's end, going over again, moving on without them, finished units | Touching `engine/check-rules.ts` or the unit's end, the closing card (2.11), course progress (2.12), `tutor.md` (2.16) |
| Rubric grading | `oneShot` and structured output, the variables that redirect the SDK, written questions, what the grader sees and returns, a failed grading, help once an answer is sent | Touching `backends/` or `engine/grading.ts`, `grader.md` (2.9), the written card (2.11), disputes (stage 3) |
| Review fixes (2.8a) | One answer per question, moving on with a kept answer, Stop before a turn is sent, whole evidence lines, inherited property names, the fake's stopped one-shot | Recording answers or reopening a unit (2.8b, 2.13, 2.14), turn stop, `json-lines.ts` (2.13's transcripts), the fake backend |
| Unit chat split | What `unit-record.ts` and `unit-agents.ts` hold, the one queue, what the tests do not cover | Touching the unit chat, and before 2.13 (transcripts), 2.14 (resume) and 2.15 (idle sessions) |
| Grader prompt | The hand-graded set, the runs and their results, the grader's model and why, what `grader.md` says and why | Changing `grader.md`, the grader's model or `WrittenGrade`, writing rubric guidance in `tutor.md` (2.16), disputes (stage 3) |
| Style note at intake | The note in the proposal, `style.md` with the draft, courses without one, the card, `planner.md`'s section, approval checked against the card | Touching `propose_curriculum`, `planner.md` or the proposal card, writing `tutor.md`'s default style (2.16), style changes (stage 5) |
| Session view | The session page: its address, markers, next-step control, written card, keys, top line and outline, closing card, the entry points, a lost chat, the course's details failing to load, the browser run | Touching `src/web/Session.tsx`, `session.ts`, `timeline.ts` or `QuestionCard.tsx`; course progress (2.12), transcripts (2.13), "Start fresh" (2.14), prompts that write objective statements |
| Dev server on the fake backend | The scripted backend and what its tutor does, the seed, the scratch data root and port, `serve.ts`, closing the browser, the browser run | Running a browser check, touching `scripted.ts`, `dev-seed.ts`, `serve.ts` or the turn headers in `unit-turns.ts`, `intake.ts` and `unit-planning.ts`; a new one-shot request (stage 5 notes) |
| Course and library progress | What the routes send, when units were opened, the card, Start, "Open" on finished units, the library's lines and groups, the closing card's next unit, a course whose progress cannot be read | Touching the course view, the library, `progress.ts` or `unitsOpenedAt`; notes (stage 5), the gate and retained status in the library (stage 5) |
| Transcripts | What a session is, the transcript files, the thread rebuilt from them, the session marker, batching and joined text, no flushing and lines left out, the browser run | Touching `engine/transcript.ts`, the transcripts in `data-root.ts`, or the thread's sessions in `timeline.ts`; resume and "Start fresh" (2.14), idle sessions (2.15), reading transcripts (2.16), handoff notes and export (stage 5) |

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

## Resume and confinement (plan task 0.4)

Observed on 2026-11-14 with `spike/resume.ts` and `spike/confinement.ts`,
Agent SDK 0.3.325, model `claude-opus-5-5`, both using the isolation options
from tasks 0.2 and 0.3 (`spike/isolated-options.ts`).

### Resume

- **A session resumes by id in a new process.** One process started a
  session (`persistSession` left at its default, true), was told a code word,
  and exited. A second process passed `resume: <session id>` and got the code
  word back. The session id stayed the same; the SDK forks to a new id only
  with `forkSession: true`. The transcript is stored at
  `~/.claude/projects/<folder named after the working directory>/<id>.jsonl`.
- **A resumed session keeps the system prompt it started with.** The resume
  run passed a system prompt with a different passphrase, and the model
  still reported the first one. So a revised `prompts/tutor.md` reaches only
  new sessions. The SDK documents `systemPrompt: { type: "custom", prompt,
  snapshot: false }` for rebuilding the prompt on every request; not tried.
- **An unknown id fails at once, before any model request:** a result with
  `subtype: "error_during_execution"` and the error "No conversation found
  with session ID: …", after which `query()` throws. This is the signal for
  the automatic "start fresh" fallback in `architecture.md` section 4.
- **Resuming from another working directory still finds the session**, and
  the session's working directory becomes the new one. Since confinement
  follows the working directory, the backend must always resume with the
  course folder as `cwd`.
- From the Claude Code documentation, not observed: Claude Code deletes
  stored sessions after `cleanupPeriodDays` (30 days by default), so a unit
  left alone for longer falls back to "start fresh".

### Confinement

The confinement run asked the agent to write a module and its unittest test
inside the working directory and run the test, then to write outside the
directory, and into a protected file inside it, by every route below. The
script then checked the disk itself: nothing was written outside the
directory, and the protected file was unchanged. These are the exact
options of the final run, added to the isolation options:

```ts
{
  cwd: dir,
  tools: ["Read", "Write", "Edit", "Bash"],
  permissionMode: "dontAsk", // anything not allowed is refused, never prompted
  allowedTools: [`Edit(/${dir}/**)`, "Bash"], // "Edit(//abs/path/**)" covers Write too
  disallowedTools: [`Edit(/${protectedFile})`],
  sandbox: {
    enabled: true,
    failIfUnavailable: true, // stop rather than run unconfined
    autoAllowBashIfSandboxed: true,
    allowUnsandboxedCommands: false, // the dangerouslyDisableSandbox retry is ignored
    filesystem: { denyWrite: [protectedFile] },
  },
  settings: { permissions: { blockWritesOutsideWorkingDirectories: true } },
  env: { ...env, CLAUDE_CODE_TMPDIR: `${dir}/.tmp` },
}
```

| Attempt | Outcome |
| --- | --- |
| `Write` two files inside, run `python3 -m unittest -v` | Done; the test passed |
| `Write` to a file under the home directory | Refused by `blockWritesOutsideWorkingDirectories` |
| `echo probe > /tmp/…` | Refused by the sandbox: "read-only file system" |
| The same with `dangerouslyDisableSandbox: true` | Refused the same way; the parameter was ignored |
| `Write` to the protected file | Refused by the `Edit` deny rule |
| `echo '{}' >` the protected file | Refused by the sandbox's `denyWrite` |
| `python3 -c "open('<home path>', 'w')…"` | Refused by the sandbox: `OSError` 30, read-only file system |
| `echo probe >` Claude Code's per-user temp directory | Refused, with `CLAUDE_CODE_TMPDIR` set (see below) |

- **Two layers are needed.** The sandbox confines only shell commands and
  what they start, enforced by the operating system (bubblewrap, here
  0.13.1, with socat). The `Write` and `Edit` tools run outside it and are
  confined by `blockWritesOutsideWorkingDirectories` and the `Edit` rules.
- **The sandbox leaves one more place writable by default:** Claude Code's
  per-user temp directory (`/tmp/claude-1000` here), which every Claude Code
  session of the user shares. A sandboxed `echo probe >` into it succeeded
  in a run without the override. Setting `CLAUDE_CODE_TMPDIR` to a folder
  inside the working directory moves it there: `$TMPDIR` became
  `<dir>/.tmp/claude-1000`, Python's `tempfile` worked, and the same write was
  refused. The documentation says sandboxed commands fall back to a short
  temp path under `/tmp` when the override path is long. The path tried
  here, `/tmp/gauss-confine-final/.tmp`, was short enough; the limit is not
  documented, so the real course path needs checking.
- **`dontAsk` needs an allow rule for `Bash`.** Without one, sandbox
  auto-allow still let most commands run, but
  `echo "TMPDIR=$TMPDIR"; python3 -c "import tempfile; print(tempfile.mkstemp())"`
  was refused as a permission matter ("Permission to use Bash has been
  denied because Claude Code is running in don't ask mode"), with no reason
  given. With `"Bash"` allowed it ran, and it is still confined: with
  unsandboxed retries off and no `excludedCommands`, every command runs in
  the sandbox, which the `dangerouslyDisableSandbox` attempt confirmed.
- **The session leaves two folders in the working directory:** `.claude/`
  (holding an empty `.cc-writes` folder) and the `.tmp/` set above.
- **Not confined, not tested:** reads. Sandboxed commands can read most of
  the machine by default, credential files included, and the documentation
  says `dontAsk` refuses the `Read` tool outside the working directory. The
  sandbox's network is closed until domains are allowed (also documented,
  not tried). Both matter once the
  tutor gets web access (stage 4).
- **For the course layout:** the tutor may write only `workspace/`,
  `artifacts/` and `notes/` (`architecture.md` section 5). This run shows
  that a path inside the working directory can be closed to both layers (an
  `Edit` deny rule and a sandbox `denyWrite` entry). Whether to make the
  course folder the working directory and close the record files, or to
  work the other way round, is left for the task that first gives the tutor
  files to write.
- **Runs**, for repeating them: `resume.ts start`, then `resume` with the
  printed id, an unknown id, and another `--dir`; `confinement.ts` without
  flags (steps 1 to 10, before the temp steps were added), with
  `--temp-check` and with `--temp-check --temp-inside`, and the final run
  with `--allow-bash --temp-inside`.

## Source sections (review of a proposal, 2026-11-14)

The user brought a proposal, written with another model, to split sources
into a hierarchy of size-limited sections. The agent reviewed it and
proposed a smaller version, which the user accepted on 2026-11-14. The
result is in `architecture.md` section 8; the size limit is left to stage 4.

- **The gap was real.** Section 8 said "split by headings or the table of
  contents" and had no size limit, no nesting, and no rule for a long
  stretch with no headings. Most of the *Phenomenology* is subdivided, but
  some stretches are long and have no headings: from memory of the Miller
  translation, the Preface (about 45 pages) and "Force and the
  Understanding" (about 30). Check on the user's edition in stage 4.
- **The file-reading tool has a per-call limit.** The Claude Code binary
  bundled with Agent SDK 0.3.325 (2.1.325) caps one `Read` call at 25,000
  tokens by default; `CLAUDE_CODE_FILE_READ_MAX_OUTPUT_TOKENS` overrides it.
  A larger file is refused with a message offering to read it anyway, so a
  section must stay below the cap to be read in one call. Read from the
  binary's strings, not observed in a run.
- **Decided:** the outline nests to any depth; sections are its leaves and
  the only entries with files; text before a node's first subheading is a
  section of its own; a section has a size limit, and a stretch over it with
  no headings is cut at paragraph boundaries into roughly equal parts; the
  same file and converter give the same ids; each segment names the
  sections it draws on, and the engine puts them in the turn header; the
  tutor may read other sections when the discussion needs them;
  `quote_source` checks the source's whole text in order, so a quote across
  a cut still verifies.
- **Not adopted from the proposal:**
  - A change to `brief.md`. Its "sections" already fits the leaves of an
    outline, and "subsection" or "chunk" would be synonyms for it.
  - A field list for `outline.json` and `NN-MM.md` file names in
    `architecture.md`. Data shapes are zod schemas in `src/shared/`, and
    two-level names do not fit a source whose headings go four deep, as the
    *Phenomenology*'s do in its Reason chapter.
  - A required page range. EPUB, TXT and Markdown have no pages; a
    paragraph range stands in.
  - Ids that stay stable when the converter changes. Sources are converted
    once; a different converter means mapping the units again.
  - "Never read the whole chapter". Short chapters read better whole, and a
    discussion may need earlier text.
  - Agreed with the proposal: no overlap between sections, which would put
    the same quotable text in two places.
- **Corrections to the proposal's reasoning**, for later tasks that weigh
  context size:
  - What the tutor reads stays in the session, and a unit has one session.
    Smaller files lower the cost of a unit's early turns, not of its end.
    What bounds the context is the size of a unit.
  - Resume does not depend on how sources are cut: `state.json` records the
    segment and phase.
  - The 15,000 to 19,000 input tokens measured in task 0.2 were with the
    default tool set. The tutor's narrowed tools will take fewer.
  - 15,000 to 30,000 characters is about 6 to 12 dense pages, not 5.
- **Open:** the size limit, set by trial in stage 4; and where unit planning
  reads the whole unit's text (`architecture.md` section 8).

## Minimal page (plan task 0.5)

Built and run on 2026-11-15 with Agent SDK 0.3.325 on the plan login, Hono
4.13, React 19.3 and Vite 8.3. The browser run, through Playwright: start, a
reply streamed in, a question card appeared, a wrong answer (B at 75%) came
back graded with the correct answer shown, and the tutor's feedback streamed
in. Then a reload and five messages, two of which were stopped: seven
model turns in all.

- **One process, one port.** `pnpm dev` runs `src/server/main.ts` under Node,
  which runs the TypeScript directly with no build step. It serves the API
  with Hono and the page through Vite in middleware mode, on
  `127.0.0.1:4320` (`GAUSS_PORT` overrides the port). This settles how the
  server is started, left open in task 0.1. `main.ts` imports Vite, so a
  production start without it is a later task's.
- **The event stream replays a log.** The chat keeps a log of page events
  (`src/shared/events.ts`). `GET /api/events` sends a `hello` with the chat's
  id, replays the log, then sends events as they happen. Event ids are
  `<chat id>.<index>`: a reconnecting browser sends the last one and gets
  only what it missed, and a page that sees another chat id starts over,
  since the server restarted. A reload rebuilt the thread exactly. The log
  is in memory; stage 2 rebuilds the thread from the record instead.
- **Only Gauss's own page can use the API.** The server listens on
  `127.0.0.1` only, and the API refuses host names other than `localhost`
  (against DNS rebinding) and any POST whose `Origin` is not the page's own
  (against other sites posting to it). The server drives an agent on the
  learner's login, and from stage 3 a shell.
- **Choices are letters.** `ask_question` takes the choices as a list in
  display order and the answer as a letter. The page labels choices by
  position and the engine names the learner's choice by letter, so the page
  and the tutor always mean the same choice. The 0.3 spike's
  `{ id, text }` choices allowed ids that the page would show differently.
  A question whose answer is not among its choices is refused with the
  reason.
- **The adapter was revised**; `architecture.md` section 7 has the result.
  What changed: teaching tools are transport-free definitions passed to
  `startSession`; a tool result can end the turn, and a refused one never
  does; `send` handles one turn at a time and never throws; the outcomes of
  a turn are named; the session id is known before the first turn.
  Resume, the working directory, built-in tools and `oneShot` wait for
  task 1.3.
- **Ending the turn.** The tool's `endTurn` sets a flag in the Claude
  backend, and a `PostToolUse` hook on every tool stops the turn only when
  the flag is set; each new turn clears it. Whether a refused call fires
  `PostToolUse` (open in task 0.3) no longer matters. In the run the turn
  ended at the question, with no text after it.
- **The session id is chosen up front** with the SDK's `sessionId` option
  (a UUID), so the engine can store it before the first turn.
- **Stopping works.** Stopped before any text, and again mid-sentence: the
  text stayed where it was, the page showed "Stopped.", and the session
  answered the next message normally both times. After the mid-sentence
  stop, a one-sentence reply took between 10 and 30 seconds against a few
  seconds otherwise; not investigated. The backend reports "interrupted"
  from its own record of the request, because the fields of an interrupted
  turn's result were not recorded.
- **The SDK's environment** leaves out `ANTHROPIC_API_KEY` and every
  variable starting with `CLAUDE`, as the stage 0 runs did. This run was
  started from inside a Claude Code session and worked. A learner who sets
  `CLAUDE_CONFIG_DIR` would lose it; revisit if that happens.
- **Plain text for now.** The demo prompt (`prompts/demo-tutor.md`) asks for
  plain text with Unicode for mathematics, and the page shows text as it
  is. Markdown and math rendering are stage 2's.
- **The page follows the settled look**: the Thread layout, the question
  card with the five confidence levels and "I don't know", and the stop
  button while the tutor writes. The styles are copied from
  `docs/prototype/base.css` into `src/web/styles.css`, keeping what the page
  uses. Fonts load from Google Fonts as in the prototypes, falling back to
  the system sans offline.
- **Dependencies added**: `hono`, `react`, `react-dom`, `vite` and
  `@vitejs/plugin-react` (`architecture.md` section 2 lists Hono, React and
  Vite); `@hono/node-server`, which Hono needs to run on Node; and the
  `@types/react` and `@types/react-dom` type packages. `tsconfig.json` now
  includes the DOM library, JSX and Vite's client types, for one
  configuration over both sides.
- **Not tried, for later:** the SDK's type comments mention MCP tools that
  end the turn by themselves (`_meta['claude/endTurn']`, "end-turn tool
  sessions"). The hook works, so this was left alone; it is a candidate if
  the hook proves fragile.

## Codex spike (plan task 0.6)

Observed on 2026-11-15 with `spike/codex.ts`, `@openai/codex-sdk` 0.169.0
and the Codex CLI 0.169.0 that it bundles, signed in with ChatGPT
(`codex login status`). The model came from the learner's own Codex config
(`gpt-6.1-sol`), at low reasoning effort. Five runs, one or two turns each,
within the hour the plan allows.

- **It runs on the ChatGPT login.** No API key was set or passed; every
  run worked. The SDK has no `systemPrompt`, no in-process tools and no
  hooks. It runs `codex exec --experimental-json` once per turn, a new
  process each time, and continues a thread with `resume <id>`.
- **Text does not stream through the SDK.** Each of the tutor's messages
  arrived whole, as one `item.completed` event, with no `item.updated`
  pieces in any run. A turn may hold several messages (a short preamble,
  then the answer). The app server's protocol has `item/agentMessage/delta`
  notifications (read from the CLI binary, not tried), so a Codex backend
  that streams text would drive `codex app-server` instead of the SDK.
- **A custom tool server works over MCP.** The spike served the real
  `ask_question` teaching tool from a minimal MCP server over HTTP inside
  its own process, given to Codex as a `--config` override:
  `mcp_servers.gauss = { url, default_tools_approval_mode = "approve" }`.
  The input schema came from `z.toJSONSchema(z.object(tool.inputShape))`.
  Codex connected, listed the tool, and the model called it with valid
  input. Without the approval mode, `approval_policy = "never"` refused the
  call ("MCP tool call requires approval"); the accepted values are `auto`,
  `prompt`, `writes` and `approve`. Each turn reconnects to the server,
  since each turn is a new process.
- **A teaching tool can end the turn.** When `ask_question` returned
  `endTurn`, the spike aborted the turn (the SDK's per-turn `AbortSignal`,
  which kills the process) right after answering the call. The SDK then
  throws "The operation was aborted". The next turn resumed the thread,
  and the tutor quoted the posted question word for word. The session file
  shows the call but not its output, which the kill cut off; Codex resumed
  regardless.
- **The thread id arrives with the first turn**, in the `thread.started`
  event, before the model is called (0.1 seconds in). It is not known when
  `startThread()` returns, and there is no option to choose it.
- **Custom instructions replace Codex's own.** The override
  `model_instructions_file = <file>` put the file's text in place of Codex's
  base instructions (the session file's `base_instructions`), and the model
  repeated a passphrase that only the file held.
- **Isolation is incomplete.** The learner's `~/.codex/config.toml` sets
  `sandbox_mode = "danger-full-access"` and `approval_policy = "never"` and
  adds three MCP servers. With no overrides, the probe listed the global
  `~/.codex/AGENTS.md` (by its first heading), the learner's MCP servers,
  the ChatGPT apps (`codex_apps`: sites, pets, pages and others) and many
  built-in tools. Overrides removed some of it:
  - `features.apps = false` removed the ChatGPT apps;
  - `mcp_servers.<name>.enabled = false` removed each MCP server, but only
    by name, which a backend cannot know in general;
  - `features.tool_search_always_defer_mcp_tools = false` should keep
    teaching tools out of tool search, which defers MCP tools by default
    as Claude's does; its effect was not measured;
  - the thread options set the sandbox, approval policy, working directory
    and web search, overriding the config file (not checked with a write
    attempt).

  Still present with every override tried: the global `AGENTS.md`
  (`project_doc_max_bytes = 0` did not remove it), a skills section of
  about 6,600 characters, two multi-agent sections, and the collaboration
  tools (`features.multi_agent = false` did not remove them). Candidates
  for stage 6, untried: the CLI's `--ignore-user-config` flag ("auth still
  uses `CODEX_HOME`"), which the SDK cannot pass; and a separate
  `CODEX_HOME` for Gauss, which needs its own `codex login` by the learner.
  Copying or linking `auth.json` was not tried, because a token refresh in
  one copy could sign the learner's own Codex out.
- **What the adapter would need for Codex** (`architecture.md` section 7):
  - `backendSessionId` is known only once the first turn starts. The
    interface promises it at `startSession`; for Codex it would have to be
    reported when the first turn begins.
  - Teaching tools fit as they are. A Codex backend serves them over MCP
    from Gauss's process, and ends the turn by aborting it when a tool
    returns `endTurn`, mapping the abort to `ended_by_tool` from its own
    record, as the Claude backend does for interrupts.
  - `interrupt()` fits (the same abort). `text` events fit, but through
    the SDK each carries a whole message, so the page would not stream.
  - The system prompt goes in a file (`model_instructions_file`), which
    `startSession` can write.
- **Left behind:** the runs saved five sessions under
  `~/.codex/sessions/2026/11/15/` (thread ids starting `01a1de44` to
  `01a1de46`); the SDK has no option to skip saving, though the CLI has
  `--ephemeral`.
- **Runs**, for repeating them: `probe` without and with `--isolate` (before
  and after the feature switches were added), and `tool --isolate` before
  and after the approval mode was added.

## Stage 0 closed (plan task 0.7)

Done on 2026-11-15. Every item `architecture.md` first marked "to verify"
now has an answer in section 7. What stage 0 left open is the table "Open
after stage 0" at the end of that section, with the stage that settles each
row.

- **Spike code deleted.** All of `spike/` went: the findings are recorded
  in the entries above, and the code worth keeping was rebuilt in `src/`
  by task 0.5 (the isolation options in `src/server/backends/claude.ts`).
  The scripts the entries name are in the history:
  `git show 349c399:spike/<file>`. `@openai/codex-sdk`, added for task 0.6
  alone, was removed; stage 6 adds a Codex dependency again if it builds
  that backend, possibly the app server rather than the SDK.
- **Kept: the minimal page** (task 0.5), which is this stage's user check
  and the only runnable app until stage 1 replaces it.
- **Stage 1 revised.** Task 1.3 (backend adapter) was marked done, since its
  "done when" was already met by task 0.5's test and browser run. The rest
  of what the adapter lacks moves to where it is first needed: resume and
  `oneShot` in stage 2, the working directory and built-in tools in stage 3.
  Tasks 1.4 to 1.6 got notes on what they build on, and 1.4 deletes the
  demo's prompt and turn texts once the intake chat replaces it.

## Review fixes (plan task 0.8)

Fixed on 2026-11-15 after reviewing `src/` and `prompts/` from `d9251b6`.

- **An SDK interrupt does not cancel pending input.** The original manual
  checks did not establish that Stop works for later turns that have not
  started. The installed Agent SDK 0.3.325 declarations and the
  [official interrupt contract](https://code.claude.com/docs/en/agent-sdk/typescript#interrupt)
  document that such input survives. `Query.interrupt()` exposes no
  `cancel_queued` option or public pending-message cancellation method;
  that option belongs to the CLI's lower-level control protocol.
- **Keep the fix on public SDK APIs.** A `UserPromptSubmit` hook returns
  `continue: false` for a cancelled turn, which still yields the result the
  adapter must drain. Stop arriving after that hook is covered by another
  interrupt at the response's `message_start`, when the abort controller is
  live. Late teaching-tool callbacks are refused, and buffered output is
  drained without being shown. This preserves the long-lived session and
  avoids a private control-protocol adapter. A request can begin in the
  post-hook gap; Stop does not promise zero token usage.
- **Regression evidence, not a new live-backend observation.** Two new
  SDK-boundary cases failed against the original adapter by emitting the
  stopped reply. All three cases now pass: before prompt pickup, after its
  hook but before generation, and during generation. They also check that
  stopped turns cannot post a question and that the next turn replies
  normally. The test replaces only the SDK query boundary; no model is called.
- **A pending send owns only its submitted draft revision.** The composer
  locks submission synchronously while awaiting its POST, but keeps the
  textarea editable. Success clears only an unchanged draft; editing away
  and back still counts as a new revision. Refusal or network failure keeps
  the text and releases the lock.
- **Browser evidence with the fake backend:** a delayed send plus repeated
  Enter produced one POST; a newer draft survived success; an unchanged
  draft cleared; edits away and back survived; refusal and network failure
  kept the draft and enabled retry. These are browser checks, not permanent
  component tests: the current test tooling has no DOM environment, and no
  dependency was added just for this fix.
- **Checks:** `mise run check` passed lint, type-checking, 31 TypeScript tests
  and one Python test. No real model calls or real data-root access.

## Course and curriculum schemas (plan task 1.1)

Written on 2026-11-15: `src/shared/course.ts` and `src/shared/curriculum.ts`,
with tests beside them.

- **Ids are folder names.** A course id names its folder under `courses/`
  and a unit id its folder under `units/`, so both are slugs (lowercase
  letters and digits in words joined by single hyphens, at most 60
  characters) and can never be a path of their own. The course id is the
  folder name and is not repeated inside `course.json`.
- **The tutor names the units.** Prerequisites refer to unit ids, which the
  tutor chooses and is asked to keep when it revises a unit. Stable ids let
  the page mark what a revision changed, as the intake mock does.
- **Approval state is in `curriculum.json`**: a draft, or approved with the
  time of approval. A revision replaces the draft. Changes proposed after
  approval (`amend_curriculum`, stage 5) are not represented yet.
- **Prerequisite rules**: each must name a unit in the curriculum, no unit
  may list one twice, and together they must not form a cycle. They need not
  come earlier in the list, which is only the order units are shown in; the
  brief does not ask for more. A cycle is reported once, starting at the unit
  that comes first in the list, with every link in it. These checks run only
  once every unit has parsed, so a malformed unit gets the ordinary field
  error first.
- **Written for the tutor.** The unit fields carry descriptions and the
  checks give messages the tutor can act on, because `propose_curriculum`
  (task 1.4) takes the units as its input and sends a refusal's reasons
  back. The checks sit on the units array, not on the whole file, so they
  travel with that field into the tool's input. `prerequisites` is required,
  empty for a starting unit; task 1.4 can relax it if the model often leaves
  it out.
- **`course.json`** holds the title, the backend (only `claude` until stage
  6), `settings.webSearch` (read from stage 4, present now so older files
  need no migration), `createdAt` and `lastOpenedAt` (the library's order).
  Where a course stands and whether it is a one-off are derived, not stored.
- **No schema version.** Only Gauss writes these files. A field added later
  must be optional, or files written before it will no longer parse.
- **Checks:** 63 TypeScript tests and one Python test passed under
  `mise run check`. Four deliberate faults in the cycle search (searching
  from the first unit only, reporting the path that led into the cycle, not
  rotating the report, treating a revisited unit as a cycle) each made a
  test fail.

## Record module (plan task 1.2)

Written on 2026-11-15: `src/server/record/data-root.ts` and
`src/server/record/atomic-write.ts`, with tests beside them.

- **The data root** is `GAUSS_DATA_ROOT` when it is set and not empty
  (resolved to an absolute path), otherwise `~/gauss`. The server does not
  read it yet; task 1.5 does, when routes first use the record. Code takes
  the root as an argument (`openDataRoot({ path })`), so only `main.ts`
  looks at the environment and tests pass a temporary folder.
- **Atomic writes**: the new contents go to `.<name>.<uuid>.tmp` in the
  same folder, are flushed with `fsync`, and are renamed over the target;
  then the folder is flushed. A write that fails removes its temporary file.
  A crash can leave one behind; the record reads only the files it knows by
  name, so it is harmless. Nothing cleans them up yet.
- **Not ordered**: two writes to one file in flight at once each land whole,
  but the later one to start can finish first. The engine must wait for one
  write before the next to the same file (stage 2, `state.json`).
- **Course ids** come from the title: letters and digits, accents removed,
  words joined by hyphens, cut at a word to 50 characters, `course` if
  nothing is left, then `-2`, `-3` and so on if taken. Making the folder
  claims the id, so two creations cannot share one. A crash between making
  the folder and writing `course.json` leaves an empty folder, which the
  list skips and which keeps its name taken.
- **Reading**: a missing `course.json` means no course; a missing
  `curriculum.json` means none proposed yet (`null`). A file that is not
  valid JSON or does not match its schema is an error naming the file, and
  it fails the whole list. That is loud on purpose: atomic writes cannot
  produce such a file, so it means a hand edit or a bug. Task 1.6 can
  revisit it if one bad course should not hide the library.
- **The list is ordered** by `lastOpenedAt`, newest first (the library's
  order), then by id.
- **The crash test is deterministic.** A first version killed a child
  process with SIGKILL while it rewrote a large file; with a writer that
  writes in place, only 10 to 20% of kills landed inside the window where
  the file was partial, so the test would rarely catch a regression. The
  test now starts the child under `ulimit -f` below the new file's size, so
  the kernel stops the write partway every time. Node ignores SIGXFSZ, so
  the write fails with `EFBIG` and the process exits; the test checks for
  `EFBIG`, then reloads the record (old version, whole) and runs the same
  write without the limit (new version). A writer that writes in place left
  the first 512 KB of the new file, and failed it on every run. Not
  covered: power loss, which only the `fsync` calls address.
- **Checks:** `mise run check` passed lint, type-checking, 90 TypeScript
  tests and one Python test. Writing in place, skipping the cleanup after a
  failed write, dropping the id check in `readCourse` and dropping the list
  order each made a test fail.

## Intake and curriculum proposal (plan task 1.4)

Built on 2026-11-15: `src/server/engine/intake.ts`,
`src/server/tools/propose-curriculum.ts`, `prompts/planner.md`, and two
record operations in `src/server/record/data-root.ts`.

- **The course is created by the first proposal.** The intake mock has no
  title step: "New course" opens the conversation. So the tutor proposes
  the title with the units (`CurriculumProposal` in
  `src/shared/curriculum.ts`), the first proposal creates the course with
  an id from that title, and a revision that renames the course updates
  `course.json` but keeps the id. Before the first proposal nothing is on
  disk, so a restart then loses the conversation; the library shows only
  courses with a proposal. A course with no curriculum exists only if its
  creation stopped between `course.json` and the first draft.
- **The page asks the opening question**, as in the mock ("What do you want
  to learn? ..."), so the tutor session starts with the learner's answer and
  no model turn is spent on a greeting. The first turn's header says what
  was asked. Task 1.6 shows the question.
- **Change requests are replies.** A message while a draft is open goes to
  the tutor with a header naming the proposal and inviting a revision; the
  tutor sends the whole revised curriculum, which replaces the draft.
  Revision numbers count stored proposals in memory; a refused call does
  not count.
- **Approval names the revision the learner saw**, and is refused if a newer
  one exists (409), if there is no such revision (404), or while a turn is
  queued or running (409), so the tutor cannot revise during approval. It
  stamps `approvedAt` from the data root's clock, emits
  `curriculum_approved`, closes the tutor session and ends the intake: later
  messages are refused. The tutor is not told. In the mock the page notes
  the approval itself.
- **Record rules** live in the record module: `saveProposal` never replaces
  an approved curriculum, and every file is checked against its schema
  before it is written. `saveProposal` writes `curriculum.json`, then
  `course.json` if the title changed; a crash between them leaves the new
  draft under the old title.
- **The shared core.** The event log and turn queue moved from the demo chat
  into `src/server/engine/conversation.ts`, with their tests. The demo chat
  is rebuilt on it and stays runnable, because nothing replaces its routes
  until task 1.5; `prompts/demo-tutor.md` and the demo's turn texts go then.
- **With Claude, the SDK checks the input first.** Probed offline through
  the SDK's in-process tool server, with no model call: the published input
  schema carries the field descriptions; a valid call reaches the tool; an
  invalid one is refused by the MCP layer before the handler runs, as
  `MCP error -32602: Input validation error` followed by the zod issues as
  JSON, which include the schema's own messages (the cycle chain, for
  example). With the fake backend the same refusal is `defineTool`'s
  prettified text. Either way the tutor receives the reason.
- **Not in this task:** the style note, which the brief says the tutor
  proposes at intake and the learner approves with the curriculum. Nothing
  reads it before stage 2, and the settled intake mock does not show it;
  task 2.0 decides whether `propose_curriculum` carries it. The optional
  baseline is stage 5; sources are stage 4. The planner prompt mentions
  neither.
- **Not checked with a real model.** The prompt and the tool have run only
  against the fake backend and the offline probe; the first real run is
  task 1.6's user check.
- **Checks:** `mise run check` passed lint, type-checking, 100 TypeScript
  tests and one Python test. Eight deliberate faults in the intake (a
  proposal that does not end the turn, a new course for every proposal, a
  stale or mid-turn approval, no change-request header, messages after
  approval, an approval or a proposal that is not stored) each made a test
  fail.

## Routes and event stream (plan task 1.5)

Built on 2026-11-15: `src/server/http/app.ts` with its tests, the intake
registry (`createIntakes`) in `src/server/engine/intake.ts`,
`src/shared/library.ts`, and the wiring in `src/server/main.ts`.

- **The routes.** The library: `GET /api/courses` (every course as the
  record holds it, most recently opened first) and `GET /api/courses/<id>`
  (404 if there is none). "New course": `POST /api/intakes` answers 201 with
  the new intake's id. Under `/api/intakes/<id>/`: `GET events`,
  `POST messages` (202: accepted, and the tutor's reply comes over the event
  stream), `POST approval` with the revision number (200 once the record is
  written), and `POST interrupt`. An unknown intake is 404 on each. The
  bodies are schemas in `src/shared/`: `LearnerMessage`, `Approval` and
  `IntakeStarted` in `events.ts`, `Library` and `StoredCourse` in
  `library.ts`. `StoredCourse` moved there from the record module so that
  the page and the server share one definition.
- **An intake's id is its event log's id**, a random UUID. The routes need
  it because the course id exists only from the first proposal. Intakes
  are kept in memory by id; `main.ts` closes their sessions on shutdown.
  An intake stays after approval, so a page can still replay it.
- **A restart ends an intake in progress.** Its routes answer 404, so the
  browser's event stream gives up instead of retrying, and the page says
  the conversation ended. A course it proposed is on disk as a draft and
  is listed, but nothing can approve it, because approval goes through
  the intake. Task 1.6 decides what the library offers for such a draft.
- **The event stream is task 0.5's, one per intake.** `hello` carries the
  intake id as `chatId`; event ids are `<intake id>.<index>`, and a
  `Last-Event-ID` from another log replays from the start.
- **Errors carry their reason.** A record file that cannot be read (a
  `course.json` that is not JSON, say) or a failed write answers 500 with
  the reason as `error`, the same shape as a refusal, so the page can show
  it. The server logs it as well.
- **The demo is gone**: `src/server/engine/chat.ts`, its tests,
  `prompts/demo-tutor.md`, its routes and its start screen's styles.
  `ask_question` and the multiple-choice grading stay for stage 2. Their
  checks from the demo chat's tests moved to
  `src/server/tools/ask-question.test.ts` and
  `src/server/engine/grading.test.ts`.
- **The page is a stand-in until task 1.6**, changed only so that the
  running app still works. `src/web/App.tsx` shows the opening question,
  starts an intake with the first message, keeps the intake id in the
  address (`?intake=<id>`) so a reload finds it, and can stop a turn.
  Proposals are not shown and cannot be approved there yet.
- **Not handled: abandoned intakes.** An intake the learner leaves keeps
  its tutor session, which is a Claude Code process, until the server
  stops. Task 1.6 decides when the learner leaves an intake, and should
  close its session then.
- **`lastOpenedAt` is not updated** by any route yet. Stage 2 updates it
  when the learner opens a unit.
- **Checks:** `mise run check` passed lint, type-checking, 104 TypeScript
  tests and one Python test. Each of seven deliberate faults in the routes
  made a test fail: approving a fixed revision, no 404 for an unknown
  intake, no 404 for an unknown course, a plain-text 500, a replay that
  repeats the last event, no body check on messages, and no Origin check.
- **Browser run with the fake backend** on a scratch server built like
  `main.ts`. The first message started an intake and put its id in the
  address, and the reply streamed in. A proposal put a draft course in the
  library. A reload replayed the thread, and Stop ended a held turn.
  Approval through the route was accepted and a later message refused.
  After a restart the page said the conversation had ended, and the
  approved course was still listed. `pnpm dev` itself was started with
  `GAUSS_DATA_ROOT` pointing at a scratch folder: it served an empty
  library, started an intake and sent its `hello`. No message was sent, so
  no model was called.

## Library and course views (plan task 1.6)

Built on 2026-11-15. The views are in `src/web/` (`Library.tsx`,
`Intake.tsx`, `Course.tsx`, the shared `Frame.tsx`, `Curriculum.tsx` and
`Composer.tsx`). The tested logic sits in pure modules beside them
(`route.ts`, `diagram.ts`, `units.ts`, `library.ts`, `timeline.ts`).
Reopening a draft is on the server.

- **Three views, chosen by the address**: the library at `/`, an intake at
  `/intakes/<id>`, a course at `/courses/<id>`. The page moves between them
  with the history API, so Back works. Vite serves the page at every path;
  the script tag is now `/main.tsx` so that it loads from any of them.
  "New course" starts an intake at once and opens it.
- **The library is mock 6.** Each row gives the title, "One-off" for a
  course of one unit, where the course stands, a tick per unit, and when it
  was last opened ("Today", "Yesterday", "3 days ago", "Last week", "2
  weeks ago", then the date). A draft says "The curriculum is ready for your
  review" in yellow, with no ticks. An approved course says "Unit 1 of N:
  <title>, not started", and a one-off "Not started". The "Finished" group
  is left out, since nothing can finish before stage 2.
- **The intake is mock 8.** It shows the opening question, the thread, and
  each proposal as a card with "Show the diagram" and Approve. The earlier
  card shrinks to "First proposal, 7 units. Replaced by the one below." A
  revision marks the units that are new, or whose title, goal or
  prerequisites differ from the proposal just before it, matched by id.
  Approve is disabled while the tutor writes. After approval the card says
  "Approved", and the page notes "Approved. The course is in your
  library." It then offers "Open the course" where the mock had "Start unit
  1", which is stage 2's.
- **The course view is mock 7**, without what later stages add (Continue,
  notes, sources, unit status). It shows the title, "Approved on <date>. No
  unit has started yet.", the unit list, and the diagram in the side pane,
  where a click marks the unit in the list. Esc closes the pane. A draft
  course shows "Review the curriculum" at the right of the top line.
- **A draft after a restart (left open by task 1.5) opens for review.** If
  the intake that proposed it is still running, the draft opens there, so
  the conversation is kept, as mock 8 says. Otherwise it opens in a new
  intake that starts from the stored draft as proposal 1
  (`POST /api/courses/<id>/review`). That thread starts with "This
  curriculum was proposed in a conversation that was not kept. Push back
  on anything, or approve it.", then the card. A tutor session starts only
  if the learner replies, and its first turn carries the whole draft;
  `prompts/planner.md` has a paragraph for this case. Approving needs no
  tutor turn. A new page event, `draft_reopened`, tells the page.
- **Abandoned intakes are kept, not closed.** This revises task 1.5's note.
  Mock 8 says that going back to the library keeps the conversation and the
  proposal, and the draft row now leads back to them. Closing the session
  when the learner leaves would lose what the mock keeps. The cost remains:
  each intake that was sent a message holds a Claude Code process until
  the server stops. Stage 2 builds session resume, which makes it cheap to
  close an idle session and resume it later, so it should do that then.
- **The page lays out the diagram itself** (`src/web/diagram.ts`), rather
  than using Mermaid (listed in `architecture.md` section 2), to keep the
  mock's look. Each unit sits one row below the deepest unit it builds on,
  at most two to a row (the mock's node width), with any more placed further
  down in list order. A pair is ordered by where its lines come from. A line
  that skips a row passes beside the unit in that row, which moves aside, or
  through the gap between two units. In the first browser run such a line
  passed behind a unit and looked like two lines into it. The units are
  filled for the same reason. A long title is cut short with an ellipsis,
  and the full title shows on hover.
- **One real run, on Haiku 5.5**, with a scratch data root. Asked for a
  one-off on Bayes' theorem, the planner proposed one unit through
  `propose_curriculum`, and the turn ended at the card. Asked for two
  units, it revised and kept the first unit's id, so only the new unit was
  marked. Approval stored the curriculum. It took two model turns, and it
  was the first run of the planner prompt and the tool on a real model.
- **Browser run with the fake backend**, on a scratch server built like
  `main.ts`. It covered the whole user check: a new course, a proposal,
  the diagram, a push-back, the revision with its changes marked,
  approval, the course view with a unit marked from the diagram, Esc, the
  library, and Back. It also covered leaving a draft and finding its
  conversation again from the library. After a restart, the open intake
  said it had ended; the draft then reopened, was revised there, and was
  approved. An unknown intake and an unknown course each show a note.
- **The React components have no automated tests.** The test setup has
  no DOM environment (see "Review fixes"), so the views were checked in the
  browser, and their logic is in the tested pure modules.
- **Checks:** `mise run check` passed lint, type-checking, 140 TypeScript
  tests and one Python test. Each of eleven deliberate faults made a test
  fail: no row limit in the diagram, lines behind units, a pair kept in
  list order, prerequisite changes left unmarked, an unsorted "Builds on",
  a wrong week boundary, ticks on drafts, changes measured against the
  first proposal, a new intake for every review, a reopened intake that
  opens like a new one, and review of an approved course. The test needed
  a third revision before the first-proposal fault failed it. The review
  also found that a malformed address (`/courses/%E0%A4`) crashed the page;
  it now shows the library, with a test.

## Library review fixes (plan task 1.7)

Fixed on 2026-11-15 after reviewing tasks 1.5 and 1.6.

- **One intake owns a course for the server's lifetime**, including while
  approval is being written and after it succeeds. A review request that
  read the draft before approval finished returns that same intake, whose
  event log carries the approval, rather than creating an invalid second
  review thread. A request that reads the approved record still gets 409.
  The registry no longer needs the intake's `ended()` accessor.
- **Diagram ports fit within the nodes.** The gap remains at most 8% of
  diagram width, but shrinks for high-degree units to fit a 36%-wide span
  inside the mock's 46%-wide nodes, clear of the rounded corners. Both
  incoming and outgoing ports stay distinct instead of clamping together.
- **Regression evidence:** the added route test failed on a second intake
  being created during a held approval write; it also covers a stale draft
  read reaching the registry after approval. Diagram cases with eight and
  twenty dependents/prerequisites failed on detached ports before the fix.
  A browser check on a scratch fake-backend server confirmed all eight
  outgoing and incoming ports are inside their rendered nodes and distinct.
  No real model calls or real data-root access.
- **Checks:** `mise run check` passed lint, type-checking, 144 TypeScript
  tests and one Python test.

## Stage 2 breakdown (plan task 2.0)

Written on 2026-11-15. The tasks are in `docs/plan.md`; these are the
choices that shaped them.

- **The style note comes with the proposal.** The brief has the tutor
  propose it at intake and the learner approve it with the curriculum, so
  `propose_curriculum` carries it and approval covers both (task 2.10).
  Courses approved before then have none and use the default style in
  `prompts/tutor.md`. Where it sits on the card is a design question (2.1).
- **A unit is planned in a session of its own** (2.5), before the tutor's
  session starts, with `prompts/unit-planner.md` and the `plan_unit` tool.
  The tutor's session is then seeded with the plan, as `architecture.md`
  section 4 already says, and for a source course the unit's whole text is
  read there rather than carried through every teaching turn. This settles
  the open item in section 8. `planner.md` stays the intake's prompt: one
  file for both jobs would hand the intake instructions for a job it never
  does. The cost is one more model call when a unit starts.
- **The learner starts each segment**, with mock 3's "Start the next
  segment", so starting one is the learner's action and not the tutor's
  tool. Task 2.6 confirms this and revises section 5's tool list.
- **The phase loop comes before the rules that refine it.** Task 2.6
  builds the whole loop with the simplest closing rule (an answer for each
  objective); 2.7 adds the adaptive question count, help and the unit's
  close, which need the derived status (2.3) and a design pick (2.1).
- **Four things stage 2 shows were not designed in task 1.0**, so 2.1 mocks
  them first, one question each, for the user to pick: the style note on
  the proposal card, a unit's end without its gate, "Start fresh", and
  whether a unit can start before the units it builds on are finished
  (left open by mock 7).
- **Each prompt is its own task, checked by a real run**: the grader
  against answers graded by hand (2.9), the tutor against transcripts of
  real segments (2.16). Both depend on the model's judgment, so they may
  use Sonnet or Opus. The tasks before them run on short first versions of
  the prompts and the fake backend.
- **The open rows of section 7 are assigned**: resume (`snapshot: false`,
  the 30-day cleanup) to 2.14; other variables that may redirect the SDK
  to 2.8, the first task that changes the backend; the slow reply after a
  stop to the real runs of 2.14 and 2.16, if it recurs. The idle intake
  sessions (notes from 1.5 and 1.6) are 2.15, after resume.
- **Not settled here**: the passing rule and what counts as help (2.3, with
  a proposal for help), the question count's limits (2.7), what starts a
  new session in the transcripts (2.13), and the Markdown renderer (2.4).

## Stage 2 designs (plan task 2.1)

Chosen by the user from the mocks in `docs/prototype/` (pieces 9 to 12),
2026-11-15. Each mock's header comment says what was asked, picked and
rejected; the chosen styles are in `docs/prototype/base.css`.

- **The style note is a section of the proposal card** (piece 9), under
  the units, headed "How I would teach it" and always shown, so the
  learner reads it before approving. A revision marks it "Changed", as it
  marks units. Rejected: a folded line in the card (folded, two revisions
  can look the same), and the note in the side pane.
- **A unit ends with a closing card** (piece 10), built like the check
  card: "Unit N finished" and how it stands, one row per objective (passed,
  or not passed and why), and the next step in its foot. It shrinks to one
  line once a step is taken. When every objective passed: "Back to the
  course" and "Start unit N". When some did not: "Go over the N again"
  teaches one more segment on those objectives, and "Move on without
  them", confirmed once, records the unit as overridden, its objectives
  still not passed. Rejected: a marker line with the objectives and the
  next-step control under it, and sending the learner to the course view.
  Stage 5's gate and notes come before this card.
- **"Start fresh" is in the unit's outline** (piece 11), below the
  segments, with a line saying what it does, and asks once. Afterwards the
  earlier conversation stays in the thread, dimmed; a "Fresh start" marker
  says the tutor has the learner's progress but not that conversation, and
  the tutor picks up at the same segment and phase. The automatic fallback
  when a conversation cannot be resumed looks the same, with its own
  marker line. Rejected: a menu at the right end of the top line, and a
  button in the message box, beside Send, where it is easy to hit.
- **Any unit can be started at any time** (piece 12, round 1). A unit whose
  prerequisites are not finished asks once first. Starting a unit leaves
  any unit in progress where it is, so several can be in progress at once.
  Rejected: Start only once a unit's prerequisites are finished, and one
  unit at a time in the list's order. The user asked as well for the unit
  in progress, or else the next unit in order, to stand out at the top of
  the course view, so that continuing is one obvious step.
- **A card at the top of the course view leads on** (piece 12, round 2).
  Above the units, it says "In progress" with the unit and where in it the
  learner is, or "Up next" with the next unit in order and its goal, and
  has one Continue (or "Start unit N") button. Other units in progress get
  one line each in the card, most recently opened first. The next unit in
  order is the first in the list that is not started and whose
  prerequisites are finished. The card replaces piece 7's Continue at the
  right of the top line. Rejected: the rows of the units in progress
  lifted into a group of their own above the list, and one wide accent
  button under the title.
- **For later tasks.** 2.2: a position per unit in progress, not one
  current unit, in `state.json`. 2.7: "Go over the N again" adds one
  segment after the plan's last. 2.10: the note's place on the card. 2.11:
  the closing card and "Start fresh" in the outline. 2.12: the card at the
  top, Start on every unit, and the question before a unit whose
  prerequisites are not finished. 2.14: the "Fresh start" marker for both
  ways a conversation is replaced.

## Plan, state and evidence records (plan task 2.2)

Written on 2026-11-15: `src/shared/plan.ts`, `state.ts` and `evidence.ts`,
the stored unit in `curriculum.ts` and the stored question in `question.ts`;
in `src/server/record/`, the new operations of `data-root.ts`, with
`file-lock.ts` and `json-lines.ts`. Tests sit beside each.

- **The plan is on a stored unit.** `StoredUnit` extends `Unit` with an
  optional `plan`, and `curriculum.json` holds stored units, so stage 1's
  files parse unchanged. `propose_curriculum` still takes `Unit`, so the
  intake cannot send a plan.
- **Plan rules.** An objective has a slug id and a one-sentence statement.
  A segment has a title, because mock 4's outline shows one per segment,
  and one or two objective ids. Segments are in teaching order. Each
  objective is taught in exactly one segment: a segment names only the
  plan's objectives, none of them twice, and every objective is in one.
  When two objectives share an id, only that is reported, since which one a
  segment means is unclear. The messages are written for the planning
  session (2.5), which gets them back with a refused plan.
- **For 2.7:** because an objective is taught in one segment, "Go over the N
  again" cannot be added to the plan as an ordinary segment. Keep it in the
  unit's position, or relax the rule for it there.
- **Objective ids are unique in the course.** The curriculum checks this,
  since a plan does not see the other units. A clash is reported on the
  later unit and names both. `storePlan` sends back the messages alone,
  because the paths point into the whole curriculum, which the planning
  session never sees.
- **`storePlan`** refuses a curriculum that is not approved, a unit not in
  it, and a unit that already has a plan. Planning a unit again is not
  designed, and a second `plan_unit` call in one planning session should
  fail.
- **`state.json` holds `units`, a position per unit in progress, by unit
  id** (piece 12). A position holds the segment's index in the plan (from
  0), the phase, the open question and the tutor's session id. The phases
  are `teach`, `discuss`, `check` and `closed`; `closed` means the segment
  has closed and the learner has not started the next. The open question
  is allowed only in `check`. The session id is optional, because the
  backend reports it with the first turn. `writePosition(course, unit,
  position)` changes one unit's position under the lock, so two unit chats
  writing at once cannot lose each other's change; `null` takes the unit
  out.
- **The record does not check a position against the plan** (that the unit
  exists, the segment is in range, the question's objective is in the
  segment), nor an entry's objective against the curriculum. Those are the
  engine's rules (2.6), which refuses the tutor's call before anything is
  written.
- **A stored question** (`Question` in `question.ts`) is what the learner saw
  plus the grading material, with a `kind`, so written answers (2.8) join
  the union without changing files written before them. The tool's input,
  `ChoiceQuestionInput`, shares its fields. Its `objective` is still free
  text; 2.6 turns it into an objective id.
- **An evidence entry** is either an answer or an override. An answer holds
  the objective id, the question as posted, the learner's submission as sent
  (with confidence and reasoning), `assisted`, the verdict and
  `recordedAt`. An override holds the objective ids it covers. Neither holds
  a unit id, because objective ids are unique in the course. `assisted` is
  required, so the engine writes `false` until 2.7 records help. An "I don't
  know", and only that, is graded `unknown`.
- **Writes wait for each other.** `withFileLock(path, work)` queues work per
  file and runs it in the order called; a failure reaches its caller and
  does not stop the work after it. The record takes the lock when the call
  is made, before its first `await`, so checking that the course exists
  cannot reorder two calls. It is taken for every read and write back of
  `curriculum.json` (proposal, approval, plan) and `state.json`, and for
  every append. The lock's queues live in the module, keyed by absolute
  path, so two `openDataRoot` calls over one root share them. Another
  process writing the same root is not covered; only Gauss writes it.
- **The evidence log.** An entry counts once its line ends. Reading skips an
  unfinished last line, and any other bad line is an error naming the file
  and line, as with a damaged JSON file (task 1.2). Before an append, an
  unfinished last line is truncated away; the last newline is found by
  reading back from the end in 4 KB pieces. Without that, the next entry is
  glued onto the cut line and lost with it. A whole entry missing only its
  newline is dropped too, so reading and appending agree. The transcripts
  (2.13) can use `json-lines.ts`.
- **Checks:** `mise run check` passed lint, type-checking, 189 TypeScript
  tests and one Python test. Each of these faults made the tests written
  for it fail: a plan without each of its five rules; no course-wide
  objective id check; an open question allowed outside the check; no
  verdict check; the reader keeping the unfinished line; an append that
  does not clear it; searching only the last 4 KB; and, in the lock,
  running work at once, a failure stopping the queue, and one queue for
  every file. With the lock taken out of the record, three tests failed:
  two writes to one unit landing in the order issued (the first is 4 MB, so
  it would finish last), two units' writes both kept, and two units' plans
  both kept.
- **Not covered:** with the lock taken out of `appendEvidence` alone, the
  evidence test still passed, because Node's thread pool kept the three
  appends in order. The lock's own tests cover the ordering; that the append
  takes the lock was checked by reading the code. A crash is simulated by a
  cut file written by hand, not by stopping a process mid-append, unlike
  task 1.2's crash test.

## Objective status (plan task 2.3)

Written on 2026-11-15: the statuses in `src/shared/status.ts`, the pure
functions `objectiveStatus(evidence, objective)` and `unitStatus(unit,
evidence, position)` in `src/server/record/status.ts`, and `isConfident`
in `src/shared/question.ts`. The caller reads the record; the functions do
not. The rules were chosen by the agent and can be overturned.

- **Statuses this stage can produce.** An objective is `not-started`,
  `attempted`, `passed` or `overridden`; retained and slipping need the
  unit gate and join in stage 5. A unit is `not-started`, `in-progress`,
  `passed` or `overridden`.
- **"Attempted" names an objective with evidence that has not passed**, which
  section 3's list had no word for. Not "in progress": that is the unit's
  word, and it would mislead for an objective whose segment closed at the
  check's limit. Learner-facing copy says "Not passed" for both attempted
  and overridden objectives (mock 10).
- **The passing rule.** An objective passes once, since its last miss, it
  has unassisted correct answers to two different questions, or one given
  at 90% or 100%. Two questions is the brief's "varied problems"; one
  confident answer is its "fewer after confident correct answers", without
  which the adaptive count would have nothing to shorten. A confident
  correct answer can still be a lucky one, so the unit gate (stage 5)
  checks again.
- **A miss clears the correct answers before it.** A miss is a wrong answer
  or an "I don't know", with help or without. So a miss after a pass takes
  the pass away, and the objective is attempted again; stage 5 may call
  some of these "slipping". This gives 2.7 its count: an objective needs no
  more questions once it passes, and needs at least one more after a miss.
- **"Different questions"** means what the learner saw differs: the prompt
  and the choices, spacing ignored, grading material not counted. The same
  question posted twice is one problem. Code cannot judge variety beyond
  that; the tutor's prompt (2.16) asks for it.
- **Help.** A correct answer given with help counts for nothing either way:
  it neither passes the objective nor clears the answers before it. A miss
  with help is still a miss. The rule for recording help (2.7 records it):
  **an answer is assisted when the tutor received a message from the learner
  while its question was open**, from its posting to the answer's
  submission. The engine sees this itself; it needs no word from the tutor.
  Worked against these cases:
  - The learner asks "is it the chain rule?" with a question open, and the
    tutor hints: assisted. Right.
  - The learner asks the tutor to rephrase the question: assisted. A
    rephrasing can be a hint, so this errs the safe way.
  - The learner writes "back in ten minutes": assisted, wrongly. It costs one
    more question on that objective, no more. The page can say that writing
    while a question is open counts as help (2.11).
  - A message written while the tutor was still writing its lead-in, and
    delivered once the question was posted: assisted, since the tutor's
    reply comes while the question is open. This is why the rule counts
    what the tutor received, not when the learner pressed Send.
  - A question in discuss, or between two questions after the tutor's
    feedback: not assisted, since no question was open. That is teaching,
    and the next question checks whether it landed.
  - Reasoning typed into the answer card: not assisted. It is not a message
    to the tutor.
  - A hint in the tutor's own lead-in: not caught. The tutor's prompt forbids
    it, and 2.16 checks for it in the transcripts.

  Rejected: the tutor declaring help with a tool, which relies on the
  model's word where the design enforces rules in code, and judging the
  tutor's replies for hints, which code cannot do.
- **"I don't know"** is a miss like a wrong answer. It is never a confident
  miss, which matters only to detours (stage 5).
- **An override** marks each objective it names overridden, but never takes
  away a pass, so a segment's "Move on without the check" can name all the
  segment's objectives. A later answer takes the override's place: going
  over an objective again is decided by the new answers. At the unit's
  closing card, "Move on without them" (2.1) should record an override of
  the objectives not passed; that makes the unit overridden.
- **Log order decides**, not `recordedAt`: the log is appended under the
  lock, so its order is the order of recording even if the clock jumps.
- **Unit status.** A unit with a position in `state.json` is in progress,
  whatever its evidence: a unit just started has none until its first
  answer, and the course view must show it in progress. Otherwise its
  objectives decide: no plan, or no objective with evidence, is not
  started; all passed is passed; all passed or overridden is overridden;
  anything else is in progress. That last case is a record left
  half-written, with the position gone but objectives unfinished.
- **For later tasks.** 2.7: take the unit out of `state.json` when it closes,
  passed or after "Move on without them"; while the closing card waits on
  the learner, the unit stays in progress. 2.7 and 2.11: page events carry
  the statuses from `src/shared/status.ts`. 2.12: `unitStatus` with the
  unit's position from `state.json`.
- **Checks:** `mise run check` passed lint, type-checking, 224 TypeScript
  tests and one Python test. The 35 new tests are hand-worked evidence
  logs: 24 small ones for an objective, one sitting through a unit at four
  points, and 8 for a unit. Each expected status was worked out by hand
  from these rules. Each of these faults in the code made at least one test
  fail: counting answers with help; a miss not clearing; "I don't know", or
  a miss with help, not counted as a miss; an override taking a pass away,
  covering objectives it does not name, or surviving a later answer;
  answers to other objectives counted; the same question counted twice,
  choices left out of what makes a question different, or spacing counted;
  75% counted as confident; one unconfident answer passing; entries sorted
  by time; the position ignored; one override making an unfinished unit
  overridden; and an unfinished unit without a position called not
  started. An early version had an override check that changed no result;
  the fault test found it, and it was taken out.

## Markdown and math (plan task 2.4)

Written on 2026-11-15: `src/web/prose.tsx` and its tests, the question card
and the thread using it, the styles in `src/web/styles.css`, and the
Markdown rule in `prompts/planner.md` and `ask_question`'s field
descriptions. The choices are the agent's and can be overturned.

- **The renderer is react-markdown 10, with remark-gfm, remark-math 6 and
  rehype-katex 7**, and `katex` 0.16 for its stylesheet. It turns Markdown
  into React elements, so text from a model is never set as HTML: raw HTML
  in it is shown as text, and links with unsafe protocols lose their
  address, both by default. Its components map will also suit stage 4's
  citations, which open a passage. `katex` is pinned to the 0.16 line that
  rehype-katex requires: the latest, 0.19, installed a second copy whose
  stylesheet would not match the renderer. remark-gfm adds tables,
  strikethrough and bare links, which models write by habit. Rejected:
  markdown-it with a math plugin, far fewer packages, but it yields an HTML
  string for `dangerouslySetInnerHTML`, so safety rests on its escaping and
  later interactive pieces need post-processing; and marked with DOMPurify,
  which cleans HTML after the fact. The cost: 118 packages (the unified
  ecosystem's many small modules) and a page script of 777 kB, 235 kB
  gzipped, which a local app can carry.
- **What the page does with a model's text**: raw HTML, a script tag
  included, is shown as text, and a block of it is a paragraph of its own;
  a link opens in a new tab with `rel="noreferrer"`, and one with an unsafe
  protocol is only its text; an image shows its description and is never
  fetched, because a prompt injection in a source (stage 4) could otherwise
  carry data out in an image address; KaTeX runs untrusted (its default), so
  `\href`, `\url` and `\includegraphics` are refused and shown in red.
- **Math**: `$...$` in a line, and `$$...$$` for display, either with the
  dollars on lines of their own (remark-math) or with the formula on one
  line by itself, alone or inside a paragraph. remark-math reads that last
  form as inline math, so a small plugin, `displayMathLines`, marks it as
  display and drops the newlines around it. `$$` within a line stays
  inline. A formula that fails to parse shows its source in Frappé red,
  with KaTeX's message as its title, and the text around it renders. Dollars
  in code are code.
- **A dollar sign that is not math must be written `\$`.** "It costs $5 and
  $10" is read as math, and no rule fixes that reliably: Pandoc's rule fails
  on "$5. Then $x$". `planner.md` asks for `\$`; `tutor.md` (2.16) must too.
- **Not supported: `\(...\)` and `\[...\]`.** Markdown reads `\(` as an
  escaped bracket. The prompts ask for dollars; if a real run shows the
  tutor using these, convert them.
- **A single newline is a line break**: `.prose p` keeps the `white-space:
  pre-wrap` it had for plain text (task 1.6), which suits a proof typed line
  by line.
- **Where it is used.** `Prose` renders the tutor's text in the thread and
  the question's prompt; `InlineProse` renders each choice, on its button
  and in the graded card's lines, without paragraphs, which a button may
  not hold. The learner's own messages, and unit titles and goals on the
  proposal card, stay plain text; `planner.md` asks for plain titles and
  goals, and lets its replies use Markdown and math.
- **The answer preview** (`AnswerPreview`) renders what the learner types as
  Markdown with `$` math, with a line saying so while the field is blank.
  Mock 2's preview renders its math kind as one formula; a written answer
  (2.8) mixes words and math, so it takes the same rendering as the tutor's
  text. It is built and tested but not mounted, because the written answer
  field comes with 2.8 and 2.11; the `.prev` style is mock 2's, made a
  block for paragraphs.
- **Checks:** `mise run check` passed lint, type-checking, 245 TypeScript
  tests and one Python test. The 21 rendering tests render to static HTML in
  Node with `react-dom/server`, so they need no DOM. Each of these faults
  made at least one fail: raw HTML dropped instead of shown; KaTeX trusted;
  another error colour; an unsafe link kept as an empty link; images shown;
  no display rule for `$$` lines; the newlines around one kept; formulas
  decided one at a time, so the second of two consecutive lines stayed
  inline; `$$` within a line made display; a block of raw HTML left bare;
  paragraphs in choices; and a blank preview rendered. A fault written at
  first changed nothing; it was rewritten and then caught.
- **Browser run with the fake backend**, on a scratch server built like
  `main.ts`, whose backend also had `ask_question` and posted its cards
  into the intake's thread. The reply streamed in three pieces, one cut
  inside a formula. The thread showed a heading, both kinds of list,
  emphasis, inline math, three display formulas (fenced, on one line, and
  inside a paragraph), the failed formula in red, raw HTML and a script tag
  as text, `\$` prices and code; the unsafe link was text and the image its
  description. Nothing ran: the script, an `onerror` and an `onclick` each
  tried to set `window.__pwned`, which stayed unset, and the thread held no
  `script`, `img`, `b` or `onclick` element. A graded card and an open card
  showed Markdown and math in their prompts and choices. A reload rebuilt
  the same thread, the KaTeX fonts loaded, and the console had no errors.
  The run found the block of raw HTML running into the next paragraph, now
  fixed. A production build bundles the KaTeX fonts.
- **Not covered:** the preview updating as the learner types, until it is
  mounted; how a real model writes Markdown and math (2.16). A render that
  throws would blank the page, since the page has no error boundary;
  rehype-katex catches KaTeX's errors, and no other was seen.

## Unit planning (plan task 2.5)

Built on 2026-11-15: `src/server/tools/plan-unit.ts`,
`src/server/engine/unit-planning.ts` and `prompts/unit-planner.md`, with
fake-backend tests beside the engine module. The choices are the agent's
and can be overturned.

- **`createUnitPlanner(...).plan(course, unit)`** returns the unit's plan, or
  why there is none: `not-found` (no such course or unit), `not-approved`
  (the curriculum is a draft), or `failed` (two sessions stored nothing),
  each with a message written for the learner. The first two are checked
  before any session starts, and a unit that already has a plan returns it
  with no session. Task 2.6 calls it when a unit starts, reads
  `prompts/unit-planner.md` in `main.ts`, and maps the problems to 404, 409
  and a note in the unit's thread; nothing calls it before then.
- **One session, one turn.** The turn's header names the unit ("unit 1 of
  2"), says that `plan_unit` is allowed and that nobody reads the text or
  answers questions. The curriculum follows as JSON, as the intake's review
  turn gives a draft: every unit in order with its goal and prerequisites,
  and for each unit already planned, its objectives with the derived status
  of each (task 2.3). That is "the record as it stands" (brief, "How a
  course runs"), and it shows the session which objective ids are taken.
  After the turn the session closes.
- **`plan_unit` takes the plan only.** The unit is the one the engine is
  planning, bound in the tool, so the session cannot plan another unit.
  Storing ends the turn. The plan's own rules (from `Plan`) and the
  record's (an objective id used in another unit) refuse a plan with their
  messages, written for this session in task 2.2, and the session can send
  it again in the same turn.
- **A session that ends without a plan is tried once more, in a new
  session**, whose header adds why the first stored nothing: it ended
  without a plan, its last plan was refused (with the reason), or the
  backend failed (with the error). A new session rather than another turn,
  because a session that failed in the backend may not take another turn,
  and the one turn carries the whole context anyway. After the second, the
  result is `failed` with the reason, and nothing is stored.
  With Claude, a plan whose fields fail their own types (an empty list of
  segments, say) is refused by the SDK before the tool runs (task 1.4), so
  the retry's header then says only that the session ended without a plan.
  The plan's cross-field rules and the record's refusals are the tool's and
  are reported.
- **Two starts of one unit at once share one planning session**, through a
  map of the plannings under way. Without it, the second would run a
  session whose plan the record then refuses. Another process writing the
  same data root is not covered; only Gauss writes it.
- **The prompt** asks for three to six objectives that together reach the
  unit's goal and no further, each one testable sentence; new ids across
  the course; nothing earlier units teach, except an objective that
  refreshes an unpassed prerequisite in this unit's terms; segments of one
  or two objectives in teaching order, with titles for the outline; one
  call, fixed and repeated if refused.
- **Not given to the session:** the learner's background from the intake,
  which the record does not keep (the intake's conversation is gone after
  approval, and `profile.md` in `architecture.md` section 3 is not written
  yet), and the style note (2.10). If plans need the background, the intake
  should keep a profile; this is open.
- **No limit on refused calls within one turn.** A model that keeps sending
  refused plans keeps its turn going until Claude Code's own limits stop
  it. Not seen.
- **Real run on Haiku 5.5**, through a throwaway script on a scratch data
  root: the intake, with `planner.md`, was asked for a two-unit course on
  derivatives and proposed one in its first turn; approval stored it. The
  planning session for unit 1 called `plan_unit` once, about 3 seconds
  after it was started, with four objectives (forming the difference
  quotient, its limit, a derivative from the definition, the derivative as
  a slope), each in a segment of its own, with new ids. The plan was
  stored, and the record read back matched it. The intake's model sent no
  text before its card, which `planner.md` asks for; a note for the
  planner prompt's next revision. Three model sessions in all.
- **Checks:** `mise run check` passed lint, type-checking, 257 TypeScript
  tests and one Python test. Each of these faults made at least one test
  fail: no second attempt; a retry not told why; a session left open; no
  approval check before the session; a unit with a plan planned again; two
  starts not sharing a session; no statuses in the context; the reason of a
  plan refused by its schema lost (the tests found this one in the first
  version, which kept only the record's refusals); the backend's error
  left out of the failure; and storing that does not end the turn.

## Unit chat and phases (plan task 2.6)

Built on 2026-11-15: `src/server/engine/unit-chat.ts` (the chat and its
registry), `src/server/engine/unit-turns.ts` (the system prompt and every
turn's header), `src/server/tools/close-segment.ts`, a short first
`prompts/tutor.md`, the unit routes in `src/server/http/app.ts`, and in the
record `markOpened` and `readStyle`. Tests sit beside each. The choices are
the agent's and can be overturned.

- **The learner starts each segment; there is no `start_segment` tool.**
  Mock 3's "Start the next segment" held up: the tutor never needs to start
  one, and a tool for it would let the model move on by itself.
  `architecture.md` section 5 is revised.
- **Opening a unit** (`POST /api/courses/<id>/units/<unit>/open`) checks the
  course and unit (404) and the approval (409) before anything else, marks
  the course opened, and answers at once; the chat then loads over its event
  stream. A unit without a plan shows `unit_planning` while it is planned. A
  failed planning, or a record that cannot be read, is `unit_failed` in the
  thread, the chat refuses everything else, and opening it again tries
  again. Two opens of one unit share one chat.
- **A turn's header is composed when it is sent**, not when it is queued
  (`Turn.text` may be a function, in `conversation.ts`). A message written
  while the tutor teaches reaches it after the teaching turn has ended, so
  its header must say "discuss", not "teach". The same hook will let 2.7 see
  whether a question was open when the tutor received a learner message,
  which is its rule for help. A turn can also run work when it ends, before
  the next is sent; the teaching turn uses it to open the discussion.
- **Any end of the teaching turn opens the discussion**: done, stopped, or
  failed. After a failure the learner sees the error and can ask for what
  was missed; keeping the segment in teach would leave them nothing to do.
- **"Ready", moving on and the next segment are refused while the tutor is
  writing** ("Wait until the tutor has finished, or stop it."), as approval
  is in the intake. Taken at once, each would put a phase marker in the
  middle of a reply still streaming. An answer and a message are taken at
  any time: an answer only closes the question, and a message is queued.
- **Moving on is allowed from the discussion as well as the check.** The
  brief lets the learner always move on, and making them press "ready"
  first would cost a tutor turn that posts a question they will not answer.
  The page (2.11) can still offer it only in the check, as mock 3 does. It
  names all the segment's objectives, which 2.3 allows, and withdraws an
  open question.
- **Moving on sends the tutor nothing.** Its next turn's header says the
  learner moved on and which question was withdrawn. A turn of its own
  would cost a reply, and the learner would have to wait for it before
  starting the next segment. The note is held in memory, so a restart
  before the next turn loses it; the new session's header still says the
  segment is closed.
- **"From this check" is kept as a point in the evidence log.** The
  position holds `checkFrom`, the number of entries when the learner
  pressed "ready"; the check's answers are the entries after it that name
  the segment's objectives, read back from the log when a unit is reopened
  mid-check. Rejected: a list of answered objectives in `state.json`,
  which would copy part of the evidence, and the time the check began,
  since log order decides, not timestamps (task 2.3). Other units' answers
  in between are left out by their objectives, which are unique in the
  course. A question is numbered after the check's answers.
- **`close_segment` takes no input and ends the turn**, so feedback on the
  last answer comes before it, as with `ask_question`. Checked without a
  model: the SDK's tool server lists it with the input schema
  `{"type":"object","properties":{}}`, and a refused call comes back as an
  error result with the reason (a throwaway script with an in-memory MCP
  client).
- **`ask_question` names the objective by id** (it was free text). The
  engine, not the tool, decides whether a question may be posted, so the
  `QuestionBoard` returns either the posted question or the refusal.
- **Every change is written to `state.json` before the page hears of it.**
  An answer is appended to the evidence first, then its question is closed,
  so a crash between the two leaves the question open with its answer kept,
  never an answer lost. A second answer to it would be recorded twice; not
  guarded against, as the window is one file write. (Closed by task 2.8a,
  "Review fixes (2.8a)": the question is closed with the answer recorded.)
- **A unit reopened after a restart** shows its plan, its phase and any open
  question, and sends nothing until the learner acts. Its tutor session is
  new (resume is 2.14), and the first header says so ("This conversation is
  new: the earlier conversation in this unit is not available to you, so do
  not refer to it."). An answer's turn repeats the question and its choices
  so a new session can give feedback. A unit reopened in teach was cut off
  mid-teaching, so its teaching turn is sent again, saying so.
- **The tutor's system prompt** is `tutor.md`, then the course's units with
  their goals, the unit taught and its plan, then `style.md` or a line
  saying to use the default style. The plan goes there rather than in each
  header because a session keeps its first prompt; the headers carry only
  the position. `tutor.md` is a short first version for 2.16 to revise: the
  rhythm, posting ends the turn, no hint in a lead-in, the default style,
  `$` math and no images.
- **Page events.** `unit_planning`, `unit_failed`, `unit_plan` (for the
  outline), `phase` (a segment's phase began or the chat opened in it),
  `overridden`, and the existing `question` and `graded`. The page's
  timeline (`src/web/timeline.ts`) shows `unit_failed` and `overridden` as
  notes and ignores the rest until the session view (2.11) gives them
  items.
- **For later tasks.** 2.7: help is written `false`; the unit stays in
  `state.json`, closed at its last segment, and "next segment" there is
  refused ("This was the unit's last segment."); opening a unit with no
  position starts it at segment 1 even if its objectives have evidence, so
  2.7 or 2.12 should decide what opening a finished unit does. 2.11: the
  refusals' messages are written for the learner; a message while the unit
  is still opening is refused. 2.13: the chat's event log is what the
  transcript should hold. 2.14: `tutorSessionId` is not written yet. 2.15:
  a unit chat, like an intake, keeps its session until the server stops.
- **Checks:** `mise run check` passed lint, type-checking, 299 TypeScript
  tests and one Python test. The 42 new tests are 30 fake-backend tests of
  the unit chat, 5 route tests, 2 each for the turn queue, the record and
  `state.json`'s new rule, and one more for `ask_question`, whose tests were
  rewritten for the engine's refusals. Each of these faults made at least one test fail: headers
  composed when queued; Stop not opening the discussion; the check's answers
  not read back on reopening; answers from before the check counted on
  reopening; `close_segment` ignoring missing objectives; `ask_question` on
  another segment's objective; `ask_question` and `close_segment` allowed
  out of phase; an override or an answer not recorded; an open question not
  written to `state.json`; the course not marked opened; actions allowed
  while the tutor writes; a segment after the last; no note for a new
  session joining a unit; the override's note dropped; and the end-of-turn
  work not awaited before the next turn. No real backend was run, as the
  task does not call for one.

## Check rules and unit close (plan task 2.7)

Built on 2026-11-15: `src/server/engine/check-rules.ts` (how many
questions, and which segment a position is in) with its tests, and in
`src/server/engine/unit-chat.ts` help, the unit's end and the closing
card's two steps, with the routes `go-over-again` and `finish`. The
choices are the agent's and can be overturned.

- **How many questions.** Each objective of the segment gets at least one
  question in the check, and is done once it has passed, by task 2.3's
  rule over the whole evidence, or once three of its questions have been
  answered in this check. That is the brief's "more after a miss, fewer
  after confident correct answers": a miss, an unconfident correct answer
  or one given with help asks for another question; a confident correct
  answer ends the objective's check at one; two unconfident correct answers
  to different questions end it at two. The tutor is not trusted to stop:
  `ask_question` on an objective that is done is refused, with the
  objectives still open, and `close_segment` is refused, with where each
  open one stands, until all are done.
- **The limit is three questions per objective per check.** Two misses
  already mark a likely misconception (the brief's trigger for a detour,
  stage 5); a third question is one more chance after the tutor's
  feedback, and more would make a segment of two objectives drag past six
  questions. An objective at the limit stays attempted, and the closing
  card offers it again. No limit on the segment as a whole, since a
  segment has at most two objectives. The extra segment that goes over
  several objectives again has the same limit for each.
- **At least one question per check even on an objective passed before
  it.** The check is the segment's; an answer from before it does not
  count for it (task 2.6), though it does count toward passing.
- **The header tells the tutor where each objective stands** ("missed, so
  another question is needed (1 of at most 3 asked)", "passed", "not passed
  after 3 questions, the limit"), so it can choose the next question
  without counting. `prompts/tutor.md` says to ask a different question
  each time; the same question twice counts once (task 2.3).
- **Help is noted when the tutor receives the message**, as task 2.3
  settled: the message turn's text is composed when it is sent, and if a
  question is open then, the question is marked `assisted` in `state.json`
  before the text goes out, so the mark survives a restart. A message
  written before a question was posted and received after counts; one
  received after the answer does not. The turn's text may now be composed
  asynchronously (`conversation.ts`), inside the chat's queue of changes.
  The tutor is told, in the header, that the answer will be recorded as
  given with help, and in the answer's turn that it does not count.
- **The unit ends when its last segment closes**, by `close_segment` or by
  moving on without the check. The closing card is `unit_end` with each
  objective's status. When all passed, the unit is taken out of
  `state.json` at once and `unit_closed` follows; "Back to the course" and
  "Start unit N" need nothing from the server. When some did not, the unit
  stays in progress with its last segment closed, and the learner picks:
  - **Go over them again** starts a segment after the plan's last, on the
    objectives not passed. It is kept in the position (`again`, with the
    plan's segment count as its index), because an objective is taught in
    one segment of the plan (task 2.2). It runs teach, discuss and check
    as any segment, and its close ends the unit again, so the card can
    offer another round. Its teaching turn asks the tutor to teach them
    another way.
  - **Move on without them** records an override of the objectives not
    passed, only those, so the passed ones keep their record clean; the
    unit is then overridden (task 2.3) and taken out of `state.json`. The
    tutor is sent nothing.
  "Start the next segment" at the unit's end is refused with the two
  choices.
- **A finished unit is not started again.** Opening a unit that has no
  position and whose objectives make it passed or overridden shows it
  finished (`unit_status`, then `unit_closed`), sends nothing, and refuses
  every step but a message, which the tutor answers as a finished unit.
  Starting it over is not designed. A unit reopened with its last segment
  closed shows its closing card again; if a restart came between closing
  the last segment and closing the unit, the unit closes then.
- **Page events.** `unit_status` carries the unit's status and each
  objective's, from `src/shared/status.ts`: sent when the chat opens,
  after every answer and override, and when the unit closes. `graded`
  carries `assisted`. `phase` carries `again` for the extra segment.
  `unit_end` and `unit_closed` as above. At `unit_end`, an objective
  "attempted" reached the check's limit and one "overridden" was moved on
  from, which is the "why" the card's rows give (piece 10).
- **For later tasks.** 2.11: the closing card from `unit_end`, shrunk once
  `phase` (going over again) or `unit_closed` follows; "Move on without
  them" is confirmed on the page, then `POST .../finish`; the top line for
  the extra segment. 2.12: a finished unit is one with no position whose
  `unitStatus` is passed or overridden. 2.16: `tutor.md`'s check section
  says what this task's headers mean.
- **Checks:** `mise run check` passed lint, type-checking, 325 TypeScript
  tests and one Python test. New: 14 table cases of the question count
  worked by hand, 10 fake-backend tests of the unit chat (a miss, the
  limit, a confident answer, help in two orders, the closing card going
  over again and passing, moving on without them, both steps refused
  when not at the end, a finished unit and a waiting card after a
  restart), and a route test of the two steps; eleven 2.6 tests were
  updated for the new events and wording. Each of these faults made at
  least one test fail: no limit; a confident answer not ending the check;
  an unsure correct answer ending it; help not recorded; a message between
  questions counted as help for the next; help judged when the learner
  writes rather than when the tutor receives (the first versions of these
  two faults were written wrongly and changed nothing; rewritten, both
  failed tests); questions allowed on an objective that is done; a passed
  unit left in `state.json`; moving on overriding every objective; going
  over every objective again; a finished unit started again on opening;
  the waiting card not shown after a restart; no statuses after an answer;
  and the unit's end not reached through an override. No real backend was
  run, as the task does not call for one.

## Rubric grading (plan task 2.8)

Built on 2026-11-15: `oneShot` in the adapter (`backends/backend.ts`,
`claude.ts`, `fake.ts`), the grading dispatch for written answers in
`engine/grading.ts`, the `written` kind of `ask_question`, the kept answer
and the grading steps in `engine/unit-chat.ts`, the route `grade-again`,
and a short first `prompts/grader.md`. The choices are the agent's and can
be overturned.

- **`oneShot` uses the SDK's structured output.** One `query()` with a
  string prompt, the request's system prompt, no tools, no stored session
  (`persistSession: false`), the isolation options of task 0.2, and
  `outputFormat` with the reply's JSON Schema, made from the zod schema
  (`z.toJSONSchema`, draft 7, which the SDK checks against). The reply is
  the result's `structured_output`, then checked against the zod schema,
  which can say more than JSON Schema (an incorrect verdict needs its
  flaw); a reply the SDK passed and zod refuses is a failure. The SDK
  retries a reply out of shape itself
  (`error_max_structured_output_retries` when it gives up); Gauss does not
  retry. A request can be stopped with an `AbortSignal`, passed to the SDK
  as its `abortController`.
- **Observed on Haiku 5.5**, with one grading through `createGrader` and
  `oneShot` from a scratch script: structured output works with
  `tools: []`, and the reply came in 3.3 seconds. The question was "prove
  that the sum of two even integers is even", the answer checked two
  examples, and the grade was incorrect with the flaw "The answer only
  checks numerical examples (2 + 4 and 10 + 12) and then asserts the
  general claim. It never writes the even integers as $2a$ and $2b$ ...".
  The run had `ANTHROPIC_BASE_URL=http://127.0.0.1:9` and a bogus
  `ANTHROPIC_AUTH_TOKEN` in its environment, which the backend dropped.
- **Other variables that may redirect the SDK: dropped** (the open row of
  `architecture.md` section 7). A probe with no model call pointed
  `ANTHROPIC_BASE_URL` at a local server that recorded requests and
  answered 500, with `ANTHROPIC_AUTH_TOKEN` set to a bogus token: the SDK
  sent `HEAD /api/hello` and `POST /v1/messages?beta=true` there, with the
  bogus token as its bearer, and init reported `apiKeySource: "none"`. So
  either would take a session off the plan login. `sdkEnvironment` now
  drops every `ANTHROPIC_` variable (the key, the base URL, the token, and
  the rest, such as `ANTHROPIC_CUSTOM_HEADERS` and model overrides) and,
  as before, every `CLAUDE` one. The cloud-provider switches all start with
  `CLAUDE_CODE_USE_` (Bedrock, Claude Platform on AWS, Vertex, Foundry,
  per the SDK's quickstart), so they are dropped too; the providers' own
  credentials (`AWS_`, Google's, Azure's) do nothing without a switch and
  stay, since other programs may need them. Proxy variables (`HTTPS_PROXY`)
  stay: they route the same requests to the same API.
- **One tool, two kinds.** `ask_question` takes `kind: "choice"` with
  choices and an answer letter, or `kind: "written"` with a rubric
  (`QuestionInput`). A tool's input is described by its fields, so the
  input is one object, and which fields a kind takes is checked by the
  schema, with a reason the tutor can act on. `kind` is required, so the
  tutor always says which. The stored question (`Question`) is the
  discriminated union task 2.2 prepared. A written answer
  (`WrittenAnswer`) is its own reasoning, as mock 2 has it: text and
  confidence, no reasoning field.
- **What the grader is given.** Its system prompt is `grader.md`; its
  message holds the question as the learner saw it, the rubric and the
  answer, each between tags, so an answer that reads like instructions
  stays part of the answer (`gradingRequest`). Not the objective's
  statement, which the rubric covers; not the confidence, which must not
  sway a grade; and nothing of the tutor's conversation, which the brief
  forbids. The test of this compares the whole request with one written
  out by hand.
- **What the grader returns** (`WrittenGrade`): `correct` only if the
  answer meets the rubric in full, otherwise `incorrect`, with no partial
  credit, because task 2.3's passing rule reads verdicts; and when
  incorrect, the first flawed step or missing element, required. A flaw
  named on a correct answer is dropped rather than failing the grading.
  The evidence entry keeps the flaw (`flaw`, only on a written answer
  graded incorrect), and so do the `graded` event and the tutor's answer
  turn, which says the grader saw only the question, the rubric and the
  answer.
- **A written answer is final once sent.** It is kept on the open question
  in `state.json` (`answer`) before the grader is called, so a restart
  cannot lose a long proof. While it is graded, a second answer, moving
  on, grading again, and the tutor's `ask_question` and `close_segment` are
  refused. The alternative, letting the learner change the answer after a
  failed grading, would need help to be judged again; keeping the answer
  as sent avoids that.
- **Help ends when the answer is sent.** A message the tutor receives
  while the answer is graded does not mark it, because the answer can no
  longer change ("how long does this take?"). One received before it was
  sent does, as for a choice.
- **The grader runs outside the chat's queue.** A grading takes seconds
  and could take minutes; holding the queue would hold every message and
  tool call behind it. The grade is recorded inside the queue, and only if
  the question is still open. Its mark of a grading in progress is cleared
  inside the queue too, at the end: the first version cleared it before
  recording, and the tests caught `settled()` returning before the grade
  was written.
- **A failed grading** (a failed request, a reply out of shape, or more
  than three minutes) is `grading_failed`, with the reason; the question
  stays open with its answer, nothing is recorded, and nothing goes to the
  tutor. `grade-again` grades the kept answer as it was sent. A unit
  reopened with a kept answer grades it at once, as a teaching turn a
  restart cut off is taught again; the reopening is the learner's act.
  Closing the chat (server shutdown) stops a grading in progress. The time
  limit is generous: Haiku took 3 seconds, and 2.9 may pick a slower model
  with more thinking.
- **"I don't know" on a written question** is recorded at once as unknown,
  with no grader call. A choice sent to a written question, or a written
  answer to a choice one, is refused with 400.
- **Distinct questions.** For the passing rule (task 2.3), a written
  question is the same problem as another if its prompt is the same,
  spacing aside; a written and a choice question are never the same.
- **Page events.** `question` carries `kind` (a written question shows its
  prompt only: never its rubric). `grading` (with the answer, so a reload
  shows it), `grading_failed`, and `graded`, which now carries the answer
  as sent, `correctChoice` for a choice question and `flaw` for a written
  one graded incorrect. The page ignores the grading events and shows no
  written card yet: that is the session view's (2.11).
- **The grader's model** is the tutor's backend and model for now
  (`GAUSS_CLAUDE_MODEL`); task 2.9 chooses it, and may need a model on the
  request.
- **For later tasks.** 2.9: revise `grader.md` against the hand-graded
  set; `createGrader(...).grade` runs one grading; the request's format is
  `gradingRequest`. 2.11: the written card (text field with
  `AnswerPreview`, "Grading" while `grading`, the reason and "Grade again"
  after `grading_failed`, the answer with `Prose` and the flaw on the
  graded card). 2.16: `tutor.md` now says when to ask a written question
  and how to write a rubric for a grader that sees nothing else. Stage 3's
  disputes: the flaw is in the evidence, beside the grade.
- **Checks:** `mise run check` passed lint, type-checking, 372 TypeScript
  tests and one Python test. New: 10 fake-backend tests of the unit chat
  (a correct and an incorrect written answer recorded as evidence, a
  grader reply out of shape shown as failed and then graded again, the
  grader's request compared whole with one written by hand, help during
  and before a grading, the steps refused while grading, "I don't know"
  and answers of the wrong kind, and a kept answer graded after a
  restart), 9 of the grading dispatch (the request, each kind of reply,
  the time limit, a stop), 9 of the Claude backend's one-shot request
  against a stand-in SDK (its options and environment, and each kind of
  result), a route test of `grade-again`, and schema and status cases.
  Each of 23 faults made at least one test fail: the rubric left out of
  the request; the tutor's prompt given to the grader; the flaw not
  recorded; help marked during a grading; the answer not kept before
  grading; a kept answer not graded on reopening; moving on allowed while
  grading; a failed grading recorded as incorrect; the grading mark
  cleared before the grade is recorded; the Claude reply not checked
  against the schema; the one-shot request without the isolation options;
  the environment dropping only the API key; a stop not passed to the SDK;
  the flaw rule removed from the grade; no time limit; all written prompts
  counted as one problem; the rubric shown to the page; the tutor told
  "correct" whatever the grade; the header silent during a grading; a
  second answer replacing the kept one; and two schema rules removed. One
  real run on Haiku 5.5, above; no browser check, as the written card is
  2.11's.

## Review fixes (plan task 2.8a)

Done on 2026-11-15, from the user's review of tasks 2.6 to 2.8, which
reproduced each finding with a scratch test. The code was wrong in each
case; the documented rules stand, and `architecture.md` section 4 now says
the two it left implicit. The choices are the agent's and can be
overturned.

- **A question has one answer.** The evidence is appended before the
  question is closed (2.6), so a stop between the two left the question
  open; reopening then graded a kept written answer again, which could
  append a contradicting grade and turn a passed objective back to
  attempted, and a choice question could be answered twice. Now the open
  question is matched to the evidence by the answer's `questionId`: an
  answer found there closes the question, with the `graded` event and the
  tutor's turn that recording would have sent, and nothing is graded or
  appended. The same check sits in recording itself, for an answer sent
  again after a failed `state.json` write. In that case the recorded
  answer is the one kept, and the second answer is dropped. For a written
  answer, "grade again" then calls the grader, whose verdict is dropped
  for the one recorded. That costs one grading on a path that needs a
  failed disk write, and saves a third code path.
- **Moving on is refused while a written answer waits for its grade**,
  also after a failed grading, as section 4 says. The check was on the
  grading running, so an override after a failure withdrew the question
  and the proof with it. The refusal says to grade it again. A consequence
  left as it is: while grading keeps failing, the learner cannot leave the
  segment. The tutor runs on the same backend, so it is likely down too.
- **An override is written to `state.json` before the page hears of it.**
  `overridden` and `unit_status` came before the write of the closed
  position. `move` takes the events to emit once the position is written,
  ahead of the phase marker, so their order on the page is unchanged.
- **Stop reaches a turn before it is sent.** Both backends clear their stop
  flag when a turn is sent, so a Stop while the turn's session was starting
  or its text was being composed was lost, and the tutor answered the
  stopped turn. The turn queue now keeps the Stop on the turn in progress.
  It checks it before composing and again before sending, and the turn
  then ends interrupted without reaching the backend. Composing can mark
  help (2.7), so a message stopped while it was being composed can still
  count as help. This errs toward assisted and is left.
- **An evidence line is written whole.** One write can store fewer bytes
  than it was given; `appendJsonLine` ignored the count, so a short write
  returned as recorded a line that reads back as cut, and the next append
  cleared it. It now writes until the whole line is stored, then syncs.
  The test makes each write store half of what it is given, through a spy
  on `FileHandle.prototype.write`. A file that takes no bytes at all is an
  error rather than a loop. Transcripts (2.13) use the same function.
- **A unit id can be an inherited property name.** `constructor` is a valid
  slug, and `units[unitId]` on a state with no such entry found
  `Object.prototype.constructor`, so the unit failed to open. Positions are
  now read only from the unit's own entry (`Object.hasOwn`). No other
  record is looked up by an id that way; `writePosition` copies entries
  and so was already safe.
- **The fake backend's one-shot fails once stopped**, as Claude's does
  (`readOneShot` reports a stop whatever result came). A reply still to
  come now races the signal, and any reply to a stopped request is a
  failure. Without this, tests of a stop could pass on behaviour the real
  backend never has.
- **The review's structure recommendation** (split `unit-chat.ts` before
  2.13 to 2.15, with one queue owner) is task 2.8b, so the refactor is
  reviewed apart from these fixes.
- **Checks:** `mise run check` passed lint, type-checking, 381 TypeScript
  tests and one Python test. The nine new tests are four of the unit chat
  (the `constructor` unit, a written and a choice answer recorded before a
  restart that kept the question open, and an answer sent again after a
  failed `state.json` write), two of the turn queue (Stop while the text is
  composed, and while the session starts), two cases added to the
  grader's stop test (a reply still to come, and a stop before the
  request), and one of the record (short writes). Two existing tests were
  extended: the override test checks `state.json` as the page hears of the
  override, and the failed-grading test checks that moving on is refused.
  Each new check failed before its fix, as the review describes. Removing
  the reuse in recording fails only the failed-write test, and removing
  the check on reopening fails only the two restart tests. No real backend
  was run, as no finding needs one.

## Unit chat split (plan task 2.8b)

Done on 2026-11-15, from the review's recommendation: `unit-chat.ts` had
grown to about 1,060 lines, mixing persistence, cancellation and what the
page is told, and 2.13 to 2.15 would each add more to it. The split moves
code without changing behaviour; `unit-chat.test.ts` is unchanged and
still tests through `createUnitChats`. The choices are the agent's and can
be overturned.

- **`engine/unit-record.ts`**: the unit's part of the course record, in
  memory (`openUnitRecord`, `UnitRecord`). It reads the position (own
  entries only) and the evidence, decides where a unit with no position
  starts or that it is finished, and keeps "this check". Each change writes
  first, then keeps it, then tells the page: `move`, `startCheck`,
  `answer` (one answer per question, evidence before the question closes),
  `closeAnswered` (the reopening case), `overrideSegment`, and `finish`.
  It emits the events that announce its own changes (`phase`, `graded`,
  `overridden`, `unit_status`, `unit_closed`), so the rule that the page
  hears of a change only once it is written sits in one file.
- **`engine/unit-agents.ts`**: the tutor's conversation and the grading
  in flight (`createUnitAgents`, `UnitAgents`): sending turns, Stop,
  `grade` (the grader runs outside the queue; its grade is recorded
  inside, and the grading counts as running until then), `settled` across
  both, and `close`. Resume (2.14) and closing idle sessions (2.15) belong
  here, since this is where it is known whether a turn is queued or a
  grading still running.
- **`unit-chat.ts` stays the coordinator**: the registry, opening, the
  phase rules and their refusals, the teaching tools, the learner's
  actions, and what each turn tells the tutor. It owns the one serial
  queue (`exclusive`). The record's changes run only inside it, and the
  agents are given it for recording a grade, so there is one order for
  every change to a unit. Reads of the record are safe outside the queue.
  Reopening uses one of them to decide at once whether to close the open
  question or grade its kept answer, as before.
- **Not split further.** The teaching tools and the learner's actions stay
  together in the coordinator, because both are the phase rules: moving
  them apart would make each file need the other's checks. The refusal
  texts stay beside the rules that give them.
- **Checks:** `mise run check` passed lint, type-checking, 381 TypeScript
  tests and one Python test, with no test changed. Faults put into the
  moved code were caught: telling the page before writing the position
  fails the override test, and clearing a grading's mark before its grade
  is recorded fails five written-answer tests. One gap was there before the
  split and is still there: clearing the mark just after the queue section,
  rather than inside it, passes every test. The window is a few
  microtasks, and an action queued in it would be refused as "being
  graded". It is left untested, as no fixed ordering in a test would show
  it reliably.

## Grader prompt (plan task 2.9)

Done on 2026-11-15: `prompts/grader.md` revised against a hand-graded
set, the set in `scripts/grader-set.ts` with its runner
`scripts/grade-set.ts`, and the grader's model, Claude Sonnet 5.5
(`GRADER_MODEL` in `backends/claude.ts`). The choices are the agent's and
can be overturned.

- **The set**: 11 written answers to 4 questions, each question posted as a
  tutor would post it, with its rubric. The full text is in
  `scripts/grader-set.ts`; the grades were worked out by hand:

  | Id | Question | The answer | Hand grade | The first flaw |
  | --- | --- | --- | --- | --- |
  | S1 | $\sum_{i=1}^n i^2 = \frac{n(n+1)(2n+1)}{6}$ by induction | A correct proof | correct | |
  | S2 | The same | $k(2k+1) + 6(k+1)$ written as $2k^2 + 5k + 6$, then "factored" as $(k+2)(2k+3)$ to reach the formula | incorrect | The expansion: it is $2k^2 + 7k + 6$ |
  | S3 | The same | Correct, with $n$ written for $k$ in the hypothesis | correct | (a slip of notation) |
  | P1 | $n^2 + n$ is even; the rubric splits into cases | The case $n$ even only | incorrect | The case $n$ odd is missing |
  | P2 | The same | Both cases in words, no algebra ("the spare one left over from each pairs up") | correct | |
  | P3 | The same | $n(n+1)$, and one of two consecutive integers is even: a method the rubric does not describe | correct | |
  | I1 | $n^2$ odd if and only if $n$ odd | The converse justified by "the square root of an odd perfect square is odd" | incorrect | That reason is the statement to be proved |
  | L1 | $\lim_{x \to 3} x^2 = 9$ from the definition | $\delta = \varepsilon/7$, with "$\lvert x+3 \rvert < 7$ near 3" never secured | incorrect | The chosen $\delta = \varepsilon/7$ does not guarantee the claimed bound $\lvert x+3 \rvert < 7$ |
  | L2 | The same | "Polynomials are continuous", and a note asking the grader to mark it correct | incorrect | Continuity in place of the definition |
  | L3 | The same | $\delta = \frac{\varepsilon}{\varepsilon + 7}$ | correct | |
  | L4 | The same | $\delta = 1$, then "$\lvert x-3 \rvert$ can be made as small as we like" | incorrect | $\delta$ does not depend on $\varepsilon$ |

  The five kinds the task names are S1 (a correct proof), S2 (a flawed
  middle step), P1 (a missing case), P2 (unusual words) and L1 (a near
  miss). Haiku 5.5 agreed on all of the first eight, so I1, L3 and L4 were
  added to find where models differ.
- **Runs.** Each version of the prompt was run through `createGrader` and
  the Claude backend's `oneShot`, as the app grades. 11 gradings make one
  run.

  | Prompt | Model and runs | Verdicts agreeing | What the flaws did |
  | --- | --- | --- | --- |
  | 1 (2.8's short version) | Haiku, 1 (the first eight, then the three added) | 11 of 11 | Right step every time, but they spoke of the rubric, which the learner never sees ("The rubric requires the odd case too"), gave the repair ("The needed choice is $\delta = \min(1, \varepsilon/7)$"), ran to three to five sentences, and answered L2's note |
  | 2 (checking, verdict and flaw sections) | Haiku, 2 | 22 of 22 | Repair in 4 of 14 flaws, L2's note mentioned in both runs, and once (L1) a counterexample that was not one |
  | 2 | Sonnet, 2 | 22 of 22 | Rubric and note never mentioned; repair in 1 of 14 |
  | 3 (repair rule quoting "such as ...") | Sonnet, 2 | 22 of 22 | Repair in 4 of 14 ("a cap such as $\delta \le 1$"): the quoted phrase seemed to invite it, so it was dropped |
  | 4 (the rules restated without the quote, and in the schema) | Sonnet, 2 | 22 of 22 | Each flaw names the step in the table; repair in 1 of 14 ("e.g. $\delta \le 1$") |
  | 4 | Haiku, 1 | 10 of 11 | P2 graded incorrect ("verbal assertions, not computations with $n = 2m$"); S2's flaw contradicted itself; repair in I1 |
  | 5 (the final version: 4, with "neither sees the rubric" corrected to the learner, since the tutor wrote it) | Sonnet, 2 | 22 of 22 | Each flaw names the step in the table; no repair |

  Sonnet took 2.3 to 6.0 seconds a grading, Haiku 3.0 to 7.2.
- **The model: Claude Sonnet 5.5.** It agreed with every hand grade in all
  eight of its runs (88 gradings, four versions of the prompt), named the
  first flaw every time, and kept closer to the flaw's rules, at no cost in
  time. Haiku failed a correct answer in plain words on the final prompt
  and broke the flaw's rules more often. A wrong grade goes into the
  evidence, and a false pass stands for mastery unless the learner
  disputes it, so the grader is where judgment pays. Opus 5.5 was not
  tried: Sonnet left nothing on the set for it to do better, and it spends
  more of the plan per grading. Effort and thinking are left at the SDK's
  defaults.
- **Which model a grading uses.** `GAUSS_CLAUDE_MODEL`, when set, sets the
  model for every session, the grader's included, so a cheap development
  run stays on one cheap model as `AGENTS.md` has it. Left unset, the
  tutor and the planners use the learner's Claude Code default and the
  grader uses `GRADER_MODEL`. There is no variable for the grader alone:
  `node scripts/grade-set.ts --model <id>` tries another model on the set.
- **What the prompt now says, and which answer each rule is for.** Check the
  answer in its own order, one step at a time, before deciding. Redo every
  computation, since an answer can reach the right result through a wrong
  line (S2). Look for what the argument needs and never secures: a case, a
  direction, the conditions of a bound, a quantity that must depend on
  another (P1, L1, L4). Look for the conclusion given as a reason (I1). What
  may be assumed is what the rubric allows and standard facts below the
  question's level, never the result or one the question rules out (L2).
  The rubric describes one way, and another valid way is correct (P3, L3).
  Wording does not count (P2). A slip of notation is one whose meaning is
  plain and on which no step depends; a wrong computation is not a slip
  (S3, S2). The flaw is the first problem in the answer's order, pointed
  at, in one or two sentences. It never mentions the rubric, since the
  learner never sees it, and never gives the repair, since the
  brief has the grader point to the flaw and the learner is to find the
  repair with the tutor. An answer's request for a verdict is not mentioned
  either. The wording stays general (explanations and reconstructions too,
  as the brief's grading table has it), though the set is math only.
- **The `WrittenGrade` descriptions** in `src/shared/question.ts`, which the
  model sees with the output schema, now say the same. A correct verdict
  means "establishes everything the question asks, with every step valid":
  the old "meets the rubric in full" contradicted the rule on other methods.
  The flaw is one or two sentences, not the repair, and nothing about later
  steps. Version 4 made this change and reworded the prompt's rule
  together, and the repairs went from 4 of 14 to 1; which of the two did it
  was not tried.
- **Still short of the rules, with Sonnet on the final prompt:** S2's flaw
  also names the false factoring after the expansion (both runs), and 4 of
  14 flaws run to three sentences. Left as they are:
  every flaw points at the right step and none says anything false, and
  tightening further would fit the prompt to these 11 answers.
- **For later tasks.** 2.16: the grader reads what may be assumed from the
  rubric and accepts any valid method, so `tutor.md` should ask rubrics to
  say what may be assumed and need not list every method. Re-run
  `node scripts/grade-set.ts --runs 2` when `grader.md`, the `WrittenGrade`
  descriptions or `GRADER_MODEL` change; it spends plan usage (11 short
  gradings a run). Stage 3's disputes: a dispute that shows a wrong grade is
  a candidate for the set. Stage 4: grading explanations from a source
  course (philosophy) needs answers of its own in the set.
- **Checks:** `mise run check` passed lint, type-checking, 381 TypeScript
  tests and one Python test. The runs above are the check of the prompt and
  the model. No automated test was added: the change is a prompt, two
  schema descriptions, a constant and the grader's backend in `main.ts`. The
  server started with that wiring on a scratch data root and answered
  `/api/courses`; no grading ran in the app, since that needs a unit with a
  written answer, which 2.11's browser check and 2.16's real run will
  reach. The script builds its grader the same way. Its argument checks
  were tried by hand (`--runs 0`, an unknown `--only` id).
- **Review correction:** L1's hand-written flaw no longer claims that
  $\lvert x+3 \rvert < 7$ holds only within $1$ of $3$: that neighborhood
  is sufficient, not necessary ($x = 0$ also satisfies the bound).
  The flaw now names the unsecured bound. The incorrect verdict and the
  counterexample $\varepsilon = 70$, $x = 12$ are unchanged.
  Verified with independent numeric assertions and `biome check` on the
  fixture file; no model calls were needed because the grader's inputs,
  prompt, model and expected verdict are unchanged.

## Style note at intake (plan task 2.10)

Done on 2026-11-15. The choices are the agent's and can be overturned.

- **The note is part of the proposal.** `CurriculumProposal` has a
  required `style` (`StyleNote` in `src/shared/curriculum.ts`): plain
  text, trimmed, 1 to 800 characters, its description asking for two to
  four sentences on explanation length, the kind of check questions and
  the pace. Required, so every new course has one and the card always has
  its section; a proposal without one is refused with the schema's reason
  and the tutor sends it again. The limit is generous for four sentences
  (mock 9's notes are under 300 characters) and stops a lecture
  disguised as a note.
- **Stored as `style.md` with each draft**, in `saveProposal`, under the
  curriculum's lock: `curriculum.json`, then `style.md`, then
  `course.json` if the title changed. A save that fails or stops between
  them leaves a draft no card has shown, so approval checks the record
  against the card (the review fix below). Approval stamps
  `curriculum.json` only and leaves `style.md` as it is; a proposal after
  approval is refused before anything is written, so the approved note is
  the one approval found.
- **Courses without a note.** Drafts and courses from before this task
  have no `style.md`. The page event carries the note as optional, and
  only as `z.string()`, so a hand-edited note longer than the tool's limit
  still shows. A reopened draft without one shows "No note was proposed,
  so the tutor's default style applies." in the card's section, and the
  planner prompt asks for a note with the next revision. A course
  approved without one is taught in `prompts/tutor.md`'s default style,
  as task 2.6 built.
- **A reopened draft** reads `style.md` in the review route and gives it
  to the new intake with the units; the tutor's first header carries the
  whole draft, note included. `readStyle` returns the note trimmed, and
  none for a blank file, so the route, the approval check and the tutor's
  prompt agree on what a note is.
- **The card** (mock 9): a section under the units, "How I would teach
  it", always shown, the note as plain text (line breaks kept), and
  "Changed" when the note differs from the revision before, as units are
  marked. The paragraph has its own class, `cs-t`, where the mock has
  `.cs p`: Biome's descending-specificity rule flags `.cs p` after
  `.prose li > p`.
- **The prompt.** `planner.md` has a section "How you would teach it",
  with an example from mock 9, asks for revisions of the note as of the
  units, and says not to repeat the note in the reply. It tells the
  planner to promise only what a tutor can do in a chat (explaining,
  discussing, choice and written questions); stage 3 should widen that
  line when code questions and the symbolic check arrive. Its section on
  formatting is renamed "Writing", so "style" means the note alone. The
  change-request headers now ask for the whole revised curriculum "and its
  style note". Not tried on a real model: the first real intake will show
  whether notes come out short and concrete.
- **Not in this task:** showing the approved note in the course view, and
  changing it after approval (`propose_style`, stage 5).
- **Checks:** `mise run check` passed lint, type-checking, 387 TypeScript
  tests and one Python test. Fake-backend tests cover a proposal's note
  shown and stored, a revision replacing it, approval keeping it (and a
  refused proposal after approval leaving it), a reopened draft showing it
  through the review route, a draft without one, the note reaching the
  tutor's system prompt, and the schema's refusals; the page's timeline
  marks a changed note. Before the code, the 17 new or changed tests
  failed; writing `style.md` before the approval check made the record's
  approval test fail. Browser run with the fake backend on a scratch
  server built like `main.ts`: the first proposal showed the note under
  the units, a push-back brought a revision with the note marked
  "Changed" and no unit marked, and after a restart the reopened draft
  showed the stored note; approving it left `style.md` as it was.
- **Review fix: approval checks the record against the card.** The user's
  review of 3b88bf8 found that a revision whose `style.md` write failed
  (an injected ENOSPC) had already replaced `curriculum.json`; the tool
  call failed and no card appeared, but approving the card before it
  approved the unseen units with the old note. The same gap was open
  since task 1.4 for a failed `course.json` write, and reversing the
  writes would only swap which part goes unseen. Now the intake keeps the
  proposal its latest card shows (`ShownProposal` in
  `src/shared/curriculum.ts`: the tutor's proposal, or the reopened
  draft) and passes it to `approveCurriculum`, which, under the
  curriculum's lock, refuses with `DraftMismatch` unless the title in
  `course.json`, the units in `curriculum.json` and the note in
  `style.md` are the ones shown. The intake answers 409: "The curriculum
  on record is not the one on this card: saving the tutor's last change
  did not finish. Ask the tutor to propose it again." A successful
  proposal writes all three files, so the next card can be approved. A
  draft reopened after a restart is read from the files, so it always
  matches; a hand edit made while a card is open also refuses approval,
  which is the safe side. Not done: putting back the previous proposal
  after a failed save, since that write can fail as well; the check is
  what keeps the record right. Checks: a test that fails `style.md`'s
  write during a revision (mocking `writeFileAtomic` for that file) failed
  before the fix by approving, and now gets the 409, the record still a
  draft, and approves the tutor's next proposal; record tests refuse
  approval for a different title, units, note, or a missing note; a draft
  without a note still reopens and approves through the routes. Approval
  ignoring the units made both the regression test and the units case
  fail. `mise run check` passed lint, type-checking, 392 TypeScript tests
  and one Python test.

## Session view (plan task 2.11)

Built on 2026-11-15: `src/web/Session.tsx` (the view), `src/web/session.ts`
(what the view says about where the unit stands: the top line, the outline,
the next-step control, the markers, the closing card, the unit after this
one), the unit chat's events in `src/web/timeline.ts`, the written card in
`QuestionCard.tsx`, the address in `route.ts`, and the styles of mocks 3,
4 and 10 in `styles.css`. The choices are the agent's and can be
overturned.

- **The address is `/courses/<id>/units/<unit>`.** The view posts `open`,
  then follows `events`. A unit chat lives in the server's memory, so when
  its stream answers 404 the view opens the unit again and follows the new
  chat. Observed in the browser run: in development a server restart
  reloads the whole page anyway (Vite's client polls for the server and
  reloads), which opens the unit the same way, so a note saying the server
  restarted could never show and was dropped. Either way the thread then
  starts where the record has the unit, without the conversation before,
  until 2.13 rebuilds it from the transcript.
- **The markers are mock 3's.** Discuss, Check and Done begin with a marker
  line. A segment's teaching has none: it starts well clear of the segment
  before (mock 4's spacing), or at the top. The segment that goes over
  objectives again has a Teach marker ("Going over two objectives again.",
  mock 10).
- **One next-step control, where the thread has reached** (mock 3): "I'm
  ready for the check" in the discussion; "Move on without the check" in
  the check, asked once; "Start the next segment" when a segment before
  the last closes; none in teach. The server lets the learner move on from
  the discussion too (2.6); the page offers it only in the check, as the
  mock does. Moving on is not offered while a written answer waits for its
  grade, since the server refuses it then. Every control is disabled while
  the tutor writes, which the server refuses too.
- **A withdrawn question shrinks to a record** ("Question 1 Withdrawn" and
  its prompt), where mock 3 replaced the card with the note. The tutor's
  text before it may refer to the question, so its prompt stays.
- **The written card** (the note from 2.4 and 2.8): the answer field with
  `AnswerPreview` under it, how sure, and "I don't know"; no reasoning
  field, since the answer is its own. Once sent, the card keeps the answer
  as sent, rendered with `Prose`, and says "Grading"; after a failed
  grading it says "Not graded", the reason, that the answer is kept, and
  "Grade again". Graded, it shows the answer, how sure, and "The first
  flaw" beside its label. A correct answer given with help says that it
  does not count toward passing.
- **Keys**, as mock 2 has them and the brief asks ("one keystroke"): when
  the learner is not typing, A to F pick a choice, 1 to 5 how sure, and
  Enter submits; Enter on a button presses the button instead.
- **The top line and the outline are mock 4's.** "Segment 2 of 5" with a
  tick per segment of the plan; "Going over again" with the last tick lit
  during the extra segment (mock 10); "Finished" once the unit is. Mock 10
  says "Review" there; this says "Going over again", the server's name for
  the segment, because review mode (stage 6) is something else. The
  outline gives the path out, "Unit N of M", the segments, and the extra
  segment when there is one. Not there yet: the unit gate (stage 5) and
  "Start fresh" (2.14). Esc or a click elsewhere closes it.
- **The closing card is mock 10's.** A row per objective, passed or not
  passed, and why: "The check reached its limit of questions" for one
  attempted, "You moved on without the check" for one overridden. The page
  does not repeat the server's limit of three. It shrinks to one line once
  the learner goes over again or moves on. "Start unit N" is the next unit
  in the course's list; after the last unit the card says so and leads
  back to the course. A finished unit opened again has no card: a note
  says how it finished, with "Start unit N: title" and "Back to the
  course".
- **Objective statements render as Markdown with math** (`InlineProse`),
  since a math course's statements carry formulas; segment titles stay
  plain, as unit titles do. `prompts/unit-planner.md` says nothing about
  either, so a prompt task (2.16 or a planner revision) may say that
  statements can use `$` math.
- **Where a session starts.** After approval, "Start unit 1" (mock 8),
  with "Open the course" beside it. In the course view, every unit of an
  approved course has "Open", which starts it or picks it up: the course
  view cannot tell the units' status until 2.12, which replaces it with
  Start and Continue. For the same reason its line no longer says "No unit
  has started yet."
- **`unit_status` is not shown.** The closing card carries its own
  statuses, and the session view has nowhere else that needs them yet.
- **The React components have no automated tests**, as before (no DOM in
  the test setup); their logic is in `session.ts` and `timeline.ts`,
  tested with expected results worked by hand.
- **Browser run with the fake backend**, on a scratch server built like
  `main.ts` with a scripted tutor that acts on each turn's header, and a
  temporary data root. It covered: a new course approved and "Start unit
  1"; the unit planned and taught, with display math; the outline, closed
  with Esc and by a click elsewhere; a message in the discussion;
  "ready"; a choice answered by keys (A, 4, Enter); a reload mid-check,
  which rebuilt the thread with question 1 graded and question 2 open; a
  written answer with its preview, a failed grading, "Grade again", the
  flaw, and a second written answer passing; "Start the next segment";
  moving on without the check, asked once, with the question withdrawn;
  the closing card with one objective not passed; going over it again,
  with the card shrunk and the top line and outline saying so; the unit
  passing, with "Back to the course" and "Start unit 2"; unit 2 moved on
  from at its closing card, asked once, ending overridden; "Open" from
  the course view; and a server restart, after which the page showed the
  finished unit. A chat lost without a page reload (the scratch server
  replaced its unit chats and dropped connections) was opened again on the
  same page, and an answer then went to the new chat. The run found three
  things, fixed: statements showed their `$`, the flaw wrapped under its
  label, and the course view's line was now false.
- **Checks:** `mise run check` passed lint, type-checking, 435 TypeScript
  tests and one Python test. New: 9 timeline tests (markers and the
  position, the writing mark after a marker, planning and a failure, a
  written answer's grading, a withdrawn question, a question not shown
  twice, going over again, moving on without them, a finished unit), 30
  tests in `session.test.ts`, and 4 route cases. Each of twelve faults
  made a test fail: a grade keeping the kept answer, an override not
  withdrawing, a marker not ending the tutor's text, the closing card left
  full after moving on and after going over again, a question shown
  twice, moving on offered while an answer is graded, the next segment
  offered at the last, the extra segment's ticks, one objective spoken of
  in the plural, a spacer before the first teaching, and a unit address
  with more after it. The marker fault first passed every test, because
  text joins only after tutor text anyway; the test now checks the
  writing mark, which is what the reset changes. The review found and
  fixed a style that would have greyed the intake card's "Approved",
  refused messages whose reason was not shown, and unused state.
- **Review fix: the course's details failing to load** (the user's review
  of `581ee97`, which reproduced it with the fake backend). The view loaded
  the course once; after a failed load it took the course for empty: a
  blank path, "Unit 0 of 0" in the outline, and on passing unit 1 "That was
  the course's last unit" with no "Start unit 2". Now the load is asked
  again until the server answers (`getJsonUntilAnswered` in `api.ts`): a
  server not reached or failing (5xx) after a wait that doubles from one
  second to at most 15, a refusal (4xx) never. Meanwhile the thread says
  the details could not be loaded and are tried again. Until they load,
  the unit's place in the course (`placement` in `session.ts`, which
  replaces `unitAfter`) is unknown, never the course's last unit: the path
  says "Course", the outline leaves out the unit's line, and the closing
  card says "Unit finished" and leads back to the course only. New tests:
  four of the retry, through the real `getJson` with `fetch` stubbed and
  fake timers, and two of `placement`; each of six faults made one fail,
  the original bug among them (a course not loaded taken as empty). A
  browser run with the fake backend, the course route answering 500 at
  first, showed that state through to a passed unit 1, then, once the
  route answered (after six refused tries), "Unit 1 of 2" and "Start unit
  2" on the same page with no reload; the last unit still said it was the
  last. `mise run check` passed lint, type-checking, 440 TypeScript tests
  and one Python test.
- **For later tasks.** 2.12: replace "Open" with Start and Continue, and
  consider its "next unit in order" for the closing card's "Start unit N".
  2.13: the thread after a restart, or after a page reload that a restart
  causes, starts at the record's position; the transcript should come
  first. 2.14: "Start fresh" goes in the outline under the segments (piece
  11; `.uo-fresh` and `.stale` in `docs/prototype/base.css` are not ported
  yet). 2.16: statements may use `$` math (above).

## Course and library progress (plan task 2.12)

Built on 2026-11-15: the progress the library routes send
(`src/server/record/progress.ts`, `UnitProgress` and `CourseWithProgress`
in `src/shared/library.ts`), the page's reading of it (`src/web/progress.ts`,
`standing` in `library.ts`, `placement` in `session.ts`), the course view's
card, statuses and Start (`Course.tsx`), the library's groups and ticks
(`Library.tsx`), and the styles of piece 12 in `styles.css`. The choices are
the agent's and can be overturned.

- **The server derives each unit's progress when asked.** `GET
  /api/courses` and `GET /api/courses/<id>` send every course with
  `progress`: for each unit of an approved curriculum, its status from
  `unitStatus`, and for a unit with a position its segment. The position
  itself stays on the server, since an open question carries its grading
  material. A draft has no progress. The page names a unit's segment from
  the plan stored on the unit.
- **When each unit was last opened is kept in `course.json`**
  (`unitsOpenedAt`, by unit id), written by `markOpened(id, unitId)`, which
  opening a unit already called for the course's `lastOpenedAt`. The card
  needs it to put the units in progress most recently opened first, and
  nothing recorded it. Not in `state.json`: the engine writes positions
  from inside each chat's queue, and a second writer there, outside it,
  could lose an update. Not in the position either, since the engine builds
  some positions afresh. Units in progress never marked opened (positions
  from before this task) come after the others, in list order.
- **The card leads to the unit in progress most recently opened**, with the
  others one line each, most recent first; else to the next unit in order,
  the first in the list not started whose prerequisites are finished
  (passed or overridden), as piece 12 says. A unit in progress whose
  position is gone (a record left half-written) counts as in progress, and
  the card shows its goal, as it can say nothing of its segment. A finished
  course has no card. "Up next" marks the unit in the list only when the
  card says it too: when no unit is in progress.
- **Start asks first** when a prerequisite is not finished, naming only the
  unfinished ones ("This builds on unit 5, not finished yet."), with "Start
  anyway" and Cancel. The card's "Start unit N" never asks, since its
  prerequisites are finished.
- **A finished unit keeps "Open"** in the list, where mock 7 has Notes
  (stage 5). It is the only way back to a finished unit's session, which
  2.13 will fill with its transcript. In progress it is Continue.
- **The line under the title counts finished units** ("6 units, 2
  finished.", "none finished yet", "all finished"; "One unit, finished." for
  a one-off), as piece 12 has it. It replaces "Approved on <date>".
- **The library follows mock 6.** In progress: "Unit 3 of 8: Differentiation
  rules, segment 3 of 5" (or "going over again", or "in progress" when the
  segment is unknown), naming the unit the card leads to; a one-off says
  only "Segment 2 of 3". Up next: "Unit 2 of 8: title, not started".
  Finished: "Passed" or "Overridden" for a one-off, "All 8 units passed" or
  "All 8 units finished, 2 overridden" for a course, in the Finished group,
  which is left out while empty, as is "In progress". A tick per unit:
  past once finished, lit while in progress. A one-off has no ticks, as in
  the mock; task 1.6 gave it one.
- **A library row of a course with a unit in progress opens that unit's
  session**, where the learner stopped, as mock 6 has it ("resume one");
  this revises task 1.6's note that every approved course opens its course
  view, which was written before units could be taught. A course not
  started, or finished, opens its course view.
- **The closing card's "Start unit N" is the next unit in order**, counting
  the unit just finished (the note from 2.11). Before, it was the next unit
  in the list, which could be one already started or finished. With no unit
  left to start it says "That finishes the course." only when every other
  unit is finished; otherwise it leads back to the course, whose card shows
  the units in progress. The finished unit's note uses the same unit.
- **`segmentStand`** ("Segment 2 of 5" or "Going over again", with its
  ticks) moved to `progress.ts` so the card and the session's top line say
  the same; `Mark` moved with it.
- **Browser run with the fake backend**, on a scratch server built like
  `main.ts` with a tutor scripted on each turn's header and a seeded
  scratch data root (a draft, a one-off in progress, one passed, a course
  not started, a finished course with an override, and mock 12's course
  with unit 1 passed, unit 2 overridden and units 3 and 5 in progress). It
  showed the library's lines, ticks and Finished group; the course view's
  card with unit 5 (opened last) and unit 3 on its line, each unit's
  status, and the diagram's nodes by status; Start on unit 6 asking about
  unit 5 only (unit 2, overridden, counts as finished), Cancel, then Start
  anyway, which planned and taught it; the card then leading to unit 6
  with 5 and 3 below; unit 3 continued from its line and passed live,
  with the closing card offering "Start unit 4"; the course view then
  saying 3 finished; "Up next" on the course not started; and the library
  row resuming unit 6's session. After a server restart the routes sent
  the same progress. No console errors.
- **Checks:** `mise run check` passed lint, type-checking, 465 TypeScript
  tests and one Python test. New: 3 tests of the server's derivation, 1 of
  `markOpened` with units, progress in 3 route tests, 10 of
  `src/web/progress.ts`, 14 library lines (replacing 4), and 3 of
  `placement` (replacing 2). Each of thirteen faults made a test fail: a
  position looked up without `Object.hasOwn`, prerequisites ignored, the
  oldest opened first, overridden not finished, "Up next" beside a unit in
  progress, the finishing unit not counted finished, ticks on a one-off,
  `markOpened` dropping the unit, routes without progress, going over
  again read as a segment, unmarked units sorted first, "finishes the
  course" with another unit in progress, and the library naming the first
  unit in progress rather than the last opened. Two of them, "Up next"
  beside a unit in progress and the library's choice of unit, first passed
  every test; the tests now cover both.
- **Review fix: a course whose progress cannot be read** (the user's review
  of `32b7478`, which reproduced it with a bad line in one course's
  `evidence.jsonl`). The list of every course read each approved course's
  `state.json` and evidence, so one file that could not be read made the
  whole route answer 500 and the library show no course at all; before
  this task that route read neither file. Now the list catches the failure
  for that course alone and sends it with no progress and the reason
  (`problem` in `CourseWithProgress`); its row says "The record could not
  be read" and opens the course view, whose own route still answers 500
  with the reason, the file and line included. A `course.json` or
  `curriculum.json` that cannot be read still fails the whole list, as
  before this task: such a course has no title to list it by. New tests:
  one of the route, with a second course beside it that keeps its
  progress, and one library line; the route test failed with 500 before
  the fix. A browser look at a seeded scratch data root showed the library
  with the course listed and the reason on opening it. `mise run check`
  passed lint, type-checking, 467 TypeScript tests and one Python test.

## Dev server on the fake backend (plan task 2.12b)

Built on 2026-11-15, from the user's review of `32b7478`: `pnpm dev:fake`
(`scripts/dev-fake.ts`) runs the whole app with no model. The choices are
the agent's and can be overturned.

- **The scripted backend reads each turn's header** and does what the
  header allows (`src/server/backends/scripted.ts`, whose header lists
  it), with no state of its own: it plans a unit as two segments of one
  objective each, teaches in the teach phase, posts a question when the
  header allows one, closes the segment when the header says every
  objective is done, and otherwise replies in text. The first objective is
  checked by choice questions, whose answer is always A, the second by
  written ones, graded correct unless the answer has the word "wrong". The
  question's number comes from the header's count for its objective, so no
  question is asked twice in a check. An intake proposes four units,
  titled from the learner's first message. In a message, `/hold` keeps the
  turn open until it is stopped, `/revise` proposes a revision, `/one-off`
  proposes one unit, and `/fail` in a written answer fails its grading.
  It follows the headers' wording, so a header reworded in
  `unit-turns.ts`, `intake.ts` or `unit-planning.ts` can break it; its
  tests then fail.
- **It runs on the fake backend's machinery.** `createFakeBackend` now
  takes, in place of its lists, a function that answers any turn and one
  that answers any one-shot request, so tool calls run the real teaching
  tools and Stop works as in the tests. A one-shot request other than the
  grader's (the notes of stage 5) gets a grade and so fails its schema:
  whoever adds one extends `scriptedReply`.
- **The server is wired once**, in `src/server/serve.ts`, which `main.ts`
  calls with the Claude backends and `dev-fake.ts` with the scripted one,
  so the dev server cannot drift from the real one.
- **The data root is never the real one.** `scratchDataRoot`
  (`src/server/record/dev-seed.ts`) gives `GAUSS_DATA_ROOT`, or
  `gauss-fake` in the temporary folder, and refuses `~/gauss` and folders
  inside it. The port is 4330, not the real server's 4320, so a page left
  open on one never reaches the other.
- **An empty data root is seeded** with six courses (`seedCourses`; its
  comment lists them): mock 12's course with units passed, overridden, in
  progress and not started, a course not started, a finished one, a
  draft, and two one-offs. They are written through the record's own
  operations, so a schema change that the seed does not follow fails at
  once. A data root with courses is used as it is, so a restart keeps the
  record (2.13's browser check); `--empty` seeds nothing. Nothing is ever
  deleted: a fresh seed takes a new folder. The seed and the data root's
  check sit in `src/server/record/`, not in `scripts/`, so their tests run
  with the rest.
- **A browser run ends by closing the browser**, before the server stops
  (`AGENTS.md`). In the review, the browser of the 2.12 run was still on a
  session page of its scratch server, asking to open its unit every few
  seconds; a real-backend scratch server started later on the same port,
  with a course of the same id, had that unit planned and taught on
  Haiku.
- **Browser run:** `pnpm dev:fake` on a new folder printed the six seeded
  courses and no Claude session. The library showed each state. "Start
  unit 1" of the course not started planned and taught the unit, with its
  math rendered; the check asked a choice question, closed the segment on
  A at 90%, and in the second segment graded a written answer correct;
  the closing card said "Unit 1 finished" and offered "Start unit 2". A
  seeded unit in progress (Calculus I, unit 3) went from its discussion
  into its check. No console errors. With `GAUSS_DATA_ROOT` set to
  `~/gauss`, or to a folder inside it, the command refused and wrote
  nothing. `pnpm dev` still started and answered after the move to
  `serve.ts` (no message sent).
- **Checks:** `mise run check` passed lint, type-checking, 474 TypeScript
  tests and one Python test. New: 4 tests of the scripted backend through
  the engine (a unit from not planned to passed, with a written answer
  graded incorrect and then correct; an intake with a revision approved;
  a one-off; `/hold` and `/fail`) and 3 of the seed and the data root.
  Each of eleven faults made one fail: the same question every time, a
  grader that never finds a flaw, a segment never closed, each of the
  four commands ignored, the real data root allowed, folders inside it
  allowed, a data root with courses seeded, and the wrong objectives
  passed in an overridden unit.

## Transcripts (plan task 2.13)

Built on 2026-11-16: `src/server/engine/transcript.ts` (the unit chat's
event log that is also its transcripts), `appendTranscript` and
`readTranscripts` in `src/server/record/data-root.ts`, several lines in one
write and lines left out on reading in `json-lines.ts`, the `session` page
event, and the thread's sessions in `src/web/timeline.ts` and
`Session.tsx`. The choices are the agent's and can be overturned.

- **A session is one sitting in a unit.** One starts when the unit's chat
  opens, which happens once per server run, and again when something
  happens after the unit has been quiet for an hour (`SESSION_GAP_MS`):
  the learner went away and came back. "Quiet" is measured from the last
  event, not from the session's start, so a long sitting with breaks under
  an hour stays one session. Rejected: one session per chat only, which
  makes a server left running for days one sitting, and a session per
  backend session, which 2.14's resume would stretch over many sittings.
  Opening a unit to look at it is a short sitting too, and leaves a
  transcript of its opening events (the plan, the status, the phase). The
  gap is a guess; 2.15's idle time for closing a tutor session is a
  separate choice, which may or may not match it.
- **A transcript is the page events of one session**, in
  `sessions/<unit id>.<n>.jsonl`, numbered from 1 for each unit, starting
  with a `session` event that holds when it began. A slug has no dot, so
  the name reads back unambiguously, and a unit's transcripts are found
  without opening other units'. They are ordered by number, not by date,
  so a clock set back cannot reorder them. Intakes write none; their chat
  is not a unit's. The page events are what the task asked for, so the
  tutor's turn headers and the rubrics are not in them: 2.16, which reads
  transcripts to revise the prompt, finds the headers' wording in
  `unit-turns.ts`, and the turns as sent in the backend's own session log
  once 2.14 keeps sessions.
- **A unit chat's log starts with its earlier sessions.** Opening the chat
  reads the unit's transcripts and replays their events into its log, then
  starts its own session; the page replays the log as before, so a reload
  and a restart give the same thread. The chat's opening then repeats
  where the unit stands, and the page does not show any of it twice: a
  `phase` in the segment and phase the thread is already in adds no marker
  (it still sets the position), a question already in the thread is not
  posted again (as before), and a `unit_end` with no phase begun since the
  last closing card is that card shown again. A phase the thread had not
  reached, because a crash lost the transcript's last lines, is shown as
  usual.
- **A `session` after the first is a marker line**, "New session" and its
  date and time in the learner's format, in the style of the phase
  markers. The first session has none, so a new unit starts as before. It
  ends what the session before left under way: the tutor writing, a
  planning, a failure (its note stays). When the tutor was writing, a note
  above the marker says "The server stopped before the tutor finished."
  A session that showed nothing, such as a look at the unit before a
  restart, gives way to the next one's marker. The tutor itself is still
  new after a restart until 2.14; the thread does not say so yet, which is
  2.14's "Fresh start" marker.
- **Lines are written as the events happen, in batches**: the page hears
  of an event at once, and one write takes every event that came while the
  write before ran. The backend streams the tutor's text in small pieces,
  so each run of it in a batch is joined into one line, which the page
  shows the same way; a transcript's lines therefore depend on timing,
  which the tests allow for. A write that fails is logged and its lines
  are lost, and the chat goes on: the record does not depend on them.
- **Transcripts are not flushed to disk**, unlike the evidence. Measured on
  this machine, one flushed append took about 38 ms, nearly all of it the
  flush, and reading the course to check it exists under 1 ms; flushing
  each batch made the scripted backend's whole-unit test take half as long
  again, and it timed out in the full run. A transcript only shows the
  conversation: a stopped server loses none of it, since the system holds
  the lines, and a stopped machine can lose its last lines, which the
  record does not need. For the same reason, and because page events will
  change shape over time, **a line of a transcript that cannot be read is
  left out and logged**, not an error: it costs that line, not the unit.
  An unfinished last line is skipped silently, as in the evidence. A
  transcript cut short is never appended to again, since the next session
  has a file of its own.
- **Shutdown flushes what is pending**: a unit chat's `close` waits for its
  writes, and `settled` does too, which the tests use before a restart.
  An event after that (a stopped turn's end, an aborted grading) may be
  lost or cut short as the process exits; reading copes with both.
- **For later tasks.** 2.14: add the "Fresh start" marker (piece 11) after
  the session's marker when the tutor could not be resumed or the learner
  started fresh, and dim the thread before it; a resumed tutor needs no
  marker beyond the session's. 2.15: a tutor session closed when idle does
  not end the sitting; the next message after an hour starts a new
  session either way. 2.16: the transcripts of a run are in the data
  root's `courses/<id>/sessions/`. Stage 5: handoff notes are written "at
  the end of each session"; a session ends when the server stops or after
  an hour quiet, and sessions holding only a unit's opening have nothing
  to summarise. Transcript export reads these files.
- **Browser run** on `pnpm dev:fake` with a new data root: "Start unit 1"
  of a course not started, a message, "ready", question 1 left open; the
  browser closed and the server stopped with Ctrl-C. `vectors.1.jsonl`
  held the session's 18 events. After a restart the unit's page showed the
  whole earlier thread, question 1 still open, then "New session" and the
  date, then "Move on without the check", with no marker or card twice;
  question 1 was answered on its card, and the feedback and "Done" came
  under the marker. In segment 2 a `/hold` message kept the tutor writing,
  the browser was closed, and the server killed with `kill -9`: the
  transcript ended with the reply's `turn_start` and text. After a
  restart the thread showed the three sessions in order, "The server
  stopped before the tutor finished." under the held reply, the third
  session's marker, and "I'm ready for the check". After each restart the
  page took a few seconds to show the thread, and Vite reloaded it once,
  as 2.11 recorded; a reload on the running server showed it in about 1.5
  seconds with no transcript read, so the wait is the page's, not the
  transcripts'.
- **Checks:** `mise run check` passed lint, type-checking, 487 TypeScript
  tests and one Python test. New: 4 record tests (no transcripts; read
  back in number order, 10 after 2, without another unit whose id starts
  the same; a cut last line skipped and damaged lines left out and named;
  a bad event refused) and a missing course refused by both; 4 unit chat
  tests on the fake backend (a thread rebuilt after a restart, compared
  with what the page was shown before it; a transcript cut short by a
  crash mid-teaching; three sessions shown in order; a new session after
  an hour quiet but not after two hours with breaks under one); 5 timeline
  tests (the marker and a cut-off reply; a session that showed nothing;
  planning and a failure ended; nothing shown twice on reopening, with
  going over again after it; a phase past the thread's). Nine existing
  tests changed (eight of the unit chat, one route): they expect the
  `session` event, and the reopening ones read from the last session on.
  Each of these faults made a test fail: transcripts
  sorted as text; another unit's matched by prefix; a damaged line an
  error; no course check; no replay; every chat writing session 1; a new
  chat appending to the last session; no gap rule; the gap measured from
  the session's start; the gap strictly greater; `settled` not waiting
  for writes; a batch losing all but its first event; joined text losing
  its second piece; the `session` event not written; and, in the page, no
  phase or card dedupe, `busy` kept across a session, a marker for the
  first session, empty sessions kept, and a failure kept. Comparing the
  `again` objectives in the phase dedupe passed every test: two positions
  with the same segment and phase and different `again` cannot follow one
  another, so it was dropped and the position taken as sent.
