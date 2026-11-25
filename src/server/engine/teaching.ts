// The teaching instructions the learner can edit (brief.md, "Teaching
// style"): one paragraph of `prompts/tutor.md`, between two marks, which
// the learner's text in `teaching.md` replaces. The rest of the prompt is
// fixed. The marks never reach a model.

/** The line before the learner's paragraph in tutor.md. */
export const TEACHING_START =
  "<!-- The learner can rewrite this paragraph on the Settings page. Gauss removes these marks. -->";
/** The line after it. */
export const TEACHING_END = "<!-- The learner's paragraph ends here. -->";

/** tutor.md split at its marks: Gauss's paragraph and the fixed text around it. */
export interface TutorPrompt {
  before: string;
  /** Gauss's paragraph, as tutor.md wraps it; undefined in a prompt with no marks. */
  shipped: string | undefined;
  after: string;
}

/**
 * Splits a tutor prompt at its marks. A prompt with neither mark has nothing
 * the learner can edit, as a test's tutor prompt; `serve.ts` refuses one.
 * A mark alone, marks out of order, or a mark not on a line of its own
 * throw.
 */
export function splitTutorPrompt(text: string): TutorPrompt {
  const start = markAt(text, TEACHING_START);
  const end = markAt(text, TEACHING_END);
  const none = !text.includes(TEACHING_START) && !text.includes(TEACHING_END);
  if (none) return { before: text, shipped: undefined, after: "" };
  if (start === undefined || end === undefined || end < start) {
    throw new Error(
      "The tutor prompt's marks around the learner's paragraph are missing, out of order or not on lines of their own.",
    );
  }
  return {
    before: text.slice(0, start),
    shipped: text.slice(start + TEACHING_START.length + 1, end),
    after: text.slice(end + TEACHING_END.length + 1),
  };
}

/** Where the mark's line starts; undefined if no whole line is the mark. */
function markAt(text: string, mark: string): number | undefined {
  const found = `\n${text}`.indexOf(`\n${mark}\n`);
  return found === -1 ? undefined : found;
}

/**
 * The tutor prompt as a model gets it: the marks removed, and the learner's
 * paragraph, if any, in place of Gauss's. With none, tutor.md's text is kept
 * as it is, so an unedited prompt reads as before the setting existed.
 */
export function tutorInstructions(
  prompt: TutorPrompt,
  edit: string | undefined,
): string {
  if (prompt.shipped === undefined) return prompt.before;
  const paragraph = (edit ?? prompt.shipped).trimEnd();
  return `${prompt.before}${paragraph}\n${prompt.after}`;
}

/** Gauss's paragraph as the Settings page shows it, its lines joined. */
export function gaussTeaching(prompt: TutorPrompt): string {
  return unwrapped(prompt.shipped ?? "");
}

/** The paragraphs after the learner's, to the next heading: what stays fixed. */
export function fixedTeaching(prompt: TutorPrompt): string {
  return unwrapped(prompt.after.split(/\n#+ /)[0] ?? "");
}

function unwrapped(text: string): string {
  return text
    .trim()
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/\s*\n\s*/g, " "))
    .join("\n\n");
}
