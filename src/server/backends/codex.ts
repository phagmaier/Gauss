// Codex's pinned app-server, the live-check pin and the login check (docs/findings.md, "Codex").

import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFile, rename, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { workspaceTools } from "../tools/workspace.ts";
import {
  type BackendEvent,
  type EngineTurn,
  type SessionBackend,
  SessionNotFound,
  type SessionOptions,
  type TutorSession,
} from "./backend.ts";
import { CodexRpcError, messageOf, openCodexAppServer } from "./codex-rpc.ts";
import { runCodexTurn } from "./codex-turn.ts";

export interface CodexBackendOptions {
  /** Executable on the PATH by default; tests supply a scripted peer. */
  command?: string;
  /** Gauss's isolated Codex home by default. */
  home?: string;
  /** Wins over a session's own model (`SessionOptions.model`); tests set it. */
  model?: string;
  /** A caller cannot change the course's medium effort or standard tier. */
  effort?: string;
  serviceTier?: string;
}

/** The one model, effort and tier a live check runs Codex on (AGENTS.md). */
export const CODEX_LIVE_CHECK_OPTIONS = {
  model: "gpt-6.1-terra",
  effort: "medium",
  serviceTier: "default",
} as const satisfies CodexBackendOptions;

/**
 * A live check also pins the model, bypassing every override; outside one,
 * `GAUSS_CODEX_MODEL` wins over the model asked for.
 */
export function codexOptions(requested: CodexBackendOptions = {}) {
  if (process.env.GAUSS_LIVE_CHECK === "1") return CODEX_LIVE_CHECK_OPTIONS;
  return {
    ...CODEX_LIVE_CHECK_OPTIONS,
    model:
      process.env.GAUSS_CODEX_MODEL ??
      requested.model ??
      CODEX_LIVE_CHECK_OPTIONS.model,
  };
}

/**
 * Gauss's own Codex home, outside every data root, holding only its login
 * and what Codex writes (docs/architecture.md, "Working here").
 */
export const GAUSS_CODEX_HOME = join(
  homedir(),
  ".local",
  "state",
  "gauss",
  "codex",
);

/**
 * The environment Codex runs in: the server's, without its `OPENAI_` and
 * `CODEX_` variables, which could sign Codex in another way or move its
 * home, and with `CODEX_HOME` set to `home`.
 */
export function codexEnvironment(
  home: string,
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const kept = Object.entries(env).filter(
    ([name]) => !name.startsWith("OPENAI_") && !name.startsWith("CODEX_"),
  );
  return { ...Object.fromEntries(kept), CODEX_HOME: home };
}

const NAMESPACE = "gauss";
const PROFILE = "gauss";

// Leave out Codex's optional prompts, web search, autonomous features and
// its shell, which a tutor's commands do not use: they are Gauss's own
// (`tools/workspace.ts`). The patch tool goes with the catalog below
// (docs/findings.md, "Codex"). Direct calls return results and images to
// the model itself, not to a script that would have to forward them.
const APP_CONFIG = [
  "features.multi_agent=false",
  "features.multi_agent_v2=false",
  "agents.enabled=false",
  "skills.bundled.enabled=false",
  "skills.include_instructions=false",
  "features.skip_host_skill_discovery=true",
  "tools.experimental_request_user_input.enabled=false",
  "include_collaboration_mode_instructions=false",
  "include_apps_instructions=false",
  "include_permissions_instructions=false",
  "features.apps=false",
  "features.plugins=false",
  "features.memories=false",
  "features.image_generation=false",
  "features.view_image=false",
  "features.sleep_tool=false",
  "features.hooks=false",
  "features.shell_snapshot=false",
  "allow_login_shell=false",
  'web_search="disabled"',
  "project_doc_max_bytes=0",
  "suppress_unstable_features_warning=true",
  "features.goals=false",
  "features.shell_tool=false",
  `features.code_mode.direct_only_tool_namespaces=["${NAMESPACE}"]`,
  "thread_unload_delay_secs=0",
].flatMap((setting) => ["-c", setting]);

/** The app-server's `-c` arguments, given the catalog `writeCodexCatalog` wrote. */
export function codexAppConfig(catalog: string): string[] {
  return [...APP_CONFIG, "-c", `model_catalog_json=${JSON.stringify(catalog)}`];
}

function isMissingThread(error: unknown): boolean {
  return (
    error instanceof CodexRpcError &&
    error.code === -32600 &&
    /^(no rollout found for thread id|invalid session id:|thread not loaded:)/i.test(
      error.message,
    )
  );
}

type ThreadResponse = { thread: { id: string; cwd: string } };

const Catalog = z.object({
  models: z
    .array(
      z.looseObject({ slug: z.string(), apply_patch_tool_type: z.unknown() }),
    )
    .min(1),
});

/**
 * Writes the model catalog Codex is given, beside its home (which holds only
 * what Codex writes) and returns its path: the catalog this CLI ships with,
 * with no model's patch tool, which only a catalog entry can remove
 * (docs/findings.md, "Codex"). It replaces the catalog Codex fetches, so a
 * model's entry is the pinned CLI's own.
 */
export async function writeCodexCatalog(
  command: string,
  home: string,
): Promise<string> {
  const { stdout } = await promisify(execFile)(
    command,
    ["debug", "models", "--bundled"],
    {
      cwd: home,
      env: codexEnvironment(home),
      maxBuffer: 64 * 1024 * 1024,
      timeout: 20_000,
    },
  );
  const catalog = Catalog.parse(JSON.parse(stdout));
  for (const model of catalog.models) model.apply_patch_tool_type = null;
  const text = JSON.stringify(catalog);
  // Named by its content, so that a Gauss running another Codex version
  // (a worktree's) does not replace the one this server's Codex reads.
  const hash = createHash("sha256").update(text).digest("hex").slice(0, 12);
  const path = join(dirname(home), `${basename(home)}-models-${hash}.json`);
  // Whole or not at all, for an app-server of another Gauss reading it.
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, text);
  await rename(temporary, path);
  return path;
}

export function createCodexBackend(
  options: CodexBackendOptions = {},
): SessionBackend {
  const { command = "codex", home = GAUSS_CODEX_HOME } = options;
  const { effort } = codexOptions(options);
  // Written once per backend; a failure (a home not made yet) is tried again.
  let catalog: Promise<string> | undefined;
  const open = async () => {
    catalog ??= writeCodexCatalog(command, home).catch((error: unknown) => {
      catalog = undefined;
      throw error;
    });
    return openCodexAppServer({
      command,
      home,
      env: codexEnvironment(home),
      config: codexAppConfig(await catalog),
    });
  };
  const profile = {
    approvalPolicy: "never",
    permissions: PROFILE,
    config: {
      // ChatGPT workspace routing rebuilds the config without the thread's
      // permissions choice, so the named profile also needs to be default.
      default_permissions: PROFILE,
      permissions: {
        [PROFILE]: {
          filesystem: { ":minimal": "read" },
          network: { enabled: false },
        },
      },
      model_reasoning_effort: effort,
    },
  };
  return {
    async startSession(session): Promise<TutorSession> {
      const { cwd, resumeId, title, systemPrompt, workspace } = session;
      // Given on every resume and turn, so a session resumed after the
      // learner chose another model runs on it.
      const asked = options.model ?? session.model;
      const model = codexOptions(asked === undefined ? {} : { model: asked });
      if (workspace !== undefined && cwd === undefined) {
        throw new Error("The file and shell tools need a working folder.");
      }
      const tools = sessionTools(session);
      const app = await open();
      let threadId: string;
      try {
        const place = {
          ...profile,
          model: model.model,
          serviceTier: model.serviceTier,
          cwd: cwd ?? home,
          baseInstructions: systemPrompt,
        };
        const { thread } =
          resumeId === undefined
            ? await app.request<ThreadResponse>("thread/start", {
                ...place,
                ephemeral: cwd === undefined,
                dynamicTools:
                  tools.size === 0
                    ? []
                    : [
                        {
                          type: "namespace",
                          name: NAMESPACE,
                          description:
                            workspace === undefined
                              ? "Gauss teaching tools."
                              : "Gauss teaching tools, and file and command tools for the workspace.",
                          tools: Array.from(tools.values(), (tool) => ({
                            type: "function",
                            name: tool.name,
                            description: tool.description,
                            inputSchema: z.toJSONSchema(
                              z.object(tool.inputShape),
                              { io: "input" },
                            ),
                          })),
                        },
                      ],
              })
            : await app.request<ThreadResponse>("thread/resume", {
                ...place,
                threadId: resumeId,
                excludeTurns: true,
              });
        threadId = thread.id;
        // Naming a kept thread persists it even if the first turn never runs.
        if (
          resumeId === undefined &&
          cwd !== undefined &&
          title !== undefined
        ) {
          await app.request("thread/name/set", { threadId, name: title });
        }
      } catch (error) {
        await app.close();
        if (resumeId !== undefined && isMissingThread(error))
          throw new SessionNotFound(resumeId);
        throw error;
      }

      let active: ReturnType<typeof runCodexTurn> | undefined;
      let closing: Promise<void> | undefined;
      app.listen(
        (message) => {
          if (active !== undefined) active.dispatch(message);
          else if (message.id !== undefined) app.unsupported(message);
        },
        (error) => active?.failed(error),
      );

      return {
        backendSessionId: threadId,
        async *send(
          turn: EngineTurn,
          signal?: AbortSignal,
        ): AsyncGenerator<BackendEvent> {
          const failure =
            app.failure?.message ??
            (closing !== undefined
              ? "The Codex session is closed."
              : active !== undefined
                ? "A Codex turn is already running."
                : undefined);
          if (failure !== undefined) {
            yield { type: "turn_end", outcome: "error", error: failure };
            return;
          }
          if (signal?.aborted === true) {
            yield { type: "turn_end", outcome: "interrupted" };
            return;
          }
          const running = runCodexTurn({
            app,
            threadId,
            model,
            namespace: NAMESPACE,
            tools,
            turn,
            signal,
          });
          active = running;
          try {
            for await (const event of running.events()) {
              if (event.type === "turn_end") active = undefined;
              yield event;
            }
          } finally {
            // An abandoned stream must not let a later turn steer it.
            if (active === running) {
              await close();
              active = undefined;
            }
          }
        },
        async interrupt() {
          await active?.stop();
        },
        close,
      };

      function close(): Promise<void> {
        closing ??= (async () => {
          try {
            await active?.stop();
            if (app.failure === undefined) {
              // A loaded thread ignores new resume instructions. Unsubscribe
              // with zero unload delay, then finish closing this session's peer.
              await app.request("thread/unsubscribe", { threadId });
            }
          } finally {
            await app.close();
          }
        })();
        return closing;
      }
    },

    toolNames: (session) => Array.from(sessionTools(session).keys()).sort(),

    async hasSession(id, cwd) {
      const app = await open();
      try {
        const { thread } = await app.request<ThreadResponse>("thread/read", {
          threadId: id,
          includeTurns: false,
        });
        return resolve(thread.cwd) === resolve(cwd);
      } catch (error) {
        if (isMissingThread(error)) return false;
        throw error;
      } finally {
        await app.close();
      }
    },
  };
}

/**
 * A thread's tools by name: the teaching tools, and with a working folder
 * a tutor's file and command tools, which are Gauss's, since Codex's own
 * sandbox gives it no writable path or network.
 */
function sessionTools({
  tools,
  cwd,
  workspace,
}: Pick<SessionOptions, "tools" | "cwd" | "workspace">) {
  return new Map(
    [
      ...tools,
      ...(workspace === undefined || cwd === undefined
        ? []
        : workspaceTools(cwd, workspace)),
    ].map((tool) => [tool.name, tool]),
  );
}

/** The Codex CLI version `mise.toml` pins, whose app-server protocol Gauss speaks. */
export async function pinnedCodexVersion(): Promise<string> {
  const toml = await readFile(
    new URL("../../../mise.toml", import.meta.url),
    "utf8",
  );
  const pin = /^codex\s*=\s*"([^"]+)"/m.exec(toml)?.[1];
  if (pin === undefined) throw new Error("mise.toml pins no Codex version.");
  return pin;
}

/**
 * Why a course cannot run on Codex now, or undefined when it can: the CLI
 * on the PATH is the pinned version and Gauss's Codex home is signed in,
 * which `account/read` answers with an account (null signed out; its
 * `requiresOpenaiAuth` is true either way). Calls no model.
 */
export async function codexUnavailable(
  options: {
    /** The `codex` executable; the one on the PATH if not given. */
    command?: string;
    home?: string;
    /** The version required; mise.toml's pin if not given. */
    version?: string;
    timeoutMs?: number;
  } = {},
): Promise<string | undefined> {
  const command = options.command ?? "codex";
  const home = options.home ?? GAUSS_CODEX_HOME;
  const pinned = options.version ?? (await pinnedCodexVersion());
  const timeoutMs = options.timeoutMs ?? 20_000;
  const env = codexEnvironment(home);
  let said: string;
  try {
    const { stdout } = await promisify(execFile)(command, ["--version"], {
      env,
      timeout: timeoutMs,
    });
    said = stdout.trim();
  } catch (error) {
    return (
      `Codex could not be run (${messageOf(error)}). Gauss needs the ` +
      `Codex CLI ${pinned}, which \`mise install\` in Gauss's folder installs. ` +
      "If Gauss was not started through mise, restart it through mise. " +
      signInInstructions(home)
    );
  }
  if (said.split(/\s+/).at(-1) !== pinned) {
    return (
      `Gauss needs the Codex CLI ${pinned}, but \`codex --version\` says ` +
      `"${said}". Restart Gauss through mise, which runs the version it pins. ` +
      signInInstructions(home)
    );
  }
  // Codex refuses a home that does not exist, with an error of its own.
  const folder = `Gauss's Codex home, ${shownHome(home)},`;
  try {
    if (!(await stat(home)).isDirectory()) {
      return `${folder} is not a folder. Move the existing file aside first. ${signInInstructions(home)}`;
    }
  } catch (error) {
    const detail =
      (error as NodeJS.ErrnoException).code === "ENOENT"
        ? "does not exist"
        : `could not be opened (${messageOf(error)})`;
    return `${folder} ${detail}. ${signInInstructions(home)}`;
  }
  try {
    const app = await openCodexAppServer({ command, home, env, timeoutMs });
    try {
      const { account } = await app.request<{ account: unknown }>(
        "account/read",
        {
          refreshToken: false,
        },
      );
      return account === null || account === undefined
        ? `${folder} is not signed in. ${signInInstructions(home)}`
        : undefined;
    } finally {
      await app.close();
    }
  } catch (error) {
    return `Codex did not say whether it is signed in: ${messageOf(error)} ${signInInstructions(home)}`;
  }
}

function shownHome(home: string): string {
  return home.startsWith(`${homedir()}/`)
    ? `~${home.slice(homedir().length)}`
    : home;
}

function signInInstructions(home: string): string {
  const shown = shownHome(home);
  return (
    `Sign in once, from Gauss's folder: \`mkdir -p -m 700 ${shown}\`, then ` +
    `\`CODEX_HOME=${shown} mise exec -- codex login\`.`
  );
}
