/**
 * Layer schema and run store, against real Postgres:
 *   npx tsx --tsconfig oss/tsconfig.jobs.json oss/jobs/store.verify.ts
 */
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

import { IDEMPOTENCY_TTL_SECONDS } from "./config";
import { assert, check, sleep, useIsolatedSchemas } from "./testing";

async function main() {
  await useIsolatedSchemas("store");
  const { ensureJobsSchema, getPool, withTransaction } = await import("./db");
  const store = await import("./store");

  await check("ensureJobsSchema is idempotent and creates both schemas", async () => {
    await ensureJobsSchema();
    await ensureJobsSchema();
    const { rows } = await getPool().query(
      "select schema_name from information_schema.schemata where schema_name = any($1)",
      [["dbos_store", "papermark_jobs_store"]],
    );
    assert(rows.length === 2, `both schemas exist, got ${rows.length}`);
  });

  const base = {
    taskId: "t-a",
    tags: ["dataroom_x", "team_1"],
    payload: { a: 1, nested: { b: [1, 2] } },
    metadata: { teamId: "t1" } as Record<string, unknown>,
    parentId: null,
    queueName: "q",
    concurrencyKey: null,
    maxAttempts: 3,
  };

  await check("insertRun round-trips through getRunRow", async () => {
    await withTransaction((c) => store.insertRun(c, { ...base, id: "run_1" }));
    const row = await store.getRunRow("run_1");
    assert(row !== null, "row found");
    assert(row.taskId === "t-a" && row.queueName === "q", "ids");
    assert(row.tags.join() === "dataroom_x,team_1", "tags");
    assert(JSON.stringify(row.payload) === JSON.stringify(base.payload), "payload");
    assert(row.metadata.teamId === "t1", "metadata");
    assert(row.maxAttempts === 3 && row.parentId === null, "attempts/parent");
    assert(row.startedAt === null && row.createdAt instanceof Date, "dates");
  });

  await check("mergeRunMetadata keeps existing keys", async () => {
    await store.mergeRunMetadata("run_1", { status: { progress: 50 } });
    const row = await store.getRunRow("run_1");
    assert(row?.metadata.teamId === "t1", "teamId kept");
    assert(
      JSON.stringify(row?.metadata.status) === '{"progress":50}',
      "status added",
    );
  });

  await check("markStarted: only while DBOS has the run PENDING; keeps the first timestamp", async () => {
    const setDbosStatus = (status: string) =>
      getPool().query(
        `INSERT INTO dbos_store.workflow_status (workflow_uuid, status) VALUES ('run_1', $1)
         ON CONFLICT (workflow_uuid) DO UPDATE SET status = EXCLUDED.status`,
        [status],
      );
    const bodyStarts = async () =>
      (
        await getPool().query<{ n: number }>(
          "SELECT body_starts AS n FROM papermark_jobs_store.runs WHERE id = 'run_1'",
        )
      ).rows[0].n;
    assert((await store.markStarted("run_1")) === false, "no DBOS row");
    await setDbosStatus("CANCELLED");
    assert((await store.markStarted("run_1")) === false, "canceled");
    assert((await store.getRunRow("run_1"))?.startedAt === null, "not set");
    assert((await bodyStarts()) === 0, "not counted");
    await setDbosStatus("PENDING");
    assert((await store.markStarted("run_1")) === true, "pending");
    const first = (await store.getRunRow("run_1"))?.startedAt;
    assert(first instanceof Date, "set");
    await sleep(20);
    await store.markStarted("run_1");
    const second = (await store.getRunRow("run_1"))?.startedAt;
    assert(first.getTime() === second?.getTime(), "unchanged");
    assert((await bodyStarts()) === 2, `counted ${await bodyStarts()}`);
  });

  await check("findRunRows filters by tag and sorts newest first", async () => {
    await sleep(10);
    await withTransaction((c) => store.insertRun(c, { ...base, id: "run_2" }));
    await withTransaction((c) =>
      store.insertRun(c, { ...base, id: "run_3", tags: ["other"] }),
    );
    const rows = await store.findRunRows({
      anyTags: ["dataroom_x"],
      since: new Date(Date.now() - 60000),
    });
    assert(rows.map((r) => r.id).join() === "run_2,run_1", "ids newest first");
    const byTask = await store.findRunRows({ taskIds: ["t-a"], limit: 1 });
    assert(byTask.length === 1 && byTask[0].id === "run_3", "limit + newest");
  });

  await check("getRunRow returns null for unknown id", async () => {
    assert((await store.getRunRow("run_missing")) === null, "null");
  });

  await check("idempotency lock and upsert", async () => {
    await withTransaction(async (c) => {
      assert(
        (await store.lockIdempotencyKey(c, "t-a", "s", "k")) === null,
        "null before upsert",
      );
      await store.upsertIdempotencyKey(c, "t-a", "s", "k", "run_1", IDEMPOTENCY_TTL_SECONDS);
      const hit = await store.lockIdempotencyKey(c, "t-a", "s", "k");
      assert(hit?.runId === "run_1", "run id");
      assert(hit.expiresAt.getTime() > Date.now() + 29 * 86400000, "expiry ~30d");
    });
    await withTransaction(async (c) => {
      await store.upsertIdempotencyKey(c, "t-a", "s", "k", "run_2", 60);
      const hit = await store.lockIdempotencyKey(c, "t-a", "s", "k");
      assert(hit?.runId === "run_2", "upsert replaces");
    });
  });

  await check("concurrent first-time triggers of one key yield one winner", async () => {
    const attempt = (runId: string) =>
      withTransaction(async (c) => {
        const hit = await store.lockIdempotencyKey(c, "t-a", "s", "race");
        if (hit) return { sawNull: false, runId: hit.runId };
        await sleep(200);
        await store.upsertIdempotencyKey(c, "t-a", "s", "race", runId, 60);
        return { sawNull: true, runId };
      });
    const [a, b] = await Promise.all([attempt("run_a"), attempt("run_b")]);
    assert([a, b].filter((r) => r.sawNull).length === 1, "exactly one saw null");
    assert(a.runId === b.runId, "both resolve to the same run id");
  });

  await check("task registry reflects upserts", async () => {
    await store.upsertTaskRegistry([
      { taskId: "t-a", queueName: "q1", kind: "task" },
      { taskId: "t-b", queueName: "q2", kind: "scheduled" },
    ]);
    await store.upsertTaskRegistry([{ taskId: "t-a", queueName: "q3", kind: "task" }]);
    const map = await store.readTaskRegistry();
    assert(map.get("t-a") === "q3" && map.get("t-b") === "q2", "map");
  });

  await getPool().end();
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
