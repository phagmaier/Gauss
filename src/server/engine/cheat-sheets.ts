// Cheat sheets (brief.md, "Other features", "Cheat sheets"; piece 29): a
// page the writer designs for the finished units the learner picks, kept
// until the learner deletes it, never replaced. One write at a time per
// course; it outlives the page that started it, as a notes write does.
//
// The request leaves the transcripts out: a course's transcripts would not
// fit one request, and a one-page sheet needs each unit's plan, handoff
// note and verified quotes, and the learner's slips on those units'
// objectives. Measured with thirty finished units of the dev seed's size
// (its scripted plans, every answer right, no handoff notes or quotes),
// the request is about 27,000 characters; with a handoff note at its limit
// (4,000 characters) on each unit, about 146,000.

import { randomUUID } from "node:crypto";
import {
  type CheatSheetAttempt,
  type CheatSheetList,
  CheatSheetReply,
} from "../../shared/cheat-sheet.ts";
import type { StoredUnit } from "../../shared/curriculum.ts";
import type { AnswerEvidence } from "../../shared/evidence.ts";
import { CHOICE_LETTERS } from "../../shared/question.ts";
import { quoteCitation } from "../../shared/source-lines.ts";
import { isFinished } from "../../shared/status.ts";
import type { TutorBackend } from "../backends/backend.ts";
import { type Backup, noBackup } from "../record/backup.ts";
import type { DataRoot } from "../record/data-root.ts";
import { countedAnswers, disputesIn } from "../record/disputes.ts";
import { unitStatus } from "../record/status.ts";
import { systemTimer, type Timer } from "./conversation.ts";
import type { CourseHolder } from "./course-deletion.ts";
import { citedPlan, tagged, unitEvents, wrongAnswer } from "./notes.ts";
import {
  finishStandaloneHtml,
  MAX_FORMULAS,
  MAX_MATH_CHARS,
  STANDALONE_HTML_LIMIT_BYTES,
} from "./standalone-html.ts";

/** The notes writer's limit. */
const WRITE_LIMIT_MS = 3 * 60_000;

type Refused = { ok: false; status: 400 | 404 | 409; error: string };
type Listed = { ok: true; list: CheatSheetList } | Refused;

type CheatSheetsOptions = {
  dataRoot: DataRoot;
  backend: TutorBackend;
  systemPrompt: string;
  /** Wait for an open chat's transcript and handoff, without sending it a turn. */
  ready: (courseId: string, unitId: string) => Promise<void> | undefined;
  backup?: Backup;
  now?: () => Date;
  /** Runs the time limit; the system's clock if not given. */
  timer?: Timer;
};

export interface CheatSheets extends CourseHolder {
  list(courseId: string): Promise<Listed>;
  start(
    courseId: string,
    units: readonly string[],
    instructions: string,
  ): Promise<Listed>;
  delete(courseId: string, sheetId: string): Promise<{ ok: true } | Refused>;
  /** A kept sheet's page, or undefined when the course keeps none by that id. */
  html(courseId: string, sheetId: string): Promise<string | undefined>;
  /** A kept sheet's file, or undefined when the course keeps none by that id. */
  path(courseId: string, sheetId: string): Promise<string | undefined>;
  /** Resolves once every write started so far has ended (for tests, as `Notes.settled`). */
  settled(): Promise<void>;
  close(): Promise<void>;
}

export function createCheatSheets(options: CheatSheetsOptions): CheatSheets {
  const { dataRoot, backend, systemPrompt, ready } = options;
  const backup = options.backup ?? noBackup;
  const now = options.now ?? (() => new Date());
  const timer = options.timer ?? systemTimer;
  /** By course: the write running, or the last one, which failed. */
  const attempts = new Map<string, CheatSheetAttempt>();
  const starting = new Set<string>();
  const jobs = new Set<Promise<void>>();
  const stop = new AbortController();
  /**
   * By course: a sheet being put in the record and its commit queued. A
   * sheet is listed, and can be deleted, from the moment its source is
   * linked, before the commit that would keep it in the history.
   */
  const publishing = new Map<string, Promise<void>>();
  const noCourse = {
    ok: false,
    status: 404,
    error: "No such course.",
  } as const;
  const busy = {
    ok: false,
    status: 409,
    error:
      "A cheat sheet is being written for this course. Write another once it is done.",
  } as const;

  async function approved(courseId: string) {
    const stored = await dataRoot.readCourse(courseId);
    return stored?.curriculum?.approval.status === "approved"
      ? { title: stored.course.title, units: stored.curriculum.units }
      : undefined;
  }

  async function finished(courseId: string, units: readonly StoredUnit[]) {
    const [state, evidence] = await Promise.all([
      dataRoot.readState(courseId),
      dataRoot.readEvidence(courseId),
    ]);
    return units
      .filter((unit) =>
        isFinished(
          unitStatus(
            unit,
            evidence,
            Object.hasOwn(state.units, unit.id)
              ? state.units[unit.id]
              : undefined,
          ),
        ),
      )
      .map((unit) => unit.id);
  }

  async function list(
    courseId: string,
    units: readonly StoredUnit[],
  ): Promise<CheatSheetList> {
    // The attempt first: a write that ends between the two reads then
    // shows twice, as writing and kept, rather than not at all.
    const attempt = attempts.get(courseId);
    const [sheets, pickable] = await Promise.all([
      dataRoot.listCheatSheets(courseId),
      finished(courseId, units),
    ]);
    return { sheets, ...(attempt === undefined ? {} : { attempt }), pickable };
  }

  async function write(
    courseId: string,
    course: { title: string; units: readonly StoredUnit[] },
    picked: readonly StoredUnit[],
    instructions: string,
  ): Promise<void> {
    await Promise.all(picked.map((unit) => ready(courseId, unit.id)));
    if (stop.signal.aborted) return;
    const prompt = await request(
      dataRoot,
      courseId,
      course,
      picked,
      instructions,
    );
    const limit = new AbortController();
    const cancel = timer.after(WRITE_LIMIT_MS, () => limit.abort());
    const reply = await backend
      .oneShot({
        systemPrompt,
        prompt,
        schema: CheatSheetReply,
        signal: AbortSignal.any([stop.signal, limit.signal]),
      })
      .finally(cancel);
    if (stop.signal.aborted) return;
    if (!reply.ok) {
      throw new Error(
        limit.signal.aborted
          ? "The cheat sheet writer took longer than three minutes."
          : reply.error,
      );
    }
    const html = finishStandaloneHtml(reply.value.html);
    const sheetId = randomUUID();
    const published = dataRoot
      .writeCheatSheet(courseId, sheetId, html, {
        units: picked.map((unit) => unit.id),
        instructions,
        writtenAt: now().toISOString(),
        html: reply.value.html,
      })
      .then(() => backup.commit(`${courseId}: cheat sheet ${sheetId}`));
    publishing.set(courseId, published);
    try {
      await published;
    } finally {
      publishing.delete(courseId);
    }
  }

  async function kept(courseId: string, sheetId: string) {
    if ((await approved(courseId)) === undefined) return undefined;
    return (await dataRoot.listCheatSheets(courseId)).find(
      (sheet) => sheet.id === sheetId,
    );
  }

  return {
    async list(courseId) {
      const course = await approved(courseId);
      if (course === undefined) return noCourse;
      return { ok: true, list: await list(courseId, course.units) };
    },
    async start(courseId, units, instructions) {
      const course = await approved(courseId);
      if (course === undefined) return noCourse;
      if (units.length === 0) {
        return {
          ok: false,
          status: 400,
          error: "Pick at least one finished unit.",
        };
      }
      if (
        starting.has(courseId) ||
        attempts.get(courseId)?.state === "writing" ||
        stop.signal.aborted
      ) {
        return busy;
      }
      // Reserve the course before reading which units are finished, so a
      // second request cannot start between that read and the write.
      starting.add(courseId);
      try {
        const unknown = units.find(
          (id) => !course.units.some((unit) => unit.id === id),
        );
        if (unknown !== undefined) {
          return {
            ok: false,
            status: 404,
            error: `This course has no unit "${unknown}".`,
          };
        }
        const done = new Set(await finished(courseId, course.units));
        const index = course.units.findIndex(
          (unit) => units.includes(unit.id) && !done.has(unit.id),
        );
        if (index !== -1) {
          return {
            ok: false,
            status: 409,
            error: `Unit ${index + 1}, ${course.units[index]?.title}, is not finished. A cheat sheet takes finished units only.`,
          };
        }
        // Read before the write starts, so a record that cannot be read
        // refuses the request instead of answering after starting it.
        const sheets = await dataRoot.listCheatSheets(courseId);
        if (stop.signal.aborted) return busy;
        const picked = course.units.filter((unit) => units.includes(unit.id));
        const attempt = {
          state: "writing",
          units: picked.map((unit) => unit.id),
          instructions,
        } as const;
        attempts.set(courseId, attempt);
        const job = write(courseId, course, picked, instructions)
          .then(() => void attempts.delete(courseId))
          .catch((error: unknown) => {
            attempts.set(courseId, {
              ...attempt,
              state: "failed",
              error: error instanceof Error ? error.message : String(error),
            });
          })
          .finally(() => void jobs.delete(job));
        jobs.add(job);
        return {
          ok: true,
          list: {
            sheets,
            attempt,
            pickable: course.units
              .filter((unit) => done.has(unit.id))
              .map((unit) => unit.id),
          },
        };
      } finally {
        starting.delete(courseId);
      }
    },
    async delete(courseId, sheetId) {
      if ((await approved(courseId)) === undefined) return noCourse;
      // A commit queues a snapshot without taking it: let the one after
      // the sheet's write be queued and taken first, so the history keeps
      // the sheet.
      await publishing.get(courseId)?.catch(() => {});
      await backup.settled();
      if (!(await dataRoot.deleteCheatSheet(courseId, sheetId))) {
        return { ok: false, status: 404, error: "No such cheat sheet." };
      }
      backup.commit(`${courseId}: cheat sheet ${sheetId} deleted`);
      return { ok: true };
    },
    async html(courseId, sheetId) {
      if ((await approved(courseId)) === undefined) return undefined;
      return dataRoot.readCheatSheetHtml(courseId, sheetId);
    },
    async path(courseId, sheetId) {
      return (await kept(courseId, sheetId))?.path;
    },
    inUse(courseId) {
      return starting.has(courseId) ||
        attempts.get(courseId)?.state === "writing"
        ? { doing: "cheat-sheet" }
        : undefined;
    },
    async forget(courseId) {
      // Only a failed attempt is left: one writing holds the course.
      attempts.delete(courseId);
    },
    async settled() {
      await Promise.all(jobs);
    },
    async close() {
      stop.abort();
      await Promise.all(jobs);
    },
  };
}

/** What the writer reads: the picked units in course order, then the learner's slips on them. */
async function request(
  dataRoot: DataRoot,
  courseId: string,
  course: { title: string; units: readonly StoredUnit[] },
  picked: readonly StoredUnit[],
  instructions: string,
): Promise<string> {
  const [evidence, misconceptions, state, sources] = await Promise.all([
    dataRoot.readEvidence(courseId),
    dataRoot.readMisconceptions(courseId),
    dataRoot.readState(courseId),
    dataRoot.readSources(courseId),
  ]);
  const units = await Promise.all(
    picked.map(async (unit) => {
      const [handoff, transcripts] = await Promise.all([
        dataRoot.readHandoff(courseId, unit.id),
        dataRoot.readTranscripts(courseId, unit.id),
      ]);
      // Only the unit's own teaching: not another unit's assessment
      // questions, held in this thread, and their detours.
      const own = new Set(unit.plan?.objectives.map((o) => o.id));
      const events = transcripts.flatMap((t) => t.events);
      const askedHere = new Set(
        events.flatMap((e) => (e.type === "question" ? [e.question.id] : [])),
      );
      const answered = new Map(
        evidence.flatMap((entry) =>
          entry.kind === "answer" &&
          own.has(entry.objective) &&
          (askedHere.has(entry.answer.questionId) ||
            entry.assessment?.unit === unit.id)
            ? [[entry.answer.questionId, entry] as const]
            : [],
        ),
      );
      const quotes = new Map<string, { text: string; citation: string }>();
      for (const event of unitEvents(events, answered)) {
        if (event.type !== "source_quoted") continue;
        const citation = quoteCitation(event, sources);
        quotes.set(`${citation}\n${event.text}`, {
          text: event.text,
          citation,
        });
      }
      return {
        number: course.units.indexOf(unit) + 1,
        title: unit.title,
        goal: unit.goal,
        testedOut: Object.hasOwn(state.testedOut ?? {}, unit.id),
        plan:
          unit.plan === undefined ? undefined : citedPlan(unit.plan, sources),
        handoff: handoff?.note ?? "No handoff note was saved.",
        verifiedQuotes: [...quotes.values()],
      };
    }),
  );
  // Every answer on these objectives, wherever it was given: a check, or
  // an assessment in any unit's thread. A dispute's verdict counts.
  const objectives = new Set(
    picked.flatMap((unit) => unit.plan?.objectives.map((o) => o.id) ?? []),
  );
  const answers = evidence.filter(
    (entry): entry is AnswerEvidence =>
      entry.kind === "answer" && objectives.has(entry.objective),
  );
  const disputes = disputesIn(evidence);
  const misses = countedAnswers(answers, evidence)
    .filter((entry) => entry.verdict !== "correct")
    .map((entry) => {
      const { question: q, answer } = entry;
      // The writer has no transcript to read the choice from.
      const chosen =
        q.kind === "choice" && answer.kind === "choice"
          ? q.choices[CHOICE_LETTERS.indexOf(answer.choice)]
          : undefined;
      return {
        ...wrongAnswer(entry, disputes.get(answer.questionId)?.outcome),
        ...(chosen === undefined ? {} : { chosen }),
      };
    });
  const slips = misconceptions
    .filter((entry) => objectives.has(entry.objective))
    .map(({ objective, believed, actually }) => ({
      objective,
      believed,
      actually,
    }));
  const count = picked.length === 1 ? "one unit" : `${picked.length} units`;
  return [
    `Write a cheat sheet on ${count} of the course in <course> in one HTML document of at most ${STANDALONE_HTML_LIMIT_BYTES.toLocaleString("en-US")} UTF-8 bytes, with at most ${MAX_FORMULAS} formulas and ${MAX_MATH_CHARS.toLocaleString("en-US")} characters of TeX in all.`,
    tagged("course", course.title),
    tagged("units", JSON.stringify(units, null, 2)),
    tagged("misses_and_corrections", JSON.stringify(misses, null, 2)),
    tagged("misconceptions", JSON.stringify(slips, null, 2)),
    tagged("instructions", instructions),
  ].join("\n\n");
}
