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

/** Worker-wide cap on runs executing at once (default 4). */
export function workerConcurrency(): number {
  const raw = process.env.JOBS_WORKER_CONCURRENCY;
  if (raw === undefined || raw === "") return 4;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(
      `JOBS_WORKER_CONCURRENCY must be a positive integer, got "${raw}"`,
    );
  }
  return value;
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
