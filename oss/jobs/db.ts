/**
 * Postgres access for the jobs layer: a small shared pool and the layer's
 * own schema (DBOS's system tables are created by DBOS.migrate).
 */
import { DBOS } from "@dbos-inc/dbos-sdk";
import { Pool, type PoolClient } from "pg";

import { dbosSchema, jobsDatabaseUrl, jobsSchema } from "./config";

const globalForPool = globalThis as unknown as {
  __papermarkJobsPool?: Pool;
};

export function getPool(): Pool {
  if (!globalForPool.__papermarkJobsPool) {
    globalForPool.__papermarkJobsPool = new Pool({
      connectionString: jobsDatabaseUrl(),
      max: Number(process.env.JOBS_DB_POOL_SIZE || 3),
      // Fail loudly on pool exhaustion instead of hanging.
      connectionTimeoutMillis: 10_000,
    });
    // An error on an idle client (e.g. a Postgres restart) would otherwise be
    // an unhandled 'error' event and kill the process.
    globalForPool.__papermarkJobsPool.on("error", (error) => {
      console.error("[jobs] idle database client error:", error.message);
    });
  }
  return globalForPool.__papermarkJobsPool;
}

export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  await ensureJobsSchema();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

function layerDdl(s: string): string[] {
  return [
    `CREATE SCHEMA IF NOT EXISTS ${s}`,
    `CREATE TABLE IF NOT EXISTS ${s}.runs (
      id text PRIMARY KEY, task_id text NOT NULL, tags text[] NOT NULL DEFAULT '{}',
      payload jsonb, metadata jsonb NOT NULL DEFAULT '{}', parent_id text,
      queue_name text NOT NULL, concurrency_key text, max_attempts int,
      started_at timestamptz, created_at timestamptz NOT NULL DEFAULT now())`,
    `CREATE INDEX IF NOT EXISTS runs_tags_idx ON ${s}.runs USING gin (tags)`,
    `CREATE INDEX IF NOT EXISTS runs_task_created_idx ON ${s}.runs (task_id, created_at DESC)`,
    `CREATE TABLE IF NOT EXISTS ${s}.idempotency_keys (
      task_id text NOT NULL, scope text NOT NULL, key text NOT NULL,
      run_id text NOT NULL, expires_at timestamptz NOT NULL,
      PRIMARY KEY (task_id, scope, key))`,
    `CREATE TABLE IF NOT EXISTS ${s}.tasks (
      task_id text PRIMARY KEY, queue_name text NOT NULL, kind text NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now())`,
  ];
}

const ensured = new Map<string, Promise<void>>();

/** Creates DBOS's tables and the layer's tables once per process (per schema pair). */
export function ensureJobsSchema(): Promise<void> {
  const key = `${jobsSchema()}|${dbosSchema()}`;
  let pending = ensured.get(key);
  if (!pending) {
    pending = (async () => {
      const client = await getPool().connect();
      try {
        // Serialize concurrent first-run migrations across processes (app + worker).
        await client.query("SELECT pg_advisory_lock(hashtext($1))", [key]);
        try {
          await DBOS.migrate(jobsDatabaseUrl(), { schemaName: dbosSchema() });
          for (const statement of layerDdl(jobsSchema())) {
            await client.query(statement);
          }
        } finally {
          await client.query("SELECT pg_advisory_unlock(hashtext($1))", [key]);
        }
      } finally {
        client.release();
      }
    })();
    ensured.set(key, pending);
    pending.catch(() => ensured.delete(key));
  }
  return pending;
}
