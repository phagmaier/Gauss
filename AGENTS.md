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
| [Architecture](docs/architecture.md) | How the system works now | Read the relevant sections; sections 1–2 orient new contributors |
| [Decisions](docs/decisions.md) | Rationale, SDK findings, and known gaps | Follow the index to the relevant sections; don't load the whole file |
| [Prompts](docs/architecture.md#9-prompts) | Model instructions, including [`prompts/`](prompts/) and engine-supplied text | When changing what a model is told |
| [Mock index](docs/prototype/index.html) | Selected and historical page designs | When a task names a piece or changes a layout |

Use the terms as `brief.md` defines them (course, unit, objective, segment,
session, evidence, detour). Do not introduce synonyms in code or documents.

Recover a finished task's text from the commit that removed its heading,
e.g. `git log -1 -p -G '^### 2\.13 ' -- docs/plan.md`. The commit message
records its checks.

## Finding things

- Use codebase-memory for cross-file structure and change impact; use the
  language server for exact definitions and references. Read known files
  directly and search for exact literals.
- Check Context7 when adding or debugging library or SDK calls whose
  behaviour you need to verify.

## How to work a task

Use this workflow for an authorized plan task or when asked to continue the
build. A question, review, or manual check does not by itself authorize
starting a plan task, editing files, or committing.

1. In `docs/plan.md`, take the first open task marked `todo` whose
   dependencies are done, unless the user names a different one. A task no
   longer listed in the plan is done. Mark it `in progress`. Uncommitted
   changes that no task in progress explains are someone's unfinished
   work: leave them out of your commit and tell the user.
2. Do that task only. If it turns out to be too large, split it in the plan
   and finish the first part.
3. Check it against the task's "done when" line with evidence you observed:
   a passing test run, a command's output, or the behaviour in the browser.
4. Update the documents, as "Keeping the documents" says.
5. Delete the task's entry from the plan. Anything a later task needs goes
   into that task's or stage's note in the plan, or into the document where
   it belongs.
6. Commit the task's changes and the document updates together as one
   commit. Start the message with the task id (`2.13: transcripts`) and
   record checks, outcomes and limits. If a "done when" check fails, leave
   the task `in progress` without committing and report why.
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

- **Automated tests never call a real model backend.** Use the fake
  backend. Run a real model only for a task's required checks; use a cheap
  model unless the result depends on model judgment.
- **Tests and trial runs never use the real data root.** Use a temporary
  directory. See [Testing](docs/architecture.md#11-testing) for safe
  commands.
- **Browser checks use `pnpm dev:fake` unless a real model is required.**
  Use Chromium unless checking another engine. Close the test browser
  before stopping the server so a left-open tab cannot contact a later
  real server.
- **Run fault injection only in an isolated worktree.** Restoration
  replaces entire files; never restore over newer edits.
- **The engine never imports an agent SDK.** Only files under
  `src/server/backends/` do.
- **Objective status is derived from the evidence log**, never stored.
- **Data shapes are defined once**, as zod schemas in `src/shared/`.
  Documents describe behaviour and point at the schemas; they do not
  restate fields.
- Keep static role prompts in `prompts/`. Turn headers, tool and field
  descriptions, results and refusals also instruct the model; see
  [Prompts](docs/architecture.md#9-prompts).
- Do not set or rely on `ANTHROPIC_API_KEY`. Use the
  [plan login](docs/architecture.md#7-backends).

## Authorization

- Commit once per finished task, as described above. The user authorized
  this on 2026-11-13. Document changes the user agrees to outside a task
  (decisions from a discussion, tasks from a check) are one commit of
  their own, the message starting `Plan:`. Fixes from a review of a
  task's commit are committed once checked, as their own commit, the
  message starting with the task id (`5.18: fix the review's four
  findings`). Never push, and never rewrite existing commits.
- Do not add a dependency that `architecture.md` section 2 does not list
  without saying why in your report.
- Leave `docs/brief.md` decisions alone unless the user changes them;
  propose changes instead.

## Tooling

- Run commands under mise (`mise exec -- <command>`). Setup and check
  commands are in [Testing](docs/architecture.md#11-testing).
- Import `.ts` files by their real extension and use only erasable
  TypeScript syntax (no `enum` or parameter properties).
- Add dependencies with `pnpm add` or `uv add --directory pytools` and
  commit the affected lockfile.
