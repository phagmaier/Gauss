import { expect, test } from "vitest";
import { SessionNotFound } from "./backend.ts";
import { createFakeBackend, KeptSessions } from "./fake.ts";

test("a fresh fake finds a saved session only in its original working folder", async () => {
  const kept = new KeptSessions();
  const workspace = "/courses/limits/workspace";
  const other = "/courses/series/workspace";
  const options = { systemPrompt: "Tutor.", tools: [] };
  const first = createFakeBackend([], [], { kept });
  const session = await first.startSession({ ...options, cwd: workspace });
  await session.close();

  const fresh = createFakeBackend([], [], { kept });
  const id = session.backendSessionId;
  expect(await fresh.hasSession(id, workspace)).toBe(true);
  expect(await fresh.hasSession(id, other)).toBe(false);
  await expect(
    fresh.startSession({ ...options, cwd: other, resumeId: id }),
  ).rejects.toBeInstanceOf(SessionNotFound);
  const resumed = await fresh.startSession({
    ...options,
    cwd: workspace,
    resumeId: id,
  });
  expect(resumed.backendSessionId).toBe(id);
  await resumed.close();
});
