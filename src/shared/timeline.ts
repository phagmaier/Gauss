// The thread as the page shows it, rebuilt from the chat's event log. Pure, so
// a replay after a reload or a reconnect gives the same thread. A unit chat's
// log starts with the unit's earlier sessions (task 2.13), and its own
// opening repeats where the unit stands: a phase, an open question or a
// closing card the thread already shows is not shown twice, nor is the test's
// result card (task 5.6). A phase that begins a segment carries the
// segment's heading (piece 19), so the segments of earlier sessions have
// theirs too. When the tutor's
// conversation is replaced by a new one (task 2.14), a marker says so, and
// the thread before it is shown as earlier conversations.

import type { BackendName, Slug } from "./course.ts";
import { changedUnits, type Unit } from "./curriculum.ts";
import type { CurriculumChangeOutcome } from "./curriculum-change.ts";
import type { ShownDispute } from "./dispute.ts";
import type { PageEvent, TestShown, WebResult } from "./events.ts";
import type { AssessmentMode } from "./evidence.ts";
import type { PackageSpec, PackagesOutcome } from "./packages.ts";
import { firstTaught, type Plan } from "./plan.ts";
import type {
  AnswerSubmission,
  GradedAnswer,
  QuestionView,
} from "./question.ts";
import type {
  QuoteStart,
  SectionPlace,
  SourceFacts,
  SourceRefusal,
} from "./source.ts";
import type { Phase } from "./state.ts";
import type { ObjectiveStatus } from "./status.ts";
import type { StyleOutcome } from "./style.ts";

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
  /** The objectives the test before the unit passed, which the learner chose to skip. */
  skipping?: string[];
  /** Until the test before the unit is answered: no segment has begun (`isBeforeTest` in state.ts). */
  beforeTest?: true;
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
  /** Before the gate: moving on from the card offers it. */
  gateFollows?: true;
  /** The action offered by the closing card, absent in older transcripts. */
  finishId?: string;
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
  /** A review offered first, which the test before the unit waits behind. */
  testFollows?: true;
}

/** The marker an assessment leaves once it ends, or is skipped partway (piece 15). */
export interface AssessmentEndItem {
  kind: "assessment_end";
  key: number;
  mode: AssessmentMode;
  skipped: boolean;
  /** The objectives it recorded an answer on, with their statuses then. */
  statuses: Record<string, ObjectiveStatus>;
  /**
   * Where the unit goes on: the phase the thread was in, or "finished" for
   * a review the learner asked for in a finished unit (task 5.25).
   */
  at: Position | "finished" | null;
}

/** The test's result card (task 5.6, piece 16), and the learner's answer to it. */
export interface TestResultItem {
  kind: "test_result";
  key: number;
  /** Each of the unit's objectives, in the plan's order. */
  objectives: TestShown[];
  /** Once answered: the objectives the learner chose to skip, none for the whole unit taught. */
  skipped?: string[];
}

/** An artifact the tutor showed, by its file in the course's artifacts/ (task 3.6, piece 5). */
export interface ArtifactItem {
  kind: "artifact";
  key: number;
  file: string;
  title: string;
}

/** A page of a PDF source the tutor looked at (task 4.8, piece 23), with what its text lost. */
export interface PageItem {
  kind: "page";
  key: number;
  source: string;
  /** Counted from 1, as the page markers count. */
  page: number;
  math?: true;
  images?: true;
}

/**
 * A passage the tutor quoted, verified in the source (task 4.9, piece 23):
 * the source's words, the section where it starts, and where in it.
 */
export interface QuoteItem {
  kind: "quote";
  key: number;
  section: string;
  text: string;
  at?: QuoteStart;
}

/** A web search the tutor made (task 4.11, piece 23): the query and the pages it found. */
export interface SearchItem {
  kind: "search";
  key: number;
  query: string;
  results: WebResult[];
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

/** The tutor's proposed style note (task 5.11), and its answer. */
export interface StyleItem {
  kind: "style";
  key: number;
  proposalId: string;
  note: string;
  /** The note it would replace; none for a course without one. */
  was?: string;
  why: string;
  /** Replayed from a transcript: only the current chat can offer the answer. */
  historical?: true;
  outcome?: StyleOutcome;
}

/**
 * A file the learner attached in the intake or a planning conversation
 * (pieces 22 and 26): converting, then attached with what was found, or
 * refused with why; and removed once the learner removes it.
 */
export interface SourceItem {
  kind: "source";
  key: number;
  attachment: string;
  /** The file's name as the learner gave it. */
  name: string;
  /** In bytes, once known. */
  size?: number;
  state: "converting" | "attached" | "refused" | "removed";
  /** Once attached. */
  facts?: SourceFacts;
  refusal?: SourceRefusal;
}

/** The tutor's proposed curriculum change (task 5.12), and its answer. */
export interface CurriculumItem {
  kind: "curriculum";
  key: number;
  proposalId: string;
  /** The units as they would be. */
  units: Unit[];
  /** The units it would replace. */
  was: Unit[];
  why: string;
  /** Replayed from a transcript: only the current chat can offer the answer. */
  historical?: true;
  outcome?: CurriculumChangeOutcome;
}

export type Item =
  | { kind: "learner"; key: number; id?: string; text: string }
  | { kind: "tutor"; key: number; text: string }
  /** A file the tutor wrote, by its path in the workspace (task 3.3, piece 14). */
  | { kind: "file"; key: number; path: string }
  /** The section the tutor read, narrowed to its passage when it read one. */
  | { kind: "read"; key: number; section: string; range?: SectionPlace }
  | PageItem
  | QuoteItem
  | SearchItem
  | ArtifactItem
  | PackagesItem
  | StyleItem
  | CurriculumItem
  | SourceItem
  | QuestionItem
  | JudgmentItem
  /**
   * A phase of a segment began, or the chat opened in it. One that begins a
   * segment has the id of the segment's heading: `segment-N` for the plan's
   * Nth segment, `again-N` for the Nth time the unit goes over objectives
   * again.
   */
  | PhaseItem
  | UnitEndItem
  | AssessmentItem
  | AssessmentEndItem
  | TestResultItem
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
      /** The learner profile approval would write; a draft from before task 5.8 has none. */
      profile: string | undefined;
      /** Original comparison: null for no profile, undefined if not recorded. */
      profileWas: string | null | undefined;
    }
  | { kind: "note"; key: number; text: string };

export type PhaseItem = {
  kind: "phase";
  key: number;
  heading?: string;
} & Position;

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
  /** The tutor's next text continues the last item, skipping any source cards. */
  tutorOpen: boolean;
  /** The newest proposal's revision, the only one that can be approved; 0 if none. */
  latestRevision: number;
  approved: { courseId: Slug; revision: number } | null;
  /** The intake started from a stored draft, its conversation lost. */
  reopened: boolean;
  /** The intake: the backend its course runs on. */
  backend: BackendName;
  // A unit chat's own (tasks 2.6 to 2.8):
  /** The index of the latest live curriculum update, or -1. */
  curriculumChangedAt: number;
  /** A session has begun: the unit's thread was read, and what follows is in it. */
  inSession: boolean;
  /** The unit's plan, once it is known. */
  plan: Plan | null;
  /** How each of the unit's objectives stands now; empty until the unit is open. */
  statuses: Record<string, ObjectiveStatus>;
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
  /** The test has ended; its summary or result card still waits for the learner's choice. */
  testWaits: boolean;
  /** The unit is finished, and how. */
  finished: "passed" | "overridden" | null;
}

export const emptyTimeline: Timeline = {
  chatId: null,
  last: -1,
  openedThrough: -1,
  curriculumChangedAt: -1,
  shown: null,
  items: [],
  busy: false,
  tutorOpen: false,
  latestRevision: 0,
  approved: null,
  reopened: false,
  backend: "claude",
  inSession: false,
  plan: null,
  statuses: {},
  planning: false,
  failed: null,
  position: null,
  detour: null,
  assessment: null,
  testWaits: false,
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

/** Changes the style proposal with this id, and leaves every other item as it is. */
function withProposal(
  items: Item[],
  id: string,
  change: (item: StyleItem) => StyleItem,
): Item[] {
  return items.map((item) =>
    item.kind === "style" && item.proposalId === id ? change(item) : item,
  );
}

/** Changes the curriculum change with this id, and leaves every other item as it is. */
function withChange(
  items: Item[],
  id: string,
  change: (item: CurriculumItem) => CurriculumItem,
): Item[] {
  return items.map((item) =>
    item.kind === "curriculum" && item.proposalId === id ? change(item) : item,
  );
}

/**
 * The thread with the card of this attachment changed, or added where the
 * thread has none, as for a file refused before it was read.
 */
function withSource(
  state: Timeline,
  key: number,
  attachment: string,
  name: string,
  change: Partial<Omit<SourceItem, "kind" | "key" | "attachment" | "name">> &
    Pick<SourceItem, "state">,
): Timeline {
  const at = state.items.findIndex(
    (i) => i.kind === "source" && i.attachment === attachment,
  );
  const card = state.items[at];
  if (card?.kind === "source") {
    return { ...state, items: state.items.with(at, { ...card, ...change }) };
  }
  return {
    ...state,
    items: [
      ...state.items,
      { kind: "source", key, attachment, name, ...change },
    ],
  };
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
 * The phase item for a position the unit moved to. It begins a segment, and
 * carries the segment's heading, when the thread's last phase was in another
 * segment, or closed its segment, as the one before going over again does,
 * or when the thread has none, as at the unit's start or in a chat that
 * opened with no earlier thread. A chat that opens where the thread is adds
 * no phase, so a fresh start does not repeat the heading of the segment it
 * goes on with: the heading stays where the segment began.
 */
function phaseItem(items: readonly Item[], key: number, at: Position): Item {
  const before = items.findLast((i): i is PhaseItem => i.kind === "phase");
  if (
    before !== undefined &&
    before.segment === at.segment &&
    before.phase !== "closed"
  ) {
    return { kind: "phase", key, ...at };
  }
  const again = items.filter(
    (i) => i.kind === "phase" && i.heading !== undefined && i.again,
  ).length;
  return {
    kind: "phase",
    key,
    ...at,
    heading:
      at.again === undefined
        ? `segment-${at.segment + 1}`
        : `again-${again + 1}`,
  };
}

/** Older transcripts put a placeholder phase before the unit's test. */
function withoutOpeningPhase(items: Item[]): Item[] {
  const at = items.findLastIndex((item) => item.kind === "phase");
  return at === -1 ? items : items.toSpliced(at, 1);
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
      if (state.tutorOpen) {
        const at = state.items.findLastIndex((item) => item.kind !== "source");
        const lastItem = state.items[at];
        if (lastItem?.kind === "tutor") {
          return {
            ...next,
            items: state.items.with(at, {
              ...lastItem,
              text: lastItem.text + event.text,
            }),
          };
        }
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
    case "section_read":
      // The tutor's text after it goes below it.
      return {
        ...next,
        items: [
          ...state.items,
          {
            kind: "read",
            key: index,
            section: event.section,
            ...(event.range === undefined ? {} : { range: event.range }),
          },
        ],
        tutorOpen: false,
      };
    case "page_viewed":
      return {
        ...next,
        items: [
          ...state.items,
          {
            kind: "page",
            key: index,
            source: event.source,
            page: event.page,
            ...(event.math ? { math: true } : {}),
            ...(event.images ? { images: true } : {}),
          },
        ],
        tutorOpen: false,
      };
    case "source_quoted":
      return {
        ...next,
        items: [
          ...state.items,
          {
            kind: "quote",
            key: index,
            section: event.section,
            text: event.text,
            ...(event.at === undefined ? {} : { at: event.at }),
          },
        ],
        tutorOpen: false,
      };
    case "web_searched":
      return {
        ...next,
        items: [
          ...state.items,
          {
            kind: "search",
            key: index,
            query: event.query,
            results: event.results,
          },
        ],
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
    case "style_proposed": {
      // The reopened unit sends the waiting proposal again: keep the card
      // where it was. Only the live notice lets it be answered.
      const card = {
        proposalId: event.proposalId,
        note: event.note,
        ...(event.was === undefined ? {} : { was: event.was }),
        why: event.why,
        ...(event.historical ? { historical: true as const } : {}),
      };
      if (
        state.items.some(
          (i) => i.kind === "style" && i.proposalId === event.proposalId,
        )
      ) {
        return {
          ...next,
          items: withProposal(
            state.items,
            event.proposalId,
            ({ historical: __, ...item }) => ({ ...item, ...card }),
          ),
        };
      }
      return {
        ...next,
        items: [...state.items, { kind: "style", key: index, ...card }],
        tutorOpen: false,
      };
    }
    case "style_answered":
      return {
        ...next,
        items: withProposal(state.items, event.proposalId, (item) => ({
          ...item,
          outcome: event.outcome,
        })),
      };
    case "curriculum_change_proposed": {
      // As a style proposal: a reopened unit sends a waiting one again.
      const card = {
        proposalId: event.proposalId,
        units: event.units,
        was: event.was,
        why: event.why,
        ...(event.historical ? { historical: true as const } : {}),
      };
      if (
        state.items.some(
          (i) => i.kind === "curriculum" && i.proposalId === event.proposalId,
        )
      ) {
        return {
          ...next,
          items: withChange(
            state.items,
            event.proposalId,
            ({ historical: __, ...item }) => ({ ...item, ...card }),
          ),
        };
      }
      return {
        ...next,
        items: [...state.items, { kind: "curriculum", key: index, ...card }],
        tutorOpen: false,
      };
    }
    case "curriculum_changed":
      return { ...next, curriculumChangedAt: index };
    case "curriculum_change_answered":
      return {
        ...next,
        items: withChange(state.items, event.proposalId, (item) => ({
          ...item,
          outcome: event.outcome,
        })),
      };
    case "question":
      // A unit opened again, after a failure or a restart, posts its open
      // question again from the record, with a code question's files in the
      // workspace as it is now. The card stays where it was and takes that view.
      if (
        state.items.some(
          (i) => i.kind === "question" && i.question.id === event.question.id,
        )
      ) {
        return {
          ...next,
          items: withQuestion(state.items, event.question.id, (item) => ({
            ...item,
            question: event.question,
          })),
        };
      }
      return {
        ...next,
        items: [
          ...state.items,
          { kind: "question", key: index, question: event.question },
        ],
        tutorOpen: false,
      };
    case "question_withdrawn":
      return {
        ...next,
        items: withQuestion(state.items, event.questionId, (item) => ({
          ...item,
          withdrawn: true,
        })),
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
    case "backend_chosen":
      return { ...next, backend: event.backend };
    // The sources attached in the intake or a planning conversation (pieces
    // 22 and 26): one card per file attached.
    case "source_converting":
      return {
        ...next,
        items: [
          ...state.items,
          {
            kind: "source",
            key: index,
            attachment: event.attachment,
            name: event.name,
            ...(event.size === undefined ? {} : { size: event.size }),
            state: "converting",
          },
        ],
      };
    case "source_attached":
      return withSource(next, index, event.attachment, event.source.name, {
        state: "attached",
        size: event.size,
        facts: event.source,
      });
    case "source_refused":
      return withSource(next, index, event.attachment, event.name, {
        state: "refused",
        ...(event.size === undefined ? {} : { size: event.size }),
        refusal: event.refusal,
      });
    case "source_removed": {
      const card = state.items.find(
        (i) => i.kind === "source" && i.attachment === event.attachment,
      );
      return card?.kind === "source"
        ? withSource(next, index, event.attachment, card.name, {
            state: "removed",
          })
        : next;
    }
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
            profile: event.profile,
            profileWas: event.profileWas,
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
      return { ...next, statuses: event.objectives };
    case "phase": {
      const position: Position = {
        segment: event.segment,
        phase: event.phase,
        ...(event.again === undefined ? {} : { again: event.again }),
        ...(event.skipping === undefined ? {} : { skipping: event.skipping }),
        ...(event.beforeTest ? { beforeTest: true } : {}),
      };
      if (event.beforeTest) {
        return {
          ...next,
          items: withoutOpeningPhase(state.items),
          position,
          detour: null,
          assessment: null,
        };
      }
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
        items: [...items, phaseItem(items, index, position)],
        position,
        detour: null,
        assessment: null,
        // A result card whose answer the thread lost is answered by now.
        testWaits: false,
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
      const items =
        event.mode === "test-out"
          ? withoutOpeningPhase(state.items)
          : state.items;
      return {
        ...next,
        assessment: run,
        items: [
          ...items,
          {
            kind: "assessment",
            key: index,
            mode: event.mode,
            count: event.count,
            ...split,
            stage: event.stage,
            ...(event.mode === "review" && state.position?.beforeTest
              ? { testFollows: true }
              : {}),
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
      // A test leaves no marker: keep its position through the tutor's summary and the result card.
      if (event.mode === "test-out") {
        return { ...settled, items, testWaits: true };
      }
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
            at: state.finished === null ? state.position : "finished",
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
        ...(event.gateFollows === undefined
          ? {}
          : { gateFollows: event.gateFollows }),
        ...(event.finishId === undefined ? {} : { finishId: event.finishId }),
      };
      if (cardStanding(state.items) && card?.kind === "unit_end") {
        const { gate: _, gateFollows: __, finishId: ___, ...was } = card;
        return { ...next, items: state.items.with(at, { ...was, ...shown }) };
      }
      return {
        ...next,
        items: [...state.items, { kind: "unit_end", key: index, ...shown }],
        tutorOpen: false,
      };
    }
    case "test_result": {
      // The card waiting is shown again, as it stands: by a chat that
      // opened at it, or with what a dispute changed.
      const at = state.items.findLastIndex((i) => i.kind === "test_result");
      const card = state.items[at];
      if (card?.kind === "test_result" && card.skipped === undefined) {
        return {
          ...next,
          testWaits: true,
          items: state.items.with(at, {
            ...card,
            objectives: event.objectives,
          }),
        };
      }
      return {
        ...next,
        testWaits: true,
        items: [
          ...state.items,
          { kind: "test_result", key: index, objectives: event.objectives },
        ],
        tutorOpen: false,
      };
    }
    case "test_answered": {
      const at = state.items.findLastIndex((i) => i.kind === "test_result");
      const card = state.items[at];
      const { skipped } = event;
      const answered =
        card?.kind === "test_result"
          ? state.items.with(at, { ...card, skipped: [...skipped] })
          : state.items;
      const skipping = skipped.length === 0 ? {} : { skipping: [...skipped] };
      // The unit goes on from the first segment left to teach, which begins
      // here; none is left when the test passed every objective.
      const first =
        state.plan === null ? undefined : firstTaught(state.plan, skipped);
      if (
        first !== undefined &&
        state.items.findLastIndex((i) => i.kind === "phase") <= at
      ) {
        const position: Position = {
          segment: first,
          phase: "teach",
          ...skipping,
        };
        return {
          ...next,
          testWaits: false,
          position,
          items: [...answered, phaseItem(answered, index, position)],
          tutorOpen: false,
        };
      }
      const {
        skipping: _,
        beforeTest: __,
        ...rest
      } = state.position ?? {
        segment: 0,
        phase: "teach" as const,
      };
      return {
        ...next,
        testWaits: false,
        position: { ...rest, ...skipping },
        items: answered,
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
        assessment: null,
        detour: null,
        testWaits: false,
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
