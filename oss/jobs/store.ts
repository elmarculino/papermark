/** Run, idempotency and task-registry tables of the jobs layer. */
import type { PoolClient } from "pg";

import { dbosSchema, jobsSchema } from "./config";
import { ensureJobsSchema, getPool } from "./db";
import type { RunStatus } from "./status";

export type RunRow = {
  id: string;
  taskId: string;
  tags: string[];
  payload: unknown;
  metadata: Record<string, unknown>;
  parentId: string | null;
  queueName: string;
  concurrencyKey: string | null;
  maxAttempts: number | null;
  startedAt: Date | null;
  createdAt: Date;
};

export type NewRun = Omit<RunRow, "startedAt" | "createdAt">;

type DbRun = {
  id: string;
  task_id: string;
  tags: string[];
  payload: unknown;
  metadata: Record<string, unknown>;
  parent_id: string | null;
  queue_name: string;
  concurrency_key: string | null;
  max_attempts: number | null;
  started_at: Date | null;
  created_at: Date;
};

const toRunRow = (r: DbRun): RunRow => ({
  id: r.id,
  taskId: r.task_id,
  tags: r.tags,
  payload: r.payload,
  metadata: r.metadata,
  parentId: r.parent_id,
  queueName: r.queue_name,
  concurrencyKey: r.concurrency_key,
  maxAttempts: r.max_attempts,
  startedAt: r.started_at,
  createdAt: r.created_at,
});

export async function insertRun(c: PoolClient, run: NewRun): Promise<void> {
  await c.query(
    `INSERT INTO ${jobsSchema()}.runs
      (id, task_id, tags, payload, metadata, parent_id, queue_name, concurrency_key, max_attempts)
     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8, $9)`,
    [
      run.id,
      run.taskId,
      run.tags,
      JSON.stringify(run.payload ?? null),
      JSON.stringify(run.metadata ?? {}),
      run.parentId,
      run.queueName,
      run.concurrencyKey,
      run.maxAttempts,
    ],
  );
}

export async function getRunRow(id: string): Promise<RunRow | null> {
  await ensureJobsSchema();
  const { rows } = await getPool().query<DbRun>(
    `SELECT * FROM ${jobsSchema()}.runs WHERE id = $1`,
    [id],
  );
  return rows[0] ? toRunRow(rows[0]) : null;
}

/** SQL conditions (DBOS row `w`, layer row `r`) matching each status, as `toRunStatus` maps them. */
const STATUS_SQL: Record<RunStatus, string> = {
  QUEUED: `(w.status = 'ENQUEUED' OR (w.status = 'PENDING' AND r.started_at IS NULL))`,
  EXECUTING: `(w.status = 'PENDING' AND r.started_at IS NOT NULL)`,
  DELAYED: `w.status = 'DELAYED'`,
  COMPLETED: `w.status = 'SUCCESS'`,
  FAILED: `w.status = 'ERROR'`,
  CANCELED: `w.status = 'CANCELLED'`,
  CRASHED: `w.status = 'MAX_RECOVERY_ATTEMPTS_EXCEEDED'`,
};

export async function findRunRows(f: {
  taskIds?: string[];
  anyTags?: string[];
  since?: Date;
  /** Filtered before the limit, so newer runs in other states don't hide a match. */
  statuses?: RunStatus[];
  limit?: number;
}): Promise<RunRow[]> {
  await ensureJobsSchema();
  const where: string[] = [];
  const params: unknown[] = [];
  if (f.taskIds) {
    params.push(f.taskIds);
    where.push(`r.task_id = ANY($${params.length})`);
  }
  if (f.anyTags) {
    params.push(f.anyTags);
    where.push(`r.tags && $${params.length}::text[]`);
  }
  if (f.since) {
    params.push(f.since);
    where.push(`r.created_at >= $${params.length}`);
  }
  if (f.statuses) {
    const matches = f.statuses.map((s) => STATUS_SQL[s] ?? "false");
    where.push(`(${matches.join(" OR ") || "false"})`);
  }
  params.push(f.limit ?? 100);
  const { rows } = await getPool().query<DbRun>(
    `SELECT r.* FROM ${jobsSchema()}.runs r
     ${f.statuses ? `JOIN ${dbosSchema()}.workflow_status w ON w.workflow_uuid = r.id` : ""}
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY r.created_at DESC, r.id DESC LIMIT $${params.length}`,
    params,
  );
  return rows.map(toRunRow);
}

export async function mergeRunMetadata(
  id: string,
  patch: Record<string, unknown>,
): Promise<void> {
  await ensureJobsSchema();
  await getPool().query(
    `UPDATE ${jobsSchema()}.runs SET metadata = metadata || $2::jsonb WHERE id = $1`,
    [id, JSON.stringify(patch)],
  );
}

export async function markStarted(id: string): Promise<void> {
  await ensureJobsSchema();
  await getPool().query(
    `UPDATE ${jobsSchema()}.runs SET started_at = now() WHERE id = $1 AND started_at IS NULL`,
    [id],
  );
}

/**
 * Zeroes DBOS's recovery attempts of claimed runs whose body never started.
 * DBOS counts every claim, and a run claimed on one queue can wait for the
 * worker-wide slot through several worker crashes; without this it would be
 * dead-lettered (CRASHED) without having run. Runs that started keep their
 * count, so a run that kills the worker still ends CRASHED.
 */
export async function resetUnstartedRecoveryAttempts(): Promise<void> {
  await ensureJobsSchema();
  await getPool().query(
    `UPDATE ${dbosSchema()}.workflow_status w SET recovery_attempts = 0
     FROM ${jobsSchema()}.runs r
     WHERE r.id = w.workflow_uuid AND w.status = 'PENDING'
       AND r.started_at IS NULL AND w.recovery_attempts > 0`,
  );
}

export async function lockIdempotencyKey(
  c: PoolClient,
  taskId: string,
  scope: string,
  key: string,
): Promise<{ runId: string; expiresAt: Date } | null> {
  // FOR UPDATE locks nothing when the row doesn't exist yet, so serialize
  // first-time triggers of the same key with a transaction-scoped advisory lock.
  await c.query(
    "SELECT pg_advisory_xact_lock(hashtextextended($1 || '|' || $2 || '|' || $3, 0))",
    [taskId, scope, key],
  );
  const { rows } = await c.query<{ run_id: string; expires_at: Date }>(
    `SELECT run_id, expires_at FROM ${jobsSchema()}.idempotency_keys
     WHERE task_id = $1 AND scope = $2 AND key = $3 FOR UPDATE`,
    [taskId, scope, key],
  );
  return rows[0]
    ? { runId: rows[0].run_id, expiresAt: rows[0].expires_at }
    : null;
}

export async function upsertIdempotencyKey(
  c: PoolClient,
  taskId: string,
  scope: string,
  key: string,
  runId: string,
  ttlSeconds: number,
): Promise<void> {
  await c.query(
    `INSERT INTO ${jobsSchema()}.idempotency_keys (task_id, scope, key, run_id, expires_at)
     VALUES ($1, $2, $3, $4, now() + make_interval(secs => $5))
     ON CONFLICT (task_id, scope, key)
     DO UPDATE SET run_id = EXCLUDED.run_id, expires_at = EXCLUDED.expires_at`,
    [taskId, scope, key, runId, ttlSeconds],
  );
}

export async function upsertTaskRegistry(
  rows: { taskId: string; queueName: string; kind: "task" | "scheduled" }[],
): Promise<void> {
  if (rows.length === 0) return;
  await ensureJobsSchema();
  await getPool().query(
    `INSERT INTO ${jobsSchema()}.tasks (task_id, queue_name, kind)
     SELECT * FROM unnest($1::text[], $2::text[], $3::text[])
     ON CONFLICT (task_id)
     DO UPDATE SET queue_name = EXCLUDED.queue_name, kind = EXCLUDED.kind, updated_at = now()`,
    [
      rows.map((r) => r.taskId),
      rows.map((r) => r.queueName),
      rows.map((r) => r.kind),
    ],
  );
}

export async function readTaskRegistry(): Promise<Map<string, string>> {
  await ensureJobsSchema();
  const { rows } = await getPool().query<{ task_id: string; queue_name: string }>(
    `SELECT task_id, queue_name FROM ${jobsSchema()}.tasks`,
  );
  return new Map(rows.map((r) => [r.task_id, r.queue_name]));
}
