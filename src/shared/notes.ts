import { z } from "zod";
import { Timestamp } from "./course.ts";

export const NOTES_INSTRUCTIONS_LIMIT = 2_000;
const Instructions = z.string().trim().max(NOTES_INSTRUCTIONS_LIMIT);

export const NotesPost = z.object({ instructions: Instructions.optional() });

export const NotesReply = z.object({
  html: z.string().min(1).describe("The entire standalone HTML document."),
});

const NotesMetadata = z.object({
  writtenAt: Timestamp,
  instructions: Instructions,
});

/** Kept in JSON so the unprocessed writer's document is not opened as a page. */
export const NotesSource = NotesMetadata.extend(NotesReply.shape);
export type NotesSource = z.infer<typeof NotesSource>;

export const NotesSaved = NotesMetadata.extend({ path: z.string() });
export type NotesSaved = z.infer<typeof NotesSaved>;

const NotesAttempt = z.discriminatedUnion("state", [
  z.object({ state: z.literal("writing"), instructions: Instructions }),
  z.object({
    state: z.literal("failed"),
    instructions: Instructions,
    error: z.string(),
  }),
]);
export type NotesAttempt = z.infer<typeof NotesAttempt>;

export const NotesView = z.object({
  courseTitle: z.string(),
  unitTitle: z.string(),
  saved: NotesSaved.optional(),
  attempt: NotesAttempt.optional(),
});
export type NotesView = z.infer<typeof NotesView>;
