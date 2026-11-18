/** App-side DBOS client and the enqueue path behind `.trigger()`. */
import { DBOSClient } from "@dbos-inc/dbos-sdk";
import { randomUUID } from "node:crypto";

import {
  DEFAULT_PARTITION,
  DEFAULT_QUEUE,
  IDEMPOTENCY_TTL_SECONDS,
  JOBS_APP_NAME,
  JOBS_APP_VERSION,
  TASK_WORKFLOW,
  dbosSchema,
  jobsDatabaseUrl,
} from "./config";
import { currentRun } from "./context";
import { ensureJobsSchema, getPool, withTransaction } from "./db";
import { parseDelay } from "./duration";
import { assertQueueRegistered, getTask, resolveTaskQueue } from "./registry";
import { toRunStatus } from "./status";
import { insertRun, lockIdempotencyKey, upsertIdempotencyKey } from "./store";

const globalForClient = globalThis as unknown as {
  __papermarkJobsClient?: Promise<DBOSClient>;
};

/** Singleton on globalThis so hot reload doesn't leak clients. */
export function getClient(): Promise<DBOSClient> {
  if (!globalForClient.__papermarkJobsClient) {
    const created = (async () => {
      await ensureJobsSchema();
      return DBOSClient.create({
        systemDatabaseUrl: jobsDatabaseUrl(),
        systemDatabasePool: getPool(),
        systemDatabaseSchemaName: dbosSchema(),
        applicationName: JOBS_APP_NAME,
      });
    })();
    created.catch(() => {
      if (globalForClient.__papermarkJobsClient === created) {
        globalForClient.__papermarkJobsClient = undefined;
      }
    });
    globalForClient.__papermarkJobsClient = created;
  }
  return globalForClient.__papermarkJobsClient;
}

/** Destroys the singleton (verify scripts, graceful shutdown). */
export async function destroyClient(): Promise<void> {
  const pending = globalForClient.__papermarkJobsClient;
  globalForClient.__papermarkJobsClient = undefined;
  if (pending) await (await pending).destroy();
}

export type TriggerOptions = {
  tags?: string | string[];
  idempotencyKey?: string;
  idempotencyKeyTTL?: string;
  queue?: string | { name: string };
  concurrencyKey?: string;
  maxAttempts?: number;
  delay?: string | Date;
  metadata?: Record<string, unknown>;
  machine?: unknown;
};

const SUPPORTED_OPTIONS = new Set([
  "tags",
  "idempotencyKey",
  "idempotencyKeyTTL",
  "queue",
  "concurrencyKey",
  "maxAttempts",
  "delay",
  "metadata",
  "machine",
]);

const UNFINISHED_KEY_RELEASE = new Set(["FAILED", "CRASHED", "CANCELED"]);

export async function enqueueRun(
  taskId: string,
  payload: unknown,
  options: TriggerOptions = {},
): Promise<{ id: string }> {
  for (const key of Object.keys(options)) {
    if (!SUPPORTED_OPTIONS.has(key)) {
      throw new Error(
        `Trigger option "${key}" is not supported by the DBOS jobs backend`,
      );
    }
  }

  const def = getTask(taskId);
  // Unknown task ids throw even when a queue is given.
  // Always confirm against the DB registry, so a fresh install (worker never
  // started) fails with the same clear error for in-process handles too.
  const registeredQueue = await resolveTaskQueue(taskId);
  const taskQueue = def ? def.queueName : registeredQueue;
  const requested =
    typeof options.queue === "string" ? options.queue : options.queue?.name;
  const queueName = requested ?? taskQueue ?? DEFAULT_QUEUE;
  await assertQueueRegistered(queueName);

  if (def?.schema) payload = def.schema.parse(payload);

  const delaySeconds = options.delay ? parseDelay(options.delay) : undefined;
  const ttl = options.idempotencyKeyTTL
    ? parseDelay(options.idempotencyKeyTTL)
    : IDEMPOTENCY_TTL_SECONDS;
  const parent = currentRun();
  const scope = parent?.runId ?? "global";
  const tags =
    options.tags === undefined
      ? []
      : Array.isArray(options.tags)
        ? options.tags
        : [options.tags];
  const client = await getClient();

  return withTransaction(async (c) => {
    if (options.idempotencyKey) {
      const hit = await lockIdempotencyKey(
        c,
        taskId,
        scope,
        options.idempotencyKey,
      );
      if (hit && hit.expiresAt.getTime() > Date.now()) {
        // Read through `c`: a second pool connection could deadlock the pool.
        const { rows } = await c.query<{ status: string }>(
          `SELECT status FROM ${dbosSchema()}.workflow_status WHERE workflow_uuid = $1`,
          [hit.runId],
        );
        const status = rows[0] ? toRunStatus(rows[0].status, null) : "FAILED";
        if (!UNFINISHED_KEY_RELEASE.has(status)) return { id: hit.runId };
      }
    }

    const id = "run_" + randomUUID().replaceAll("-", "");
    await insertRun(c, {
      id,
      taskId,
      tags,
      payload,
      metadata: options.metadata ?? {},
      parentId: parent?.runId ?? null,
      queueName,
      concurrencyKey: options.concurrencyKey ?? null,
      maxAttempts: options.maxAttempts ?? null,
    });
    await client.enqueueInTransaction(
      c,
      {
        queueName,
        workflowName: TASK_WORKFLOW,
        workflowID: id,
        appVersion: JOBS_APP_VERSION,
        applicationName: JOBS_APP_NAME,
        queuePartitionKey: options.concurrencyKey ?? DEFAULT_PARTITION,
        delaySeconds,
      },
      { runId: id },
    );
    if (options.idempotencyKey) {
      await upsertIdempotencyKey(
        c,
        taskId,
        scope,
        options.idempotencyKey,
        id,
        ttl,
      );
    }
    return { id };
  });
}
