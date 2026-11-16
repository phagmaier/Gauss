// HTTP routes: the library and the intake chat that starts a course (plan
// task 1.5), and the unit chats (task 2.6). Each chat has an event stream
// from the server to the page, and a POST for each thing the learner does in
// it. Only Gauss's own page may use any of them.

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
import type { CourseWithProgress, Library } from "../../shared/library.ts";
import { AnswerSubmission } from "../../shared/question.ts";
import type { ChatResult, EventLog } from "../engine/conversation.ts";
import type { Intake, Intakes } from "../engine/intake.ts";
import type { UnitChat, UnitChats } from "../engine/unit-chat.ts";
import type { DataRoot } from "../record/data-root.ts";
import { withProgress } from "../record/progress.ts";

export function createApp(options: {
  dataRoot: DataRoot;
  intakes: Intakes;
  units: UnitChats;
  heartbeatMs?: number;
}) {
  const { dataRoot, intakes, units } = options;
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

  // Each course with where its units stand, derived from the record now. A
  // course whose state or evidence cannot be read is listed with the reason
  // in place of its progress, so the rest of the library stays in reach.
  app.get("/api/courses", async (c) => {
    const courses = await Promise.all(
      (await dataRoot.listCourses()).map((stored) =>
        withProgress(dataRoot, stored).catch((error): CourseWithProgress => {
          console.error(error);
          return {
            ...stored,
            progress: {},
            problem: error instanceof Error ? error.message : String(error),
          };
        }),
      ),
    );
    return c.json({ courses } satisfies Library);
  });

  app.get("/api/courses/:id", async (c) => {
    const stored = await dataRoot.readCourse(c.req.param("id"));
    return stored === undefined
      ? c.json({ error: "No such course." }, 404)
      : c.json(
          (await withProgress(dataRoot, stored)) satisfies CourseWithProgress,
        );
  });

  // A draft is reviewed in an intake: the one that proposed it, if it is
  // still running, or else a new one that starts from the stored draft.
  app.post("/api/courses/:id/review", async (c) => {
    const stored = await dataRoot.readCourse(c.req.param("id"));
    if (stored === undefined) return c.json({ error: "No such course." }, 404);
    const { curriculum } = stored;
    if (curriculum === null) {
      return c.json({ error: "No curriculum has been proposed." }, 409);
    }
    if (curriculum.approval.status === "approved") {
      return c.json(
        { error: "The curriculum is approved; there is nothing to review." },
        409,
      );
    }
    // A draft proposed before style notes existed (task 2.10) has none.
    const style = await dataRoot.readStyle(stored.id);
    const intake = intakes.review({
      id: stored.id,
      proposal: {
        title: stored.course.title,
        units: curriculum.units,
        ...(style === undefined ? {} : { style }),
      },
    });
    return c.json({ intakeId: intake.id } satisfies IntakeStarted);
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

  // --- Unit chats: opening a unit starts it or picks it up where it was ----

  const unitPath = "/api/courses/:id/units/:unit";

  app.post(`${unitPath}/open`, async (c) => {
    const opened = await units.open(c.req.param("id"), c.req.param("unit"));
    return opened.ok
      ? c.json({ ok: true })
      : c.json({ error: opened.error }, opened.status);
  });

  /** Runs the handler with the open chat of the unit the path names, or answers 404. */
  function withUnit(
    handler: (c: Context, chat: UnitChat) => Response | Promise<Response>,
  ) {
    return (c: Context) => {
      const chat = units.get(
        c.req.param("id") ?? "",
        c.req.param("unit") ?? "",
      );
      return chat === undefined
        ? c.json({ error: "This unit is not open. Open it first." }, 404)
        : handler(c, chat);
    };
  }

  app.get(
    `${unitPath}/events`,
    withUnit((c, chat) => streamLog(c, chat, heartbeatMs)),
  );

  app.post(
    `${unitPath}/messages`,
    withUnit(async (c, chat) => {
      const body = await readBody(c, LearnerMessage);
      if (!body.ok) return c.json({ error: body.error }, 400);
      return reply(c, chat.say(body.data.text), 202);
    }),
  );

  app.post(
    `${unitPath}/ready`,
    withUnit(async (c, chat) => reply(c, await chat.ready(), 202)),
  );

  app.post(
    `${unitPath}/answers`,
    withUnit(async (c, chat) => {
      const body = await readBody(c, AnswerSubmission);
      if (!body.ok) return c.json({ error: body.error }, 400);
      return reply(c, await chat.answer(body.data), 202);
    }),
  );

  // A written answer whose grading failed, graded again as it was sent.
  app.post(
    `${unitPath}/grade-again`,
    withUnit(async (c, chat) => reply(c, await chat.gradeAgain(), 202)),
  );

  // Moving on sends the tutor nothing until the learner's next step.
  app.post(
    `${unitPath}/override`,
    withUnit(async (c, chat) => reply(c, await chat.override(), 200)),
  );

  app.post(
    `${unitPath}/next-segment`,
    withUnit(async (c, chat) => reply(c, await chat.nextSegment(), 202)),
  );

  // The closing card's two steps when some objectives did not pass.
  app.post(
    `${unitPath}/go-over-again`,
    withUnit(async (c, chat) => reply(c, await chat.goOverAgain(), 202)),
  );

  app.post(
    `${unitPath}/finish`,
    withUnit(async (c, chat) => reply(c, await chat.finishUnit(), 200)),
  );

  // A new conversation with the tutor, which picks up where the unit stands.
  app.post(
    `${unitPath}/start-fresh`,
    withUnit(async (c, chat) => reply(c, await chat.startFresh(), 202)),
  );

  app.post(
    `${unitPath}/interrupt`,
    withUnit(async (c, chat) => {
      await chat.interrupt();
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
