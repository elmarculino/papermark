/**
 * Settings and constants of the DBOS jobs layer (the fork's replacement for
 * Trigger.dev). See oss/README.md, "Background jobs".
 */

export const JOBS_APP_NAME = "papermark";
/**
 * Pinned on purpose: DBOS only recovers workflows of the same application
 * version, and its default is a hash of the workflow source, so every deploy
 * would orphan in-flight runs. Task bodies re-run from the top on recovery,
 * so a constant version is safe.
 */
export const JOBS_APP_VERSION = "papermark-jobs-v1";
/** A task that keeps killing the worker (OOM in mupdf/ffmpeg) ends CRASHED. */
export const MAX_RECOVERY_ATTEMPTS = 3;
/** Queue for tasks that don't declare one. */
export const DEFAULT_QUEUE = "papermark-default";
/**
 * Queue for `triggerAndWait` children that neither the call nor the task
 * gives a queue. DBOS counts a waiting parent against its own queue's claim
 * cap, so a child on the parent's queue could never be claimed once waiting
 * parents fill it.
 */
export const WAIT_QUEUE = "papermark-wait";
/** Partition for enqueues without a concurrencyKey. */
export const DEFAULT_PARTITION = "_default";
/** Per-partition limit for queues without a concurrencyLimit. */
export const UNLIMITED_PARTITION_CONCURRENCY = 10000;
/** Trigger.dev's default idempotency key TTL: 30 days. */
export const IDEMPOTENCY_TTL_SECONDS = 30 * 24 * 60 * 60;
/** DBOS workflow name that runs a triggered task. */
export const TASK_WORKFLOW = "papermark-task";
/** DBOS workflow name that runs a cron task. */
export const SCHEDULE_WORKFLOW = "papermark-schedule";

export type JobsBackend = "dbos" | "trigger";

export function jobsBackend(): JobsBackend {
  const value = process.env.JOBS_BACKEND || "dbos";
  if (value !== "dbos" && value !== "trigger") {
    throw new Error(
      `JOBS_BACKEND must be "dbos" or "trigger", got "${value}"`,
    );
  }
  return value;
}

/** An integer env var of at least `min`, or `fallback` when unset or blank. */
function intFromEnv(name: string, fallback: number, min: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min) {
    const kind = min === 1 ? "a positive" : "a non-negative";
    throw new Error(`${name} must be ${kind} integer, got "${raw}"`);
  }
  return value;
}

/** Worker-wide cap on runs executing at once (default 4). */
export function workerConcurrency(): number {
  return intFromEnv("JOBS_WORKER_CONCURRENCY", 4, 1);
}

/** The app's (each Next.js process's) layer pool size by default. */
export const APP_DB_POOL_SIZE = 3;

/** Size of the layer's Postgres pool: `JOBS_DB_POOL_SIZE`, else `fallback`. */
export function jobsDbPoolSize(fallback: number): number {
  return intFromEnv("JOBS_DB_POOL_SIZE", fallback, 1);
}

/**
 * The worker's pool size: a connection per run slot, plus 4 for the cancel
 * pollers, metadata writes, nested triggers and result polling.
 */
export function workerDbPoolSize(): number {
  return jobsDbPoolSize(workerConcurrency() + 4);
}

/**
 * How long a stopping worker waits for its executing runs to finish
 * (`JOBS_SHUTDOWN_TIMEOUT_MS`, default 30 s). Runs still going after that
 * are recovered by the next worker.
 */
export function shutdownTimeoutMs(): number {
  return intFromEnv("JOBS_SHUTDOWN_TIMEOUT_MS", 30_000, 0);
}

const PRISMA_ONLY_PARAMS = [
  "pgbouncer",
  "connection_limit",
  "pool_timeout",
  "schema",
  "statement_cache_size",
  "socket_timeout",
];

/** Removes the query parameters only Prisma understands. */
export function stripPrismaParams(url: string): string {
  const queryStart = url.indexOf("?");
  if (queryStart === -1) return url;
  const params = new URLSearchParams(url.slice(queryStart + 1));
  for (const name of PRISMA_ONLY_PARAMS) params.delete(name);
  const rest = params.toString();
  return url.slice(0, queryStart) + (rest ? `?${rest}` : "");
}

/** Direct (non-pooled) Postgres URL for DBOS and the layer's tables. */
export function jobsDatabaseUrl(): string {
  const url =
    process.env.POSTGRES_PRISMA_URL_NON_POOLING ||
    process.env.POSTGRES_PRISMA_URL;
  if (!url) {
    throw new Error(
      "POSTGRES_PRISMA_URL_NON_POOLING (or POSTGRES_PRISMA_URL) must be set for the jobs layer",
    );
  }
  return stripPrismaParams(url);
}

const SCHEMA_NAME = /^[a-z_][a-z0-9_]*$/;

function schemaFromEnv(name: string, fallback: string): string {
  const value = process.env[name] || fallback;
  if (!SCHEMA_NAME.test(value)) {
    throw new Error(`${name} must be a plain lowercase identifier, got "${value}"`);
  }
  return value;
}

/** Postgres schema holding the layer's own tables. */
export function jobsSchema(): string {
  return schemaFromEnv("JOBS_SCHEMA", "papermark_jobs");
}

/** Postgres schema holding DBOS's system tables. */
export function dbosSchema(): string {
  return schemaFromEnv("JOBS_DBOS_SCHEMA", "dbos");
}
