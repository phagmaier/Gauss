import { runInNewContext } from "node:vm";
import { expect, test } from "vitest";
import { ArtifactReport } from "../../shared/artifact.ts";
import { ARTIFACT_REPORTER, withReporter } from "./artifact-frame.ts";

/**
 * Runs the reporter in a window of its own, as a frame would, and gives its
 * listeners and what it posted to the parent.
 */
function frame() {
  const posted: { data: unknown; target: string }[] = [];
  const listeners = new Map<string, (event: object) => void>();
  const script = /^<script>(.*)<\/script>$/.exec(ARTIFACT_REPORTER)?.[1];
  if (script === undefined) throw new Error("No script in the reporter.");
  runInNewContext(script, {
    parent: {
      postMessage: (data: unknown, target: string) =>
        posted.push({ data, target }),
    },
    addEventListener: (type: string, listener: (event: object) => void) =>
      listeners.set(type, listener),
  });
  const fire = (type: string, event: object) => listeners.get(type)?.(event);
  return { posted, fire };
}

test("the reporter sends the aid's first uncaught error to the page as a report, and nothing after it", () => {
  const { posted, fire } = frame();

  fire("error", {
    message: "Uncaught TypeError: points is undefined",
    lineno: 12,
    colno: 5,
  });
  fire("error", { message: "Uncaught TypeError: again", lineno: 30, colno: 1 });
  fire("unhandledrejection", { reason: new Error("later") });

  expect(posted).toHaveLength(1);
  expect(ArtifactReport.parse(posted[0]?.data)).toEqual({
    gauss: "artifact",
    type: "error",
    message: "Uncaught TypeError: points is undefined",
    line: 12,
    column: 5,
  });
});

test("an unhandled rejection is reported with no place, even when its reason cannot be shown", () => {
  const shown = frame();
  shown.fire("unhandledrejection", { reason: new RangeError("too deep") });
  expect(ArtifactReport.parse(shown.posted[0]?.data)).toMatchObject({
    message: "Uncaught (in promise) RangeError: too deep",
    line: 0,
    column: 0,
  });

  const unshowable = frame();
  unshowable.fire("unhandledrejection", {
    reason: {
      toString() {
        throw new Error("no");
      },
    },
  });
  expect(ArtifactReport.parse(unshowable.posted[0]?.data)).toMatchObject({
    message: "Uncaught (in promise) a value that cannot be shown",
  });
});

test.each([
  [
    "<!doctype html>\n<p>A</p>",
    `<!doctype html>${ARTIFACT_REPORTER}\n<p>A</p>`,
  ],
  [
    "<!-- An aid -->\n<!DOCTYPE html>\n<p>A</p>",
    `<!-- An aid -->\n<!DOCTYPE html>${ARTIFACT_REPORTER}\n<p>A</p>`,
  ],
  ["<p>A</p>", `${ARTIFACT_REPORTER}<p>A</p>`],
])("the reporter goes after the doctype, on its line: %j", (html, served) => {
  expect(withReporter(html)).toBe(served);
});
