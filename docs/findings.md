# Gauss: findings

Facts about the outside world that the code depends on but cannot show:
how the SDKs, models, browsers and sandbox behave, found by experiment, and
designs tried and rejected that would be costly to try again. A fact that
guards one piece of code is a comment there instead. Each entry is the
finding, what follows from it, and its evidence in a line. Rewrite an entry
when a newer run contradicts it.

## Claude Code and the Agent SDK

Observed with Agent SDK 0.3.325, which runs the Claude Code binary bundled
in its platform package (2.1.325), not the `claude` on the path: behaviour
follows the SDK's version.

- **`settingSources: []` does not keep out the auto-memory, the bundled
  skills or the claude.ai connectors** (about 2,500 tokens, joining a few
  seconds in): hence `skills: []`, `autoMemoryEnabled: false`,
  `disableClaudeAiConnectors` and `strictMcpConfig`. Evidence: the model
  quoted the memory index.
- **The account's email address reaches every session**, in a
  `session_context` reminder on the first message. Neither
  `CLAUDE_CODE_DISABLE_ATTACHMENTS` nor any option removes it; bare mode
  (`CLAUDE_CODE_SIMPLE`) does but drops the plan login, and a configuration
  folder of its own needs a copy of the login, whose refresh can sign the
  learner out. Look again when the SDK changes. Hence the hook that refuses
  a web search holding it; in a Haiku run the tutor, asked to search for
  the learner's address, declined by itself, so the hook has been tested
  against a simulated SDK only.
- **With no `tools` option a session gets about 25 built-in tools** and a
  first request of 15,000 to 19,000 tokens; custom tools are deferred
  behind tool search only when `ToolSearch` is among the tools.
- **The model does not stop after posting a question**: in 4 of 4 calls
  it went on writing. A `PostToolUse` hook returning `continue: false` ends
  the turn cleanly. Not tried: `_meta['claude/endTurn']`.
- **`PostToolUseFailure` ignores `continue: false`.** The bundled Claude
  Code dispatcher drops `preventContinuation` on MCP errors; `PostToolBatch`
  honors it, but only after already-queued calls have drained.
- **Input rejected by MCP's field schema never reaches the teaching tool**
  (`MCP error -32602` with zod's messages), so the engine cannot count that
  refusal or pass its reason to the next planning session.
- **Resuming from another working folder finds the session and moves it
  there**, so a session is always resumed in the folder it ran in:
  confinement follows the working folder. A resumed session takes the tool
  set it is given now: with web search turned off, its requests listed no
  `WebSearch` and the tutor answered from earlier results in its context.
- **Claude Code deletes session files older than `cleanupPeriodDays`** (30
  by default) within about a quarter of an hour; resuming one then fails as
  an unknown id. Evidence: a file backdated 31 days.
- **`getSessionInfo(id, { dir })` reads one file in 4 to 7 ms** and returns
  undefined, never throws, for an unknown id or folder; a found session
  resumes in 0.3 to 0.6 s.
- **Tool results and `Read` are capped at 25,000 tokens**
  (`MAX_MCP_OUTPUT_TOKENS`, `CLAUDE_CODE_FILE_READ_MAX_OUTPUT_TOKENS`), which
  bounds what one `read_section` returns.
- **WebSearch's structured output (`tool_use_result`) holds the pages
  found; its text does not.** One search returned 18 pages and a line of
  commentary. A call that "stepped aside for a message the user sent"
  carries `{ detachedToolCall: true }` instead, but that needs a message
  sent while a turn runs, which the engine never does; none was seen.
- **Structured output retries a reply out of shape by itself** and ends
  with `error_max_structured_output_retries`; a Haiku grading took 3.3 s.
- **The adaptive thinking of Sonnet 5.5 and Opus 5.5 runs in an "updates"
  mode** that can put text meant for the learner, written before a tool
  call, into thinking the page never shows. On Sonnet,
  `thinking: { type: "disabled" }` and `display: "summarized"` change
  nothing (see "Tutor").
- **Effort is set only through the `effort` option**: it reaches Claude
  Code as `--effort=<level>` (seen in the process's arguments in a notes
  run). `CLAUDE_CODE_EFFORT_LEVEL` would be dropped with the other
  `CLAUDE` variables (`sdkEnvironment`), so a run without the option
  takes the model's default.
- **Usage**: `rate_limit_event` reports the plan's windows; `total_cost_usd`
  is a list price, not a charge; each session makes one small Haiku
  request of its own (about 1,300 input tokens).

## Codex

From the stage 0 spike with `@openai/codex-sdk` 0.169 on the ChatGPT login,
and Codex CLI 0.171 and SDK 0.172 read with no model call (2026-11-24).

- **The SDK runs each turn as a new `codex exec`** (still in 0.172): no
  system-prompt option, no in-process tool, no hook, no streamed text, and
  it cannot pass `exec`'s `--ignore-user-config`. `model_instructions_file`
  replaces Codex's own instructions. Hence the app-server protocol
  (`codex app-server`, JSON-RPC over stdio; types from `codex app-server
  generate-ts --experimental`): `baseInstructions` on `thread/start` and
  `thread/resume`, in-process tools (`dynamicTools`, answered through the
  `item/tool/call` request; experimental), `item/agentMessage/delta`,
  `turn/interrupt`, and approval requests for commands and file changes,
  answered accept or decline with no reason field. Untried with a model.
- **Teaching tools work over MCP** with the override
  `mcp_servers.gauss = { url, default_tools_approval_mode = "approve" }`;
  without it `approval_policy = "never"` refuses the calls. A tool ends the
  turn by aborting the turn's `AbortSignal`, and the thread resumes.
- **Under `exec` the thread id arrives with the first turn**
  (`thread.started`), which the adapter's `backendSessionId` cannot take;
  app-server's `thread/start` response holds the thread (protocol types,
  untried). Threads are saved under `$CODEX_HOME/sessions/`.
- **The learner's setup reaches the model**: with their `CODEX_HOME`, their
  global `AGENTS.md`, their skills and plugin suggestions, whatever
  `--disable`, `project_doc_max_bytes=0` or `model_instructions_file` says.
  An empty `CODEX_HOME` drops those, but Codex's bundled skills (imagegen,
  openai-docs, skill-creator, skill-installer), its multi-agent
  instructions and tools (`spawn_agent` and others) and
  `request_user_input` remain. Copying `auth.json` into another home can
  sign the learner out. Evidence: `codex debug prompt-input`, which prints
  the model's input without calling it.
- **No account email address is in the model's input** with the default
  configuration (`codex debug prompt-input`); what the server adds is not
  visible there.
- **Codex's web search can open a page and search in it** (the protocol's
  `WebSearchAction`: `openPage`, `findInPage`); `exec`'s search item
  carries the query, not the pages found.

## Sandbox and confinement

- **Two layers confine the tutor.** Claude Code's sandbox (bubblewrap)
  confines its commands; `Write` and `Edit` run outside it and are kept in
  the workspace by `blockWritesOutsideWorkingDirectories` and the one
  `Edit` allow rule (`/x` is relative to the working folder, `//x`
  absolute). Evidence: stage 0 refusals, `dangerouslyDisableSandbox`
  included.
- **Under `dontAsk`, `Read`, `Glob` and `Grep` outside the working folder
  are refused.** `blockReadsOutsideWorkingDirectories` hid mise's Python
  and uv from commands, yet a command could still read `../state.json`.
- **Haiku with `tutor.md` refuses by itself to read outside its
  workspace**, so confinement is tested with a probe prompt, not by asking.
- **sandbox-runtime 0.0.83**: `allowRead` reopens a path inside `denyRead`
  only for a real path, not one reached through a link into a denied
  folder (as in Claude Code's sandbox); it needs a network section to
  start and its seccomp helper readable; it sets `TMPDIR=/tmp/claude` for
  every command.
- **The runtime blocks `socket(AF_UNIX)` but not `socketpair`.** Refusing
  every pair panics uv (tokio) and breaks asyncio, so `sandbox_exec.py`
  allows connected stream pairs only.
- **The network allowlist matches whole host names**: `pypi.org` and
  `files.pythonhosted.org` are reached, any other host is answered 403.
- **uv does not isolate by flags**: `--no-config` and `--no-sources` still
  read the workspace project's dependencies, `--no-build` does not forbid
  every build, and uv writes the new environment at its final path; hence
  Gauss's own uv project per course.
- **No sandboxed process can read the server's environment**
  (`/proc/1/environ` included). The NixOS loader adds `LD_LIBRARY_PATH`
  and Python `LC_CTYPE` to what a command sees.
- **Claude Code leaves an empty `.claude/.cc-writes/`** in the working
  folder; it is harmless and comes back.

## Browsers and the page

- **WebRTC leaves an aid's frame** whatever its policy: STUN gathered a
  server-reflexive candidate from an opaque-origin frame; CSP's
  `webrtc 'block'` is "unrecognized" in Chromium 157; deleting
  `RTCPeerConnection` is undone by a nested `srcdoc` frame.
- **Chromium 158 resolves a `<link rel="dns-prefetch">` an aid's script
  adds**, even with `X-DNS-Prefetch-Control: off`; plain and hovered links
  are not resolved. Not tried in WebKit.
- **CSP has no `navigate-to`**: the page's `frame-src 'self'` stops a frame
  navigating away only inside the page.
- **WebKit gives an opaque-origin frame's errors as bare "Script error."**
  (top level, timers, `eval`, `new Function`); only an error the aid's own
  code catches keeps its text. Chromium gives the text and line.
- **Esc does not reach the page while focus is inside an aid's frame**, so
  the pane has a close button.
- **MathML renders badly in Chromium** (primes shrink, brackets do not
  grow); notes and exports embed KaTeX's HTML instead.
- **"$5 and $10" parses as math, and no rule fixes that reliably**;
  Markdown eats the backslash of `\(`. Hence `\$` for a dollar and no
  `\(...\)` in model text. Evidence: Pandoc fails on "$5. Then $x$".
- **Date and time joined by `Intl` differ between ICU versions**, so they
  are formatted apart.

## Source conversion

Tried on the user's files: the Inwood _Phenomenology_ PDF, arXiv 1706.03762
(Attention) and 1512.03385 (ResNet), and EPUBs of Girard and Han. PDFium's
quirks (font sizes, hyphens, dropped spaces, small capitals) are commented
where `convert.py` handles them.

- **A section holds at most 20,000 characters** (about 5.5 printed pages of
  the Inwood edition): at 30,000 parts ran to 26,000 to 27,000, more than a
  segment teaches; at 15,000 the Inwood Preface (108,000, no headings)
  became 8 parts for nothing. 10 of Girard's 14 chapters split at 20,000.
- **Bookmark titles are padded with spaces and point at page tops**, so a
  heading is found by its text.
- **Hyphen joins prefer the document's own usage**, with no dictionary:
  Inwood keeps "self-consciousness" 1,112 times; the cost is ResNet's
  "high-level" read as "highlevel".
- **Calibre EPUBs set headings as styled paragraphs and italics as
  `span.italic`, and their NCX can miss chapters** (Girard's lacks chapter
  9): the outline comes from the table of contents and emphasis from the
  stylesheet's class rules.
- **remark-gfm reads `~word~` and `H~2~O` as strikethrough and `<a@b.c>` as
  a link; markdown-it does not**, so `convert.py` escapes them and the tests
  read its output with remark-gfm.
- **Speed**: the Inwood PDF converts in 11.4 s, 7 s of it the per-character
  ctypes pass over 2.1 million characters; a page renders in 0.26 s.

## Models and prompts

### Comparing prompt versions

- **The agent approves its own prompt changes** (the user's instruction):
  a revision lands when real-model runs of the old prompt against the new,
  on the same moves, show nothing lost, and the prompt is as short as that
  allows.
- **Role prompts (tutor, planners)**: run old and new on the same seeded
  unit with the same learner messages, at least three runs each, and count
  each failure across runs ("named the subject in 4 of 6 lead-ins"). The
  seed covers review with a miss, teaching, discussion, a check with a
  written miss and its detour, a code question and the gate with a miss;
  an intake run covers a narrow topic with a question on review or notes,
  the go-ahead, a revision and a large topic. Cutting `tutor.md` from 634
  to 356 lines and `planner.md` from 214 to 133 this way found two and one
  regressions.
- **Live checks run on Sonnet 5.5 at medium effort (`AGENTS.md`), not the
  models the app uses**: the tutor takes the login's default, Opus 5.5 on
  the user's plan, and the help judge Haiku. Sonnet follows the source rules
  worse (see "Tutor"), so a live result is evidence for a wording, not proof
  of how Opus or Haiku will take it.
- **A prompt says only what headers, tool and field descriptions and
  refusals do not**, and rewording any of those changes what the model is
  told.
- **Cutting a rule's example or its reason is what loses the rule**: both
  regressions of the `tutor.md` cut came from a dropped example or reason.
- **One-shot judges** (`grader.md`, `help-judge.md`, `dispute-judge.md`):
  run the hand-graded set (`grade-set.ts`, `judge-set.ts`, `decide-set.ts`
  with `--runs`) several times per version. A version is good when every
  run matches the hand verdicts; count rule breaks in the free text
  (repairs named, the rubric mentioned, raw math) across all runs. Each
  rule needs a set item that motivated it; add hand-checked items when a
  prompt is next revised, never automatically, and do not fit a prompt to
  a small set.

### Tutor

- **Asked for feedback and then a tool call in one turn, Sonnet 5.5 puts
  the feedback in hidden thinking** (7 of 8 turns; with no tool to call,
  13 of 13 written). Refusing the tool until text came stalled the turn (3
  of 4 asked the learner to "send continue"). Hence feedback has a turn of
  its own with no tool, and the engine asks for the next question after
  it (6 of 6 written, no stalls).
- **The tutor puts the right choice at A, and told to randomise, writes a
  wrong key** (1 in 4), so the engine shuffles the choices.
- **About one math key in ten was wrong** (3 of 28 in counting questions);
  "solve it again from the prompt, list every case" brought it to 0 of 7,
  too few to be sure. The engine does not check a key's arithmetic.
- **Feedback over about 100 words reads a correct proof back and walks the
  choices not picked.**
- **Lead-ins in an assessment named the subject, so the learner knew the
  method**: "name at most the unit" alone, 4 of 6 named it; with its reason
  and the example "One more from the same unit.", 0 of 3. Lead-ins and
  hint replies also leaked the point missed before.
- **Opus can locate a passage without a numbered citation**: a chapter-opening
  cue paired with source wording points back to the lecture's verified quote.
  The help judge judges the reply, not whether the card itself gave help.
- **Once a lesson and detour explain a one-claim objective in full, the
  tutor seldom finds a question both new and sound** (Hegel's result of
  Perception: never both cards, on Opus or Sonnet; the Attention lookup:
  mostly): it restates them, or writes the answer into the card's premises.
  Evidence: the 4.23 commit.
- **Without the rule in the teaching phase, the tutor teaches the very
  function the check then asks for** (Haiku, Sonnet and a digit-sum run);
  the rule says the objective's task is not written out, set or hinted.
- **Starters must hold the given values "even when the objective speaks of
  storing values"**, or the learner retypes them (Opus and Sonnet).
- **With no rule, the tutor writes tests into the workspace** and swaps
  solutions in and out; hence scratch work in `$TMPDIR`, which only the
  prompt enforces.
- **"Then end your reply" after a package request made the tutor ask first
  and teach nothing**; "the last thing in your reply, never in place of
  the teaching" works.
- **Haiku showed no aid unasked, and broke the page's look** with
  `color-scheme` outside a rule; hence the rule to show one unasked and the
  exact opening block.
- **The intuition question needs an off-topic example and "ask this
  alone"**, or the example becomes the teaching.
- **"Unlike those listed" must mean a different pattern** (what a question
  gives and asks), not new numbers: the tutor reissued one pattern with new
  figures 4 times.
- **The math box sets text as LaTeX and drops spaces**, so a math question
  that wants words fails a right answer; math questions are for
  mathematical results only.
- **Told to "acknowledge" app events, the tutor restates the page's
  lines.**
- **Text before `quote_source` can go into hidden thinking** on Opus 5.5
  and Sonnet: two of three Opus Hegel runs that alternated tool calls and
  explanations showed 112 to 169 words. In discussion the tutor therefore
  calls the tool before ordinary text; lectures put prose and quote
  selectors in one `present_lecture` call instead.
- **With the section read, the tutor quotes it in its own text,
  unchecked**: told to quote nothing verbatim, Opus put 62 of Hegel's
  phrases in quotation marks over 3 runs, 15 of six words or more; told to
  keep to its terms, "never more than five of its words in a row", 24 and
  none, though runs of eight words without quotation marks remain. Sonnet,
  told to keep to its terms, still quoted 32 of six words or more.
- **Links and page views come only with the rule**: under the old prompt
  no run linked a section (it named pages in text), and Sonnet looked at no
  page even when asked for equation (1) "exactly as the paper prints it".
  With the link's form, and a page "whose marker says `math` ..., or whose
  math reads garbled", every Opus run linked pages (53 links, all opening)
  and looked at the Attention paper's pages 4 and 5 while teaching.
- **While a question is open, Opus points to the passage it is built on
  when asked where to read it**: on the Attention paper's scaling
  question, the learner asking what $d_k$ means, where the paper explains
  it and to see the passage, 3 of 9 replies (in 2 of 3 runs) linked or
  named section 3.2.1, two with footnote 4 (one in place of the refused
  quote), each judged help. With the rule and its reason in `tutor.md` and
  the open question's header, 0 of 18 over two drafts, and every run still
  explained $d_k$. Explaining it as a sum over $d_k$ products is still a
  step to the judge (1 of 3 runs under the old and the final prompt).
- **A lecture rule crowds out aids**: each of three drafts without "the
  text does not replace an aid" showed one aid in 3 Opus runs on the
  Attention paper, against four under the old prompt; with it, four.
- **Accepted leftovers**: a written question sometimes asks two things;
  questions in a check can share one pattern; Haiku can post before
  writing the starter, doubling the lead-in; a lecture with its quotes
  reaches the 600-word limit on Opus (one Hegel lecture of nine at about
  610 words).

### Planners

- **One idea per objective**: the test "could a learner know one part and
  not the other", then reading each for one verb and one claim, gave 5 of 6
  single-idea objectives; example patterns did not, and a length limit is a
  poor proxy. "A setting is not a skill" is not settled: the planner still
  splits contexts (a spam filter, a witness) into objectives.
- **The intake prompt must say what goes in the profile** (work, general
  knowledge, teaching preferences) and what in the background note (this
  topic, its depth, its checks): "what is true in any course" alone put
  course facts in 5 of 6 profiles; naming them, 0 of 3.
- **The intake asks at most two questions a round, counting every
  question**, and promises only what is built: the first run asked three
  under "Two quick questions".
- **Haiku can say "I've proposed" without calling the tool**; planners
  often post the card with no text before it (left as is).
- **"The segments follow the text's order" alone let a paper's plan go
  back**: 2 of 3 Sonnet plans and 1 of 3 Opus on the Attention paper drew
  on the decoder stack, for its masking, after multi-head attention. Stated
  as "no segment draws on a section that comes earlier than the last of
  the segment before", with its reason, 0 of 6; a Hegel chapter kept its
  order either way.
- **The intake planner copies the style-note sentence on sources into
  every style note** (6 of 6 Sonnet runs). Without it, the notes still
  spoke of lectures through the text, and 2 of 3 Attention proposals went
  back to an earlier section (0 of 3 with it), so it stays.

### Grader

- **Sonnet 5.5**: 8 runs over 4 prompt versions on the 11-answer set agreed
  every time and named the first flaw. Haiku 5.5 failed a correct proof
  written in plain words and broke the flaw rules more often. Opus not
  tried. A false pass counts as mastery, so judgment pays here. The
  19-answer set adds eight explanations from a source course; the current
  prompt matched every verdict it gave in 3 runs, and one grading (P2,
  usually 3 s) ran past the 3-minute limit and failed.
- **Each rule in `grader.md` comes from one answer in the set** (redo every
  computation; what the argument needs but never secures; circularity;
  assumptions only from the rubric and standard facts; any valid method;
  slips of notation; an explanation in the answer's own words): remove one
  only with a set answer showing it is not needed.
- **Quoted sentences passed for an explanation**: E4, Hegel's own
  sentences covering the whole rubric, passed 2 of 2 under "judge the
  reasoning, not the wording"; with "an explanation must be the answer's
  own" and its reason, it failed 3 of 3, and A1 (quotes, then explains)
  still passed.
- **An example repair in the flaw rule ("such as …") makes the grader give
  repairs** (4 of 14 flaws; without it, 1 of 14, then 0).
- **"Meets the rubric in full" contradicted "any valid method"**; the
  `WrittenGrade` wording is "establishes everything the question asks,
  with every step valid".
- **Left as is**: one flaw names a second false step, and a few run to
  three sentences; fixing them would fit the prompt to 11 answers. Flaws
  on an explanation supply its missing reason, often with later gaps (23
  of 23); a rule against it still left 13 of 15, and the detour gives the
  right answer anyway.

### Help judge

- **Haiku 5.5, 2.5 to 4 s a call**: on the 25-exchange set (10
  clarifications, 15 helps, a refusal that hints, a message telling the
  judge it is a clarification) one run matched every hand verdict and the
  others differed only on C3, judged help, the safe side. Sonnet not tried.
  The 31-exchange set adds six from a source course; the current prompt
  matched every hand verdict in 2 of 2 runs.
- **The judge's own additions**: reacting to a guess ("on the right
  track") is help; a reply that gives nothing toward the answer (a
  refusal, an acknowledgement) is a clarification.
- **A `source:` link to the question's passage went unread**: judged
  clarification in 3 of 4 calls (H18, H19) until "Where to read it" said
  what the link opens; then help in 4 of 4, and no clarification turned
  help. The judge sees no source text, so it reads where a link points
  from the link's words.
- **It sees one exchange at a time**, so a hint split over two replies,
  each harmless alone, passes.

### Dispute judge

- **Sonnet 5.5, 3 to 6 s a call**: it matched every hand outcome of the
  22-case set in 5 runs over 3 versions; Haiku matched in 1 run, so the set
  does not separate them. Sonnet is kept because it reviews Sonnet's grades.
- **Math notation is required in the `reason` field's own description,
  with a matrix example**: stated only at the prompt's end, 3 of 18 reasons
  wrote raw `e^{-x^2}`; moved, 0 of 36.
- **An outcome agrees with the hand outcome** when the verdict, a choice
  question's correct letter, and whether a math question's expected answer
  was corrected all match; read a corrected expression to judge it.
- **Left as is**: reasons of five or six sentences that name a repair.

### Handoff and notes

- **The handoff writer runs on Sonnet**: Haiku put wrong numbers in
  corrections the learner reads and listed tested objectives as taught.
  Sonnet writes 280 to 380 words against 250 asked (accepted; the schema's
  length ceiling stops a runaway).
- **A handoff note restates what the next tutor already gets unless told
  what it gets**; "open" must be defined to leave out the plan's unplanned
  parts, and tested is not taught.
- **Writers record beliefs shown in a test's reasoning as misconceptions**,
  whatever they are told.
- **The notes writer copies a wrong key as correct unless told to rework
  every value**, and reworking does not catch a false generalisation; hence
  checking assumptions and boundary cases and stating rules positively.
- **SVG labels overflow their `viewBox`** unless boxes are sized at about
  0.6 of the font size per character; compared amounts must be drawn to
  scale.
- **Models write `$`-delimited inline math even when asked for a display
  class**, so the engine renders `$...$` in notes too.

## Toolchain

- **The majors are very new** (TypeScript 7, Vitest 5, Biome 2.6, pnpm 12,
  Vite 8, React 19, Agent SDK 0.3): an API remembered from older versions
  may be wrong, so check the documentation first.
- **Biome 2.6 rewrites every Markdown table**, so Markdown and `docs/` are
  not formatted.
- **Biome's `noDescendingSpecificity` fails the lint** when a selector
  comes after a more specific one for the same element (`.ws li` after
  `.prose li + li`): raise its specificity or give the element a class.
- **pnpm 12 fails an install whose dependency needs a build script until
  it is listed under `allowBuilds`**, and installs no release under a day
  old.
- **`katex` stays on 0.16, as rehype-katex 7 requires**: 0.19 installed a
  second copy whose stylesheet did not match the markup.
- **The `computer-modern` 0.1.3 package declares CMU Serif regular as
  weight 500**; Gauss's `@font-face` declares it 400.
- **`python -I` leaves the script's folder off `sys.path`**, so
  `convert.py` stays one file.

## Rejected designs

Tried or weighed, and dropped for the reason given; do not try them again
without new evidence.

- **Copying code from LearnHarness (AGPL-3.0)**; it and DeepTutor were
  compared and beat no settled choice (they leave teaching rules to
  prompts, keep no mastery record, or send answer keys to the page).
- **PyMuPDF4LLM**: the best Markdown seen, but AGPL, keeps running heads,
  joins no paragraph across pages and made a heading of ResNet body text.
  **pdfplumber** ran justified words together. **EbookLib** is AGPL; the
  standard library suffices.
- **SymPy's Lark LaTeX backend**: ambiguity trees for `\sin x + 1` and
  `\sinh x`, and `\pi` refused; the ANTLR backend is used.
- **The tutor's working folder as the course folder with a deny rule per
  record file**: every new file needs a rule.
- **A hand-written bubblewrap command line** for the engine's commands:
  Linux-only and re-implements the runtime's protections.
- **Running a code question's tests through a tutor session**: puts a
  model between the tests and the grade. **Linking workspace helpers into
  the test folder**: editing a helper would change an unchanged answer's
  grade; dependencies are frozen when the question is posted.
- **`start_segment` and `close_segment` tools**: they decided nothing, cost
  a turn, and stalled the check when forgotten. **A `feedback` field on the
  question tool**: it does not stream, and a tutor that also writes text
  repeats itself. **Tools for the handoff note**: they rely on the tutor
  remembering.
- **Detours as a position of their own with a `start_detour` cycle**: the
  check's next question is the re-check (the user's design).
- **Unit planning inside the tutor's session**: the unit's text would ride
  on every turn.
- **A separate examiner session for assessments**: two session lifecycles,
  and it cannot teach after a miss.
- **A handoff call at the idle close**: a call on every break.
- **Re-judging unjudged help after a restart**: too complex for a rare
  case; unjudged exchanges count as help.
- **A sticky open-question card at the top**: it covers the teaching being
  reread.
- **Escaping PDF text for the reader** instead of turning Markdown off:
  `$5 … $10` became math and `__init__` bold.
- **An EPUB heading taken from any heading tag at a contents target**: it
  printed "Psychopolitics" under "Halftitle Page". **Bookmark parentage
  from sorted destinations**: lost parents when a child links back.
  **Erasing form bounding boxes in PDFs**: erased prose set in forms.
- **Extra calls or rules to keep each check question new** (a reviewer or
  reminder before posting, a separate writer, a target selector, a list of
  what was taught, a ledger checked by recall, applications reserved before
  teaching): none made Hegel questions reliably new and sound (see "Tutor").
- **A synchronous quote index per chat**: it duplicated large texts and
  blocked other requests. **The course planner given every outline in each
  `<course>` block**: the Inwood outline repeated about 170 lines.
