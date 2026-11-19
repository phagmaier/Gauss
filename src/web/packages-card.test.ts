import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import type { PackagesItem } from "../shared/timeline.ts";
import { commandLine, PackagesCard } from "./PackagesCard.tsx";

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

  const recorded = render({
    ...card,
    outcome: "installed",
    output: "Added pytest",
  });
  expect(recorded).toContain("Added pytest");
  expect(recorded).not.toContain("<button");
});

/** The card's disclosures: each one's summary, whether it starts open, and what it holds. */
function disclosures(markup: string) {
  return [
    ...markup.matchAll(
      /<details([^>]*)><summary>([^<]*)<\/summary>([\s\S]*?)<\/details>/g,
    ),
  ].map(([, attributes = "", summary = "", body = ""]) => ({
    summary,
    open: /\sopen=/.test(attributes),
    body,
  }));
}

/** The card without its disclosures: what shows before anything is opened. */
function shown(markup: string) {
  return markup.replace(/<details[\s\S]*?<\/details>/g, "");
}

test("a waiting card shows the packages, with the command folded away until asked for", () => {
  const markup = render({
    ...card,
    packages: [{ name: "pytest" }, { name: "numpy", version: ">=2" }],
  });
  expect(shown(markup)).toContain("<code>pytest</code>");
  expect(shown(markup)).toContain("<code>numpy&gt;=2</code>");
  expect(shown(markup)).not.toContain("uv add");
  expect(disclosures(markup)).toEqual([
    {
      summary: "Show the command",
      open: false,
      body: expect.stringMatching(
        /uv add pytest[\s\S]*<code>\/course\/workspace<\/code>/,
      ),
    },
  ]);

  const two = render({
    ...card,
    commands: [
      ["uv", "add", "pytest"],
      ["uv", "sync"],
    ],
  });
  expect(disclosures(two).map((d) => d.summary)).toEqual(["Show the commands"]);
});

test("an answered card folds its output, unless the install failed", () => {
  const installed = render({
    ...card,
    outcome: "installed",
    output: "Installed 5 packages",
  });
  expect(shown(installed)).toContain("Installed");
  expect(shown(installed)).toContain("<code>pytest</code>");
  expect(shown(installed)).not.toContain("Installed 5 packages");
  expect(disclosures(installed)).toEqual([
    { summary: "Show the command", open: false, body: expect.any(String) },
    {
      summary: "Show the output",
      open: false,
      body: expect.stringContaining("Installed 5 packages"),
    },
  ]);

  const failed = render({
    ...card,
    outcome: "failed",
    output: "No solution found when resolving dependencies",
  });
  expect(shown(failed)).toContain("the install failed");
  expect(disclosures(failed)).toEqual([
    { summary: "Show the command", open: false, body: expect.any(String) },
    {
      summary: "Show the output",
      open: true,
      body: expect.stringContaining("No solution found"),
    },
  ]);

  const declined = render({ ...card, outcome: "declined", output: "" });
  expect(disclosures(declined).map((d) => d.summary)).toEqual([
    "Show the command",
  ]);
});
