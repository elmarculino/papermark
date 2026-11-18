/**
 * Worker-wide cap, per-key queue limits, slot release in triggerAndWait and
 * cancellation while waiting for a slot, with a real worker on real Postgres.
 */
import { loadEnvConfig } from "@next/env";

import {
  assert,
  check,
  sleep,
  startTestWorker,
  useIsolatedSchemas,
  waitForStatus,
} from "./testing";

loadEnvConfig(process.cwd());

async function main() {
  await useIsolatedSchemas("conc");
  const { queue, task } = await import("./sdk");
  const { destroyClient, getClient } = await import("./client");
  const { getPool } = await import("./db");

  let inFlight = 0;
  let maxInFlight = 0;
  const intervals = new Map<string, { start: number; end: number }>();

  const tSlow = task({
    id: "t-slow",
    run: async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await sleep(1000);
      inFlight--;
    },
  });
  const qc = queue({ name: "q-c", concurrencyLimit: 1 });
  const tKeyed = task({
    id: "t-keyed",
    queue: qc,
    run: async (_p: unknown, { ctx }) => {
      const start = Date.now();
      await sleep(1000);
      intervals.set(ctx.run.id, { start, end: Date.now() });
    },
  });
  const tChild = task({ id: "t-child", run: async () => "child" });
  const tParent = task({
    id: "t-parent",
    run: async () => (await tChild.triggerAndWait({})).ok,
  });

  let waiterRan = false;
  const tHold = task({ id: "t-hold", run: () => sleep(8000) });
  const tWaiter = task({
    id: "t-waiter",
    run: async () => {
      waiterRan = true;
    },
  });

  const worker = await startTestWorker({ concurrency: 2 });
  const client = await getClient();
  const overlap = (a: string, b: string) => {
    const x = intervals.get(a)!;
    const y = intervals.get(b)!;
    return x.start < y.end && y.start < x.end;
  };

  await check("at most 2 runs execute at once with concurrency 2", async () => {
    const runs = await Promise.all([1, 2, 3, 4].map(() => tSlow.trigger({})));
    for (const { id } of runs) await waitForStatus(id, ["COMPLETED"]);
    assert(maxInFlight === 2, `max in flight ${maxInFlight}`);
  });

  await check("same concurrencyKey on q-c doesn't overlap", async () => {
    const a = await tKeyed.trigger({}, { concurrencyKey: "same" });
    const b = await tKeyed.trigger({}, { concurrencyKey: "same" });
    await waitForStatus(a.id, ["COMPLETED"]);
    await waitForStatus(b.id, ["COMPLETED"]);
    assert(!overlap(a.id, b.id), "runs overlapped");
  });

  await check("different concurrencyKeys on q-c overlap", async () => {
    const a = await tKeyed.trigger({}, { concurrencyKey: "k-a" });
    const b = await tKeyed.trigger({}, { concurrencyKey: "k-b" });
    await waitForStatus(a.id, ["COMPLETED"]);
    await waitForStatus(b.id, ["COMPLETED"]);
    assert(overlap(a.id, b.id), "runs did not overlap");
  });

  await check(
    "parents filling every slot in triggerAndWait still let children run",
    async () => {
      // Two parents take both slots; without yielding, the children would never start.
      const started = Date.now();
      const parents = await Promise.all([
        tParent.trigger({}),
        tParent.trigger({}),
      ]);
      for (const { id } of parents) {
        const status = await waitForStatus(id, ["COMPLETED", "FAILED"], 10_000);
        assert(status === "COMPLETED", `parent ${status}`);
      }
      assert(Date.now() - started < 10_000, "took 10 s or more");
    },
  );

  await check(
    "a run canceled while waiting for a slot ends CANCELED and never runs",
    async () => {
      const holders = await Promise.all([tHold.trigger({}), tHold.trigger({})]);
      for (const { id } of holders) await waitForStatus(id, ["EXECUTING"]);
      const waiter = await tWaiter.trigger({});
      await sleep(1500); // claimed, waiting for one of the two slots
      await client.cancelWorkflow(waiter.id);
      for (const { id } of holders) await waitForStatus(id, ["COMPLETED"]);
      await sleep(500);
      assert(!waiterRan, "the canceled run's body ran");
      assert(
        (await waitForStatus(waiter.id, ["CANCELED", "COMPLETED"])) ===
          "CANCELED",
        "status",
      );
    },
  );

  await worker.stop();
  await destroyClient();
  await getPool().end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
