/**
 * The jobs worker (`npm run jobs:worker`): imports every task file, launches
 * DBOS, publishes the task and queue registry and applies the cron schedules.
 * Runs that were executing when a worker died are recovered by DBOS on the
 * next launch (same executor id and pinned application version).
 */
import path from "node:path";

import { DBOS } from "@dbos-inc/dbos-sdk";
import { loadEnvConfig } from "@next/env";
import fg from "fast-glob";

import {
  DEFAULT_QUEUE,
  JOBS_APP_NAME,
  JOBS_APP_VERSION,
  WAIT_QUEUE,
  dbosSchema,
  jobsBackend,
  jobsDatabaseUrl,
  shutdownTimeoutMs,
  workerConcurrency,
} from "./config";
import { ensureJobsSchema, sizePoolForWorker } from "./db";
import { registerJobWorkflows, scheduleWorkflow } from "./executor";
import {
  allQueues,
  allTasks,
  publishRegistry,
  setStrictRegistry,
} from "./registry";
import { type RetryOptions, setRetryDefaults } from "./retry";
import { Semaphore } from "./semaphore";
import { resetUnstartedRecoveryAttempts } from "./store";

const TASK_FILE_PATTERNS = [
  "lib/trigger/**/*.ts",
  "oss/**/lib/trigger/**/*.ts",
  "oss/features/ai/lib/trigger.ts",
];

/** The task files under `root` (absolute paths, sorted). */
export async function discoverTaskFiles(root: string): Promise<string[]> {
  const files = await fg(TASK_FILE_PATTERNS, {
    cwd: root,
    absolute: true,
    ignore: ["**/*.verify.ts"],
  });
  return files.sort();
}

type TriggerConfig = { retries?: { default?: RetryOptions } };

async function loadTriggerConfig(root: string): Promise<TriggerConfig> {
  const mod = await import(path.join(root, "trigger.config.ts"));
  // Under CJS interop the module's default export can arrive one level down.
  return (mod.default?.default ?? mod.default) as TriggerConfig;
}

export async function startWorker(
  opts: { root?: string; files?: string[] } = {},
): Promise<{ stop(): Promise<void> }> {
  if (jobsBackend() !== "dbos") {
    throw new Error(
      'JOBS_BACKEND is "trigger": run the Trigger.dev CLI instead',
    );
  }
  const root = opts.root ?? process.cwd();
  sizePoolForWorker();

  const config = await loadTriggerConfig(root);
  setRetryDefaults(config.retries?.default ?? {});

  setStrictRegistry(true);
  for (const file of opts.files ?? (await discoverTaskFiles(root))) {
    await import(file);
  }

  await ensureJobsSchema();
  const concurrency = workerConcurrency();
  registerJobWorkflows(new Semaphore(concurrency));
  // DBOS 5.6.0 has no admin server (`runAdminServer` is ignored), so the
  // worker opens no HTTP port.
  DBOS.setConfig({
    name: JOBS_APP_NAME,
    systemDatabaseUrl: jobsDatabaseUrl(),
    systemDatabaseSchemaName: dbosSchema(),
    applicationVersion: JOBS_APP_VERSION,
  });
  // Before launch, so the dispatcher's first poll already sees this worker's
  // claim cap (a row left by an older worker could lack it).
  await publishRegistry({ workerConcurrency: concurrency });
  // Before launch, which re-enqueues this worker's PENDING runs for recovery.
  await resetUnstartedRecoveryAttempts();
  await DBOS.launch();

  const scheduled = allTasks().filter((t) => t.kind === "scheduled");
  await DBOS.applySchedules(
    scheduled.map((t) => ({
      scheduleName: t.id,
      workflowFn: scheduleWorkflow,
      schedule: t.cron!,
      context: { taskId: t.id },
      cronTimezone: "UTC",
      automaticBackfill: false,
    })),
  );

  const queues = new Set([
    DEFAULT_QUEUE,
    WAIT_QUEUE,
    ...allQueues().map((q) => q.name),
  ]);
  console.log(
    `jobs worker ready: ${allTasks().length} tasks, ${queues.size} queues, ${scheduled.length} schedules, concurrency ${concurrency}`,
  );
  // Stops claiming, then waits for the runs executing here; any still going
  // after the timeout are recovered by the next worker.
  return {
    stop: () =>
      DBOS.shutdown({ workflowCompletionTimeoutMS: shutdownTimeoutMs() }),
  };
}

/**
 * Starts the worker and stops it on SIGINT/SIGTERM. Also used by the
 * restart-safety fixture.
 */
export async function runWorker(
  opts: { root?: string; files?: string[] } = {},
): Promise<void> {
  loadEnvConfig(process.cwd());
  const worker = await startWorker(opts);
  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    worker.stop().then(
      () => process.exit(0),
      (error) => {
        console.error(error);
        process.exit(1);
      },
    );
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

if (require.main === module) {
  runWorker().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
