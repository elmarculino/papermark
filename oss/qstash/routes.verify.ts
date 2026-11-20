/**
 * The QStash-called routes must refuse unsigned requests on a self-hosted
 * production install (VERCEL unset, NODE_ENV=production):
 *   NODE_ENV=production npx tsx --tsconfig oss/tsconfig.jobs.json oss/qstash/routes.verify.ts
 * The receiver's verify is wrapped so each check sees what was verified and
 * the outcome, and an accepted signature stops the handler before any work:
 * a refusal must come from the signature check, not from something later.
 */
import { loadEnvConfig } from "@next/env";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { assert, check } from "../jobs/testing";

loadEnvConfig(process.cwd());
delete process.env.VERCEL;

// A placeholder signing key, as an install might set it, and the SDK's dev
// mode switched on: neither may make a forged signature count.
process.env.QSTASH_CURRENT_SIGNING_KEY = "unused";
process.env.QSTASH_NEXT_SIGNING_KEY = "unused";
process.env.QSTASH_DEV = "true";

const ROUTES = [
  "app/api/cron/welcome-user/route",
  "app/api/webhooks/callback/route",
  "app/api/cron/dataroom-digest/daily/route",
  "app/api/cron/dataroom-digest/weekly/route",
  "app/api/cron/year-in-review/route",
  "app/api/cron/domains/route",
];

/** Valid bodies, with the whitespace a signed body may carry. */
const bodyFor = (route: string) =>
  route.includes("callback")
    ? '{ "status": 200, "url": "https://example.com/hook", "createdAt": 1,\n  "sourceMessageId": "m", "sourceBody": "e30=" }\n'
    : '{ "userId": "nobody" }\n';

/** The SDK's publicly known dev signing key, read from the installed SDK. */
function sdkDevKey(): string {
  const dir = join(process.cwd(), "node_modules/@upstash/qstash");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".mjs"))) {
    const match = readFileSync(join(dir, file), "utf8").match(
      /DEV_CREDENTIALS = \{[^}]*currentSigningKey: "([^"]+)"/,
    );
    if (match) return match[1];
  }
  throw new Error("@upstash/qstash dev credentials not found (SDK changed?)");
}

/** A QStash-style JWT over `body`, signed with `key`. */
function sign(key: string, url: string, body: string) {
  const b64 = (v: string | Buffer) => Buffer.from(v).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const head = b64(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const claims = b64(
    JSON.stringify({
      iss: "Upstash",
      sub: url,
      exp: now + 300,
      nbf: now - 10,
      iat: now,
      jti: "forged",
      body: createHash("sha256").update(body).digest("base64url"),
    }),
  );
  const sig = createHmac("sha256", key)
    .update(`${head}.${claims}`)
    .digest("base64url");
  return `${head}.${claims}.${sig}`;
}

type Call = { body: string; accepted: boolean };

async function main() {
  assert(process.env.NODE_ENV === "production", "run with NODE_ENV=production");
  const { receiver } = await import("../../lib/cron");
  const calls: Call[] = [];
  const verify = receiver.verify.bind(receiver);
  receiver.verify = async (request) => {
    const call: Call = { body: request.body, accepted: false };
    calls.push(call);
    call.accepted = await verify(request).catch(() => false);
    // Stop here either way: the handler must do nothing past this point.
    throw new Error(call.accepted ? "test: accepted" : "test: refused");
  };

  async function post(route: string, key: string) {
    const { POST } = await import(`../../${route}`);
    const url = `http://localhost/${route.replace(/^app\/|\/route$/g, "")}?webhookId=wh&eventId=evt&event=link.viewed`;
    const body = bodyFor(route);
    calls.length = 0;
    let status = 0;
    try {
      status = (
        await POST(
          new Request(url, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "Upstash-Signature": sign(key, url, body),
            },
            body,
          }),
        )
      ).status;
    } catch {
      status = 500; // the signature check threw (verifyQstashSignature)
    }
    assert(calls.length === 1, `signature checked ${calls.length} times`);
    assert(calls[0].body === body, "the raw body is what gets verified");
    return { status, accepted: calls[0].accepted };
  }

  const keys = {
    "a placeholder key": "unused",
    "the SDK dev key": sdkDevKey(),
  };
  for (const route of ROUTES) {
    for (const [name, key] of Object.entries(keys)) {
      await check(`${route}: POST signed with ${name} refused`, async () => {
        const { status, accepted } = await post(route, key);
        assert(!accepted, "signature accepted");
        assert(status >= 400, `answered ${status}`);
      });
    }
  }

  await check(
    "a body with whitespace, signed with the install's key, verifies",
    async () => {
      const key = randomBytes(32).toString("hex");
      receiver.currentSigningKey = key;
      receiver.nextSigningKey = key;
      for (const route of ROUTES) {
        const { accepted } = await post(route, key);
        assert(accepted, `${route}: refused a valid signature`);
      }
    },
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
