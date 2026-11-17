import { expect, test } from "vitest";
import { commandLine } from "./PackagesCard.tsx";

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
