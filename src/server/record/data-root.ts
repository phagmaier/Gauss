// The data root: the folder that holds every course (architecture.md
// section 3). This module creates, lists and reads courses, and stores and
// approves their curricula; later tasks add the rest of the course record.
// Every write goes through writeFileAtomic, and every file read or written
// is checked against its schema in src/shared/.

import { mkdir, readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { z } from "zod";
import { Course, Slug } from "../../shared/course.ts";
import { Curriculum, CurriculumProposal } from "../../shared/curriculum.ts";
import type { StoredCourse } from "../../shared/library.ts";
import { writeFileAtomic } from "./atomic-write.ts";

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
    if (stored === undefined) throw new Error(`There is no course "${id}".`);
    return stored;
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
      const stored = await existingCourse(id);
      if (stored.curriculum?.approval.status === "approved") {
        throw new Error(
          `The curriculum of "${id}" is approved, so a draft cannot replace it.`,
        );
      }
      const folder = join(courses, id);
      const curriculum: Curriculum = { approval: { status: "draft" }, units };
      await writeJson(join(folder, "curriculum.json"), Curriculum, curriculum);
      const course = { ...stored.course, title };
      if (title !== stored.course.title) {
        await writeJson(join(folder, "course.json"), Course, course);
      }
      return { id, course, curriculum };
    },

    async approveCurriculum(id) {
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
      await writeJson(
        join(courses, id, "curriculum.json"),
        Curriculum,
        curriculum,
      );
      return { ...stored, curriculum };
    },
  };
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
