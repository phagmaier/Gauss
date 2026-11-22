// A teaching tool, defined once and bound to each backend
// (architecture.md section 5). It knows nothing of the transport: a backend
// passes it the model's raw input and hands the result back to the model.

import { z } from "zod";

/**
 * What a call returns to the model. A refused call tells the model why, so it
 * can try again; only a call that was carried out can end the turn. One that
 * was carried out can give an image after its text (view_page's page).
 */
export type ToolResult =
  | { status: "done"; text: string; endTurn?: boolean; image?: ToolImage }
  | { status: "refused"; text: string };

export interface ToolImage {
  data: Buffer;
  mimeType: "image/png";
}

export interface TeachingTool {
  name: string;
  description: string;
  /** The input's fields, for backends that describe a tool by its fields. */
  inputShape: z.ZodRawShape;
  /** Validates the raw input, then runs the tool. Never throws. */
  run(input: unknown, signal?: AbortSignal): Promise<ToolResult>;
}

export function defineTool<Shape extends z.ZodRawShape>(definition: {
  name: string;
  description: string;
  /** May carry refinements across fields; they are checked here. */
  input: z.ZodObject<Shape>;
  run(
    input: z.infer<z.ZodObject<Shape>>,
    signal?: AbortSignal,
  ): Promise<ToolResult> | ToolResult;
}): TeachingTool {
  return {
    name: definition.name,
    description: definition.description,
    inputShape: definition.input.shape,
    async run(raw, signal) {
      const parsed = definition.input.safeParse(raw);
      if (!parsed.success) {
        return { status: "refused", text: z.prettifyError(parsed.error) };
      }
      try {
        signal?.throwIfAborted();
        return await definition.run(parsed.data, signal);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { status: "refused", text: `The tool failed: ${message}` };
      }
    },
  };
}
