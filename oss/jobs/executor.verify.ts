/**
 * The DBOS executor: retries, failure log, metadata, triggerAndWait,
 * cancellation and idempotency, with a real worker on real Postgres.
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

/** Records console output; lines matching `hide` are kept out of the terminal. */
function capture(
  method: "log" | "warn" | "error",
  hide: (line: string) => boolean,
) {
  const original = console[method];
  const lines: string[] = [];
  console[method] = (...args: unknown[]) => {
    const line = args.map(String).join(" ");
    lines.push(line);
    if (!hide(line)) original(...args);
  };
  return lines;
}

const FAILED_LINE = '"event":"job.failed"';
const SECRET = "hunter2-do-not-log";

async function main() {
  await useIsolatedSchemas("exec");
  const { task, metadata, logger, AbortTaskRunError } = await import("./sdk");
  const { getClient, destroyClient } = await import("./client");
  const { getPool } = await import("./db");
  const { getRunRow } = await import("./store");

  // Hidden: our failure lines and DBOS's own logs of the deliberate failures.
  const expected = (line: string) =>
    line.includes(FAILED_LINE) ||
    /^(flaky|nope) \n/.test(line) ||
    line.includes("outcome was not recorded");
  const stderr = capture("error", expected);
  capture("warn", expected);
  const stdout = capture(
    "log",
    (line) => line.includes('"message":"tick"') || expected(line),
  );

  const calls = new Map<string, number>();
  const count = (key: string) => {
    const n = (calls.get(key) ?? 0) + 1;
    calls.set(key, n);
    return n;
  };

  const tOk = task({ id: "t-ok", run: async () => ({ v: 2 }) });
  const tFlaky = task({
    id: "t-flaky",
    retry: {
      maxAttempts: 3,
      minTimeoutInMs: 10,
      maxTimeoutInMs: 20,
      factor: 1,
    },
    run: async (_p: unknown, { ctx }) => {
      if (count(ctx.run.id) < 3) throw new Error("flaky");
      return ctx.attempt.number;
    },
  });
  const tAbort = task({
    id: "t-abort",
    retry: {
      maxAttempts: 3,
      minTimeoutInMs: 10,
      maxTimeoutInMs: 20,
      factor: 1,
    },
    run: async (_p: unknown, { ctx }) => {
      count(ctx.run.id);
      throw new AbortTaskRunError("nope");
    },
  });
  const tMeta = task({
    id: "t-meta",
    run: async () => {
      metadata.set("status", { progress: 40 });
    },
  });
  const tChildMeta = task({
    id: "t-child-meta",
    run: async () => {
      metadata.parent.set("status", { progress: 70 });
    },
  });
  const tParentMeta = task({
    id: "t-parent-meta",
    run: async () => {
      await tChildMeta.triggerAndWait({});
    },
  });
  const tSeven = task({ id: "t-seven", run: async () => 7 });
  const tParentWait = task({
    id: "t-parent-wait",
    run: async (p: { which: "seven" | "abort" }) => {
      const r =
        p.which === "seven"
          ? await tSeven.triggerAndWait({})
          : await tAbort.triggerAndWait({});
      let unwrapThrew = false;
      try {
        r.unwrap();
      } catch {
        unwrapThrew = true;
      }
      return { ok: r.ok, output: r.ok ? r.output : null, unwrapThrew };
    },
  });
  const tTick = task({
    id: "t-tick",
    run: async () => {
      for (;;) {
        await sleep(200);
        logger.info("tick");
      }
    },
  });
  const tK3Parent = task({
    id: "t-k3-parent",
    run: async () => (await tOk.trigger({}, { idempotencyKey: "k3" })).id,
  });

  const worker = await startTestWorker();
  const client = await getClient();
  const result = (id: string) => client.retrieveWorkflow(id).getResult();

  await check(
    "a task returning {v: 2} completes with that output",
    async () => {
      const { id } = await tOk.trigger({});
      assert(
        (await waitForStatus(id, ["COMPLETED", "FAILED"])) === "COMPLETED",
        "status",
      );
      const output = (await result(id)) as { v: number };
      assert(output.v === 2, `output ${JSON.stringify(output)}`);
    },
  );

  await check("throws twice then succeeds on attempt 3", async () => {
    const { id } = await tFlaky.trigger({
      documentVersionId: "dv1",
      secret: SECRET,
    });
    assert(
      (await waitForStatus(id, ["COMPLETED", "FAILED"])) === "COMPLETED",
      "status",
    );
    assert((await result(id)) === 3, "ctx.attempt.number is 3");
  });

  await check(
    "maxAttempts 1 at trigger time fails with one safe failure line",
    async () => {
      const { id } = await tFlaky.trigger(
        { documentVersionId: "dv1", secret: SECRET },
        { maxAttempts: 1 },
      );
      assert(
        (await waitForStatus(id, ["COMPLETED", "FAILED"])) === "FAILED",
        "status",
      );
      const lines = stderr.filter(
        (l) => l.includes(FAILED_LINE) && l.includes(id),
      );
      assert(
        lines.length === 1,
        `expected 1 failure line, got ${lines.length}`,
      );
      assert(lines[0].includes('"documentVersionId":"dv1"'), lines[0]);
      assert(
        !lines[0].includes(SECRET),
        "secret value leaked into the failure line",
      );
    },
  );

  await check(
    "AbortTaskRunError fails after one attempt despite maxAttempts 3",
    async () => {
      const { id } = await tAbort.trigger({});
      assert(
        (await waitForStatus(id, ["COMPLETED", "FAILED"])) === "FAILED",
        "status",
      );
      assert(calls.get(id) === 1, `attempts ${calls.get(id)}`);
    },
  );

  await check(
    "metadata.set persists on the row; outside a run it's a no-op",
    async () => {
      metadata.set("status", { progress: 1 });
      metadata.parent.set("status", { progress: 1 });
      const { id } = await tMeta.trigger({});
      assert(
        (await waitForStatus(id, ["COMPLETED", "FAILED"])) === "COMPLETED",
        "status",
      );
      const row = await getRunRow(id);
      const status = row?.metadata.status as { progress: number } | undefined;
      assert(
        status?.progress === 40,
        `metadata ${JSON.stringify(row?.metadata)}`,
      );
    },
  );

  await check("metadata.parent.set writes to the parent row", async () => {
    const { id } = await tParentMeta.trigger({});
    assert(
      (await waitForStatus(id, ["COMPLETED", "FAILED"])) === "COMPLETED",
      "status",
    );
    const status = (await getRunRow(id))?.metadata.status as
      | { progress: number }
      | undefined;
    assert(
      status?.progress === 70,
      `parent metadata ${JSON.stringify(status)}`,
    );
  });

  await check(
    "triggerAndWait returns ok/output, and ok:false for an aborted child",
    async () => {
      const good = await tParentWait.trigger({ which: "seven" });
      const bad = await tParentWait.trigger({ which: "abort" });
      for (const id of [good.id, bad.id]) {
        assert(
          (await waitForStatus(id, ["COMPLETED", "FAILED"])) === "COMPLETED",
          id,
        );
      }
      const g = (await result(good.id)) as { ok: boolean; output: number };
      assert(g.ok === true && g.output === 7, `good ${JSON.stringify(g)}`);
      const b = (await result(bad.id)) as { ok: boolean; unwrapThrew: boolean };
      assert(b.ok === false && b.unwrapThrew, `bad ${JSON.stringify(b)}`);
    },
  );

  await check("triggerAndWait outside a run throws", async () => {
    let message = "";
    await tSeven.triggerAndWait({}).catch((e: Error) => (message = e.message));
    assert(
      message === "triggerAndWait can only be called inside a task run",
      message,
    );
  });

  await check(
    "a canceled running task ends CANCELED and stops ticking",
    async () => {
      const { id } = await tTick.trigger({});
      await waitForStatus(id, ["EXECUTING"]);
      await sleep(500);
      const ticksOf = () =>
        stdout.filter((l) => l.includes('"message":"tick"') && l.includes(id))
          .length;
      assert(ticksOf() > 0, "ticked before cancel");
      await client.cancelWorkflow(id);
      const deadline = Date.now() + 5000;
      while (!stderr.some((l) => l.includes(FAILED_LINE) && l.includes(id))) {
        assert(Date.now() < deadline, "body still running 5 s after cancel");
        await sleep(100);
      }
      const ticks = ticksOf();
      await sleep(1000);
      assert(ticksOf() === ticks, "ticks continued after the body stopped");
      assert(
        (await waitForStatus(id, ["CANCELED", "FAILED"])) === "CANCELED",
        "status",
      );
    },
  );

  await check("idempotency: a failed run frees its key", async () => {
    const first = await tAbort.trigger({}, { idempotencyKey: "k1" });
    await waitForStatus(first.id, ["FAILED"]);
    const second = await tAbort.trigger({}, { idempotencyKey: "k1" });
    assert(second.id !== first.id, "new run after failure");
    await waitForStatus(second.id, ["FAILED"]);
  });

  await check("idempotency: a completed run keeps its key", async () => {
    const first = await tOk.trigger({}, { idempotencyKey: "k2" });
    await waitForStatus(first.id, ["COMPLETED"]);
    const second = await tOk.trigger({}, { idempotencyKey: "k2" });
    assert(second.id === first.id, "same run after completion");
  });

  await check(
    "idempotency: raw keys inside a run are scoped to that run",
    async () => {
      const a = await tK3Parent.trigger({});
      const b = await tK3Parent.trigger({});
      await waitForStatus(a.id, ["COMPLETED"]);
      await waitForStatus(b.id, ["COMPLETED"]);
      const childA = (await result(a.id)) as string;
      const childB = (await result(b.id)) as string;
      assert(childA !== childB, "two child runs");
      await waitForStatus(childA, ["COMPLETED"]);
      await waitForStatus(childB, ["COMPLETED"]);
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
