/**
 * Drop-in replacement for the parts of `@trigger.dev/sdk` Papermark uses,
 * backed by DBOS. Aliased over the real package by next.config.mjs.
 */
import { randomUUID } from "node:crypto";

import { type TriggerOptions, enqueueRun } from "../client";
import {
  type TaskRunContext,
  allQueues,
  registerQueue,
  registerTask,
} from "../registry";
import type { RetryOptions } from "../retry";

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
  triggerAndWait(payload: P, options?: TriggerOptions): Promise<never>;
};

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
    async triggerAndWait() {
      throw new Error("triggerAndWait is not implemented yet");
    },
  };
}

function define<P>(
  def: TaskInput<P>,
  kind: "task" | "scheduled",
  extra: { schema?: { parse(x: unknown): unknown }; cron?: string } = {},
): TaskHandle<P> {
  if (def.onFailure !== undefined) {
    throw new Error("onFailure is not supported by the DBOS jobs backend");
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
    def: TaskInput<P> & { cron: string | { pattern: string } },
  ): TaskHandle<P> {
    const cron = typeof def.cron === "string" ? def.cron : def.cron.pattern;
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
