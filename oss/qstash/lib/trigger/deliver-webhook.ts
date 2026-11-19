/**
 * [fork] Outgoing webhook delivery on the jobs layer, replacing Upstash QStash
 * (lib/webhook/send-webhooks.ts uses it when QSTASH_TOKEN is unset). Same
 * request as QStash made: POST of the JSON payload with X-Papermark-Signature,
 * retried on network errors and non-2xx answers.
 *
 * QStash fetched from Upstash's network; this worker sits inside the install's
 * network, so endpoints that resolve to private, loopback or link-local
 * addresses are refused unless WEBHOOK_ALLOW_PRIVATE_URLS=true.
 */
import { AbortTaskRunError, logger, task } from "@trigger.dev/sdk";
import { randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

import prisma from "@/lib/prisma";
import { recordWebhookEvent } from "@/lib/tinybird/publish";
import { createWebhookSignature } from "@/lib/webhook/signature";
import type { WebhookPayload } from "@/lib/webhook/types";

const DELIVERY_TIMEOUT_MS = 15_000;

const privateRanges = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
] as const) {
  privateRanges.addSubnet(net, prefix, "ipv4");
}
for (const [net, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["fc00::", 7],
  ["fe80::", 10],
] as const) {
  privateRanges.addSubnet(net, prefix, "ipv6");
}

function isPrivateAddress(address: string): boolean {
  const mapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped) return privateRanges.check(mapped[1], "ipv4");
  return privateRanges.check(address, isIP(address) === 6 ? "ipv6" : "ipv4");
}

/** Throws an AbortTaskRunError (no retry) for a URL the worker must not call. */
export async function assertDeliverableUrl(rawUrl: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new AbortTaskRunError("Webhook URL is not a valid URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new AbortTaskRunError(
      `Webhook URL scheme ${url.protocol} not allowed`,
    );
  }
  if (process.env.WEBHOOK_ALLOW_PRIVATE_URLS === "true") return;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host)
    ? [host]
    : (await lookup(host, { all: true })).map((a) => a.address);
  if (addresses.some(isPrivateAddress)) {
    throw new AbortTaskRunError(
      `Webhook host ${url.host} resolves to a private address (set WEBHOOK_ALLOW_PRIVATE_URLS=true to allow)`,
    );
  }
}

const redact = (rawUrl: string) => {
  try {
    const u = new URL(rawUrl);
    return `${u.protocol}//${u.host}`;
  } catch {
    return "[invalid-url]";
  }
};

/** The webhook's event log (Settings → Webhooks), as QStash's callback kept
 * it; never fails a delivery. */
async function logAttempt(
  webhookId: string,
  payload: WebhookPayload,
  url: string,
  status: number,
  requestBody: string,
  responseBody: string,
) {
  await recordWebhookEvent({
    event_id: payload.id,
    webhook_id: webhookId,
    message_id: randomUUID(),
    event: payload.event,
    url,
    http_status: status,
    request_body: requestBody,
    response_body: responseBody,
  }).catch((error) =>
    logger.warn("Webhook event log write failed", { error: String(error) }),
  );
}

export const deliverWebhookTask = task({
  id: "deliver-webhook",
  retry: { maxAttempts: 3 },
  run: async ({
    webhookId,
    payload,
  }: {
    webhookId: string;
    payload: WebhookPayload;
  }) => {
    // Read the endpoint at delivery time: the secret stays out of the job
    // payload, and a deleted webhook is not called.
    const webhook = await prisma.webhook.findUnique({
      where: { pId: webhookId },
      select: { url: true, secret: true },
    });
    if (!webhook) {
      logger.info("Webhook deleted before delivery", { webhookId });
      return { delivered: false, reason: "webhook deleted" };
    }

    await assertDeliverableUrl(webhook.url);
    const signature = await createWebhookSignature(webhook.secret, payload);
    const body = JSON.stringify(payload);
    let response: Response;
    try {
      response = await fetch(webhook.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Papermark-Signature": signature,
        },
        body,
        redirect: "manual",
        signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
      });
    } catch (error) {
      await logAttempt(
        webhookId,
        payload,
        webhook.url,
        503,
        body,
        String(error),
      );
      throw error;
    }
    // Read (and so release) the body; the event log keeps the first 10 KB.
    const responseBody = await response.text().catch(() => "");
    await logAttempt(
      webhookId,
      payload,
      webhook.url,
      response.status,
      body,
      responseBody.slice(0, 10_000),
    );

    if (!response.ok) {
      throw new Error(
        `Webhook ${webhookId} to ${redact(webhook.url)} answered ${response.status}`,
      );
    }
    logger.info("Webhook delivered", {
      webhookId,
      event: payload.event,
      status: response.status,
    });
    return { delivered: true, status: response.status };
  },
});
