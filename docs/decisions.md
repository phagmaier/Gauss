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
