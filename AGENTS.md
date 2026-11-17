# Gauss

A personal, local teaching harness: a web app that drives Claude (later also
Codex) as a tutor, enforces a teach / discuss / check rhythm, and keeps a
durable record of what the learner has mastered. The learner and the person
directing development are the same person, called "the user" here.

## Read before working

Read only what the task needs; the documents are large.

| Document | Holds | Read when |
| --- | --- | --- |
| `docs/plan.md` | Status table of finished tasks, and the open tasks with their completion checks | Always, first. It says what to do next. |
| `docs/brief.md` | What the product does, and the meaning of its terms | Its "Terms" section always; other sections only for the behaviour the task touches |
| `docs/architecture.md` | Structure, data layout, engine rules, tool list, SDK facts | Sections 1 and 2 for any code task; then only the sections the task touches: 3 data, 4 engine, 5 tools, 6 grading, 7 backends (long; backend and SDK work only), 8 sources (stage 4), 9 prompts, 10 page |
| `docs/decisions.md` | Findings and choices made during the build | One section, found through the index at its top. Never the whole file. |
| `docs/archive/plan-done.md` | Full text of finished tasks | Rarely; only to see what a finished task asked for |

Use the terms as `brief.md` defines them (course, unit, objective, segment,
session, evidence, detour). Do not introduce synonyms in code or documents.

## Finding things

- Locating code (where a symbol is defined, who calls it, what a change
  affects): use the codebase-memory tools first (`search_graph`, `trace_path`,
  `get_architecture`), then read the file. Check `index_status` first and run
  `index_repository` if it is stale. Use grep for exact strings and known
  paths.
- Using a library or SDK (the Claude Agent SDK, Hono, Vite, React, zod,
  Vitest, Biome): look it up with context7 before writing or debugging the
  call. This project uses very new versions (see `docs/decisions.md`,
  "Toolchain"), so memory of the API is often out of date.

## How to work a task

1. In `docs/plan.md`, take the first open task marked `todo` whose
   dependencies are done (in the table of finished tasks, or `done` above),
   unless the user names a different one. Mark it `in progress`.
2. Do that task only. If it turns out to be too large, split it in the plan
   and finish the first part.
3. Check it against the task's "done when" line with evidence you observed:
   a passing test run, a command's output, or the behaviour in the browser.
4. Mark it `done`. Then move its entry from the open list to the end of
   `docs/archive/plan-done.md` and add a row for it to the plan's table of
   finished tasks, with one line on anything a later task needs. Put
   findings in `docs/decisions.md` and add the section to its index.
5. Commit the task's changes and the plan update together as one commit, with
   the task id at the start of the message (for example `0.1: toolchain`). Do
   not commit if the "done when" check failed; leave the task `in progress`
   and report why.
6. Report what you checked and what you could not check, then stop. Start the
   next task only if the user asked for more than one.

If a task's premise is wrong (an SDK behaves differently, a design rule does
not work), stop, record the finding in `docs/decisions.md`, update the affected
part of `architecture.md` and the plan, and tell the user. Do not build around
a documented rule silently.

A stage is finished only when the user has tried its "user check" themselves.
Do not start the next stage before that.

## Project rules

- **Automated tests never call a real model backend.** Use the fake backend in
  `src/server/backends/fake.ts`. Real-backend runs spend the user's plan usage:
  do them only where a task calls for one, and keep them short.
- **Real-backend checks use a cheap model** unless the check depends on how
  well the tutor teaches. To see that a call, a tool or a flow works, run
  Claude Haiku 5.5 (`GAUSS_CLAUDE_MODEL=claude-haiku-5-5 pnpm dev`), or a
  cheap OpenAI model on the Codex side, whose subscription the user minds
  less. Use Sonnet or Opus only when the result depends on the model's
  judgment (the user's request, 2026-11-15).
- **Tests never touch the real data root** (`~/gauss/` by default). Point the
  data root at a temporary directory.
- **Browser checks that need no real tutor run on `pnpm dev:fake`**, which
  calls no model. End every browser run by closing the browser, before the
  server stops: a session page left open keeps opening its unit on whatever
  server next comes up on its port, and on a real backend that plans and
  teaches the unit.
- **The engine never imports an agent SDK.** Only files under
  `src/server/backends/` do.
- **Objective status is derived from the evidence log**, never stored.
- **Data shapes are defined once**, as zod schemas in `src/shared/`. Documents
  describe behaviour and point at the schemas; they do not restate fields.
- **Prompts live in `prompts/`** as files, not as strings in code.
- Do not set or rely on `ANTHROPIC_API_KEY`. The app runs on the user's plan
  login; see `architecture.md` section 7.

## Authorization

- Commit once per finished task, as described above. The user authorized this
  on 2026-11-13. Never push, and never rewrite existing commits.
- Do not add a dependency that `architecture.md` section 2 does not list
  without saying why in your report.
- Leave `docs/brief.md` decisions alone unless the user changes them; propose
  changes instead.

## Commands

Runtimes are pinned in `mise.toml`. Run everything inside mise: a shell with
mise activated, or `mise exec -- <command>`.

| Purpose | Command |
| --- | --- |
| Install the pinned runtimes | `mise install` |
| Install dependencies | `mise run setup` (`pnpm install`, then `uv sync --directory pytools`) |
| Lint, type-check and both test suites | `mise run check` |
| Lint and format check | `pnpm lint` |
| Apply formatting and safe fixes | `pnpm format` |
| Type-check | `pnpm typecheck` |
| Test, TypeScript | `pnpm test` (`pnpm test:watch` while working) |
| Test, Python helpers | `uv run --directory pytools pytest` |
| Run the app (server and page, http://localhost:4320) | `pnpm dev` |
| Run the app with no model, on seeded courses (http://localhost:4330) | `pnpm dev:fake` (`--empty` for no courses) |
| Grade the grader's hand-graded set (real model, spends plan usage) | `node scripts/grade-set.ts --runs 2` (`--model`, `--prompt`, `--only`) |
| Judge the help judge's hand-judged set (real model, spends plan usage) | `node scripts/judge-set.ts --runs 2` (`--model`, `--prompt`, `--only`) |

- `pnpm dev` talks to the real Claude backend and spends plan usage once a
  message is sent. Stop it with Ctrl-C. `GAUSS_PORT` changes the port,
  `GAUSS_CLAUDE_MODEL` the model of every session, the grader's and the
  help judge's included (left unset, the learner's Claude Code default,
  Sonnet 5.5 for the grader and Haiku 5.5 for the judge), and `GAUSS_DATA_ROOT` the folder that holds the courses (left
  unset, `~/gauss`; point it at a scratch folder for trial runs). The server
  prints the data root when it starts, and the model each session runs on.
  It keeps the record's history in git in the data root, committing after
  each segment close, unit end and approval (task 2.25); `GAUSS_BACKUP=off`
  turns that off.
- `pnpm dev:fake` runs the same server on the scripted backend
  (`src/server/backends/scripted.ts`, whose header says what its tutor does:
  a choice question asks for a sum and the right choice is that sum, at a
  letter the engine's shuffle picks; a written answer is correct unless it
  says "wrong"; and `/hold`, `/revise`, `/one-off` and `/fail` in a message do
  what the header says). Its data root is `GAUSS_DATA_ROOT`, or `gauss-fake`
  in the temporary folder, never the real one; an empty one is seeded with
  courses in each state (`src/server/record/dev-seed.ts`), and one with
  courses is kept, so a restart keeps the record. For a fresh seed, point
  `GAUSS_DATA_ROOT` at a new folder. Its backup is off unless
  `GAUSS_BACKUP=on`.
- The page is in `src/web` (React, built by Vite); the server starts at
  `src/server/main.ts`, and is wired in `src/server/serve.ts`.

- TypeScript tests sit beside the code as `src/**/*.test.ts`. Python tests are
  in `pytools/tests/`.
- Imports name the real file, with its `.ts` extension, and only erasable
  TypeScript syntax is allowed (no `enum`, no parameter properties). See
  `tsconfig.json`.
- Biome lints and formats code and config. Markdown and `docs/` are excluded.
- Add dependencies with `pnpm add` and `uv add --directory pytools`, and
  commit both lockfiles. pnpm refuses releases less than a day old
  (`pnpm-workspace.yaml`).
