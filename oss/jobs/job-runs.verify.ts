/** The /api/job-runs handler: scoping, token failures, backend switch, with a real worker on real Postgres. */
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
  await useIsolatedSchemas("jobruns");
  const { task, metadata, auth } = await import("./sdk");
  const { handleJobRuns } = await import("./job-runs-handler");
  const { destroyClient } = await import("./client");
  const { getPool } = await import("./db");

  const tProgress = task({
    id: "jr-progress",
    run: async () => {
      metadata.set("status", { progress: 0.5, label: "half" });
      return "ok";
    },
  });

  const worker = await startTestWorker();
  const get = (query: Record<string, string>, token?: string) =>
    handleJobRuns({
      method: "GET",
      query,
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
  const tagToken = (tags: string[], expirationTime?: string) =>
    auth.createPublicToken({ scopes: { read: { tags } }, expirationTime });

  const first = await tProgress.trigger({}, { tags: ["version:v1"] });
  await waitForStatus(first.id, ["COMPLETED"]);
  await sleep(20);
  const second = await tProgress.trigger({}, { tags: ["version:v1"] });
  await waitForStatus(second.id, ["COMPLETED"]);
  const other = await tProgress.trigger({}, { tags: ["version:v2"] });
  await waitForStatus(other.id, ["COMPLETED"]);

  await check("tag token: 200, newest first, metadata present", async () => {
    const res = await get(
      { tag: "version:v1" },
      await tagToken(["version:v1"]),
    );
    assert(res.status === 200, `status ${res.status}`);
    const runs = (res.body as { runs: any[] }).runs;
    assert(runs.length === 2, `count ${runs.length}`);
    assert(runs[0].id === second.id && runs[1].id === first.id, "newest first");
    assert(runs[0].metadata?.status?.progress === 0.5, "progress");
    assert(typeof runs[0].createdAt === "string", "ISO createdAt");
    assert(runs[0].status === "COMPLETED", "status");
  });

  await check("tag token: other tag is 403", async () => {
    const res = await get(
      { tag: "version:v2" },
      await tagToken(["version:v1"]),
    );
    assert(res.status === 403, `status ${res.status}`);
  });

  await check("tampered token is 401", async () => {
    const token = await tagToken(["version:v1"]);
    const res = await get({ tag: "version:v1" }, token.slice(0, -2) + "xx");
    assert(res.status === 401, `status ${res.status}`);
  });

  await check("missing token is 401", async () => {
    assert((await get({ tag: "version:v1" })).status === 401, "missing");
  });

  await check("expired token is 401", async () => {
    const token = await tagToken(["version:v1"], "1s");
    await sleep(1500);
    assert((await get({ tag: "version:v1" }, token)).status === 401, "expired");
  });

  await check("run token: own run 200, another run 403", async () => {
    const token = await auth.createPublicToken({
      scopes: { read: { runs: [first.id] } },
    });
    const res = await get({ runId: first.id }, token);
    assert(res.status === 200, `status ${res.status}`);
    const runs = (res.body as { runs: any[] }).runs;
    assert(runs.length === 1 && runs[0].id === first.id, "one run");
    assert((await get({ runId: other.id }, token)).status === 403, "other run");
  });

  await check("params: neither or both is 400; wrong method 405", async () => {
    const token = await tagToken(["version:v1"]);
    assert((await get({}, token)).status === 400, "neither");
    assert((await get({ tag: "a", runId: "b" }, token)).status === 400, "both");
    const res = await handleJobRuns({ method: "POST", query: {}, headers: {} });
    assert(res.status === 405, "method");
  });

  await check("missing NEXTAUTH_SECRET is 500, not 401", async () => {
    const token = await tagToken(["version:v1"]);
    const saved = process.env.NEXTAUTH_SECRET;
    delete process.env.NEXTAUTH_SECRET;
    const quiet = console.error;
    console.error = () => {};
    try {
      assert((await get({ tag: "version:v1" }, token)).status === 500, "500");
    } finally {
      console.error = quiet;
      process.env.NEXTAUTH_SECRET = saved;
    }
  });

  await check("JOBS_BACKEND=trigger is 404", async () => {
    const saved = process.env.JOBS_BACKEND;
    process.env.JOBS_BACKEND = "trigger";
    try {
      assert((await get({ tag: "version:v1" })).status === 404, "404");
    } finally {
      if (saved === undefined) delete process.env.JOBS_BACKEND;
      else process.env.JOBS_BACKEND = saved;
    }
  });

  await check("hooks: pollIntervalFor", async () => {
    const { pollIntervalFor, RunsHttpError } = await import("./react-hooks");
    const run = (status: string) => ({ status }) as any;
    assert(pollIntervalFor(undefined) === 1500, "undefined runs");
    assert(
      pollIntervalFor([run("COMPLETED"), run("EXECUTING")]) === 1500,
      "non-final",
    );
    assert(
      pollIntervalFor([run("COMPLETED"), run("FAILED")]) === 0,
      "all final",
    );
    for (const status of [401, 403, 404]) {
      assert(
        pollIntervalFor(undefined, new RunsHttpError(status)) === 0,
        `${status}`,
      );
    }
    assert(pollIntervalFor(undefined, new RunsHttpError(500)) === 1500, "500");
    assert(
      pollIntervalFor(undefined, new Error("network")) === 1500,
      "network",
    );
  });

  await worker.stop();
  await destroyClient();
  await getPool().end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
