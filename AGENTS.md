# Gauss

A personal, local teaching harness: a web app that drives Claude (later also
Codex) as a tutor, enforces a teach / discuss / check rhythm, and keeps a
durable record of what the learner has mastered. The learner and the person
directing development are the same person, called "the user" here.

## Read before working

| Document | Holds | Read when |
| --- | --- | --- |
| `docs/plan.md` | Stages, tasks, their status and completion checks | Always, first. It says what to do next. |
| `docs/brief.md` | What the product does, and the meaning of its terms | Before any task that touches behaviour |
| `docs/architecture.md` | Structure, data layout, engine rules, tool list, SDK facts | Before any task that touches code |
| `docs/decisions.md` | Findings and choices made during the build (created in stage 0) | When a task depends on an earlier finding |

Use the terms as `brief.md` defines them (course, unit, objective, segment,
session, evidence, detour). Do not introduce synonyms in code or documents.

## How to work a task

1. In `docs/plan.md`, take the first task marked `todo` whose dependencies are
   `done`, unless the user names a different one. Mark it `in progress`.
2. Do that task only. If it turns out to be too large, split it in the plan
   and finish the first part.
3. Check it against the task's "done when" line with evidence you observed:
   a passing test run, a command's output, or the behaviour in the browser.
4. Mark it `done` and add a one-line note under it if you learned something a
   later task needs.
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
- **Tests never touch the real data root** (`~/gauss/` by default). Point the
  data root at a temporary directory.
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

None yet. Stage 0 task 0.1 sets up the toolchain and replaces this section
with the install, test, lint, type-check and run commands.
