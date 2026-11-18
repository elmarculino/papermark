/**
 * Pure helpers of the DBOS jobs layer (no database needed):
 *   npx tsx --tsconfig oss/tsconfig.jobs.json oss/jobs/helpers.verify.ts
 */
import {
  APP_DB_POOL_SIZE,
  jobsBackend,
  jobsDbPoolSize,
  shutdownTimeoutMs,
  stripPrismaParams,
  workerConcurrency,
  workerDbPoolSize,
} from "./config";
import { parseDelay, parsePeriodMs } from "./duration";
import { backoffMs, resolveRetry } from "./retry";
import { runFlags, toRunStatus } from "./status";
import { assert, check, throwsWith } from "./testing";

async function main() {
  const now = Date.now();

  await check("parseDelay units", () => {
    assert(parseDelay("90s") === 90, "90s");
    assert(parseDelay("15m") === 900, "15m");
    assert(parseDelay("1d") === 86400, "1d");
    assert(parseDelay("1w") === 604800, "1w");
  });
  await check("parseDelay dates", () => {
    assert(parseDelay(new Date(now + 10_500), new Date(now)) === 11, "rounds up");
    assert(parseDelay(new Date(now - 5000), new Date(now)) === 0, "past is 0");
  });
  await check("parseDelay rejects junk", async () => {
    await throwsWith(() => parseDelay("soon"), "Unsupported delay");
    await throwsWith(() => parseDelay("1y"), "Unsupported delay");
  });
  await check("parsePeriodMs", () => {
    assert(parsePeriodMs("15m") === 900000, "15m");
  });

  await check("toRunStatus", () => {
    assert(toRunStatus("PENDING", null) === "QUEUED", "pending, not started");
    assert(toRunStatus("PENDING", new Date()) === "EXECUTING", "pending, started");
    assert(
      toRunStatus("MAX_RECOVERY_ATTEMPTS_EXCEEDED", null) === "CRASHED",
      "crashed",
    );
    assert(toRunStatus("CANCELLED", null) === "CANCELED", "canceled");
    assert(toRunStatus("ENQUEUED", null) === "QUEUED", "enqueued");
    assert(toRunStatus("DELAYED", null) === "DELAYED", "delayed");
    assert(toRunStatus("SUCCESS", new Date()) === "COMPLETED", "success");
    assert(toRunStatus("ERROR", new Date()) === "FAILED", "error");
  });
  await check("runFlags follow Trigger.dev", () => {
    assert(runFlags("CANCELED").isCompleted === false, "canceled not completed");
    assert(runFlags("CANCELED").isCancelled === true, "canceled flag");
    assert(runFlags("CRASHED").isFailed === true, "crashed is failed");
    assert(runFlags("FAILED").isCompleted === true, "failed is completed");
    assert(runFlags("COMPLETED").isSuccess === true, "success");
    assert(runFlags("DELAYED").isQueued === true, "delayed is queued");
  });

  await check("stripPrismaParams", () => {
    const out = stripPrismaParams(
      "postgresql://u:p@h:5432/db?pgbouncer=true&connection_limit=1&sslmode=require&schema=public",
    );
    assert(out === "postgresql://u:p@h:5432/db?sslmode=require", out);
    assert(
      stripPrismaParams("postgresql://u:p@h:5432/db?pgbouncer=true") ===
        "postgresql://u:p@h:5432/db",
      "no trailing ?",
    );
  });

  await check("workerConcurrency", async () => {
    const saved = process.env.JOBS_WORKER_CONCURRENCY;
    delete process.env.JOBS_WORKER_CONCURRENCY;
    assert(workerConcurrency() === 4, "default 4");
    process.env.JOBS_WORKER_CONCURRENCY = "0";
    await throwsWith(() => workerConcurrency(), "JOBS_WORKER_CONCURRENCY");
    process.env.JOBS_WORKER_CONCURRENCY = "2.5";
    await throwsWith(() => workerConcurrency(), "JOBS_WORKER_CONCURRENCY");
    if (saved === undefined) delete process.env.JOBS_WORKER_CONCURRENCY;
    else process.env.JOBS_WORKER_CONCURRENCY = saved;
  });
  await check("JOBS_DB_POOL_SIZE", async () => {
    const saved = {
      pool: process.env.JOBS_DB_POOL_SIZE,
      concurrency: process.env.JOBS_WORKER_CONCURRENCY,
    };
    delete process.env.JOBS_DB_POOL_SIZE;
    delete process.env.JOBS_WORKER_CONCURRENCY;
    assert(APP_DB_POOL_SIZE === 3, "app default 3");
    assert(jobsDbPoolSize(APP_DB_POOL_SIZE) === 3, "unset: the fallback");
    assert(workerDbPoolSize() === 8, "worker default: concurrency 4 + 4");
    process.env.JOBS_WORKER_CONCURRENCY = "1";
    assert(workerDbPoolSize() === 5, "worker default: concurrency 1 + 4");
    process.env.JOBS_DB_POOL_SIZE = "";
    assert(jobsDbPoolSize(3) === 3, "blank: the fallback");
    process.env.JOBS_DB_POOL_SIZE = "12";
    assert(jobsDbPoolSize(3) === 12, "set: the value");
    assert(workerDbPoolSize() === 12, "set: the worker uses it too");
    for (const bad of ["0", "-1", "2.5", "abc", "10x"]) {
      process.env.JOBS_DB_POOL_SIZE = bad;
      await throwsWith(
        () => jobsDbPoolSize(3),
        `JOBS_DB_POOL_SIZE must be a positive integer, got "${bad}"`,
      );
    }
    for (const [name, value] of [
      ["JOBS_DB_POOL_SIZE", saved.pool],
      ["JOBS_WORKER_CONCURRENCY", saved.concurrency],
    ] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  await check("JOBS_SHUTDOWN_TIMEOUT_MS", async () => {
    const saved = process.env.JOBS_SHUTDOWN_TIMEOUT_MS;
    delete process.env.JOBS_SHUTDOWN_TIMEOUT_MS;
    assert(shutdownTimeoutMs() === 30_000, "default 30 s");
    process.env.JOBS_SHUTDOWN_TIMEOUT_MS = "0";
    assert(shutdownTimeoutMs() === 0, "0: don't wait");
    process.env.JOBS_SHUTDOWN_TIMEOUT_MS = "5000";
    assert(shutdownTimeoutMs() === 5000, "set: the value");
    for (const bad of ["-1", "1.5", "soon"]) {
      process.env.JOBS_SHUTDOWN_TIMEOUT_MS = bad;
      await throwsWith(
        () => shutdownTimeoutMs(),
        `JOBS_SHUTDOWN_TIMEOUT_MS must be a non-negative integer, got "${bad}"`,
      );
    }
    if (saved === undefined) delete process.env.JOBS_SHUTDOWN_TIMEOUT_MS;
    else process.env.JOBS_SHUTDOWN_TIMEOUT_MS = saved;
  });
  await check("jobsBackend", async () => {
    const saved = process.env.JOBS_BACKEND;
    delete process.env.JOBS_BACKEND;
    assert(jobsBackend() === "dbos", "default dbos");
    process.env.JOBS_BACKEND = "trigger";
    assert(jobsBackend() === "trigger", "trigger");
    process.env.JOBS_BACKEND = "bull";
    await throwsWith(() => jobsBackend(), "JOBS_BACKEND");
    if (saved === undefined) delete process.env.JOBS_BACKEND;
    else process.env.JOBS_BACKEND = saved;
  });

  await check("backoffMs", () => {
    const r = {
      maxAttempts: 3,
      minTimeoutInMs: 1000,
      maxTimeoutInMs: 10000,
      factor: 2,
      randomize: false,
    };
    assert(backoffMs(1, r) === 1000, "attempt 1");
    assert(backoffMs(3, r) === 4000, "attempt 3");
    assert(backoffMs(9, r) === 10000, "capped");
    const j = { ...r, randomize: true };
    assert(backoffMs(1, j, () => 0.5) === 1500, "jitter");
    assert(backoffMs(4, j, () => 0.9) === 10000, "jitter capped");
  });
  await check("resolveRetry", () => {
    assert(resolveRetry({ maxAttempts: 2 }).maxAttempts === 2, "task retry");
    assert(resolveRetry({ maxAttempts: 2 }, 5).maxAttempts === 5, "trigger wins");
    const d = resolveRetry(undefined);
    assert(
      d.maxAttempts === 3 && d.minTimeoutInMs === 1000 && d.factor === 2,
      "built-in default",
    );
  });

  console.log("helpers.verify: all checks passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
