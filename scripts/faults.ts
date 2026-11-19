// Checks that the tests catch faults (AGENTS.md, "How to work a task"): puts
// each fault into the code in turn, runs the given test files, puts the code
// back, and says which tests failed. It never calls a model.
//
//   node scripts/faults.ts <faults file>
//   node scripts/faults.ts --restore
//
// The faults file is plain text, so code goes in as it is, unescaped:
//
//   tests: src/server/engine/handoff.test.ts src/web/what-i-know.test.ts
//
//   === the mark is ignored
//   file: src/server/engine/handoff.ts
//   --- find
//       if (mark === undefined || t.session > mark.through.session) {
//   --- replace
//       if (true) {
//
// Paths are from the repository's root. `find` must occur exactly once in
// its file; a block is its lines as they are, less blank lines at its end,
// and an empty `replace` deletes the text. The tests first run with no fault
// and must pass. A fault no test catches is reported MISSED; one that does
// not apply, or that stops a test file from running at all (a syntax error
// shows nothing about the tests), is reported too. Any of these makes the
// exit status 1.
//
// The code is put back after each fault, on an error, and on Ctrl-C or
// SIGTERM. A run killed outright (SIGKILL, as a shell tool's timeout may do)
// leaves the file's original in `.faults/` (git ignores it); the next run
// puts it back before it starts, as `--restore` does. Each fault runs the
// tests again, so give the command a timeout of the baseline's time for each
// fault and one more, or run it in the background.

import { type ChildProcess, spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { constants } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const STATE = join(ROOT, ".faults");
const JOURNAL = join(STATE, "journal.json");
const REPORT = join(STATE, "report.json");
const VITEST = join(ROOT, "node_modules", "vitest", "vitest.mjs");

interface Fault {
  name: string;
  file: string;
  find: string;
  replace: string;
}

/** The file a fault is in, as it was before: what to put back. */
interface Journal {
  pid: number;
  file: string;
  original: string;
}

/** What Vitest's JSON reporter writes, as far as it is read here. */
interface Report {
  testResults: {
    name: string;
    status: string;
    message: string;
    assertionResults: { fullName: string; status: string }[];
  }[];
}

interface Outcome {
  failing: string[];
  /** Test files that did not run at all, each with why. */
  broken: string[];
  seconds: number;
}

function parseFaults(text: string): { tests: string[]; faults: Fault[] } {
  let tests: string[] = [];
  const faults: Fault[] = [];
  let fault:
    | { name: string; file?: string; find?: string[]; replace?: string[] }
    | undefined;
  let block: string[] | undefined;
  const joined = (lines: string[]) => {
    const kept = [...lines];
    while (kept.length > 0 && kept.at(-1)?.trim() === "") kept.pop();
    return kept.join("\n");
  };
  const close = () => {
    if (fault === undefined) return;
    const { name, file, find, replace } = fault;
    if (file === undefined || find === undefined || replace === undefined) {
      throw new Error(
        `Fault "${name}" needs a "file:" line, then a "--- find" and a "--- replace" block.`,
      );
    }
    if (joined(find) === "") throw new Error(`Fault "${name}" finds nothing.`);
    faults.push({ name, file, find: joined(find), replace: joined(replace) });
  };
  for (const [i, line] of text.replace(/\r\n/g, "\n").split("\n").entries()) {
    if (line.startsWith("=== ")) {
      close();
      fault = { name: line.slice(4).trim() };
      block = undefined;
    } else if (line === "--- find" && fault !== undefined) {
      fault.find = block = [];
    } else if (line === "--- replace" && fault?.find !== undefined) {
      fault.replace = block = [];
    } else if (block !== undefined) {
      block.push(line);
    } else if (line.startsWith("file:") && fault !== undefined) {
      fault.file = line.slice(5).trim();
    } else if (line.startsWith("tests:") && fault === undefined) {
      tests = line.slice(6).trim().split(/\s+/).filter(Boolean);
    } else if (line.trim() !== "") {
      throw new Error(
        `Line ${i + 1} of the faults file is not understood: ${line}`,
      );
    }
  }
  close();
  if (tests.length === 0)
    throw new Error('The faults file has no "tests:" line.');
  if (faults.length === 0) throw new Error("The faults file has no fault.");
  return { tests, faults };
}

/** A path from the root, refused if it leads out of the repository. */
function inRoot(path: string): string {
  const full = resolve(ROOT, path);
  const from = relative(ROOT, full);
  if (from.startsWith("..") || isAbsolute(from)) {
    throw new Error(`${path} is outside the repository.`);
  }
  return full;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Puts back the file a fault is in, if one is; returns its path. */
function putBack(): string | undefined {
  if (!existsSync(JOURNAL)) return undefined;
  const journal = JSON.parse(readFileSync(JOURNAL, "utf8")) as Journal;
  const path = inRoot(journal.file);
  writeFileSync(path, journal.original);
  if (readFileSync(path, "utf8") !== journal.original) {
    throw new Error(`${journal.file} could not be put back; see ${JOURNAL}.`);
  }
  rmSync(JOURNAL);
  return journal.file;
}

/** Puts a fault in, or says why it does not apply. */
function putIn(fault: Fault): string | undefined {
  const path = inRoot(fault.file);
  if (!existsSync(path)) return `${fault.file} does not exist`;
  const original = readFileSync(path, "utf8");
  const count = original.split(fault.find).length - 1;
  if (count !== 1) return `"find" occurs ${count} times in ${fault.file}`;
  const journal: Journal = { pid: process.pid, file: fault.file, original };
  writeFileSync(`${JOURNAL}.new`, JSON.stringify(journal));
  renameSync(`${JOURNAL}.new`, JOURNAL);
  writeFileSync(
    path,
    original.replace(fault.find, () => fault.replace),
  );
  return undefined;
}

let child: ChildProcess | undefined;

function runTests(tests: string[]): Promise<Outcome> {
  rmSync(REPORT, { force: true });
  const started = Date.now();
  return new Promise((done, fail) => {
    let stderr = "";
    child = spawn(
      process.execPath,
      [VITEST, "run", "--reporter=json", `--outputFile=${REPORT}`, ...tests],
      { cwd: ROOT, stdio: ["ignore", "ignore", "pipe"] },
    );
    child.stderr?.on("data", (chunk) => {
      stderr = (stderr + chunk).slice(-4000);
    });
    child.on("error", fail);
    child.on("close", (code) => {
      child = undefined;
      const seconds = Math.round((Date.now() - started) / 100) / 10;
      if (!existsSync(REPORT)) {
        const last = stderr.trim().split("\n").slice(-3).join(" / ");
        done({
          failing: [],
          broken: [`Vitest wrote no report (exit ${code}): ${last}`],
          seconds,
        });
        return;
      }
      const report = JSON.parse(readFileSync(REPORT, "utf8")) as Report;
      const failing: string[] = [];
      const broken: string[] = [];
      for (const file of report.testResults) {
        const name = relative(ROOT, file.name);
        const failed = file.assertionResults.filter(
          (a) => a.status === "failed",
        );
        for (const a of failed) failing.push(`${name} > ${a.fullName.trim()}`);
        if (file.status === "failed" && failed.length === 0) {
          const why = file.message.trim().split("\n").filter(Boolean);
          broken.push(`${name}: ${why.slice(0, 2).join(" ")}`);
        }
      }
      done({ failing, broken, seconds });
    });
  });
}

const { values, positionals } = parseArgs({
  options: { restore: { type: "boolean" } },
  allowPositionals: true,
});

mkdirSync(STATE, { recursive: true });
if (existsSync(JOURNAL)) {
  const { pid } = JSON.parse(readFileSync(JOURNAL, "utf8")) as Journal;
  if (pid !== process.pid && alive(pid)) {
    console.error(
      `Another run (pid ${pid}) has a fault in the code. Wait for it, or stop it and run --restore.`,
    );
    process.exit(1);
  }
  console.log(`Put back ${putBack()}, left with a fault by a run cut short.`);
} else if (values.restore) {
  console.log("Nothing to put back.");
}
if (values.restore) process.exit(0);
if (positionals.length !== 1) {
  console.error(
    "Usage: node scripts/faults.ts <faults file>  (or --restore); see its header.",
  );
  process.exit(2);
}

const { tests, faults } = parseFaults(
  readFileSync(positionals[0] ?? "", "utf8"),
);
for (const test of tests) {
  if (!existsSync(inRoot(test))) throw new Error(`${test} does not exist.`);
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.on(signal, () => {
    child?.kill("SIGTERM");
    const file = putBack();
    console.log(`\n${signal}: stopped${file ? `; put back ${file}` : ""}.`);
    process.exit(128 + constants.signals[signal]);
  });
}

console.log(`Without a fault: ${tests.join(" ")}`);
const baseline = await runTests(tests);
if (baseline.failing.length > 0 || baseline.broken.length > 0) {
  console.log("The tests fail without a fault, so no fault can be judged:");
  for (const line of [...baseline.broken, ...baseline.failing]) {
    console.log(`  ${line}`);
  }
  process.exit(1);
}
const count = (n: number, what: string) => `${n} ${what}${n === 1 ? "" : "s"}`;
console.log(
  `  passed in ${baseline.seconds} s; ${count(faults.length, "fault")} to go, about ${Math.ceil(baseline.seconds * faults.length)} s.\n`,
);

const tally = { caught: 0, missed: 0, "not applied": 0, "did not run": 0 };
for (const fault of faults) {
  const why = putIn(fault);
  if (why !== undefined) {
    tally["not applied"]++;
    console.log(`NOT APPLIED  ${fault.name}: ${why}`);
    continue;
  }
  let outcome: Outcome;
  try {
    outcome = await runTests(tests);
  } finally {
    putBack();
  }
  if (outcome.failing.length > 0) {
    tally.caught++;
    const also =
      outcome.broken.length > 0
        ? `, and ${count(outcome.broken.length, "test file")} did not run`
        : "";
    console.log(
      `caught       ${fault.name}: ${outcome.failing.length} failing${also} (${outcome.seconds} s)`,
    );
    for (const line of outcome.failing.slice(0, 4)) {
      console.log(`               ${line}`);
    }
  } else if (outcome.broken.length > 0) {
    tally["did not run"]++;
    console.log(`DID NOT RUN  ${fault.name}: ${outcome.broken[0]}`);
  } else {
    tally.missed++;
    console.log(`MISSED       ${fault.name}: every test passed`);
  }
}

console.log(
  `\n${count(faults.length, "fault")}: ${Object.entries(tally)
    .filter(([, n]) => n > 0)
    .map(([what, n]) => `${n} ${what}`)
    .join(", ")}.`,
);
process.exit(tally.caught === faults.length ? 0 : 1);
