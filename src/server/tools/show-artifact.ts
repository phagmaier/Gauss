// The show_artifact teaching tool (task 3.6): an HTML aid the tutor writes
// whole in the call, which the engine stores in
// the course's artifacts/ folder and the page shows in the side pane. The
// pane's frame runs the aid's scripts but lets it load nothing (the route's
// policy, http/app.ts), so a document that names something on the network is
// refused here, with what it names, rather than shown broken. Whether one
// may be shown now (not while a question is open) is the engine's rule, so
// that refusal comes from the shelf with its reason. Showing one does not
// end the tutor's turn.

import { ARTIFACT_LIMIT_BYTES, ArtifactInput } from "../../shared/artifact.ts";
import { defineTool, type TeachingTool } from "./tool.ts";

/** Where artifacts are kept and shown. The engine provides it. */
export interface ArtifactShelf {
  /** Stores the artifact and shows it beside the conversation, or says why not; a stopped turn shows nothing. */
  show(
    artifact: ArtifactInput,
    signal?: AbortSignal,
  ): Promise<{ number: number; file: string } | { refused: string }>;
}

export function showArtifactTool(shelf: ArtifactShelf): TeachingTool {
  return defineTool({
    name: "show_artifact",
    description:
      "Show the learner an HTML document you write, in a pane beside the " +
      "conversation: a graph, a diagram or a small interactive aid. The " +
      "conversation keeps a reference to it that opens it again. It runs " +
      "its scripts but can load nothing and reach nothing, so give the " +
      "whole document, self-contained. Refused while a question is open. " +
      "Your turn goes on after it.",
    input: ArtifactInput,
    async run(artifact, signal) {
      const problem = artifactProblem(artifact.html);
      if (problem !== undefined) return { status: "refused", text: problem };
      const shown = await shelf.show(artifact, signal);
      if ("refused" in shown) return { status: "refused", text: shown.refused };
      return {
        status: "done",
        text:
          `Shown beside the conversation as artifact ${shown.number}, ` +
          `"${artifact.title}". The learner can close it and open it again ` +
          "from its place in the conversation. Go on with your reply.",
      };
    },
  });
}

/** Why the document cannot be shown as it is, or undefined if it can. */
export function artifactProblem(html: string): string | undefined {
  const size = Buffer.byteLength(html, "utf8");
  if (size > ARTIFACT_LIMIT_BYTES) {
    return (
      `The document is ${kilobytes(size)} KB, over the limit of ` +
      `${kilobytes(ARTIFACT_LIMIT_BYTES)} KB. Make it smaller: fewer ` +
      "points drawn, and nothing the aid does not need."
    );
  }
  const named = networkAddresses(html);
  if (named.length > 0) {
    const shown = named.slice(0, 3).join(", ");
    return (
      `The document names ${shown}${named.length > 3 ? " and more" : ""} ` +
      "on the network, and the pane loads nothing and opens no link. Write " +
      "its scripts and styles inline, draw with SVG or a canvas, and write " +
      "math in MathML or plain text."
    );
  }
  return undefined;
}

/**
 * The addresses on the network that the document's attributes or styles
 * name, each once: what a browser would load, or a link it would follow.
 */
function networkAddresses(html: string): string[] {
  const url = String.raw`((?:https?:)?//[^\s"'<>()]+)`;
  const patterns = [
    new RegExp(
      String.raw`\b(?:src|srcset|href|poster|data|action|formaction|background)\s*=\s*["']?\s*${url}`,
      "gi",
    ),
    new RegExp(String.raw`(?:url\(|@import)\s*["']?\s*${url}`, "gi"),
  ];
  const found = new Set<string>();
  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) {
      if (match[1] !== undefined) found.add(match[1]);
    }
  }
  return [...found];
}

function kilobytes(bytes: number): string {
  return String(Math.ceil(bytes / 1000));
}
