// The thread as the page shows it, rebuilt from the chat's event log. Pure, so
// a replay after a reload or a reconnect gives the same thread. A unit chat's
// log starts with the unit's earlier sessions (task 2.13), and its own
// opening repeats where the unit stands: a phase, an open question or a
// closing card the thread already shows is not shown twice. When the tutor's
// conversation is replaced by a new one (task 2.14), a marker says so, and
// the thread before it is shown as earlier conversations.

import type { Slug } from "../shared/course.ts";
import type { Unit } from "../shared/curriculum.ts";
import type { ShownDispute } from "../shared/dispute.ts";
import type { PageEvent } from "../shared/events.ts";
import type { AssessmentMode } from "../shared/evidence.ts";
import type { PackageSpec, PackagesOutcome } from "../shared/packages.ts";
import type { Plan } from "../shared/plan.ts";
import type {
  AnswerSubmission,
  GradedAnswer,
  QuestionView,
} from "../shared/question.ts";
import type { Phase } from "../shared/state.ts";
import type { ObjectiveStatus } from "../shared/status.ts";
import { changedUnits } from "./units.ts";

export type Graded = Extract<PageEvent, { type: "graded" }>;

/** A posted question, and what has happened to it since. */
export interface QuestionItem {
  kind: "question";
  key: number;
  question: QuestionView;
  /**
   * An answer sent while the tutor's replies during the question were still
   * to be judged, kept until they are (task 2.21).
   */
  waiting?: AnswerSubmission;
  /** A written or math answer sent and kept until it is graded (tasks 2.8, 3.5). */
  grading?: GradedAnswer;
  /** Why the last grading of the kept answer failed. */
  gradingFailed?: string;
  /** A code grading failed without determining a verdict. */
  canMoveOn?: true;
  graded?: Graded;
  /** The dispute of its grade, with the outcome the answer now counts with (task 3.8). */
  dispute?: ShownDispute;
  /** The learner moved on without the check while it was open. */
  withdrawn?: boolean;
  /**
   * The thread went on below it before it was answered, so it is shown where
   * it was answered, and a line stands where it was posted (task 2.18).
   */
  moved?: boolean;
}

/** Where a unit chat is: the phase of a segment that began last. */
export interface Position {
  segment: number;
  phase: Phase;
  /** For a segment after the plan's last: the objectives it goes over again. */
  again?: string[];
}

/** The closing card at a unit's end (task 2.1, piece 10; after the gate, piece 16). */
export interface UnitEndItem {
  kind: "unit_end";
  key: number;
  /** Every objective passed. */
  passed: boolean;
  objectives: Record<string, ObjectiveStatus>;
  /**
   * Set on the card after the unit's gate: what its steps cover, and the
   * other units' objectives the gate asked.
   */
  gate?: Extract<PageEvent, { type: "unit_end" }>["gate"];
  /** The step taken from a card that offers its steps, once taken. */
  stepTaken?: "again" | "moved-on";
}

/**
 * The judge's call on the tutor's reply to a message sent while a question
 * was open (task 2.21), under the reply: being judged until `verdict` is set.
 */
export interface JudgmentItem {
  kind: "judgment";
  key: number;
  /** The learner's message, by its id. */
  learnerId: string;
  /** The question that was open. */
  number: number;
  verdict?: "clarification" | "help";
  /** Counted as help without a call: it failed, or the server stopped first. */
  unjudged?: "failed" | "restart";
}

/**
 * An assessment's card, with Start and Skip, which becomes its marker once
 * started or skipped (piece 15).
 */
export interface AssessmentItem {
  kind: "assessment";
  key: number;
  mode: AssessmentMode;
  /** How many objectives it asks about. */
  count: number;
  /** For a gate: how many are the unit's own, and the numbers of the units the rest come from. */
  own?: number;
  from?: number[];
  /** "offered": the card waits; "on": started; "skipped": skipped on the card. */
  stage: "offered" | "on" | "skipped";
}

/** The marker an assessment leaves once it ends, or is skipped partway (piece 15). */
export interface AssessmentEndItem {
  kind: "assessment_end";
  key: number;
  mode: AssessmentMode;
  skipped: boolean;
  /** The objectives it recorded an answer on, with their statuses then. */
  statuses: Record<string, ObjectiveStatus>;
  /** Where the unit goes on: the phase the thread was in. */
  at: Position | null;
}

/** An artifact the tutor showed, by its file in the course's artifacts/ (task 3.6, piece 5). */
export interface ArtifactItem {
  kind: "artifact";
  key: number;
  file: string;
  title: string;
}

/** The tutor's request to install packages (task 3.11, piece 14), and its answer. */
export interface PackagesItem {
  kind: "packages";
  key: number;
  requestId: string;
  packages: PackageSpec[];
  /** The commands Install runs, each its words. */
  commands: string[][];
  /** The workspace the commands run in. */
  folder: string;
  /** Only the current chat can make approval or saving available. */
  status?: "historical" | "installing" | "save-failed";
  outcome?: PackagesOutcome;
  /** The end of the install's output. */
  output?: string;
}

export type Item =
  | { kind: "learner"; key: number; id?: string; text: string }
  | { kind: "tutor"; key: number; text: string }
  /** A file the tutor wrote, by its path in the workspace (task 3.3, piece 14). */
  | { kind: "file"; key: number; path: string }
  | ArtifactItem
  | PackagesItem
  | QuestionItem
  | JudgmentItem
  /** A phase of a segment began, or the chat opened in it. */
  | ({ kind: "phase"; key: number } & Position)
  | UnitEndItem
  | AssessmentItem
  | AssessmentEndItem
  /** Where a question was posted that was answered further down (task 2.18). */
  | { kind: "answered-below"; key: number; number: number }
  /** A detour began after the miss on this question (task 2.20). */
  | { kind: "detour"; key: number; questionId: string; number: number }
  /** A unit's session, a sitting, began after an earlier one (task 2.13). */
  | {
      kind: "session";
      key: number;
      startedAt: string;
      /** The session before ended while the tutor was writing: a restart cut it off. */
      cutOff: boolean;
    }
  /**
   * The tutor's conversation was replaced by a new one (task 2.14), which
   * has the learner's progress and not the conversation above.
   */
  | {
      kind: "fresh";
      key: number;
      reason: "learner" | "not-resumed";
      learnerId?: string;
    }
  | {
      kind: "proposal";
      key: number;
      revision: number;
      courseId: Slug;
      title: string;
      units: Unit[];
      /** The ids of the units this revision changed; none in the first. */
      changed: Set<string>;
      /** How the tutor would teach the course; a draft from before task 2.10 has none. */
      style: string | undefined;
      /** The style note differs from the revision before's. */
      styleChanged: boolean;
      /** What the learner told the planner; a draft from before task 2.22 has none. */
      background: string | undefined;
      /** The background note differs from the revision before's. */
      backgroundChanged: boolean;
    }
  | { kind: "note"; key: number; text: string };

export interface Timeline {
  chatId: string | null;
  /** The index of the last event applied, or -1. */
  last: number;
  /** Last event in the log when the page asked to open it, or -1. */
  openedThrough: number;
  /**
   * The newest live artifact shown after the page opened. Older and restored
   * artifacts are only referred to.
   */
  shown: ArtifactItem | null;
  items: Item[];
  /** The tutor is writing. */
  busy: boolean;
  /** The tutor's next text continues the last item. */
  tutorOpen: boolean;
  /** The newest proposal's revision, the only one that can be approved; 0 if none. */
  latestRevision: number;
  approved: { courseId: Slug; revision: number } | null;
  /** The intake started from a stored draft, its conversation lost. */
  reopened: boolean;
  // A unit chat's own (tasks 2.6 to 2.8):
  /** A session has begun: the unit's thread was read, and what follows is in it. */
  inSession: boolean;
  /** The unit's plan, once it is known. */
  plan: Plan | null;
  /** The unit has no plan yet and is being planned. */
  planning: boolean;
  /** Why the unit could not be opened; opening it again tries again. */
  failed: string | null;
  /** The phase that began last; null until the unit is open, and when it opens finished. */
  position: Position | null;
  /** The detour open in the check or an assessment, after the miss on this question (task 2.20). */
  detour: { questionId: string; number: number } | null;
  /** An assessment offered or under way: the unit's own steps wait for it. */
  assessment: {
    mode: AssessmentMode;
    stage: "offered" | "on";
    count: number;
  } | null;
  /** The unit is finished, and how. */
  finished: "passed" | "overridden" | null;
}

export const emptyTimeline: Timeline = {
  chatId: null,
  last: -1,
  openedThrough: -1,
  shown: null,
  items: [],
  busy: false,
  tutorOpen: false,
  latestRevision: 0,
  approved: null,
  reopened: false,
  inSession: false,
  plan: null,
  planning: false,
  failed: null,
  position: null,
  detour: null,
  assessment: null,
  finished: null,
};

/** Changes the package request with this id, and leaves every other item as it is. */
function withRequest(
  items: Item[],
  id: string,
  change: (item: PackagesItem) => PackagesItem,
): Item[] {
  return items.map((item) =>
    item.kind === "packages" && item.requestId === id ? change(item) : item,
  );
}

/** Changes the question with this id, and leaves every other item as it is. */
function withQuestion(
  items: Item[],
  id: string,
  change: (item: QuestionItem) => QuestionItem,
): Item[] {
  return items.map((item) =>
    item.kind === "question" && item.question.id === id ? change(item) : item,
  );
}

/**
 * A closing card is in the thread with no phase begun since, and no gate
 * offered: a `unit_end` now is that card shown again, by a chat that opened
 * at it.
 */
function cardStanding(items: Item[]): boolean {
  const card = items.findLastIndex((i) => i.kind === "unit_end");
  return (
    card >= 0 &&
    items.findLastIndex(
      (i) =>
        i.kind === "phase" ||
        i.kind === "assessment" ||
        i.kind === "assessment_end",
    ) < card
  );
}

/**
 * The closing card standing at the end of the thread, the one whose steps
 * can be taken: none once a phase has begun or an assessment been offered
 * after it.
 */
export function standingCard(items: Item[]): UnitEndItem | undefined {
  if (!cardStanding(items)) return undefined;
  const card = items.findLast((i) => i.kind === "unit_end");
  return card?.kind === "unit_end" ? card : undefined;
}

/** Whether the closing card offers its two steps: going over again, or moving on. */
export function offersSteps(
  card: Pick<UnitEndItem, "passed" | "gate">,
): boolean {
  return card.gate === undefined ? !card.passed : card.gate.goOver.length > 0;
}

/** Records the step taken from the last closing card, if it offers its steps and none was taken yet. */
function stepFromCard(items: Item[], stepTaken: "again" | "moved-on"): Item[] {
  const at = items.findLastIndex((i) => i.kind === "unit_end");
  const card = items[at];
  if (
    card?.kind !== "unit_end" ||
    !offersSteps(card) ||
    card.stepTaken !== undefined
  ) {
    return items;
  }
  return items.with(at, { ...card, stepTaken });
}

export type TimelineAction =
  /**
   * A new chat id means the server restarted. For a unit, `last` is the
   * last event the chat already had when the page asked to open the unit.
   */
  | { type: "hello"; chatId: string; last?: number }
  | { type: "event"; index: number; event: PageEvent };

export function reduce(state: Timeline, action: TimelineAction): Timeline {
  if (action.type === "hello") {
    const { chatId, last } = action;
    if (chatId !== state.chatId) {
      return { ...emptyTimeline, chatId, openedThrough: last ?? -1 };
    }
    return last === undefined || last === state.openedThrough
      ? state
      : { ...state, openedThrough: last };
  }
  const { index, event } = action;
  if (index <= state.last) return state;
  const next: Timeline = { ...state, last: index };
  switch (event.type) {
    case "session": {
      // What was under way when the session before ended is over.
      const settled: Timeline = {
        ...next,
        inSession: true,
        busy: false,
        tutorOpen: false,
        planning: false,
        failed: null,
      };
      // Before the first session the thread could not be read, and the note
      // that said so stood where the thread begins. Opening the unit again
      // read it, so the note gives way to the thread.
      if (!state.inSession) return { ...settled, items: [] };
      const last = state.items.at(-1);
      // The first session needs no marker.
      if (last === undefined) return settled;
      const item: Item = {
        kind: "session",
        key: index,
        startedAt: event.startedAt,
        cutOff: state.busy || (last.kind === "session" && last.cutOff),
      };
      return {
        ...settled,
        // A session that showed nothing gives way to this one.
        items:
          last.kind === "session"
            ? state.items.with(-1, item)
            : [...state.items, item],
      };
    }
    case "fresh_start":
      return {
        ...next,
        items: [
          ...state.items,
          {
            kind: "fresh",
            key: index,
            reason: event.reason,
            ...(event.learnerId === undefined
              ? {}
              : { learnerId: event.learnerId }),
          },
        ],
        tutorOpen: false,
      };
    case "learner":
      return {
        ...next,
        items: [
          ...state.items,
          {
            kind: "learner",
            key: index,
            text: event.text,
            ...(event.id === undefined ? {} : { id: event.id }),
          },
        ],
        tutorOpen: false,
      };
    case "turn_start":
      return { ...next, busy: true, tutorOpen: false };
    case "tutor_text": {
      const lastItem = state.items.at(-1);
      if (state.tutorOpen && lastItem?.kind === "tutor") {
        return {
          ...next,
          items: [
            ...state.items.slice(0, -1),
            { ...lastItem, text: lastItem.text + event.text },
          ],
        };
      }
      return {
        ...next,
        items: [
          ...state.items,
          { kind: "tutor", key: index, text: event.text },
        ],
        tutorOpen: true,
      };
    }
    case "file_written":
      // The tutor's text after it goes below it.
      return {
        ...next,
        items: [...state.items, { kind: "file", key: index, path: event.path }],
        tutorOpen: false,
      };
    case "artifact": {
      // The tutor's text after it goes below it.
      const item: ArtifactItem = {
        kind: "artifact",
        key: index,
        file: event.file,
        title: event.title,
      };
      return {
        ...next,
        items: [...state.items, item],
        tutorOpen: false,
        shown:
          !event.historical && index > state.openedThrough ? item : state.shown,
      };
    }
    case "packages_requested":
      // The reopened unit supplies the current plan for the same request.
      // Keep the card where it was. Only the live notice permits approval.
      if (
        state.items.some(
          (i) => i.kind === "packages" && i.requestId === event.requestId,
        )
      ) {
        return {
          ...next,
          items: withRequest(
            state.items,
            event.requestId,
            ({ status: _, ...item }) => ({
              ...item,
              packages: event.packages,
              commands: event.commands,
              folder: event.folder,
              ...(event.historical ? { status: "historical" as const } : {}),
            }),
          ),
        };
      }
      return {
        ...next,
        items: [
          ...state.items,
          {
            kind: "packages",
            key: index,
            requestId: event.requestId,
            packages: event.packages,
            commands: event.commands,
            folder: event.folder,
            ...(event.historical ? { status: "historical" as const } : {}),
          },
        ],
        tutorOpen: false,
      };
    case "packages_installing":
      return {
        ...next,
        items: withRequest(state.items, event.requestId, (item) => ({
          ...item,
          status: "installing",
        })),
      };
    case "packages_save_failed":
      return {
        ...next,
        items: withRequest(
          state.items,
          event.requestId,
          ({ outcome: _, output: __, ...item }) => ({
            ...item,
            status: "save-failed",
          }),
        ),
      };
    case "packages_answered":
      return {
        ...next,
        items: withRequest(
          state.items,
          event.requestId,
          ({ status: _, output: __, ...item }) => ({
            ...item,
            outcome: event.outcome,
            ...(event.output === undefined ? {} : { output: event.output }),
          }),
        ),
      };
    case "question":
      // A unit opened again, after a failure or a restart, posts its open
      // question again.
      if (
        state.items.some(
          (i) => i.kind === "question" && i.question.id === event.question.id,
        )
      ) {
        return next;
      }
      return {
        ...next,
        items: [
          ...state.items,
          { kind: "question", key: index, question: event.question },
        ],
        tutorOpen: false,
      };
    case "answer_waiting":
      return {
        ...next,
        items: withQuestion(state.items, event.questionId, (item) => ({
          ...item,
          waiting: event.answer,
        })),
      };
    case "grading":
      return {
        ...next,
        items: withQuestion(
          state.items,
          event.questionId,
          ({ gradingFailed: _, waiting: __, canMoveOn: ___, ...item }) => ({
            ...item,
            grading: event.answer,
          }),
        ),
      };
    case "grading_failed":
      return {
        ...next,
        items: withQuestion(state.items, event.questionId, (item) => ({
          ...item,
          gradingFailed: event.error,
          ...(event.canMoveOn ? { canMoveOn: true as const } : {}),
        })),
      };
    case "graded": {
      const at = state.items.findIndex(
        (i) => i.kind === "question" && i.question.id === event.questionId,
      );
      const asked = state.items[at];
      if (asked?.kind !== "question") return next;
      const {
        grading: _,
        gradingFailed: __,
        waiting: ___,
        canMoveOn: ____,
        ...rest
      } = asked;
      const answered: QuestionItem = { ...rest, graded: event };
      // A question the thread went on below before it was answered is shown
      // at the bottom, where it was answered and where the tutor's feedback
      // on it follows; a line stands where it was posted. Only the latest
      // question is answered now: a grade for an earlier one is a grade
      // whose line was lost, shown when the unit opens (task 2.13), and its
      // card stays where it was.
      if (
        asked.graded !== undefined ||
        at === state.items.length - 1 ||
        at !== state.items.findLastIndex((i) => i.kind === "question")
      ) {
        return { ...next, items: state.items.with(at, answered) };
      }
      return {
        ...next,
        items: [
          ...state.items.slice(0, at),
          {
            kind: "answered-below",
            key: asked.key,
            number: asked.question.number,
          },
          ...state.items.slice(at + 1),
          { ...answered, key: index, moved: true },
        ],
      };
    }
    case "disputed":
      return {
        ...next,
        items: withQuestion(state.items, event.questionId, (item) => ({
          ...item,
          dispute: event.dispute,
        })),
      };
    case "judging":
      return {
        ...next,
        items: [
          ...state.items,
          {
            kind: "judgment",
            key: index,
            learnerId: event.learnerId,
            number: event.number,
          },
        ],
        tutorOpen: false,
      };
    case "judged": {
      const call: Pick<JudgmentItem, "verdict" | "unjudged"> = {
        verdict: event.verdict,
        ...(event.unjudged === undefined ? {} : { unjudged: event.unjudged }),
      };
      const at = state.items.findIndex(
        (i) => i.kind === "judgment" && i.learnerId === event.learnerId,
      );
      const judging = state.items[at];
      if (judging?.kind === "judgment") {
        return {
          ...next,
          items: state.items.with(at, { ...judging, ...call }),
        };
      }
      // A reply a restart kept from the judge has no line of its own yet:
      // its call goes where the thread has reached.
      return {
        ...next,
        items: [
          ...state.items,
          {
            kind: "judgment",
            key: index,
            learnerId: event.learnerId,
            number: event.number,
            ...call,
          },
        ],
        tutorOpen: false,
      };
    }
    case "draft_reopened":
      return { ...next, reopened: true };
    case "curriculum_proposed": {
      const previous = state.items.findLast((i) => i.kind === "proposal");
      return {
        ...next,
        items: [
          ...state.items,
          {
            kind: "proposal",
            key: index,
            revision: event.revision,
            courseId: event.courseId,
            title: event.title,
            units: event.units,
            changed: changedUnits(event.units, previous?.units),
            style: event.style,
            styleChanged:
              previous !== undefined && previous.style !== event.style,
            background: event.background,
            backgroundChanged:
              previous !== undefined &&
              previous.background !== event.background,
          },
        ],
        tutorOpen: false,
        latestRevision: event.revision,
      };
    }
    case "curriculum_approved":
      return {
        ...next,
        approved: { courseId: event.courseId, revision: event.revision },
      };
    // The unit chat's events (tasks 2.6 to 2.8), shown by the session view.
    case "unit_planning":
      return { ...next, planning: true, failed: null };
    case "unit_plan":
      return { ...next, plan: event.plan, planning: false, failed: null };
    // How the unit stands: the closing card carries its own statuses.
    case "unit_status":
      return next;
    case "phase": {
      const position: Position = {
        segment: event.segment,
        phase: event.phase,
        ...(event.again === undefined ? {} : { again: event.again }),
      };
      // A chat that opens in the phase the thread is in, as a unit reopened
      // after a restart does, begins nothing new. A detour or an assessment
      // still open is said again after the phase, so one whose end the
      // thread lost ends, whether the phase is the thread's or a later one.
      // An assessment leaves the phase alone, so no phase comes while one
      // is offered or under way.
      if (
        state.position?.segment === position.segment &&
        state.position.phase === position.phase
      ) {
        return { ...next, position, detour: null, assessment: null };
      }
      // Going over again starts with the extra segment's teaching.
      const items =
        event.again !== undefined && event.phase === "teach"
          ? stepFromCard(state.items, "again")
          : state.items;
      return {
        ...next,
        items: [...items, { kind: "phase", key: index, ...position }],
        position,
        detour: null,
        assessment: null,
        tutorOpen: false,
      };
    }
    case "detour": {
      const detour = { questionId: event.questionId, number: event.number };
      // A unit reopened in a detour says so again: its marker is shown once.
      if (
        state.items.some(
          (i) => i.kind === "detour" && i.questionId === event.questionId,
        )
      ) {
        return { ...next, detour };
      }
      return {
        ...next,
        items: [...state.items, { kind: "detour", key: index, ...detour }],
        detour,
        tutorOpen: false,
      };
    }
    case "detour_end":
      return { ...next, detour: null };
    case "assessment": {
      const run = { mode: event.mode, stage: event.stage, count: event.count };
      const split = {
        ...(event.own === undefined ? {} : { own: event.own }),
        ...(event.from === undefined ? {} : { from: event.from }),
      };
      const at = state.items.findLastIndex((i) => i.kind === "assessment");
      const card = state.items[at];
      // A chat that opens with the assessment the thread shows, one not
      // ended, says it again.
      const standing =
        card?.kind === "assessment" &&
        !state.items.slice(at).some((i) => i.kind === "assessment_end");
      if (standing && card.stage === event.stage) {
        return { ...next, assessment: run };
      }
      // Start turns the card into the assessment's marker.
      if (
        event.stage === "on" &&
        card?.kind === "assessment" &&
        card.stage === "offered"
      ) {
        return {
          ...next,
          assessment: run,
          items: state.items.with(at, { ...card, stage: "on" }),
        };
      }
      return {
        ...next,
        assessment: run,
        items: [
          ...state.items,
          {
            kind: "assessment",
            key: index,
            mode: event.mode,
            count: event.count,
            ...split,
            stage: event.stage,
          },
        ],
        tutorOpen: false,
      };
    }
    case "assessment_end": {
      const { withdrawnQuestionId } = event;
      const items =
        withdrawnQuestionId === undefined
          ? state.items
          : withQuestion(state.items, withdrawnQuestionId, (item) => ({
              ...item,
              withdrawn: true,
            }));
      const at = items.findLastIndex((i) => i.kind === "assessment");
      const card = items[at];
      const settled = {
        ...next,
        assessment: null,
        detour: null,
        tutorOpen: false,
      };
      // Skipped on its card: the card becomes the marker that says so.
      if (card?.kind === "assessment" && card.stage === "offered") {
        return {
          ...settled,
          items: items.with(at, { ...card, stage: "skipped" }),
        };
      }
      return {
        ...settled,
        items: [
          ...items,
          {
            kind: "assessment_end",
            key: index,
            mode: event.mode,
            skipped: event.skipped,
            statuses: event.statuses,
            at: state.position,
          },
        ],
      };
    }
    case "unit_end": {
      // The card standing is shown again: by a chat that opened at it, or
      // with the statuses a dispute changed (task 3.8).
      const at = state.items.findLastIndex((i) => i.kind === "unit_end");
      const card = state.items[at];
      const shown = {
        passed: event.passed,
        objectives: event.objectives,
        ...(event.gate === undefined ? {} : { gate: event.gate }),
      };
      if (cardStanding(state.items) && card?.kind === "unit_end") {
        const { gate: _, ...was } = card;
        return { ...next, items: state.items.with(at, { ...was, ...shown }) };
      }
      return {
        ...next,
        items: [...state.items, { kind: "unit_end", key: index, ...shown }],
        tutorOpen: false,
      };
    }
    case "moved_on":
      return { ...next, items: stepFromCard(state.items, "moved-on") };
    case "unit_closed":
      return {
        ...next,
        items:
          event.status === "overridden"
            ? stepFromCard(state.items, "moved-on")
            : state.items,
        finished: event.status,
      };
    case "unit_failed":
      return {
        ...next,
        items: [
          ...state.items,
          { kind: "note", key: index, text: event.error },
        ],
        planning: false,
        failed: event.error,
      };
    case "overridden": {
      const { withdrawnQuestionId } = event;
      const items =
        withdrawnQuestionId === undefined
          ? state.items
          : withQuestion(state.items, withdrawnQuestionId, (item) => ({
              ...item,
              withdrawn: true,
            }));
      return {
        ...next,
        items: [
          ...items,
          {
            kind: "note",
            key: index,
            text: "You moved on without the check. Recorded as an override.",
          },
        ],
        tutorOpen: false,
      };
    }
    case "turn_end": {
      const note =
        event.outcome === "error"
          ? `The tutor stopped because of an error: ${event.error ?? "unknown"}`
          : event.outcome === "interrupted"
            ? "Stopped."
            : undefined;
      return {
        ...next,
        busy: false,
        tutorOpen: false,
        items:
          note === undefined
            ? state.items
            : [...state.items, { kind: "note", key: index, text: note }],
      };
    }
  }
}

/**
 * The thread in its conversations with the tutor, oldest first: a new one
 * begins at each fresh start, with its marker, and with the marker of the
 * session it begins, which comes just before, or before the notes on why
 * that session's unit did not open at first. A conversation found lost at a
 * learner turn begins with the explicitly identified message that turn sent
 * and every queued item after it. Without an id (including old transcripts),
 * no learner message is guessed. Each conversation is keyed by its marker.
 */
export function conversations(
  items: readonly Item[],
): { key: number; items: Item[] }[] {
  const parts: { key: number; items: Item[] }[] = [];
  for (const item of items) {
    const last = parts.at(-1);
    if (last === undefined) {
      parts.push({ key: item.key, items: [item] });
    } else if (item.kind === "fresh") {
      const learner =
        item.reason === "not-resumed" && item.learnerId !== undefined
          ? last.items.findIndex(
              (i) => i.kind === "learner" && i.id === item.learnerId,
            )
          : -1;
      const end = learner === -1 ? last.items.length : learner;
      let from = end;
      while (last.items[from - 1]?.kind === "note") from -= 1;
      const start =
        from > 1 && last.items[from - 1]?.kind === "session" ? from - 1 : end;
      const moved = last.items.splice(start);
      // A matched message may be the first item in an intake conversation.
      if (last.items.length === 0) parts.pop();
      parts.push({ key: item.key, items: [...moved, item] });
    } else {
      last.items.push(item);
    }
  }
  return parts;
}
