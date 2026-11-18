/**
 * Runtime check for the QStash replacement (oss/qstash) against real Postgres
 * and an in-process jobs worker:
 *   npx tsx --tsconfig oss/tsconfig.jobs.json oss/qstash/qstash.verify.ts
 * Creates a throwaway team and webhook in the dev database and deletes them.
 */
import { loadEnvConfig } from "@next/env";
import { createHmac } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import {
  assert,
  check,
  throwsWith,
  useIsolatedSchemas,
  waitForStatus,
} from "../jobs/testing";

loadEnvConfig(process.cwd());
delete process.env.QSTASH_TOKEN;

type Hit = { body: string; signature: string | undefined };

async function main() {
  await useIsolatedSchemas("qstash");
  const { default: prisma } = await import("../../lib/prisma");
  const { sendWebhooks } = await import("../../lib/webhook/send-webhooks");
  const { deliverWebhookTask, assertDeliverableUrl } =
    await import("./lib/trigger/deliver-webhook");
  await import("./lib/trigger/dataroom-digest");
  const { getTask } = await import("../jobs/registry");
  const { startTestWorker } = await import("../jobs/testing");
  const { destroyClient } = await import("../jobs/client");

  // A local endpoint: answers with the next queued status (default 200).
  const hits: Hit[] = [];
  const statuses: number[] = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      hits.push({
        body,
        signature: req.headers["x-papermark-signature"] as string | undefined,
      });
      res.statusCode = statuses.shift() ?? 200;
      res.end("ok");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`;

  const team = await prisma.team.create({ data: { name: "qstash-verify" } });
  const secret = "whsec_verify";
  const webhook = await prisma.webhook.create({
    data: {
      pId: `wh_verify_${Date.now()}`,
      name: "verify",
      url: endpoint,
      secret,
      triggers: ["dataroom.created"],
      teamId: team.id,
    },
  });
  const data = {
    dataroom: {
      id: "dr_1",
      name: "Q4",
      teamId: team.id,
      createdAt: new Date().toISOString(),
    },
  };

  const worker = await startTestWorker();
  try {
    await check("tasks and schedules are registered", async () => {
      assert(getTask("deliver-webhook")?.kind === "task", "deliver-webhook");
      assert(
        getTask("dataroom-digest-daily")?.kind === "scheduled" &&
          getTask("dataroom-digest-weekly")?.kind === "scheduled",
        "digest schedules",
      );
    });

    await check("private endpoints are refused by default", async () => {
      delete process.env.WEBHOOK_ALLOW_PRIVATE_URLS;
      for (const url of [
        "http://127.0.0.1:9/x",
        "http://localhost/x",
        "http://10.1.2.3/x",
        "http://[::1]/x",
        "http://169.254.169.254/latest",
        "http://[::ffff:192.168.0.1]/x",
      ]) {
        await throwsWith(() => assertDeliverableUrl(url), "private address");
      }
      await throwsWith(
        () => assertDeliverableUrl("ftp://example.com"),
        "not allowed",
      );
      await assertDeliverableUrl("https://8.8.8.8/x");
    });

    process.env.WEBHOOK_ALLOW_PRIVATE_URLS = "true";

    await check(
      "sendWebhooks without QStash delivers a signed POST",
      async () => {
        hits.length = 0;
        await sendWebhooks({
          webhooks: [webhook],
          trigger: "dataroom.created",
          data,
        });
        const deadline = Date.now() + 20000;
        while (hits.length === 0 && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 100));
        }
        assert(hits.length === 1, `one delivery, got ${hits.length}`);
        const payload = JSON.parse(hits[0].body);
        assert(payload.event === "dataroom.created", "event");
        assert(payload.data.dataroom.name === "Q4", "data");
        const expected = createHmac("sha256", secret)
          .update(hits[0].body)
          .digest("hex");
        assert(hits[0].signature === expected, "X-Papermark-Signature matches");
      },
    );

    await check("a 500 answer is retried, then delivered", async () => {
      hits.length = 0;
      statuses.push(500);
      const { prepareWebhookPayload } =
        await import("../../lib/webhook/transform");
      const run = await deliverWebhookTask.trigger({
        webhookId: webhook.pId,
        payload: prepareWebhookPayload("dataroom.created", data),
      });
      const status = await waitForStatus(
        run.id,
        ["COMPLETED", "FAILED"],
        40000,
      );
      assert(status === "COMPLETED", `completed, got ${status}`);
      assert(hits.length === 2, `two attempts, got ${hits.length}`);
    });

    await check("a deleted webhook is not called", async () => {
      hits.length = 0;
      const run = await deliverWebhookTask.trigger({
        webhookId: "wh_missing",
        payload: { id: "evt_x" } as never,
      });
      assert(
        (await waitForStatus(run.id, ["COMPLETED", "FAILED"])) === "COMPLETED",
        "completes",
      );
      assert(hits.length === 0, "no request");
    });
  } finally {
    await worker.stop();
    await destroyClient();
    server.close();
    await prisma.team.delete({ where: { id: team.id } });
    await prisma.$disconnect();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
