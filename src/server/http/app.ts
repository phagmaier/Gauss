// HTTP routes: the library and the intake chat that starts a course (plan
// task 1.5), the unit chats (task 2.6), "What I know" with the course's
// calibration (tasks 2.26 and 2.29), the artifacts the tutor shows (task
// 3.6), disputes of recorded answers' grades (task 3.8), "Open" on a code
// question's files (task 3.22), the learner profile (task 5.8), the
// course's planning conversation (task 5.38), Review now and the self-test
// from the course view, deleting a course (task 5.18), the sources
// attached in an intake (piece 22), and the photos attached to a unit's
// messages. Each chat has an event stream from the server to the page, and
// a POST for each thing the learner does in it.
// Only Gauss's own page may use any of them.

import { type Context, Hono, type MiddlewareHandler } from "hono";
import { streamSSE } from "hono/streaming";
import type { z } from "zod";
import {
  type CheatSheetList,
  CheatSheetPost,
} from "../../shared/cheat-sheet.ts";
import {
  CourseSettings,
  NO_WEB_SEARCH_ON_CODEX,
  Slug,
} from "../../shared/course.ts";
import { CurriculumChangeAnswer } from "../../shared/curriculum-change.ts";
import {
  DisputePost,
  type GradedBy,
  type ShownDispute,
} from "../../shared/dispute.ts";
import {
  Approval,
  BackendChoice,
  FILE_NAME_HEADER,
  FinishUnitPost,
  type Hello,
  type IntakeStarted,
  LearnerMessage,
  type PageEvent,
  type PlanningOpened,
  type ReviewStarted,
  SkipTestedPost,
  type SourceUploaded,
  UnitMessage,
  type UnitOpened,
} from "../../shared/events.ts";
import {
  type CourseWithProgress,
  DeleteCourse,
  type Library,
} from "../../shared/library.ts";
import { NotesPost } from "../../shared/notes.ts";
import { PackagesAnswer } from "../../shared/packages.ts";
import { PhotoId, type PhotoStaged } from "../../shared/photo.ts";
import {
  ProfilePost,
  type ProfileSaved,
  type ProfileView,
} from "../../shared/profile.ts";
import { AnswerPost, OpenFilePost } from "../../shared/question.ts";
import {
  type SelfTestCounts,
  SelfTestRequest,
} from "../../shared/self-test.ts";
import {
  type AppSettings,
  type SettingsView,
  TeachingPost,
  type TeachingSaved,
  TutorModelPost,
  type TutorModelSaved,
  tutorModel,
} from "../../shared/settings.ts";
import {
  type CourseSources,
  SectionId,
  sectionsByRef,
} from "../../shared/source.ts";
import { StyleAnswer } from "../../shared/style.ts";
import type { WhatIKnow } from "../../shared/what-i-know.ts";
import type { AttachResult, Upload } from "../engine/attached-sources.ts";
import type { CheatSheets } from "../engine/cheat-sheets.ts";
import { fileProblem, workspaceFile } from "../engine/code-run.ts";
import type { ChatResult, EventLog } from "../engine/conversation.ts";
import {
  COURSE_DELETING,
  createCourseDeletion,
} from "../engine/course-deletion.ts";
import type {
  CoursePlanning,
  CoursePlannings,
} from "../engine/course-planning.ts";
import type { Disputes } from "../engine/disputes.ts";
import type { Intake, Intakes } from "../engine/intake.ts";
import type { Notes } from "../engine/notes.ts";
import type { PhotoTaker } from "../engine/photos.ts";
import {
  NotRendered,
  renderSourcePage,
  type SourceConverter,
} from "../engine/source-convert.ts";
import { STANDALONE_HTML_POLICY } from "../engine/standalone-html.ts";
import {
  renderTranscript,
  transcriptPhotos,
} from "../engine/transcript-html.ts";
import type { UnitChat, UnitChats } from "../engine/unit-chat.ts";
import type { FileOpener } from "../open-file.ts";
import type { Backup } from "../record/backup.ts";
import {
  type DataRoot,
  ProfileChanged,
  type SourceHome,
  TeachingChanged,
} from "../record/data-root.ts";
import { finishedCourses, withProgress } from "../record/progress.ts";
import { whatIKnow } from "../record/what-i-know.ts";
import { withReporter } from "./artifact-frame.ts";

export function createApp(options: {
  dataRoot: DataRoot;
  intakes: Intakes;
  /** Planning from the course view (task 5.38). */
  plannings: CoursePlannings;
  units: UnitChats;
  disputes: Disputes;
  notes: Notes;
  /** The course's cheat sheets: their list, writes and deletions. */
  cheatSheets: CheatSheets;
  /** Takes in the photos the learner attaches to a unit's messages. */
  photos: PhotoTaker;
  /** Renders a PDF page not already in the source's cache. */
  converter?: SourceConverter;
  /** "Open" on a code question's card; the system's opener, or a stub in tests. */
  openFile: FileOpener;
  /** Commits the record once the profile is saved; none if not given. */
  backup?: Backup;
  heartbeatMs?: number;
}) {
  const {
    dataRoot,
    intakes,
    plannings,
    units,
    disputes,
    notes,
    cheatSheets,
    photos,
    openFile,
  } = options;
  const heartbeatMs = options.heartbeatMs ?? 20_000;
  const app = new Hono();
  app.use("/api/*", localOnly);

  // A record that cannot be read, or a write that failed. The reason goes to
  // the page, which is the learner's own.
  app.onError((error, c) => {
    console.error(error);
    return c.json({ error: error.message }, 500);
  });

  const deletion = createCourseDeletion({
    dataRoot,
    holders: [units, plannings, intakes, notes, cheatSheets, disputes],
    ...(options.backup === undefined ? {} : { backup: options.backup }),
  });

  app.post("/api/courses/:id/delete", async (c) => {
    const body = await readBody(c, DeleteCourse);
    if (!body.ok) return c.json({ error: body.error }, 400);
    const deleted = await deletion.delete(c.req.param("id"), body.data);
    return deleted.ok
      ? c.json({ ok: true })
      : c.json({ error: deleted.error }, deleted.status);
  });

  // Registered after the deletion route, which takes the exclusive hold.
  app.use("/api/courses/:id/*", async (c, next) => {
    const courseId = c.req.param("id");
    if (courseId === undefined) return next();
    const release = deletion.hold(courseId);
    if (release === undefined) return c.json({ error: COURSE_DELETING }, 409);
    try {
      await next();
    } finally {
      release();
    }
  });

  // --- The library ---------------------------------------------------------

  // Each course with where its units stand, derived from the record now. A
  // course whose state or evidence cannot be read is listed with the reason
  // in place of its progress, so the rest of the library stays in reach.
  app.get("/api/courses", async (c) => {
    const courses = await Promise.all(
      (await dataRoot.listCourses()).map((stored) =>
        withProgress(dataRoot, stored),
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

  // The course's web search setting (task 4.11), for an approved course:
  // its open tutors' sessions are closed once between turns, and the next
  // turn resumes each with the setting's tools.
  app.post("/api/courses/:id/settings", async (c) => {
    const body = await readBody(c, CourseSettings);
    if (!body.ok) return c.json({ error: body.error }, 400);
    const stored = await dataRoot.readCourse(c.req.param("id"));
    if (stored === undefined) return c.json({ error: "No such course." }, 404);
    if (stored.curriculum?.approval.status !== "approved") {
      return c.json(
        { error: "The curriculum is not approved yet, so no tutor runs." },
        409,
      );
    }
    if (stored.course.backend === "codex" && body.data.webSearch) {
      return c.json({ error: NO_WEB_SEARCH_ON_CODEX }, 409);
    }
    const course = await units.setWebSearch(stored.id, body.data.webSearch);
    return c.json(course.settings satisfies CourseSettings);
  });

  // The outlines of the course's sources, which
  // the cards read a unit's sections by.
  app.get("/api/courses/:id/sources", async (c) => {
    const stored = await dataRoot.readCourse(c.req.param("id"));
    if (stored === undefined) return c.json({ error: "No such course." }, 404);
    const sources = await dataRoot.readSources(stored.id);
    return c.json({ sources } satisfies CourseSources);
  });

  for (const scope of ["courses", "intakes", "planning"] as const) {
    const base =
      scope === "planning"
        ? "/api/courses/:id/planning/:planning/sources/:source"
        : (`/api/${scope}/:id/sources/:source` as const);
    async function withSource(
      c: Context,
      read: (home: SourceHome, source: Slug) => Promise<Response>,
    ) {
      const id = c.req.param("id") ?? "";
      const source = Slug.safeParse(c.req.param("source"));
      if (!source.success) return c.json({ error: "No such source." }, 404);
      c.header("X-Content-Type-Options", "nosniff");
      c.header("Cross-Origin-Resource-Policy", "same-origin");
      c.header("Cache-Control", "no-store");
      if (scope === "courses") {
        if (!(await dataRoot.readCourse(id)))
          return c.json({ error: "No such course." }, 404);
        return read({ course: id }, source.data);
      }
      if (scope === "planning") {
        const planning = plannings.get(id, c.req.param("planning") ?? "");
        if (planning === undefined)
          return c.json({ error: "No such planning conversation." }, 404);
        // On the placement queue, as an Apply moving the source runs there.
        const response = await planning.withSourceHome(source.data, (home) =>
          read(home, source.data),
        );
        return response ?? c.json({ error: "No such source." }, 404);
      }
      const intake = intakes.get(id);
      if (intake === undefined)
        return c.json({ error: "No such intake." }, 404);
      // Resolve the location on the placement queue. Take the deletion hold
      // there too: a proposal ahead of us may have just created the course.
      const response = await intake.withSourceHome(source.data, (home) =>
        withIntake(c, () => read(home, source.data)),
      );
      return response ?? c.json({ error: "No such source." }, 404);
    }

    app.get(base, (c) =>
      withSource(c, async (home, source) => {
        const outline = await dataRoot.readSource(home, source);
        return outline === undefined
          ? c.json({ error: "No such source." }, 404)
          : c.json(outline);
      }),
    );
    app.get(`${base}/sections/:section`, (c) =>
      withSource(c, async (home, source) => {
        const section = SectionId.safeParse(c.req.param("section"));
        if (!section.success) return c.json({ error: "No such section." }, 404);
        const ref = `${source}/${section.data}`;
        const outline = await dataRoot.readSource(home, source);
        if (outline === undefined || !sectionsByRef([outline]).has(ref)) {
          return c.json({ error: "No such section." }, 404);
        }
        const text = await dataRoot.readSection(home, ref);
        return text === undefined
          ? c.json({ error: "No such section." }, 404)
          : c.text(text);
      }),
    );
    app.get(`${base}/pages/:page`, (c) =>
      withSource(c, async (home, source) => {
        const number = c.req.param("page");
        if (!/^[1-9][0-9]*$/.test(number))
          return c.json({ error: "No such page." }, 404);
        const page = Number(number);
        let image: Buffer<ArrayBuffer> | undefined;
        try {
          image = await dataRoot.pageImage(
            home,
            source,
            page,
            (original, png) =>
              renderSourcePage(
                options.converter,
                original,
                page,
                png,
                c.req.raw.signal,
              ),
          );
        } catch (error) {
          // Neither is the server's fault: a page that cannot be rendered
          // here, as the tutor's `view_page` is told, or a reader who has
          // turned to another page before this one came.
          if (error instanceof NotRendered) {
            return c.json({ error: error.message }, 503);
          }
          if (c.req.raw.signal.aborted) {
            return c.json({ error: "The request was cancelled." }, 503);
          }
          throw error;
        }
        return image === undefined
          ? c.json({ error: "No such page." }, 404)
          : c.body(image, 200, { "Content-Type": "image/png" });
      }),
    );
  }

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
    const state = await dataRoot.readState(courseId);
    const open =
      Object.values(state.units).find((p) => p.openQuestion?.id === questionId)
        ?.openQuestion ??
      Object.values(state.finishedReviews ?? {}).find(
        (p) => p.openQuestion?.id === questionId,
      )?.openQuestion;
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

  // An artifact runs only in the app's side pane, with the reporter that
  // tells the page of its errors. Other requests get its source as inert
  // text, even when its URL is opened in the browser.
  app.get("/api/courses/:id/artifacts/:file", async (c) => {
    const html = await dataRoot.readArtifact(
      c.req.param("id"),
      c.req.param("file"),
    );
    if (html === undefined) return c.json({ error: "No such artifact." }, 404);
    const inPane =
      c.req.header("Sec-Fetch-Dest") === "iframe" &&
      c.req.header("Sec-Fetch-Site") === "same-origin";
    return inPane
      ? c.body(withReporter(html), 200, ARTIFACT_FRAME_HEADERS)
      : c.body(html, 200, ARTIFACT_TEXT_HEADERS);
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
    // one proposed before profiles (task 5.8) no profile. The comparison
    // stays the one made with the proposal, even after a restart.
    const style = await dataRoot.readStyle(stored.id);
    const background = await dataRoot.readBackground(stored.id);
    const { profile, profileWas } = curriculum.approval;
    const intake = intakes.review({
      id: stored.id,
      backend: stored.course.backend,
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

  // --- The app's settings: the tutor's model for each backend's courses,
  // and the learner's teaching instructions ----------------------------------

  app.get("/api/settings", async (c) => {
    const [settings, text] = await Promise.all([
      dataRoot.readSettings(),
      dataRoot.readTeaching(),
    ]);
    return c.json({
      tutorModels: tutorModels(settings),
      teaching: {
        ...(text === undefined ? {} : { text }),
        ...units.teachingDefaults(),
      },
    } satisfies SettingsView);
  });

  app.post("/api/settings/tutor-model", async (c) => {
    const body = await readBody(c, TutorModelPost);
    if (!body.ok) return c.json({ error: body.error }, 400);
    const settings = await units.setTutorModel(body.data);
    options.backup?.commit("tutor model chosen");
    return c.json(tutorModels(settings) satisfies TutorModelSaved);
  });

  // Saved only over the text the page loaded, as the profile is.
  app.post("/api/settings/teaching", async (c) => {
    const body = await readBody(c, TeachingPost);
    if (!body.ok) return c.json({ error: body.error }, 400);
    let text: string | undefined;
    try {
      text = await units.setTeaching(body.data.text, body.data.was);
    } catch (error) {
      if (error instanceof TeachingChanged) {
        return c.json({ error: TEACHING_CHANGED }, 409);
      }
      throw error;
    }
    options.backup?.commit("teaching instructions saved");
    return c.json((text === undefined ? {} : { text }) satisfies TeachingSaved);
  });

  // --- Intakes: "New course" starts one; its first proposal makes the course

  app.post("/api/intakes", (c) =>
    c.json({ intakeId: intakes.start().id } satisfies IntakeStarted, 201),
  );

  /**
   * Resolves the intake after the request body (if any) has arrived. A restart
   * ends an intake; its routes answer 404 so the browser's EventSource stops
   * retrying.
   */
  async function withIntake(
    c: Context,
    handler: (intake: Intake) => Response | Promise<Response>,
  ) {
    const intake = intakes.get(c.req.param("id") ?? "");
    if (intake === undefined) return c.json({ error: "No such intake." }, 404);
    const courseId = intake.courseId();
    if (courseId === undefined) return handler(intake);
    const release = deletion.hold(courseId);
    if (release === undefined) return c.json({ error: COURSE_DELETING }, 409);
    try {
      return await handler(intake);
    } finally {
      release();
    }
  }

  app.get("/api/intakes/:id/events", (c) =>
    withIntake(c, (intake) => streamLog(c, intake, heartbeatMs)),
  );

  app.post("/api/intakes/:id/messages", async (c) => {
    const body = await readBody(c, LearnerMessage);
    if (!body.ok) return c.json({ error: body.error }, 400);
    return withIntake(c, (intake) => reply(c, intake.say(body.data.text), 202));
  });

  app.post("/api/intakes/:id/approval", async (c) => {
    const body = await readBody(c, Approval);
    if (!body.ok) return c.json({ error: body.error }, 400);
    return withIntake(c, async (intake) =>
      reply(c, await intake.approve(body.data.revision), 200),
    );
  });

  app.post("/api/intakes/:id/interrupt", (c) =>
    withIntake(c, async (intake) => {
      await intake.interrupt();
      return c.json({ ok: true });
    }),
  );

  // The backend the intake's course will run on, until its first proposal
  // makes the course. Picking Codex checks that it runs here and is signed
  // in, and is refused with the reason otherwise.
  app.post("/api/intakes/:id/backend", async (c) => {
    const body = await readBody(c, BackendChoice);
    if (!body.ok) return c.json({ error: body.error }, 400);
    return withIntake(c, async (intake) =>
      reply(c, await intake.chooseBackend(body.data.backend), 200),
    );
  });

  /**
   * A file the learner attached, from a request whose body is the file and
   * a header its name; or the answer refusing it.
   */
  async function attachFrom(
    c: Context,
    attach: (upload: Upload) => Promise<AttachResult>,
  ): Promise<Response> {
    const read = readUpload(c);
    if ("refused" in read) return read.refused;
    const attached = await attach(read.upload);
    if (attached.ok) {
      return c.json(
        { attachment: attached.attachment } satisfies SourceUploaded,
        202,
      );
    }
    const { status, error, attachment } = attached;
    return c.json(
      { error, ...(attachment === undefined ? {} : { attachment }) },
      status,
    );
  }

  // A source attached in the intake (piece 22): the body is the file, its
  // name in a header. The answer comes once the file is received; its card
  // then shows the conversion over the event stream.
  app.post("/api/intakes/:id/sources", (c) =>
    withIntake(c, (intake) => attachFrom(c, intake.attach)),
  );

  // "Remove" on a source's card, until the first proposal.
  app.post("/api/intakes/:id/sources/:attachment/remove", (c) =>
    withIntake(c, async (intake) =>
      reply(c, await intake.removeSource(c.req.param("attachment") ?? ""), 200),
    ),
  );

  // --- Planning from the course view (task 5.38): "Change the curriculum"
  // opens the course's conversation that has not ended, or a new one -------

  app.post("/api/courses/:id/planning", async (c) => {
    const opened = await plannings.open(c.req.param("id"));
    return opened.ok
      ? c.json({ planningId: opened.planning.id } satisfies PlanningOpened)
      : c.json({ error: opened.error }, opened.status);
  });

  const planningPath = "/api/courses/:id/planning/:planning";

  /** Runs the handler with the conversation the path names, or answers 404. */
  function withPlanning(
    handler: (
      c: Context,
      planning: CoursePlanning,
    ) => Response | Promise<Response>,
  ) {
    return (c: Context) => {
      const planning = plannings.get(
        c.req.param("id") ?? "",
        c.req.param("planning") ?? "",
      );
      return planning === undefined
        ? c.json({ error: "No such planning conversation." }, 404)
        : handler(c, planning);
    };
  }

  app.get(
    `${planningPath}/events`,
    withPlanning((c, planning) => streamLog(c, planning, heartbeatMs)),
  );

  app.post(
    `${planningPath}/messages`,
    withPlanning(async (c, planning) => {
      const body = await readBody(c, LearnerMessage);
      if (!body.ok) return c.json({ error: body.error }, 400);
      return reply(c, planning.say(body.data.text), 202);
    }),
  );

  app.post(
    `${planningPath}/apply`,
    withPlanning(async (c, planning) => {
      const body = await readBody(c, CurriculumChangeAnswer);
      if (!body.ok) return c.json({ error: body.error }, 400);
      return reply(c, await planning.apply(body.data.proposalId), 200);
    }),
  );

  app.post(
    `${planningPath}/keep`,
    withPlanning(async (c, planning) => {
      const body = await readBody(c, CurriculumChangeAnswer);
      if (!body.ok) return c.json({ error: body.error }, 400);
      return reply(c, await planning.keep(body.data.proposalId), 200);
    }),
  );

  app.post(
    `${planningPath}/interrupt`,
    withPlanning(async (c, planning) => {
      await planning.interrupt();
      return c.json({ ok: true });
    }),
  );

  // A source attached in the planning conversation (piece 26), as in the
  // intake; it joins the course when a change is applied.
  app.post(
    `${planningPath}/sources`,
    withPlanning((c, planning) => attachFrom(c, planning.attach)),
  );

  // "Remove" on a source's card, until the change is applied.
  app.post(
    `${planningPath}/sources/:attachment/remove`,
    withPlanning(async (c, planning) =>
      reply(
        c,
        await planning.removeSource(c.req.param("attachment") ?? ""),
        200,
      ),
    ),
  );

  // --- Unit chats: opening a unit starts it or picks it up where it was ----

  const unitPath = "/api/courses/:id/units/:unit";

  app.get(`${unitPath}/transcript`, async (c) => {
    const { id, unit } = c.req.param();
    const stored = await dataRoot.readCourse(id);
    const curriculum = stored?.curriculum;
    if (stored === undefined || curriculum == null) {
      return c.json({ error: "No such unit." }, 404);
    }
    const number = curriculum.units.findIndex((entry) => entry.id === unit) + 1;
    const entry = curriculum.units[number - 1];
    if (entry === undefined) return c.json({ error: "No such unit." }, 404);
    if (curriculum.approval.status !== "approved") {
      return c.json({ error: "The curriculum is not approved yet." }, 409);
    }
    await units.get(id, unit)?.flushTranscript();
    const [sessions, sources] = await Promise.all([
      dataRoot.readTranscripts(id, entry.id),
      dataRoot.readSources(id),
    ]);
    const photos = new Map<string, Buffer>();
    for (const photo of transcriptPhotos(sessions)) {
      const image = await dataRoot.readPhoto(id, photo);
      if (image !== undefined) photos.set(photo, image);
    }
    return c.html(
      renderTranscript(
        stored.course.title,
        entry,
        number,
        sessions,
        sources,
        curriculum.units,
        photos,
      ),
      200,
      {
        ...ARTIFACT_TEXT_HEADERS,
        "Content-Type": "text/html; charset=utf-8",
        "Content-Disposition": `attachment; filename="${entry.id}-transcript.html"`,
        "Content-Security-Policy": `sandbox; ${STANDALONE_HTML_POLICY}; frame-ancestors 'none'`,
      },
    );
  });

  // Notes belong to the record, not to an open chat. Starting a write
  // returns immediately; the view can leave and come back while it runs.
  const notesPath = `${unitPath}/notes`;
  app.get(notesPath, async (c) => {
    c.header("Cache-Control", "no-store");
    const found = await notes.view(c.req.param("id"), c.req.param("unit"));
    return found.ok
      ? c.json(found.view)
      : c.json({ error: found.error }, found.status);
  });

  app.post(notesPath, async (c) => {
    const body = await readBody(c, NotesPost);
    if (!body.ok) return c.json({ error: body.error }, 400);
    const started = await notes.start(
      c.req.param("id"),
      c.req.param("unit"),
      body.data.instructions ?? "",
      body.data.expectedRevision,
    );
    return started.ok
      ? c.json(started.view, 202)
      : c.json({ error: started.error }, started.status);
  });

  app.get(`${notesPath}/html`, async (c) => {
    const { id, unit } = c.req.param();
    const found = await notes.view(id, unit);
    if (!found.ok || found.view.saved === undefined) {
      return c.json({ error: "No saved notes for this unit." }, 404);
    }
    const html = await dataRoot.readNotesHtml(id, unit);
    if (html === undefined)
      return c.json({ error: "No saved notes for this unit." }, 404);
    const inFrame =
      c.req.header("Sec-Fetch-Dest") === "iframe" &&
      c.req.header("Sec-Fetch-Site") === "same-origin";
    return c.body(html, 200, {
      ...ARTIFACT_TEXT_HEADERS,
      ...(inFrame ? { "Content-Type": "text/html; charset=utf-8" } : {}),
      "Content-Security-Policy": `sandbox; ${STANDALONE_HTML_POLICY}; frame-ancestors 'self'`,
    });
  });

  app.post(`${notesPath}/open`, async (c) => {
    const found = await notes.view(c.req.param("id"), c.req.param("unit"));
    if (!found.ok || found.view.saved === undefined) {
      return c.json({ error: "No saved notes for this unit." }, 404);
    }
    const opened = await openFile(found.view.saved.path);
    return opened.ok
      ? c.json({ ok: true })
      : c.json({ error: opened.error }, 502);
  });

  // A course's cheat sheets, as its notes: a write answers at once and runs
  // on while the page leaves and comes back.
  const sheetsPath = "/api/courses/:id/cheat-sheets";
  app.get(sheetsPath, async (c) => {
    c.header("Cache-Control", "no-store");
    const found = await cheatSheets.list(c.req.param("id"));
    return found.ok
      ? c.json(found.list satisfies CheatSheetList)
      : c.json({ error: found.error }, found.status);
  });

  app.post(sheetsPath, async (c) => {
    const body = await readBody(c, CheatSheetPost);
    if (!body.ok) return c.json({ error: body.error }, 400);
    const started = await cheatSheets.start(
      c.req.param("id"),
      body.data.units,
      body.data.instructions ?? "",
    );
    return started.ok
      ? c.json(started.list satisfies CheatSheetList, 202)
      : c.json({ error: started.error }, started.status);
  });

  app.post(`${sheetsPath}/:sheet/delete`, async (c) => {
    const deleted = await cheatSheets.delete(
      c.req.param("id"),
      c.req.param("sheet"),
    );
    return deleted.ok
      ? c.json({ ok: true })
      : c.json({ error: deleted.error }, deleted.status);
  });

  app.get(`${sheetsPath}/:sheet/html`, async (c) => {
    const html = await cheatSheets.html(
      c.req.param("id"),
      c.req.param("sheet"),
    );
    if (html === undefined) {
      return c.json({ error: "No such cheat sheet." }, 404);
    }
    const inFrame =
      c.req.header("Sec-Fetch-Dest") === "iframe" &&
      c.req.header("Sec-Fetch-Site") === "same-origin";
    return c.body(html, 200, {
      ...ARTIFACT_TEXT_HEADERS,
      ...(inFrame ? { "Content-Type": "text/html; charset=utf-8" } : {}),
      "Content-Security-Policy": `sandbox; ${STANDALONE_HTML_POLICY}; frame-ancestors 'self'`,
    });
  });

  app.post(`${sheetsPath}/:sheet/open`, async (c) => {
    const path = await cheatSheets.path(
      c.req.param("id"),
      c.req.param("sheet"),
    );
    if (path === undefined) {
      return c.json({ error: "No such cheat sheet." }, 404);
    }
    const opened = await openFile(path);
    return opened.ok
      ? c.json({ ok: true })
      : c.json({ error: opened.error }, 502);
  });

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

  // "Review now" on the course view (task 5.25): starts a review of what is
  // due in a unit's thread, which the page then opens.
  app.post("/api/courses/:id/review-now", async (c) => {
    const started = await units.reviewNow(c.req.param("id"));
    return started.ok
      ? c.json({ ok: true, unit: started.unitId } satisfies ReviewStarted)
      : c.json({ error: started.error }, started.status);
  });

  // "Start the self-test" on the course view: starts the self-test the body
  // sets up in a unit's thread, which the page then opens, answered as
  // Review now is.
  app.post("/api/courses/:id/self-test", async (c) => {
    const body = await readBody(c, SelfTestRequest);
    if (!body.ok) return c.json({ error: body.error }, 400);
    const started = await units.selfTest(c.req.param("id"), body.data);
    return started.ok
      ? c.json({ ok: true, unit: started.unitId } satisfies ReviewStarted)
      : c.json({ error: started.error }, started.status);
  });

  // The self-test setup's line: for the same body as the start, which the
  // panel holds as the learner sets it up, how many objectives it would
  // ask, how many the scope holds, and how many the hour leaves out. The
  // kinds picked do not change the counts, but are checked as for a start.
  app.post("/api/courses/:id/self-test/counts", async (c) => {
    const body = await readBody(c, SelfTestRequest);
    if (!body.ok) return c.json({ error: body.error }, 400);
    const read = await units.selfTestCounts(c.req.param("id"), body.data);
    return read.ok
      ? c.json(read.counts satisfies SelfTestCounts)
      : c.json({ error: read.error }, read.status);
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

  // A photo attached to a message not yet sent: the body is the file, its
  // name in a header. The answer comes once it is staged, with the id the
  // message names it by.
  app.post(
    `${unitPath}/photos`,
    withUnit(async (c) => {
      const read = readUpload(c);
      if ("refused" in read) return read.refused;
      const staged = await photos.stage(read.upload, c.req.raw.signal);
      return staged.ok
        ? c.json({ photo: staged.photo } satisfies PhotoStaged)
        : c.json({ error: staged.error }, staged.status);
    }),
  );

  // A photo a message of this course carries, for the thread. Only the
  // course's own photos/ is read, so another course's photo, or one staged
  // and never sent, is not found. The unit need not be open: the thread
  // asks for its photos while the unit reopens after a restart.
  app.get(`${unitPath}/photos/:photo`, async (c) => {
    const { id, unit, photo } = c.req.param();
    const curriculum = (await dataRoot.readCourse(id))?.curriculum;
    const parsed = PhotoId.safeParse(photo);
    if (
      curriculum == null ||
      !curriculum.units.some((entry) => entry.id === unit) ||
      !parsed.success
    ) {
      return c.json({ error: "No such photo." }, 404);
    }
    const image = await dataRoot.readPhoto(id, parsed.data);
    return image === undefined
      ? c.json({ error: "No such photo." }, 404)
      : c.body(image, 200, {
          "Content-Type": "image/jpeg",
          "X-Content-Type-Options": "nosniff",
          "Cross-Origin-Resource-Policy": "same-origin",
          "Cache-Control": "no-store",
        });
  });

  app.post(
    `${unitPath}/messages`,
    withUnit(async (c, chat) => {
      const body = await readBody(c, UnitMessage);
      if (!body.ok) return c.json({ error: body.error }, 400);
      return reply(c, await chat.say(body.data.text, body.data.photos), 202);
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

  // The card of the tutor's proposed style note (task 5.11).
  app.post(
    `${unitPath}/style/apply`,
    withUnit(async (c, chat) => {
      const body = await readBody(c, StyleAnswer);
      if (!body.ok) return c.json({ error: body.error }, 400);
      return reply(c, await chat.applyStyle(body.data.proposalId), 200);
    }),
  );

  app.post(
    `${unitPath}/style/keep`,
    withUnit(async (c, chat) => {
      const body = await readBody(c, StyleAnswer);
      if (!body.ok) return c.json({ error: body.error }, 400);
      return reply(c, await chat.keepStyle(body.data.proposalId), 200);
    }),
  );

  // The card of the tutor's proposed curriculum change (task 5.12).
  app.post(
    `${unitPath}/curriculum/apply`,
    withUnit(async (c, chat) => {
      const body = await readBody(c, CurriculumChangeAnswer);
      if (!body.ok) return c.json({ error: body.error }, 400);
      return reply(c, await chat.applyCurriculum(body.data.proposalId), 200);
    }),
  );

  app.post(
    `${unitPath}/curriculum/keep`,
    withUnit(async (c, chat) => {
      const body = await readBody(c, CurriculumChangeAnswer);
      if (!body.ok) return c.json({ error: body.error }, 400);
      return reply(c, await chat.keepCurriculum(body.data.proposalId), 200);
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
    withUnit(async (c, chat) => {
      const body = await readBody(c, FinishUnitPost);
      if (!body.ok) return c.json({ error: body.error }, 400);
      return reply(c, await chat.finishUnit(body.data.finishId), 200);
    }),
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

const TEACHING_CHANGED =
  "Your instructions were saved in another tab since this page loaded " +
  "them. Copy your text, reload the page, and edit the saved instructions.";

/** Each backend's tutor model as it stands: the one chosen, else the default. */
function tutorModels(settings: AppSettings): TutorModelSaved {
  return {
    claude: tutorModel(settings, "claude"),
    codex: tutorModel(settings, "codex"),
  };
}

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

/**
 * A file the learner attached, from a request whose body is the file and a
 * header its name; or the answer refusing a request that cannot be read.
 */
function readUpload(c: Context): { upload: Upload } | { refused: Response } {
  let name: string;
  try {
    name = decodeURIComponent(c.req.header(FILE_NAME_HEADER) ?? "");
  } catch {
    return {
      refused: c.json({ error: "The file's name could not be read." }, 400),
    };
  }
  const length = c.req.header("Content-Length");
  const size = length === undefined ? undefined : Number(length);
  if (size !== undefined && !(Number.isSafeInteger(size) && size >= 0)) {
    return {
      refused: c.json({ error: "The file's length could not be read." }, 400),
    };
  }
  return { upload: { name, size, body: c.req.raw.body ?? emptyBody() } };
}

/** A request with no body, read as one of no bytes. */
async function* emptyBody(): AsyncGenerator<Uint8Array> {}

/** Accepted (202, the tutor will reply) or done (200), or why not. */
function reply(c: Context, result: ChatResult, okStatus: 200 | 202) {
  return result.ok
    ? c.json({ ok: true }, okStatus)
    : c.json({ error: result.error }, result.status);
}
