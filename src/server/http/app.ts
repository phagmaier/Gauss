// HTTP routes (plan task 1.5): the library, and the intake chat that starts a
// course. Each intake has an event stream from the server to the page, and a
// POST for each thing the learner does in it. Only Gauss's own page may use
// any of them.

import { type Context, Hono, type MiddlewareHandler } from "hono";
import { streamSSE } from "hono/streaming";
import type { z } from "zod";
import {
  Approval,
  type Hello,
  type IntakeStarted,
  LearnerMessage,
  type PageEvent,
} from "../../shared/events.ts";
import type { Library } from "../../shared/library.ts";
import type { ChatResult, EventLog } from "../engine/conversation.ts";
import type { Intake, Intakes } from "../engine/intake.ts";
import type { DataRoot } from "../record/data-root.ts";

export function createApp(options: {
  dataRoot: DataRoot;
  intakes: Intakes;
  heartbeatMs?: number;
}) {
  const { dataRoot, intakes } = options;
  const heartbeatMs = options.heartbeatMs ?? 20_000;
  const app = new Hono();
  app.use("/api/*", localOnly);

  // A record that cannot be read, or a write that failed. The reason goes to
  // the page, which is the learner's own.
  app.onError((error, c) => {
    console.error(error);
    return c.json({ error: error.message }, 500);
  });

  // --- The library ---------------------------------------------------------

  app.get("/api/courses", async (c) =>
    c.json({ courses: await dataRoot.listCourses() } satisfies Library),
  );

  app.get("/api/courses/:id", async (c) => {
    const stored = await dataRoot.readCourse(c.req.param("id"));
    return stored === undefined
      ? c.json({ error: "No such course." }, 404)
      : c.json(stored);
  });

  // --- Intakes: "New course" starts one; its first proposal makes the course

  app.post("/api/intakes", (c) =>
    c.json({ intakeId: intakes.start().id } satisfies IntakeStarted, 201),
  );

  /** Runs the handler with the intake the path names, or answers 404. */
  function withIntake(
    handler: (c: Context, intake: Intake) => Response | Promise<Response>,
  ) {
    return (c: Context) => {
      const intake = intakes.get(c.req.param("id") ?? "");
      return intake === undefined
        ? c.json({ error: "No such intake." }, 404)
        : handler(c, intake);
    };
  }

  app.get(
    "/api/intakes/:id/events",
    withIntake((c, intake) => streamLog(c, intake, heartbeatMs)),
  );

  app.post(
    "/api/intakes/:id/messages",
    withIntake(async (c, intake) => {
      const body = await readBody(c, LearnerMessage);
      if (!body.ok) return c.json({ error: body.error }, 400);
      return reply(c, intake.say(body.data.text), 202);
    }),
  );

  app.post(
    "/api/intakes/:id/approval",
    withIntake(async (c, intake) => {
      const body = await readBody(c, Approval);
      if (!body.ok) return c.json({ error: body.error }, 400);
      return reply(c, await intake.approve(body.data.revision), 200);
    }),
  );

  app.post(
    "/api/intakes/:id/interrupt",
    withIntake(async (c, intake) => {
      await intake.interrupt();
      return c.json({ ok: true });
    }),
  );

  return app;
}

/**
 * A chat's event log, replayed from the start (or from after the
 * Last-Event-ID the browser sends when it reconnects), then live events.
 * Event ids are `<log id>.<index>`.
 */
function streamLog(
  c: Context,
  log: Pick<EventLog, "id" | "events" | "subscribe">,
  heartbeatMs: number,
) {
  const from = replayFrom(c.req.header("Last-Event-ID"), log.id);
  return streamSSE(c, async (stream) => {
    // Taken together, before any await, so no event is missed or repeated.
    const pending: [PageEvent, number][] = log
      .events()
      .slice(from)
      .map((event, i) => [event, from + i]);
    let wake: (() => void) | undefined;
    const unsubscribe = log.subscribe((event, index) => {
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
        data: JSON.stringify({ chatId: log.id } satisfies Hello),
      });
      while (!stream.aborted) {
        const next = pending.shift();
        if (next !== undefined) {
          const [event, index] = next;
          await stream.writeSSE({
            id: `${log.id}.${index}`,
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
function replayFrom(lastEventId: string | undefined, logId: string): number {
  if (lastEventId === undefined) return 0;
  const [id, index] = lastEventId.split(".");
  const n = Number(index);
  return id === logId && Number.isInteger(n) && n >= 0 ? n + 1 : 0;
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

/** Accepted (202, the tutor will reply) or done (200), or why not. */
function reply(c: Context, result: ChatResult, okStatus: 200 | 202) {
  return result.ok
    ? c.json({ ok: true }, okStatus)
    : c.json({ error: result.error }, result.status);
}
