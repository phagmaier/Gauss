// What the app adds to an artifact it serves in the side pane: a script, run
// before the aid's own, that tells the page when the aid's script stops with
// an error, so the learner can send the error to the tutor. The frame's
// origin is its own (`ARTIFACT_POLICY` in app.ts), so the page cannot catch
// the error itself; a message to the parent window is the one way out. The
// document in the record stays as the tutor wrote it.

/**
 * Sends the aid's first uncaught error or unhandled rejection to the page,
 * as an `ArtifactReport` (`src/shared/artifact.ts`), and nothing after it:
 * an error in a drawing loop would repeat many times a second. One line, so
 * the aid's line numbers stay those of the document the tutor wrote.
 */
export const ARTIFACT_REPORTER =
  "<script>(function () {" +
  "var sent = false;" +
  "function report(message, line, column) {" +
  "if (sent) return; sent = true;" +
  'parent.postMessage({ gauss: "artifact", type: "error", ' +
  "message: String(message).slice(0, 2000), " +
  "line: line || 0, column: column || 0 }, " +
  // The frame's parent can only be the app's page (`frame-ancestors 'self'`).
  '"*");' +
  "}" +
  'addEventListener("error", function (e) { report(e.message, e.lineno, e.colno); });' +
  'addEventListener("unhandledrejection", function (e) {' +
  'var why; try { why = String(e.reason); } catch { why = "a value that cannot be shown"; }' +
  'report("Uncaught (in promise) " + why, 0, 0);' +
  "});" +
  "})();</script>";

/**
 * The aid's document with the reporter first: after its doctype, so the
 * document keeps its mode, or at its start when it has none.
 */
export function withReporter(html: string): string {
  const doctype = /^\s*(?:<!--[\s\S]*?-->\s*)*<!doctype[^>]*>/i.exec(html);
  const at = doctype === null ? 0 : doctype[0].length;
  return html.slice(0, at) + ARTIFACT_REPORTER + html.slice(at);
}
