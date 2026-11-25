import { randomUUID } from "node:crypto";
import { type BigIntStats, constants } from "node:fs";
import {
  type FileHandle,
  lstat,
  mkdir,
  open,
  readdir,
  rename,
  rmdir,
  unlink,
} from "node:fs/promises";
import { join } from "node:path";
import { CourseDeletionReceipt, type Slug } from "../../shared/course.ts";
import { writeFileAtomic } from "./atomic-write.ts";

const PARKING_NAME = /^\.[a-z0-9-]+\.([0-9a-f-]{36})\.tmp$/;
const RECEIPT = "receipt.json";
const PAYLOAD = "course";
const DIRECTORY_FLAGS =
  constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;

/** Prepares proof before moving the course; the receipt stays outside recursive removal. */
export async function parkCourse(courses: string, id: Slug) {
  const home = await openDirectory(courses);
  if (home === undefined) return undefined;
  const held = [home];
  let moved = false;
  try {
    const source = at(home, id);
    const course = await openDirectory(source);
    if (course === undefined) return undefined;
    held.push(course);
    const operation = randomUUID();
    // Keep the legacy name shape so existing backup ignore rules still apply.
    const name = `.${id}.${operation}.tmp`;
    await mkdir(at(home, name), { mode: 0o700 });
    const parking = await open(at(home, name), DIRECTORY_FLAGS);
    held.push(parking);
    const courseStat = await course.stat({ bigint: true });
    const receipt = CourseDeletionReceipt.parse({
      operation,
      parkingDirectory: identity(await parking.stat({ bigint: true })),
      courseDirectory: identity(courseStat),
    });
    await writeFileAtomic(at(parking, RECEIPT), JSON.stringify(receipt));
    await home.sync();
    await requireSameDirectory(source, courseStat);
    await rename(source, at(parking, PAYLOAD));
    moved = true;
    return {
      path: join(courses, name),
      async remove() {
        try {
          await finish(home, name, parking, course);
        } finally {
          await Promise.all(held.map((file) => file.close()));
        }
      },
    };
  } finally {
    if (!moved) await Promise.all(held.map((file) => file.close()));
  }
}

/** Called before serving, with exclusive data-root ownership. */
export async function retryParkedCourses(
  courses: string,
  log: (line: string) => void,
): Promise<void> {
  try {
    await using home = await openDirectory(courses);
    if (home === undefined) return;
    const { dev } = await home.stat({ bigint: true });
    for (const entry of await readdir(at(home), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const operation = PARKING_NAME.exec(entry.name)?.[1];
      if (operation === undefined) continue;
      try {
        await using parking = await openDirectory(at(home, entry.name));
        if (parking === undefined) continue;
        const receipt = await readReceipt(at(parking, RECEIPT));
        if (
          receipt?.operation !== operation ||
          !matches(
            await parking.stat({ bigint: true }),
            receipt.parkingDirectory,
            dev,
          )
        ) {
          continue;
        }
        const payloadPath = at(parking, PAYLOAD);
        await using course = await openDirectory(payloadPath);
        if (course !== undefined) {
          if (
            !matches(
              await course.stat({ bigint: true }),
              receipt.courseDirectory,
              dev,
            )
          ) {
            continue;
          }
        } else if (await entryAt(payloadPath)) {
          // A symlink or non-directory in the course's place is not ours.
          continue;
        }
        await finish(home, entry.name, parking, course);
      } catch (error) {
        log(
          `Could not finish deleting the parked course in ${join(courses, entry.name)}: ${error}`,
        );
      }
    }
  } catch (error) {
    log(`Could not look for parked courses in ${courses}: ${error}`);
  }
}

async function finish(
  home: FileHandle,
  name: string,
  parking: FileHandle,
  course: FileHandle | undefined,
): Promise<void> {
  const parkedPath = at(home, name);
  const parkingStat = await parking.stat({ bigint: true });
  // Make the move durable before removing any contents. Keep the receipt
  // until the payload's removal is durable, including across a power cut.
  await parking.sync();
  await home.sync();
  await requireSameDirectory(parkedPath, parkingStat);
  if (course !== undefined) {
    await removeDirectory(at(parking, PAYLOAD), course, parkingStat.dev);
  } else if (await entryAt(at(parking, PAYLOAD))) {
    return;
  }
  await parking.sync();
  // Leave unexpected neighboring files untouched, including their receipt.
  const entries = await readdir(at(parking));
  if (entries.length !== 1 || entries[0] !== RECEIPT) return;
  await requireSameDirectory(parkedPath, parkingStat);
  await unlink(at(parking, RECEIPT));
  await rmdir(parkedPath);
  await home.sync();
}

async function removeDirectory(
  path: string,
  directory: FileHandle,
  device: bigint,
): Promise<void> {
  const expected = await directory.stat({ bigint: true });
  if (expected.dev !== device) {
    throw new Error(
      `Refusing to remove a directory on another filesystem: ${path}`,
    );
  }
  await requireSameDirectory(path, expected);
  for (const entry of await readdir(at(directory), { withFileTypes: true })) {
    const childPath = at(directory, entry.name);
    if (entry.isDirectory()) {
      await using child = await open(childPath, DIRECTORY_FLAGS);
      await removeDirectory(childPath, child, device);
    } else {
      // unlink removes a link itself, not its target, and refuses directories.
      await unlink(childPath);
    }
  }
  await requireSameDirectory(path, expected);
  await rmdir(path);
}

function at(directory: FileHandle, name?: string): string {
  // Linux has flock and procfs. Keep path resolution inside the opened
  // directory even if another process replaces the original pathname.
  return name === undefined
    ? `/proc/self/fd/${directory.fd}`
    : `/proc/self/fd/${directory.fd}/${name}`;
}

async function openDirectory(path: string): Promise<FileHandle | undefined> {
  try {
    return await open(path, DIRECTORY_FLAGS);
  } catch (error) {
    if (
      hasCode(error, "ENOENT") ||
      hasCode(error, "ENOTDIR") ||
      hasCode(error, "ELOOP")
    )
      return undefined;
    throw error;
  }
}

async function requireSameDirectory(
  path: string,
  expected: BigIntStats,
): Promise<void> {
  const found = await entryAt(path);
  if (
    !found?.isDirectory() ||
    found.dev !== expected.dev ||
    found.ino !== expected.ino
  ) {
    throw new Error(`Directory changed during course deletion: ${path}`);
  }
}

function identity(entry: BigIntStats): string {
  // st_dev can change across reboots (e.g. Btrfs subvolumes).
  return `${entry.ino}:${entry.birthtimeNs}`;
}

function matches(
  entry: BigIntStats,
  expected: string,
  device: bigint,
): boolean {
  // A replacement may reuse an inode. Without a birth time, leave it alone.
  return (
    entry.dev === device &&
    entry.birthtimeNs > 0n &&
    identity(entry) === expected
  );
}

async function readReceipt(path: string) {
  const file = await open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  ).catch((error: unknown) => {
    if (hasCode(error, "ENOENT") || hasCode(error, "ELOOP")) return undefined;
    throw error;
  });
  if (file === undefined) return undefined;
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > 512) return undefined;
    const text = await file.readFile("utf8");
    return CourseDeletionReceipt.safeParse(JSON.parse(text)).data;
  } catch (error) {
    if (error instanceof SyntaxError) return undefined;
    throw error;
  } finally {
    await file.close();
  }
}

async function entryAt(path: string): Promise<BigIntStats | undefined> {
  try {
    return await lstat(path, { bigint: true });
  } catch (error) {
    if (hasCode(error, "ENOENT")) return undefined;
    throw error;
  }
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
