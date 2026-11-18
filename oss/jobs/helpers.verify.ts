/**
 * Pure helpers of the DBOS jobs layer (no database needed):
 *   npx tsx --tsconfig oss/tsconfig.jobs.json oss/jobs/helpers.verify.ts
 */
import { jobsBackend, stripPrismaParams, workerConcurrency } from "./config";
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
