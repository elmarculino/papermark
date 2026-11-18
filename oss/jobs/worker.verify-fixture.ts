/**
 * Worker process for worker.verify.ts (restart safety, the crash cap and
 * bounded claims).
 * Each task body counts its executions in a file under WORKER_FIXTURE_DIR.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { queue, task } from "./sdk";
import { runWorker } from "./worker";

function bump(name: string): number {
  const file = path.join(process.env.WORKER_FIXTURE_DIR!, name);
  let n = 0;
  try {
    n = Number(readFileSync(file, "utf8"));
  } catch {
    // First run.
  }
  writeFileSync(file, String(n + 1));
  return n + 1;
}

task({
  id: "fx-long",
  retry: { maxAttempts: 1 },
  run: async () => {
    bump("long");
    await new Promise((resolve) => setTimeout(resolve, 3000));
    return "long done";
  },
});

task({
  id: "fx-delayed",
  retry: { maxAttempts: 1 },
  run: async () => {
    bump("delayed");
    return "delayed done";
  },
});

task({
  id: "fx-crash",
  run: async () => {
    bump("crash");
    process.exit(1);
  },
});

// The poison run and the runs behind it share one queue.
const poisonQueue = queue({ name: "fx-poison-q" });

task({
  id: "fx-poison",
  queue: poisonQueue,
  run: async () => {
    bump("poison");
    // Holds the worker's only slot long enough for fx-steady's queue to claim
    // its run, which then waits for the slot.
    await new Promise((resolve) => setTimeout(resolve, 2500));
    process.exit(1);
  },
});

// A run on another queue: its first start is cut short by a worker kill,
// then it is claimed again on every restart while the poison run holds the slot.
task({
  id: "fx-steady",
  queue: queue({ name: "fx-steady-q" }),
  retry: { maxAttempts: 1 },
  run: async () => {
    if (bump("steady") === 1) await new Promise(() => {});
    return "steady done";
  },
});

task({
  id: "fx-normal",
  queue: poisonQueue,
  retry: { maxAttempts: 1 },
  run: async () => {
    bump("normal");
    return "normal done";
  },
});

runWorker({ files: [] }).catch((error) => {
  console.error(error);
  process.exit(1);
});
