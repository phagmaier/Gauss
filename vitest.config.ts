import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // Many tests write the record and flush it to disk at every step, or run
    // the sandbox's pytest and sympy. They take 1 to 3 seconds alone, but the
    // full parallel run has pushed them past Vitest's 5-second default now
    // and then; one limit for all of them keeps a slow machine from failing
    // the check.
    testTimeout: 20_000,
  },
});
