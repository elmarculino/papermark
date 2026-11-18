/**
 * Worker process for worker.verify.ts (restart safety and the crash cap).
 * Each task body counts its executions in a file under WORKER_FIXTURE_DIR.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { task } from "./sdk";
import { runWorker } from "./worker";

function bump(name: string): void {
  const file = path.join(process.env.WORKER_FIXTURE_DIR!, name);
  let n = 0;
  try {
    n = Number(readFileSync(file, "utf8"));
  } catch {
    // First run.
  }
  writeFileSync(file, String(n + 1));
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

runWorker({ files: [] }).catch((error) => {
  console.error(error);
  process.exit(1);
});
