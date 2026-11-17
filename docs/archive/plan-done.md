

### 2.28 Library rows open the course page

- Status: done
- Depends on: 2.12
- Why: the user prefers a click on a course in the library to open its
  course page, not the session of the unit last in progress.
- Do: every library row opens its course view, a draft's included, whose
  "Review the curriculum" opens the review. The course view's card still
  continues the unit in progress, and "Start unit 1" after approval and
  the closing card's "Start unit N" still open the session.
- Done when: `mise run check` passes; on `pnpm dev:fake` a row of a course
  with a unit in progress, a draft's and a finished course's each open
  their course page, and the browser is closed before the server stops.
- Note: done on 2026-11-17. `Library.tsx` opens `paths.course` for every
  row; `resume` left `Standing` (`library.ts`) and its five test cases.
  `mise run check` passed (673 TypeScript tests). On `pnpm dev:fake`,
  Calculus I (a unit in progress), Topology (a draft), Probability
  (finished) and "What is a group?" (a one-off in progress) each opened
  their course page; the draft's "Review the curriculum" opened its review;
  no console errors; the browser was closed before the server stopped.
  Findings: `decisions.md`, "User check of 2.23 to 2.27".
