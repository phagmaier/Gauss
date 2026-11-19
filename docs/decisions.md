# Gauss: decisions and findings

Why things are as they are: the user's decisions, the agent's choices and
the alternatives they beat, what the SDKs and tools were seen to do, and
the gaps left open. What the system does now is in `architecture.md`; how
to add to this file is in `AGENTS.md`, "Keeping the documents".

Use the index to read the sections relevant to the task, not the whole
file. `grep -n '^## ' docs/decisions.md` gives the line numbers. The user's
decisions are marked as theirs; the rest are the agent's, open to change.

The build journal this file was condensed from, with every task's runs and
checks through task 2.29, is `git show a42a409:docs/decisions.md`.

| Section | Holds | Read when |
| --- | --- | --- |
| Product decisions | What the user decided, when, and why | Changing what the product does; breaking down a stage |
| Toolchain | Versions, type-checking, Biome, pnpm and uv settings | Changing tooling or `tsconfig.json` |
| Claude backend | The Agent SDK on the plan login: environment, isolation, ending turns, Stop, sessions and resume, one-shot calls, thinking | Touching `src/server/backends/` |
| Confinement | Keeping the tutor's writes in its folder: the option set, what it blocked, the working and temporary folders, the engine's sandbox; artifacts' frame and policy, and WebRTC | Giving the tutor built-in tools (stage 3), web access (stage 4); running commands from the engine; changing artifacts |
| Codex | What the Codex SDK can and cannot do | Stage 6 |
| Record | Ids, writes, the file lock, logs, transcripts on disk, the backup | Touching `src/server/record/` or a record file's schema |
| Objective status | The passing rule and its history, help, overrides, the question count | Touching `record/status.ts`, `engine/check-rules.ts`, or what counts as help |
| Calibration | What the counts count | Touching calibration, or what confidence or help mean |
| Session engine | The chats' design choices: phases, the feedback turn, queues, detours, choice order, planning, intake, resume, idle sessions, transcripts | Touching `src/server/engine/` |
| Grader prompt | The hand-graded set, the grader's model and rules | Changing `grader.md`, `WrittenGrade` or the grader's model; disputes |
| Help judge | The judge's rules, failures, model and set | Changing help judging; disputes |
| Symbolic check | `mathcheck.py`: the parser and its traps, what counts as equal, the time limits; math questions in the engine and on the page | Changing `mathcheck.py`, math questions, or what they accept |
| Code questions | Where a code question's tests run, the checks at posting, the learner's files, time-outs, the output kept | Changing code questions or how their tests run |
| Disputes | What can be disputed, what an outcome changes, what the learner sees, wrong keys, who decides; how they are built; the judge's set and model | Building or changing disputes or `dispute-judge.md` |
| Mastery loop | Stage 5's design: assessments in the unit's thread, retained and slipping, review, the gate, testing out, handoff notes and misconceptions, the profile, notes and export | Working a stage 5 task; touching assessments, status or the record's notes |
| Prompts | Findings behind the wording of `tutor.md`, `planner.md`, `unit-planner.md`; the writing rules | Revising any prompt |
| Page design | The look and layout picked from the mocks, with what was rejected | Building or changing a view |
| Page behaviour | Rendering, performance, the pinned question, dimming, keys, retries | Touching `src/web/` |
| HTTP and event stream | Route rules, security, intake addressing | Adding or changing a route |
| Dev server and tests | `pnpm dev:fake`, the fake backends, test timing, real-model runs | Running checks; touching `scripted.ts`, `dev-seed.ts`, `serve.ts` |
| Sources | Splitting sources into sections | Stage 4 |
| Known gaps | What is known to be wrong or missing and not scheduled | Before calling something a new bug |

## Product decisions

The brief states the result; this is who decided and why.

- **2026-11-13, the brief.** The user accepted the agent's proposals without
  item-by-item review ("the brief is fine", judgment delegated): objectives
  as the unit of tracking, the three-phase rhythm, passed and retained
  tiers, curriculum planned at two levels, verified quotes, disputes,
  Claude first. Also theirs: courses, units and one-offs, override,
  confidence and reasoning on answers, detours, artifacts, workspace,
  sources in four formats, lecture-style teaching of sources, no formal
  proof checking, transcripts, HTML notes, both subscriptions. Delegated to
  the agent: the language (TypeScript with Python helpers), sitting length
  (not a design input; resume works anywhere instead), the style note
  (per course, changed only with the learner's agreement).
- **2026-11-13, from the mocks.** The user asked for five confidence levels
  and "I don't know" on every question. They later offered to drop the
  percentages; the agent kept them, because they make "confident" (90% or
  100%) concrete and allow calibration.
- **2026-11-16, the first stage 2 check** (a chain-rule unit). What the
  record showed: the planner proposed four units for "a short unit" without
  asking anything; the three-question limit closed segments with
  objectives not passed, and the tutor said "we'll come back to that
  skill", which nothing kept; feedback on "I don't know" was followed at
  once by the next question; asking what a question meant was charged as
  help; the open card scrolled out of view. The user decided:
  - strict by default: an objective is not passed "until the answers seem
    obvious and easy"; override is always open and recorded;
  - every miss starts a detour, which the learner ends; the check pauses
    only after misses; "I don't know" takes an optional line on where the
    learner got stuck;
  - writing during an open question stays allowed; asking what it means is
    clarification, not help, and a model judges which;
  - the planner asks about background, understanding and scope before
    proposing;
  - a dividing line between messages.

  The agent chose, under those: no question limit; teaching again after a
  second miss; a separate judging call; no proposal in the planner's first
  turn; the background note; the tutor promising nothing the app does not
  do. It also chose to require a confident answer to pass, which the user
  overturned the next day.
- **2026-11-17, the stage 2 review.** The check passed on a second try; the
  user then brought a review of the record of a theology course. It showed
  an objective answered correctly at 75% and 50%, then missed, then
  correct at 90%, ending overridden; objectives that each joined an
  explanation and two contrasts; and teaching that quoted Basil, Lossky
  and Vatican II from memory. The user decided:
  - passing: two correct answers in a row to different questions at any
    confidence, or one at 90% or more if the objective was never missed;
  - review questions open each sitting, on by default and skippable,
    replacing the opt-in review mode ("a mode one has to open tends not to
    be opened"), built with the unit gate in stage 5;
  - testing out of a unit replaces the baseline quiz, whose probe of
    prerequisites the intake's questions now cover;
  - course finals are dropped;
  - a course with no source quotes nothing verbatim from memory;
  - stage 5 before stage 4: the gate and review make "passed" trustworthy
    in every course, and need nothing from sources;
  - the "what I know" view, calibration and a backup before stage 3;
    starred messages wait until the generated notes have been used.

  The agent chose: "in a row" means no miss between, so an answer given
  with help neither counts nor breaks the row; two lucky guesses at 50% on
  four choices (1 in 16) are accepted; stage numbers are kept, with the
  order written beside them.
- **2026-11-17, the check of 2.23 to 2.27.** The user decided calibration
  per course ("it's meaningless in the aggregate": how sure one is in
  theology and in math differ), and that a library row opens the course
  page rather than the last session. The agent applied the second to
  drafts too.
- **2026-11-17, the stage 3 designs** (pieces 13 and 14 of the mocks). The
  user picked: a dispute is decided by a separate model call, not by the
  learner's word or the tutor ("Disputes"); a code question's tests are
  hidden until it is graded, and a failing run starts a detour followed by
  a different exercise, as a miss does for every other kind ("Page
  design"); and Gauss installs a course's packages once the learner
  approves a card. The agent had recommended that the learner run the
  install command themselves; what it chose under the user's pick is in
  "Confinement".
- **2026-11-18, the stage 3 check** (a Python course and a numerical
  solvers course, on Opus 5.5). It passed: code graded by tests, a math
  answer graded symbolically, an artifact and a dispute. The user's notes
  became tasks 3.19 to 3.22: starter files that hold what a question gives
  (Opus had them type given values into the file); the install card's
  command and output shown only on request or failure; a pinned question
  that can be hidden; and an "Open" button for a code question's files.
  For "Open" they chose the system's default app over a set command
  (Ghostty with nvim). They also suggested questions on the learner's
  intuition before the check. The agent supported it: explaining or
  predicting exposes a picture a correct computation can hide, for one or
  two exchanges a segment. The user chose it on by default, with the tutor
  judging when; the style note can turn it off.
- **2026-11-18, the stage 5 designs**, answered when the stage was broken
  down, before any mock. The user decided:
  - review is offered on a card with Start and Skip at each sitting's
    start, and does not start by itself: "if someone is confident they
    don't need a review we shouldn't force them to have one". This
    replaces "on by default" (2026-11-17); the card still comes unasked,
    so it is not the opt-in mode they dropped;
  - a miss in review opens a detour and one more question, as in the
    gate;
  - testing out is offered beside Start, and nothing is skipped without
    the learner's say: "you have to consent to skipping something". The
    agent read that as two steps, a confirmation before the test and a
    result card whose answer does the skipping;
  - notes are offered when a unit finishes, not written unasked. They
    follow a standard (what the unit taught, more room for what the
    learner struggled with, what made things click), and the learner can
    add instructions of their own on top;
  - the profile is proposed by the planner and approved with the
    curriculum, and the learner can edit it;
  - the brief's wording: a handoff note is written when a segment closes;
    review asks slipping objectives first; a miss while testing out does
    not count afterwards.
- **2026-11-18, the stage 5 mocks** (pieces 15 to 18). The user looked at
  all four and accepted them as shown, but for the notes. Piece 17 had
  drawn a unit's notes as text the engine rendered from the model's
  Markdown; they turned it down: it "looks like markdown in obsidian",
  and the notes are HTML so that they "can have visuals and be
  expressive", a page that "looks nice", "actual html". They added that
  the notes need not be shown inside the app if that were what held them
  to plain text: downloading them or opening them in the browser would
  do. They also picked KaTeX's own output, with its styles and fonts
  written into the file, for the math of the notes and the exported
  transcript, over MathML, which the agent had planned and then showed
  drawing badly. What the agent chose under these is in "Mastery loop"
  and "Page design".

## Toolchain

- **Very new major versions**: TypeScript 7, Vitest 5, Biome 2.6, pnpm 12,
  Vite 8, React 19, Agent SDK 0.3. Check documentation before relying on
  remembered behaviour. The runtimes in `mise.toml` were those already on
  the user's machine.
- **Type-checking only, no build step.** `tsc` never emits; imports carry
  `.ts` and `erasableSyntaxOnly` is on, so the same source runs under Node,
  Vite and Vitest. `pnpm dev` runs `main.ts` under Node directly, with Vite
  in middleware mode on the same port; a production start without Vite is
  not built.
- **Biome excludes Markdown and `docs/`**: version 2.6 would rewrite every
  table in the documents.
- **`@types/node`** is pinned to major 24, the runtime's.
- **pnpm**: a release must be a day old to install; pnpm 12 fails an install
  whose dependency needs a build script until it is named under
  `allowBuilds`.
- **`pytools/`** uses mise's Python only (`python-preference =
  "only-system"`), so uv never downloads a second interpreter.
- **A test on each side checks the runtime pin**, so a suite run outside
  mise fails.
- **No DOM in the tests.** React components have no automated tests; their
  logic is in pure modules, and rendering is tested to static HTML with
  `react-dom/server`. No DOM library was added for it.

## Claude backend

Observed with Agent SDK 0.3.325, which runs the Claude Code binary bundled
in its platform package (2.1.325), not the `claude` on the path.

**Login and environment**

- The SDK uses the plan login when no key is set (`apiKeySource: "none"`).
  A set `ANTHROPIC_API_KEY` takes precedence: with an invalid one the
  request failed with 401 and did not fall back, so a valid one would be
  billed as API usage. A probe with `ANTHROPIC_BASE_URL` and a bogus
  `ANTHROPIC_AUTH_TOKEN` sent requests to the other server with that
  token. So the backend gives the SDK no `ANTHROPIC_` variable and no
  `CLAUDE` one, which also drops the cloud-provider switches
  (`CLAUDE_CODE_USE_BEDROCK` and the like). The providers' own credentials
  stay (inert without a switch), and so do proxy variables.
- Dropping `CLAUDE_CONFIG_DIR` means the SDK's in-process `getSessionInfo`
  would look under the parent's root while sessions run under the default
  one. When that variable is inherited, `hasSession` runs a short Node
  subprocess with the backend's environment; there is no option for the
  root.
- A `rate_limit_event` reports the plan's usage windows; `total_cost_usd`
  is a list price, not a charge. Each session made one small Haiku request
  of its own (about 1,300 input tokens).

**Isolation from the learner's own Claude Code**

- `settingSources: []` alone kept out the user's `CLAUDE.md`, the repository's
  instructions, user skills, MCP servers, plugins and permission mode, but
  not the auto-memory (the model quoted the memory index), not Claude
  Code's bundled skills, and not the user's claude.ai connectors, which
  joined a few seconds in (about 2,500 tokens). Hence `skills: []`,
  `autoMemoryEnabled: false`, `disableClaudeAiConnectors: true` and
  `strictMcpConfig: true`. Loading the user's settings would also bring
  their `bypassPermissions` mode: never load them.
- **The account's email address reaches every session**, in a
  `session_context` reminder on the first message, built from the login's
  account record. `CLAUDE_CODE_DISABLE_ATTACHMENTS` does not remove it; bare
  mode (`CLAUDE_CODE_SIMPLE`) does, but does not use the plan login. A
  separate configuration folder would need a copy of the login, and
  refreshing one copy can sign the learner out. It goes only to Anthropic.
  The tutor's file and shell tools (stage 3) change nothing, by the
  agent's judgment in task 3.0: the tutor has no web tool and its sandbox
  no network, so the address can reach only Anthropic, which has it as
  the account's, or a workspace file the model chose to write it in. Web
  access (stage 4) would let a request carry it, with anything else in
  the context; 4.0 has the point. Look again if an SDK adds a switch.

**Tools and ending a turn**

- With no `tools` option a session gets about 25 built-in tools
  (scheduling, worktrees, messaging, subagents) and its first request was
  15,000 to 19,000 tokens; name the tools. Custom tools are deferred behind
  tool search only when `ToolSearch` is among the session's tools; leave it
  out, and set `alwaysLoad: true` on the teaching tool server anyway.
- **The model does not stop after posting a question.** In four calls it
  went on each time: a sentence, once with a hint, once a second
  `ask_question`. A `PostToolUse` hook returning `continue: false` ended
  the turn every time, and the session continued normally. The backend
  stops only when the tool's result set `endTurn`, so a refused call goes
  back to the model. Not tried: the SDK's `_meta['claude/endTurn']`.
- With Claude, a tool input that fails its schema is refused by the MCP
  layer before the tool runs (`MCP error -32602: Input validation error`
  with the zod issues), so the model gets the schema's messages; write
  them for the model.

**Stop**

- `interrupt()` stops a turn before or during its text. It does not cancel
  input the SDK has queued but not started, and the SDK has no public way
  to. The backend adds a `UserPromptSubmit` hook that stops a cancelled
  turn when it is picked up, and interrupts again at the response's
  `message_start` for one that passed the hook; it refuses late tool calls
  and drains output without showing it. A request can start in the gap
  after the hook, so Stop does not promise zero tokens. Tested against a
  simulated SDK boundary, not a live model.
- Once, after a stop mid-sentence, the next one-sentence reply took 10 to
  30 seconds. Not seen again, and not investigated.

**Sessions and resume**

- The session id is chosen up front (`sessionId`), so it can be stored
  before the first turn. `sessionId` cannot be given with `resume`, which
  keeps the id.
- A session resumes by id in a new process. Resuming from another working
  directory still finds it and moves it there, so always resume in the
  folder it ran in: confinement follows the working directory.
- An unknown id fails before any model request: `initializationResult()`
  rejects with "No conversation found with session ID", which the backend
  maps to `SessionNotFound`. That match is on Claude Code's wording; if an
  SDK rewords it, sessions swept away would fail to resume instead of
  falling back. A session that exists is ready in 0.3 to 0.6 seconds.
- A resumed session keeps its first system prompt, unless it is
  `{ type: "custom", prompt, snapshot: false }`, which sends the current
  one; a changed prompt then costs one prompt-cache miss.
- Kept sessions are files under
  `~/.claude/projects/<working directory, every character but letters and
  digits made "-">/<id>.jsonl`; nothing is written in the course folder
  while the tutor has no built-in tools. Without `title`, Claude Code
  writes a title of its own, apparently with a small request.
- `getSessionInfo(id, { dir })` reads one session file with no process, in
  4 to 7 ms: undefined for an unknown id, another folder or a missing
  folder, and it never threw.
- Claude Code deletes session files older than the learner's
  `cleanupPeriodDays` (30 by default). A file backdated 31 days was deleted
  within a quarter of an hour by some Claude Code process; resuming it then
  failed as an unknown id does.
- A session whose process stopped while it wrote a reply resumes; its file
  ends with the message it was answering.

**One-shot calls**

- A `query()` with a string prompt, `tools: []`, the isolation options and
  `outputFormat` (draft-7 JSON Schema from `z.toJSONSchema`) returns
  `structured_output`; a grading on Haiku took 3.3 seconds. The SDK retries
  a reply out of shape itself and gives up with
  `error_max_structured_output_retries`; Gauss does not retry. The reply is
  checked against the zod schema too, which says more than JSON Schema.

**Thinking**

- Sonnet 5.5 runs with adaptive thinking, displayed as "updates", a mode in
  which the model writes updates for its user in its thinking, which the
  page never shows. `thinking: { type: "disabled" }` is not sent to a
  model that rejects it, so it changes nothing; `display: "summarized"` did
  not help either. What this did to feedback, and the fix, are in "Session
  engine".
- To read a run: Claude Code's session log holds the turns as sent, tool
  inputs, thinking blocks and each request's parameters (`api-request`).

## Confinement

The tutor's option set as built is `workspaceOptions` in
`backends/claude.ts` (task 3.3): the stage 0 set below, with the course's
workspace as `dir` and no protected file, since the record lies outside it.
Observed with throwaway scripts in stage 0, this set, added to the
isolation options, kept every write inside `dir`:

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

- **Two layers are needed.** The sandbox (bubblewrap on Linux) confines
  shell commands and what they start; `Write` and `Edit` run outside it and
  are confined by `blockWritesOutsideWorkingDirectories` and the `Edit`
  rules. Refused in the run: `Write` outside, shell writes to `/tmp` and
  the home folder (also with `dangerouslyDisableSandbox`), Python writing
  outside, and both layers' writes to the protected file. An `Edit` rule
  with one leading slash is anchored at the working directory; `//` makes
  it absolute, which `/${dir}` does for an absolute `dir`.
- **`dontAsk` needs an allow rule for `Bash`**, or some sandboxed commands
  are refused as a permission matter with no reason given.
- **Seen in task 3.3** (Haiku 5.5, the backend as built, a scratch data
  root): a file written in the workspace; a `Write` of a new file beside
  the record refused by `blockWritesOutsideWorkingDirectories`, and of
  `state.json` refused first because Claude Code wants a file read before
  it is overwritten, while `dontAsk` refuses `Read` outside the working
  folder (`Glob` and `Grep` not tried); shell writes to `../state.json`,
  `../evidence.jsonl`, the home folder and `/tmp` failing on a read-only
  file system; `curl` refused by the proxy (403); `$TMPDIR` the private
  folder; `python` running in the workspace. The engine's refusal reaches
  the model as `PreToolUse:Write hook error: <reason>`.
- **A session leaves `.claude/.cc-writes/` in its working directory**, an
  empty folder closed to others (task 3.3; stage 0 also saw a `.tmp/`,
  from its `CLAUDE_CODE_TMPDIR`). Left there, so the learner sees an empty
  hidden folder in the workspace (the agent's choice): Claude Code makes it
  again, it holds nothing, and git keeps no empty folder.
- **The tutor's working directory is the course's `workspace/`** (task 3.0,
  the agent's choice), the other way round from closing the record inside
  the course folder. The folder holds only what the tutor may write, so
  the record lies outside it and both layers keep it out with no list of
  paths: the file tools write only where the one `Edit` allow rule says,
  and sandboxed commands only in the working directory, the allowed paths
  and Claude Code's temporary folder. Rejected: the course folder as the
  working directory with each record file denied, since every new record
  file (stage 5's misconceptions and handoff notes) would need its own
  rule, and whether a deny stops a command creating a file that does not
  exist yet was never tried. Artifacts are written by the engine from
  `show_artifact`'s input, so the tutor needs no second folder. Intakes
  run in the data root's empty `intake/` folder, so a tool given to them
  later is confined to nothing of value.
- **Every tutor gets the tools**, in every course: one way of running, and
  a math tutor can check its own expressions with Python. The planner, the
  unit planner and one-shot calls get none. Only when the engine's sandbox
  passes its start check (task 3.3, the agent's choice): Claude Code's
  sandbox needs the same `bwrap`, `socat` and `rg`, and with
  `failIfUnavailable` a session whose sandbox cannot run would fail at
  start, so the tutor rather runs without the tools.
- **`CLAUDE_CODE_TMPDIR` in the course folder is too long.** The sandbox
  leaves Claude Code's per-user temporary folder,
  `<CLAUDE_CODE_TMPDIR or the system's>/claude-<uid>`, writable, and the
  system's one is shared by every Claude Code session of the user. Read in
  the code of Claude Code 2.1.325 (the binary the SDK bundles; task 3.0):
  sandboxed commands get that folder as `$TMPDIR` only if its path is at
  most 44 bytes, for Unix sockets; otherwise `/tmp/claude-<uid>`, the
  shared one, with a warning. Here
  `/home/phagmaier/gauss/courses/<id>/.tmp/claude-1000` is at least 48
  bytes. So the tutor's is a private folder per course under `/tmp`:
  `/tmp/gauss-<8 hex digits>/claude-1000` is 31 bytes, the digits from the
  workspace's path. `/tmp` is shared, so the folder is made `0700`, and a
  session is refused if the one there is a link, another user's, or open
  to others.
- **The engine runs model-written text in a sandbox too** (task 3.0, the
  agent's choice): a code question's tests and the symbolic check, whose
  SymPy parser evaluates its input. It uses
  `@anthropic-ai/sandbox-runtime`, the runtime Anthropic developed for
  Claude Code's sandbox (a research preview, version 0.0.x): no network,
  writes only where the run needs. Rejected: a
  bubblewrap command line written by hand (Linux only, and each
  protection the runtime adds would be ours to get right), and running
  tests through a tutor session, which puts a model between the test and
  the grade.
- **The engine's sandbox** (`engine/sandbox.ts`, runtime 0.0.83). The network
  namespace and proxy refuse direct TCP connections and proxy requests.
  Without a network section the runtime does not start. A child moved to a
  session of its own stops at the time limit (the PID namespace), and a
  server killed with SIGKILL takes its commands with it (`--die-with-parent`).
  The runtime's unasked writable paths are closed in `configFor`.
- **Linux only** (the agent's choice). The macOS runtime can leave
  descendants alive after the direct command exits; the deadline and tutor
  workspace reservation cannot rely on that exit. Until there is verified
  process-tree containment, commands and built-in tutor tools stay off on
  other platforms.
- **Linux commands need an extra workload filter** (the agent's choice).
  Runtime 0.0.83 blocks `socket(AF_UNIX)` but permits `socketpair`; a
  datagram endpoint was reconnected to a scratch host socket. Engine and
  tutor commands therefore use `pytools/sandbox_exec.py` inside the runtime,
  stacking an inherited seccomp filter before exec. The existing venv Python
  avoids a compiler or vendored native binary. Startup probes the routes
  and refuses tools if one remains open; unsupported Linux ABIs fail closed.
  Since task 3.11 the filter refuses datagram and seqpacket pairs only: uv
  panicked at start under the first filter (tokio's signal handling makes a
  stream pair), and asyncio needs one too. A stream pair is connected for
  good: connecting one end to a host socket fails with `EISCONN` (a test
  in `sandbox.test.ts`).
- **Each engine command has its own `$TMPDIR`**, removed when it ends (the
  agent's choice). The runtime points `TMPDIR` at `/tmp/claude`, shared by
  every sandboxed command, which the module closes; with no writable
  temporary folder, Python's `tempfile` falls back to the working folder,
  and pytest's folders would land in the workspace.
- **`uv run` fails in the engine's sandbox**: its cache, `~/.cache/uv`, is
  read-only there. A venv's own Python runs, and so does `uv run` with
  `UV_CACHE_DIR` in `$TMPDIR` (seen in task 3.2, with no packages). The
  same in the tutor's sandbox (task 3.3). So the tutor is told to run
  `.venv/bin/python` (`tutor.md`, "Packages").
- **Installing packages is the one command with network access** (the
  user's pick, piece 14). The tutor names the packages and the engine
  builds the command (`engine/packages.ts`): reads are not confined, so
  tutor code must not run with network access. Python through uv only;
  add another language's package manager when a course needs it.
  - Names and version ranges are checked by regular expressions
    (`src/shared/packages.ts`): no URL, path, option, extra or marker.
  - The network: `registerCommandNetworkLists` under a random command id,
    `pypi.org` and `files.pythonhosted.org` exactly (the runtime matches a
    host whole). Seen: `pypi.org` tunnelled, `example.com` and
    `github.com` refused with 403, a command given no hosts refused all.
  - The installer uses an engine-owned uv project outside the workspace
    (agent's choice). `--no-config` and `--no-sources` did not stop uv
    reading the workspace project's dependencies; `--no-build` also does
    not forbid all first-party and editable builds. No workspace
    manifest, lockfile or environment participates in resolution. The
    user chose to carry forward earlier roots only from transcripts that
    record the request, approval and successful install.
  - The installer parks the old environment without following links,
    and restores it on failure. uv gets the pinned base Python, no
    local builds, a fresh environment at the final path (entry-point
    scripts use that path) and a fresh install-cache location. Copying
    wheels prevents workspace edits from changing the cache.
  - A request is kept in the unit's position, one per course.
    New questions and tutor mutations wait for the course's install; a
    check it blocked is prompted again if still waiting.
  - A journal makes rollback and result recovery independent of approval
    (the agent's choice). uv writes the new environment in place so its
    entry points keep their paths. Only committing the journal makes that
    candidate usable; the same marker publishes a request-bound receipt.
    On failure, the previous environment is restored before the failure
    receipt can be used. This lets a restart finish either write without
    treating it as a new approval. If the receipt is saved but cleanup
    fails, no later install starts until cleanup succeeds.
  - The tutor's notification is a note in memory. An open question gets
    no extra tutor turn for an outcome: a normal reply or later feedback
    carries the note.
- **The backup keeps the learner's workspace files** (the agent's choice,
  task 3.11): they are the learner's work, small, and the history undoes
  a tutor's overwrite. `.venv/`, `__pycache__/` and `.pytest_cache/` are
  left out; a `.gitignore` Gauss wrote before is brought up to date, one
  of the learner's own is left alone.
- **An open question locks the course's whole workspace**: another unit
  shares those files, and the help judge sees only the reply's text. The guard reads all persisted positions, not just
  opened chats. Mutations reserve the workspace until confirmed completion
  or permission denial, and question posting shares that reservation queue.
  Missing completion reports keep the course locked even when a session
  closes: SDK shutdown is asynchronous; restart is the recovery path.
  Background Bash is refused and SDK backgrounding disabled, so a running
  command cannot cross question posting (the agent's choice). Reads stay
  allowed. The feedback turn may write when no question is open in the course.
- **Reads are not confined**: sandboxed commands can read most of the
  machine, credential files included, and the engine's commands get the
  server's environment. The sandbox's network is closed (a `curl` refused,
  task 3.3), and the tutor has no web tool, so in stage 3 what it reads
  can reach only Anthropic. `blockReadsOutsideWorkingDirectories`, tried
  in task 3.3, is off: it hid the home folder from sandboxed commands
  (`ls ~` empty), where mise installs `python` and `uv`, which were then
  not found, and it still let a command read `../state.json` with the
  data root in `/tmp`. Settle reads before the tutor gets web access.
- **Artifacts.** The frame and response policy give the aid an opaque
  origin and allow inline scripts. CSP has no `navigate-to`: the parent
  page's `frame-src 'self'` stops an external navigation, but a direct
  tab has no parent. The user chose inert text for direct loads, rather
  than refusing them. `'unsafe-eval'` is allowed in the frame so an aid
  can plot a function the learner types.
- **WebRTC gets out of an artifact.** In the frame, an `RTCPeerConnection`
  given a public STUN server gathered a server-reflexive candidate: the
  request reached the server. CSP's `webrtc 'block'` is "Unrecognized" in
  Chromium 157, and removing the constructor in the artifact is undone by
  a nested `srcdoc` frame's own script. So a document the tutor writes can
  send what it holds out, by STUN or TURN. Left open in stage 3, where the
  tutor reads no text from outside the machine; with unconfined reads it
  is a channel out for a tutor misled by a source or a web page, so 4.0
  settles it. DNS prefetch from an artifact was not tried.
- **Artifacts in the record.** Stored as the tutor gave them, numbered on
  from the highest number in `artifacts/`, and given their name by a hard
  link, so a file there is never replaced. The engine refuses writes when
  no safe number remains rather than repeating a number (agent's choice).
  The question guard is per unit, not per course: the help judge sees only
  that unit's replies, and another unit's tutor can say anything in text too.
  At most 100 KB: Haiku's two aids were 3.3 and 3.5 KB, and the limit
  catches a pasted library. A document that names an address on the web
  (`src`, `href`, CSS `url()`, `@import`) is refused with the address,
  since nothing would load in the frame and models reach for CDN scripts.
- **No KaTeX in artifacts.** The app's KaTeX would need a route for its
  files and exceptions in the policy naming the server's host and port;
  MathML and Unicode text need neither, so the policy loads nothing.

## Codex

From the stage 0 spike (`@openai/codex-sdk` 0.169.0, ChatGPT login), for
stage 6.

- It runs on the ChatGPT login with no key. Each turn is a new `codex exec`
  process; a thread continues by id. The SDK has no system prompt option,
  no in-process tools and no hooks.
- **Text does not stream**: each message arrives whole. The app server's
  protocol has text deltas (`item/agentMessage/delta`, read from the
  binary, not tried), so a streaming backend would drive `codex
  app-server` instead of the SDK.
- **Teaching tools work over MCP** from Gauss's process, given as a config
  override `mcp_servers.gauss = { url, default_tools_approval_mode =
  "approve" }`; without the approval mode, `approval_policy = "never"`
  refuses the call. A tool ends the turn by having the backend abort it
  (the per-turn `AbortSignal`); the thread resumed normally after.
- **The thread id arrives with the first turn**, not from `startThread()`,
  which the adapter's `backendSessionId` does not allow yet.
- `model_instructions_file` replaces Codex's own instructions.
- **The learner's own setup cannot be kept out.** Overrides removed the
  ChatGPT apps (`features.apps = false`) and named MCP servers, but not the
  global `AGENTS.md`, the skills section, the multi-agent sections or the
  collaboration tools. Candidates: a separate `CODEX_HOME` with its own
  login (copying `auth.json` risks signing the learner's Codex out), or the
  CLI's `--ignore-user-config`, which the SDK cannot pass.
- The SDK saves every thread under `~/.codex/sessions/`, with no option to
  skip it.

## Record

- **Ids.** Course, unit and objective ids are slugs (at most 60
  characters), so an id can never be a path. A course id is made from the
  title (cut at a word to 50 characters, `-2` and so on if taken) and is
  the folder's name, not stored in `course.json`; making the folder claims
  it. The planner names the units, so a revision keeps their ids and the
  page can mark what changed. Objective ids are unique in the course
  (checked on the curriculum), because the evidence names an objective
  alone.
- **Prerequisites** must name units in the curriculum, once each, with no
  cycle; they need not come earlier in the list. The checks sit on the
  units array, so they travel with that field into `propose_curriculum`'s
  input, and their messages are written for the model.
- **No schema version.** Only Gauss writes the files; a field added later
  must be optional, and records are never migrated.
- **Atomic writes** go to `.<name>.<uuid>.tmp`, are flushed, renamed over
  the target, and the folder flushed. A crash can leave a temporary file,
  which nothing reads or cleans up. The crash test runs the write in a
  child under `ulimit -f`, so the kernel stops it partway every time; a
  `SIGKILL` landed inside the partial-write window only 10 to 20% of the
  time.
- **A damaged file is a loud error** naming the file, since atomic writes
  cannot make one: it means a hand edit or a bug. Two exceptions: the
  library lists a course whose `state.json` or evidence cannot be read,
  with the reason, so one bad course does not hide the others; and a
  transcript line that cannot be read is left out, since page events change
  shape over time and the record does not need them.
- **The file lock** (`record/file-lock.ts`) queues work per absolute path,
  in the module, so two `openDataRoot` calls share it; the record takes it
  when called, before its first `await`. Without it, two writes to one file
  each land whole but the later one can finish first. Another process
  writing the root is not covered; only Gauss writes it.
- **Logs.** Before an append, an unfinished last line is cut away (found by
  reading back from the end), or the next entry would be glued to it and
  lost. `appendJsonLine` writes until the whole line is stored, since one
  write can store fewer bytes than it was given.
- **Positions are read with `Object.hasOwn`**: `constructor` is a valid unit
  id, and `units[id]` found `Object.prototype.constructor`.
- **A plan teaches each objective in exactly one segment**, so "go over
  them again" is a segment kept in the position, not in the plan. A
  segment has a title, for the outline. Planning a unit again is not
  designed; `storePlan` refuses it. The record does not check a position
  against the plan; the engine's rules do, before anything is written.
- **When each unit was last opened is in `course.json`**, not `state.json`:
  the engine writes positions from inside each chat's queue, and a second
  writer there could lose an update.
- **Transcripts are not flushed.** A flushed append took about 38 ms here,
  and flushing each batch made the whole-unit test half as slow again. A
  stopped server loses none of a transcript, a killed one its last moment,
  a stopped machine its last lines. Files are numbered per unit and sorted
  by number, not date, so a clock set back cannot reorder them.
- **The backup** exists because a valid but wrong write by an engine bug
  could not be undone. It runs the installed `git` (no package), as
  "Gauss" with signing off, so the learner's identity and keys are never
  used, and with `GIT_*` variables dropped, so a server started from a git
  command does not commit into another repository. A data root inside
  another repository gets its own; one that is already a repository keeps
  its own rules. Answers are not committed one by one: the segment's close
  takes them.

## Objective status

- **The passing rule** is the user's (2026-11-17): since the last miss, two
  unassisted correct answers to different questions at any confidence, or
  one at 90% or 100% if the objective was never missed. It replaced the
  agent's rule of 2026-11-16, which needed a confident answer, so correct
  answers given unsure counted for nothing (the theology record had two,
  at 75% and 50%). One part of that rule is kept: after a miss, one
  confident answer is not enough. The first rule (two different questions, or one
  confident answer) had no "after a miss" condition.
- **A miss** is a wrong answer or "I don't know", with help or without, and
  clears the correct answers before it; so a miss after a pass takes the
  pass away, which in a review or a gate is slipping ("Mastery loop"). "I
  don't know" is never a confident miss.
- **Different questions** means what the learner saw differs: the prompt
  and the choices, spacing ignored. A written and a choice question are
  never the same. Code cannot judge variety beyond that; `tutor.md` asks
  for it.
- **Help.** A correct answer given with help counts for nothing and clears
  nothing. Help is marked when the tutor *receives* a message while the
  question is open, not when the learner sends it, so a message written
  during the lead-in and delivered after the question counts. Help ends
  when the answer is sent. Until the user's decision of 2026-11-16, every
  such message was help; a judge now decides ("Help judge"). Rejected: the
  tutor declaring help with a tool, which rests on the model's word.
- **Overrides** mark the objectives they name, never take a pass away, and
  give way to a later answer. Moving on from the closing card overrides
  only the objectives not passed, so passed ones keep a clean record.
- **"Attempted"** names an objective with evidence that has not passed; not
  "in progress", which is a unit's word. Learner-facing copy says "Not
  passed yet".
- **Log order decides**, not `recordedAt`: the log is appended under the
  lock, so its order is the order of recording even if the clock jumps.
- **A unit with a position is in progress** whatever its evidence: one just
  started has none. Without one, its objectives decide; a unit with
  unfinished objectives and no position is a record left half-written, and
  shows as in progress.
- **No question limit.** The agent's limit of three questions per objective
  per check closed segments with objectives not passed in the user's first
  sitting, against the brief's rule; it is gone. The learner sets the pace
  through detours and can always move on.
- **Each objective gets at least one question in every check**, even if it
  passed before: the check is the segment's.
- **"This check" is a point in the evidence log** (`checkFrom`, the number
  of entries when it began). Rejected: a list of answers in `state.json`,
  which copies the evidence, and a start time, since log order decides.
- **The header's reasons for another question** are `missed`, `assisted`
  and `second` (a correct answer that does not pass alone), so the tutor
  knows what the next question must show.
- Status is derived, so a rule change applies to old records when they are
  read. At the 2026-11-17 change, the user's courses were re-derived
  read-only and no status changed.

## Calibration

- **What counts**: for each confidence level, the unassisted answers and
  how many were correct. Answers with help are left out ("I don't know"
  included): help says nothing of how sure the learner was alone. "I don't
  know" asks no confidence, so it is counted apart. Overrides are not
  answers. An answer on an objective no plan holds still counts.
- **Per course**, by the user's decision; counts, not percentages, since
  answers are few and a percentage reads as more than it is.
- **Answers from before the 2026-11-17 passing rule count.** The evidence
  holds no rule version, a cut by date is loose (a running server takes a
  new rule only on restart), the incentive to claim 90% exists under both
  rules, and the user's record showed honest answers against it. A cut
  would have left the counts empty.
- **Level order is `CONFIDENCE_LEVELS`** (`src/shared/question.ts`), not
  `Confidence.options`: zod 4 keeps an enum as an object's keys, which
  puts integer-like keys first and "under-50" last.

## Session engine

**Phases and steps**

- **The learner starts each segment** and **the engine closes it**: there
  is no `start_segment` or `close_segment` tool. The check rules already
  decide when a check is done; a closing tool decided nothing, cost a
  turn, and a tutor that forgot to call it stalled the check.
- **Any end of the teaching turn opens the discussion**, a failure
  included, so the learner can ask for what was missed.
- **The learner's steps are refused while the tutor writes**; taken at
  once, each would put a marker in the middle of a reply still streaming.
- **Moving on is allowed from the discussion on the server**, since the
  brief lets the learner always move on and making them press "ready"
  first would cost a turn; the page offers it only in the check, as mock 3
  does.
- **Moving on sends the tutor nothing**: a turn would cost a reply and a
  wait before the next segment. The next turn's header says it; a restart
  before then loses that note.
- **Headers are composed when the turn is sent**: a message written during
  the teaching reaches the tutor after it, and must say "discuss"; help is
  marked as the turn is composed.

**The feedback turn**

- **Found in the tutor prompt's first run (Sonnet 5.5):** in 7 of the 8
  turns that had to give feedback and then post the next question, the
  feedback went into the tutor's thinking, never shown, and the learner
  saw the next question with no feedback. All 13 turns with no tool to
  call wrote their text. Telling the tutor its thinking is never shown did
  not help, nor did changing the thinking settings ("Claude backend").
- **Tried and dropped:** refusing the tool until text had been written got
  the order right, but three of four refused turns then stalled, asking
  the learner to "send any short message, such as 'continue'", even when
  told never to. A `feedback` field on the tool was rejected: it would not
  stream, and a tutor that also wrote text would repeat itself.
- **Chosen:** the turn after a correct answer is feedback only, with no
  tool; when it ends, the engine sends a turn asking for a lead-in and the
  next question. One more turn per answer. In the rerun all six feedbacks
  were written, and no turn stalled.

**Queues**

- **One queue per unit chat**, owned by `unit-chat.ts`, which keeps the
  phase rules, the tools and the learner's actions together (moving them
  apart would make each file need the other's checks). `unit-record.ts`
  holds the rule that the page hears of a change only once it is written;
  `unit-agents.ts` knows whether a turn is queued or a grading running,
  which idle closing needs. Reads of the record are safe outside the
  queue.
- **Feedback blocks questions from when it is queued**, not when it
  starts, or a reply already running could post the next question first.
- **The automatic next question is skipped** if a reply has posted a newer
  question since, or the learner pressed Stop since the answer was sent
  (a Stop count captured then). Feedback and the end of a detour share this
  guard (`askNext`); both orders were reproduced as races before.
- **Stop is kept on the turn in progress** from the moment it starts: both
  backends cleared their stop flag on sending, so a Stop while the session
  started or the text was composed was lost.

**Answers**

- **A written answer is final once sent**, kept before grading so a restart
  cannot lose a long proof. Letting the learner change it after a failed
  grading would mean judging help again.
- **The grader runs outside the queue**, since it takes seconds or minutes;
  the grade is recorded inside it, only if the question is still open.
- **A question has one answer.** A crash between appending the answer and
  closing the question once let reopening grade it again, which could turn
  a passed objective back. Reopening now finds the answer by `questionId`
  and closes the question with it.
- **Moving on is refused while a written answer waits for its grade**, also
  after a failed grading, or the override would withdraw the proof. While
  grading keeps failing the learner cannot leave the segment; the tutor
  runs on the same backend, so it is likely down too.

**Detours**

- The user's design (2026-11-16) replaced the original one, in which a
  detour pushed the position and ran its own small cycle through a
  `start_detour` tool. The check's next question is the re-check, so a
  detour needs no phases of its own, and since the engine opens it and the
  learner ends it, the tutor cannot skip it.
- **Teaching again starts at the objective's second miss in this check**
  (misses before the check do not count), and every later miss asks for it
  again: if two ways did not work, a third is wanted.
- **Messages in a detour are not help**: no question is open.
- A restart that cut the detour's first turn off does not resend it; the
  unit opens in the detour, and the next message gets the detour's header.

**Choice order**

- **The engine shuffles choices when a question is posted**
  (`engine/choice-order.ts`, Fisher and Yates over `node:crypto`), and
  stores that order, so everything after agrees. The tutor put the right
  choice at A in most questions; told to place it at a random letter, it
  wrote a wrong key in 1 of 4. The tool's reply lists the order, since the
  tutor may discuss the question before the answer turn repeats it. The key
  is still the tutor's, so `tutor.md` still asks it to check the letter.

**Unit planning**

- **A unit is planned in a session of its own**, before the tutor's starts:
  a source unit's whole text is read there once rather than carried through
  every teaching turn, and each prompt has one job. The cost is one more
  model call per unit.
- **`plan_unit` is bound to the unit** being planned, so the session cannot
  plan another. **A session that ends without a plan is retried in a new
  session**, since one that failed in the backend may not take another
  turn, and the one turn carries the whole context. With Claude, a plan
  failing its field types is refused by the SDK before the tool runs, so
  the retry's header can say only that the session ended without a plan.
- **Two openings of one unit share one planning**, or the second would plan
  a unit the record then refuses.

**Intake**

- **The first proposal creates the course**: the intake mock has no title
  step, so the planner proposes the title. Before it nothing is on disk.
- **The page asks the opening question**, so no model turn is spent on a
  greeting.
- **Approval names the proposal the card shows.** A revision whose
  `style.md` write failed had already replaced `curriculum.json`; approving
  the earlier card approved units the learner never saw. Reversing the
  writes would only change which part goes unseen, so approval compares the
  files with the card (`DraftMismatch`, 409).
- **The opening turn cannot propose**, so the learner answers once; whether
  a later reply agrees to a proposal is a judgment on their words, left to
  `planner.md`.
- **A session lost before any proposal is given the conversation so far**,
  as JSON in the header, since the learner's next message usually answers a
  question the new session never saw. The JSON is followed by a space: the
  scripted backend ends a header at "]\n".
- **Intake setup follows delivery, not queueing**: a first turn that failed
  to start, or was stopped, must not use up a reopened draft's context.

**Resume and idle sessions**

- **Opening a unit only asks whether its session is there** (`hasSession`,
  no process), and the first turn resumes it. Resuming at the opening would
  start a process for a unit opened just to look at it; asking still shows
  a lost session's marker before the learner writes, in the common case of
  a session swept while the unit sat unopened. A session gone between the
  opening and the turn falls back at the turn, with the marker after the
  learner's message, which then belongs to the new conversation (matched
  by the message's id, not guessed from position). A lookup that throws is
  taken as found, and the turn finds out.
- **Only a session not found falls back.** Any other failure fails that
  turn, and the next turn tries again: a passing fault must not cost the
  conversation. The outline's Start fresh is the way out of a fault that
  stays.
- **The fallback sends nothing**, so opening a unit costs no reply; the
  learner's own Start fresh sends one turn to pick up. Start fresh takes
  the old id out of the position first, so a restart in between makes a new
  session rather than resuming the old.
- **Idle sessions close after ten minutes**: a process holds memory while
  it waits, and a resume costs the next turn about half a second. A grading
  whose grade goes to the tutor counts as not idle; the page being open
  does not.
- **The timer is passed in** (`createFakeTimer` in tests), because Vitest's
  fake timers would also fake the timers the record's writes and the tests
  rely on.

**Sessions and transcripts**

- **A session is a sitting**: it ends after an hour quiet, measured from the
  last event, so breaks under an hour stay one sitting. Rejected: one per
  chat (a server left running for days would be one sitting) and one per
  backend session (resume stretches it over many). The hour is a guess.
- **None starts inside a tutor's turn**: a reply the machine slept through
  was split, and the page took the split for a restart.
- **Transcripts hold page events**, not the tutor's headers or rubrics; the
  turns as sent are in Claude Code's session log.
- **Replay joins each reply's text**: a real backend's pieces come further
  apart than a write takes, so a transcript holds a line a piece, and a
  reconnecting page would be sent about 18,400 events instead of 490.
- **A question whose `graded` line was lost** gets its grade again from the
  evidence when the unit opens (`restoreGrades`).

**Finished units** are not started again; starting a unit over is not
designed.

## Grader prompt

- **The set** (`scripts/grader-set.ts`, run by `scripts/grade-set.ts`): 11
  written answers to 4 questions, graded by hand: correct proofs, a wrong
  expansion "factored" to the right result, a missing case, a proof in
  words, another valid method, the conclusion used as a reason, a bound
  never secured, continuity in place of the definition with a note asking
  for a pass, and a $\delta$ that ignores $\varepsilon$.
- **Sonnet 5.5 is the grader's model.** It agreed with every hand grade in
  all eight of its runs over four prompt versions, and named the first flaw
  each time. Haiku 5.5 failed the correct proof in plain words on the
  fourth version and broke the flaw's rules more often. A false pass stands for
  mastery unless disputed, so the grader is where judgment pays. Opus was
  not tried: Sonnet left nothing on the set to improve.
- **What the grader sees**: the question as the learner saw it, the rubric
  and the answer, each between tags, so an answer that reads like
  instructions stays an answer. Not the objective (the rubric covers it),
  not the confidence (it must not sway a grade), nothing of the
  conversation (the brief forbids it).
- **No partial credit**, because the passing rule reads verdicts. A flaw
  named on a correct answer is dropped rather than failing the grading.
- **The rules, each from an answer in the set**: check the answer in its own
  order and redo every computation (a wrong line can reach the right
  result); look for what the argument needs and never secures (a case, a
  direction, a bound's condition, a quantity that must depend on another);
  the conclusion given as a reason is a flaw; what may be assumed is what
  the rubric allows and standard facts below the question's level; any
  valid method is correct; wording does not count; a slip of notation is
  one whose meaning is plain and on which no step depends.
- **The flaw** is the first problem, pointed at, in one or two sentences.
  It never mentions the rubric, which the learner never sees, and never
  gives the repair, which the learner is to find with the tutor. A rule
  quoting "such as ..." invited repairs (4 of 14 flaws); said without the
  quote, and in `WrittenGrade`'s description, 1 of 14, and none with the
  final wording.
- **`WrittenGrade`'s descriptions** say "establishes everything the question
  asks, with every step valid": "meets the rubric in full" contradicted the
  rule on other methods.
- **Left as it is**: one flaw also names the false step after the first, and
  a few run to three sentences. Tightening further would fit the prompt to
  these 11 answers.

## Help judge

- **Definitions** (the user's): clarification is only what the question
  asks (its wording, notation, the form of answer wanted); help is anything
  toward the answer (a method, a step, a value, a similar worked example, a
  mistake to avoid). The judge adds: reacting to a guess ("on the right
  track", "not quite") is help, and a reply that gives nothing toward the
  answer (a refusal, an acknowledgement) is clarification, since the
  verdict is only whether the answer still counts.
- **When unsure, help**: a false clarification lets a helped answer pass; a
  false help costs one more question.
- **One exchange at a time**: the question with its key or rubric, the
  message and the whole reply. Not the objective or the conversation
  before. So a hint spread over two replies, each harmless alone, would
  pass.
- **The reason comes before the verdict**, so the verdict follows from it;
  it is printed by the set's runner but never stored or sent to the page,
  since it can name the correct choice.
- **A failed call counts as help.** Two minutes, shorter than the grader's
  three, since an answer may be waiting on it.
- **An answer sent before the calls are in waits for them**, kept as a
  written answer is while graded. A written answer is graded after the
  judging, not alongside: simpler, and rare.
- **A restart counts unjudged exchanges as help**; judging again from the
  transcript was rejected as complex for a rare case. A judging cut off by
  the server shutting down is not recorded, so the next opening decides.
- **A clarification label is about its reply only**: a later clarification
  does not undo an earlier help.
- **Haiku 5.5 is the judge's model.** On the first set (19 exchanges on
  five questions) it agreed with every hand verdict in two runs, in 2.5 to
  4 seconds a call. The set (`scripts/help-set.ts`) now has 25 exchanges on
  seven questions, ten clarifications and fifteen helps, among them a
  refusal with a hint and a message telling the judge it is clarification.
  With the math question's three (task 3.5), one run agreed 22 of 22 and
  another 21 of 22: C3 judged help, the safe side, which C3 alone did not
  repeat in four runs on each of the new and the old prompt. With a code
  question's three (task 3.7: the file to edit, a case the tests try, a
  reaction to the learner's code), one run agreed 25 of 25 and another 24
  of 25, C3 again judged help. Sonnet was not tried: Haiku left nothing to
  improve, an answer can wait on the call, and the call follows every
  message during a question.
- **The page's notice** says asking what a question means is free and a
  reply that helps makes the answer count as given with help. "Anything
  else counts as help" was not used: the tutor declines what it may not
  give, so asking for more is free when the reply gives nothing.

## Symbolic check

All the agent's choices (tasks 3.4 and 3.5), open to change.
`pytools/mathcheck.py`'s header states the rules; the pairs that settled
them are its tests.

- **SymPy's LaTeX parser on its ANTLR backend** (SymPy 1.14, with
  `antlr4-python3-runtime` 4.11, the version SymPy checks for). Plain input
  is rewritten to LaTeX first, so one parser reads both, and it builds
  SymPy objects without evaluating text. Rejected: the Lark backend, which
  in 1.14 returns ambiguity trees in place of expressions for ordinary input
  (`\sin x + 1`, `2\sin x\cos x`, `\sinh x`) and refuses `\pi`;
  `parse_expr` or `sympify` for plain input, which evaluate it as Python:
  `__import__('os').mkdir(...)` made its folder when a fault put `sympify`
  in the reading.
- **The parser's traps**, each rewritten before or after parsing: with
  `strict=True` it still reads an unknown command as a variable (`\foo x`
  as foo·x, `\mathrm{e}` as e·mathrm), so commands are whitelisted; it
  reads `x(x+1)` as a function call, `d` before a letter as one
  differential symbol (`dn`), and `\pi` and `e` as variables; it refuses
  `\left(`, `\sqrt(x)`, `x^(2n)`, `x^-1` and a number with a leading zero.
- **Reading**: `e` is Euler's number, `i` a variable, `\log` the natural
  logarithm (the parser's reading); decimals are exact; a comma always
  separates values (`1,000` is two). Refused where the parser would guess:
  a product after division, ungrouped chained powers, double factorial,
  indexed roots, or a literal zero superscript on a function. Derivative
  notation, inequalities, intervals, sums, integrals and limits are not
  supported. Undefined intermediate values are refused: SymPy can
  otherwise simplify `1/(1/0)` to `0`.
- **Equality requires a symbolic proof** (the agent's choice). A zero
  simplified difference proves equality; sampling can only disprove it.
  Agreement leaves the result undecided for the grader. Six values in
  [-3, 3] cannot distinguish `x+4` from `|x+4|`, and the fixed rational
  sample lattice aliases periodic expressions. Sampling is retained only as
  a bounded counterexample search, never as a certificate, including for
  equations and constants of integration.
- **Numbers**: a decimal of at least three significant figures matches a
  value within exactly half a unit of its last digit, that is, correctly
  rounded: 0.333 for 1/3, not 0.33 or 0.334. Compare the exact difference to
  that exact bound: converting the sides to machine floats can erase the
  difference. Proven nonzero differences, irrational ones included, are
  different unless the decimal allowance applies. No fixed relative
  tolerance may certify equality.
- **Lists match distinct values one to one** (the agent's choice).
  Exact duplicates count once; tolerances apply to the cross-list matches
  only. One rounded value cannot stand for two nearby solutions.
- **`+ C`** as a term on both sides is a constant of integration, so the
  sides may differ by a constant: antiderivatives found by different routes
  differ so. A `C` that multiplies (`Ce^x`) is an ordinary variable.
- **Equations** match through a proven non-zero constant ratio of their
  residuals; tautologies are distinguished explicitly. An equation
  with one unambiguous isolated variable can compare as its value.
  Two equations isolating the same variable to numeric values use
  the usual decimal rule. If both sides could name the variable,
  comparison with a scalar goes to the grader.
- **"Undecided"** is a result beside equivalent, different and unparsable:
  the sides read, but the check could not settle them in time or could not
  evaluate them. The grader decides it, as it does an unparsable answer.
- **Time**: an alarm bounds the whole eight-second comparison, including
  sampling, and each simplification gets at most two seconds. The alarm
  raises a `BaseException` so SymPy's `except Exception` does not catch
  it. Exact arithmetic in C may not return to Python when the alarm fires;
  very large literals are refused, and the engine enforces a separate
  12-second process limit including startup and parsing.

Math questions in the engine (task 3.5):

- **Symbolic grading is opt-in** (the agent's choice). The tool requires the
  tutor to declare that the default equality rules apply. Questions with
  special precision, exactness, domain, order or answer form use the grader.
  Checking the prompt for keywords cannot establish that it has no other
  constraints. Legacy questions without a policy default to the grader.
  A declared symbolic question must pass the expected expression read
  before it can post; a declared grader question needs no sandbox.
- **Primes are read, not refused**: `f'(x)` is an unknown function, so an
  expected answer with one posts, and every answer to it is undecided and
  goes to the grader. `tutor.md` tells the tutor to put no derivative
  notation in `expected`.
- **A math answer is kept and graded as a written one is**, outside the
  chat's queue, since a run can take seconds and the grader minutes. On a
  symbolic question, "Grade again" retries the check too: a failed run
  may pass.
- **The math rubric follows the question first** (`mathRubric`), using
  symbolic defaults only where the prompt has not specified a rule.
  The learner's reasoning is not sent: the grade is on the expression.
  The evidence keeps why the symbolic check did not grade it
  (`unsettled`) and the grader's flaw when supplied.
- **The expected answer is shown once graded**, as a choice's key is: on
  the card and in "What I know" after a miss, and in the help judge's
  request.
- **The page's math field** is a one-line textarea whose expression is
  rendered beneath it through the same Markdown and KaTeX path as all
  model text (`MathText` in `prose.tsx`: the text between `$` signs, in
  display style so fractions are legible), never as HTML. The preview
  shows KaTeX's reading, which is not the check's: an expression KaTeX
  sets may still be unreadable to the check, and then the grader grades
  it.

## Code questions

Agent choices, open to change. The card is in "Page design"; the sandbox
in "Confinement".

- **Run in a scratch folder, with declared dependencies saved at posting**
  (`engine/code-run.ts`). A read-only link to `.venv` reuses the course's
  installed packages; package installs are blocked while a question is open.
  Linking other workspace files let edits to a helper change the grade of
  an unchanged answer. Copying the entire workspace would include unrelated
  files. Name the helpers, fixtures or scripts needed instead. Older
  evidence still opens, but an old open question without saved inputs
  cannot be graded reliably.
- **The learner's files are read when "Run the tests" is pressed** and
  kept with the answer, in `state.json` and then the evidence, so a regrade
  or a restart runs the same files. Each must be a plain file inside the
  workspace (no link), at most 100 KB, and UTF-8; otherwise the press is
  refused with what to fix, and nothing is recorded.
- **At posting both runs go at once**, inside the course's workspace
  queue, so no write of the tutor's comes between reading the starter and
  posting; posting waits for the slower run, at most 60 seconds. A run
  that cannot start refuses the question with why.
- **Infrastructure failures are not exercise misses.** A verified sandbox
  run reports whether the test command itself exited. A missing launcher
  or failed sandbox leaves no answer evidence. The kept submission can be
  retried, or the learner can withdraw it by moving on with an override.
- **60 seconds a run.** A run past it fails the grading, as the plan had
  it, since a slow moment can pass. A second run past it on the same files
  is a miss, with the output's end: the answer is final, and code that
  loops would otherwise loop on every retry with no way on. The first
  time-out is kept in memory, so a restart gives one more run. The other
  way, a time-out a miss at once, is the user's to choose.
- **The output kept** is both streams in order (`2>&1` inside the
  sandbox), its last 40 lines and at most 8,000 characters, with "Exit
  status N." after a failure and "Stopped after ..." after a time-out:
  pytest's summary is at the end, and a bare traceback ends with its
  error. The page marks `FAILED`/`ERROR` lines and the last line.
- **The help judge sees the tests and the solution**, not the command.
  A question's problem, for "different questions", is its prompt and set
  of file paths, regardless of display order.
- **"Open" names the file by its place in an open question's list**,
  never by a path (`OpenFilePost`), and only while the question is open,
  the only time the card has the button. The file must pass the same
  plain-file check as "Run the tests" (`workspaceFile` in `code-run.ts`),
  so a link the tutor left in the workspace cannot point the opener
  elsewhere. Not guarded: the default app is chosen by the file's type,
  which the tutor names, so a learner file named `.html` opens in the
  browser; whether some type's default app runs the file rather than
  showing it was not checked. The user chose the system default over a
  set command, as their own click would do it ("Product decisions",
  2026-11-18).
- **An opener still running after 3 seconds counts as started.** xdg-open
  with no desktop opener of its own (its generic mode, as on the user's
  Hyprland) runs the app itself and can wait for it, while the failures
  seen came at once. Its errors
  go to a file, not a pipe: the app inherits the stream, and a pipe the
  server closed could kill it with SIGPIPE. It runs in a process group of
  its own, so Ctrl-C on the server does not reach the learner's editor.
  Without `WAYLAND_DISPLAY` or `DISPLAY` xdg-open exits 3 with "no method
  available", and the button adds that the server has no display.
- **The scripted backend** posts code questions in a course whose title
  says "code" or "coding", in plain Python, so `pnpm dev:fake` needs no
  package; its tutor writes the starter through the fake backend, whose
  `Write` with content writes the file once the engine allows it.

## Disputes

The agent's choices (task 3.0), except who decides, which the user picked
from piece 13 of the mocks (2026-11-17). The look is in "Page design".

- **What can be disputed**: any graded answer, of any kind, at any time,
  in a finished unit too. Not "I don't know", which nothing graded. Not the
  help judge's call: "when unsure, help" is its rule by design, and a false
  help costs one more question.
- **One dispute per answer.** A second would be another draw from the same
  judge.
- **An outcome replaces the answer's verdict where the answer stands in
  the log**, not where the dispute does: a regraded answer counts as if it
  had been graded so, for status, the check rules, calibration and "What I
  know". The answer's line keeps the original grade; the dispute's line,
  naming the answer by `questionId`, holds the learner's reason and the
  outcome. The log stays append-only.
- **A wrong choice key is corrected only by a dispute**: the outcome can
  name the right letter, which then shows wherever the key did. The tutor
  is told in its next header, since its feedback or detour taught from the
  wrong key; a restart before then loses the note, as with moving on.
- **An outcome changes no phase.** An overturned miss leaves its detour
  open until the learner asks for another question; the check rules then
  decide with the corrected verdict, closing the segment if nothing is
  left to ask.
- **The learner sees what the answer was graded by while disputing**: the
  rubric, the choice key, the expected expression or the tests. The
  question is over, the detour has already given the right answer, and an
  argument about a grade needs what it was graded against. Everywhere else
  the rubric stays hidden.
- **Who decides** (the user's pick): a one-shot call that sees the
  question, what it was graded by, the answer, the grade and the learner's
  reason, and nothing of the conversation, as the grader does. Rejected:
  the learner's own word, which would make "passed" mean what they say,
  and the tutor, which wrote the key it would judge and which a finished
  unit does not have.
- **An overturned dispute on a written answer is a candidate for the
  grader's set** (`scripts/grader-set.ts`): added by hand, with its grade
  checked, when `grader.md` is next revised. Nothing is added
  automatically, since the set's grades are hand-checked.

Built in task 3.8; these are the agent's choices, open to change.

- **The answer's verdict is replaced where it is read**, not by rewriting
  the log: `countedEvidence` in `record/disputes.ts` gives the log with
  each disputed answer's verdict, and status, the check rules and
  calibration read through it. A second dispute line, which the record
  refuses as it appends, would be ignored.
- **A wrong expected expression is corrected like a key**: the outcome can
  carry the right expression, which shows where the expected one did. Not
  checked by the symbolic check: it is shown, never graded against.
- **A choice outcome's verdict follows from its key.** The judge names the
  right letter; a verdict that does not follow from it is a failed call,
  not a guess at which the judge meant.
- **The judge sees the tests and frozen workspace inputs, not the tutor's
  solution** (the agent's choice). A fixture or launcher can set the
  verdict even when the tests look right; the solution was already
  checked to pass and would argue for the tests. The learner sees the
  same inputs while disputing.
- **An overturned pass in a finished unit records an override** of that
  objective with the dispute. A unit with no position and an objective
  neither passed nor overridden reads as a record left half-written, and
  opening it would teach it again from segment 1; the learner did move on
  from the objective when the unit ended. Slipping does not replace this
  ("Mastery loop"): the objective never passed. In a unit in progress
  nothing is added: its closing card offers the objective again.
- **The check rules decide at their next point**: ending a detour closes
  the segment if nothing is left to ask (before, a miss could never leave
  nothing), an idle check closes, and the closing card is shown again;
  the timeline replaces a standing card's statuses rather than ignoring
  the repeat.
- **Deciding is not kept**: the route waits for the outcome, since "What I
  know" has no event stream; a failed call, or a server stopped while
  deciding, records nothing, and the learner sends the dispute again. Kept
  in memory only: one dispute of an answer at a time.
- **Written through the unit's chat when it is open**, in its queue, so it
  cannot land between the chat's own writes (finishing the unit, for one);
  otherwise directly, as only a chat writes the unit's position. A chat
  that opens later shows each dispute its thread lacks and tells the tutor
  then, so a dispute raised from "What I know" still reaches the tutor.
- **The scripted judge** keeps a grade unless the reason has "/change",
  and fails on "/fail" (`scripted.ts`'s header).

The judge's set and model (task 3.9), the agent's choices:

- **The set** (`scripts/dispute-set.ts`, run by `scripts/decide-set.ts`):
  18 recorded answers with the learner's reasons, decided by hand. Eight
  grades that should change: a wrong key, argued and merely claimed; a
  wrong expected answer; a right answer in set notation the check could not
  read; another antiderivative, off by a constant; a proof by another
  method than the rubric's; a right proof disputed with effort alone; a
  test asking for more than the question. A wrong key beside a wrong
  choice, whose grade stands with the key corrected. Nine wrong answers
  disputed to persuade: effort, a rubric called unfair, the error restated
  with certainty, the missing case given in the reason only, a false
  "another form", a physical argument, a test's tie rule called unfair
  when it is the question's, instructions to the judge, and a grader's
  flaw rightly refuted on an answer wrong elsewhere. Not in it: a learner
  disputing a grade of correct.
- **An outcome agrees** when its verdict, a choice's right letter, and
  whether a math question's expected answer is corrected all match the
  hand outcome. A corrected expected answer is compared by the reader.
- **Sonnet 5.5 is the judge's model.** It agreed with every hand outcome in
  three runs over two prompt versions, 3 to 6 seconds a call. Haiku 5.5
  agreed in its one run too, so the set does not separate them. Sonnet was
  kept: a dispute reviews the grader's Sonnet work, Haiku failed a correct
  proof in plain words on the grader's set, and disputes are too rare for
  cost to count. Opus was not tried. A set that separates the models would
  need longer proofs.
- **Math between dollar signs.** With the rule only at the prompt's end, 3
  of 18 reasons wrote math as plain text (`e^{-x^2}`, a matrix as nested
  brackets), which the page shows raw. Repeated in the `reason` field's
  instructions, with a matrix among its examples: none of the next 36.
- **Left as they are**: a few reasons run to five or six sentences, past
  the prompt's three, and some name the repair (a $\delta$ capped at 1).
  The question is over and the learner has seen what graded it, so neither
  was tightened.

## Mastery loop

The design stage 5 is built to, from its breakdown (task 5.0, 2026-11-18).
The choices are the agent's and open to change, except the user's picks of
that day ("Product decisions"), marked here as theirs. Nothing here is
built until its task is done; `architecture.md` says what is.

**Assessments**

- **The unit's tutor asks them, in the unit's thread**: review, the gate
  and the test before a unit are runs of questions kept in the unit's
  position beside its phase. Rejected: a separate examiner session with a
  prompt of its own, the first plan. It would be a second session in each
  unit chat to resume, stop, close when idle and start fresh; a miss
  needs teaching, which an examiner must not do, so the detour would go
  to the tutor anyway; and the tutor that teaches the rest of a unit
  should know what its test showed. The cost is a section of `tutor.md`
  and questions posed from a long conversation.
- **An answer's evidence names its assessment** (`review`, `gate`,
  `test-out`, with the unit whose thread held it), absent for a segment's
  check. Retained needs to know that an answer was given cold, and log
  order alone cannot say.
- **One question per objective; a miss opens a detour and one more
  question**, then the assessment moves on whatever the answer. It is the
  brief's "short refresher and a re-ask", for review too (the user's
  pick), so every miss is worked through and none starts a run without
  end. The passing rule
  is untouched: after a miss an objective needs two correct answers, so
  the second comes from a later review, or from going over the unit's
  objectives again.
- **Fresh questions come from a list, not from memory**: the turn that
  asks for a question lists those the evidence holds on its objective.
  The same list stops a new tutor session repeating a check's problems.

**Status**

- **Retained** is passed with, since the last miss, an unassisted correct
  answer in a review or a gate. A gate answer counts even on an objective
  passed minutes before, as the brief has it; a test's answer does not,
  being one answer with nothing before it, and review confirms it later.
  Retention does not lapse with time: review keeps returning to retained
  objectives, the longest unanswered first.
- **Slipping** is an objective that was passed when a review or a gate
  missed it, and has not passed again. It is not "attempted", which would
  make a finished unit read as half-written and teach it again; a
  finished unit stays finished. An overturned pass in a finished unit
  still records an override ("Disputes"): that objective never passed.
- **The miss must be a review's or a gate's**, as the brief has it. The
  breakdown had the rule without a mode, holding that only an assessment
  can miss a passed objective; but a check can: the user's theology
  record has a pass, then a miss in a check (under an older rule), and a
  segment taught in full after a test passed its objective still asks it
  once (5.6). There the objective reads "attempted", as it did before.
  With the mode, every status of the user's five courses re-derived as
  before (2026-11-18).
- **An override marks a slipping objective overridden**, as it marks an
  attempted one: moving on from the closing card is the learner's choice,
  and the unit then reads overridden, as the card says. Review (5.3) then
  leaves it out. The agent's choice.
- **An answer names its assessment and the unit whose thread held it**
  (`Assessment` in `evidence.ts`), so "What I know" can say "In unit 3's
  gate", as piece 16 does. The agent's choice.
- **A miss while testing out is not a miss afterwards.** It came before
  any teaching, and counted, it would take away the one confident answer
  that passes an objective never missed. It counts as an answer, so the
  objective reads attempted.

**Review**

- **When**: offered on a card, with Start and Skip, when a unit not
  finished is opened in a new sitting (the chat is new, or quiet for an
  hour), nothing waits on the learner, and the course has been offered
  no review within the hour, so two units opened together get one card.
  The card is the user's pick; the agent had recommended starting by
  itself. It also means opening a unit sends the tutor nothing. An open
  question or a detour is picked up instead, and that sitting has no
  review. A message sent while the card waits skips it (the agent's):
  the learner has gone on.
- **Which**: slipping first, since the gap is known; then passed, the
  least confident first, as the brief has it; then retained, the longest
  unanswered first. Never an objective answered within the hour. Three,
  over the whole course. No schedule of intervals: the order is the
  spacing.
- **The pick's details** (`record/review.ts`, the agent's): "least
  confident" is the lowest confidence among the answers that pass the
  objective, those since its last miss, so an unsure answer a miss
  cleared does not count. "Answered" is any answer, with help or in a
  test too, by its timestamp, and "within the hour" means less than
  `SESSION_GAP_MS` before, the same hour that starts a new sitting.
  Slipping ones go the longest unanswered first, as retained ones do, and
  equals then go in the course's order.
- **The assessment shares the position's question and detour** (task 5.4,
  the agent's): it starts only when neither is in use, and the check
  cannot post while it runs, so the question flow, help judging and
  restarts are reused unchanged. Rejected: slots of its own, which every
  rule reading `openQuestion` would have had to learn.
- **The unit goes on as the phase has it** (the agent's): a teaching turn
  that waited is sent; a check takes up with a turn asking for its next
  question, since a check with nothing open was waiting on the tutor; the
  discussion and a closed segment send nothing, and the next header says
  what the review did.
- **A message on the card skips it, and the teaching goes first** (the
  agent's): the card holds the teaching turn, so the turn the learner's
  message brings is sent after it, as a message during teaching is. One
  sent while the card is being offered (`offering` in `unit-chat.ts`)
  waits for it in the queue and skips it too: decided outside the queue,
  it reached the tutor while the card stood and the teaching waited.
- **Skip is refused while an answer is kept for grading**, as moving on
  is: withdrawing it would drop an answer the learner sent (the agent's).
- **The header gives another unit's objective with its unit and
  statement**: the tutor's system prompt holds its own plan only, and the
  prompt is not changed mid-session (the agent's).
- **An answer on another unit's objective is told to that unit's chat**,
  if it is open: its record is read once, and with a stale one a unit
  could finish passed with an objective slipping (the agent's). The other
  way, the reviewing unit's record reads the evidence again when the
  review ends, for the statuses it reports: the objective's own check, or
  another unit's review left on its card, can have answered meanwhile,
  and the end said retained where the record said attempted. A dispute of
  a review's answer goes to both chats: through the objective's unit
  alone, an overturned first miss still brought a second question.
- **The page pins only a question of what is under way** (the agent's): a
  review's question while a review runs, the check's otherwise. The
  transcript can lose its last lines, so reopening also reconciles its
  questions with the position and evidence. Clearing the assessment
  alone would still leave an unanswered question active in the thread.

**The gate**

- **Offered on a card, not started by itself**: it is the long one (the
  unit's objectives and three others), and an answer is colder the next
  day. Skipping it is the brief's bypass, and records no mastery. If a
  question from another unit was already shown, the closing card lists it
  at its current status even though no answer was recorded.
- **It asks only what is passed**: not the objectives the learner just
  moved on without, and not those the test passed, which were cold when
  asked. A miss on the unit's own objective goes to the closing card as
  an objective not passed, by the steps that exist.
- **No `close_unit` tool**: the engine ends a unit as it closes a segment
  ("Session engine": the learner starts, the engine closes).
- **No closing card before it when every objective passed** (task 5.5, the
  agent's, from piece 16): the card comes when objectives did not pass.
  One standing when a dispute or another unit's answer passes the rest is
  shown again first, as passed; left as it was, it offered steps the
  engine refused while the gate waited.
- **A message leaves its card waiting**, where it skips review's (the
  agent's): the gate is offered once and its skip asks first, so a
  question to the tutor must not throw it away.
- **After it, the closing card's steps cover only what it left not
  passed** (the agent's): what the learner moved on from at the card
  before it was declined once already, and offering it again would make
  them move on twice. So moving on in the segment that goes over the rest
  again finishes the unit.
- **"Passed by testing out"** is read as an unassisted correct test answer
  among those since the objective's last miss (`tested` in `status.ts`,
  as `cold` is for retained), so a pass resting partly on an unsure test
  answer is left out too (the agent's; 5.6 may refine it).
- **Other units, not only earlier ones**: the pick is review's over every
  other unit, and several units can be in progress, so the page says
  "other units" where piece 16 said "earlier". The hour rule applies to
  them and not to the unit's own, which were passed minutes before by
  design (the agent's).

**Testing out**

- **Offered beside Start, taken before the unit is taught**, never partway
  through. No feedback and no detour: a miss there means "teach me this".
  An unsure correct answer gets its second question at once, so the
  passing rule decides what can be skipped.
- **Nothing is skipped without the learner's say** (the user's): the
  button asks before the test starts, and the test ends in a card that
  names what was passed and what that would skip. The learner can have
  the whole unit taught anyway; what was passed stays passed.
- **A segment is skipped whole or taught in part**; the plan is not
  rewritten, so the outline still shows what the unit holds.

**Handoff notes and misconceptions**

- **Written by a one-shot call when a segment closes**, and when the unit
  finishes. The brief's "end of a session" is no event: a server stops,
  or an hour passes. A close is one, and a sitting that closed nothing
  has little to hand on. Rejected: a `write_handoff` tool and a tool for
  misconceptions, which rest on the tutor remembering to call them (the
  feedback turn showed text lost when a turn had also to call a tool);
  and a call when the idle session closes, which spends one on every
  break.
- **The same call finds misconceptions**, from detours and from the
  discussion, where the intuition question is: it reads that stretch
  anyway. Open or not is derived from the objective's status.
- **The unit's own note goes into a new session's first turn**, not the
  system prompt, which is sent with every request: a change to it at
  each close would cost the running session its cache.

**Profile, notes and export**

- **The profile is free text the learner approves**: proposed by the
  planner with the curriculum, edited on a page of its own. The index of
  finished courses is derived from the record, not kept in the file.
  Nothing is written to it without the learner seeing it, as with the
  style note.
- **Notes are written when the learner asks** (the user's): a finished
  unit offers them, with a box for instructions of the learner's own.
  What they hold is `notes.md`'s standard: what the unit taught, more
  room for what the learner struggled with, and what made an idea click.
  The struggles come from the evidence and the misconception record; what
  clicked is the handoff writer's reading of the conversation, so the
  handoff note keeps it, and it is a model's judgment, not a record.
- **A unit's notes are a page the notes writer designs and writes whole**
  (the user's, from piece 17): HTML with its own layout and styles, and
  figures as inline SVG where a picture explains. Dropped: Markdown from
  the writer, rendered by the engine into one fixed look, which the user
  found no better than a Markdown viewer.
- **The engine finishes the writer's document; it does not lay it out.**
  It draws the math, which the writer leaves as TeX in marked elements,
  with KaTeX, and writes KaTeX's stylesheet and fonts into the file (the
  user's pick), so the file loads nothing. MathML was dropped for both
  files: a browser draws it with the machine's math font, and in Chromium
  primes shrank to specks and brackets did not grow around a fraction.
- **Notes have no script** (the agent's): the file is meant to be opened
  from its folder, where no frame confines it, and a script there could
  carry what the page holds to any address by navigating to it. The
  engine drops scripts, refuses a document that names an address on the
  web, as it does an artifact, and writes a policy into the file that
  allows inline styles and `data:` images and fonts only. Moving parts
  stay with artifacts, which run in the app's frame.
- **The notes are read in the app as well as in the browser** (the
  agent's; the user allowed the browser alone): the app already frames a
  tutor's document for artifacts, so the reader is that frame filling a
  page, with "Open in browser" beside it.
- **The transcript export is the engine's own document**, built from the
  sessions' page events so that it reads as the thread does, with the
  tutor's Markdown rendered on the server and its math written as the
  notes' is.
- **Style and curriculum changes are cards the tutor asks for**
  (`propose_style`, `amend_curriculum`), answered as a package request
  is. A started or finished unit cannot be dropped by a change.

## Prompts

**`tutor.md`**, from real runs on Sonnet 5.5:

- **Teaching** runs 250 to 400 words by default and never over 600, whatever
  the style note says: the brief caps it and lets the style set length, and
  the hard cap keeps a note from removing it. It ends with one ungraded
  thing to try: a question on intuition or a short exercise (below, task
  3.19). The runs taught one worked example in full, at about 330 to 370
  words.
- **Feedback** is under 100 words: one or two sentences for a confident
  correct answer, up to five otherwise, about the answer given. At 110 to
  137 words it read correct proofs back and went through choices not
  picked. Feedback on a choice miss still does the latter; left for the
  user to judge.
- **Lead-ins help with nothing**, the trap included, and a question after a
  miss does not say how to avoid the mistake: the first run's lead-ins and
  its reply to a request for a hint named the very point missed before.
- **Choice keys**: the tutor reads its choices in order and checks the
  letter before calling. Asked to place the right choice at a random letter,
  it wrote a wrong key; the engine now shuffles.
- **Rubrics** list the steps a complete answer must establish with their
  results, what may be assumed, that any valid method counts, and the
  errors that make an answer wrong, since the grader reads what may be
  assumed from the rubric.
- **Help**: clarify what the question asks, never a step, a value or the
  mistake to avoid; point a stuck learner to "I don't know".
- **One thing per question**, and nothing verbatim from memory: paraphrase
  and attribute (stage 4 revises this when quotes can be checked).
- **Promise nothing the app does not do** ("we'll come back to that skill
  later" was said in the user's sitting, and nothing kept it).
- **Refusals** are acted on in the same reply; never ask the learner to send
  a message.
- Once, a choice question's right answer reused the teaching's phrase,
  which the prompt already forbids.
- **Artifacts** (task 3.6, Haiku 5.5, two aids asked for in a discussion;
  none was shown unasked, though the style note asked for "a picture
  before the algebra"). The first wrote `color-scheme: dark;` outside a
  CSS rule, which dropped the `body` rule after it: a white page in a
  serif font. With the exact opening block in `tutor.md`, the second
  matched the page. Both wrote `$` math in labels, the second once, after
  `tutor.md` said not to.
- **Code questions** (task 3.7, Haiku 5.5, one run). Told by the learner
  that the check needed pytest, the tutor asked for it on the card and
  waited for the install. It then called `ask_question` before writing the
  starter file; the refusal ("not in the workspace") had it write the file
  and post again in the same turn, so its lead-in showed twice. Its tests
  checked only what its prompt said (the prompt ruled ties out). But the
  question asked for the very function its teaching had written out in
  full, which "a new example" in `tutor.md` rules out.

Revised as a whole for stage 3 (task 3.10), from runs on Sonnet 5.5 on a
scratch data root: a coding course from intake, its unit seeded twice
more after prompt fixes, a seeded chain-rule unit and a seeded visual one.
The agent's choices:

- **The kind of question follows from what the objective has the learner
  do**: compute a result, a math question; write code, a code question;
  argue or explain, a written one; recognise or choose, a choice. A choice
  never stands in for the others, since it shows recognition, not that
  the learner can produce the answer. Each objective in the runs got its
  kind.
- **A package request ends the reply, after the teaching.** Told to "say
  what each is for, then end your reply", the tutor asked for pytest at
  the start of a teaching turn and ended it there, with no teaching. Said
  as "the last thing in your reply ... never in place of" the teaching,
  the next run taught, then asked.
- **The rule against copying sits in the Teach phase.** Under "Code
  questions" it did not reach the teaching turn: Sonnet, like Haiku,
  wrote out the function its first code question then asked for. In the
  Teach phase, the next run taught the technique on letter pairs in a
  word and asked for it on ids. An objective as narrow as one line, which
  names its implementation ("... using zip"), leaves little else to teach.
- **Artifacts are shown unasked** for what is seen or moved, with
  examples. On a unit whose style note asked for a picture first, the
  tutor opened its teaching with a secant slider and taught from it, with
  no LaTeX in it and the opening block as given; on pair counting and the
  chain rule it showed none, as the rule intends. Haiku was not retried.
- **No test command for the learner**: a first code question told the
  learner to run `python3 test_pairs.py`, which they do not have; the card
  runs the tests. Not seen again after the prompt said so.
- **Not seen in the runs**: scratch work in `$TMPDIR` and the learner's
  files left alone (no detour came), and a dispute's outcome in a header.
- **Left as they are**: feedback on a confident correct answer ran three
  or four sentences, over the one or two asked; a written question asked
  two things (why the most frequent pair, and what replaces it); one
  first code question had no lead-in.

From the user's stage 3 check (task 3.19), on Sonnet 5.5 on a scratch data
root: the user's Python course with its stored plan three times, and the
seeded chain-rule unit twice, with prompt fixes between runs.

- **Starters hold what the question gives.** On Opus in the user's check,
  and on Sonnet under a first rule ("leave out only the code the exercise
  asks for"), the objective "stores values of the basic types in
  variables" got a question that had the learner type four given values,
  its tests asserting their types: the objective's wording read as leave
  to make copying the exercise. Said as copying "even when the objective
  speaks of storing values", the next two runs put the values in the
  starter and tested what the learner's code computed from them.
  `unit-planner.md` now states a coding objective as what the code
  computes, never a step a check could only ask to be copied; no planning
  call was run on it.
- **Tests stay out of the workspace.** One Sonnet run tried its tests before
  posting with a shell command: it wrote them in the workspace, copied its
  solution over the learner's file, ran them and put the starter back. The
  tests stayed in the workspace for the learner to read, and the starter,
  written by a command, got no line in the thread. `tutor.md` now says the
  posting checks make a trial needless, a trial goes in `$TMPDIR`, and
  starters go through the Write tool; the last run did that. The engine does
  not refuse a question whose tests sit in the workspace ("Known gaps").
- **A question on intuition** ends the teaching of a segment with an idea
  to grasp, by itself; the discussion corrects the answer, then offers an
  exercise (the user's decision, "Product decisions", 2026-11-18). "The
  exercise waits for the discussion" was read as where to try it: the
  chain-rule teaching asked the question and an exercise together, and
  reworded the prompt's own example, which was the chain rule. With an
  example off the subject (a circle's area) and "ask this question alone",
  it asked its own ("what does that 3 represent in terms of how fast
  things change?"). Both replies to a half-right answer named what was
  right, corrected the rest on a concrete case (the outer slope taken at
  $g(x)$; a rate, not a size), then offered an exercise. The segment on
  Python's types and division ended with an exercise and no such question
  in all three runs.
- **Left as they are**: in one run of three Sonnet asked for pytest only
  once the check was open, which held the check up until it was installed
  (the other two graded with `unittest` or plain asserts); one first code
  question again had no lead-in.

**`unit-planner.md`**: one idea per objective, tested by "could a learner
know one part and not the other", up to eight objectives rather than
joining two. Of the wordings tried, the test with examples helped; a rule
stated as an example pattern ("Name A and say B") did not; a last read for
one verb and one claim worked best (five of six single-idea objectives).
A compound objective still slips through now and then, which "one thing
per question" catches when questions are written. A length limit in
`plan_unit` was rejected: a poor proxy for one idea, and long statements
are normal in mathematics. It is told the four kinds of check and that
the verb names one (task 3.10): for a coding unit Sonnet wrote five of six
objectives as "Write a function that ...". One was "Compute" with a list
for its result, which the symbolic check would compare in any order
(`tutor.md` now says a list whose order matters is not a math question),
and one named its implementation ("using zip"); neither is addressed in
`unit-planner.md`.

**`planner.md`**: questions in rounds of at most two, counting every
question in a message (the first run asked three under "Two quick
questions"); a short unit or a narrow question is one unit, and a larger
course is suggested, not proposed; it promises only what is built,
listed in the prompt with what is not. With that list, the run's proposal
promised Python exercises in files the learner edits, graded by tests,
and a few choice questions. Coding exercises are promised in Python only
(the agent's choice): packages install through uv, and no other
language's tools were tried in the sandbox. The style note is 1 to 800 characters, required, so every card has the
section (the mocks' notes run under 300; the cap stops a lecture posing as
a note). The background note is required too, and in the third person,
since the unit planner and the tutor read it as a description of someone
else; it holds only what the learner said.

**Writing rules for the page**: `$...$` inline and `$$` for display; a
dollar sign that is not math must be `\$`, since "it costs $5 and $10" reads
as math and no rule fixes that reliably (Pandoc's fails on "$5. Then
$x$"); `\(...\)` is not supported, because Markdown reads `\(` as an
escaped bracket. Unit titles and goals are plain text; objective statements
render math.

## Page design

Picked by the user from the mocks in `docs/prototype/` (pieces 1 to 18),
2026-11-13, 2026-11-15, 2026-11-17 and 2026-11-18. Each mock's header
comment says what was asked and rejected. Pieces 15 to 18 were shown as
the agent would build them and accepted so, but for the notes
("Product decisions").

- **Thread layout**: one centred column, the tutor's text unframed, the
  learner's messages on the right, one message box at the bottom. Rejected:
  a document with questions in the margin, and lesson and conversation side
  by side.
- **Look**: Catppuccin Frappé, mauve accent, IBM Plex Sans, dark first;
  headings take the accent, key terms yellow, the learner's messages a faint
  accent wash. Rejected: the other flavours and accents, a blackboard look
  (the user found it the ugliest) and a warm book look.
- **A question is a card in the thread**, answered inside the card while the
  message box stays; once graded it shrinks to a record (verdict, answer,
  confidence, the right answer on a miss). Rejected: the message box turning
  into the answer box, and a full-screen question.
- **Phases are marker lines in the thread**, with one next-step control where
  the conversation has reached; while the tutor writes, Send becomes Stop.
  Rejected: a phase strip across the top.
- **Session navigation is one line across the top**: the path on the left,
  the position with a tick per segment on the right, opening the unit's
  outline. Leaving a session never asks. Rejected: a rail always showing the
  outline.
- **Artifacts and source passages open in a pane beside the thread**, one at
  a time. Rejected: inline, and a sheet over the thread.
- **The library is one plain list**, newest first, finished courses at the
  bottom. Rejected: leading with where the learner stopped, or with a
  message box.
- **The course view is built around the unit list**, the diagram one click
  away in the side pane. Rejected: built around the diagram.
- **A course starts in the thread**: intake is a conversation, the proposal
  a card; a revision is a new card with changes marked, the old one shrunk
  to a line. Rejected: the proposal in the side pane, or on a page of its
  own.
- **The style note is a section of the proposal card**, "How I would teach
  it", always shown and marked when changed. Rejected: folded into a line,
  where two revisions can look the same.
- **A unit ends with a closing card**: a row per objective, and the next
  step ("Start unit N", or "Go over the N again" and "Move on without them").
  Rejected: a marker line, and sending the learner to the course view.
- **"Start fresh" is in the unit's outline**, asks once, and leaves the
  earlier conversation dimmed under a "Fresh start" marker. Rejected: a
  menu in the top line, or a button beside Send, where it is easy to hit.
- **Any unit can be started at any time**; one whose prerequisites are not
  finished asks once. Several can be in progress. The course view's card
  leads to the unit in progress most recently opened, or the next in order.
  Rejected: locking units behind prerequisites, and one unit at a time.
- **A dispute opens the graded card in place**, in the session and on each
  answer of "What I know": what the answer was graded by, a reason, which
  is required, and Send. The first grade, the reason and the outcome with
  the judge's reason then stay with the answer, whose verdict reads the
  corrected grade, marked "after your dispute". The user was asked only
  who decides; the layout is the agent's, as shown.
- **A code question's card names the file to edit by its full path**, with
  "Copy path" and "Open" (the user's note from the stage 3 check), and
  says that the tests are not shown; "Run the tests"
  takes a confidence level and is the answer. The graded card names the
  file as run and shows the end of the test output. In the detour after a
  failing run the tutor may run the tests on the learner's fixed file,
  which records nothing; the next question is a different exercise.
  Rejected: the tests in the workspace, to run before the run that counts
  (a pass would show that known tests can be made to pass, and the
  confidence level would mean little), and a second try at the same
  exercise (piece 2's design, from before detours; the passing rule
  counts answers to different questions).
- **Packages are installed from a card** the tutor asks for: the packages,
  the command, Install and "Not now". Rejected: the learner running the
  command in their own terminal from the tutor's instructions. The command
  and the output are folded away, the output open only after a failed
  install: the user needs them only when something fails (the user's note
  from the stage 3 check, task 3.20).
- **The thread has a line for each file the tutor writes** ("The tutor
  wrote `bpe.py`"); the agent's, as shown in piece 14.
- **Words**: learner-facing copy says "segment", the brief's term; the extra
  segment is "Going over again", not "Review", which names stage 5's review
  questions.
- **Review is a card, then markers around its questions** (piece 15).
  The card sits under the sitting's marker: how many questions, what they
  are, Skip and "Start the review"; while it waits the unit's own control
  is not offered. Start and Skip turn it into a marker line, which is its
  record. A question's head counts objectives ("Question 2 of 3"), says
  "second question" after a miss, and names the unit of another unit's
  objective. "Skip review" stays beside the question or the detour's
  control and asks nothing first. After a second miss the control reads
  "Go on with the review". The closing marker says what the review did
  ("Two retained, one slipping") and where the unit goes on.
- **"Test out" is beside Start on every unit not started, and under the
  card's "Start unit N"** (piece 16), so that it is seen before Start is
  pressed. It asks once, saying what the test is. The test is a marker
  and question cards, each saying which objective it is on; a graded card
  shows its verdict and the right answer as everywhere, and "no feedback"
  means that the tutor says nothing between questions. "Start learning
  instead" ends it. The result card has a row per objective with why,
  then each segment as skipped, taught in part or taught, and the steps
  "Skip what I passed" and "Teach me the whole unit" ("Finish the unit"
  when everything passed). Skipped segments stay in the outline, struck
  through, and in the top line as hollow ticks.
- **The gate is offered on a card** (piece 16): how many questions and on
  what, that it waits for another sitting, "Skip the gate", which asks
  once since the gate is offered once, and "Start the gate". In it
  everything is as in a review. The closing card after it gives each
  objective its status as it stands, and under them the other units'
  objectives the gate asked.
- **Retained is teal and slipping is peach** (piece 16; Catppuccin's
  `#81c8be` and `#ef9f76`); passed stays green and not passed yet yellow.
  Both words are on the closing card and on each objective of "What I
  know". In the course view a finished unit keeps its word, with "3 of 5
  retained" and "1 slipping" as lines under it. In "What I know" an
  answer given in a review, a gate or a test says so on its line, and a
  miss while testing out says that it is not counted.
- **Notes are offered in a section of the closing card** (piece 17): a
  sentence on what they are, one line for the learner's instructions, and
  "Write notes", drawn quieter than the card's next step. While they are
  written the section says so; then "Open the notes", or the reason with
  "Try again". In the course view a finished unit has "Notes" beside
  "Open", or "Write notes", which opens the same line under the row.
- **The notes' reader is a page**: the writer's page in a frame under the
  top line, which has "Open in browser" and "Write again"; above the
  frame, when the notes were written, with which instructions, and the
  file's path with "Copy path". What a unit's notes look like is the
  writer's; `17-notes-example.html` is the kind of page meant.
- **"Export transcript" is in the unit's outline**, above "Start fresh".
  The document reads as the thread does, in the page's colours and the
  reader's own font, names an aid without including it, and prints in
  dark text on white, as the notes do.
- **The profile is a section of the proposal card**, under the style
  note: "What I would remember about you", always shown. A first course
  marks it "New"; a later one that changes it marks it "Changed", marks
  each new sentence and lists each dropped one, since the text reaches
  every later course. The Profile page is reached from the library's top
  line: what the text is for, the text in one box with its length against
  the limit and Save, and the finished courses a planner is given.
- **A misconception sits under its objective in "What I know"**, above
  the answers (piece 18): what the learner believed, what is so, and
  where it showed. It is ruled in peach and says "Open" while the
  objective is not passed, and is grey and "Cleared" once it has.
- Not designed yet: a light theme, the source reader, the cards for style
  and curriculum changes, settings, narrow screens.

## Page behaviour

- **The renderer is react-markdown with remark-gfm, remark-math and
  rehype-katex**: it makes React elements, so a model's text is never set
  as HTML, and its components will suit stage 4's citations. Rejected:
  markdown-it (an HTML string, so safety rests on its escaping) and marked
  with DOMPurify (cleaning after the fact). The cost is about 118 packages
  and a larger page script, which a local app can carry. `katex` is pinned
  to the 0.16 line rehype-katex requires; 0.19 installed a second copy
  whose stylesheet did not match.
- **Images are never fetched**: a prompt injection in a source could carry
  data out in an image address. KaTeX runs untrusted, so `\href`, `\url`
  and `\includegraphics` are refused.
- **`displayMathLines`** marks a formula alone on a line between `$$` as
  display; remark-math reads it as inline. A single newline is a line
  break, which suits a proof typed line by line.
- **`Prose` is memoized.** A thread holding every earlier session froze for
  17 seconds on each new message, because every reply's Markdown and math
  were rendered again. Opening a unit with a long history still draws the
  whole thread once (about 3 seconds for 1,200 formulas); folding earlier
  sessions would end that, and is the user's design choice.
- **The open question is pinned above the message box**, in one place from
  posting to grade, so its React state, a half-written answer or a picked
  choice, survives messages sent meanwhile. It is at most half the window
  high. Once answered after the thread moved on, it moves to where it was
  answered, leaving a line where it was posted, so the verdict sits above
  the feedback. Rejected: a sticky card at the top, which covers the
  teaching being reread. Hide shrinks it to one line, for rereading the
  teaching (the user's note from the stage 3 check, task 3.21); hidden,
  the card stays mounted, so its state survives, and its keys are off,
  since its window-wide shortcuts would otherwise pick, rate and send an
  answer the learner cannot see. Hidden is kept by the question's key, so
  the next question shows; a reload shows it again.
- **Dividing lines go between messages, not inside an exchange**: none
  between a lead-in and its question, a question and its feedback, or a
  reply and the judge's line under it.
- **Dimming is on items, not the conversation's wrapper**, since a child
  cannot be brighter than a dimmed parent; cards that still wait carry
  `live`. A waiting card is not moved under the marker: remounting it would
  lose a half-written answer.
- **Keys go to the message box after sending a message**, not to the pinned
  card; "b4" was once sent as a message that way. Not changed.
- **The course's details are asked again until the server answers**
  (`getJsonUntilAnswered`: doubling waits up to 15 seconds, never after a
  4xx). Until then the unit's place is unknown, never "the last unit": a
  failed load once made the closing card say the course was finished.
- **A server restart in development reloads the page** (Vite's client),
  which reopens the unit, so a note saying the server restarted could never
  show.
- **Dates are formatted in two parts**: how a locale joins date and time
  differs between ICU versions.
- **A pending send owns only the draft it sent**: repeated Enter makes one
  POST, and a draft edited meanwhile survives the send's success.
- **Biome's descending-specificity rule** flags selectors like `.cs p` after
  `.prose li > p`; give the element its own class.
- **Only an artifact shown while the page is open opens the pane** (task
  3.6, the agent's choice): `hello` carries the index of the log's last
  event, and a replayed artifact is only referred to, so a reload does not
  reopen old aids. On `pnpm dev:fake` the scripted teaching ends before the
  page's stream connects, so its first aid is only referred to; `/artifact`
  shows one live. The pane matches its reference by file, since keys are
  numbered afresh after a restart. Esc does not reach the page while focus
  is inside the frame; the close button does.

## HTTP and event stream

- **Only Gauss's own page may use the API**: the server listens on
  `127.0.0.1`, refuses host names other than `localhost` (DNS rebinding)
  and any POST whose `Origin` is not its own. It drives an agent on the
  learner's login, and from stage 3 a shell.
- **Event ids are `<log id>.<index>`**: a reconnecting page gets only what
  it missed, and a `Last-Event-ID` from another log (a restarted server)
  replays from the start.
- **A message is accepted with 202**; the reply comes over the event
  stream. Refusals and failures carry the reason as `error`.
- **An intake has an id of its own** (its log's), since the course exists
  only from the first proposal. A restart ends it, and its routes answer
  404 so the browser's event stream stops retrying. One intake owns a
  course for the server's lifetime, including while approval is written,
  so a review request then gets the same intake rather than a second one.
- **A unit's position is never sent to the page**: an open question holds
  its grading material.

## Dev server and tests

- **`pnpm dev:fake`** runs the real server's wiring (`serve.ts`) on the
  scripted backend, which is stateless and does what each turn's header
  allows; a reworded header can break it, and its tests then fail. Port
  4330, so a page left open on it never reaches the real server. The data
  root is never `~/gauss` or a folder inside it. The seed is written through
  the record's own operations, so a schema change the seed does not follow
  fails at once. `BROKEN_SESSION` in `scripted.ts` makes a session that
  cannot be resumed.
- **The scripted tutor numbers a question past those listed as asked
  before** (task 5.4): numbered from the check's "(n asked)", a review or
  a segment going over objectives again repeated a check's "question 1",
  which counts as the same problem. Its code files carry the objective in
  their names, since units share the workspace, and it never writes over
  a file there: a question withdrawn unanswered is in no history, so the
  next one got its number and replaced the learner's draft.
- **Close the browser before stopping a server.** A session page left open
  from one run kept asking to open its unit, and a real-backend scratch
  server started later on the same port, with a course of the same id,
  planned and taught that unit on Haiku.
- **The fake backend matches the real one where tests depend on it**: a
  stopped one-shot fails whatever reply comes, as Claude's does; kept
  sessions are shared between backends, so a test's restart resumes.
- **The scripted whole-unit test has a 15-second limit**: it writes and
  flushes the record after every step of a unit, takes 2 to 5 seconds, and
  timed out now and then at Vitest's 5-second default.
- **Real-model runs**: use a scratch data root, and store a unit's plan in
  the seed when planning is not what is checked, so no planning call is
  spent.

## Sources

The user brought a proposal for splitting sources (2026-11-14); the
agent's smaller version was accepted. The design is `architecture.md`
section 8.

- **The gap was real**: long stretches without headings exist (from
  memory of the Miller translation of the _Phenomenology_: the Preface,
  about 45 pages, and "Force and the Understanding", about 30). Check the
  user's edition in stage 4.
- **One `Read` call is capped at 25,000 tokens by default**
  (`CLAUDE_CODE_FILE_READ_MAX_OUTPUT_TOKENS` overrides it; read from the
  binary, not observed), so a section must stay below it.
- **Not adopted from the proposal**: new terms ("subsection", "chunk") for
  what the brief calls sections; a field list and two-level file names in
  the architecture (shapes are zod schemas, and the _Phenomenology_'s
  headings go four deep); a required page range (EPUB, TXT and Markdown
  have none); ids stable across converters (sources are converted once);
  "never read the whole chapter" (short chapters read better whole). Kept
  from it: no overlap between sections, which would put quotable text in
  two places.
- **On context size**: what the tutor reads stays in its session, so
  smaller files lower the cost of a unit's early turns, not its end; the
  size of a unit is what bounds the context. 15,000 to 30,000 characters
  is about 6 to 12 dense pages.

## Known gaps

Known and accepted for now; the plan's stage notes hold the ones a stage
will close.

- The slow reply after a Stop mid-sentence (10 to 30 seconds), seen once.
- A finished unit opened after a restart starts a new tutor session for any
  message, without the note saying the conversation is new.
- A restart between an answer and the next question leaves the check
  waiting for a learner message, and a feedback turn cut off is lost.
- The next-question turn after a failed feedback turn does not say the
  feedback failed.
- A question withdrawn by an override whose `overridden` transcript line was
  lost still shows as open, and answering it is refused.
- Stop during an artifact write can still open the aid when the write
  finishes. A math field's Enter shortcut can submit while an input
  method is still composing text.
- Sandboxed commands and artifact scripts have no resource budgets for
  peak disk, memory or CPU use. The command deadline and output cap do
  not supply those budgets.
- The help judge sees one exchange at a time (above).
- The grader's grading of math answers the symbolic check does not settle
  has no hand-graded set: the grade set holds written answers only.
- Code questions: Copy path can be stale after a data-root move; only
  "What I know" shows the submitted file contents, and the tutor's copy
  omits trailing whitespace. In the scripted backend, grading feedback can
  be mistaken for a scripted command.
- Code questions: nothing refuses a question whose tests or solution the
  tutor left in the workspace, where the learner can read them; only
  `tutor.md` forbids it (seen once, task 3.19). The posting check could
  refuse a question whose test files are in the workspace.
- Opening a unit with a long history draws its whole thread once.
- Keys go to the message box, not the pinned card, after sending a message.
- After a dispute overturns the miss a detour opened on, the detour's
  control still reads "Ready for another question", though pressing it goes
  on as the corrected verdict has it: to the next objective, or the end.
- No limit on refused `plan_unit` calls within one planning turn.
- The fake backend's `hasSession` ignores the folder.
- Temporary files left by a crash during an atomic write are never cleaned
  up.
- Untried on a real model: a learner who keeps asking in a detour, or
  presses "Ready for another question" at once; idle closing and resuming
  on Claude end to end.
