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
