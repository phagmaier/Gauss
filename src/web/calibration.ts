// What a course's "What I know" says of calibration (tasks 2.27 and 2.29):
// for each confidence level, lowest first, how many of the answers given at
// it were correct, as counts ("8 of 10 correct"), then how many questions
// were answered "I don't know". The counts come from the server
// (src/server/record/calibration.ts), which leaves out every answer given
// with help.

import type { Calibration } from "../shared/calibration.ts";
import { confidenceLabel } from "../shared/question.ts";

export interface CalibrationRow {
  label: string;
  text: string;
}

const NONE = "None yet";

export function calibrationRows(calibration: Calibration): CalibrationRow[] {
  const levels = calibration.levels.map(
    ({ confidence, correct, answered }): CalibrationRow => {
      const label = confidenceLabel(confidence);
      return {
        label: `${label[0]?.toUpperCase()}${label.slice(1)}`,
        text: answered === 0 ? NONE : `${correct} of ${answered} correct`,
      };
    },
  );
  const { unknown } = calibration;
  return [
    ...levels,
    {
      label: "I don't know",
      text:
        unknown === 0 ? NONE : `${unknown} question${unknown === 1 ? "" : "s"}`,
    },
  ];
}

/** Whether there is anything to count: the page leaves the counts out until then. */
export function hasCalibration(calibration: Calibration): boolean {
  return (
    calibration.unknown > 0 || calibration.levels.some((l) => l.answered > 0)
  );
}
