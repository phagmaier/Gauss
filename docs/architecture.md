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
mise.toml      pinned node, pnpm, python, uv; `mise run setup`, `mise run check`
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
  uploads/<intake-id>/         sources attached before the course exists; emptied at each start
  cache/package-uv/            uv's install cache
  courses/<course-id>/
    course.json  style.md  background.md  curriculum.json  state.json
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
  flush, rename (`record/atomic-write.ts`). Logs are appended a line at a
  time (`record/json-lines.ts`); each file's writes queue behind each
  other (`record/file-lock.ts`). State is written before the page hears
  of a change; an answer is appended before its question closes.
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
  `unit-chat.ts` (phases, assessments, proposals, the learner's actions)
  with `unit-record.ts`, `unit-agents.ts`, `unit-turns.ts`, `check-rules.ts`,
  `assessment-rules.ts`; `transcript.ts`, `transcript-html.ts`,
  `handoff.ts`, `notes.ts`, `standalone-html.ts`. Grading: `grading.ts`,
  `math-check.ts`, `code-run.ts`, `help-judge.ts`, `disputes.ts`,
  `dispute-judge.ts`. Commands: `sandbox.ts` (the only way the engine runs
  model- or learner-written input), `source-convert.ts`, `packages.ts`.
  Sources: `source-text.ts`, `source-shelf.ts`, `source-quote-worker.ts`.
  `source-passage-search.ts` runs lexical searches on the same worker and
  converted text as quote verification. Only passage previews and their
  coordinates cross back to the server thread.
  A planned passage is a range in a converted section, stable because a
  course's sources do not change after intake. Its coordinates come from
  `shared/source.ts`; the quote verifier still checks the converted source,
  not the text returned to the tutor by a read.
  Test doubles: `fake-timer.ts`, `fake-converter.ts`.
- **`src/server/tools/`**: the teaching tools, transport-free (`tool.ts`),
  a file each; `sources.ts` holds `read_section`, `view_page`, `quote_source`,
  `present_lecture` and `search_source`. A lecture is only recorded after
  all quote selectors verify. It uses ordinary transcript events so
  live display, replay and export agree.
- **`src/server/backends/`**: `backend.ts` (the adapter), `claude.ts`
  (Agent SDK on the plan login), `fake.ts` (tests), `scripted.ts` (the
  fake driven by turn headers, for `pnpm dev:fake`).
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

`serve.ts` loads every file in `prompts/`; each starts one model's
instructions:

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
- One-shot models are constants in `backends/claude.ts`;
  `GAUSS_CLAUDE_MODEL` replaces every model, the tutor's included. Fake
  backend tests cover routing and validation, not judgment: compare a
  consequential wording change on the same cases (below).

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
  Tests of the sandbox, math and code questions, source conversion and
  the upload route run real commands, so they fail where the sandbox
  cannot run; the intake's sources and `view_page` use
  `engine/fake-converter.ts`. A test of code that reads the DOM runs in
  happy-dom, named in its first line (`// @vitest-environment happy-dom`).
- **pytest**: expression pairs and expected sections worked out by hand;
  test PDFs are written with reportlab in Courier (so line lengths are
  known), EPUBs with `zipfile`.
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
  "Script error.".
- **Real-model checks**, only when required, on a fresh temporary data
  root (`pnpm dev`, port 4320). Opening a unit can spend plan usage before
  anyone sends a message. Before a live comparison, specify the model,
  effort and run count (`model` and `effort` of `createClaudeBackend`); do
  not inherit Opus from the login.
  A course needs no intake: write it into the root
  with the record's own operations (`createCourse`, `saveProposal`,
  `approveCurriculum`, `storePlan` in `record/data-root.ts`), as
  `record/dev-seed.ts` does, from a throwaway script run with `node`. For
  repeated runs of a role prompt, the same script can skip the server:
  build `createUnitChats`, `createUnitPlanner`, `createIntakes` or
  `createCoursePlannings` on `createClaudeBackend` with the prompt's text,
  wired as `serve.ts` does, send the learner's moves, and save the chat's
  `events()`. A short smoke run on the plan login:

  ```sh
  scratch=$(mktemp -d) &&
    GAUSS_DATA_ROOT="$scratch" GAUSS_CLAUDE_MODEL=claude-haiku-5-5 \
    mise exec -- pnpm dev
  ```

- **Prompt and model changes**: re-run `node scripts/grade-set.ts --runs 2`
  when `grader.md`, `WrittenGrade` or `GRADER_MODEL` changes;
  `judge-set.ts` for `help-judge.md`, `HelpJudgment` or `JUDGE_MODEL`;
  `decide-set.ts` for `dispute-judge.md`, `disputeRequest`,
  `DisputeJudgment` or `DISPUTE_MODEL`. With `--prompt` and `--only` they
  run the same cases against an old and a new version.
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
