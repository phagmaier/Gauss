// A runtime that starts but applies no Unix-socket policy must not enable
// commands or tutor tools. No model and no host service are involved.
import { expect, test, vi } from "vitest";
import { startSandbox } from "./sandbox.ts";

vi.mock("@anthropic-ai/sandbox-runtime", () => ({
  SandboxManager: {
    isSupportedPlatform: () => true,
    checkDependencies: () => ({ errors: [], warnings: [] }),
    initialize: async () => {},
    reset: async () => {},
    // Deliberately omit the runtime's restrictions. Gauss's inner guard
    // closes socketpair, but ordinary socket creation is still possible.
    wrapWithSandbox: async (command: string) => command,
    cleanupAfterCommand: () => {},
  },
}));

test.runIf(process.platform === "linux")(
  "a successful command is not enough: startup refuses ineffective Unix-socket confinement",
  async () => {
    const lines: string[] = [];
    const sandbox = await startSandbox({ log: (line) => lines.push(line) });
    try {
      expect(sandbox.available).toBe(false);
      expect(sandbox).not.toHaveProperty("run");
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain("the sandbox allowed a Unix socket");
    } finally {
      await sandbox.close();
    }
  },
);

test("a runtime that supports macOS does not enable workloads without verified process-tree containment", async () => {
  const original = Object.getOwnPropertyDescriptor(process, "platform");
  if (original === undefined) throw new Error("process.platform is missing");
  const lines: string[] = [];
  Object.defineProperty(process, "platform", { value: "darwin" });
  try {
    const sandbox = await startSandbox({ log: (line) => lines.push(line) });
    try {
      expect(sandbox.available).toBe(false);
      expect(sandbox).not.toHaveProperty("run");
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain("process-tree containment");
    } finally {
      await sandbox.close();
    }
  } finally {
    Object.defineProperty(process, "platform", original);
  }
});
