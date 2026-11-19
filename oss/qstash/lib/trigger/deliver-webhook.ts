/**
 * [fork] Outgoing webhook delivery on the jobs layer, replacing Upstash QStash
 * (lib/webhook/send-webhooks.ts uses it when QSTASH_TOKEN is unset). Same
 * request as QStash made: POST of the JSON payload with X-Papermark-Signature,
 * retried on network errors and non-2xx answers.
 *
 * QStash fetched from Upstash's network; this worker sits inside the install's
 * network, so endpoints that resolve to private, loopback or link-local
 * addresses are refused unless WEBHOOK_ALLOW_PRIVATE_URLS=true. The check
 * runs again inside the connection's own DNS lookup, so a host that answers
 * public first and private later (DNS rebinding) can't slip through.
 */
import { AbortTaskRunError, logger, task } from "@trigger.dev/sdk";
import { randomUUID } from "node:crypto";
import { type LookupAddress, lookup as lookupCallback } from "node:dns";
import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { BlockList, type LookupFunction, isIP } from "node:net";

import prisma from "@/lib/prisma";
import { recordWebhookEvent } from "@/lib/tinybird/publish";
import { createWebhookSignature } from "@/lib/webhook/signature";
import type { WebhookPayload } from "@/lib/webhook/types";

// Whole-request deadline (WEBHOOK_DELIVERY_TIMEOUT_MS, default 15 s).
const deliveryTimeoutMs = () =>
  Number(process.env.WEBHOOK_DELIVERY_TIMEOUT_MS) || 15_000;

const privateRanges = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, broadcast
] as const) {
  privateRanges.addSubnet(net, prefix, "ipv4");
}
for (const [net, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["fc00::", 7],
  ["fe80::", 10],
  ["64:ff9b::", 96], // NAT64 to IPv4
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

const allowPrivate = () => process.env.WEBHOOK_ALLOW_PRIVATE_URLS === "true";

/** dns.lookup for the connection itself: fails on any private address. */
const guardedLookup: LookupFunction = (hostname, options, callback) => {
  lookupCallback(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error, "", 4);
    const list = addresses as unknown as LookupAddress[];
    if (!allowPrivate() && list.some((a) => isPrivateAddress(a.address))) {
      const refused = Object.assign(
        new Error(`Webhook host ${hostname} resolves to a private address`),
        { code: "EPRIVATEADDR" },
      );
      return callback(refused, "", 4);
    }
    if (options.all) return callback(null, list as any, 4);
    callback(null, list[0].address, list[0].family);
  });
};

/** POST without following redirects; keeps the first 10 KB of the answer. */
export function postJson(
  url: string,
  body: string,
  headers: Record<string, string>,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const client = target.protocol === "https:" ? https : http;
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      fn();
    };
    const req = client.request(
      target,
      {
        method: "POST",
        headers: { ...headers, "Content-Length": Buffer.byteLength(body) },
        lookup: guardedLookup,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        const done = () =>
          finish(() =>
            resolve({
              status: res.statusCode ?? 0,
              body: Buffer.concat(chunks).toString("utf8").slice(0, 10_000),
            }),
          );
        res.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
          size += chunk.length;
          // Enough for the event log: stop reading.
          if (size >= 10_000) {
            done();
            res.destroy();
          }
        });
        res.on("end", done);
        res.on("close", done);
        res.on("error", (error) => finish(() => reject(error)));
      },
    );
    // A deadline for the whole request, not just idle time: a peer that
    // trickles bytes can't hold the worker.
    const deadline = setTimeout(
      () => req.destroy(new Error("Webhook request timed out")),
      deliveryTimeoutMs(),
    );
    req.on("error", (error) => finish(() => reject(error)));
    req.end(body);
  });
}

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
    let response: { status: number; body: string };
    try {
      response = await postJson(webhook.url, body, {
        "Content-Type": "application/json",
        "X-Papermark-Signature": signature,
      });
    } catch (error) {
      const refused = (error as { code?: string }).code === "EPRIVATEADDR";
      await logAttempt(
        webhookId,
        payload,
        webhook.url,
        503,
        body,
        refused ? "refused: private address" : String(error),
      );
      // A private address won't stop being one: no retries.
      if (refused) throw new AbortTaskRunError((error as Error).message);
      throw error;
    }
    await logAttempt(
      webhookId,
      payload,
      webhook.url,
      response.status,
      body,
      response.body,
    );

    if (response.status < 200 || response.status >= 300) {
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
