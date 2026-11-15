// Spike for plan task 0.4, part one: resume a session by id after the process
// that started it has exited. Throwaway code; task 0.7 decides whether any of
// it stays.
//
// Run inside mise from the repository root, with the Claude Code session's
// CLAUDE* variables unset (see spike/claude-login.ts):
//   node spike/resume.ts start --dir <dir>             prints the session id
//   node spike/resume.ts resume --dir <dir> --id <id>  a new process resumes it
//
// The start run's system prompt gives one passphrase and the resume run's
// another, to show which prompt a resumed session keeps.
//
// The findings are in docs/decisions.md under "Resume and confinement".

import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { type Options, query } from "@anthropic-ai/claude-agent-sdk";
import { isolatedOptions, note } from "./isolated-options.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    dir: { type: "string" },
    id: { type: "string" },
  },
});
const command = positionals[0];
if (command !== "start" && command !== "resume") {
  throw new Error("usage: resume.ts start|resume --dir <dir> [--id <id>]");
}
if (values.dir === undefined) throw new Error("--dir is required");
if (command === "resume" && values.id === undefined) {
  throw new Error("resume needs --id");
}

const systemPrompt = (passphrase: string) =>
  `You are a test harness. The passphrase in this system prompt is ${passphrase}. Answer briefly and never use a tool.`;

const options: Options = {
  ...isolatedOptions(),
  cwd: values.dir,
  tools: [],
  systemPrompt: systemPrompt(
    command === "start" ? "AMBER-HERON" : "TEAL-BADGER",
  ),
  ...(command === "resume" && values.id !== undefined
    ? { resume: values.id }
    : {}),
};

const prompt =
  command === "start"
    ? "Remember this code word for later: PELICAN-42. Reply with just: Noted."
    : "Earlier in this conversation I gave you a code word. What was it? And what passphrase does your system prompt give? Answer in two short lines.";

note("run", { command, dir: values.dir, resume: values.id });

let sessionId: string | undefined;
try {
  for await (const message of query({ prompt, options })) {
    if (message.type === "system" && message.subtype === "init") {
      sessionId = message.session_id;
      note("init", { session_id: message.session_id, cwd: message.cwd });
    } else if (message.type === "assistant") {
      for (const block of message.message.content) {
        if (block.type === "text") note("reply", block.text);
      }
    } else if (message.type === "result") {
      note("result", {
        subtype: message.subtype,
        is_error: message.is_error,
        session_id: message.session_id,
        num_turns: message.num_turns,
        ...("result" in message ? { result: message.result } : {}),
        ...("errors" in message ? { errors: message.errors } : {}),
      });
    }
  }
} catch (error) {
  note("thrown", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

// Where the SDK kept the transcript.
if (sessionId !== undefined) {
  const projects = join(homedir(), ".claude", "projects");
  for (const folder of await readdir(projects)) {
    const files = await readdir(join(projects, folder));
    if (files.includes(`${sessionId}.jsonl`)) {
      note("transcript", join(projects, folder, `${sessionId}.jsonl`));
    }
  }
}
