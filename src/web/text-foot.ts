// What the foot of a text box saved whole says about its text (the Profile
// page, docs/prototype/18-profile.html; the Settings page's instructions,
// 25-settings.html): its length against the limit, whether it is saved,
// and whether it can be.

export interface TextFoot {
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
export function textFoot(
  text: string,
  saved: string,
  justSaved: boolean,
  limit: number,
): TextFoot {
  const length = text.trim().length;
  const over = length > limit;
  const changed = text.trim() !== saved.trim();
  const number = (n: number) => n.toLocaleString("en-GB");
  return {
    count: `${number(length)} of ${number(limit)} characters`,
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
