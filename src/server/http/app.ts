// HTTP routes for the minimal page (plan task 0.5): one event stream from the
// server to the page, and a POST for each thing the learner does.

import { type Context, Hono, type MiddlewareHandler } from "hono";
import { streamSSE } from "hono/streaming";
import type { z } from "zod";
import { LearnerMessage, type PageEvent } from "../../shared/events.ts";
import { AnswerSubmission } from "../../shared/question.ts";
import type { Chat, ChatResult } from "../engine/chat.ts";

export function createApp(chat: Chat, options: { heartbeatMs?: number } = {}) {
  const heartbeatMs = options.heartbeatMs ?? 20_000;
  const app = new Hono();
  app.use("/api/*", localOnly);

  // The chat's event log, replayed from the start (or from after the
  // Last-Event-ID the browser sends when it reconnects), then live events.
  app.get("/api/events", (c) => {
    const from = replayFrom(c.req.header("Last-Event-ID"), chat.id);
    return streamSSE(c, async (stream) => {
      // Taken together, before any await, so no event is missed or repeated.
      const pending: [PageEvent, number][] = chat
        .events()
        .slice(from)
        .map((event, i) => [event, from + i]);
      let wake: (() => void) | undefined;
      const unsubscribe = chat.subscribe((event, index) => {
        pending.push([event, index]);
        wake?.();
      });
      stream.onAbort(() => {
        unsubscribe();
        wake?.();
      });
      try {
        await stream.writeSSE({
          event: "hello",
          data: JSON.stringify({ chatId: chat.id }),
        });
        while (!stream.aborted) {
          const next = pending.shift();
          if (next !== undefined) {
            const [event, index] = next;
            await stream.writeSSE({
              id: `${chat.id}.${index}`,
              data: JSON.stringify(event),
            });
            continue;
          }
          // Wait for the next event; send a comment now and then meanwhile.
          const woken = await new Promise<boolean>((resolve) => {
            const timer = setTimeout(() => resolve(false), heartbeatMs);
            wake = () => {
              clearTimeout(timer);
              resolve(true);
            };
          });
          if (!woken && !stream.aborted) await stream.write(": ping\n\n");
        }
      } finally {
        unsubscribe();
      }
    });
  });

  app.post("/api/start", (c) => reply(c, chat.start()));

  app.post("/api/messages", async (c) => {
    const body = await readBody(c, LearnerMessage);
    if (!body.ok) return c.json({ error: body.error }, 400);
    return reply(c, chat.say(body.data.text));
  });

  app.post("/api/answers", async (c) => {
    const body = await readBody(c, AnswerSubmission);
    if (!body.ok) return c.json({ error: body.error }, 400);
    return reply(c, chat.answer(body.data));
  });

  app.post("/api/interrupt", async (c) => {
    await chat.interrupt();
    return c.json({ ok: true });
  });

  return app;
}

/**
 * The server drives an agent on the learner's login, so only its own page
 * may use it. The Host check stops a web page from reaching it through DNS
 * rebinding; the Origin check stops another site's page from posting to it.
 * Browsers send Origin with every POST. On Node the request URL is built
 * from the Host header.
 */
const localOnly: MiddlewareHandler = async (c, next) => {
  const url = new URL(c.req.url);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    return c.json({ error: "Not a local address." }, 403);
  }
  if (c.req.method !== "GET" && c.req.header("Origin") !== url.origin) {
    return c.json({ error: "Requests must come from Gauss's own page." }, 403);
  }
  await next();
};

/** The index to replay from, given the id of the last event the page has. */
function replayFrom(lastEventId: string | undefined, chatId: string): number {
  if (lastEventId === undefined) return 0;
  const [id, index] = lastEventId.split(".");
  const n = Number(index);
  return id === chatId && Number.isInteger(n) && n >= 0 ? n + 1 : 0;
}

async function readBody<Schema extends z.ZodType>(
  c: Context,
  schema: Schema,
): Promise<{ ok: true; data: z.infer<Schema> } | { ok: false; error: string }> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return { ok: false, error: "The body must be JSON." };
  }
  const parsed = schema.safeParse(raw);
  return parsed.success
    ? { ok: true, data: parsed.data }
    : {
        ok: false,
        error: parsed.error.issues.map((i) => i.message).join("; "),
      };
}

function reply(c: Context, result: ChatResult) {
  return result.ok
    ? c.json({ ok: true }, 202)
    : c.json({ error: result.error }, result.status);
}
