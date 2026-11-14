import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

// Running outside mise picks up whatever Node is installed, and the source
// relies on features of the pinned one. This fails fast when that happens.
test("the tests run on the Node version pinned in mise.toml", () => {
  const mise = readFileSync(new URL("../mise.toml", import.meta.url), "utf8");
  const pinned = /^node = "(.+)"$/m.exec(mise)?.[1];

  expect(pinned).toBeDefined();
  expect(process.versions.node).toBe(pinned);
});
