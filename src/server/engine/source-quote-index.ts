import { addAbortListener } from "node:events";
import { Worker } from "node:worker_threads";
import type { Slug } from "../../shared/course.ts";
import type { Outline, SectionRef } from "../../shared/source.ts";
import type { FoundQuote } from "../../shared/source-quote.ts";
import type { DataRoot } from "../record/data-root.ts";
import type {
  QuotePreference,
  QuoteReply,
  QuoteRequest,
} from "./source-quote-worker.ts";

type Course = {
  dataRoot: DataRoot;
  courseId: Slug;
  courseInstance: string | undefined;
  sources: readonly Outline[];
  sections: ReadonlyMap<SectionRef, unknown>;
};

type Outcome =
  | { type: "found"; quote: FoundQuote | undefined }
  | { type: "failed"; error: unknown };

type Search = {
  text: string;
  preference(): QuotePreference;
  finish(outcome: Outcome): void;
};

type Batch = { course: Course; searches: Set<Search> };
type WorkerOwner = {
  worker: Worker;
  ask(
    request: Exclude<QuoteRequest, { type: "release" }>,
  ): Promise<Exclude<QuoteReply, { type: "failed" }>>;
};

// One worker owns all resident indexes; no course text or index crosses the
// thread boundary. A reused slug has a new instance; separate DataRoot objects
// never share keys, and the worker cannot keep these objects alive.
const roots = new WeakMap<DataRoot, number>();
let nextRoot = 0;
let connection: WorkerOwner | undefined;

// Keep the queue on this side so canceled callers can drop out before any
// work is posted. A course accepts new callers into its batch while it loads
// (even if it's too big to cache), then serves that batch before moving on.
const batches = new Map<string, Batch>();
let draining = false;
let loading: Batch | undefined;
let live = 0;

export async function findCourseQuote(
  course: Course,
  text: string,
  preference: () => QuotePreference,
  signal?: AbortSignal,
): Promise<FoundQuote | undefined> {
  signal?.throwIfAborted();
  let root = roots.get(course.dataRoot);
  if (root === undefined) {
    root = ++nextRoot;
    roots.set(course.dataRoot, root);
  }
  const key = `${root}/${course.courseId}/${course.courseInstance ?? ""}`;
  const batch = batches.get(key) ?? { course, searches: new Set<Search>() };
  batches.set(key, batch);
  const { promise, resolve, reject } = Promise.withResolvers<
    FoundQuote | undefined
  >();
  const search: Search = {
    text,
    preference,
    finish(outcome) {
      if (!batch.searches.delete(search)) return;
      stop?.[Symbol.dispose]();
      if (--live === 0) connection?.worker.unref();
      if (
        batch.searches.size === 0 &&
        loading !== batch &&
        batches.get(key) === batch
      ) {
        batches.delete(key);
      }
      if (outcome.type === "failed") reject(outcome.error);
      else resolve(outcome.quote);
    },
  };
  const stop =
    signal === undefined
      ? undefined
      : addAbortListener(signal, () =>
          search.finish({ type: "failed", error: signal.reason }),
        );
  batch.searches.add(search);
  if (++live === 1) connection?.worker.ref();
  if (!draining) void drain();
  return promise;
}

async function drain() {
  draining = true;
  for (const [key, batch] of batches) {
    loading = batch;
    let owner: typeof connection;
    try {
      owner = connection ?? openWorker();
      const selected = await owner.ask({ type: "select", key });
      if (selected.type !== "selected")
        throw new Error("Expected a quote index selection.");
      if (batch.searches.size === 0) continue;
      if (!selected.hit) {
        const { dataRoot, courseId, sections, sources } = batch.course;
        const files = await dataRoot.sourceSectionFiles(
          courseId,
          sections.keys(),
        );
        if (batch.searches.size === 0) continue;
        await owner.ask({ type: "prepare", key, sources, files });
      }
      batches.delete(key);
      loading = undefined;
      for (const search of batch.searches) {
        try {
          const reply = await owner.ask({
            type: "find",
            text: search.text,
            preference: search.preference(),
          });
          if (reply.type !== "found")
            throw new Error("Expected a quote match result.");
          search.finish(reply);
        } catch (error) {
          search.finish({ type: "failed", error });
        }
      }
    } catch (error) {
      for (const search of batch.searches) {
        search.finish({ type: "failed", error });
      }
    } finally {
      loading = undefined;
      if (batches.get(key) === batch) batches.delete(key);
      if (owner !== undefined && owner === connection) {
        owner.worker.postMessage({ type: "release" } satisfies QuoteRequest);
      }
    }
  }
  draining = false;
}

function openWorker(): WorkerOwner {
  const worker = new Worker(
    new URL("./source-quote-worker.ts", import.meta.url),
    {
      execArgv: [],
    },
  );
  let pending: ((reply: QuoteReply) => void) | undefined;
  const owner: WorkerOwner = {
    worker,
    async ask(request) {
      if (owner !== connection)
        throw new Error("The quote worker has stopped.");
      const { promise, resolve } = Promise.withResolvers<QuoteReply>();
      pending = resolve;
      try {
        worker.postMessage(request);
      } catch (error) {
        pending = undefined;
        throw error;
      }
      const reply = await promise;
      if (reply.type === "failed") throw reply.error;
      return reply;
    },
  };
  function receive(reply: QuoteReply) {
    const awaiting = pending;
    pending = undefined;
    awaiting?.(reply);
  }
  function lost(error: Error) {
    if (connection === owner) connection = undefined;
    receive({ type: "failed", error });
  }
  worker.on("message", receive);
  worker.on("error", lost);
  worker.on("exit", (code) =>
    lost(new Error(`The quote worker exited (${code}).`)),
  );
  worker.on("messageerror", (error: Error) => {
    lost(error);
    void worker.terminate();
  });
  connection = owner;
  return owner;
}
