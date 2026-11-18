/**
 * Task and queue registry. In-process maps hold the definitions of the
 * process that imported the tasks (the worker); the DB copy lets the app
 * resolve a task's queue without importing the task code.
 */
import { getClient } from "./client";
import {
  DEFAULT_QUEUE,
  UNLIMITED_PARTITION_CONCURRENCY,
  WAIT_QUEUE,
} from "./config";
import type { RetryOptions } from "./retry";
import { readTaskRegistry, upsertTaskRegistry } from "./store";

export type TaskRunContext = {
  run: { id: string; tags: string[] };
  attempt: { number: number };
  task: { id: string };
};

export type TaskDef = {
  id: string;
  kind: "task" | "scheduled";
  run: (payload: any, params: { ctx: TaskRunContext }) => Promise<unknown>;
  queueName?: string;
  retry?: RetryOptions;
  schema?: { parse(x: unknown): unknown };
  cron?: string;
};

export type QueueDef = { name: string; concurrencyLimit?: number };

const tasks = new Map<string, TaskDef>();
const queues = new Map<string, QueueDef>();

let strict = false;

/**
 * Strict mode (worker, test workers): a duplicate task id throws. Off by
 * default so a hot-reloaded module can re-register its tasks.
 */
export function setStrictRegistry(on: boolean): void {
  strict = on;
}

export function registerTask(def: TaskDef): void {
  if (strict && tasks.has(def.id))
    throw new Error(`Task "${def.id}" is already registered`);
  tasks.set(def.id, def);
}

export function registerQueue(q: QueueDef): void {
  queues.set(q.name, { name: q.name, concurrencyLimit: q.concurrencyLimit });
}

export const getTask = (id: string) => tasks.get(id);
export const allTasks = () => [...tasks.values()];
export const allQueues = () => [...queues.values()];

/**
 * Worker: publishes the in-process registry so apps can resolve queues.
 * `workerConcurrency` is the worker's run cap (required, so a publish can
 * never drop it): every queue claims at most that many runs at once, so a
 * backlog stays ENQUEUED instead of being claimed and accruing DBOS recovery
 * attempts while it waits for a slot.
 */
export async function publishRegistry(opts: {
  workerConcurrency: number;
}): Promise<void> {
  await upsertTaskRegistry(
    allTasks().map((t) => ({
      taskId: t.id,
      queueName: t.queueName ?? DEFAULT_QUEUE,
      kind: t.kind,
    })),
  );
  const client = await getClient();
  const all = new Map(queues);
  for (const name of [DEFAULT_QUEUE, WAIT_QUEUE]) {
    if (!all.has(name)) all.set(name, { name });
  }
  for (const q of all.values()) {
    // Through the client so it works before (or without) DBOS.launch();
    // always_update makes a changed concurrencyLimit take effect on redeploy.
    await client.registerQueue(q.name, {
      workerConcurrency: opts.workerConcurrency,
      partitionConcurrency:
        q.concurrencyLimit ?? UNLIMITED_PARTITION_CONCURRENCY,
      onConflict: "always_update",
    });
  }
}

const CACHE_MS = 60_000;

let registryCache: { at: number; map: Map<string, string> } | undefined;

/** App: the queue a task runs on, from the DB registry (60 s cache). */
export async function resolveTaskQueue(taskId: string): Promise<string> {
  const fresh = registryCache && Date.now() - registryCache.at < CACHE_MS;
  let queue = fresh ? registryCache!.map.get(taskId) : undefined;
  if (queue === undefined) {
    // Re-read on a miss: the worker may have published since the last read.
    registryCache = { at: Date.now(), map: await readTaskRegistry() };
    queue = registryCache.map.get(taskId);
  }
  if (queue === undefined) {
    throw new Error(
      `Unknown task "${taskId}": start the jobs worker (npm run jobs:worker) so it registers its tasks`,
    );
  }
  return queue;
}

const knownQueues = new Map<string, number>();

export async function assertQueueRegistered(name: string): Promise<void> {
  const at = knownQueues.get(name);
  if (at !== undefined && Date.now() - at < CACHE_MS) return;
  const queue = await (await getClient()).retrieveQueue(name);
  if (!queue) throw new Error(`Unknown queue "${name}"`);
  knownQueues.set(name, Date.now());
}
