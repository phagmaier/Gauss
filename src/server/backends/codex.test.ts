import { afterEach, expect, test, vi } from "vitest";
import { codexOptions } from "./codex.ts";

afterEach(() => {
  vi.unstubAllEnvs();
});

const PINNED = {
  model: "gpt-6.1-terra",
  effort: "medium",
  serviceTier: "default",
};

test("a live check runs Codex on gpt-6.1-terra at medium on the standard tier, whatever the caller asks for", () => {
  vi.stubEnv("GAUSS_LIVE_CHECK", "1");

  expect(
    codexOptions({
      model: "gpt-6.2-sol",
      effort: "high",
      serviceTier: "priority",
    }),
  ).toEqual(PINNED);
  expect(codexOptions()).toEqual(PINNED);
});

test("outside a live check the caller's model and effort stand", () => {
  vi.stubEnv("GAUSS_LIVE_CHECK", "");

  expect(codexOptions({ model: "gpt-6.2-sol", effort: "high" })).toEqual({
    model: "gpt-6.2-sol",
    effort: "high",
  });
});
