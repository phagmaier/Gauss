// What an aid's frame in the side pane tells the page: an error, sent to the
// tutor as the learner's message so the tutor can mend the aid, or a
// question the aid puts into the message box. The frame's script runs in an
// origin of its own, so it reaches the page only by a message to the
// window; the page takes one only from the frame it shows.

import { type ArtifactError, ArtifactReport } from "../shared/artifact.ts";
import type { ArtifactItem } from "../shared/timeline.ts";

/** The most of an error's text that goes to the tutor. */
const MESSAGE_LIMIT = 2000;

/**
 * The report in a message to the page, when the frame showing the aid sent
 * it; undefined for a message from any other window (another frame, one
 * shown before, the page itself) or of another shape.
 */
export function frameReport(
  event: Pick<MessageEvent, "source" | "data">,
  frame: Window | null | undefined,
): ArtifactReport | undefined {
  if (frame == null || event.source !== frame) return undefined;
  const report = ArtifactReport.safeParse(event.data);
  return report.success ? report.data : undefined;
}

/**
 * The learner's message that sends the aid's error to the tutor, which the
 * thread shows as the learner's own text.
 */
export function errorMessage(
  artifact: Pick<ArtifactItem, "file" | "title">,
  report: ArtifactError,
): string {
  const number = Number.parseInt(artifact.file, 10);
  const at =
    report.line > 0 ? ` at line ${report.line}, column ${report.column}` : "";
  return (
    `Artifact ${number}, "${artifact.title}", stopped with an error${at}. ` +
    `Please show it again, mended.\n\n${report.message.slice(0, MESSAGE_LIMIT)}`
  );
}

/**
 * The message box's draft with the aid's question after it, so nothing the
 * learner wrote is lost; unchanged when the draft already ends with that
 * question, as when the aid's button is pressed twice.
 */
export function withAsk(draft: string, question: string): string {
  const before = draft.trimEnd();
  if (before === "") return question;
  return before.endsWith(question) ? draft : `${before}\n\n${question}`;
}
