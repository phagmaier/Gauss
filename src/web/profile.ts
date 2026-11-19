// What the Profile page's foot says about the text in its box
// (docs/prototype/18-profile.html): its length against the limit, whether
// it is saved, and whether it can be.

import { PROFILE_LIMIT } from "../shared/profile.ts";

export interface ProfileFoot {
  /** "1,234 of 2,000 characters". */
  count: string;
  /** Longer than the limit. */
  over: boolean;
  /** The box differs from the saved text. */
  changed: boolean;
  canSave: boolean;
  /** "Saved", "Not saved", "Too long to save", or nothing. */
  note: string;
}

/**
 * The foot for the box's text, against the saved text; `justSaved` once a
 * save has landed and nothing was typed since. Counted, compared and saved
 * trimmed, as the server keeps it.
 */
export function profileFoot(
  text: string,
  saved: string,
  justSaved: boolean,
): ProfileFoot {
  const length = text.trim().length;
  const over = length > PROFILE_LIMIT;
  const changed = text.trim() !== saved.trim();
  const number = (n: number) => n.toLocaleString("en-GB");
  return {
    count: `${number(length)} of ${number(PROFILE_LIMIT)} characters`,
    over,
    changed,
    canSave: changed && !over && length > 0,
    note: !changed
      ? justSaved
        ? "Saved"
        : ""
      : over
        ? "Too long to save"
        : "Not saved",
  };
}
