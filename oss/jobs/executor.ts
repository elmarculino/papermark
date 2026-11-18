/**
 * Worker side of the jobs layer: the DBOS workflows that run task bodies.
 *
 * The task body runs directly inside the workflow function, with no DBOS
 * steps, so recovery after a crash re-runs it from the top (like a Trigger.dev
 * retry). The layer runs its own retry loop around it.
 */
import { DBOS } from "@dbos-inc/dbos-sdk";

import {
  DEFAULT_QUEUE,
  MAX_RECOVERY_ATTEMPTS,
  SCHEDULE_WORKFLOW,
  TASK_WORKFLOW,
  dbosSchema,
} from "./config";
import { RunCanceledError, type RunContext, runStorage } from "./context";
import { getPool, withTransaction } from "./db";
import { type TaskDef, getTask } from "./registry";
import { backoffMs, resolveRetry } from "./retry";
import { AbortTaskRunError } from "./sdk";
import type { Semaphore } from "./semaphore";
import { type RunRow, getRunRow, insertRun, markStarted } from "./store";

/** Cancel check of an executing run. */
const CANCEL_POLL_MS = 2000;
/** Cancel check of a run waiting for a worker slot (it holds no slot, so slower). */
const WAITING_CANCEL_POLL_MS = 5000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const ID_KEY = /^id$|Id$|Ids$/;

/**
 * A payload safe to log: id-like keys keep their string (or string[]) value,
 * every other key is reduced to its type, so secrets never reach the logs.
 */
export function summarizePayload(p: unknown): Record<string, unknown> {
  if (p === null || p === undefined) return {};
  if (typeof p !== "object" || Array.isArray(p)) {
    return { payload: Array.isArray(p) ? "array" : typeof p };
  }
  const summary: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(p)) {
    const idValue =
      typeof value === "string" ||
      (Array.isArray(value) && value.every((v) => typeof v === "string"));
    if (ID_KEY.test(key) && idValue) summary[key] = value;
    else summary[key] = Array.isArray(value) ? "array" : typeof value;
  }
  return summary;
}

function logFailure(row: RunRow, attempt: number, err: unknown): void {
  const e = err as { message?: unknown } | undefined;
  console.error(
    JSON.stringify({
      level: "error",
      event: "job.failed",
      taskId: row.taskId,
      runId: row.id,
      attempt,
      payload: summarizePayload(row.payload),
      error: String(e?.message ?? err),
    }),
  );
}

/**
 * Sets `ctx.canceled` once DBOS reports the workflow CANCELLED. Reads the
 * status column straight from the pool: inside a workflow,
 * DBOS.getWorkflowStatus is checkpointed as an operation, so every poll would
 * add a row.
 */
function startCancelPoller(ctx: RunContext, everyMs: number): () => void {
  const timer = setInterval(() => {
    getPool()
      .query<{ status: string }>(
        `SELECT status FROM ${dbosSchema()}.workflow_status WHERE workflow_uuid = $1`,
        [ctx.runId],
      )
      .then(({ rows }) => {
        if (rows[0]?.status === "CANCELLED") ctx.canceled = true;
      })
      // A failed poll is retried on the next tick.
      .catch(() => {});
  }, everyMs);
  return () => clearInterval(timer);
}

/** Runs a task's attempts inside the current workflow; shared by both workflows. */
async function executeRun(
  row: RunRow,
  task: TaskDef,
  sem: Semaphore,
): Promise<unknown> {
  let release: (() => void) | undefined;
  const ctx: RunContext = {
    runId: row.id,
    taskId: row.taskId,
    parentId: row.parentId,
    metadata: { ...row.metadata },
    canceled: false,
    writes: Promise.resolve(),
    async yieldSlot(fn) {
      release?.();
      release = undefined;
      try {
        return await fn();
      } finally {
        release = await sem.acquire(() => ctx.canceled);
      }
    },
  };
  // The semaphore checks ctx.canceled while the run waits for a slot.
  let stopPoller = startCancelPoller(ctx, WAITING_CANCEL_POLL_MS);
  try {
    release = await sem.acquire(() => ctx.canceled);
    stopPoller();
    stopPoller = startCancelPoller(ctx, CANCEL_POLL_MS);
    await markStarted(row.id);
    const retry = resolveRetry(task.retry, row.maxAttempts ?? undefined);
    for (let n = 1; ; n++) {
      try {
        if (ctx.canceled) throw new RunCanceledError();
        const payload = task.schema
          ? task.schema.parse(row.payload)
          : row.payload;
        const runCtx = {
          run: { id: row.id, tags: row.tags },
          attempt: { number: n },
          task: { id: row.taskId },
        };
        return await runStorage.run(ctx, () =>
          task.run(payload, { ctx: runCtx }),
        );
      } catch (err) {
        const final =
          err instanceof AbortTaskRunError ||
          err instanceof RunCanceledError ||
          ctx.canceled ||
          n >= retry.maxAttempts;
        if (final) {
          logFailure(row, n, err);
          throw err;
        }
        // Keeps the slot while backing off.
        await sleep(backoffMs(n, retry));
      }
    }
  } finally {
    await ctx.writes;
    release?.();
    stopPoller();
  }
}

let semaphore: Semaphore | undefined;

async function taskWorkflow({ runId }: { runId: string }): Promise<unknown> {
  const row = await getRunRow(runId);
  if (!row) throw new Error(`Run "${runId}" not found`);
  const task = getTask(row.taskId);
  if (!task) throw new Error(`Unknown task "${row.taskId}" in run "${runId}"`);
  return executeRun(row, task, semaphore!);
}

async function runScheduled(
  scheduledDate: Date,
  context: { taskId: string },
): Promise<void> {
  const task = getTask(context.taskId);
  if (!task) throw new Error(`Unknown task "${context.taskId}"`);
  const id = DBOS.workflowID!;
  // Built from the arguments on every execution, so recovery sees the same
  // payload and `timestamp` stays a Date (the stored copy is JSON).
  const payload = {
    timestamp: scheduledDate,
    timezone: "UTC",
    scheduleId: context.taskId,
    upcoming: [],
  };
  let row = await getRunRow(id);
  if (!row) {
    const fresh = {
      id,
      taskId: context.taskId,
      tags: [],
      payload,
      metadata: {},
      parentId: null,
      queueName: DEFAULT_QUEUE,
      concurrencyKey: null,
      maxAttempts: null,
    };
    await withTransaction((c) => insertRun(c, fresh));
    row = { ...fresh, startedAt: null, createdAt: new Date() };
  }
  await executeRun({ ...row, payload }, task, semaphore!);
}

/**
 * The registered cron workflow, for `DBOS.applySchedules({ workflowFn })`.
 * Set by registerJobWorkflows (a live binding).
 */
export let scheduleWorkflow: (
  scheduledDate: Date,
  context: { taskId: string },
) => Promise<void> = async () => {
  throw new Error("registerJobWorkflows() must run before scheduling");
};

/** Registers the layer's workflows with DBOS. Must run before DBOS.launch(). */
export function registerJobWorkflows(sem: Semaphore): void {
  semaphore = sem;
  DBOS.registerWorkflow(taskWorkflow, {
    name: TASK_WORKFLOW,
    maxRecoveryAttempts: MAX_RECOVERY_ATTEMPTS,
  });
  scheduleWorkflow = DBOS.registerWorkflow(runScheduled, {
    name: SCHEDULE_WORKFLOW,
    maxRecoveryAttempts: MAX_RECOVERY_ATTEMPTS,
  });
}
