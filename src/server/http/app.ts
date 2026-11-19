// HTTP routes: the library and the intake chat that starts a course (plan
// task 1.5), the unit chats (task 2.6), "What I know" with the course's
// calibration (tasks 2.26 and 2.29), the artifacts the tutor shows (task
// 3.6), disputes of recorded answers' grades (task 3.8), "Open" on a code
// question's files (task 3.22), and the learner profile (task 5.8). Each chat has an event stream from the
// server to the page, and a POST for each thing the learner does in it. Only
// Gauss's own page may use any of them.

import { type Context, Hono, type MiddlewareHandler } from "hono";
import { streamSSE } from "hono/streaming";
import type { z } from "zod";
import {
  DisputePost,
  type GradedBy,
  type ShownDispute,
} from "../../shared/dispute.ts";
import {
  Approval,
  type Hello,
  type IntakeStarted,
  LearnerMessage,
  type PageEvent,
  SkipTestedPost,
  type UnitOpened,
} from "../../shared/events.ts";
import type { CourseWithProgress, Library } from "../../shared/library.ts";
import { PackagesAnswer } from "../../shared/packages.ts";
import {
  ProfilePost,
  type ProfileSaved,
  type ProfileView,
} from "../../shared/profile.ts";
import { AnswerPost, OpenFilePost } from "../../shared/question.ts";
import type { WhatIKnow } from "../../shared/what-i-know.ts";
import { fileProblem, workspaceFile } from "../engine/code-run.ts";
import type { ChatResult, EventLog } from "../engine/conversation.ts";
import type { Disputes } from "../engine/disputes.ts";
import type { Intake, Intakes } from "../engine/intake.ts";
import type { UnitChat, UnitChats } from "../engine/unit-chat.ts";
import type { FileOpener } from "../open-file.ts";
import type { Backup } from "../record/backup.ts";
import { type DataRoot, ProfileChanged } from "../record/data-root.ts";
import { finishedCourses, withProgress } from "../record/progress.ts";
import { whatIKnow } from "../record/what-i-know.ts";

export function createApp(options: {
  dataRoot: DataRoot;
  intakes: Intakes;
  units: UnitChats;
  disputes: Disputes;
  /** "Open" on a code question's card; the system's opener, or a stub in tests. */
  openFile: FileOpener;
  /** Commits the record once the profile is saved; none if not given. */
  backup?: Backup;
  heartbeatMs?: number;
}) {
  const { dataRoot, intakes, units, disputes, openFile } = options;
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

  // "What I know" (task 2.26): every objective of the course's planned units
  // with its status and the evidence behind it, and the course's calibration
  // (task 2.29). A draft has none to show.
  app.get("/api/courses/:id/what-i-know", async (c) => {
    const stored = await dataRoot.readCourse(c.req.param("id"));
    if (stored === undefined) return c.json({ error: "No such course." }, 404);
    const { curriculum } = stored;
    if (curriculum?.approval.status !== "approved") {
      return c.json(
        { error: "The curriculum is not approved yet: nothing is taught." },
        409,
      );
    }
    const [state, evidence, misconceptions] = await Promise.all([
      dataRoot.readState(stored.id),
      dataRoot.readEvidence(stored.id),
      dataRoot.readMisconceptions(stored.id),
    ]);
    return c.json(
      whatIKnow(
        stored.course.title,
        curriculum,
        state,
        evidence,
        misconceptions,
      ) satisfies WhatIKnow,
    );
  });

  // Disputes (task 3.8), of any recorded answer of the course, from the
  // session's graded card or from "What I know". What the answer was graded
  // by is shown only to dispute it. A dispute waits for its outcome, which
  // its unit's chat also sends, if it is open.
  const answerPath = "/api/courses/:id/answers/:question";

  app.get(`${answerPath}/graded-by`, async (c) => {
    const found = await disputes.gradedBy(
      c.req.param("id"),
      c.req.param("question"),
    );
    return found.ok
      ? c.json(found.gradedBy satisfies GradedBy)
      : c.json({ error: found.error }, found.status);
  });

  app.post(`${answerPath}/dispute`, async (c) => {
    const body = await readBody(c, DisputePost);
    if (!body.ok) return c.json({ error: body.error }, 400);
    const raised = await disputes.raise(
      c.req.param("id"),
      c.req.param("question"),
      body.data.reason,
    );
    if (!raised.ok) return c.json({ error: raised.error }, raised.status);
    const { recordedAt, reason, outcome } = raised.dispute;
    return c.json({ recordedAt, reason, outcome } satisfies ShownDispute);
  });

  // "Open" beside "Copy path" (task 3.22): one of the files an open code
  // question of the course lists, named by its place in the list, from the
  // course's workspace, in the system's default app.
  app.post("/api/courses/:id/questions/:question/open", async (c) => {
    const body = await readBody(c, OpenFilePost);
    if (!body.ok) return c.json({ error: body.error }, 400);
    const courseId = c.req.param("id");
    if ((await dataRoot.readCourse(courseId)) === undefined) {
      return c.json({ error: "No such course." }, 404);
    }
    const questionId = c.req.param("question");
    const open = Object.values((await dataRoot.readState(courseId)).units)
      .map((position) => position.openQuestion)
      .find((q) => q?.id === questionId);
    if (open?.question.kind !== "code") {
      return c.json(
        { error: "No open code question of this course has that id." },
        404,
      );
    }
    const path = open.question.files[body.data.file];
    if (path === undefined) {
      return c.json({ error: "That question has no such file." }, 404);
    }
    const found = await workspaceFile(
      await dataRoot.workspaceFolder(courseId),
      path,
    );
    if ("problem" in found) {
      return c.json({ error: fileProblem({ path, ...found }) }, 409);
    }
    const opened = await openFile(found.full);
    return opened.ok
      ? c.json({ ok: true })
      : c.json({ error: opened.error }, 502);
  });

  // An artifact runs only in the app's side pane. Other requests get its
  // source as inert text, even when its URL is opened in the browser.
  app.get("/api/courses/:id/artifacts/:file", async (c) => {
    const html = await dataRoot.readArtifact(
      c.req.param("id"),
      c.req.param("file"),
    );
    if (html === undefined) return c.json({ error: "No such artifact." }, 404);
    const inPane =
      c.req.header("Sec-Fetch-Dest") === "iframe" &&
      c.req.header("Sec-Fetch-Site") === "same-origin";
    return c.body(
      html,
      200,
      inPane ? ARTIFACT_FRAME_HEADERS : ARTIFACT_TEXT_HEADERS,
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
    // A draft proposed before style notes existed (task 2.10) has none, one
    // proposed before background notes (task 2.22) has no background, and
    // one proposed before profiles (task 5.8) no profile. Its card compares
    // the profile with profile.md as it is now.
    const style = await dataRoot.readStyle(stored.id);
    const background = await dataRoot.readBackground(stored.id);
    const { profile } = curriculum.approval;
    const profileWas = await dataRoot.readProfile();
    const intake = intakes.review({
      id: stored.id,
      proposal: {
        title: stored.course.title,
        units: curriculum.units,
        ...(style === undefined ? {} : { style }),
        ...(background === undefined ? {} : { background }),
        ...(profile === undefined ? {} : { profile }),
        ...(profile === undefined || profileWas === undefined
          ? {}
          : { profileWas }),
      },
    });
    return c.json({ intakeId: intake.id } satisfies IntakeStarted);
  });

  // --- The learner profile (task 5.8), with the finished courses a new
  // course's planner is given beside it ------------------------------------

  app.get("/api/profile", async (c) => {
    const [text, finished] = await Promise.all([
      dataRoot.readProfile(),
      finishedCourses(dataRoot),
    ]);
    return c.json({
      ...(text === undefined ? {} : { text }),
      finished,
    } satisfies ProfileView);
  });

  // Saved only over the text the page loaded, so that an approval meanwhile
  // is not written over unseen.
  app.post("/api/profile", async (c) => {
    const body = await readBody(c, ProfilePost);
    if (!body.ok) return c.json({ error: body.error }, 400);
    try {
      await dataRoot.writeProfile(body.data.text, body.data.was);
    } catch (error) {
      if (error instanceof ProfileChanged) {
        return c.json({ error: PROFILE_CHANGED }, 409);
      }
      throw error;
    }
    options.backup?.commit("profile saved");
    return c.json({ text: body.data.text } satisfies ProfileSaved);
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
    const courseId = c.req.param("id");
    const unitId = c.req.param("unit");
    // Opening can start a turn. There is also time for events before SSE
    // connects, so take the cursor before anything in this request waits.
    const last = (units.get(courseId, unitId)?.events().length ?? 0) - 1;
    const opened = await units.open(courseId, unitId);
    return opened.ok
      ? c.json({ ok: true, chatId: opened.chat.id, last } satisfies UnitOpened)
      : c.json({ error: opened.error }, opened.status);
  });

  // Opens a unit not started with its test before it is taught (task 5.6),
  // as opening it does otherwise; refused once the unit has started.
  app.post(`${unitPath}/test-out`, async (c) => {
    const courseId = c.req.param("id");
    const unitId = c.req.param("unit");
    const last = (units.get(courseId, unitId)?.events().length ?? 0) - 1;
    const opened = await units.open(courseId, unitId, { testOut: true });
    return opened.ok
      ? c.json({ ok: true, chatId: opened.chat.id, last } satisfies UnitOpened)
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

  // In a detour after a miss: ends it, and asks the tutor for the next question.
  app.post(
    `${unitPath}/another-question`,
    withUnit(async (c, chat) => reply(c, await chat.anotherQuestion(), 202)),
  );

  app.post(
    `${unitPath}/answers`,
    withUnit(async (c, chat) => {
      const body = await readBody(c, AnswerPost);
      if (!body.ok) return c.json({ error: body.error }, 400);
      return reply(c, await chat.answer(body.data), 202);
    }),
  );

  // A written, math or code answer whose grading failed, graded again as it was sent.
  app.post(
    `${unitPath}/grade-again`,
    withUnit(async (c, chat) => reply(c, await chat.gradeAgain(), 202)),
  );

  // The card of the tutor's request to install packages (task 3.11).
  app.post(
    `${unitPath}/packages/install`,
    withUnit(async (c, chat) => {
      const body = await readBody(c, PackagesAnswer);
      if (!body.ok) return c.json({ error: body.error }, 400);
      return reply(c, await chat.installPackages(body.data.requestId), 202);
    }),
  );

  app.post(
    `${unitPath}/packages/not-now`,
    withUnit(async (c, chat) => {
      const body = await readBody(c, PackagesAnswer);
      if (!body.ok) return c.json({ error: body.error }, 400);
      return reply(c, await chat.declinePackages(body.data.requestId), 202);
    }),
  );

  app.post(
    `${unitPath}/packages/retry-saving`,
    withUnit(async (c, chat) => {
      const body = await readBody(c, PackagesAnswer);
      if (!body.ok) return c.json({ error: body.error }, 400);
      return reply(c, await chat.retryPackageSave(body.data.requestId), 200);
    }),
  );

  // An assessment's card (task 5.4): Start asks the tutor for its first
  // question; Skip, on the card or partway, ends it.
  app.post(
    `${unitPath}/assessment/start`,
    withUnit(async (c, chat) => reply(c, await chat.startAssessment(), 202)),
  );

  app.post(
    `${unitPath}/assessment/skip`,
    withUnit(async (c, chat) => reply(c, await chat.skipAssessment(), 200)),
  );

  // The test's result card: skip what it passed, or have the whole unit taught.
  app.post(
    `${unitPath}/test-out/skip`,
    withUnit(async (c, chat) => {
      const body = await readBody(c, SkipTestedPost);
      if (!body.ok) return c.json({ error: body.error }, 400);
      return reply(c, await chat.skipTested(body.data.objectives), 202);
    }),
  );

  app.post(
    `${unitPath}/test-out/whole`,
    withUnit(async (c, chat) => reply(c, await chat.teachWhole(), 202)),
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

/** A save refused because the profile changed after the page loaded it. */
const PROFILE_CHANGED =
  "Your profile was changed since this page loaded it, by a curriculum " +
  "you approved or in another tab. Copy your text, reload the page, and " +
  "edit the saved profile.";

/**
 * An artifact's policy. `sandbox` without `allow-same-origin` gives it an
 * origin of its own, so its scripts cannot read the app, its storage or the
 * page around it; the frame has the same sandbox.
 * Nothing is fetched or loaded but what the document holds inline, and no
 * form is sent. Only the app's own page may frame it. The page's own policy
 * (`frame-src 'self'` in `src/web/index.html`) stops the frame navigating
 * away, which the artifact's policy cannot.
 */
export const ARTIFACT_POLICY = [
  "sandbox allow-scripts",
  "default-src 'none'",
  "script-src 'unsafe-inline' 'unsafe-eval'",
  "style-src 'unsafe-inline'",
  "img-src data: blob:",
  "font-src data:",
  "media-src data: blob:",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'self'",
].join("; ");

const ARTIFACT_TEXT_HEADERS = {
  "Content-Type": "text/plain; charset=utf-8",
  "Content-Security-Policy": ARTIFACT_POLICY,
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cross-Origin-Resource-Policy": "same-origin",
  "X-DNS-Prefetch-Control": "off",
  "Cache-Control": "no-store",
};

const ARTIFACT_FRAME_HEADERS = {
  ...ARTIFACT_TEXT_HEADERS,
  "Content-Type": "text/html; charset=utf-8",
};

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
    const logged = log.events();
    const last = logged.length - 1;
    const pending: [PageEvent, number][] = logged
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
        data: JSON.stringify({ chatId: log.id, last } satisfies Hello),
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
