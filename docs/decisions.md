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
