import { afterEach, expect, test, vi } from "vitest";
import { codexOptions } from "./codex.ts";

afterEach(() => {
  vi.unstubAllEnvs();
});

test("a live check runs Codex on gpt-6.2-sol at medium, whatever the caller asks for", () => {
  vi.stubEnv("GAUSS_LIVE_CHECK", "1");

  expect(codexOptions({ model: "gpt-6.2", effort: "high" })).toEqual({
    model: "gpt-6.2-sol",
    effort: "medium",
  });
  expect(codexOptions()).toEqual({ model: "gpt-6.2-sol", effort: "medium" });
});

test("outside a live check the caller's model and effort stand", () => {
  vi.stubEnv("GAUSS_LIVE_CHECK", "");

  expect(codexOptions({ model: "gpt-6.2", effort: "high" })).toEqual({
    model: "gpt-6.2",
    effort: "high",
  });
});
