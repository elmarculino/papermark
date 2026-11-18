/**
 * Drop-in replacement for the parts of `@trigger.dev/sdk` Papermark uses,
 * backed by DBOS. Aliased over the real package by next.config.mjs.
 */
import { randomUUID } from "node:crypto";

import { type TriggerOptions, enqueueRun, getClient } from "../client";
import {
  RunCanceledError,
  type RunContext,
  checkpoint,
  currentRun,
} from "../context";
import {
  type TaskRunContext,
  allQueues,
  registerQueue,
  registerTask,
} from "../registry";
import type { RetryOptions } from "../retry";
import { mergeRunMetadata } from "../store";

export class AbortTaskRunError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AbortTaskRunError";
  }
}

export const defineConfig = <T>(config: T): T => config;

/** Same shape as @trigger.dev/sdk's `timeout`. */
export const timeout = {
  None: 2_147_483_647,
  get signal(): AbortSignal | undefined {
    return undefined;
  },
};

type QueueInput = { name?: string; concurrencyLimit?: number };

type TaskInput<P> = {
  id: string;
  queue?: QueueInput;
  retry?: RetryOptions;
  run: (payload: P, params: { ctx: TaskRunContext }) => Promise<unknown>;
  onFailure?: unknown;
  [other: string]: unknown;
};

export type TaskHandle<P> = {
  id: string;
  trigger(
    payload: P,
    options?: TriggerOptions,
  ): Promise<{ id: string; taskIdentifier: string }>;
  batchTrigger(
    items: { payload: P; options?: TriggerOptions }[],
  ): Promise<{ batchId: string; runs: { id: string }[] }>;
  triggerAndWait(payload: P, options?: TriggerOptions): Promise<TaskRunResult>;
};

export type TaskRunResult<O = any> =
  | { ok: true; id: string; output: O; unwrap(): O }
  | { ok: false; id: string; error: unknown; unwrap(): never };

function resolveQueueName(id: string, queue?: QueueInput): string | undefined {
  if (!queue) return undefined;
  const name = queue.name ?? id;
  // `queue: { name }` only references a queue declared with queue().
  if (
    queue.concurrencyLimit === undefined &&
    allQueues().some((q) => q.name === name)
  ) {
    return name;
  }
  registerQueue({ name, concurrencyLimit: queue.concurrencyLimit });
  return name;
}

function makeHandle<P>(id: string): TaskHandle<P> {
  const trigger = async (payload: P, options?: TriggerOptions) => {
    const { id: runId } = await enqueueRun(id, payload, options);
    return { id: runId, taskIdentifier: id };
  };
  return {
    id,
    trigger,
    async batchTrigger(items) {
      const runs: { id: string }[] = [];
      for (const item of items) {
        const { id: runId } = await enqueueRun(id, item.payload, item.options);
        runs.push({ id: runId });
      }
      return { batchId: "batch_" + randomUUID().replaceAll("-", ""), runs };
    },
    async triggerAndWait(payload, options) {
      const ctx = currentRun();
      if (!ctx) {
        throw new Error("triggerAndWait can only be called inside a task run");
      }
      const { id: runId } = await enqueueRun(id, payload, options);
      try {
        // The parent gives back its worker slot while the child runs.
        const output = await ctx.yieldSlot(async () =>
          (await getClient()).retrieveWorkflow(runId).getResult(),
        );
        return { ok: true, id: runId, output, unwrap: () => output };
      } catch (error) {
        if (error instanceof RunCanceledError) throw error;
        return {
          ok: false,
          id: runId,
          error,
          unwrap: () => {
            throw error;
          },
        };
      }
    },
  };
}

const UNSUPPORTED_HOOKS = [
  "onFailure",
  "onStart",
  "onSuccess",
  "onComplete",
  "onWait",
  "onResume",
  "onCancel",
  "middleware",
  "init",
  "cleanup",
  "catchError",
] as const;

function define<P>(
  def: TaskInput<P>,
  kind: "task" | "scheduled",
  extra: { schema?: { parse(x: unknown): unknown }; cron?: string } = {},
): TaskHandle<P> {
  for (const key of UNSUPPORTED_HOOKS) {
    if (def[key] !== undefined) {
      throw new Error(`${key} is not supported by the DBOS jobs backend`);
    }
  }
  registerTask({
    id: def.id,
    kind,
    run: def.run,
    queueName: resolveQueueName(def.id, def.queue),
    retry: def.retry,
    ...extra,
  });
  return makeHandle<P>(def.id);
}

export function task<P = any>(def: TaskInput<P>): TaskHandle<P> {
  return define(def, "task");
}

export function schemaTask<S extends { parse(x: unknown): any }>(
  def: Omit<TaskInput<ReturnType<S["parse"]>>, "run"> & {
    schema: S;
    run: TaskInput<ReturnType<S["parse"]>>["run"];
  },
): TaskHandle<ReturnType<S["parse"]>> {
  return define(def as unknown as TaskInput<ReturnType<S["parse"]>>, "task", {
    schema: def.schema,
  });
}

export const schedules = {
  task<P = any>(
    def: TaskInput<P> & {
      cron: string | { pattern: string; timezone?: string };
    },
  ): TaskHandle<P> {
    const cron = typeof def.cron === "string" ? def.cron : def.cron.pattern;
    if (typeof def.cron !== "string") {
      const tz = def.cron.timezone;
      if (tz && tz !== "UTC") {
        throw new Error(
          `cron timezone "${tz}" is not supported by the DBOS jobs backend (UTC only)`,
        );
      }
    }
    return define(def, "scheduled", { cron });
  },
};

export function queue(q: { name: string; concurrencyLimit?: number }) {
  registerQueue(q);
  return { name: q.name, concurrencyLimit: q.concurrencyLimit };
}

export const tasks = {
  async trigger(taskId: string, payload: unknown, options?: TriggerOptions) {
    const { id } = await enqueueRun(taskId, payload, options);
    return { id, taskIdentifier: taskId };
  },
};

/** Chains a metadata write onto the run's writes; failures are logged, never thrown. */
function queueMetadataWrite(
  ctx: RunContext,
  targetRunId: string,
  key: string,
  value: unknown,
): void {
  ctx.writes = ctx.writes
    .then(() => mergeRunMetadata(targetRunId, { [key]: value }))
    .catch((error: unknown) => {
      console.error(
        JSON.stringify({
          level: "error",
          event: "job.metadata_write_failed",
          runId: targetRunId,
          key,
          error: String((error as Error)?.message ?? error),
        }),
      );
    });
}

/** `metadata.set` / `metadata.parent.set`; no-ops outside a task run. */
export const metadata = {
  set(key: string, value: unknown): void {
    const ctx = currentRun();
    if (!ctx) return;
    checkpoint();
    ctx.metadata[key] = value;
    queueMetadataWrite(ctx, ctx.runId, key, value);
  },
  parent: {
    set(key: string, value: unknown): void {
      const ctx = currentRun();
      if (!ctx?.parentId) return;
      checkpoint();
      queueMetadataWrite(ctx, ctx.parentId, key, value);
    },
  },
};

/** Errors become `{ name, message, stack }` instead of `{}`. */
function logReplacer(_key: string, value: unknown): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  return typeof value === "bigint" ? value.toString() : value;
}

type LogLevel = "debug" | "log" | "info" | "warn" | "error";

function log(
  level: LogLevel,
  message: string,
  fields?: Record<string, unknown>,
) {
  const ctx = currentRun();
  if (ctx) checkpoint();
  const entry = {
    level,
    runId: ctx?.runId,
    taskId: ctx?.taskId,
    message,
    ...fields,
  };
  let line: string;
  try {
    line = JSON.stringify(entry, logReplacer);
  } catch {
    // e.g. circular fields: keep the message rather than throw from a logger.
    line = JSON.stringify({
      level,
      runId: ctx?.runId,
      taskId: ctx?.taskId,
      message,
    });
  }
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

/** One JSON line per call; inside a run it is also a cancellation checkpoint. */
export const logger = {
  debug: (message: string, fields?: Record<string, unknown>) =>
    log("debug", message, fields),
  log: (message: string, fields?: Record<string, unknown>) =>
    log("log", message, fields),
  info: (message: string, fields?: Record<string, unknown>) =>
    log("info", message, fields),
  warn: (message: string, fields?: Record<string, unknown>) =>
    log("warn", message, fields),
  error: (message: string, fields?: Record<string, unknown>) =>
    log("error", message, fields),
};
