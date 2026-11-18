/**
 * Helpers for the jobs layer's `*.verify.ts` scripts. Not imported by app or
 * worker code.
 */
export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`assertion failed: ${message}`);
}

export async function check(name: string, fn: () => unknown): Promise<void> {
  await fn();
  console.log(`ok ${name}`);
}

/** Asserts that `fn` throws (or rejects) with a message containing `text`. */
export async function throwsWith(
  fn: () => unknown,
  text: string,
): Promise<Error> {
  try {
    await fn();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    assert(
      message.includes(text),
      `expected an error containing "${text}", got "${message}"`,
    );
    return error as Error;
  }
  throw new Error(`assertion failed: expected an error containing "${text}"`);
}

export const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Points the layer at throwaway schemas (`papermark_jobs_<tag>`, `dbos_<tag>`)
 * and drops them so a verify script starts from nothing. Call before anything
 * touches the database.
 */
export async function useIsolatedSchemas(tag: string): Promise<void> {
  process.env.JOBS_SCHEMA = `papermark_jobs_${tag}`;
  process.env.JOBS_DBOS_SCHEMA = `dbos_${tag}`;
  const { jobsDatabaseUrl, jobsSchema, dbosSchema } = await import("./config");
  const { Client } = await import("pg");
  const client = new Client({ connectionString: jobsDatabaseUrl() });
  await client.connect();
  try {
    for (const schema of [jobsSchema(), dbosSchema()]) {
      await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    }
  } finally {
    await client.end();
  }
}

/**
 * Polls a run's status (via `runs.retrieve`) until it is one of `statuses`.
 */
export async function waitForStatus(
  runId: string,
  statuses: import("./status").RunStatus[],
  timeoutMs = 20000,
): Promise<import("./status").RunStatus> {
  const { retrieveRun } = await import("./runs");
  const deadline = Date.now() + timeoutMs;
  let last = "(no workflow)";
  for (;;) {
    const run = await retrieveRun(runId).catch(() => undefined);
    if (run) {
      if (statuses.includes(run.status)) return run.status;
      last = run.status;
    }
    if (Date.now() > deadline) {
      throw new Error(
        `assertion failed: run ${runId} not ${statuses.join("/")} after ${timeoutMs} ms (last: ${last})`,
      );
    }
    await sleep(100);
  }
}

/**
 * Launches an in-process DBOS worker for the tasks defined so far, the way
 * the jobs worker does. `stop()` shuts DBOS down.
 */
export async function startTestWorker(
  opts: { concurrency?: number } = {},
): Promise<{ stop(): Promise<void> }> {
  const { DBOS } = await import("@dbos-inc/dbos-sdk");
  const config = await import("./config");
  const { ensureJobsSchema } = await import("./db");
  const { registerJobWorkflows } = await import("./executor");
  const { publishRegistry, setStrictRegistry } = await import("./registry");
  const { Semaphore } = await import("./semaphore");

  setStrictRegistry(true);
  await ensureJobsSchema();
  registerJobWorkflows(
    new Semaphore(opts.concurrency ?? config.workerConcurrency()),
  );
  DBOS.setConfig({
    name: config.JOBS_APP_NAME,
    systemDatabaseUrl: config.jobsDatabaseUrl(),
    systemDatabaseSchemaName: config.dbosSchema(),
    applicationVersion: config.JOBS_APP_VERSION,
    runAdminServer: false,
  });
  await DBOS.launch();
  // Queues registered after launch are picked up by DBOS's dispatcher, which
  // re-reads the queues table every second.
  await publishRegistry();
  return { stop: () => DBOS.shutdown() };
}
