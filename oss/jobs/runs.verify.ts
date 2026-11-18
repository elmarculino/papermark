/** Run retrieval, listing, cancellation and public tokens, with a real worker on real Postgres. */
import { loadEnvConfig } from "@next/env";

import {
  assert,
  check,
  sleep,
  startTestWorker,
  throwsWith,
  useIsolatedSchemas,
  waitForStatus,
} from "./testing";

loadEnvConfig(process.cwd());

async function main() {
  await useIsolatedSchemas("runs");
  const { task, runs, auth, metadata } = await import("./sdk");
  const { verifyPublicToken } = await import("./token");
  const { destroyClient } = await import("./client");
  const { getPool } = await import("./db");

  const DEBOUNCE = "send-dataroom-change-notification-test";
  const tOk = task({
    id: "r-ok",
    run: async () => {
      metadata.set("step", "done");
      return { sum: 3 };
    },
  });
  const tFail = task({
    id: "r-fail",
    retry: { maxAttempts: 1 },
    run: async () => {
      throw new Error("kaboom 42");
    },
  });
  const tDebounce = task({
    id: DEBOUNCE,
    run: async (_p: { dataroomDocumentIds: string[] }) => "sent",
  });

  const worker = await startTestWorker();
  const quiet = console.error;

  await check("retrieve: completed run", async () => {
    const handle = await tOk.trigger({}, { metadata: { teamId: "t1" } });
    assert(
      typeof handle.publicAccessToken === "string" &&
        verifyPublicToken(handle.publicAccessToken)?.runs[0] === handle.id,
      "handle token scoped to the run",
    );
    await waitForStatus(handle.id, ["COMPLETED"]);
    const run = await runs.retrieve(handle.id);
    assert(run.status === "COMPLETED", "status");
    assert(run.isCompleted && run.isSuccess, "flags");
    assert(JSON.stringify(run.output) === '{"sum":3}', "output");
    assert(run.metadata.teamId === "t1", "trigger-time metadata");
    assert(run.taskIdentifier === "r-ok", "taskIdentifier");
  });

  await check("retrieve: failed run carries the error message", async () => {
    console.error = () => {};
    try {
      const handle = await tFail.trigger({});
      await waitForStatus(handle.id, ["FAILED"]);
      const run = await runs.retrieve(handle.id);
      assert(run.isFailed && !run.isSuccess, "flags");
      assert(run.error?.message.includes("kaboom 42"), `error: ${run.error?.message}`);
    } finally {
      console.error = quiet;
    }
  });

  await check("debounce flow: list, retrieve payload, cancel", async () => {
    const tags = ["dataroom_d1", "user_upload_u1"];
    const filter = {
      taskIdentifier: [DEBOUNCE],
      tag: tags,
      status: ["DELAYED", "QUEUED"] as ("DELAYED" | "QUEUED")[],
      period: "15m",
    };
    const handle = await tDebounce.trigger(
      { dataroomDocumentIds: ["a"] },
      { delay: "10m", tags },
    );
    const listed = await runs.list(filter);
    assert(listed.data.length === 1 && listed.data[0].id === handle.id, "listed");
    const run = await runs.retrieve(handle.id);
    assert(
      JSON.stringify((run.payload as any).dataroomDocumentIds) === '["a"]',
      "payload",
    );
    await runs.cancel(handle.id);
    assert((await runs.list(filter)).data.length === 0, "no longer listed");
    const after = await runs.retrieve(handle.id);
    assert(after.status === "CANCELED", `status ${after.status}`);
    assert(after.isCompleted === false, "canceled is not completed");
  });

  await check("unknown run ids reject with Run not found", async () => {
    const id = "run_ffffffffffffffffffffffffffffffff";
    await throwsWith(() => runs.retrieve(id), `Run "${id}" not found`);
    await throwsWith(() => runs.cancel(id), `Run "${id}" not found`);
  });

  await check("token: round trip and tamper", async () => {
    const token = await auth.createPublicToken({
      scopes: { read: { tags: ["version:v1"] } },
    });
    assert(
      JSON.stringify(verifyPublicToken(token)) ===
        '{"tags":["version:v1"],"runs":[]}',
      "round trip",
    );
    for (let i = 0; i < token.length; i++) {
      const flipped = token[i] === "A" ? "B" : "A";
      const bad = token.slice(0, i) + flipped + token.slice(i + 1);
      assert(verifyPublicToken(bad) === null, `char ${i} changed`);
    }
    assert(verifyPublicToken("garbage") === null, "malformed");
    assert(verifyPublicToken(token + "x") === null, "extended");
  });

  await check("token: expires", async () => {
    const token = await auth.createPublicToken({
      scopes: { read: { runs: ["run_x"] } },
      expirationTime: "1s",
    });
    assert(verifyPublicToken(token) !== null, "valid before expiry");
    await sleep(1500);
    assert(verifyPublicToken(token) === null, "expired");
  });

  await worker.stop();
  await destroyClient();
  await getPool().end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
