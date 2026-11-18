import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { commandLine, PackagesCard } from "./PackagesCard.tsx";
import type { PackagesItem } from "./timeline.ts";

test("a command is shown as a shell would read it: plain words as they are, others quoted", () => {
  expect(
    commandLine([
      "uv",
      "add",
      "--python",
      "/opt/my python/bin/python3",
      "pytest>=8,<9",
      "it's",
      "numpy==2.*",
    ]),
  ).toBe(
    "uv add --python '/opt/my python/bin/python3' 'pytest>=8,<9' 'it'\\''s' 'numpy==2.*'",
  );
});

const card: PackagesItem = {
  kind: "packages",
  key: 1,
  requestId: "request",
  packages: [{ name: "pytest" }],
  commands: [["uv", "add", "pytest"]],
  folder: "/course/workspace",
};

function render(item: PackagesItem) {
  const unused = async () => undefined;
  return renderToStaticMarkup(
    createElement(PackagesCard, {
      item,
      busy: false,
      onInstall: unused,
      onNotNow: unused,
      onRetrySaving: unused,
    }),
  );
}

test("a result that could not be saved offers only Retry saving", () => {
  const approval = render(card);
  expect(approval).toMatch(/>Install<\/button>/);
  expect(approval).toMatch(/>Not now<\/button>/);

  const saved = render({ ...card, status: "save-failed" });
  expect(saved).toMatch(/>Retry saving<\/button>/);
  expect(saved).not.toMatch(/>(?:Install|Not now)<\/button>/);
  expect(saved).toContain("result couldn");

  const replayed = render({ ...card, status: "historical" });
  expect(replayed).not.toContain("<button");

  const recorded = render({ ...card, outcome: "installed", output: "Added pytest" });
  expect(recorded).toContain("Added pytest");
  expect(recorded).not.toContain("<button");
});
