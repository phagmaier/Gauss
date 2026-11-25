import { expect, test } from "vitest";
import { createFakeBackend } from "../backends/fake.ts";
import { createEventLog } from "./conversation.ts";
import { createHelpJudge } from "./help-judge.ts";
import { createUnitAgents } from "./unit-agents.ts";

test.each(["before judging starts", "before a queued judgment records"])(
  "closing %s prevents a late judge call or result",
  async (when) => {
    const backend = createFakeBackend(
      [],
      [{ output: { reason: "It gave the answer.", verdict: "help" } }],
    );
    const queued = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const log = createEventLog();
    const agents = createUnitAgents({
      backend,
      systemPrompt: async () => "Tutor.",
      tools: () => [],
      cwd: "unused-fake-course",
      title: "Review regression",
      keep: async () => {},
      lost: () => {},
      judge: createHelpJudge({ backend, systemPrompt: "Judge." }),
      log,
      exclusive: async (work) => {
        queued.resolve();
        await release.promise;
        return work();
      },
    });
    try {
      if (when === "before judging starts") await agents.close();
      agents.judge({
        learnerId: "m1",
        number: 1,
        question: {
          kind: "choice",
          prompt: "What is 2 + 2?",
          choices: ["4", "5"],
          answer: "A",
        },
        message: "How do I start?",
        reply: "The answer is 4.",
        record: async () => {
          log.emit({
            type: "judged",
            learnerId: "m1",
            number: 1,
            verdict: "help",
          });
        },
      });
      if (when === "before a queued judgment records") {
        await queued.promise;
        await agents.close();
      }
      release.resolve();
      await agents.settled();

      expect(log.events().some((event) => event.type === "judged")).toBe(false);
      expect(backend.oneShots).toHaveLength(
        when === "before judging starts" ? 0 : 1,
      );
    } finally {
      release.resolve();
      await agents.close();
      await agents.settled();
    }
  },
);
