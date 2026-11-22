import type { StoredUnit } from "../../shared/curriculum.ts";
import type { DisputeOutcome } from "../../shared/dispute.ts";
import type { PageEvent } from "../../shared/events.ts";
import type { AnswerEvidence } from "../../shared/evidence.ts";
import {
  type NotesAttempt,
  NotesReply,
  type NotesView,
} from "../../shared/notes.ts";
import { CHOICE_LETTERS } from "../../shared/question.ts";
import { isFinished } from "../../shared/status.ts";
import type { TutorBackend } from "../backends/backend.ts";
import { type Backup, noBackup } from "../record/backup.ts";
import type { DataRoot } from "../record/data-root.ts";
import { countedAnswers, disputesIn } from "../record/disputes.ts";
import { unitStatus } from "../record/status.ts";
import type { CourseHolder } from "./course-deletion.ts";
import { readStretch } from "./handoff.ts";
import {
  finishStandaloneHtml,
  STANDALONE_HTML_LIMIT_BYTES,
} from "./standalone-html.ts";

const WRITE_LIMIT_MS = 3 * 60_000;
type Unit = { courseTitle: string; unit: StoredUnit };
type Result =
  | { ok: true; view: NotesView }
  | { ok: false; status: 404 | 409; error: string };

type NotesOptions = {
  dataRoot: DataRoot;
  backend: TutorBackend;
  systemPrompt: string;
  /** Wait for an open chat's transcript and handoff, without sending it a turn. */
  ready: (courseId: string, unitId: string) => Promise<void> | undefined;
  backup?: Backup;
  now?: () => Date;
};

export interface Notes extends CourseHolder {
  view(courseId: string, unitId: string): Promise<Result>;
  start(
    courseId: string,
    unitId: string,
    instructions: string,
    expectedRevision: string | undefined,
  ): Promise<Result>;
  close(): Promise<void>;
}
/** One explicit write at a time per unit. The request outlives the page that started it. */
export function createNotes(options: NotesOptions): Notes {
  const { dataRoot, backend, systemPrompt, ready } = options;
  const backup = options.backup ?? noBackup;
  const now = options.now ?? (() => new Date());
  const attempts = new Map<string, NotesAttempt>();
  const starting = new Set<string>();
  const jobs = new Set<Promise<void>>();
  const stop = new AbortController();
  const missing = { ok: false, status: 404, error: "No such unit." } as const;
  const busy = {
    ok: false,
    status: 409,
    error: "A write cannot start now.",
  } as const;

  async function locate(
    courseId: string,
    unitId: string,
  ): Promise<Unit | undefined> {
    const stored = await dataRoot.readCourse(courseId);
    if (stored?.curriculum?.approval.status !== "approved") return undefined;
    const unit = stored.curriculum.units.find((unit) => unit.id === unitId);
    return unit === undefined
      ? undefined
      : { courseTitle: stored.course.title, unit };
  }

  async function view(
    courseId: string,
    { courseTitle, unit }: Unit,
    attempt: NotesAttempt | undefined,
  ): Promise<NotesView> {
    const saved = await dataRoot.readNotes(courseId, unit.id);
    return {
      courseTitle,
      unitTitle: unit.title,
      ...(saved === undefined ? {} : { saved }),
      ...(attempt === undefined ? {} : { attempt }),
    };
  }

  async function write(
    courseId: string,
    unit: Unit,
    instructions: string,
  ): Promise<void> {
    const { id } = unit.unit;
    await ready(courseId, id);
    if (stop.signal.aborted) return;
    const prompt = await request(dataRoot, courseId, unit, instructions);
    const limit = AbortSignal.timeout(WRITE_LIMIT_MS);
    const reply = await backend.oneShot({
      systemPrompt,
      prompt,
      schema: NotesReply,
      signal: AbortSignal.any([stop.signal, limit]),
    });
    if (stop.signal.aborted) return;
    if (!reply.ok) {
      throw new Error(
        limit.aborted
          ? "The notes writer took longer than three minutes."
          : reply.error,
      );
    }
    const html = finishStandaloneHtml(reply.value.html);
    // The previous write already requested a snapshot. Do not replace it
    // until that snapshot has been taken, even if the learner rewrites at once.
    await backup.settled();
    if (stop.signal.aborted) return;
    await dataRoot.writeNotes(courseId, id, html, {
      html: reply.value.html,
      instructions,
      writtenAt: now().toISOString(),
    });
    backup.commit(`${courseId}: notes of unit ${id}`);
  }

  return {
    async view(courseId: string, unitId: string): Promise<Result> {
      const unit = await locate(courseId, unitId);
      if (unit === undefined) return missing;
      return {
        ok: true,
        view: await view(courseId, unit, attempts.get(`${courseId}/${unitId}`)),
      };
    },
    async start(
      courseId: string,
      unitId: string,
      instructions: string,
      expectedRevision: string | undefined,
    ): Promise<Result> {
      const unit = await locate(courseId, unitId);
      if (unit === undefined) return missing;
      const [state, evidence] = await Promise.all([
        dataRoot.readState(courseId),
        dataRoot.readEvidence(courseId),
      ]);
      const position = Object.hasOwn(state.units, unitId)
        ? state.units[unitId]
        : undefined;
      if (!isFinished(unitStatus(unit.unit, evidence, position))) {
        return {
          ok: false,
          status: 409,
          error: "Finish this unit before writing its notes.",
        };
      }
      const key = `${courseId}/${unitId}`;
      if (
        starting.has(key) ||
        attempts.get(key)?.state === "writing" ||
        stop.signal.aborted
      ) {
        return busy;
      }
      // Reserve the unit before reading its current revision. A concurrent
      // request must not publish between that check and claiming the job.
      starting.add(key);
      try {
        const previous = await view(courseId, unit, undefined);
        if (stop.signal.aborted) return busy;
        if (previous.saved?.revision !== expectedRevision) {
          return {
            ok: false,
            status: 409,
            error: "The saved notes changed. Review them before writing again.",
          };
        }
        const attempt = { state: "writing", instructions } as const;
        attempts.set(key, attempt);
        const job = write(courseId, unit, instructions)
          .then(() => void attempts.delete(key))
          .catch((error: unknown) => {
            attempts.set(key, {
              state: "failed",
              instructions,
              error: error instanceof Error ? error.message : String(error),
            });
          })
          .finally(() => void jobs.delete(job));
        jobs.add(job);
        return { ok: true, view: { ...previous, attempt } };
      } finally {
        starting.delete(key);
      }
    },
    inUse(courseId) {
      // Keys are `<course>/<unit>`, and a course id has no slash.
      const prefix = `${courseId}/`;
      const busy = [
        ...starting,
        ...[...attempts]
          .filter(([, attempt]) => attempt.state === "writing")
          .map(([key]) => key),
      ].find((key) => key.startsWith(prefix));
      return busy === undefined
        ? undefined
        : { doing: "notes", unit: busy.slice(prefix.length) };
    },
    async forget(courseId) {
      // Only failed attempts are left: one writing holds the course.
      for (const key of [...attempts.keys()]) {
        if (key.startsWith(`${courseId}/`)) attempts.delete(key);
      }
    },
    async close() {
      stop.abort();
      await Promise.all(jobs);
    },
  };
}

async function request(
  dataRoot: DataRoot,
  courseId: string,
  { courseTitle, unit }: Unit,
  instructions: string,
): Promise<string> {
  const plan = unit.plan;

  if (plan === undefined) throw new Error("The unit has no plan.");
  const [transcripts, evidence, handoff, misconceptions, state] =
    await Promise.all([
      dataRoot.readTranscripts(courseId, unit.id),
      dataRoot.readEvidence(courseId),
      dataRoot.readHandoff(courseId, unit.id),
      dataRoot.readMisconceptions(courseId),
      dataRoot.readState(courseId),
    ]);
  const own = new Set(plan.objectives.map((objective) => objective.id));
  const events = transcripts.flatMap((session) => session.events);
  const askedHere = new Set(
    events.flatMap((event) =>
      event.type === "question" ? [event.question.id] : [],
    ),
  );
  const answers = evidence.filter(
    (entry): entry is AnswerEvidence =>
      entry.kind === "answer" &&
      own.has(entry.objective) &&
      (askedHere.has(entry.answer.questionId) ||
        entry.assessment?.unit === unit.id),
  );
  const byId = new Map(
    answers.map((entry) => [entry.answer.questionId, entry]),
  );
  const disputes = disputesIn(evidence);
  const stretch = readStretch(unitEvents(events, byId), {
    plan,
    answers: byId,
    whole: true,
  });
  const misses = countedAnswers(answers, evidence)
    .filter((entry) => entry.verdict !== "correct")
    .map((entry) =>
      wrongAnswer(entry, disputes.get(entry.answer.questionId)?.outcome),
    );
  const localMisconceptions = misconceptions
    .filter((entry) => entry.unit === unit.id && own.has(entry.objective))
    .map(({ objective, believed, actually }) => ({
      objective,
      believed,
      actually,
    }));
  const testedOut = Object.hasOwn(state.testedOut ?? {}, unit.id);
  return [
    `Write this unit's notes in one HTML document of at most ${STANDALONE_HTML_LIMIT_BYTES.toLocaleString("en-US")} UTF-8 bytes.`,
    tagged(
      "unit",
      JSON.stringify(
        { courseTitle, title: unit.title, goal: unit.goal, testedOut, plan },
        null,
        2,
      ),
    ),
    tagged(
      "transcripts",
      stretch.text ||
        "No teaching, discussion or answers were saved in the transcript.",
    ),
    tagged("misses_and_corrections", JSON.stringify(misses, null, 2)),
    tagged("handoff", handoff?.note ?? "No handoff note was saved."),
    tagged("misconceptions", JSON.stringify(localMisconceptions, null, 2)),
    tagged("instructions", instructions),
  ].join("\n\n");
}

function tagged(name: string, content: string): string {
  return `<${name}>\n${content.replaceAll("&", "&amp;").replaceAll("<", "&lt;")}\n</${name}>`;
}

/** Omit other units' assessment questions, feedback and detours from this unit's notes. */
function unitEvents(
  events: readonly PageEvent[],
  answers: ReadonlyMap<string, AnswerEvidence>,
): PageEvent[] {
  const kept: PageEvent[] = [];
  const foreignQuestions = new Set<string>();
  let foreign = false;
  let turnFrom = 0;
  for (const event of events) {
    switch (event.type) {
      case "turn_start":
        turnFrom = kept.length;
        break;
      case "question":
        foreign = event.question.assessment?.from !== undefined;
        if (foreign) {
          foreignQuestions.add(event.question.id);
          // The tutor can introduce the next question before posting it.
          kept.splice(turnFrom, kept.length - turnFrom);
          continue;
        }
        if (!answers.has(event.question.id)) continue;
        break;
      case "detour":
        // Reopening a unit replays its phase and assessment, then its detour,
        // without reposting the question that opened the detour.
        foreign = foreignQuestions.has(event.questionId);
        if (foreign || !answers.has(event.questionId)) continue;
        break;
      case "graded":
      case "question_withdrawn":
      case "disputed":
        if (!answers.has(event.questionId)) continue;
        break;
      case "assessment":
      case "assessment_end":
      case "phase":
        foreign = false;
        turnFrom = kept.length;
        break;
      case "learner":
      case "tutor_text":
      case "file_written":
      case "section_read":
      case "page_viewed":
      case "artifact":
      case "detour_end":
        if (foreign) continue;
        break;
    }
    kept.push(event);
  }
  return kept;
}

function wrongAnswer(
  entry: AnswerEvidence,
  outcome: DisputeOutcome | undefined,
) {
  const q = entry.question;
  const correction =
    q.kind === "choice"
      ? q.choices[CHOICE_LETTERS.indexOf(outcome?.key ?? q.answer)]
      : q.kind === "math"
        ? (outcome?.expected ?? q.expected)
        : q.kind === "written"
          ? q.rubric
          : q.solution;
  return {
    objective: entry.objective,
    question: q.prompt,
    answer: entry.answer,
    correction,
    ...(outcome === undefined ? {} : { ruling: outcome.reason }),
  };
}
