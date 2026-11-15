// The data root: the folder that holds every course (architecture.md
// section 3). This module creates, lists and reads courses, stores and
// approves their curricula and the plans of their units, keeps the position
// of each unit in progress in state.json, and appends to and reads the
// evidence log. Every write of a whole file goes through writeFileAtomic, the
// log is appended to, and every file read or written is checked against its
// schema in src/shared/. Work that reads a file and writes it back, and
// every append, runs through withFileLock, so it lands in the order called.

import { mkdir, readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { z } from "zod";
import { Course, Slug } from "../../shared/course.ts";
import { Curriculum, CurriculumProposal } from "../../shared/curriculum.ts";
import { EvidenceEntry } from "../../shared/evidence.ts";
import type { StoredCourse } from "../../shared/library.ts";
import { Plan } from "../../shared/plan.ts";
import { State, UnitPosition } from "../../shared/state.ts";
import { writeFileAtomic } from "./atomic-write.ts";
import { withFileLock } from "./file-lock.ts";
import { appendJsonLine, readJsonLines } from "./json-lines.ts";

/** `GAUSS_DATA_ROOT` when it is set and not empty, otherwise `~/gauss`. */
export function resolveDataRoot(
  env: Readonly<Record<string, string | undefined>> = process.env,
  home: string = homedir(),
): string {
  const chosen = env.GAUSS_DATA_ROOT;
  return chosen ? resolve(chosen) : join(home, "gauss");
}

export interface DataRoot {
  /** Makes the course's folder and its course.json. The id comes from the title. */
  createCourse(input: { title: string }): Promise<StoredCourse>;
  /**
   * Every course, most recently opened first. A folder without course.json
   * (a creation that stopped partway) is left out.
   */
  listCourses(): Promise<StoredCourse[]>;
  /** One course, or undefined when no course has that id. */
  readCourse(id: string): Promise<StoredCourse | undefined>;
  /**
   * Stores the tutor's proposal as the course's draft curriculum, replacing
   * any earlier draft, and its title as the course's title. Refused once the
   * curriculum is approved.
   */
  saveProposal(
    id: string,
    proposal: CurriculumProposal,
  ): Promise<StoredCourse & { curriculum: Curriculum }>;
  /** Approves the draft curriculum, at the clock's time. */
  approveCurriculum(
    id: string,
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
  /** Where each unit in progress stands; no units when none is. */
  readState(id: string): Promise<State>;
  /**
   * Sets the unit's position in state.json, or with null takes the unit out
   * (it is no longer in progress), and returns the state as written. Writes
   * land in the order they were called, each on the one before.
   */
  writePosition(
    id: string,
    unitId: string,
    position: UnitPosition | null,
  ): Promise<State>;
  /** Appends one entry to evidence.jsonl. Appends land in the order called. */
  appendEvidence(id: string, entry: EvidenceEntry): Promise<void>;
  /** The evidence, oldest first, without a last line a crash cut short. */
  readEvidence(id: string): Promise<EvidenceEntry[]>;
}

export function openDataRoot(options: {
  path: string;
  /** The clock for the dates in the record; tests set it. */
  now?: () => Date;
}): DataRoot {
  const courses = join(options.path, "courses");
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

  /** A file in the course's folder, which need not exist yet. */
  function courseFile(id: string, name: string): string {
    if (!Slug.safeParse(id).success) throw new Error(noCourse(id));
    return join(courses, id, name);
  }

  return {
    async createCourse({ title }) {
      const stamp = now().toISOString();
      const course = Course.parse({
        title,
        backend: "claude",
        settings: { webSearch: false },
        createdAt: stamp,
        lastOpenedAt: stamp,
      });
      await mkdir(courses, { recursive: true });
      const id = await makeFolder(courses, idFromTitle(course.title));
      await writeJson(join(courses, id, "course.json"), Course, course);
      return { id, course, curriculum: null };
    },

    async listCourses() {
      let entries: string[];
      try {
        entries = (await readdir(courses, { withFileTypes: true }))
          .filter((entry) => entry.isDirectory())
          .map((entry) => entry.name);
      } catch (error) {
        if (hasCode(error, "ENOENT")) return [];
        throw error;
      }
      const found = await Promise.all(entries.map(readCourse));
      return found
        .filter((entry) => entry !== undefined)
        .sort(
          (a, b) =>
            Date.parse(b.course.lastOpenedAt) -
              Date.parse(a.course.lastOpenedAt) || a.id.localeCompare(b.id),
        );
    },

    readCourse,

    async saveProposal(id, proposal) {
      const { title, units } = CurriculumProposal.parse(proposal);
      const path = courseFile(id, "curriculum.json");
      return withFileLock(path, async () => {
        const stored = await existingCourse(id);
        if (stored.curriculum?.approval.status === "approved") {
          throw new Error(
            `The curriculum of "${id}" is approved, so a draft cannot replace it.`,
          );
        }
        const curriculum: Curriculum = {
          approval: { status: "draft" },
          units,
        };
        await writeJson(path, Curriculum, curriculum);
        const course = { ...stored.course, title };
        if (title !== stored.course.title) {
          await writeJson(courseFile(id, "course.json"), Course, course);
        }
        return { id, course, curriculum };
      });
    },

    async approveCurriculum(id) {
      const path = courseFile(id, "curriculum.json");
      return withFileLock(path, async () => {
        const stored = await existingCourse(id);
        if (stored.curriculum === null) {
          throw new Error(`"${id}" has no curriculum to approve.`);
        }
        if (stored.curriculum.approval.status === "approved") {
          throw new Error(`The curriculum of "${id}" is already approved.`);
        }
        const curriculum: Curriculum = {
          ...stored.curriculum,
          approval: { status: "approved", approvedAt: now().toISOString() },
        };
        await writeJson(path, Curriculum, curriculum);
        return { ...stored, curriculum };
      });
    },

    async storePlan(id, unitId, plan) {
      const checked = Plan.parse(plan);
      const path = courseFile(id, "curriculum.json");
      return withFileLock(path, async () => {
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
      return (await readJson(path, State)) ?? { units: {} };
    },

    async writePosition(id, unitId, position) {
      const unit = Slug.parse(unitId);
      // Checked and copied now, so a later change to the caller's object
      // cannot reach a write still waiting its turn.
      const checked = position === null ? null : UnitPosition.parse(position);
      const path = courseFile(id, "state.json");
      return withFileLock(path, async () => {
        await existingCourse(id);
        const before = (await readJson(path, State)) ?? { units: {} };
        const state: State = {
          units:
            checked === null
              ? Object.fromEntries(
                  Object.entries(before.units).filter(([key]) => key !== unit),
                )
              : { ...before.units, [unit]: checked },
        };
        await writeJson(path, State, state);
        return state;
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
  };
}

function noCourse(id: string): string {
  return `There is no course "${id}".`;
}

/** Leaves room within Slug's 60 characters for a "-2" or longer suffix. */
const ID_LENGTH = 50;

/** The title's letters and digits as a slug, cut at a word; "course" if none. */
function idFromTitle(title: string): string {
  const words =
    title
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .match(/[a-z0-9]+/g) ?? [];
  let id = "";
  for (const word of words) {
    const longer = id === "" ? word : `${id}-${word}`;
    if (longer.length > ID_LENGTH) break;
    id = longer;
  }
  return id || words[0]?.slice(0, ID_LENGTH) || "course";
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
