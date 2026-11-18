/**
 * The jobs worker: task discovery, the real task files, cron schedules,
 * restart safety and the crash cap, with real worker processes on real
 * Postgres.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { loadEnvConfig } from "@next/env";

import {
  assert,
  check,
  sleep,
  useIsolatedSchemas,
  waitForStatus,
} from "./testing";

loadEnvConfig(process.cwd());

const ROOT = process.cwd();
const READY = "jobs worker ready:";

// ---------------------------------------------------------------------------
// Worker child processes (the fixture), always killed when the test ends.

type Child = {
  proc: ChildProcess;
  output: string[];
  exited: Promise<number | null>;
};

const children = new Set<Child>();

/** Kills the child's whole process group (npx -> tsx -> node). */
function killGroup(child: Child, signal: NodeJS.Signals): void {
  try {
    process.kill(-child.proc.pid!, signal);
  } catch {
    // Already gone.
  }
}

function spawnWorker(counterDir: string): Child {
  const proc = spawn(
    "npx",
    [
      "tsx",
      "--tsconfig",
      "oss/tsconfig.jobs.json",
      "oss/jobs/worker.verify-fixture.ts",
    ],
    {
      cwd: ROOT,
      // Its own process group, so a kill reaches tsx's node grandchild.
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        JOBS_SCHEMA: process.env.JOBS_SCHEMA,
        JOBS_DBOS_SCHEMA: process.env.JOBS_DBOS_SCHEMA,
        WORKER_FIXTURE_DIR: counterDir,
      },
    },
  );
  const output: string[] = [];
  proc.stdout!.on("data", (d) => output.push(String(d)));
  proc.stderr!.on("data", (d) => output.push(String(d)));
  const child: Child = {
    proc,
    output,
    exited: new Promise((resolve) => proc.on("exit", (code) => resolve(code))),
  };
  children.add(child);
  child.exited.then(() => children.delete(child));
  return child;
}

function killAll(): void {
  for (const child of children) killGroup(child, "SIGKILL");
}
process.on("exit", killAll);

const outputOf = (child: Child) => child.output.join("");

async function waitFor(
  what: string,
  fn: () => boolean,
  timeoutMs: number,
  child?: Child,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!fn()) {
    if (Date.now() > deadline) {
      const log = child ? `\n--- worker output ---\n${outputOf(child)}` : "";
      throw new Error(`assertion failed: ${what} within ${timeoutMs} ms${log}`);
    }
    await sleep(100);
  }
}

async function waitReady(child: Child): Promise<void> {
  let exitCode: number | null | undefined;
  child.exited.then((code) => (exitCode = code));
  await waitFor(
    "worker ready",
    () => {
      if (exitCode !== undefined) {
        throw new Error(
          `worker exited with ${exitCode} before ready:\n${outputOf(child)}`,
        );
      }
      return outputOf(child).includes(READY);
    },
    60_000,
    child,
  );
}

/** Waits for the child to exit and returns its exit code. */
async function waitExit(child: Child, timeoutMs: number): Promise<number | null> {
  const timeout = sleep(timeoutMs).then(() => "timeout" as const);
  const result = await Promise.race([child.exited, timeout]);
  if (result === "timeout") {
    throw new Error(
      `assertion failed: worker still running after ${timeoutMs} ms\n${outputOf(child)}`,
    );
  }
  return result;
}

/** SIGINT, then expects a clean exit (code 0). */
async function stopWorker(child: Child): Promise<void> {
  killGroup(child, "SIGINT");
  const code = await waitExit(child, 20_000);
  assert(code === 0, `worker exits cleanly on SIGINT (code ${code})`);
}

function counter(dir: string, name: string): number {
  try {
    return Number(readFileSync(path.join(dir, name), "utf8"));
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------

async function main() {
  const { discoverTaskFiles, startWorker } = await import("./worker");
  const { MAX_RECOVERY_ATTEMPTS, workerConcurrency } = await import("./config");

  let files: string[] = [];
  await check("discover: real task files, no verify scripts", async () => {
    files = await discoverTaskFiles(ROOT);
    const rel = files.map((f) => path.relative(ROOT, f));
    for (const expected of [
      "lib/trigger/pdf-to-image-route.ts",
      "lib/trigger/queues.ts",
      "oss/features/conversions/lib/trigger/convert-files.ts",
      "oss/features/ai/lib/trigger.ts",
    ]) {
      assert(rel.includes(expected), `discovers ${expected}`);
    }
    assert(!rel.some((f) => f.endsWith(".verify.ts")), "no *.verify.ts");
    assert(
      rel.every((f) => !f.startsWith("ee/") && !f.includes("/ee/")),
      "nothing under ee/",
    );
    assert(
      JSON.stringify(files) === JSON.stringify([...files].sort()),
      "sorted",
    );
  });

  await useIsolatedSchemas("worker");
  const { DBOS } = await import("@dbos-inc/dbos-sdk");
  const { getTask, allTasks } = await import("./registry");
  const { findRunRows } = await import("./store");
  const { destroyClient } = await import("./client");
  const { getPool } = await import("./db");

  // Records the worker's ready line; the real tasks' logs stay out of the
  // terminal, and so does Node's warning about the localStorage probe in
  // @electric-sql/client (loaded by trigger.config's @trigger.dev/build).
  const logs: string[] = [];
  const log = console.log;
  console.log = (...args: unknown[]) => {
    const line = args.map(String).join(" ");
    logs.push(line);
    if (line.startsWith("ok ")) log(line);
  };
  process.removeAllListeners("warning");
  process.on("warning", (warning) => {
    if (!warning.message.includes("localStorage")) console.warn(warning);
  });
  const worker = await startWorker({ files });

  await check("worker: loads the real tasks and logs ready", async () => {
    const ready = logs.find((l) => l.startsWith(READY));
    assert(ready, `ready line logged (got ${JSON.stringify(logs)})`);
    const m = ready.match(
      /^jobs worker ready: (\d+) tasks, (\d+) queues, (\d+) schedules, concurrency (\d+)$/,
    );
    assert(m, `ready line format: ${ready}`);
    assert(Number(m[1]) === allTasks().length && Number(m[1]) >= 22, ready);
    assert(Number(m[3]) === 1, `one schedule: ${ready}`);
    assert(getTask("cleanup-expired-exports")?.kind === "scheduled", "cron task");
  });

  await check("worker: pool defaults to concurrency + 4 connections", () => {
    assert(process.env.JOBS_DB_POOL_SIZE === undefined, "JOBS_DB_POOL_SIZE unset");
    const max = getPool().options.max;
    assert(max === workerConcurrency() + 4, `pool max ${max}`);
  });

  await check("worker: applies the cron schedule", async () => {
    const schedule = await DBOS.getSchedule("cleanup-expired-exports");
    assert(schedule, "schedule exists");
    assert(schedule.schedule === "0 2 * * *", `cron: ${schedule.schedule}`);
    assert(schedule.cronTimezone === "UTC", "UTC");
    assert(schedule.automaticBackfill === false, "no backfill");
    assert(
      (schedule.context as { taskId?: string }).taskId ===
        "cleanup-expired-exports",
      "context.taskId",
    );
  });

  await check("worker: triggerSchedule makes exactly one run", async () => {
    const handle = await DBOS.triggerSchedule("cleanup-expired-exports");
    const id = handle.workflowID;
    // The run row is written by the scheduled workflow when it starts.
    let rows = await findRunRows({ taskIds: ["cleanup-expired-exports"] });
    const deadline = Date.now() + 20_000;
    while (rows.length === 0 && Date.now() < deadline) {
      await sleep(100);
      rows = await findRunRows({ taskIds: ["cleanup-expired-exports"] });
    }
    assert(rows.length === 1, `one run row (got ${rows.length})`);
    assert(rows[0].id === id, "row id is the workflow id");
    const timestamp = (rows[0].payload as { timestamp?: unknown }).timestamp;
    assert(
      typeof timestamp === "string" && !Number.isNaN(Date.parse(timestamp)),
      `payload.timestamp set (${timestamp})`,
    );
    await waitForStatus(id, ["COMPLETED", "FAILED"], 60_000);
    rows = await findRunRows({ taskIds: ["cleanup-expired-exports"] });
    assert(rows.length === 1, `still one run row (got ${rows.length})`);
  });

  await worker.stop();
  console.log = log;
  await destroyClient();

  // Child-process workers use their own schemas.
  await useIsolatedSchemas("worker_child");
  const { tasks } = await import("./sdk");
  const dir = mkdtempSync(path.join(tmpdir(), "jobs-worker-verify-"));
  try {
    await check("restart: killed runs resume and complete", async () => {
      let child = spawnWorker(dir);
      await waitReady(child);
      const long = await tasks.trigger("fx-long", {});
      const delayed = await tasks.trigger("fx-delayed", {}, { delay: "3s" });
      await waitFor("long task started", () => counter(dir, "long") === 1, 20_000, child);
      await sleep(1000);
      killGroup(child, "SIGKILL");
      await waitExit(child, 10_000);
      assert(counter(dir, "delayed") === 0, "delayed run not run yet");

      child = spawnWorker(dir);
      await waitReady(child);
      await waitForStatus(long.id, ["COMPLETED"], 30_000);
      await waitForStatus(delayed.id, ["COMPLETED"], 30_000);
      assert(counter(dir, "long") === 2, `long body ran twice (${counter(dir, "long")})`);
      assert(counter(dir, "delayed") === 1, "delayed body ran once");
      await stopWorker(child);
    });

    await check("graceful stop: SIGINT waits for executing runs", async () => {
      const child = spawnWorker(dir);
      await waitReady(child);
      const before = counter(dir, "long");
      const long = await tasks.trigger("fx-long", {});
      await waitFor("long task started", () => counter(dir, "long") === before + 1, 20_000, child);
      await stopWorker(child);
      // No worker is running now: the run finished during the drain.
      assert(
        (await waitForStatus(long.id, ["COMPLETED", "EXECUTING"])) === "COMPLETED",
        "run completed before the worker exited",
      );
      assert(counter(dir, "long") === before + 1, "body ran once");
    });

    await check("crash cap: a run that keeps killing the worker ends CRASHED", async () => {
      const run = await tasks.trigger("fx-crash", {});
      // First start plus MAX_RECOVERY_ATTEMPTS restarts: each runs the body,
      // which kills the worker.
      for (let start = 1; start <= MAX_RECOVERY_ATTEMPTS + 1; start++) {
        const child = spawnWorker(dir);
        const code = await waitExit(child, 60_000);
        assert(code !== 0, `start ${start}: worker crashed (code ${code})`);
        assert(counter(dir, "crash") === start, `start ${start}: body ran ${counter(dir, "crash")} times`);
      }
      // Restart number MAX_RECOVERY_ATTEMPTS + 1 dead-letters the run.
      let child = spawnWorker(dir);
      await waitReady(child);
      await waitForStatus(run.id, ["CRASHED"], 30_000);
      assert(child.proc.exitCode === null, "worker survives");
      await stopWorker(child);

      child = spawnWorker(dir);
      await waitReady(child);
      await sleep(3000);
      assert(child.proc.exitCode === null, "next restart: worker survives");
      assert(
        counter(dir, "crash") === MAX_RECOVERY_ATTEMPTS + 1,
        `next restart: body not run again (${counter(dir, "crash")})`,
      );
      assert((await waitForStatus(run.id, ["CRASHED"])) === "CRASHED", "still CRASHED");
      await stopWorker(child);
    });
  } finally {
    killAll();
    rmSync(dir, { recursive: true, force: true });
  }

  await destroyClient();
  await getPool().end();
}

main().then(
  () => process.exit(0),
  (error) => {
    killAll();
    console.error(error);
    process.exit(1);
  },
);
