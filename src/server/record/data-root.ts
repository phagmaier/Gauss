// The data root: the folder that holds every course (architecture.md
// section 3). This module creates, lists, reads and marks opened courses
// and their units, stores and approves their curricula, each draft with its
// style note and background note, reads those notes, stores the plans of
// their units, keeps the position of each unit in progress in state.json,
// appends to and reads the evidence log, appends a dispute once per answer,
// appends to and reads the units' session transcripts, stores and reads the artifacts the tutor shows,
// writes and reads each unit's handoff note and the misconception log (task 5.7),
// and reads and writes the learner profile, writing it too when a curriculum
// that proposes one is approved (task 5.8), and applies the changes to an
// approved curriculum that the learner accepts (tasks 5.12 and 5.38),
// deletes a course (task 5.18), and keeps sources: a converted folder put
// in an intake's uploads or a course's sources/, moved from one to the
// other, removed from uploads, and the outlines read.
// Every write of a whole file goes through writeFileAtomic, the logs are
// appended to, and every file read or written is checked against its schema
// in src/shared/. Work that reads a file and writes it back, and every
// append, runs through withFileLock, so it lands in the order called.

import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { ArtifactFile } from "../../shared/artifact.ts";
import { Course, Slug } from "../../shared/course.ts";
import {
  Curriculum,
  CurriculumProposal,
  PendingProfileApproval,
  type ShownProposal,
  type Unit,
} from "../../shared/curriculum.ts";
import {
  type CurriculumChange,
  CurriculumDecision,
  droppedStarted,
  sameUnits,
  withPlans,
} from "../../shared/curriculum-change.ts";
import { PageEvent, SESSION_GAP_MS } from "../../shared/events.ts";
import {
  DisputeEvidence,
  EvidenceEntry,
  OverrideEvidence,
} from "../../shared/evidence.ts";
import { HandoffMark } from "../../shared/handoff.ts";
import type { StoredCourse } from "../../shared/library.ts";
import { Misconception } from "../../shared/misconception.ts";
import {
  type NotesSaved,
  NotesSource,
  PendingNotes,
} from "../../shared/notes.ts";
import { PackageCompletion } from "../../shared/packages.ts";
import { Plan } from "../../shared/plan.ts";
import { LearnerProfile } from "../../shared/profile.ts";
import { Outline } from "../../shared/source.ts";
import { State, UnitPosition } from "../../shared/state.ts";
import { StyleDecision } from "../../shared/style.ts";
import { syncFolder, writeFileAtomic, writeFileNew } from "./atomic-write.ts";
import { disputable } from "./disputes.ts";
import { withFileLock } from "./file-lock.ts";
import {
  appendJsonLine,
  appendJsonLines,
  readJsonLines,
} from "./json-lines.ts";

/** `GAUSS_DATA_ROOT` when it is set and not empty, otherwise `~/gauss`. */
export function resolveDataRoot(
  env: Readonly<Record<string, string | undefined>> = process.env,
  home: string = homedir(),
): string {
  const chosen = env.GAUSS_DATA_ROOT;
  return chosen ? resolve(chosen) : join(home, "gauss");
}

export interface DataRoot {
  /** Makes the folder, reports its reserved id, then publishes course.json. */
  createCourse(input: {
    title: string;
    reserved?: (id: Slug) => void;
  }): Promise<StoredCourse>;
  /**
   * Every course, most recently opened first. A folder without course.json
   * (a creation that stopped partway) is left out. With skipUnreadable,
   * a course whose files cannot be read is left out as well.
   */
  listCourses(options?: { skipUnreadable?: boolean }): Promise<StoredCourse[]>;
  /** One course, or undefined when no course has that id. */
  readCourse(id: string): Promise<StoredCourse | undefined>;
  /**
   * Removes the course's folder and everything in it (task 5.18): first
   * renamed out of the library at once, to a hidden name the backup leaves
   * out, then removed. False when no course has that id. A removal that
   * fails after the rename is logged with the folder left behind.
   */
  deleteCourse(id: string): Promise<boolean>;
  /**
   * The absolute path of the course's workspace (task 3.3): the tutor's
   * working folder, where its sessions run and are kept, and the only one
   * it writes in; made if it is missing. Gauss writes nothing in it. Throws
   * for an id that cannot be a course's.
   */
  workspaceFolder(id: string): Promise<string>;
  /**
   * The absolute path of the folder the intakes' tutor sessions run in, so
   * that they are kept (task 2.15); made if it is missing. Gauss writes
   * nothing in it.
   */
  intakeFolder(): Promise<string>;
  /**
   * Sets the course's lastOpenedAt to the clock's time, and the unit's time
   * in unitsOpenedAt when a unit is named.
   */
  markOpened(id: string, unitId?: string): Promise<StoredCourse>;
  /**
   * Notes that review is offered in the course at `at`, under the course
   * file's lock. An automatic offer within SESSION_GAP_MS changes nothing
   * and answers false; a requested start refreshes the cooldown.
   */
  markReviewOffered(
    id: string,
    at: Date,
    options?: { requested?: true },
  ): Promise<boolean>;
  /**
   * The course's style note, style.md, trimmed, or undefined when it has
   * none (a course proposed before notes existed, task 2.10) or the file is
   * blank.
   */
  readStyle(id: string): Promise<string | undefined>;
  /**
   * The course's background note, background.md, trimmed, or undefined when
   * it has none (a course proposed before background notes existed, task
   * 2.22) or the file is blank.
   */
  readBackground(id: string): Promise<string | undefined>;
  /**
   * The learner profile, profile.md in the data root, trimmed; undefined
   * when there is none or it is blank.
   */
  readProfile(): Promise<string | undefined>;
  /**
   * Writes the learner profile whole, if profile.md still holds `was`
   * (undefined: no profile) or holds this text already. Otherwise it throws
   * ProfileChanged and writes nothing, so a change made since `was` was
   * read is not lost unseen.
   */
  writeProfile(text: string, was: string | undefined): Promise<void>;
  /** Stages a backup outside the record's multi-file writes. */
  withConsistentSnapshot<T>(work: () => Promise<T>): Promise<T>;
  /**
   * Stores the tutor's proposal as the course's draft curriculum, with the
   * profile it proposes, replacing any earlier draft, its style note as
   * style.md, its background note as background.md, and its title as the
   * course's title. Refused, changing nothing, once the curriculum is
   * approved, so the approved notes are the ones approval found.
   */
  saveProposal(
    id: string,
    proposal: CurriculumProposal & Pick<ShownProposal, "profileWas">,
  ): Promise<StoredCourse & { curriculum: Curriculum }>;
  /**
   * Approves the draft curriculum, at the clock's time, if the record holds
   * exactly the proposal shown: its title, units, style note, background
   * note and profile. Otherwise it throws DraftMismatch and changes nothing,
   * so a draft whose save stopped partway is never approved unseen. A profile
   * approval also requires its original comparison to match profile.md. If
   * publishing the profile stops, the curriculum is restored to a draft.
   */
  approveCurriculum(
    id: string,
    shown: ShownProposal,
  ): Promise<StoredCourse & { curriculum: Curriculum }>;
  /**
   * Stores the plan on the unit, once the curriculum is approved and while
   * the unit has none. Refused, changing nothing, when one of its objective
   * ids is used in another unit's plan.
   */
  storePlan(
    id: string,
    unitId: string,
    plan: Plan,
  ): Promise<StoredCourse & { curriculum: Curriculum }>;
  /**
   * Where each unit in progress stands; no units when none is. A change to
   * the curriculum whose Apply wrote curriculum.json but not this file is
   * recorded as applied first.
   */
  readState(id: string): Promise<State>;
  /**
   * Sets the unit's position in state.json, or with null takes the unit out
   * (it is no longer in progress), and returns the state as written. The
   * test-out finish and any package completion are saved in the same write.
   * A style or curriculum decision can be recorded with the position, or
   * marked delivered. An applied curriculum decision writes curriculum.json
   * first, with each kept unit's plan, and throws CurriculumChangeRefused
   * if the change would now drop a unit that has started. With `finished`,
   * the position is a finished unit's, held for a review the learner asked
   * for: it goes in `finishedReviews`, and null takes it out, while the
   * units in progress stay as they are.
   * Writes land in the order they were called, each on the one before.
   */
  writePosition(
    id: string,
    unitId: string,
    position: UnitPosition | null,
    outcome?: {
      completion?: PackageCompletion | undefined;
      testedOut?: boolean;
      style?:
        | { decision: StyleDecision }
        | { delivered: readonly StyleDecision[] };
      curriculum?:
        | { decision: CurriculumDecision }
        | { delivered: readonly CurriculumDecision[] };
      finished?: boolean;
    },
  ): Promise<State>;
  /**
   * Replaces the approved curriculum's units with these, each kept unit with
   * its plan: a change applied from the course's planning conversation (task
   * 5.38), which no unit's position holds. Throws CurriculumChangeRefused,
   * writing nothing, if it would drop a unit that has started or breaks the
   * curriculum's rules. The write counts as applied if the curriculum on
   * disk already has these units, including after an error following rename.
   */
  changeCurriculum(id: string, units: readonly Unit[]): Promise<void>;
  /** Appends one entry to evidence.jsonl. Appends land in the order called. */
  appendEvidence(id: string, entry: EvidenceEntry): Promise<void>;
  /** The evidence, oldest first, without a last line a crash cut short. */
  readEvidence(id: string): Promise<EvidenceEntry[]>;
  /**
   * Appends a dispute of a recorded answer, with the override it brings if
   * it takes the pass from an objective of a finished unit (task 3.8), in
   * one write. Throws DisputeRefused, appending nothing, when `disputable`
   * (record/disputes.ts) refuses it: checked as the append waits its turn,
   * so two disputes of one answer cannot both land.
   */
  appendDispute(
    id: string,
    dispute: DisputeEvidence,
    override?: OverrideEvidence,
  ): Promise<void>;
  /**
   * Appends the page events to the transcript of the unit's session with
   * this number, made if it is new. Appends land in the order called. They
   * are not flushed to disk, as the record's other files are: a transcript
   * only shows the conversation, and is written often.
   */
  appendTranscript(
    id: string,
    unitId: string,
    session: number,
    events: readonly PageEvent[],
  ): Promise<void>;
  /**
   * The unit's session transcripts, in the order of their numbers, each
   * without a last line a crash cut short; none when the unit has none. A
   * line that cannot be read is left out and named in `unreadable`, so a
   * damaged transcript, or an event of a shape the page no longer has, costs
   * that line and not the unit.
   */
  readTranscripts(id: string, unitId: string): Promise<Transcript[]>;
  /**
   * Stores an artifact the tutor showed (task 3.6) in the course's
   * artifacts/ folder, as `<number>-<title as a slug>.html`, numbered on
   * from the highest number there and never written over a file that is
   * there. Returns its number and its file's name.
   */
  writeArtifact(
    id: string,
    artifact: { title: string; html: string },
  ): Promise<{ number: number; file: ArtifactFile }>;
  /**
   * An artifact's document, or undefined when the course has none by that
   * name, or the name cannot be an artifact's.
   */
  readArtifact(id: string, file: string): Promise<string | undefined>;
  /** Metadata of a published notes file, or undefined before its first write. */
  readNotes(id: string, unitId: string): Promise<NotesSaved | undefined>;
  /** The published HTML, never the unprocessed writer's reply. */
  readNotesHtml(id: string, unitId: string): Promise<string | undefined>;
  /** Publishes a standalone notes file and keeps the source beside it. */
  writeNotes(
    id: string,
    unitId: string,
    html: string,
    source: NotesSource,
  ): Promise<void>;
  /**
   * The unit's handoff note, `units/<unit id>/handoff.md`, trimmed, with how
   * much of the thread it covers (`handoff.json`); undefined when the unit
   * has no note. A note without its mark, which a crash between the two
   * writes leaves, has none, and the next call reads the whole thread.
   */
  readHandoff(
    id: string,
    unitId: string,
  ): Promise<{ note: string; mark: HandoffMark | undefined } | undefined>;
  /**
   * Writes the unit's handoff note whole, in place of the one before, then
   * how much of the thread it covers.
   */
  writeHandoff(
    id: string,
    unitId: string,
    note: string,
    mark: HandoffMark,
  ): Promise<void>;
  /** Appends the misconceptions to misconceptions.jsonl in one write. */
  appendMisconceptions(
    id: string,
    entries: readonly Misconception[],
  ): Promise<void>;
  /** The misconception log, oldest first, without a last line a crash cut short. */
  readMisconceptions(id: string): Promise<Misconception[]>;
  /**
   * The absolute path of the folder where an intake's sources wait,
   * `uploads/<intake id>/`, until its first proposal creates the course;
   * made if it is missing. Throws for an id that cannot be an intake's.
   */
  uploadsFolder(intakeId: string): Promise<string>;
  /**
   * Removes every intake's uploads. Called at start, when no intake is
   * running: an intake ends with the server.
   */
  clearUploads(): Promise<void>;
  /**
   * Puts a folder `convert.py ingest` wrote in place: in the course's
   * `sources/`, or in the intake's uploads, under a slug of its title
   * unique there, which becomes its outline's id before it is published by
   * rename. The folder must be on the data root's file system, as a scratch
   * folder inside it is. Returns the outline as written.
   */
  placeSource(
    converted: string,
    into: { course: Slug } | { intake: string },
  ): Promise<Outline>;
  /** Moves an upload into the course's `sources/` under its id; throws if the path is taken. */
  moveUpload(intakeId: string, sourceId: Slug, courseId: Slug): Promise<void>;
  /** Deletes a source waiting in the intake's uploads. */
  removeUpload(intakeId: string, sourceId: Slug): Promise<void>;
  /** The outlines of the course's sources, by id; none when it has none. */
  readSources(id: string): Promise<Outline[]>;
}

/**
 * One session of a unit, one sitting (task 2.13): the page events of its
 * chat in that sitting, in `sessions/<unit id>.<number>.jsonl`. A unit's
 * sessions are numbered from 1 in the order they began. A slug has no dot,
 * so the name can be read back.
 */
export interface Transcript {
  session: number;
  /** The session's page events; empty if a crash cut its only line short. */
  events: PageEvent[];
  /** The lines left out, each with where it is and why. */
  unreadable: string[];
}

/** A dispute the record refuses (`appendDispute`), with the route's status. */
export class DisputeRefused extends Error {
  readonly status: 404 | 409;
  constructor(status: 404 | 409, message: string) {
    super(message);
    this.name = "DisputeRefused";
    this.status = status;
  }
}

/**
 * Approval was refused because the stored draft is not the proposal the
 * learner saw: saving a later one stopped partway, or the files were edited.
 */
export class DraftMismatch extends Error {
  constructor(id: string, parts: readonly string[]) {
    super(
      `The stored draft of "${id}" is not the proposal shown; they differ in ${parts.join(" and ")}.`,
    );
    this.name = "DraftMismatch";
  }
}

/** An Apply the curriculum's own rules refuse now; nothing was written. */
export class CurriculumChangeRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CurriculumChangeRefused";
  }
}

/**
 * profile.md is not the text a write expected to replace: the learner saved
 * it on the Profile page, or an approval wrote it, since that text was read.
 */
export class ProfileChanged extends Error {
  constructor() {
    super("The learner profile changed since it was read.");
    this.name = "ProfileChanged";
  }
}

/** The plain-text notes kept with a course's curriculum. */
type Note = "style.md" | "background.md";

export function openDataRoot(options: {
  path: string;
  /** The clock for the dates in the record; tests set it. */
  now?: () => Date;
}): DataRoot {
  const courses = join(options.path, "courses");
  const uploads = join(options.path, "uploads");
  const profileFile = join(options.path, "profile.md");
  const pendingFile = join(options.path, ".profile-approval.json");
  const pendingNotesFile = join(options.path, ".notes-write.json");
  const now = options.now ?? (() => new Date());

  async function readCourse(id: string): Promise<StoredCourse | undefined> {
    if (!Slug.safeParse(id).success) return undefined;
    const folder = join(courses, id);
    const course = await readJson(join(folder, "course.json"), Course);
    if (course === undefined) return undefined;
    const curriculum = await readJson(
      join(folder, "curriculum.json"),
      Curriculum,
    );
    return { id, course, curriculum: curriculum ?? null };
  }

  async function existingCourse(id: string): Promise<StoredCourse> {
    const stored = await readCourse(id);
    if (stored === undefined) throw new Error(noCourse(id));
    return stored;
  }

  /** A note in the course's folder, trimmed; undefined if there is none or it is blank. */
  function readNote(id: string, note: Note): Promise<string | undefined> {
    return readText(courseFile(id, note));
  }

  async function readStateFile(path: string): Promise<State> {
    return (await readJson(path, State)) ?? { units: {} };
  }

  /** Reads state under its lock and resolves any interrupted Apply. */
  async function recoverStyle(id: string, path: string): Promise<State> {
    const state = await readStateFile(path);
    return state.styleRollback === undefined
      ? state
      : withFileLock(courses, () => undoStyle(id, path, state));
  }

  /** Restores an uncommitted Apply. Holds the state and snapshot locks. */
  async function undoStyle(
    id: string,
    path: string,
    stored: State,
  ): Promise<State> {
    const { styleRollback, ...state } = stored;
    if (styleRollback === undefined) return stored;
    const file = courseFile(id, "style.md");
    const current = await readFileText(file);
    if (styleRollback.was === null) {
      if (current !== undefined) {
        await rm(file);
        await syncFolder(join(courses, id));
      }
    } else if (current !== styleRollback.was) {
      await writeFileAtomic(file, styleRollback.was);
    }
    await writeJson(path, State, state);
    return state;
  }

  /** Publishes the note and decision with an undo record. Holds both locks. */
  async function applyStyle(
    id: string,
    path: string,
    before: State,
    after: State,
    unit: Slug,
    decision: Extract<StyleDecision, { outcome: "applied" }>,
  ): Promise<State> {
    const file = courseFile(id, "style.md");
    const was = (await readFileText(file)) ?? null;
    await writeJson(path, State, { ...before, styleRollback: { was } });
    try {
      await writeFileAtomic(file, `${decision.note}\n`);
      await writeJson(path, State, after);
    } catch (error) {
      const recovered = await undoStyle(id, path, await readStateFile(path));
      // An atomic write can report a directory sync error after renaming.
      if (
        !recovered.styleDecisions?.[unit]?.some(
          (d) => d.proposalId === decision.proposalId,
        )
      ) {
        throw error;
      }
      return recovered;
    }
    return after;
  }

  /**
   * Completes an Apply that wrote curriculum.json but not state.json: a
   * waiting change the curriculum already holds was applied, since a change
   * must differ from the curriculum it would replace. Holds the state lock.
   */
  async function recoverCurriculum(
    path: string,
    state: State,
    curriculum: Curriculum | null,
  ): Promise<State> {
    const settled = settleApplied(state, curriculum?.units);
    if (settled !== state) await writeJson(path, State, settled);
    return settled;
  }

  /**
   * The approved curriculum with these units, each kept unit with its plan.
   * Throws CurriculumChangeRefused if the change would drop a unit that has
   * started, by the plans and the state, or breaks the curriculum's rules.
   * The caller holds the state and curriculum locks.
   */
  function changedCurriculum(
    id: string,
    current: Curriculum | null | undefined,
    state: State,
    units: readonly Unit[],
  ): Curriculum {
    if (current?.approval.status !== "approved") {
      throw new Error(`The curriculum of "${id}" is not approved.`);
    }
    const refusal = droppedStarted(current.units, units, state);
    if (refusal !== undefined) throw new CurriculumChangeRefused(refusal);
    const parsed = Curriculum.safeParse({
      ...current,
      units: withPlans(current.units, units),
    });
    if (!parsed.success) {
      throw new CurriculumChangeRefused(
        parsed.error.issues.map((issue) => issue.message).join("\n"),
      );
    }
    return parsed.data;
  }

  /**
   * Writes the changed curriculum, each kept unit with its plan, then the
   * state with the decision; curriculum.json holding the change commits it.
   * Holds the state, curriculum and snapshot locks.
   */
  async function applyCurriculum(
    id: string,
    path: string,
    after: State,
    unit: Slug,
    change: CurriculumChange,
  ): Promise<State> {
    const file = courseFile(id, "curriculum.json");
    const changed = changedCurriculum(
      id,
      (await readCourse(id))?.curriculum,
      after,
      change.units,
    );
    try {
      await writeJson(file, Curriculum, changed);
      await writeJson(path, State, after);
    } catch (error) {
      // An atomic write can report a directory sync error after renaming.
      const recovered = await recoverCurriculum(
        path,
        await readStateFile(path),
        (await readCourse(id))?.curriculum ?? null,
      );
      if (
        !decisionsOf(recovered.curriculumDecisions, unit).some(
          (d) => d.proposalId === change.id,
        )
      ) {
        throw error;
      }
      return recovered;
    }
    return after;
  }

  /**
   * Writes a hand edit if the profile still holds `was`, or holds the new
   * text already, so no unseen change is lost; the caller holds its lock.
   */
  async function replaceProfile(
    text: string,
    was: string | undefined,
  ): Promise<void> {
    const checked = LearnerProfile.parse(text);
    const current = await readText(profileFile);
    if (current === checked) return;
    if (current !== (was?.trim() || undefined)) throw new ProfileChanged();
    await writeFileAtomic(profileFile, `${checked}\n`);
  }

  /** The profile lock is always acquired before any curriculum lock. */
  function withConsistentApproval<T>(work: () => Promise<T>): Promise<T> {
    return withFileLock(profileFile, async () => {
      const pending = await readJson(pendingFile, PendingProfileApproval);
      if (pending !== undefined) {
        const path = courseFile(pending.courseId, "curriculum.json");
        await withFileLock(path, () => recoverApproval(path, pending));
      }
      return work();
    });
  }

  function withCurriculumLock<T>(
    path: string,
    work: () => Promise<T>,
  ): Promise<T> {
    return withConsistentApproval(() => withFileLock(path, work));
  }

  /** With both locks held, restore an approval only if it never published. */
  async function recoverApproval(
    path: string,
    pending: PendingProfileApproval,
  ): Promise<boolean> {
    const curriculum = await readJson(path, Curriculum);
    let published = false;
    if (
      curriculum?.approval.status === "approved" &&
      curriculum.approval.approvedAt === pending.approvedAt
    ) {
      published = (await readText(profileFile)) === pending.draft.profile;
      if (!published) {
        await writeJson(path, Curriculum, {
          ...curriculum,
          approval: pending.draft,
        });
      }
    }
    await clearPendingApproval();
    return published;
  }

  async function clearPendingApproval(): Promise<void> {
    await rm(pendingFile, { force: true });
    // Don't let an old journal reappear after a subsequent profile edit.
    await syncFolder(options.path);
  }

  function withConsistentNotes<T>(work: () => Promise<T>): Promise<T> {
    return withFileLock(pendingNotesFile, async () => {
      const pending = await readJson(pendingNotesFile, PendingNotes);
      if (pending !== undefined) await recoverNotes(pending);
      return work();
    });
  }

  /** The HTML rename commits the revision, even if its following sync failed. */
  async function recoverNotes({
    courseId,
    unitId,
    source,
  }: PendingNotes): Promise<boolean> {
    const base = notesPath(courseId, unitId);
    const html = await readText(`${base}.html`);
    const published =
      html?.endsWith(notesRevisionMarker(source.revision)) === true;
    if (published) await writeJson(`${base}.json`, NotesSource, source);
    await clearPendingNotes();
    return published;
  }

  async function clearPendingNotes(): Promise<void> {
    await rm(pendingNotesFile, { force: true });
    await syncFolder(options.path);
  }

  function withConsistentSnapshot<T>(work: () => Promise<T>): Promise<T> {
    return withConsistentApproval(() =>
      withConsistentNotes(() => withFileLock(courses, work)),
    );
  }

  async function listCourses(skipUnreadable: boolean): Promise<StoredCourse[]> {
    let entries: string[];
    try {
      entries = (await readdir(courses, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
    } catch (error) {
      if (hasCode(error, "ENOENT")) return [];
      throw error;
    }
    const read = skipUnreadable
      ? (id: string) => readCourse(id).catch(() => undefined)
      : readCourse;
    const found = await Promise.all(entries.map(read));
    return found
      .filter((entry) => entry !== undefined)
      .sort(
        (a, b) =>
          Date.parse(b.course.lastOpenedAt) -
            Date.parse(a.course.lastOpenedAt) || a.id.localeCompare(b.id),
      );
  }

  /** A unit's folder under the course's `units/`, which need not exist yet. */
  function unitFolder(id: string, unitId: string): string {
    return courseFile(id, join("units", Slug.parse(unitId)));
  }

  function notesPath(id: string, unitId: string): string {
    return courseFile(id, join("notes", Slug.parse(unitId)));
  }

  /** A file in the course's folder, which need not exist yet. */
  function courseFile(id: string, name: string): string {
    if (!Slug.safeParse(id).success) throw new Error(noCourse(id));
    return join(courses, id, name);
  }

  /** The intake's folder in uploads/, made if it is missing. */
  async function intakeUploads(intakeId: string): Promise<string> {
    if (!INTAKE_ID.test(intakeId)) {
      throw new Error(`"${intakeId}" cannot be an intake's id.`);
    }
    const folder = resolve(uploads, intakeId);
    await mkdir(folder, { recursive: true });
    return folder;
  }

  /** The course's sources/, made if it is missing; the course must exist. */
  async function courseSources(id: string): Promise<string> {
    await existingCourse(id);
    const folder = resolve(courseFile(id, "sources"));
    if ((await mkdir(folder, { recursive: true })) !== undefined) {
      await syncFolder(dirname(folder));
    }
    return folder;
  }

  return {
    async createCourse({ title, reserved }) {
      const stamp = now().toISOString();
      const course = Course.parse({
        title,
        backend: "claude",
        settings: { webSearch: false },
        createdAt: stamp,
        instance: randomUUID(),
        lastOpenedAt: stamp,
      });
      await mkdir(courses, { recursive: true });
      const id = await makeFolder(courses, idFromTitle(course.title));
      reserved?.(id);
      await writeJson(join(courses, id, "course.json"), Course, course);
      return { id, course, curriculum: null };
    },

    listCourses: ({ skipUnreadable = false } = {}) =>
      withConsistentApproval(() => listCourses(skipUnreadable)),

    readCourse: (id) => withConsistentApproval(() => readCourse(id)),

    async deleteCourse(id) {
      if (!Slug.safeParse(id).success) return false;
      const folder = join(courses, id);
      // Hidden and ending in .tmp, so the library and the backup skip it.
      const parked = join(courses, `.${id}.${randomUUID()}.tmp`);
      // Wait for record recovery and backup staging before moving the folder.
      const moved = await withFileLock(courseFile(id, "state.json"), () =>
        withConsistentSnapshot(async () => {
          try {
            await rename(folder, parked);
            return true;
          } catch (error) {
            if (hasCode(error, "ENOENT")) return false;
            throw error;
          }
        }),
      );
      if (!moved) return false;
      try {
        await rm(parked, { recursive: true, force: true });
      } catch (error) {
        console.error(
          `The deleted course "${id}" could not be removed from ${parked}:`,
          error,
        );
      }
      return true;
    },

    async workspaceFolder(id) {
      const folder = resolve(courseFile(id, "workspace"));
      await mkdir(folder, { recursive: true });
      return folder;
    },

    async intakeFolder() {
      const folder = resolve(options.path, "intake");
      await mkdir(folder, { recursive: true });
      return folder;
    },

    async markOpened(id, unitId) {
      const unit = unitId === undefined ? undefined : Slug.parse(unitId);
      // saveProposal writes course.json too, under the curriculum's lock, but
      // only for a draft, and units are opened only once it is approved.
      const path = courseFile(id, "course.json");
      return withFileLock(path, async () => {
        const stored = await existingCourse(id);
        const stamp = now().toISOString();
        const course: Course = {
          ...stored.course,
          lastOpenedAt: stamp,
          ...(unit === undefined
            ? {}
            : {
                unitsOpenedAt: {
                  ...stored.course.unitsOpenedAt,
                  [unit]: stamp,
                },
              }),
        };
        await writeJson(path, Course, course);
        return { ...stored, course };
      });
    },

    async markReviewOffered(id, at, { requested } = {}) {
      const path = courseFile(id, "course.json");
      return withFileLock(path, async () => {
        const stored = await existingCourse(id);
        const last = stored.course.reviewOfferedAt;
        if (
          requested !== true &&
          last !== undefined &&
          at.getTime() - Date.parse(last) < SESSION_GAP_MS
        ) {
          return false;
        }
        const course: Course = {
          ...stored.course,
          reviewOfferedAt: at.toISOString(),
        };
        await writeJson(path, Course, course);
        return true;
      });
    },

    async readStyle(id) {
      await existingCourse(id);
      const path = courseFile(id, "state.json");
      return withFileLock(path, async () => {
        await recoverStyle(id, path);
        return readNote(id, "style.md");
      });
    },

    async readBackground(id) {
      await existingCourse(id);
      return readNote(id, "background.md");
    },

    readProfile: () => withConsistentApproval(() => readText(profileFile)),

    async writeProfile(text, was) {
      await withConsistentApproval(() => replaceProfile(text, was));
    },

    withConsistentSnapshot,

    async saveProposal(id, proposal) {
      const { title, units, style, background, profile } =
        CurriculumProposal.parse(proposal);
      const path = courseFile(id, "curriculum.json");
      return withCurriculumLock(path, async () => {
        const stored = await existingCourse(id);
        if (stored.curriculum?.approval.status === "approved") {
          throw new Error(
            `The curriculum of "${id}" is approved, so a draft cannot replace it.`,
          );
        }
        const curriculum: Curriculum = {
          approval: {
            status: "draft",
            ...(profile === undefined ? {} : { profile }),
            ...(proposal.profileWas === undefined
              ? {}
              : { profileWas: proposal.profileWas }),
          },
          units,
        };
        await writeJson(path, Curriculum, curriculum);
        await writeFileAtomic(courseFile(id, "style.md"), `${style}\n`);
        await writeFileAtomic(
          courseFile(id, "background.md"),
          `${background}\n`,
        );
        const course = { ...stored.course, title };
        if (title !== stored.course.title) {
          await writeJson(courseFile(id, "course.json"), Course, course);
        }
        return { id, course, curriculum };
      });
    },

    async approveCurriculum(id, shown) {
      const path = courseFile(id, "curriculum.json");
      return withCurriculumLock(path, async () => {
        const stored = await existingCourse(id);
        if (stored.curriculum === null) {
          throw new Error(`"${id}" has no curriculum to approve.`);
        }
        const { approval } = stored.curriculum;
        if (approval.status === "approved") {
          throw new Error(`The curriculum of "${id}" is already approved.`);
        }
        // A partly saved proposal must not approve changes the card never showed.
        const differ: string[] = [];
        if (stored.course.title !== shown.title) differ.push("title");
        if (!isDeepStrictEqual(stored.curriculum.units, shown.units)) {
          differ.push("units");
        }
        if ((await readNote(id, "style.md")) !== shown.style) {
          differ.push("style note");
        }
        if ((await readNote(id, "background.md")) !== shown.background) {
          differ.push("background note");
        }
        const { profile, profileWas } = approval;
        if (profile !== shown.profile || profileWas !== shown.profileWas) {
          differ.push("profile");
        }
        if (differ.length > 0) throw new DraftMismatch(id, differ);

        const approvedAt = now().toISOString();
        const curriculum: Curriculum = {
          ...stored.curriculum,
          approval: { status: "approved", approvedAt },
        };
        const next = { ...stored, curriculum };
        if (profile === undefined) {
          await writeJson(path, Curriculum, curriculum);
          return next;
        }
        const current = (await readText(profileFile)) ?? null;
        if (profileWas === undefined || current !== profileWas) {
          throw new ProfileChanged();
        }
        if (current === profile) {
          await writeJson(path, Curriculum, curriculum);
          return next;
        }

        // The journal is durable before either write; publishing the profile
        // last commits the pair. A crash before cleanup is recovered on access.
        const pending = {
          courseId: stored.id,
          approvedAt,
          draft: { ...approval, profile },
        };
        await writeJson(pendingFile, PendingProfileApproval, pending);
        try {
          await writeJson(path, Curriculum, curriculum);
          await writeFileAtomic(profileFile, `${profile}\n`);
          await clearPendingApproval();
        } catch (error) {
          if (!(await recoverApproval(path, pending))) throw error;
        }
        return next;
      });
    },

    async storePlan(id, unitId, plan) {
      const checked = Plan.parse(plan);
      const path = courseFile(id, "curriculum.json");
      return withCurriculumLock(path, async () => {
        const stored = await existingCourse(id);
        const { curriculum } = stored;
        if (curriculum?.approval.status !== "approved") {
          throw new Error(
            `The curriculum of "${id}" is not approved, so its units cannot be planned yet.`,
          );
        }
        const at = curriculum.units.findIndex((unit) => unit.id === unitId);
        const unit = curriculum.units[at];
        if (unit === undefined) {
          throw new Error(`"${unitId}" is not a unit of "${id}".`);
        }
        if (unit.plan !== undefined) {
          throw new Error(`Unit "${unitId}" already has a plan.`);
        }
        const parsed = Curriculum.safeParse({
          ...curriculum,
          units: curriculum.units.with(at, { ...unit, plan: checked }),
        });
        if (!parsed.success) {
          // The messages name the clashing ids; the paths would point into
          // the whole curriculum, which the planning session does not see.
          throw new Error(
            parsed.error.issues.map((issue) => issue.message).join("\n"),
          );
        }
        await writeJson(path, Curriculum, parsed.data);
        return { ...stored, curriculum: parsed.data };
      });
    },

    async readState(id) {
      const path = courseFile(id, "state.json");
      await existingCourse(id);
      const state = await readStateFile(path);
      if (!changeWaits(state)) return state;
      return withFileLock(path, async () =>
        recoverCurriculum(
          path,
          await readStateFile(path),
          (await existingCourse(id)).curriculum,
        ),
      );
    },

    async writePosition(
      id,
      unitId,
      position,
      { completion, testedOut, style, curriculum, finished } = {},
    ) {
      const unit = Slug.parse(unitId);
      // Checked and copied now, so a later change to the caller's object
      // cannot reach a write still waiting its turn.
      const checked = position === null ? null : UnitPosition.parse(position);
      const completed =
        completion === undefined
          ? undefined
          : PackageCompletion.parse(completion);
      const decision =
        style !== undefined && "decision" in style
          ? StyleDecision.parse(style.decision)
          : undefined;
      const answer =
        curriculum !== undefined && "decision" in curriculum
          ? CurriculumDecision.parse(curriculum.decision)
          : undefined;
      const path = courseFile(id, "state.json");
      return withFileLock(path, async () => {
        const stored = await existingCourse(id);
        const before = await recoverCurriculum(
          path,
          await recoverStyle(id, path),
          stored.curriculum,
        );
        const decisions = decisionsOf(before.styleDecisions, unit);
        const answers = decisionsOf(before.curriculumDecisions, unit);
        if (
          (decision !== undefined || answer !== undefined) &&
          stored.curriculum?.approval.status !== "approved"
        ) {
          throw new Error(`The curriculum of "${id}" is not approved.`);
        }
        if (decision !== undefined) {
          if (decisions.some((d) => d.proposalId === decision.proposalId)) {
            return before;
          }
          if (before.units[unit]?.styleProposal?.id !== decision.proposalId) {
            throw new Error("That proposed style note is not waiting.");
          }
        }
        const change = before.units[unit]?.curriculumChange;
        if (answer !== undefined) {
          // Answered already, or applied before a restart cut the write short.
          if (answers.some((d) => d.proposalId === answer.proposalId)) {
            return before;
          }
          if (change?.id !== answer.proposalId) {
            throw new Error("That proposed curriculum change is not waiting.");
          }
        }
        // A later move can still carry a proposal that recovery removed,
        // even if another Apply has changed the curriculum since.
        let position = checked;
        const waiting = checked?.curriculumChange;
        if (
          checked !== null &&
          waiting !== undefined &&
          answers.some((d) => d.proposalId === waiting.id)
        ) {
          const { curriculumChange: _, ...rest } = checked;
          position = rest;
        }
        const state: State =
          finished === true
            ? withReview(before, unit, position)
            : {
                ...before,
                units:
                  position === null
                    ? Object.fromEntries(
                        Object.entries(before.units).filter(
                          ([key]) => key !== unit,
                        ),
                      )
                    : { ...before.units, [unit]: position },
              };
        if (checked === null && testedOut === true) {
          state.testedOut = { ...before.testedOut, [unit]: true };
        }
        if (completed !== undefined) {
          const completions = before.packageCompletions ?? {};
          const forUnit = Object.hasOwn(completions, unit)
            ? completions[unit]
            : undefined;
          state.packageCompletions = {
            ...completions,
            [unit]: { ...forUnit, [completed.request.id]: completed },
          };
        }
        if (style !== undefined) {
          const pending = withDecisions(
            before.styleDecisions,
            unit,
            decision !== undefined
              ? [...decisions, decision]
              : "delivered" in style
                ? undelivered(decisions, style.delivered)
                : decisions,
          );
          if (pending === undefined) delete state.styleDecisions;
          else state.styleDecisions = pending;
        }
        if (curriculum !== undefined) {
          const pending = withDecisions(
            before.curriculumDecisions,
            unit,
            answer !== undefined
              ? [...answers, answer]
              : "delivered" in curriculum
                ? undelivered(answers, curriculum.delivered)
                : answers,
          );
          if (pending === undefined) delete state.curriculumDecisions;
          else state.curriculumDecisions = pending;
        }
        if (decision?.outcome === "applied") {
          return withFileLock(courses, () =>
            applyStyle(id, path, before, state, unit, decision),
          );
        }
        if (answer?.outcome === "applied" && change !== undefined) {
          return withCurriculumLock(courseFile(id, "curriculum.json"), () =>
            withFileLock(courses, () =>
              applyCurriculum(id, path, state, unit, change),
            ),
          );
        }
        // A position the caller kept from before an Apply was recovered
        // must not bring its change back.
        const settled = settleApplied(state, stored.curriculum?.units);
        await writeJson(path, State, settled);
        return settled;
      });
    },

    async changeCurriculum(id, units) {
      const path = courseFile(id, "state.json");
      const file = courseFile(id, "curriculum.json");
      // The state's lock first, as writePosition takes it, so no unit's
      // position or plan can start one between the check and the write.
      await withFileLock(path, async () => {
        const stored = await existingCourse(id);
        const state = await recoverCurriculum(
          path,
          await recoverStyle(id, path),
          stored.curriculum,
        );
        await withCurriculumLock(file, () =>
          withFileLock(courses, async () => {
            const current = (await readCourse(id))?.curriculum;
            const changed = changedCurriculum(id, current, state, units);
            if (current != null && sameUnits(current.units, units)) return;
            try {
              await writeJson(file, Curriculum, changed);
            } catch (error) {
              // A directory sync can fail after the rename published the change.
              const published = (await readCourse(id))?.curriculum;
              if (
                published?.approval.status !== "approved" ||
                !sameUnits(published.units, units)
              ) {
                throw error;
              }
            }
          }),
        );
      });
    },

    async appendEvidence(id, entry) {
      const checked = EvidenceEntry.parse(entry);
      const path = courseFile(id, "evidence.jsonl");
      await withFileLock(path, async () => {
        await existingCourse(id);
        await appendJsonLine(path, checked);
      });
    },

    async readEvidence(id) {
      const path = courseFile(id, "evidence.jsonl");
      await existingCourse(id);
      return readJsonLines(path, EvidenceEntry);
    },

    async appendDispute(id, dispute, override) {
      const entries = [
        DisputeEvidence.parse(dispute),
        ...(override === undefined ? [] : [OverrideEvidence.parse(override)]),
      ];
      const path = courseFile(id, "evidence.jsonl");
      await withFileLock(path, async () => {
        await existingCourse(id);
        const evidence = await readJsonLines(path, EvidenceEntry);
        const answer = disputable(evidence, dispute.questionId);
        if (!answer.ok) throw new DisputeRefused(answer.status, answer.error);
        await appendJsonLines(path, entries);
      });
    },

    async appendTranscript(id, unitId, session, events) {
      const unit = Slug.parse(unitId);
      const number = SessionNumber.parse(session);
      const checked = events.map((event) => PageEvent.parse(event));
      const folder = courseFile(id, "sessions");
      const path = join(folder, transcriptName(unit, number));
      await withFileLock(path, async () => {
        await existingCourse(id);
        await mkdir(folder, { recursive: true });
        await appendJsonLines(path, checked, { flush: false });
      });
    },

    async writeArtifact(id, { title, html }) {
      await existingCourse(id);
      const folder = courseFile(id, "artifacts");
      return withFileLock(folder, async () => {
        await mkdir(folder, { recursive: true });
        let highest = 0;
        for (const name of await readdir(folder)) {
          highest = Math.max(highest, artifactNumber(name));
        }
        const slug = idFromTitle(title, ARTIFACT_SLUG_LENGTH, "artifact");
        for (let number = highest + 1; Number.isSafeInteger(number); number++) {
          const file = ArtifactFile.parse(`${number}-${slug}.html`);
          if (await writeFileNew(join(folder, file), html)) {
            return { number, file };
          }
        }
        throw new Error("No safe artifact number is available in this course.");
      });
    },

    async readArtifact(id, file) {
      if (
        !Slug.safeParse(id).success ||
        !ArtifactFile.safeParse(file).success
      ) {
        return undefined;
      }
      try {
        return await readFile(join(courses, id, "artifacts", file), "utf8");
      } catch (error) {
        if (hasCode(error, "ENOENT")) return undefined;
        throw error;
      }
    },

    async readNotes(id, unitId) {
      const base = notesPath(id, unitId);
      const path = `${base}.html`;
      return withConsistentNotes(async () => {
        try {
          if (!(await stat(path)).isFile()) return undefined;
        } catch (error) {
          if (hasCode(error, "ENOENT")) return undefined;
          throw error;
        }
        const source = await readJson(`${base}.json`, NotesSource);
        if (source === undefined)
          throw new Error(`The notes at ${path} have no source record.`);
        return {
          path,
          instructions: source.instructions,
          writtenAt: source.writtenAt,
          revision: source.revision ?? source.writtenAt,
        };
      });
    },

    async readNotesHtml(id, unitId) {
      return withConsistentNotes(async () => {
        try {
          return await readFile(`${notesPath(id, unitId)}.html`, "utf8");
        } catch (error) {
          if (hasCode(error, "ENOENT")) return undefined;
          throw error;
        }
      });
    },

    async writeNotes(id, unitId, html, source) {
      const base = notesPath(id, unitId);
      await withConsistentNotes(async () => {
        const folder = courseFile(id, "notes");
        if ((await mkdir(folder, { recursive: true })) !== undefined) {
          await syncFolder(join(folder, ".."));
        }
        const revision = randomUUID();
        const pending = {
          courseId: id,
          unitId,
          source: { ...source, revision },
        };
        await writeJson(pendingNotesFile, PendingNotes, pending);
        try {
          await writeFileAtomic(
            `${base}.html`,
            html + notesRevisionMarker(revision),
          );
          await writeJson(`${base}.json`, NotesSource, pending.source);
          await clearPendingNotes();
        } catch (error) {
          if (!(await recoverNotes(pending))) throw error;
        }
      });
    },

    async readHandoff(id, unitId) {
      const folder = unitFolder(id, unitId);
      await existingCourse(id);
      let note: string;
      try {
        note = (await readFile(join(folder, "handoff.md"), "utf8")).trim();
      } catch (error) {
        if (hasCode(error, "ENOENT")) return undefined;
        throw error;
      }
      if (note === "") return undefined;
      return {
        note,
        mark: await readJson(join(folder, "handoff.json"), HandoffMark),
      };
    },

    async writeHandoff(id, unitId, note, mark) {
      const checked = HandoffMark.parse(mark);
      const folder = unitFolder(id, unitId);
      await existingCourse(id);
      await withFileLock(folder, async () => {
        await mkdir(folder, { recursive: true });
        await writeFileAtomic(join(folder, "handoff.md"), `${note.trim()}\n`);
        await writeJson(join(folder, "handoff.json"), HandoffMark, checked);
      });
    },

    async appendMisconceptions(id, entries) {
      const checked = entries.map((entry) => Misconception.parse(entry));
      const path = courseFile(id, "misconceptions.jsonl");
      await withFileLock(path, async () => {
        await existingCourse(id);
        await appendJsonLines(path, checked);
      });
    },

    async readMisconceptions(id) {
      const path = courseFile(id, "misconceptions.jsonl");
      await existingCourse(id);
      return readJsonLines(path, Misconception);
    },

    async readTranscripts(id, unitId) {
      const unit = Slug.parse(unitId);
      const folder = courseFile(id, "sessions");
      await existingCourse(id);
      let names: string[];
      try {
        names = await readdir(folder);
      } catch (error) {
        if (hasCode(error, "ENOENT")) return [];
        throw error;
      }
      const sessions = names
        .map((name) => sessionOf(unit, name))
        .filter((session) => session !== undefined)
        .sort((a, b) => a - b);
      return Promise.all(
        sessions.map(async (session) => {
          const unreadable: string[] = [];
          const events = await readJsonLines(
            join(folder, transcriptName(unit, session)),
            PageEvent,
            (problem) => unreadable.push(problem),
          );
          return { session, events, unreadable };
        }),
      );
    },

    uploadsFolder: intakeUploads,

    async clearUploads() {
      await rm(uploads, { recursive: true, force: true });
    },

    async placeSource(converted, into) {
      const file = join(converted, "outline.json");
      const outline = await readJson(file, Outline);
      if (outline === undefined) throw new Error(`${file} is missing.`);
      const parent =
        "course" in into
          ? await courseSources(into.course)
          : await intakeUploads(into.intake);
      return withFileLock(parent, async () => {
        const base = idFromTitle(outline.title, ID_LENGTH, "source");
        for (let n = 1; ; n++) {
          const id = n === 1 ? base : `${base}-${n}`;
          const at = join(parent, id);
          if (await sourcePathTaken(at)) continue;
          const placed: Outline = { ...outline, id };
          await writeJson(file, Outline, placed);
          await publishSource(converted, at);
          return placed;
        }
      });
    },

    async moveUpload(intakeId, sourceId, courseId) {
      const from = join(await intakeUploads(intakeId), Slug.parse(sourceId));
      const sources = await courseSources(courseId);
      await withFileLock(sources, async () => {
        const to = join(sources, sourceId);
        if (await sourcePathTaken(to)) {
          throw new Error(`The source path ${to} is already taken.`);
        }
        await publishSource(from, to);
      });
    },

    async removeUpload(intakeId, sourceId) {
      const folder = await intakeUploads(intakeId);
      await rm(join(folder, Slug.parse(sourceId)), {
        recursive: true,
        force: true,
      });
      await syncFolder(folder);
    },

    async readSources(id) {
      await existingCourse(id);
      const folder = courseFile(id, "sources");
      let ids: string[];
      try {
        ids = (await readdir(folder, { withFileTypes: true }))
          .filter((e) => e.isDirectory() && Slug.safeParse(e.name).success)
          .map((e) => e.name)
          .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      } catch (error) {
        if (hasCode(error, "ENOENT")) return [];
        throw error;
      }
      return Promise.all(
        ids.map(async (sourceId) => {
          const file = join(folder, sourceId, "outline.json");
          const outline = await readJson(file, Outline);
          if (outline === undefined) throw new Error(`${file} is missing.`);
          if (outline.id !== sourceId) {
            throw new Error(
              `${file} names the source "${outline.id}", not its folder's "${sourceId}".`,
            );
          }
          return outline;
        }),
      );
    },
  };
}

function notesRevisionMarker(revision: string): string {
  return `\n<!-- Gauss notes revision: ${revision} -->`;
}

const SessionNumber = z.number().int().positive();

/** The file name of a unit's session transcript. */
function transcriptName(unitId: Slug, session: number): string {
  return `${unitId}.${session}.jsonl`;
}

/** The session number in the name of one of the unit's transcripts; undefined for any other file. */
function sessionOf(unitId: Slug, name: string): number | undefined {
  const match = /^(.+)\.([1-9][0-9]*)\.jsonl$/.exec(name);
  return match?.[1] === unitId ? Number(match[2]) : undefined;
}

function noCourse(id: string): string {
  return `There is no course "${id}".`;
}

/** The unit's decisions not yet delivered; its own entry only. */
function decisionsOf<T>(
  byUnit: Record<string, T[]> | undefined,
  unit: string,
): T[] {
  return byUnit !== undefined && Object.hasOwn(byUnit, unit)
    ? (byUnit[unit] ?? [])
    : [];
}

/** The decisions by unit with this unit's replaced; undefined once none is left. */
function withDecisions<T>(
  byUnit: Record<string, T[]> | undefined,
  unit: string,
  remaining: T[],
): Record<string, T[]> | undefined {
  const next = { ...byUnit };
  if (remaining.length === 0) delete next[unit];
  else next[unit] = remaining;
  return Object.keys(next).length === 0 ? undefined : next;
}

function undelivered<T extends { proposalId: string }>(
  decisions: readonly T[],
  delivered: readonly T[],
): T[] {
  return decisions.filter(
    (d) => !delivered.some((sent) => sent.proposalId === d.proposalId),
  );
}

/** Whether a curriculum change waits in a unit of the course. */
function changeWaits(state: State): boolean {
  return Object.values(state.units).some(
    (p) => p.curriculumChange !== undefined,
  );
}

/** The state with the finished unit's review position set, or taken out with null. */
function withReview(
  state: State,
  unit: Slug,
  position: UnitPosition | null,
): State {
  const { finishedReviews, ...rest } = state;
  const others = Object.fromEntries(
    Object.entries(finishedReviews ?? {}).filter(([key]) => key !== unit),
  );
  const reviews = position === null ? others : { ...others, [unit]: position };
  return Object.keys(reviews).length === 0
    ? rest
    : { ...rest, finishedReviews: reviews };
}

/**
 * The state with each waiting change that `units` already hold taken out of
 * its position and recorded as applied, unless it is recorded already; the
 * same object when there is none.
 */
function settleApplied(
  state: State,
  units: readonly Unit[] | undefined,
): State {
  if (units === undefined || !changeWaits(state)) return state;
  let next = state;
  for (const [unit, position] of Object.entries(state.units)) {
    const change = position.curriculumChange;
    if (change === undefined || !sameUnits(units, change.units)) continue;
    const { curriculumChange: _, ...rest } = position;
    const answers = decisionsOf(next.curriculumDecisions, unit);
    const recorded = answers.some((d) => d.proposalId === change.id);
    next = {
      ...next,
      units: { ...next.units, [unit]: rest },
      curriculumDecisions: recorded
        ? (next.curriculumDecisions ?? {})
        : {
            ...next.curriculumDecisions,
            [unit]: [...answers, { proposalId: change.id, outcome: "applied" }],
          },
    };
  }
  return next;
}

/** The number an artifact's file name starts with; 0 for any other file. */
function artifactNumber(name: string): number {
  return ArtifactFile.safeParse(name).success ? Number.parseInt(name, 10) : 0;
}

/** Leaves room within Slug's 60 characters for a "-2" or longer suffix. */
const ID_LENGTH = 50;

/** An intake's id, its event log's: a UUID as `randomUUID` writes it. */
const INTAKE_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Enough of an artifact's title for its file to be found by eye. */
const ARTIFACT_SLUG_LENGTH = 40;

/**
 * The title's letters and digits as a slug, cut at a word within `length`;
 * `fallback` if it has none.
 */
function idFromTitle(
  title: string,
  length = ID_LENGTH,
  fallback = "course",
): string {
  const words =
    title
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .match(/[a-z0-9]+/g) ?? [];
  let id = "";
  for (const word of words) {
    const longer = id === "" ? word : `${id}-${word}`;
    if (longer.length > length) break;
    id = longer;
  }
  return id || words[0]?.slice(0, length) || fallback;
}

/**
 * Makes a new folder named `base`, or `base-2`, `base-3` and so on when that
 * is taken, and returns the name it made. Making the folder is what claims
 * the name, so two creations can never share one.
 */
async function makeFolder(parent: string, base: string): Promise<Slug> {
  for (let n = 1; ; n++) {
    const name = n === 1 ? base : `${base}-${n}`;
    try {
      await mkdir(join(parent, name));
      return name;
    } catch (error) {
      if (!hasCode(error, "EEXIST")) throw error;
    }
  }
}

/** Includes empty folders and dangling symlinks. */
async function sourcePathTaken(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (hasCode(error, "ENOENT")) return false;
    throw error;
  }
}

/** Publishes a prepared directory at an unused path under its parent's lock. */
async function publishSource(from: string, to: string): Promise<void> {
  await rename(from, to);
  const parent = dirname(to);
  await syncFolder(parent);
  const previous = dirname(from);
  if (previous !== parent) await syncFolder(previous);
}

/** A text file's contents, trimmed; undefined if there is no file or it is blank. */
async function readText(path: string): Promise<string | undefined> {
  return (await readFileText(path))?.trim() || undefined;
}

/** The file's contents as written; undefined if there is no file. */
async function readFileText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (hasCode(error, "ENOENT")) return undefined;
    throw error;
  }
}

/** The file's contents checked against the schema; undefined if there is no file. */
async function readJson<T>(
  path: string,
  schema: z.ZodType<T>,
): Promise<T | undefined> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (hasCode(error, "ENOENT")) return undefined;
    throw error;
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new Error(`${path} is not valid JSON.`, { cause: error });
  }
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    throw new Error(
      `${path} does not match its schema:\n${z.prettifyError(parsed.error)}`,
    );
  }
  return parsed.data;
}

/** Writes the value as JSON once the schema accepts it. */
async function writeJson<T>(
  path: string,
  schema: z.ZodType<T>,
  value: T,
): Promise<void> {
  const checked = schema.parse(value);
  await writeFileAtomic(path, `${JSON.stringify(checked, null, 2)}\n`);
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
