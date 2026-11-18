/**
 * Task definitions and DBOS-backed triggering, against real Postgres.
 * The DBOS executor is never launched: this only checks what gets enqueued.
 */
import { loadEnvConfig } from "@next/env";
import { spawnSync } from "node:child_process";

import { assert, check, throwsWith, useIsolatedSchemas } from "./testing";

loadEnvConfig(process.cwd());

async function poolOneChild() {
  // Runs against the schemas the parent already filled, with a pool of one.
  process.env.JOBS_SCHEMA = "papermark_jobs_trigger";
  process.env.JOBS_DBOS_SCHEMA = "dbos_trigger";
  const { task } = await import("./sdk");
  const { destroyClient } = await import("./client");
  const { getPool } = await import("./db");
  const t = task({ id: "t-a", run: async () => "a" });
  const first = await t.trigger({}, { idempotencyKey: "pool1" });
  const second = await t.trigger({}, { idempotencyKey: "pool1" });
  assert(first.id === second.id, "same id");
  await destroyClient();
  await getPool().end();
}

async function main() {
  if (process.env.POOL1_CHILD) return poolOneChild();
  await useIsolatedSchemas("trigger");
  const { queue, schedules, schemaTask, task, tasks } = await import("./sdk");
  const { destroyClient, getClient } = await import("./client");
  const { publishRegistry } = await import("./registry");
  const { getRunRow } = await import("./store");
  const { getPool } = await import("./db");
  const { TASK_WORKFLOW } = await import("./config");
  const { setStrictRegistry } = await import("./registry");

  const tA = task({ id: "t-a", run: async () => "a" });
  queue({ name: "q-b", concurrencyLimit: 2 });
  const tB = task({ id: "t-b", queue: { name: "q-b" }, run: async () => "b" });
  const tS = schemaTask({
    id: "t-s",
    schema: { parse: (x: unknown) => ({ ...(x as object), parsed: true }) },
    run: async () => "s",
  });
  await check(
    "fresh install: a handle throws the worker-not-started message",
    async () => {
      await throwsWith(
        () => tA.trigger({}),
        'Unknown task "t-a": start the jobs worker (npm run jobs:worker) so it registers its tasks',
      );
      const n = Number(
        (
          await getPool().query(
            `SELECT count(*) FROM ${process.env.JOBS_SCHEMA}.runs`,
          )
        ).rows[0].count,
      );
      assert(n === 0, "no layer row");
    },
  );
  await publishRegistry();
  const client = await getClient();
  const RUN_ID = /^run_[0-9a-f]{32}$/;
  const layerRows = async () =>
    Number(
      (
        await getPool().query(
          `SELECT count(*) FROM ${process.env.JOBS_SCHEMA}.runs`,
        )
      ).rows[0].count,
    );

  await check(
    "trigger enqueues on the default queue and stores the payload",
    async () => {
      const r = await tA.trigger({ x: 1 });
      assert(RUN_ID.test(r.id), `run id shape ${r.id}`);
      assert(r.taskIdentifier === "t-a", "taskIdentifier");
      const wf = await client.getWorkflow(r.id);
      assert(wf?.status === "ENQUEUED", `status ${wf?.status}`);
      assert(wf?.queueName === "papermark-default", `queue ${wf?.queueName}`);
      assert(
        wf?.queuePartitionKey === "_default",
        `partition ${wf?.queuePartitionKey}`,
      );
      const row = await getRunRow(r.id);
      assert(JSON.stringify(row?.payload) === '{"x":1}', "payload stored");
    },
  );

  await check("task queue, concurrencyKey and tags", async () => {
    const r = await tB.trigger({}, { concurrencyKey: "team1", tags: "one" });
    const wf = await client.getWorkflow(r.id);
    assert(wf?.queueName === "q-b", `queue ${wf?.queueName}`);
    assert(
      wf?.queuePartitionKey === "team1",
      `partition ${wf?.queuePartitionKey}`,
    );
    assert(JSON.stringify((await getRunRow(r.id))?.tags) === '["one"]', "tags");
  });

  await check(
    "queue limits are published as partition concurrency",
    async () => {
      const q = await client.retrieveQueue("q-b");
      assert(q?.partitionConcurrency === 2, `limit ${q?.partitionConcurrency}`);
      const d = await client.retrieveQueue("papermark-default");
      assert(
        d?.partitionConcurrency === 10000,
        `default ${d?.partitionConcurrency}`,
      );
    },
  );

  await check("a trigger-time queue wins", async () => {
    const r = await tA.trigger({}, { queue: "q-b" });
    assert((await client.getWorkflow(r.id))?.queueName === "q-b", "queue");
  });

  await check("unknown queue throws and leaves no row", async () => {
    const before = await layerRows();
    await throwsWith(
      () => tA.trigger({}, { queue: "nope" }),
      'Unknown queue "nope"',
    );
    assert((await layerRows()) === before, "no new layer row");
  });

  await check(
    "unknown task throws the worker-not-started message",
    async () => {
      await throwsWith(
        () => tasks.trigger("never-registered", {}),
        'Unknown task "never-registered": start the jobs worker (npm run jobs:worker) so it registers its tasks',
      );
      await throwsWith(
        () => tasks.trigger("never-registered", {}, { queue: "q-b" }),
        'Unknown task "never-registered"',
      );
    },
  );

  await check("delay gives DELAYED ~120 s out", async () => {
    const r = await tA.trigger({}, { delay: "2m" });
    const wf = await client.getWorkflow(r.id);
    assert(wf?.status === "DELAYED", `status ${wf?.status}`);
    const diff = (wf?.delayUntilEpochMS ?? 0) - Date.now();
    assert(Math.abs(diff - 120_000) < 5000, `delay ${diff}`);
  });

  await check("unsupported option throws", async () => {
    await throwsWith(
      () => tA.trigger({}, { priority: 1 } as never),
      'Trigger option "priority" is not supported by the DBOS jobs backend',
    );
  });

  await check(
    "idempotency key dedupes, and a canceled run frees it",
    async () => {
      const a = await tA.trigger({}, { idempotencyKey: "k1" });
      const b = await tA.trigger({}, { idempotencyKey: "k1" });
      assert(a.id === b.id, "same id");
      const countWorkflows = async () =>
        (await client.listWorkflows({ workflowName: TASK_WORKFLOW })).length;
      const wfBefore = await countWorkflows();
      const rowsBefore = await layerRows();
      const again = await tA.trigger({}, { idempotencyKey: "k1" });
      assert(again.id === a.id, "same id again");
      assert((await countWorkflows()) === wfBefore, "no extra workflow");
      assert((await layerRows()) === rowsBefore, "no extra layer row");
      await client.cancelWorkflow(a.id);
      const c = await tA.trigger({}, { idempotencyKey: "k1" });
      assert(c.id !== a.id, "new id after cancel");
    },
  );

  await check("batchTrigger returns distinct ids", async () => {
    const r = await tA.batchTrigger([
      { payload: 1 },
      { payload: 2 },
      { payload: 3 },
    ]);
    assert(/^batch_[0-9a-f]{32}$/.test(r.batchId), "batch id");
    assert(new Set(r.runs.map((x) => x.id)).size === 3, "3 distinct ids");
  });

  await check("metadata is stored on the row", async () => {
    const r = await tA.trigger({}, { metadata: { teamId: "t1" } });
    assert((await getRunRow(r.id))?.metadata.teamId === "t1", "metadata");
  });

  await check("schemaTask parses the payload at trigger time", async () => {
    const r = await tS.trigger({ a: 1 });
    assert(((await getRunRow(r.id)) as any)?.payload.parsed === true, "parsed");
  });

  await check(
    "unsupported lifecycle hooks and cron timezones are rejected",
    async () => {
      for (const key of [
        "onFailure",
        "onStart",
        "onSuccess",
        "onComplete",
        "onWait",
        "onResume",
        "onCancel",
        "middleware",
        "init",
        "cleanup",
        "catchError",
      ]) {
        await throwsWith(
          () => task({ id: "t-f", run: async () => 1, [key]: () => {} }),
          `${key} is not supported by the DBOS jobs backend`,
        );
      }
      await throwsWith(
        () =>
          schedules.task({
            id: "t-c",
            cron: { pattern: "* * * * *", timezone: "America/Sao_Paulo" },
            run: async () => 1,
          }),
        "timezone",
      );
      schedules.task({ id: "t-c1", cron: "* * * * *", run: async () => 1 });
      schedules.task({
        id: "t-c2",
        cron: { pattern: "* * * * *", timezone: "UTC" },
        run: async () => 1,
      });
    },
  );

  await check(
    "duplicate ids replace by default and throw in strict mode",
    async () => {
      task({ id: "t-a", run: async () => 1 });
      setStrictRegistry(true);
      try {
        await throwsWith(
          () => task({ id: "t-a", run: async () => 1 }),
          "already registered",
        );
      } finally {
        setStrictRegistry(false);
      }
    },
  );

  await check("same key twice with a one-connection pool does not hang", () => {
    const child = spawnSync(
      "npx",
      [
        "tsx",
        "--tsconfig",
        "oss/tsconfig.jobs.json",
        "oss/jobs/trigger.verify.ts",
      ],
      {
        env: { ...process.env, JOBS_DB_POOL_SIZE: "1", POOL1_CHILD: "1" },
        timeout: 20_000,
        encoding: "utf8",
      },
    );
    assert(child.status === 0, `child failed: ${child.stdout}${child.stderr}`);
  });

  await destroyClient();
  await getPool().end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
