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
        "http://198.18.0.1/x",
        "http://224.0.0.1/x",
        "http://[64:ff9b::7f00:1]/x",
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

    await check("every attempt is in the webhook's event log", async () => {
      const { getWebhookEvents } = await import("../../lib/tinybird/pipes");
      const { data } = await getWebhookEvents({ webhookId: webhook.pId });
      const statuses = data.map((e) => e.http_status).sort();
      assert(
        JSON.stringify(statuses) === JSON.stringify([200, 200, 500]),
        `logged statuses: ${JSON.stringify(statuses)}`,
      );
      assert(
        data.every((e) => e.event === "dataroom.created"),
        "event",
      );
    });

    await check(
      "link.created payload links to the install, not papermark.com",
      async () => {
        hits.length = 0;
        const { sendLinkCreatedWebhook } =
          await import("../../lib/webhook/triggers/link-created");
        const { PUBLIC_LINK_BASE_URL } = await import("../_shared/public-host");
        await prisma.webhook.update({
          where: { pId: webhook.pId },
          data: { triggers: ["link.created"] },
        });
        const document = await prisma.document.create({
          data: { name: "Doc", file: "x", teamId: team.id },
        });
        const link = await prisma.link.create({
          data: { documentId: document.id, teamId: team.id, name: "L" },
        });
        await sendLinkCreatedWebhook({
          teamId: team.id,
          data: { link_id: link.id, document_id: document.id },
        });
        const deadline = Date.now() + 20000;
        while (hits.length === 0 && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 100));
        }
        assert(hits.length === 1, `one delivery, got ${hits.length}`);
        const sent = JSON.parse(hits[0].body).data.link;
        assert(
          sent.url === `${PUBLIC_LINK_BASE_URL}/view/${link.id}` &&
            !sent.url.includes("papermark.com"),
          `link url: ${sent.url}`,
        );
      },
    );

    await check(
      "a trickling or huge answer can't hold the worker",
      async () => {
        const { postJson } = await import("./lib/trigger/deliver-webhook");
        const slow = createServer((req, res) => {
          req.resume();
          res.writeHead(200);
          if (req.url === "/trickle") {
            const t = setInterval(() => res.write("."), 100);
            res.on("close", () => clearInterval(t));
          } else {
            res.end(Buffer.alloc(5_000_000, "a"));
          }
        });
        await new Promise<void>((r) => slow.listen(0, "127.0.0.1", r));
        const port = (slow.address() as AddressInfo).port;
        process.env.WEBHOOK_DELIVERY_TIMEOUT_MS = "1000";
        try {
          const started = Date.now();
          let error = "";
          await postJson(`http://127.0.0.1:${port}/trickle`, "{}", {}).catch(
            (e) => (error = String(e)),
          );
          assert(error.includes("timed out"), `trickle: ${error}`);
          assert(Date.now() - started < 3000, "deadline is wall-clock");
          const big = await postJson(`http://127.0.0.1:${port}/big`, "{}", {});
          assert(
            big.status === 200 && big.body.length === 10_000,
            "10 KB kept",
          );
        } finally {
          delete process.env.WEBHOOK_DELIVERY_TIMEOUT_MS;
          slow.close();
        }
      },
    );

    await check(
      "DNS rebinding: private at connect time is refused",
      async () => {
        delete process.env.WEBHOOK_ALLOW_PRIVATE_URLS;
        hits.length = 0;
        const port = (server.address() as AddressInfo).port;
        const rebind = await prisma.webhook.create({
          data: {
            pId: `wh_rebind_${Date.now()}`,
            name: "rebind",
            url: `http://rebind.test:${port}/hook`,
            secret,
            triggers: ["dataroom.created"],
            teamId: team.id,
          },
        });
        // The pre-check sees a public address; the connection then gets loopback.
        const dnsp = require("node:dns/promises");
        const dnsc = require("node:dns");
        const [realP, realC] = [dnsp.lookup, dnsc.lookup];
        dnsp.lookup = async (h: string, o: any) =>
          h === "rebind.test"
            ? [{ address: "93.184.216.34", family: 4 }]
            : realP(h, o);
        dnsc.lookup = (h: string, o: any, cb: any) =>
          h === "rebind.test"
            ? cb(null, [{ address: "127.0.0.1", family: 4 }])
            : realC(h, o, cb);
        try {
          const { prepareWebhookPayload } =
            await import("../../lib/webhook/transform");
          const run = await deliverWebhookTask.trigger({
            webhookId: rebind.pId,
            payload: prepareWebhookPayload("dataroom.created", data),
          });
          const status = await waitForStatus(
            run.id,
            ["COMPLETED", "FAILED"],
            30000,
          );
          assert(status === "FAILED", `refused, got ${status}`);
          assert(hits.length === 0, "nothing reached the local endpoint");
        } finally {
          dnsp.lookup = realP;
          dnsc.lookup = realC;
          process.env.WEBHOOK_ALLOW_PRIVATE_URLS = "true";
        }
      },
    );

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
