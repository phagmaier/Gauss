# Gauss

A personal, local teaching harness: a web app that drives Claude (later also
Codex) as a tutor, enforces a teach / discuss / check rhythm, and keeps a
durable record of what the learner has mastered. The learner and the person
directing development are the same person, called "the user" here.

## Documents

Read only what the task needs.

| Document | Holds | Read when |
| --- | --- | --- |
| [Plan](docs/plan.md) | Open tasks, dependencies, and user checks | First when taking a plan task or checking stage status |
| [Product brief](docs/brief.md) | Intended behaviour and shared terms | When working on product behaviour or terminology; read the relevant sections |
| [Architecture](docs/architecture.md) | How the system works now | Sections 1 and 2 for orientation; then the sections the task touches |
| [Decisions](docs/decisions.md) | Rationale, SDK findings, and known gaps | Follow the index to the relevant sections; don't load the whole file |

Use the terms as `brief.md` defines them (course, unit, objective, segment,
session, evidence, detour). Do not introduce synonyms in code or documents.

A finished task lives in its commit, whose message starts with the task id:
`git log --grep='^2\.13'` finds the task that code comments call "task
2.13", and `git show` on it gives the task's text (the plan's diff) and the
checks it passed (the message).

## Finding things

- Code (where a symbol is defined, who calls it, what a change affects):
  the codebase-memory tools first, then read the file. Grep for exact
  strings and known paths.
- Libraries and SDKs (the Claude Agent SDK, Hono, Vite, React, zod, Vitest,
  Biome): look the call up with context7 before writing or debugging it.
  This project uses very new major versions, so remembered APIs are often
  out of date.

## How to work a task

Use this workflow for an authorized plan task or when asked to continue the
build. A question, review, or manual check does not by itself authorize
starting a plan task, editing files, or committing.

1. In `docs/plan.md`, take the first open task marked `todo` whose
   dependencies are done, unless the user names a different one. A task no
   longer listed in the plan is done. Mark it `in progress`.
2. Do that task only. If it turns out to be too large, split it in the plan
   and finish the first part.
3. Check it against the task's "done when" line with evidence you observed:
   a passing test run, a command's output, or the behaviour in the browser.
4. Update the documents, as "Keeping the documents" says.
5. Delete the task's entry from the plan. Anything a later task needs goes
   into that task's or stage's note in the plan, or into the document where
   it belongs.
6. Commit the task's changes and the document updates together as one
   commit. The message starts with the task id (`2.13: transcripts`); its
   body says what was checked and how (the commands and their results,
   browser and real-model runs, faults injected into the code) and what
   was not checked. Do not commit if the "done when" check failed; leave
   the task `in progress` and report why.
7. Report what you checked and what you could not check, then stop. Start
   the next task only if the user asked for more than one.

If a task's premise is wrong (an SDK behaves differently, a design rule does
not work), stop, record the finding in `docs/decisions.md`, update the
affected part of `architecture.md` and the plan, and tell the user. Do not
build around a documented rule silently.

A stage is finished only when the user has tried its "user check"
themselves. Do not start the next stage before that. When it passes, the
stage becomes one line under "Finished" in the plan.

## Keeping the documents

Write what a later agent needs and cannot get more cheaply from the code.

| What you learned | Where it goes |
| --- | --- |
| How the system now behaves | `architecture.md`, edited in place; product behaviour the user decided, `brief.md` |
| Why it is so: a choice between real alternatives, the user's decision, an SDK or tool finding, a trap the code does not show | `decisions.md`, under its topic |
| A gap left open | the plan, on the task or stage that will close it; otherwise `decisions.md`, "Known gaps" |
| Proof the task was done | the commit message |
| What the code does step by step | nowhere: the code and its tests say it |

- **Describe the present.** Rewrite or delete text that a change makes
  false. Do not append "since task 2.19" or "before this, ..." to
  `architecture.md` or `brief.md`, and do not cite task ids there.
- **One place per fact.** Elsewhere, point to it. Point at files and
  symbols rather than restating what the code shows.
- **A `decisions.md` entry is a few lines**: what was decided, why, the
  evidence in a line, and who chose. The user's decisions say so; the
  agent's choices are open to change. When a decision is replaced, rewrite
  its entry; keep the old choice only as one line on why it was dropped, if
  someone might otherwise try it again.
- **Not in any document**: test counts, lists of tests or injected faults,
  narrations of browser runs, and which files a task touched. Those belong
  in the commit.

## Working with the user

The user delegates technical choices, and design choices they have no basis
to judge. Ask only about the experience or a trade-off whose answer
changes what gets built. Record a delegated choice in `decisions.md` when
its rationale would help a later agent avoid repeating the investigation.

## Project rules

- **Automated tests never call a real model backend.** Use the fake backend
  in `src/server/backends/fake.ts`. Real-backend runs spend the user's plan
  usage: do them only where a task calls for one, and keep them short.
- **Real-backend checks use a cheap model** unless the check depends on how
  well the tutor teaches. To see that a call, a tool or a flow works, run
  Claude Haiku 5.5 (`GAUSS_CLAUDE_MODEL=claude-haiku-5-5 pnpm dev`), or a
  cheap OpenAI model on the Codex side. Use Sonnet or Opus only when the
  result depends on the model's judgment (the user's request, 2026-11-15).
- **Tests never touch the real data root** (`~/gauss/` by default). Point
  the data root at a temporary directory.
- **Browser checks that need no real tutor run on `pnpm dev:fake`**, which
  calls no model. End every browser run by closing the browser, before the
  server stops: a session page left open keeps opening its unit on whatever
  server next comes up on its port, and on a real backend that plans and
  teaches the unit.
- **The engine never imports an agent SDK.** Only files under
  `src/server/backends/` do.
- **Objective status is derived from the evidence log**, never stored.
- **Data shapes are defined once**, as zod schemas in `src/shared/`.
  Documents describe behaviour and point at the schemas; they do not
  restate fields.
- **Prompts live in `prompts/`** as files, not as strings in code.
- Do not set or rely on `ANTHROPIC_API_KEY`. The app runs on the user's
  plan login; see `architecture.md` section 7.

## Authorization

- Commit once per finished task, as described above. The user authorized
  this on 2026-11-13. Never push, and never rewrite existing commits.
- Do not add a dependency that `architecture.md` section 2 does not list
  without saying why in your report.
- Leave `docs/brief.md` decisions alone unless the user changes them;
  propose changes instead.

## Commands

Runtimes are pinned in `mise.toml`. Run everything inside mise: a shell with
mise activated, or `mise exec -- <command>`.

| Purpose | Command |
| --- | --- |
| Install the pinned runtimes | `mise install` |
| Install dependencies | `mise run setup` |
| Lint, type-check and both test suites | `mise run check` |
| Lint and format check | `pnpm lint` |
| Apply formatting and safe fixes | `pnpm format` |
| Type-check | `pnpm typecheck` |
| Test, TypeScript | `pnpm test` (`pnpm test:watch` while working) |
| Test, Python helpers | `uv run --directory pytools pytest` |
| Run the app on Claude (http://localhost:4320; opening a unit can spend plan usage even without sending a message) | `pnpm dev` |
| Run the app with no model (http://localhost:4330; `--empty` skips seeding) | `pnpm dev:fake` |
| Grade the grader's hand-graded set (real model) | `node scripts/grade-set.ts --runs 2` (`--model`, `--prompt`, `--only`) |
| Judge the help judge's hand-judged set (real model) | `node scripts/judge-set.ts --runs 2` (same options) |
| Decide the dispute judge's hand-judged set (real model) | `node scripts/decide-set.ts --runs 2` (same options) |

| Variable | Effect |
| --- | --- |
| `GAUSS_CLAUDE_MODEL` | The model of every session, the grader's and both judges' included. Unset: the learner's Claude Code default, Sonnet 5.5 for the grader and the dispute judge, Haiku 5.5 for the help judge |
| `GAUSS_DATA_ROOT` | The folder that holds the courses; `~/gauss` when unset. Point it at a scratch folder for trial runs |
| `GAUSS_PORT` | The port |
| `GAUSS_BACKUP` | The data root's git history: `off` turns it off under `pnpm dev`, `on` turns it on under `pnpm dev:fake` |

- The server prints the data root when it starts, and the model each
  session runs on. Stop it with Ctrl-C.
- The engine's sandbox needs, on Linux, `bwrap`, `socat` and `rg` on the
  path, which mise does not install. Without them the server says what is
  missing when it starts, and the sandbox's tests fail.
- `pnpm dev:fake` runs the same server (`src/server/serve.ts`) on the
  scripted backend; the header of `src/server/backends/scripted.ts` says
  what its tutor does and what `/hold`, `/revise`, `/one-off` and `/fail`
  in a message do. Its scripted planner asks a question first, so a browser
  check takes two messages to reach a proposal card. Its data root is
  `GAUSS_DATA_ROOT`, or `gauss-fake` in the temporary folder, never the
  real one. An empty data root is seeded with courses in each state
  (`src/server/record/dev-seed.ts`), and one with courses is kept, so a
  restart keeps the record; for a fresh seed, use a new folder.
- TypeScript tests sit beside the code as `src/**/*.test.ts`; Python tests
  are in `pytools/tests/`.
- Imports name the real file, with its `.ts` extension, and only erasable
  TypeScript syntax is allowed (no `enum`, no parameter properties).
- Biome lints and formats code and config. Markdown and `docs/` are
  excluded.
- Add dependencies with `pnpm add` and `uv add --directory pytools`, and
  commit both lockfiles. pnpm refuses releases less than a day old
  (`pnpm-workspace.yaml`).
