// The handoff writer (task 5.7; docs/decisions.md, "Mastery loop"). When a
// segment closes, by passing or by moving on, and when a unit finishes, a
// one-shot call with its own prompt (`prompts/handoff.md`) reads the unit's
// thread since the call before, with the note before, the unit's
// objectives and the misconceptions recorded on them, and replies with the unit's handoff note, whole, and the
// misconceptions that stretch shows. The note replaces the one before
// (`units/<unit-id>/handoff.md`), the misconceptions are appended to
// misconceptions.jsonl, and `handoff.json` marks how far the note reads, so
// the next call starts there. A call that fails records nothing, and the
// next one reads its stretch too.
//
// The calls run outside the chat's queue, as the help judge's do, one at a
// time for a unit: a close that comes while one runs is read by one more
// call after it. The stretch is read from the transcripts on disk, once the
// thread's events so far are written, so it is the same after a restart.

import type { StoredUnit } from "../../shared/curriculum.ts";
import type { PageEvent } from "../../shared/events.ts";
import type { EvidenceEntry } from "../../shared/evidence.ts";
import { type HandoffMark, HandoffReply } from "../../shared/handoff.ts";
import { isOpen, type Misconception } from "../../shared/misconception.ts";
import type { Plan } from "../../shared/plan.ts";
import {
  type AnswerSubmission,
  CHOICE_LETTERS,
  confidenceLabel,
  isConfident,
  type QuestionView,
} from "../../shared/question.ts";
import type { TutorBackend } from "../backends/backend.ts";
import { type Backup, noBackup } from "../record/backup.ts";
import type { DataRoot, Transcript } from "../record/data-root.ts";
import { objectiveStatus } from "../record/status.ts";
import { duration } from "./grading.ts";
import type { UnitContext } from "./unit-turns.ts";

/** How long a call may take before it is stopped and fails. */
export const HANDOFF_TIME_LIMIT_MS = 3 * 60_000;

/**
 * How much of a stretch the writer is given: a stretch that several failed
 * calls left to the next can be long, and then its start is left out.
 */
export const STRETCH_LIMIT = 150_000;

export type HandoffOutcome =
  | { ok: true; reply: HandoffReply }
  | { ok: false; error: string };

export interface HandoffWriter {
  /** Never throws: a failed request or a reply not in shape is a failure. */
  write(prompt: string, signal?: AbortSignal): Promise<HandoffOutcome>;
}

export function createHandoffWriter(options: {
  backend: TutorBackend;
  /** `prompts/handoff.md`. */
  systemPrompt: string;
  timeLimitMs?: number;
}): HandoffWriter {
  const timeLimitMs = options.timeLimitMs ?? HANDOFF_TIME_LIMIT_MS;
  return {
    async write(prompt, signal) {
      const limit = AbortSignal.timeout(timeLimitMs);
      const result = await options.backend.oneShot({
        systemPrompt: options.systemPrompt,
        prompt,
        schema: HandoffReply,
        signal: signal === undefined ? limit : AbortSignal.any([limit, signal]),
      });
      if (!result.ok) {
        return {
          ok: false,
          error: limit.aborted
            ? `The handoff writer took longer than ${duration(timeLimitMs)} and was stopped.`
            : result.error,
        };
      }
      return { ok: true, reply: result.value };
    },
  };
}

// --- The calls of one unit -------------------------------------------------

export interface Handoffs {
  /**
   * Asks for a call on the thread since the last note: at once, or, while
   * one runs, once more after it. Nothing once closed.
   */
  request(): void;
  /** Resolves once every call asked for so far has ended. */
  settled(): Promise<void>;
  /** Stops the call that runs, which records nothing, and asks for no more. */
  close(): Promise<void>;
}

export function createHandoffs(options: {
  writer: HandoffWriter;
  dataRoot: DataRoot;
  courseId: string;
  unitId: string;
  /** The unit and the curriculum as the chat has them now. */
  context: () => UnitContext;
  /** Resolves once the thread's events so far are in the transcripts. */
  flushed: () => Promise<void>;
  now: () => Date;
  backup?: Backup;
  /** Told what a call wrote, once it is written. */
  written?: (note: string, found: readonly Misconception[]) => void;
}): Handoffs {
  const { writer, dataRoot, courseId, unitId } = options;
  const backup = options.backup ?? noBackup;
  const stop = new AbortController();
  let current: Promise<void> | undefined;
  let again = false;
  let closed = false;

  async function once(): Promise<void> {
    await options.flushed();
    const [before, transcripts, evidence, misconceptions] = await Promise.all([
      dataRoot.readHandoff(courseId, unitId),
      dataRoot.readTranscripts(courseId, unitId),
      dataRoot.readEvidence(courseId),
      dataRoot.readMisconceptions(courseId),
    ]);
    const { events, through } = since(transcripts, before?.mark);
    if (through === undefined) return;
    const context = options.context();
    const stretch = readStretch(events, {
      plan: context.plan,
      objectiveOf: objectiveLookup(evidence),
    });
    // A close with nothing said or answered since the last note, such as
    // a unit that finishes as its last segment closes, has nothing to add.
    if (!stretch.worthReading) return;
    const objectives = objectivesFor(context, stretch);
    const given = new Set(objectives.map((o) => o.id));
    const outcome = await writer.write(
      handoffRequest({
        context,
        objectives,
        noteBefore: before?.note,
        recorded: misconceptions.filter((m) => given.has(m.objective)),
        stretch,
      }),
      stop.signal,
    );
    if (stop.signal.aborted) return;
    if (!outcome.ok) {
      console.error(
        `The handoff note of "${courseId}" unit "${unitId}" was not written: ${outcome.error}`,
      );
      return;
    }
    const writtenAt = options.now().toISOString();
    const { found, dropped } = foundIn(outcome.reply, {
      stretch,
      objectives: given,
      unitId,
      recordedAt: writtenAt,
    });
    for (const reason of dropped) {
      console.error(
        `A misconception the handoff writer named was left out: ${reason}`,
      );
    }
    // The misconceptions first: a crash before the note is written leaves
    // its mark where it was, so the next call reads the stretch again.
    await dataRoot.appendMisconceptions(courseId, found);
    await dataRoot.writeHandoff(courseId, unitId, outcome.reply.note, {
      writtenAt,
      through,
    });
    backup.commit(`${courseId}: handoff note of unit ${unitId}`);
    options.written?.(outcome.reply.note.trim(), found);
  }

  return {
    request() {
      if (closed) return;
      if (current !== undefined) {
        again = true;
        return;
      }
      current = (async () => {
        do {
          again = false;
          try {
            await once();
          } catch (error) {
            console.error(
              `The handoff note of "${courseId}" unit "${unitId}" could not be written:`,
              error,
            );
          }
        } while (again && !closed);
        current = undefined;
      })();
    },
    async settled() {
      while (current !== undefined) await current;
    },
    async close() {
      closed = true;
      stop.abort();
      await current;
    },
  };
}

/**
 * The thread's events after the mark, and the mark the end of them makes;
 * none without a transcript.
 */
export function since(
  transcripts: readonly Transcript[],
  mark: HandoffMark | undefined,
): { events: PageEvent[]; through: HandoffMark["through"] | undefined } {
  const last = transcripts.at(-1);
  if (last === undefined) return { events: [], through: undefined };
  const events = transcripts.flatMap((t) => {
    if (mark === undefined || t.session > mark.through.session) {
      return t.events;
    }
    return t.session === mark.through.session
      ? t.events.slice(mark.through.events)
      : [];
  });
  return {
    events,
    through: { session: last.session, events: last.events.length },
  };
}

/** The objective each recorded answer's question was on, by the question's id. */
function objectiveLookup(
  evidence: readonly EvidenceEntry[],
): (questionId: string) => string | undefined {
  const objectives = new Map<string, string>();
  for (const entry of evidence) {
    if (entry.kind === "answer") {
      objectives.set(entry.answer.questionId, entry.objective);
    }
  }
  return (id) => objectives.get(id);
}

// --- The stretch, as the writer reads it -----------------------------------

/** A detour in the stretch, by the number the stretch gives it. */
export interface StretchDetour {
  questionId: string;
  /** The missed question's number, as the thread showed it. */
  number: number;
  objective: string | undefined;
}

export interface Stretch {
  text: string;
  detours: ReadonlyMap<number, StretchDetour>;
  /** The objectives of the questions it shows answered or detoured on. */
  objectives: ReadonlySet<string>;
  /** It holds the tutor's text, a learner's message or an answer. */
  worthReading: boolean;
}

/**
 * The stretch written out for the writer: the tutor's text and the
 * learner's messages, each question with its answer, confidence and grade,
 * a confident wrong answer named as one, and the thread's markers (phases,
 * detours numbered in order, assessments, moving on, a fresh start, a new
 * sitting). What only the page needs (statuses, gradings under way) is
 * left out.
 */
export function readStretch(
  events: readonly PageEvent[],
  given: {
    plan: Plan;
    /** The objective of a question answered, by its id. */
    objectiveOf: (questionId: string) => string | undefined;
    /** Notes read the whole unit instead of keeping only a recent stretch. */
    whole?: boolean;
  },
): Stretch {
  const { plan, objectiveOf } = given;
  const parts: string[] = [];
  const views = new Map<string, QuestionView>();
  const detours = new Map<number, StretchDetour>();
  const objectives = new Set<string>();
  let worthReading = false;
  let text = "";
  let detour: number | undefined;
  let lastPhase: string | undefined;
  let run: string | undefined;

  const say = (part: string) => parts.push(part);
  const flush = () => {
    if (text.trim() !== "") say(`Tutor:\n${text.trim()}`);
    text = "";
  };
  const name = (questionId: string) => {
    const number = views.get(questionId)?.number;
    return number === undefined ? "an earlier question" : `question ${number}`;
  };
  const on = (objective: string | undefined) =>
    objective === undefined ? "" : `, on "${objective}"`;

  for (const event of events) {
    if (event.type === "tutor_text") {
      text += event.text;
      if (event.text.trim() !== "") worthReading = true;
      continue;
    }
    flush();
    switch (event.type) {
      case "session":
        say(`[A new sitting began, ${event.startedAt.slice(0, 10)}.]`);
        break;
      case "fresh_start":
        say(
          "[The tutor's conversation was replaced by a new one, which had not seen the conversation before it.]",
        );
        break;
      case "learner":
        worthReading = true;
        say(`Learner:\n${event.text.trim()}`);
        break;
      case "file_written":
        say(`[The tutor wrote the file "${event.path}".]`);
        break;
      case "artifact":
        say(`[The tutor showed an aid: "${event.title}".]`);
        break;
      case "question": {
        const q = event.question;
        if (views.has(q.id)) {
          say(`[Question ${q.number} is still open.]`);
          break;
        }
        views.set(q.id, q);
        const lines = [
          `[Question ${q.number}${on(objectiveOf(q.id))}, a ${q.kind} question:]`,
          q.prompt.trim(),
          ...(q.kind === "choice"
            ? q.choices.map((c, i) => `${CHOICE_LETTERS[i]}. ${c.trim()}`)
            : []),
          ...(q.kind === "code"
            ? [`The learner edits ${q.files.map((f) => `"${f}"`).join(", ")}.`]
            : []),
        ];
        say(lines.join("\n"));
        break;
      }
      case "graded": {
        worthReading = true;
        const objective = objectiveOf(event.questionId);
        if (objective !== undefined) objectives.add(objective);
        say(
          gradedText(
            event,
            views.get(event.questionId),
            name(event.questionId),
          ),
        );
        break;
      }
      case "question_withdrawn":
        say(`[${capital(name(event.questionId))} was withdrawn, unanswered.]`);
        break;
      case "disputed":
        say(
          `[The learner disputed the grade of ${name(event.questionId)}, and a judge decided it counts as ${event.dispute.outcome.verdict === "correct" ? "correct" : "wrong"}.]`,
        );
        break;
      case "detour": {
        const known = [...detours].find(
          ([, d]) => d.questionId === event.questionId,
        )?.[0];
        if (known !== undefined) {
          detour = known;
          say(`[Detour ${known} goes on.]`);
          break;
        }
        detour = detours.size + 1;
        const objective = objectiveOf(event.questionId);
        if (objective !== undefined) objectives.add(objective);
        detours.set(detour, {
          questionId: event.questionId,
          number: event.number,
          objective,
        });
        say(
          `[Detour ${detour} opens, after the miss on question ${event.number}${on(objective)}.]`,
        );
        break;
      }
      case "detour_end":
        if (detour !== undefined) {
          say(`[Detour ${detour} ends: the learner asked to go on.]`);
        }
        detour = undefined;
        break;
      case "phase": {
        const key = `${event.segment}:${event.phase}:${event.again?.join() ?? ""}`;
        if (key === lastPhase) break;
        lastPhase = key;
        if (event.phase === "closed") detour = undefined;
        say(`[${segmentName(plan, event)}: ${phaseWords[event.phase]}.]`);
        break;
      }
      case "assessment": {
        if (event.stage !== "on" || run === event.mode) break;
        run = event.mode;
        say(
          `[${capital(runWords[event.mode])} begins: questions without teaching, ${event.count === 1 ? "one objective" : `${event.count} objectives`}.]`,
        );
        break;
      }
      case "assessment_end":
        run = undefined;
        detour = undefined;
        say(
          `[${capital(runWords[event.mode])} ${event.skipped ? "was skipped by the learner" : "ends"}.]`,
        );
        break;
      case "test_answered":
        say(
          event.skipped.length === 0
            ? "[After the test, the learner chose to be taught the whole unit.]"
            : `[After the test, the learner chose to skip ${quotedList(event.skipped)}, which it passed.]`,
        );
        break;
      case "overridden":
        detour = undefined;
        say(
          `[The learner moved on without the check, leaving ${quotedList(event.objectives)} not passed.]`,
        );
        break;
      case "moved_on":
        say(
          `[At the unit's end, the learner moved on without passing ${quotedList(event.objectives)}.]`,
        );
        break;
      case "unit_closed":
        say("[The unit is finished.]");
        break;
      case "turn_end":
        if (event.outcome === "interrupted") {
          say("[The learner stopped the tutor's reply.]");
        }
        break;
      default:
        break;
    }
  }
  flush();
  return {
    text: given.whole ? parts.join("\n\n") : cut(parts),
    detours,
    objectives,
    worthReading,
  };
}

const phaseWords = {
  teach: "the teaching",
  discuss: "the discussion",
  check: "the check",
  closed: "closed",
} as const;

const runWords = {
  review: "a review",
  gate: "the unit's gate",
  "test-out": "the test before the unit",
} as const;

function segmentName(
  plan: Plan,
  event: Extract<PageEvent, { type: "phase" }>,
): string {
  if (event.again !== undefined) {
    return `The segment going over ${quotedList(event.again)} again`;
  }
  const title = plan.segments[event.segment]?.title;
  return `Segment ${event.segment + 1}${title === undefined ? "" : `, "${title}"`}`;
}

/** A graded answer as the writer reads it: the answer, how sure, and the grade. */
function gradedText(
  event: Extract<PageEvent, { type: "graded" }>,
  view: QuestionView | undefined,
  name: string,
): string {
  const { answer } = event;
  const lines = [
    `[The learner's answer to ${name}:]`,
    answerText(answer, view),
  ];
  if (answer.kind !== "unknown" && answer.reasoning?.trim()) {
    lines.push(`Their reasoning: ${answer.reasoning.trim()}`);
  }
  if (answer.kind === "unknown" && answer.stuck !== undefined) {
    lines.push(`Where they got stuck: ${answer.stuck.trim()}`);
  }
  const sure =
    answer.kind === "unknown"
      ? ""
      : `, at ${confidenceLabel(answer.confidence)} sure`;
  const help = event.assisted
    ? " It was given with help, so it does not count."
    : "";
  if (event.verdict === "correct") {
    lines.push(`Graded correct${sure}.${help}`);
  } else if (event.verdict === "unknown") {
    lines.push("Graded a miss.");
  } else {
    const confident =
      answer.kind !== "unknown" && isConfident(answer.confidence)
        ? ": a confident wrong answer"
        : "";
    lines.push(`Graded wrong${sure}${confident}.${help}`);
    if (event.correctChoice !== undefined) {
      const at = CHOICE_LETTERS.indexOf(event.correctChoice);
      const choice =
        view?.kind === "choice" ? view.choices[at]?.trim() : undefined;
      lines.push(
        `The right choice: ${event.correctChoice}${choice === undefined ? "" : `. ${choice}`}`,
      );
    }
    if (event.expected !== undefined) {
      lines.push(`The expected answer: ${event.expected}`);
    }
    if (event.flaw !== undefined) {
      lines.push(`The grader's note on its first flaw: ${event.flaw}`);
    }
    if (event.output !== undefined) {
      lines.push(`The end of the tests' output:\n${tail(event.output, 1500)}`);
    }
  }
  return lines.join("\n");
}

function answerText(
  answer: AnswerSubmission,
  view: QuestionView | undefined,
): string {
  switch (answer.kind) {
    case "choice": {
      const at = CHOICE_LETTERS.indexOf(answer.choice);
      const choice =
        view?.kind === "choice" ? view.choices[at]?.trim() : undefined;
      return `${answer.choice}${choice === undefined ? "" : `. ${choice}`}`;
    }
    case "math":
      return answer.expression;
    case "written":
      return answer.text.trim();
    case "code":
      return answer.files
        .map(
          (f) =>
            `The file "${f.path}" as they ran it:\n${tail(f.content, 3000)}`,
        )
        .join("\n");
    case "unknown":
      return "I don't know.";
  }
}

/** The parts joined, the earliest left out if they run over the limit. */
function cut(parts: readonly string[]): string {
  let total = 0;
  let from = parts.length;
  while (from > 0) {
    const next = total + (parts[from - 1]?.length ?? 0) + 2;
    if (next > STRETCH_LIMIT) break;
    total = next;
    from -= 1;
  }
  const kept = parts.slice(from);
  if (from > 0) {
    kept.unshift(
      "[The start of this stretch is left out: it was too long to read whole.]",
    );
  }
  return kept.join("\n\n");
}

/** The end of a text, at most `limit` characters. */
function tail(text: string, limit: number): string {
  return text.length <= limit ? text : `…${text.slice(-limit)}`;
}

function capital(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "a", or "a" and "b", or "a", "b" and "c", each quoted. */
function quotedList(ids: readonly string[]): string {
  const items = ids.map((id) => `"${id}"`);
  return items.length <= 1
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

// --- The request -----------------------------------------------------------

/** An objective the writer is given, with the unit it belongs to. */
export interface GivenObjective {
  id: string;
  statement: string;
  /** Set when it is another unit's: that unit's number and title. */
  of?: { number: number; title: string };
}

/**
 * The unit's objectives, then those of other units that the stretch's
 * questions were on, as a review's or a gate's can be.
 */
export function objectivesFor(
  context: UnitContext,
  stretch: Stretch,
): GivenObjective[] {
  const own: GivenObjective[] = context.plan.objectives.map((o) => ({
    id: o.id,
    statement: o.statement,
  }));
  const others = [...stretch.objectives].flatMap((id): GivenObjective[] => {
    if (own.some((o) => o.id === id)) return [];
    const at = context.units.findIndex((u) =>
      u.plan?.objectives.some((o) => o.id === id),
    );
    const unit = context.units[at];
    const statement = unit?.plan?.objectives.find(
      (o) => o.id === id,
    )?.statement;
    if (unit === undefined || statement === undefined) return [];
    return [{ id, statement, of: { number: at + 1, title: unit.title } }];
  });
  return [...own, ...others];
}

/**
 * The writer's request: the unit, its objectives, the note before, the
 * misconceptions recorded on those objectives already, so that one shown
 * again is not recorded twice, and the stretch, each between tags, so that
 * what the learner or the tutor wrote stays part of what is read.
 */
export function handoffRequest(input: {
  context: UnitContext;
  objectives: readonly GivenObjective[];
  noteBefore: string | undefined;
  /** The misconceptions recorded on the objectives given, oldest first. */
  recorded: readonly Misconception[];
  stretch: Stretch;
}): string {
  const { context, objectives, noteBefore, recorded, stretch } = input;
  const at = context.units.findIndex((u) => u.id === context.unitId);
  const unit = context.units[at];
  return [
    `Write the handoff note of unit ${at + 1} of the course ` +
      `"${context.courseTitle}", and list the misconceptions the stretch ` +
      "below shows.",
    "",
    "<unit>",
    `Unit ${at + 1} of ${context.units.length}, "${unit?.title}". Its goal: ${unit?.goal}`,
    "</unit>",
    "",
    "<objectives>",
    ...objectives.map((o) =>
      o.of === undefined
        ? `- "${o.id}": ${o.statement}`
        : `- "${o.id}", an objective of unit ${o.of.number}, "${o.of.title}": ${o.statement}`,
    ),
    "</objectives>",
    "",
    ...(noteBefore === undefined
      ? ["The unit has no note yet: this is its first."]
      : ["<note_before>", noteBefore.trim(), "</note_before>"]),
    "",
    ...(recorded.length === 0
      ? ["No misconception is recorded on these objectives yet."]
      : [
          "<recorded_misconceptions>",
          ...recorded.map(
            (m) =>
              `- On "${m.objective}": believed "${oneLine(m.believed)}"; what is so: "${oneLine(m.actually)}"`,
          ),
          "</recorded_misconceptions>",
        ]),
    "",
    "<stretch>",
    stretch.text,
    "</stretch>",
  ].join("\n");
}

/**
 * The misconceptions of the reply as the record keeps them. One that names
 * an objective not given, or a detour the stretch does not have, is left
 * out, with why.
 */
export function foundIn(
  reply: HandoffReply,
  given: {
    stretch: Stretch;
    objectives: ReadonlySet<string>;
    unitId: string;
    recordedAt: string;
  },
): { found: Misconception[]; dropped: string[] } {
  const found: Misconception[] = [];
  const dropped: string[] = [];
  for (const m of reply.misconceptions) {
    if (!given.objectives.has(m.objective)) {
      dropped.push(
        `it names "${m.objective}", which is no objective it was given.`,
      );
      continue;
    }
    const detour =
      m.detour === undefined ? undefined : given.stretch.detours.get(m.detour);
    if (m.detour !== undefined && detour === undefined) {
      dropped.push(
        `it names detour ${m.detour}, which the stretch does not have.`,
      );
      continue;
    }
    found.push({
      recordedAt: given.recordedAt,
      unit: given.unitId,
      objective: m.objective,
      believed: m.believed,
      actually: m.actually,
      where:
        detour === undefined
          ? { in: "discussion" }
          : {
              in: "detour",
              questionId: detour.questionId,
              number: detour.number,
            },
    });
  }
  return { found, dropped };
}

// --- What other prompts read -----------------------------------------------

/** A misconception as a prompt names it, with the objective it bears on. */
export interface NamedMisconception {
  objective: string;
  statement: string | undefined;
  /** The objective's unit, by its number and title. */
  of: { number: number; title: string } | undefined;
  believed: string;
  actually: string;
  open: boolean;
}

/** What earlier units showed, for a unit's tutor and for its planning (task 5.7). */
export interface EarlierUnits {
  /** The last handoff notes of the unit's prerequisites, in the curriculum's order. */
  notes: readonly { number: number; title: string; note: string }[];
  /** The open misconceptions on other units' objectives, oldest first. */
  misconceptions: readonly NamedMisconception[];
}

/**
 * The last handoff notes of the unit's prerequisites, and the open
 * misconceptions on other units' objectives, as the record has them now.
 */
export async function readEarlier(
  dataRoot: DataRoot,
  courseId: string,
  units: readonly StoredUnit[],
  unitId: string,
  evidence: readonly EvidenceEntry[],
  misconceptions: readonly Misconception[],
): Promise<EarlierUnits> {
  const unit = units.find((u) => u.id === unitId);
  const prerequisites = units.flatMap((u, i) =>
    unit?.prerequisites.includes(u.id) === true ? [{ u, number: i + 1 }] : [],
  );
  const notes = (
    await Promise.all(
      prerequisites.map(async ({ u, number }) => {
        const stored = await dataRoot.readHandoff(courseId, u.id);
        return stored === undefined
          ? []
          : [{ number, title: u.title, note: stored.note }];
      }),
    )
  ).flat();
  const own = new Set(unit?.plan?.objectives.map((o) => o.id) ?? []);
  return {
    notes,
    misconceptions: named(
      misconceptions.filter((m) => !own.has(m.objective)),
      units,
      evidence,
    ).filter((m) => m.open),
  };
}

/** Misconceptions with their objectives' statements and units, and whether each is open. */
export function named(
  misconceptions: readonly Misconception[],
  units: readonly StoredUnit[],
  evidence: readonly EvidenceEntry[],
): NamedMisconception[] {
  return misconceptions.map((m) => {
    const at = units.findIndex((u) =>
      u.plan?.objectives.some((o) => o.id === m.objective),
    );
    const unit = units[at];
    return {
      objective: m.objective,
      statement: unit?.plan?.objectives.find((o) => o.id === m.objective)
        ?.statement,
      of:
        unit === undefined ? undefined : { number: at + 1, title: unit.title },
      believed: m.believed,
      actually: m.actually,
      open: isOpen(objectiveStatus(evidence, m.objective)),
    };
  });
}

/** A misconception on one line, for a prompt. */
export function misconceptionLine(
  m: NamedMisconception,
  options: { unit?: boolean; open?: boolean } = {},
): string {
  const of =
    options.unit === true && m.of !== undefined
      ? `, an objective of unit ${m.of.number}, "${m.of.title}"`
      : "";
  const state =
    options.open === true ? (m.open ? " Still open." : " Cleared since.") : "";
  return (
    `- On "${m.objective}"${of}: the learner believed "${oneLine(m.believed)}"; ` +
    `what is so: "${oneLine(m.actually)}".${state}`
  );
}

/**
 * The section the tutor's system prompt and the unit's planning get, or
 * none when no earlier unit has a note or an open misconception.
 */
export function earlierText(earlier: EarlierUnits): string | undefined {
  const { notes, misconceptions } = earlier;
  if (notes.length === 0 && misconceptions.length === 0) return undefined;
  return [
    ...(notes.length === 0
      ? []
      : [
          "The handoff notes of this unit's prerequisites, as their tutors' conversations left them:",
          "",
          ...notes.flatMap((n) => [
            `## Unit ${n.number}, "${n.title}"`,
            "",
            n.note.trim(),
            "",
          ]),
        ]),
    ...(misconceptions.length === 0
      ? []
      : [
          "Misconceptions found in other units and not yet cleared, each on an objective the learner has not passed:",
          "",
          ...misconceptions.map((m) => misconceptionLine(m, { unit: true })),
        ]),
  ]
    .join("\n")
    .trimEnd();
}

/** Text on one line. */
function oneLine(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}
