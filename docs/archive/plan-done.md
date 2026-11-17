

### 2.29 Calibration per course

- Status: done
- Depends on: 2.26, 2.27
- Why: the user finds counts across all courses meaningless: how sure one
  is in theology and in math are different things. It reverses the
  "across all courses" of "Stage 2 review".
- Do: the counts of 2.27, of one course's answers only, on that course's
  "What I know" page, near the top; the library's counts and
  `GET /api/calibration` removed. What counts is 2.27's.
- Done when: a route test on a hand-made record shows one course's counts
  and none of another course's; page logic tests pass; `mise run check`
  passes; on `pnpm dev:fake` a seeded course's "What I know" shows its
  counts and the library shows none, and the browser is closed before the
  server stops.
- Note: done on 2026-11-17. `countCalibration` counts one course's log
  and `whatIKnow` sends it; the library's section, `GET /api/calibration`
  and `readCalibration` are gone; `brief.md` says per course. `mise run
  check` passed (671 TypeScript tests); on `pnpm dev:fake` Calculus I's
  "What I know" showed "90%: 4 of 4 correct", a course with no answers
  none, and the library none; the browser was closed before the server
  stopped. Findings: `decisions.md`, "Calibration per course".
