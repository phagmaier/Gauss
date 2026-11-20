// An objective's or a unit's status drawn as a form as well as a colour
// (docs/decisions.md, "Page design", "Status shows by form as well as
// colour"), so that it reads in a light theme too. The status word stays
// beside it, so the form is hidden from assistive technology.

import type { ObjectiveStatus, UnitStatus } from "../shared/status.ts";

/**
 * What a form stands for: an objective's status or a unit's, and whether it
 * is the current one (`currentObjective` in plan.ts; the unit the course
 * view's card leads to), which draws the accent's ringed form instead.
 */
export type FormOf = ({ objective: ObjectiveStatus } | { unit: UnitStatus }) & {
  current?: boolean;
};

const OBJECTIVE: Record<ObjectiveStatus, string> = {
  passed: "pass",
  retained: "kept",
  slipping: "slip",
  attempted: "att",
  overridden: "over",
  "not-started": "not",
};

const UNIT: Record<UnitStatus, string> = {
  passed: "pass",
  overridden: "over",
  "in-progress": "att",
  "not-started": "not",
};

export function StatusForm(props: FormOf) {
  const form =
    props.current === true
      ? "now"
      : "objective" in props
        ? OBJECTIVE[props.objective]
        : UNIT[props.unit];
  return <i className={`sg ${form}`} aria-hidden="true" />;
}
