# Gauss: architecture

A map of the code: the rules the design rests on, where things live, the
data root, the prompts, and how to run and check things. Product behaviour
and its terms are in `brief.md`; outside-world facts the code depends on,
in `findings.md`. Each module's header says what it does and why. Where
this map and the code disagree, the code is right: fix the map.

## Design rules

One local Node process serves a React page (SSE and POST) and drives an
agent backend; Python helpers run through uv.

1. **The record is the source of truth.** Chats are rebuilt from it.
   Nothing that matters lives only in a model's context.
2. **The tutor changes the record only through teaching tools.** The
   engine checks every call against the current phase and refuses it with
   a reason the model can act on, so the teaching rhythm is enforced by
   code and not by the prompt.
3. **The backend is replaceable.** The engine talks to the adapter in
   `src/server/backends/backend.ts` and never imports an SDK.

## Repository layout

One package: the server and the page share type definitions, which is why
both are TypeScript. The dependencies are `package.json` and
`pytools/pyproject.toml`.

```
docs/          brief.md, architecture.md, findings.md, plan.md; prototype/ (page mocks; index.html marks the picked ones)
prompts/       the models' role prompts (below, "Prompts")
src/shared/    zod schemas (record files, questions, events, route bodies) and pure helpers both sides use
src/server/    main.ts, serve.ts (start, and wiring shared with the dev server); sandbox-command.ts (what a
               sandboxed command gets); open-file.ts (the system's opener); record/ engine/ tools/ backends/ http/
src/web/       the React page, built by Vite
pytools/       convert.py (a source into outline and sections; PDF page images), mathcheck.py (symbolic check),
               sandbox_exec.py (seccomp workload filter), sandbox_verify.py (exit status apart from output); tests/
scripts/       dev-fake.ts (server with no model); faults.ts (fault injection);
               grade-set.ts, judge-set.ts, decide-set.ts run grader-set.ts, help-set.ts, dispute-set.ts on a real model
mise.toml      pinned node, pnpm, python, uv, codex; `mise run setup`, `mise run check`
```

## Data root

Course data lives outside the repository, so the code can be published
without books, transcripts or progress: `GAUSS_DATA_ROOT`, else `~/gauss/`
(`resolveDataRoot` in `record/data-root.ts`; the rest of the record takes
the root as an argument). File shapes are the schemas in `src/shared/`
(`course.ts`, `curriculum.ts` with `plan.ts`, `state.ts`, `evidence.ts`,
`misconception.ts`, `handoff.ts`, `notes.ts`, `profile.ts`, `source.ts`).

```
<data root>/
  .git/, .gitignore            the record's history (below)
  profile.md                   learner profile, shared across courses
  .profile-approval.json       journal, only while a profile-changing approval is unfinished
  .notes-write.json            journal, only while unit notes are being published
  intake/                      working folder of intake and planning sessions; Gauss writes nothing here
  uploads/<intake-id>/         staged sources; .first-proposal.json journals promotion before startup clears uploads
  cache/package-uv/            uv's install cache
  courses/<course-id>/
    course.json  style.md  background.md  curriculum.json  state.json
    .first-proposal-instance.tmp                  identifies the reservation until its first proposal is saved
    evidence.jsonl  misconceptions.jsonl          append-only logs
    units/<unit-id>/handoff.md, handoff.json      handoff note, and how far into the transcripts it reads
    sessions/<unit-id>.<n>.jsonl                  a unit's session n: its page events
    sources/<source-id>/                          original.<ext>, outline.json, sections/<id>.md, pages/ (PNG cache)
    artifacts/<n>-<title>.html                    the tutor's aids, never overwritten
    notes/<unit-id>.html, .json                   unit notes, and the writer's document
    packages/, .package-install.tmp/              the course's uv project; an install's rollback journal
    workspace/                                    the tutor's working folder; holds the installed .venv/
```

Rules no single file shows:

- **Derived, never stored.** Objective and unit status, where a course
  stands, progress, review due counts, finished courses, "what I know"
  and calibration are computed from the logs when asked (`record/status.ts`,
  `progress.ts`, `review.ts`, `what-i-know.ts`, `calibration.ts`). A
  disputed answer counts with its verdict; all of them read the log
  through `record/disputes.ts`.
- **Ids and versions.** Objective ids are unique in the course, because
  the evidence names an objective by id alone. No file has a schema
  version: a field added later must be optional.
- **Writes.** Every file but the logs is written whole: temporary file,
  flush, rename (`record/atomic-write.ts`). Startup, before anything
  writes, removes the temporary files a crash left in the record's own
  folders, never a workspace's (`clearInterruptedWrites`). Logs are
  appended a line at a time (`record/json-lines.ts`); each file's writes
  queue behind each other (`record/file-lock.ts`). State is written before
  the page hears of a change; an answer is appended before its question
  closes.
- **Backup.** The root is a git repository (`record/backup.ts`) keeping
  `courses/` and `profile.md`, without `.venv/`, Python caches, a source's
  `pages/` or `uploads/`. Commits follow each durable step and never fail
  the engine. On for `pnpm dev` unless `GAUSS_BACKUP=off`; off for
  `pnpm dev:fake` unless `=on`.

## Modules

- **`src/server/record/`**: all reading and writing of the data root.
  `data-root.ts` (the `DataRoot` interface), `status.ts` (passing,
  retained, slipping), `review.ts` (what review and the gate pick),
  `progress.ts`, `what-i-know.ts`, `calibration.ts`, `backup.ts`,
  `dev-seed.ts` (the dev server's courses).
- **`src/server/engine/`**: the chats and their rules. `conversation.ts`
  (event log and turn queue under every chat); `intake.ts`,
  `intake-sources.ts`, `course-planning.ts`, `unit-planning.ts`;
  `unit-chat.ts` (the course level: open chats, the course's queue and
  desks; each chat's state and queue, `load`'s composition of the record,
  agents and modules with its error path, the segment's phases and own
  steps, and each learner action's guard) with
  `unit-progression.ts` (post-answer checkpoints and continuation),
  `review-admission.ts` (admission to one unit chat; course-wide thread
  selection stays in `unit-chat.ts`), `unit-aids.ts` (the tutor's aids,
  quotes, lecture and searches, refused while a question is open),
  `unit-proposals.ts` (the tutor's style note and curriculum change
  proposals, their cards, and the changes other chats and the course
  planner tell a chat; the course's one-proposal block stays in
  `unit-chat.ts`),
  `unit-packages.ts` (the tutor's package requests: the card, Install and
  Not now, the install outside the chat's queue, a failed save's retry,
  and the cards replayed on reopening; the course's queue that admits
  requests and installs stays in `unit-chat.ts`),
  `unit-questions.ts` (ask_question's board: its refusals, the math read
  and code check a question must pass, the turn that asks again after
  another unit's install, and Stop's and close's aborts; the course's
  queue that admits a question stays in `unit-chat.ts`),
  `unit-answers.ts` (grading an answer: a choice at once, a written, math
  or code one kept and graded outside the chat's queue, and graded again
  after a failure; the help judge's calls on the tutor's replies to a
  message sent while a question is open, and an answer that waits for
  them; made for each loaded unit),
  `unit-end.ts` (the closing card, Move on, going over again, and the
  gate; made for each loaded unit),
  `unit-assessments.ts` (an assessment run from its start to its end:
  review, the gate and the test before a unit, the test's result card and
  the learner's answer to it, and why the unit's own steps wait meanwhile;
  made for each loaded unit),
  `unit-header.ts` (each turn's header: where the unit stands and what it
  says once, the notes, the record's notices and the learner's decisions,
  each delivered once; the new session that takes over when the tutor's
  conversation cannot be resumed; made for each loaded unit),
  `unit-opening.ts` (reopening a unit: the thread's questions, disputes,
  cards, status and phase shown again, what a restart left of the open
  question settled, and the step that waits resumed; a dispute's outcome,
  or an answer another unit's assessment recorded, taken in once the unit
  is open; made for each loaded unit),
  `unit-record.ts`, `unit-agents.ts`, `unit-turns.ts`, `check-rules.ts`,
  `assessment-rules.ts`; `transcript.ts`, `transcript-html.ts`,
  `handoff.ts`, `notes.ts`, `standalone-html.ts`. Grading: `grading.ts`,
  `math-check.ts`, `code-run.ts`, `help-judge.ts`, `disputes.ts`,
  `dispute-judge.ts`. Commands: `sandbox.ts` (the only way the engine runs
  model- or learner-written input), `source-convert.ts`, `packages.ts`.
  Sources: `source-text.ts` (an outline and a section as a model reads
  them), `source-shelf.ts` (what the source tools read, view, quote and
  search), `source-quote-index.ts` with `source-quote-worker.ts` (a
  course's texts off the server thread, for quote verification and for
  `source-passage-search.ts`; only previews and coordinates cross back).
  A planned passage is a range in a converted section, stable because a
  course's sources do not change after intake; quotes are verified against
  the converted text, never against what a read returned. Test doubles:
  `fake-timer.ts`, `fake-converter.ts`.
  Each of `unit-chat.ts`'s modules is a `createX({ ... })` factory whose
  argument names what it takes from the chat (a `Pick<UnitRecord, ...>`,
  the chat's queue as `exclusive`, getters for state the chat keeps,
  callbacks for what stays in `unit-chat.ts`); none imports from
  `unit-chat.ts`, which passes in any text they share. A tool's desk is
  made with the chat and reads `running` at each call; code for a loaded
  unit is made in `load` and held on `Running`. The chat keeps each
  learner action's guard (`act`, its wait for `loading`, its entry into
  the queue); the module that owns the action's concern holds its body.
- **`src/server/tools/`**: the teaching tools, transport-free (`tool.ts`),
  a file each; `sources.ts` holds `read_section`, `view_page`, `quote_source`,
  `present_lecture` and `search_source`. A lecture is recorded only once
  every quote verifies, as ordinary thread events, so live display, replay
  and export agree.
- **`src/server/backends/`**: `backend.ts` (the adapter), `claude.ts`
  (Agent SDK on the plan login), `codex.ts` (Codex's model and effort,
  with the live-check pin, and `codexUnavailable`, the check an intake
  makes before a course is made for Codex), `fake.ts` (tests),
  `scripted.ts` (the fake driven by turn headers, for `pnpm dev:fake`).
- **`src/server/http/`**: `app.ts` (every route, the event stream, the
  host and origin checks), `artifact-frame.ts` (an aid served to its frame).
- **`src/web/`**: a component per view (`Library`, `Intake`, `Profile`,
  `Course`, `Planning`, `Session`, `WhatIKnow`, `Notes`, `SourcePane`),
  its logic in a tested pure module beside it (`session.ts`, `progress.ts`,
  `diagram.ts`, ...); the thread's timeline is `src/shared/timeline.ts`.
  `prose.tsx` renders model and learner text as React elements, never
  HTML. `styles.css`: colours as named roles in one block, type registers
  near the top. CMU Serif is in `fonts/`; IBM Plex comes from Google Fonts.

## Prompts

`wireEngine` in `serve.ts` loads every file in `prompts/` and gives each
role its backend: a course's tutor and unit planner run on the course's
(`Course.backend`, through `courseBackend` in `engine/unit-planning.ts`),
every other role on Claude. Each prompt starts one model's instructions:

| Prompt | Model | Assembled in |
| --- | --- | --- |
| `tutor.md` | unit tutor; assessments are a section of it | `engine/unit-turns.ts`: `tutor.md`, the course's units, the unit and its plan, its sources' outlines, "# The learner" (profile, background note), "# Earlier units", then `style.md`; rebuilt when a session starts or resumes |
| `planner.md` | intake planner | `engine/intake.ts` |
| `course-planner.md` | a course's planning conversation | `engine/course-planning.ts` |
| `unit-planner.md` | a unit's planning session | `engine/unit-planning.ts` |
| `grader.md`, `help-judge.md`, `dispute-judge.md` | one-shot judges | `engine/grading.ts`, `help-judge.ts`, `dispute-judge.ts` |
| `handoff.md`, `notes.md` | one-shot writers | `engine/handoff.ts`, `engine/notes.ts` |

- A model is also instructed by turn headers (written in the files
  above), tool and zod field descriptions (`src/server/tools/`,
  `src/shared/`), and tool results and refusals. Before removing a
  repeated rule, check that the same model receives it on every turn
  where it applies.
- The scripted backend reads header wording; changing it can break
  `pnpm dev:fake` (`backends/scripted.test.ts` catches most of it).
- Thread text is Markdown with `$...$` and `$$` math and `\$` for a
  dollar; no `\(...\)`, HTML or images.
- In the normal app, one-shot models are constants in `backends/claude.ts`;
  `GAUSS_CLAUDE_MODEL` overrides all roles. The live-check launcher pins
  model and effort instead. Fake backend tests cover routing and
  validation, not judgment.

## Working here

Run commands under mise. `mise install` and `mise run setup` give the
pinned toolchain and dependencies; `mise run check` runs lint, type-check
and both test suites. Focused: `pnpm exec vitest run <file>` or
`uv run --directory pytools pytest <path>`. The Linux sandbox needs
`bwrap`, `socat` and `rg` on the machine. Fault injection
(`scripts/faults.ts`) only in an isolated worktree (`AGENTS.md`).

- **Vitest**: tests sit beside the code; expected results are worked out
  by hand. Engine flows run on the fake backend; idle closing on
  `engine/fake-timer.ts`; choice order is fixed with `order: givenOrder`.
  Wait for engine work through its `settled()` or a fake reply the test
  releases (`{ later }`), not `expect.poll` or `vi.waitFor`, whose 1-second
  default fails under load.
  Tests of the sandbox, math and code questions, source conversion and
  the upload route run real commands, so they fail where the sandbox
  cannot run; the intake's sources and `view_page` use
  `engine/fake-converter.ts`. A test of code that reads the DOM runs in
  happy-dom, named in its first line (`// @vitest-environment happy-dom`).
- **pytest**: expression pairs and expected sections worked out by hand;
  test PDFs are written with reportlab in Courier (so line lengths are
  known), EPUBs with `zipfile`.
- **Worktrees** (fault injection, or a check at an older revision):
  `git worktree add --detach <dir> <rev>`, link the repository's
  `node_modules` into it, then in it run `mise trust` and
  `mise exec -- uv sync --directory pytools --locked`; without that
  environment the sandbox, math, code and conversion tests fail. Remove
  the link before `git worktree remove --force <dir>`.
- **Gauss's Codex home** is `~/.local/state/gauss/codex`: outside every
  data root, so a fresh test root needs no new login, and holding only the
  login, the threads and the state Codex writes beside them (SQLite files,
  `models_cache.json`), never an `AGENTS.md` or configuration, since a
  home's `AGENTS.md` and configuration reach the model (`findings.md`,
  "Codex"). The CLI is pinned in
  `mise.toml`. The learner signs in once, from the repository so that
  mise runs the pinned version: `mkdir -p -m 700
  ~/.local/state/gauss/codex` (Codex refuses a home that does not exist),
  then `CODEX_HOME=~/.local/state/gauss/codex mise exec -- codex login`
  (`--device-auth` without a browser). `codex login status` with the same
  `CODEX_HOME` reports the login, and the app reads it with
  `account/read`. Never copy `auth.json` from `~/.codex`.
- **Codex trials with no model** use a scratch `CODEX_HOME` outside
  `/tmp`, never Gauss's or `~/.codex`, and a fresh data root, and run the
  pinned binary (`mise which codex` in the repository) from the trial's
  own folder, since the working folder's `AGENTS.md` files reach the
  model. `codex debug prompt-input` prints a model's input; `codex sandbox
  -P <profile> -C <folder> -- <command>` runs a command under a
  permission profile given by `-c`; `codex app-server generate-ts
  --experimental --out <folder>` writes the protocol's types.
  `turn/start` and `codex exec` call the model.
- **Browser checks with no model**: `pnpm dev:fake`, port 4330
  (`GAUSS_PORT`); seed and `--empty` in `scripts/dev-fake.ts`, scenario
  commands in `backends/scripted.ts`. Point `GAUSS_DATA_ROOT` at a fresh
  temporary directory for a clean run. Close the test browser before
  stopping the server. A file the browser uploads must lie inside the
  repository, where the Playwright tool reads: put it in `.playwright-mcp/`
  (git-ignored) and remove it afterwards. Section labels are uppercased by
  CSS and a page's text reads them so ("THE WEB"): wait on a selector or
  an `aria-label`. After opening a unit, wait until Send is enabled: the
  message box sends nothing until the chat has opened.
- **Chromium**: on NixOS, get its path with
  `nix build nixpkgs#chromium --no-link --print-out-paths` and pass
  `app: "<that path>/bin/chromium"` to `browser.open`. Omp's managed
  Chromium does not start here; WebKit reports an aid's errors only as
  "Script error.". With no input method, DevTools'
  `Input.imeSetComposition` (a CDP session from `tab.run`'s `page`) opens
  a composition, and an Enter sent then by `Input.dispatchKeyEvent`
  arrives with `isComposing` set.
- **Authorized real-model checks** use `mise exec -- pnpm check:live`.
  It starts the app on port 4320 in a fresh temporary data root.
  `createClaudeBackend` pins every role to the `AGENTS.md` model and
  effort, overriding both login defaults and harness options; for Codex,
  `codexOptions` in `backends/codex.ts` does the same. Opening a
  unit can spend plan usage; specify the run count before a comparison.
  Test sources: the user's Inwood
  _Phenomenology_ at `~/Books/Philosophy/Hegel/The Phenomenology of
  Spirit.pdf`, and arXiv 1706.03762 (Attention) and 1512.03385 (ResNet),
  downloaded. A course needs no intake: write it into the root
  with the record's own operations (`createCourse`, `saveProposal`,
  `approveCurriculum`, `storePlan` in `record/data-root.ts`), as
  `record/dev-seed.ts` does, from a throwaway script run with `node`. For
  repeated runs of a role prompt, the same script can skip the server:
  build `createUnitChats`, `createUnitPlanner`, `createIntakes` or
  `createCoursePlannings` on `createClaudeBackend` with the prompt's text,
  wired as `wireEngine` in `serve.ts` does, send the learner's moves, and
  save the chat's `events()`. Pass the script to the launcher, for example
  `mise exec -- pnpm check:live node /tmp/trial.ts`, and use its
  `GAUSS_DATA_ROOT`. For isolated live sessions, launch a separate
  process through it for each root. Await `chat.settled()` after each
  `turn_end` before taking the next action.

- **Grader and judge prompts and schemas**: for authorized live
  comparisons use `mise exec -- pnpm check:live node scripts/grade-set.ts
  --runs 2`, or substitute `judge-set.ts` for help and `decide-set.ts` for
  disputes. `--prompt` and `--only` compare the same cases against an old
  and a new prompt. They run on the launcher's model and effort, not the
  role's own (`JUDGE_MODEL` is Haiku), and refuse to run without it.
- **A live Claude script reaches the model only through
  `createClaudeBackend`**, where the launcher's pin is applied; a direct
  `query()` or `claude -p` would run on the login's default. A live Codex
  script drives `codex app-server` in Gauss's Codex home with the
  configuration in `findings.md`, "Codex", and gives the model and effort
  `codexOptions` returns on every `turn/start`.
- **What a run sent and got**: request headers, tool inputs, results and
  thinking are in Claude Code's session log under
  `~/.claude/projects/<the course's workspace folder, every character but
  letters and digits made "-">/`; the page events are in the course's
  `sessions/`. In the log, a user line's `toolUseResult` is a tool's
  structured output, and `api-request-shape` lines, written when the
  request's shape changes, list the session's tools:

  ```sh
  jq -r 'select(.type=="api-request-shape")
    | [.timestamp, ([.shape.tools[].name] | join(","))] | @tsv' <log>.jsonl
  ```

  For Codex, a thread's rollout in Gauss's Codex home
  (`sessions/<yyyy>/<mm>/<dd>/rollout-*-<thread id>.jsonl`) holds every
  item the model was given and gave; Codex's own log is the `logs` table
  of `logs_2.sqlite` there, by `thread_id`.
