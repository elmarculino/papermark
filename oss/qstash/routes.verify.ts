/**
 * The QStash-called routes must refuse unsigned requests on a self-hosted
 * production install (VERCEL unset, NODE_ENV=production):
 *   NODE_ENV=production npx tsx --tsconfig oss/tsconfig.jobs.json oss/qstash/routes.verify.ts
 * Each handler is called with an unsigned POST; none may answer 2xx.
 */
import { loadEnvConfig } from "@next/env";

import { assert, check } from "../jobs/testing";

loadEnvConfig(process.cwd());
delete process.env.VERCEL;

const ROUTES = [
  "app/api/cron/welcome-user/route",
  "app/api/webhooks/callback/route",
  "app/api/cron/dataroom-digest/daily/route",
  "app/api/cron/dataroom-digest/weekly/route",
  "app/api/cron/year-in-review/route",
  "app/api/cron/domains/route",
];

// A placeholder signing key, as an install might set it.
process.env.QSTASH_CURRENT_SIGNING_KEY = "unused";
process.env.QSTASH_NEXT_SIGNING_KEY = "unused";

/** A QStash-style JWT signed with the placeholder key. */
function forge(url: string, body: string) {
  const { createHash, createHmac } = require("node:crypto");
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
  const sig = createHmac("sha256", "unused")
    .update(`${head}.${claims}`)
    .digest("base64url");
  return `${head}.${claims}.${sig}`;
}

async function main() {
  assert(process.env.NODE_ENV === "production", "run with NODE_ENV=production");
  for (const route of ROUTES) {
    await check(
      `${route}: POST signed with a placeholder key refused`,
      async () => {
        const { POST } = await import(`../../${route}`);
        const url = `http://localhost/${route.replace(/^app\/|\/route$/g, "")}?webhookId=wh&eventId=evt&event=link.viewed`;
        const body = JSON.stringify({ userId: "nobody" });
        const req = new Request(url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            // signed with the placeholder key: must not count as signed
            "Upstash-Signature": forge(url, body),
          },
          body,
        });
        let status: number;
        try {
          status = (await POST(req)).status;
        } catch {
          status = 500; // thrown before any work: Next answers 500
        }
        assert(status >= 400, `answered ${status}`);
      },
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
