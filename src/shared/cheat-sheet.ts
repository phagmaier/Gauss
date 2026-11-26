// Cheat sheets (brief.md, "Other features", "Cheat sheets"): a page the
// cheat sheet writer (engine/cheat-sheets.ts, prompts/cheat-sheet.md) writes
// for the finished units the learner picks. Each is kept until deleted, as
// `courses/<id>/cheat-sheets/<sheet id>.html` with its `.json` beside it.

import { z } from "zod";
import { Slug, Timestamp } from "./course.ts";
import { NOTES_INSTRUCTIONS_LIMIT } from "./notes.ts";

const Instructions = z.string().trim().max(NOTES_INSTRUCTIONS_LIMIT);
/** The units of a sheet, in course order. */
const SheetUnits = z.array(Slug).min(1);

/** What the learner picked. The engine refuses an empty pick with its reason. */
export const CheatSheetPost = z.object({
  units: z.array(Slug).max(1000),
  instructions: Instructions.optional(),
});
export type CheatSheetPost = z.infer<typeof CheatSheetPost>;

/** The writer's reply: a schema of its own, which the scripted backend tells from `NotesReply`. */
export const CheatSheetReply = z.object({
  html: z.string().min(1).describe("The entire standalone HTML document."),
});

export const CheatSheetId = z.uuid();

const CheatSheetMetadata = z.object({
  units: SheetUnits,
  instructions: Instructions,
  writtenAt: Timestamp,
});

/** Kept in JSON beside the page, so the writer's own document is not opened as one. */
export const CheatSheetSource = CheatSheetMetadata.extend(
  CheatSheetReply.shape,
);
export type CheatSheetSource = z.infer<typeof CheatSheetSource>;

/** A kept sheet, and where its page is. */
export const CheatSheet = CheatSheetMetadata.extend({
  id: CheatSheetId,
  path: z.string(),
});
export type CheatSheet = z.infer<typeof CheatSheet>;

const CheatSheetAttempt = z.discriminatedUnion("state", [
  z.object({
    state: z.literal("writing"),
    units: SheetUnits,
    instructions: Instructions,
  }),
  z.object({
    state: z.literal("failed"),
    units: SheetUnits,
    instructions: Instructions,
    error: z.string(),
  }),
]);
export type CheatSheetAttempt = z.infer<typeof CheatSheetAttempt>;

export const CheatSheetList = z.object({
  /** Newest first. */
  sheets: z.array(CheatSheet),
  /** The course's write, while it runs, or the last one if it failed. */
  attempt: CheatSheetAttempt.optional(),
  /** The finished units, in course order. */
  pickable: z.array(Slug),
});
export type CheatSheetList = z.infer<typeof CheatSheetList>;
